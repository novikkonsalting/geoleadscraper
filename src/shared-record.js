// Shared between the content script and the storage service worker.
// Both bundles are assembled by tools/build.mjs, so this file is the single
// definition of how an organisation is keyed, merged and deduplicated.
// Never edit the copies inside extension/ - they are build output.
;(() => {
  const normalize = v => (v || '').toLocaleLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
  const normPhone = v => (v || '').replace(/\D+/g, '');

  // place_id is the only primary key for Yandex. The fallbacks exist for cards
  // that never exposed one; fuzzy matching is deliberately not used.
  const stableKey = item => {
    if (item.place_id) return `id:${item.place_id}`;
    const p = normPhone(item.phone || item.phones), a = normalize(item.address), t = normalize(item.title);
    if (p && a) return `phone-address:${p}|${a}`;
    if (t && a) return `title-address:${t}|${a}`;
    return `url:${item.maps_url || ''}`;
  };

  const sourceRecords = item => {
    try { const x = JSON.parse(item?.source_records || '[]'); return Array.isArray(x) ? x : []; }
    catch { return []; }
  };

  const uniqueJoined = arr => [...new Set(arr.map(x => (x || '').trim()).filter(Boolean))].join(' | ');

  const cleanRecord = record => record ? {
    district: String(record.district || ''),
    group: String(record.group || ''),
    category: String(record.category || ''),
    query: String(record.query || ''),
  } : null;

  const isEmptyRecord = r => !r || (!r.district && !r.group && !r.category && !r.query);

  // Merges one collected card into whatever is already stored under the same
  // key. The first version of a card wins on field values; source records
  // accumulate, so provenance survives an organisation being found by several
  // queries. Returns the row to store plus whether a new source record was
  // added, which the caller uses to keep the source-hits total exact.
  const mergeRecord = (existing, incoming, record) => {
    const rec = cleanRecord(record);
    // Seed from the stored row when there is one, otherwise from the incoming
    // row: a freshly collected card has none, but a row coming back from a RAW
    // import carries the provenance it was exported with.
    const records = sourceRecords(existing || incoming);
    let addedHit = false;
    if (!isEmptyRecord(rec)) {
      const seen = JSON.stringify(rec);
      if (!records.some(x => JSON.stringify(cleanRecord(x)) === seen)) { records.push(rec); addedHit = true; }
    }
    const base = existing || incoming;
    return {
      row: {
        ...base,
        key: stableKey(base),
        source: 'yandex_maps',
        source_district: uniqueJoined(records.map(x => x.district)),
        source_group: uniqueJoined(records.map(x => x.group)),
        source_category: uniqueJoined(records.map(x => x.category)),
        source_query: uniqueJoined(records.map(x => x.query)),
        source_records: JSON.stringify(records),
        source_queries_count: records.length,
        category_validation: 'UNKNOWN',
        district_validation: 'UNKNOWN',
        detected_district: '',
        final_status: 'RAW',
        exclude_reason: '',
      },
      inserted: !existing,
      addedHit,
    };
  };

  globalThis.GLSRecord = { normalize, normPhone, stableKey, sourceRecords, uniqueJoined, cleanRecord, mergeRecord };
})();
