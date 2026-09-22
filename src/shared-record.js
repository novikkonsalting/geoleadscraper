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
  // queries - and, when a RAW export is merged back in, by several runs.
  // Returns the row to store plus how many new source records it gained, which
  // the caller uses to keep the source-hits total exact.
  // How complete a row is known to be. A card fetch beats a list entry; a row
  // whose card could not be fetched sits in between.
  const DETAIL_RANK = { LIST: 0, LIST_ONLY: 1, CARD: 2 };
  const PROVENANCE = new Set(['key', 'source_records', 'source_queries_count', 'source_district', 'source_group', 'source_category', 'source_query']);
  const isBlank = v => v === undefined || v === null || v === '';

  // The stored version of a field wins, but an empty one is not a version: it
  // is a gap, and the incoming row may have what fills it. Without this, an
  // organisation first seen as a thin list entry in one district's export kept
  // that emptiness forever, and the full record from the district that actually
  // fetched its card was thrown away on merge.
  const fillBlanks = (existing, incoming) => {
    if (!incoming || incoming === existing) return existing;
    const out = { ...existing };
    for (const [field, value] of Object.entries(incoming)) {
      if (PROVENANCE.has(field) || isBlank(value)) continue;
      if (field === 'detail_level') {
        if ((DETAIL_RANK[value] ?? -1) > (DETAIL_RANK[out.detail_level] ?? -1)) out.detail_level = value;
        continue;
      }
      if (isBlank(out[field])) out[field] = value;
    }
    return out;
  };

  const mergeRecord = (existing, incoming, record) => {
    const records = sourceRecords(existing);
    let addedHits = 0;
    const add = candidate => {
      const rec = cleanRecord(candidate);
      if (isEmptyRecord(rec)) return;
      const seen = JSON.stringify(rec);
      if (records.some(x => JSON.stringify(cleanRecord(x)) === seen)) return;
      records.push(rec);
      addedHits++;
    };
    // A freshly collected card carries no provenance of its own and gets the
    // query's; a row coming back from a RAW import carries the provenance it
    // was exported with, and merging must keep both sides' history.
    for (const own of sourceRecords(incoming)) add(own);
    add(record);
    const base = existing ? fillBlanks(existing, incoming) : incoming;
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
      addedHits,
    };
  };

  globalThis.GLSRecord = { normalize, normPhone, stableKey, sourceRecords, uniqueJoined, cleanRecord, mergeRecord, fillBlanks };
})();
