// IndexedDB dataset store, hosted in the extension service worker.
//
// Why here and not in the content script: a content script's IndexedDB belongs
// to the visited page's origin (yandex.ru), so it would be wiped by clearing
// that site's data and would compete with the page for quota. In the service
// worker the database belongs to the extension origin, like chrome.storage.
//
// Why IndexedDB and not chrome.storage.local: chrome.storage serialises the
// whole value on every write, so persisting a growing dataset there costs
// O(n) per card and O(n²) per run. Here each card is one put, and the totals
// are maintained inside the same transaction so they can never drift.
//
// The worker keeps no state between messages beyond the open database handle,
// so MV3 shutting it down mid-run is harmless.
;(() => {
  const DB_NAME = 'geoleadscraper';
  const DB_VERSION = 2;
  const RAW = 'raw', FINAL = 'final', META = 'meta';
  const TOTALS = 'totals';
  const { stableKey, mergeRecord, sourceRecords } = globalThis.GLSRecord;

  let dbPromise = null;
  const openDb = () => {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result, tx = req.transaction;
        const raw = db.objectStoreNames.contains(RAW)
          ? tx.objectStore(RAW)
          : db.createObjectStore(RAW, { keyPath: 'key' });
        if (!raw.indexNames.contains('place_id')) raw.createIndex('place_id', 'place_id', { unique: false });
        // Rows collected from the page's own list data are marked LIST until a
        // card fetch fills in the contact fields. Rows written before this
        // index existed carry no detail_level, so they are absent from it -
        // which is correct: they were all full card fetches.
        if (!raw.indexNames.contains('detail_level')) raw.createIndex('detail_level', 'detail_level', { unique: false });
        if (!db.objectStoreNames.contains(FINAL)) db.createObjectStore(FINAL, { keyPath: 'key' });
        if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'id' });
      };
      req.onsuccess = () => {
        req.result.onclose = () => { dbPromise = null; };
        resolve(req.result);
      };
      req.onerror = () => reject(req.error);
    }).catch(e => { dbPromise = null; throw e; });
    return dbPromise;
  };

  const promise = req => new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const done = tx => new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Транзакция хранилища прервана.'));
  });

  const readTotals = store => promise(store.get(TOTALS)).then(t => t || { id: TOTALS, rawUnique: 0, rawSourceHits: 0, finalCount: 0 });

  // Writes a batch of collected cards under one transaction, merging each into
  // whatever is already stored for the same key and keeping the totals exact.
  //
  // Every await inside a transaction resolves from an IndexedDB request, and
  // all requests of a phase are issued in the same turn. Awaiting anything
  // else - or issuing a request a turn late - lets the transaction auto-close.
  const putRaw = async ({ records, record }) => {
    const incoming = (records || [])
      .map(item => ({ item, key: stableKey(item) }))
      .filter(x => x.key && x.key !== 'url:');
    const db = await openDb();
    const tx = db.transaction([RAW, META], 'readwrite');
    const raw = tx.objectStore(RAW), meta = tx.objectStore(META);

    const [totals, ...existing] = await Promise.all([
      readTotals(meta),
      ...incoming.map(x => promise(raw.get(x.key))),
    ]);

    // Merge in memory so that a card appearing twice within one batch is
    // folded together instead of the second put clobbering the first.
    const pending = new Map();
    let inserted = 0, hits = 0;
    incoming.forEach((x, i) => {
      const previous = pending.get(x.key) || existing[i];
      const merged = mergeRecord(previous, x.item, record);
      if (merged.inserted && !pending.has(x.key)) inserted++;
      if (merged.addedHit) hits++;
      pending.set(x.key, merged.row);
    });
    totals.rawUnique += inserted;
    totals.rawSourceHits += hits;

    await Promise.all([...[...pending.values()].map(row => promise(raw.put(row))), promise(meta.put(totals))]);
    await done(tx);
    return { rawUnique: totals.rawUnique, rawSourceHits: totals.rawSourceHits, inserted, addedHits: hits };
  };

  const getRawByPlaceId = async ({ place_id }) => {
    if (!place_id) return null;
    const db = await openDb();
    const tx = db.transaction(RAW, 'readonly');
    const found = await promise(tx.objectStore(RAW).index('place_id').get(String(place_id)));
    await done(tx);
    return found || null;
  };

  const page = async (storeName, { offset = 0, limit = 500 }) => {
    const db = await openDb();
    const tx = db.transaction(storeName, 'readonly');
    const rows = [];
    await new Promise((resolve, reject) => {
      const req = tx.objectStore(storeName).openCursor();
      let skipped = offset === 0;
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return resolve();
        if (!skipped) { skipped = true; cursor.advance(offset); return; }
        rows.push(cursor.value);
        if (rows.length >= limit) return resolve();
        cursor.continue();
      };
    });
    return rows;
  };

  // Overlays freshly fetched card fields onto rows already in the registry.
  // Deliberately not putRaw: that one keeps the stored version of a field and
  // would discard exactly what the enrichment pass just fetched. The org card
  // is the authoritative source, so a row read from the list and then enriched
  // ends up identical to one collected by card fetch in the first place. Empty
  // incoming values never erase stored ones, and provenance and the row key are
  // never touched.
  const enrichRaw = async ({ records }) => {
    const wanted = (records || []).filter(x => x?.key && x.fields);
    const db = await openDb();
    const tx = db.transaction(RAW, 'readwrite');
    const raw = tx.objectStore(RAW);
    const existing = await Promise.all(wanted.map(x => promise(raw.get(x.key))));
    const rows = [];
    wanted.forEach((x, i) => {
      const current = existing[i];
      if (!current) return;
      const next = { ...current };
      for (const [field, value] of Object.entries(x.fields)) {
        if (value === undefined || value === null || value === '') continue;
        if (['key', 'place_id', 'source_records', 'source_queries_count', 'source_district', 'source_group', 'source_category', 'source_query'].includes(field)) continue;
        next[field] = value;
      }
      next.detail_level = x.detailLevel || 'CARD';
      rows.push(next);
    });
    await Promise.all(rows.map(row => promise(raw.put(row))));
    await done(tx);
    return { updated: rows.length };
  };

  const countPendingDetail = store => promise(store.index('detail_level').count('LIST')).catch(() => 0);

  const putFinal = async ({ records }) => {
    const db = await openDb();
    const tx = db.transaction([FINAL, META], 'readwrite');
    const store = tx.objectStore(FINAL), meta = tx.objectStore(META);
    await Promise.all((records || []).map(row => promise(store.put({ ...row, key: row.key || stableKey(row) }))));
    const [totals, finalCount] = await Promise.all([readTotals(meta), promise(store.count())]);
    totals.finalCount = finalCount;
    await promise(meta.put(totals));
    await done(tx);
    return { finalCount: totals.finalCount };
  };

  const clearStores = async names => {
    const db = await openDb();
    const tx = db.transaction([...names, META], 'readwrite');
    const meta = tx.objectStore(META);
    const [totals] = await Promise.all([readTotals(meta), ...names.map(name => promise(tx.objectStore(name).clear()))]);
    if (names.includes(RAW)) { totals.rawUnique = 0; totals.rawSourceHits = 0; }
    if (names.includes(FINAL)) totals.finalCount = 0;
    await promise(meta.put(totals));
    await done(tx);
    return { cleared: names };
  };

  // Rebuilds the totals from the rows themselves. Used after an import and
  // available as a repair path if a crash ever leaves them inconsistent.
  const recount = async () => {
    const db = await openDb();
    const tx = db.transaction([RAW, FINAL, META], 'readwrite');
    const raw = tx.objectStore(RAW);
    let rawUnique = 0, rawSourceHits = 0;
    await new Promise((resolve, reject) => {
      const req = raw.openCursor();
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return resolve();
        rawUnique++;
        rawSourceHits += sourceRecords(cursor.value).length || 1;
        cursor.continue();
      };
    });
    const finalCount = await promise(tx.objectStore(FINAL).count());
    const totals = { id: TOTALS, rawUnique, rawSourceHits, finalCount };
    await promise(tx.objectStore(META).put(totals));
    await done(tx);
    return totals;
  };

  const stats = async () => {
    const db = await openDb();
    const tx = db.transaction([META, RAW], 'readonly');
    const [totals, pendingDetail] = await Promise.all([
      readTotals(tx.objectStore(META)),
      countPendingDetail(tx.objectStore(RAW)),
    ]);
    await done(tx);
    return { rawUnique: totals.rawUnique, rawSourceHits: totals.rawSourceHits, finalCount: totals.finalCount, pendingDetail };
  };

  // Pages over the rows still waiting for a card fetch. Driven off the index,
  // so the pass is resumable: a row leaves the set as soon as it is enriched.
  const listPendingDetail = async ({ limit = 200 }) => {
    const db = await openDb();
    const tx = db.transaction(RAW, 'readonly');
    const rows = await promise(tx.objectStore(RAW).index('detail_level').getAll('LIST', limit));
    await done(tx);
    return rows || [];
  };

  // The same queue, narrowed to organisations that survived the local filter.
  // RAW-first makes this possible: the registry is classified before any card
  // is fetched, so the expensive pass can be limited to the rows that will
  // actually end up in the final register.
  const listPendingDetailFinal = async ({ limit = 200 }) => {
    const db = await openDb();
    const tx = db.transaction([FINAL, RAW], 'readonly');
    const finalKeys = await promise(tx.objectStore(FINAL).getAllKeys());
    const raw = tx.objectStore(RAW);
    const rows = [];
    for (let i = 0; i < finalKeys.length && rows.length < limit; i += 200) {
      const slice = finalKeys.slice(i, i + 200);
      const found = await Promise.all(slice.map(key => promise(raw.get(key))));
      for (const row of found) {
        if (row?.detail_level === 'LIST' && rows.length < limit) rows.push(row);
      }
    }
    await done(tx);
    return rows;
  };

  const OPS = {
    putRaw,
    getRawByPlaceId,
    listRaw: args => page(RAW, args || {}),
    listFinal: args => page(FINAL, args || {}),
    putFinal,
    enrichRaw,
    listPendingDetail,
    listPendingDetailFinal,
    clearRaw: () => clearStores([RAW, FINAL]),
    clearFinal: () => clearStores([FINAL]),
    recount,
    stats,
  };

  const handle = async message => {
    const op = OPS[message.op];
    if (!op) throw new Error(`Неизвестная операция хранилища: ${message.op}`);
    return op(message.payload || {});
  };

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.type !== 'GLS_STORE') return;
    handle(message)
      .then(data => sendResponse({ ok: true, data }))
      .catch(error => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  });

  globalThis.GLSStore = { handle };
})();
