#!/usr/bin/env node
// Exercises the parts of the extension that have no business touching a
// browser: record keying and merging, the IndexedDB dataset store (through the
// real service-worker message path), RAW CSV import/export, coordinate
// normalisation, offline district classification and the legacy migration.
// Run: node tools/smoke-test.mjs
import { loadExtension } from './harness.mjs';

let failures = 0;
const check = (name, cond, detail = '') => {
  if (cond) console.log(`ok   ${name}`);
  else { failures++; console.log(`FAIL ${name} ${detail}`); }
};
const section = name => console.log(`\n-- ${name}`);
// Fails loudly instead of hanging the test run when a promise never settles.
const api_race = (promise, ms) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(`did not settle within ${ms}ms`)), ms).unref?.()),
]);

const RAW_HEADER = 'source_district,source_group,source_category,title,address,phone,website,maps_url,source,source_query,source_queries_count,source_records,place_id,categories,rating,review_count,latitude,longitude';
const rawRow = (placeId, query, category, lat = '55.687149', lon = '37.572078', title = 'Штолле') =>
  `"Академический","Общепит","${category}","${title}","Профсоюзная ул., 4","+74956444045","https://x","https://yandex.ru/maps/org/x/${placeId}/","yandex_maps","${query}","1","[{""district"":""Академический"",""group"":""Общепит"",""category"":""${category}"",""query"":""${query}""}]","${placeId}","Пекарня, ресторан, кафе","4.5","1060","${lat}","${lon}"`;

const { api, shared } = await loadExtension({ withStore: true });

// --- record identity --------------------------------------------------------
section('record identity');
check('place_id parsed from org url', api.placeIdFromUrl('https://yandex.ru/maps/org/shtolle/1175665694/') === '1175665694');
check('place_id is the dedupe key', shared.stableKey({ place_id: '123456', title: 'a' }) === 'id:123456');
check('a card without place_id falls back to phone+address, never fuzzy matching',
  shared.stableKey({ phone: '+7 (495) 644-40-45', address: 'Профсоюзная ул., 4' }) === 'phone-address:74956444045|профсоюзная ул., 4');

const first = shared.mergeRecord(null, { place_id: '1', title: 'Штолле' }, { district: 'Академический', group: 'Общепит', category: 'Ресторан', query: 'q1' });
const second = shared.mergeRecord(first.row, { place_id: '1', title: 'Штолле (переименован)' }, { district: 'Академический', group: 'Общепит', category: 'Кафе', query: 'q2' });
check('merging keeps both source records', shared.sourceRecords(second.row).length === 2);
check('merging keeps the first version of the card', second.row.title === 'Штолле');
check('merging reports a new source hit', first.addedHits === 1 && second.addedHits === 1);
const repeat = shared.mergeRecord(second.row, { place_id: '1' }, { district: 'Академический', group: 'Общепит', category: 'Кафе', query: 'q2' });
check('the same query twice is not counted twice', repeat.addedHits === 0 && shared.sourceRecords(repeat.row).length === 2);

// --- store ------------------------------------------------------------------
section('IndexedDB store, through the service-worker message path');
await api.store('clearRaw');
const put1 = await api.store('putRaw', { records: [{ place_id: '100', title: 'A' }, { place_id: '200', title: 'B' }], record: { district: 'Академический', group: 'Общепит', category: 'Ресторан', query: 'q1' } });
check('two cards stored', put1.rawUnique === 2 && put1.rawSourceHits === 2, JSON.stringify(put1));
const put2 = await api.store('putRaw', { records: [{ place_id: '100', title: 'A again' }], record: { district: 'Академический', group: 'Общепит', category: 'Кафе', query: 'q2' } });
check('the same organisation found by a second query stays one row',
  put2.rawUnique === 2 && put2.rawSourceHits === 3, JSON.stringify(put2));
const put3 = await api.store('putRaw', { records: [{ place_id: '100' }], record: { district: 'Академический', group: 'Общепит', category: 'Кафе', query: 'q2' } });
check('re-collecting the same card under the same query adds nothing', put3.rawUnique === 2 && put3.rawSourceHits === 3);

const dupBatch = await api.store('putRaw', { records: [{ place_id: '300', title: 'C' }, { place_id: '300', title: 'C' }], record: { district: '', group: '', category: '', query: 'q3' } });
check('a card repeated inside one batch is folded, not clobbered', dupBatch.rawUnique === 3 && dupBatch.inserted === 1);

const cached = await api.store('getRawByPlaceId', { place_id: '100' });
check('card cache lookup goes through the place_id index', cached?.place_id === '100' && cached.source_queries_count === 2);
check('a missing place_id returns null', (await api.store('getRawByPlaceId', { place_id: 'nope' })) === null);

const listed = await api.store('listRaw', { offset: 0, limit: 500 });
check('listing returns every stored row', listed.length === 3);
check('paging skips by offset', (await api.store('listRaw', { offset: 2, limit: 500 })).length === 1);
check('recount rebuilds the totals from the rows', JSON.stringify(await api.store('recount')).includes('"rawUnique":3'));

let streamed = 0;
await api.eachStored('listRaw', rows => { streamed += rows.length; });
check('eachStored streams the whole store', streamed === 3);

await api.store('putFinal', { records: [{ place_id: '100', key: 'id:100', final_status: 'ACCEPTED' }] });
check('final rows are counted separately', (await api.storeTotals()).finalCount === 1);
await api.store('clearFinal');
check('clearing FINAL leaves RAW alone', (await api.storeTotals()).finalCount === 0 && (await api.storeTotals()).uniqueCount === 3);

// --- RAW import / re-filter without re-collecting ----------------------------
section('RAW import and filtering');
const rawCsv = [RAW_HEADER,
  rawRow('1175665694', 'рестораны Академический район Москва', 'Ресторан'),
  rawRow('1175665694', 'кафе Академический район Москва', 'Кафе'),
  rawRow('231950595809', 'рестораны Академический район Москва', 'Ресторан', '55.700545', '37.578120', 'Ривьера'),
  rawRow('187388947173', 'рестораны Академический район Москва', 'Ресторан', '55.691872', '37.561413', 'Brasserie Lambic'),
].join('\r\n');

await api.store('clearRaw');
await api.loadRawText(rawCsv, 'test-raw.csv');
const afterImport = await api.storeTotals();
check('import dedupes by place_id', afterImport.uniqueCount === 3, JSON.stringify(afterImport));
check('import keeps provenance from both queries', afterImport.sourceHits === 4, JSON.stringify(afterImport));
check('import rebuilds the query queue', api.getBatch().queue.length === 2, `${api.getBatch().queue.length}`);

const withMeta = rawCsv.replace('source_queries_count,', 'export_batch_status,export_warnings,source_queries_count,')
  .replace(/"yandex_maps","([^"]+)",/g, '"yandex_maps","$1","STOPPED","",');
await api.store('clearRaw');
await api.loadRawText(withMeta, 'with-meta.csv');
check('the run-provenance columns of a v1.4.2+ export do not break re-import',
  (await api.storeTotals()).uniqueCount === 3);

await api.store('clearRaw');
await api.loadRawText(rawCsv, 'test-raw.csv');
await api.filterBatch();
const filtered = api.getBatch();
check('filter runs to completion', filtered.filterStatus === 'COMPLETED', `${filtered.filterStatus} ${filtered.filterError || ''}`);
check('filter processed every stored row', filtered.filterStats.processed === 3, JSON.stringify(filtered.filterStats));
check('filter wrote FINAL to the store', filtered.finalCount === filtered.filterStats.accepted && filtered.finalCount > 0,
  `finalCount=${filtered.finalCount} accepted=${filtered.filterStats.accepted}`);
const finalRows = await api.store('listFinal', { offset: 0, limit: 500 });
check('FINAL carries the computed validations, not a hardcoded MATCH',
  finalRows.every(r => r.category_validation && r.district_validation && r.final_status === 'ACCEPTED'));
check('an organisation outside the requested district is rejected',
  filtered.filterStats.rejectedDistrict === 1, JSON.stringify(filtered.filterStats));

// --- geo --------------------------------------------------------------------
section('offline geography');
const geo = await api.ensureGeo();
check('boundaries load offline', geo.source.startsWith('embedded:'), geo.source);
check('boundary quality is measured', typeof geo.quality?.ambiguousPercent === 'number');
const probe = await api.detectGeoDistrict({ latitude: 55.6875, longitude: 37.5730 });
check('regression probe -> Академический', probe.district === 'Академический' && probe.quality === 'EXACT', JSON.stringify(probe));
const noCoords = await api.detectGeoDistrict({ latitude: '', longitude: '' });
check('missing coordinates are NO_COORDINATES', noCoords.valid === false && noCoords.quality === 'NO_COORDINATES');
check('the bundled outlines claim no square metre twice',
  geo.quality.ambiguousPercent === 0, `${geo.quality.ambiguousPercent}%`);

// The shipped outlines do not overlap, so the tie-break is exercised against a
// deliberately broken set. It is insurance for a future regeneration of the
// boundaries, not something the current data needs.
const { readFileSync } = await import('node:fs');
const boundaries = JSON.parse(readFileSync(new URL('../data/uzao_districts.geojson', import.meta.url), 'utf8'));
const deep = { lat: 55.6577, lon: 37.5925 }; // deep inside Зюзино
check('the probe point belongs to exactly one district before we break anything',
  (await api.detectGeoDistrict({ latitude: deep.lat, longitude: deep.lon })).quality === 'EXACT');
{
  const geometries = {}, bounds = {};
  for (const f of boundaries.features) {
    geometries[f.properties.name] = f.geometry;
    let mnx = Infinity, mxx = -Infinity, mny = Infinity, mxy = -Infinity;
    const walk = v => { if (typeof v[0] === 'number') { mnx = Math.min(mnx, v[0]); mxx = Math.max(mxx, v[0]); mny = Math.min(mny, v[1]); mxy = Math.max(mxy, v[1]); } else v.forEach(walk); };
    walk(f.geometry.coordinates);
    bounds[f.properties.name] = { minLon: mnx, maxLon: mxx, minLat: mny, maxLat: mxy };
  }
  const d = 0.004;
  const patch = [[[deep.lon - d, deep.lat - d], [deep.lon + d, deep.lat - d], [deep.lon + d, deep.lat + d], [deep.lon - d, deep.lat + d], [deep.lon - d, deep.lat - d]]];
  const ch = geometries['Черёмушки'];
  geometries['Черёмушки'] = { type: 'MultiPolygon', coordinates: [ch.type === 'Polygon' ? ch.coordinates : ch.coordinates[0], patch] };
  bounds['Черёмушки'] = { minLon: Math.min(bounds['Черёмушки'].minLon, deep.lon - d), maxLon: Math.max(bounds['Черёмушки'].maxLon, deep.lon + d), minLat: Math.min(bounds['Черёмушки'].minLat, deep.lat - d), maxLat: Math.max(bounds['Черёмушки'].maxLat, deep.lat + d) };
  api.setGeoCache(api.buildGeoCache(geometries, bounds, 'test:overlapping'));
}
const brokenGeo = await api.ensureGeo();
check('overlap in a boundary set is measured, not silently accepted',
  brokenGeo.quality.ambiguousPercent > 0, `${brokenGeo.quality.ambiguousPercent}%`);
const overlap = await api.detectGeoDistrict({ latitude: deep.lat, longitude: deep.lon });
check('overlapping outlines resolve to one district instead of dropping the org',
  overlap.district !== null && overlap.quality === 'AMBIGUOUS' && overlap.candidates.length > 1, JSON.stringify(overlap));
check('the tie-break picks the district the point sits deepest inside',
  overlap.district === 'Зюзино', overlap.district);
api.setGeoCache(api.embeddedGeo());
check('the bundled outlines are restored', (await api.ensureGeo()).source.startsWith('embedded:'));

check('a point outside ЮЗАО is OUTSIDE', (await api.detectGeoDistrict({ latitude: 55.9, longitude: 37.4 })).district === null);
const swapped = api.normalizeCoords({ latitude: 37.572078, longitude: 55.687149 });
check('legacy swapped lat/lon is repaired', Math.round(swapped.latitude * 1e4) === 556871 && swapped._coords_swapped === true);

check('matching org is accepted with real validations', (await api.evaluateItem(
  { latitude: 55.6875, longitude: 37.5730, categories: 'Ресторан, бар' },
  { district: 'Академический', group: 'Общепит', category: 'Ресторан', query: 'q' })).accept);
check('org without coordinates is NO_COORDINATES, not a district mismatch',
  (await api.evaluateItem({ latitude: '', longitude: '', categories: 'Ресторан' },
    { district: 'Академический', group: 'Общепит', category: 'Ресторан', query: 'q' })).districtValidation === 'NO_COORDINATES');
// A record with no district cannot place an organisation, so it must not be
// what lets one into a district register. A real run collected rows outside
// ЮЗАО under such a record and they were accepted into Гагаринский.
const free = await api.evaluateItem({ latitude: 55.6875, longitude: 37.5730, categories: 'Ресторан' },
  { district: '', group: '', category: '', query: 'свободный запрос' });
check('a record with no district never admits an organisation',
  !free.accept && free.districtValidation === 'NO_DISTRICT_IN_QUERY', JSON.stringify(free));
const outsideOkrug = await api.evaluateItem(
  { latitude: 55.661689, longitude: 37.481469, categories: 'Кальян-бар, ресторан, бар' },
  { district: '', group: '', category: '', query: 'кафе Гагаринский район Москва' });
check('an organisation outside ЮЗАО is not let in through an empty record',
  !outsideOkrug.accept, JSON.stringify(outsideOkrug));
check('unknown category stays UNKNOWN', api.categoryMatch('Ночной клуб', 'Ресторан') === null);

// The eleven query categories are a way of finding organisations, not a
// classification contract: a real district run lost 26 shops because Yandex
// files them under its own category rather than the one that surfaced them.
const groupCase = async (categories, group, category) => api.evaluateItem(
  { latitude: 55.687149, longitude: 37.572078, categories, detail_level: 'CARD' },
  { district: 'Академический', group, category, query: 'q' });
const meat = await groupCase('Магазин мяса, колбас', 'Продуктовая розница', 'Продуктовый магазин');
check('a meat shop found by the grocery query is kept, flagged as a group match',
  meat.accept && meat.categoryValidation === 'GROUP_MATCH', JSON.stringify(meat));
const magnit = await groupCase('Супермаркет, магазин продуктов', 'Продуктовая розница', 'Специализированная пищевая розница');
check('a supermarket found by the specialist-retail query is kept', magnit.accept);
const pizza = await groupCase('Пиццерия, доставка еды и обедов', 'Общепит', 'Кафе');
check('a pizzeria found by the cafe query is kept', pizza.accept);
const exact = await groupCase('Ресторан, бар', 'Общепит', 'Ресторан');
check('an exact match is still reported as MATCH, not as a group match',
  exact.categoryValidation === 'MATCH', exact.categoryValidation);
const cakes = await groupCase('Торты на заказ', 'Общепит', 'Пекарня / кондитерская');
check('a cake maker is recognised as общепит', cakes.accept && cakes.detectedGroups.includes('Общепит'));
const wrongGroup = await groupCase('Магазин мяса, колбас', 'Общепит', 'Ресторан');
check('a shop is not let in through a catering query', !wrongGroup.accept, JSON.stringify(wrongGroup));
const offScope = await groupCase('Аптека, магазин хозтоваров', 'Продуктовая розница', 'Продуктовый магазин');
check('something outside the food scope is still rejected', !offScope.accept, JSON.stringify(offScope));
check('the detected group is reported for the register',
  (await groupCase('Супермаркет', 'Продуктовая розница', 'Супермаркет')).detectedGroups.join() === 'Продуктовая розница');
check('restaurant category rejects a shop', api.categoryMatch('Ресторан', 'Магазин продуктов') === false);

// --- RESET is the only destructive action -----------------------------------
section('reset');
await api.resetBatch();
check('RESET BATCH clears the registry', (await api.storeTotals()).uniqueCount === 0);

// --- fast path: reading what the page already loaded -------------------------
section('fast path');
const orgEntity = (id, title, lon, lat, extra = {}) => ({
  id, title, coordinates: [lon, lat],
  address: `ул. Тестовая, ${id}`, categories: [{ name: 'Ресторан' }], ...extra,
});
const searchPayload = { stack: [{ results: { items: [
  orgEntity('1175665694', 'Штолле', 37.572078, 55.687149, {
    ratingData: { ratingValue: 4.5, ratingCount: 1060 }, workingTimeText: 'ежедневно, 08:00–22:00',
    photos: { count: 112 }, features: [{ name: 'Wi-Fi' }], compositeAddress: { street: 'Профсоюзная улица' },
    urls: ['https://msk.stolle.ru/'], phones: [{ value: '+74956444045' }], socialLinks: [{ href: 'https://t.me/x' }],
  }),
  orgEntity('231950595809', 'Ривьера', 37.57812, 55.700545),
] } }] };

const fast = await loadExtension({ withStore: true });
check('entities are found by shape, wherever they sit in the payload',
  fast.entities.fromJson(searchPayload).length === 2);
check('field mapping matches the upstream card extractor',
  (() => { const x = fast.entities.fromJson(searchPayload)[0];
    return x.categories === 'Ресторан' && x.phone === '+74956444045' && x.website === 'https://msk.stolle.ru/'
      && x.opening_hours === 'ежедневно, 08:00–22:00' && x.street === 'Профсоюзная улица' && x.review_count === 1060; })());
check('coordinates keep the upstream convention that normalizeCoords repairs',
  (() => { const x = fast.entities.fromJson(searchPayload)[0];
    const n = fast.api.normalizeCoords(x); return n.latitude === 55.687149 && n.longitude === 37.572078; })());
check('a non-organisation object is ignored',
  fast.entities.fromJson({ a: { id: 'x', title: 'не организация', coordinates: [1] } }).length === 0);
check('an id that is not a Yandex place_id is rejected',
  fast.entities.fromJson({ a: orgEntity('abc', 'Чужое', 37.5, 55.6) }).length === 0);
check('a payload with no organisations costs nothing', fast.entities.fromText('{"foo":1}').length === 0);
check('malformed JSON does not throw', fast.entities.fromText('{"title":"x","coordinates":[1,2]') .length === 0);

fast.postFromPage({ __glsEntities: fast.entities.fromJson(searchPayload) });
check('the page hook feeds the collector through postMessage',
  fast.api.getListEntities().size === 2, `${fast.api.getListEntities().size}`);
fast.postFromPage({ __glsEntities: [{ place_id: 'not-an-id', title: 'x', latitude: 1, longitude: 2 }] });
check('a forged entity from the page is rejected', fast.api.getListEntities().size === 2);
fast.postFromPage({ somethingElse: true });
check('unrelated page messages are ignored', fast.api.getListEntities().size === 2);

fast.setDocumentStateView(JSON.stringify(searchPayload));
fast.api.getListEntities().clear();
check('the first page of results is seeded from the document, with no request',
  fast.api.seedFromDocument() === 2);
fast.setDocumentStateView('not json at all');
fast.api.getListEntities().clear();
check('an unreadable state-view just yields nothing', fast.api.seedFromDocument() === 0);

// --- filtering now tops up the rows that need it -----------------------------
section('filter with automatic card top-up');
const akademicheskiy = { district: 'Академический', group: 'Общепит', category: 'Ресторан', query: 'рестораны Академический район Москва' };
await fast.api.store('clearRaw');
await fast.api.store('putRaw', {
  records: [
    // accepted and complete - must not cost a request
    { place_id: '6000001', title: 'Полная', maps_url: 'https://yandex.ru/maps/org/a/6000001/', detail_level: 'LIST',
      categories: 'Ресторан', phone: '+74950000001', website: 'https://a.ru/', opening_hours: 'ежедневно',
      latitude: 55.687149, longitude: 37.572078 },
    // accepted but missing a site
    { place_id: '6000002', title: 'Без сайта', maps_url: 'https://yandex.ru/maps/org/b/6000002/', detail_level: 'LIST',
      categories: 'Ресторан', phone: '+74950000002', website: '', opening_hours: 'ежедневно',
      latitude: 55.688449, longitude: 37.573502 },
    // another district - settled by geography, never worth a card
    { place_id: '6000003', title: 'Другой район', maps_url: 'https://yandex.ru/maps/org/c/6000003/', detail_level: 'LIST',
      categories: '', phone: '', website: '', opening_hours: '', latitude: 55.691872, longitude: 37.561413 },
    // in the district but the list entry is empty - this is how "Батони" was lost
    { place_id: '6000004', title: 'Батони', maps_url: 'https://yandex.ru/maps/org/d/6000004/', detail_level: 'LIST',
      categories: '', phone: '', website: '', opening_hours: '', latitude: 55.687149, longitude: 37.572078 },
  ],
  record: akademicheskiy,
});

check('a complete list row needs no card', !fast.api.needsCardData({ detail_level: 'LIST', categories: 'Ресторан', phone: '1', website: '2', opening_hours: '3' }));
check('a row missing one field does', fast.api.needsCardData({ detail_level: 'LIST', categories: 'Ресторан', phone: '1', website: '', opening_hours: '3' }));
check('a row that already came from a card never does', !fast.api.needsCardData({ detail_level: 'CARD', categories: '', phone: '', website: '', opening_hours: '' }));

const asked = [];
fast.setCardFetcher(async url => {
  asked.push(url);
  return url.includes('6000004')
    ? { categories: 'Ресторан, бар', phone: '+74950000004', website: 'https://batoni.ru/', opening_hours: 'ежедневно' }
    : { website: 'https://b.ru/' };
});
await fast.api.filterBatch();
const f = fast.api.getBatch();
check('filtering runs to completion on its own', f.filterStatus === 'COMPLETED' && f.filterPhase === 'DONE',
  `${f.filterStatus}/${f.filterPhase} ${f.filterError || ''}`);
check('cards were fetched only for the two rows that needed them',
  asked.length === 2 && !asked.some(u => u.includes('6000001')) && !asked.some(u => u.includes('6000003')),
  JSON.stringify(asked));
check('the organisation with an empty list entry is recovered into FINAL',
  f.filterStats.accepted === 3, JSON.stringify(f.filterStats));
check('the one in another district is still rejected on geography',
  f.filterStats.rejectedDistrict === 1, JSON.stringify(f.filterStats));
check('the card counters are reported', f.filterStats.cardsQueued === 2 && f.filterStats.cardsLoaded === 2,
  JSON.stringify(f.filterStats));
const recovered = await fast.api.store('getRawByPlaceId', { place_id: '6000004' });
check('the recovered row keeps its provenance', fast.shared.sourceRecords(recovered).length === 1);
check('the top-up filled the gap that was blocking it', recovered.categories === 'Ресторан, бар');
const topped = await fast.api.store('getRawByPlaceId', { place_id: '6000002' });
check('an accepted row had its missing field filled in', topped.website === 'https://b.ru/');

check('nothing is left waiting', (await fast.api.storeTotals()).pendingPriority === 0);

asked.length = 0;
await fast.api.filterBatch();
check('re-filtering asks for no further cards', asked.length === 0, JSON.stringify(asked));
check('and reaches the same register', fast.api.getBatch().filterStats.accepted === 3);
// The upstream extractor reports the coordinate pair in Yandex's order. The
// collect path repairs it; the top-up path used to skip the repair and wrote
// latitude 37.x / longitude 55.x into the registry.
await fast.api.store('clearRaw');
await fast.api.store('putRaw', {
  records: [{ place_id: '6500001', title: 'Координаты', maps_url: 'https://yandex.ru/maps/org/z/6500001/',
    detail_level: 'LIST', categories: 'Ресторан', phone: '', website: '', opening_hours: '',
    latitude: 55.687149, longitude: 37.572078 }],
  record: akademicheskiy,
});
fast.setCardFetcher(async () => ({ latitude: 37.572078, longitude: 55.687149, phone: '+74950000009' }));
await fast.api.filterBatch();
const fixed = await fast.api.store('getRawByPlaceId', { place_id: '6500001' });
check('a topped-up row keeps latitude ≈55 and longitude ≈37',
  Math.round(fixed.latitude) === 56 && Math.round(fixed.longitude) === 38,
  `lat=${fixed.latitude} lon=${fixed.longitude}`);
check('and it is still in the register afterwards', fast.api.getBatch().filterStats.accepted === 1);


// Stopping has to take effect and leave the rest resumable.
await fast.api.store('clearRaw');
await fast.api.store('putRaw', {
  records: Array.from({ length: 5 }, (_, i) => ({
    place_id: `700000${i}`, title: `R${i}`, maps_url: `https://yandex.ru/maps/org/x/700000${i}/`,
    detail_level: 'LIST', categories: 'Ресторан', phone: '', website: '', opening_hours: '',
    latitude: 55.687149, longitude: 37.572078,
  })),
  record: akademicheskiy,
});
fast.setCardFetcher(async () => { fast.api.stopFilter(); return { phone: '+71111111111' }; });
await fast.api.filterBatch();
check('STOP ends filtering right away', fast.api.getBatch().filterStatus === 'STOPPED');
check('what was not topped up stays queued for the next run',
  (await fast.api.storeTotals()).pendingPriority === 4,
  `${(await fast.api.storeTotals()).pendingPriority}`);

// --- collecting district by district ----------------------------------------
section('several districts in one registry');
{
  const many = await loadExtension({ withStore: true });
  const row = (id, query, district, category) =>
    `"${district}","Общепит","${category}","Орг ${id}","адрес","","","https://yandex.ru/maps/org/x/${id}/","yandex_maps","${query}","1","[{""district"":""${district}"",""group"":""Общепит"",""category"":""${category}"",""query"":""${query}""}]","${id}","Ресторан","4","10","55.687149","37.572078"`;
  const header = 'source_district,source_group,source_category,title,address,phone,website,maps_url,source,source_query,source_queries_count,source_records,place_id,categories,rating,review_count,latitude,longitude';
  const akademicheskiy = [header, row('100', 'рестораны Академический район Москва', 'Академический', 'Ресторан'),
                                  row('200', 'рестораны Академический район Москва', 'Академический', 'Ресторан')].join('\r\n');
  const konkovo = [header, row('200', 'рестораны район Коньково Москва', 'Коньково', 'Ресторан'),
                            row('300', 'рестораны район Коньково Москва', 'Коньково', 'Ресторан')].join('\r\n');

  await many.api.store('clearRaw');
  await many.api.loadRawText(akademicheskiy, '01.csv');
  check('the first district is imported', (await many.api.storeTotals()).uniqueCount === 2);
  await many.api.loadRawText(konkovo, '04.csv');
  const both = await many.api.storeTotals();
  check('importing a second district adds to the registry instead of replacing it',
    both.uniqueCount === 3, JSON.stringify(both));
  const shared200 = await many.api.store('getRawByPlaceId', { place_id: '200' });
  check('an organisation found in both keeps both provenances',
    many.shared.sourceRecords(shared200).length === 2, shared200.source_records);
  check('and its source districts are both listed',
    shared200.source_district === 'Академический | Коньково', shared200.source_district);
  check('source hits count every query, not every organisation',
    both.sourceHits === 4, `${both.sourceHits}`);

  await many.api.loadRawText(konkovo, '04.csv');
  check('importing the same file twice changes nothing',
    (await many.api.storeTotals()).uniqueCount === 3 && (await many.api.storeTotals()).sourceHits === 4);

  // Loading the next district's queries must not look like a wipe: the panel
  // reading zero here is what makes people press RESET.
  await many.api.loadBatchText('district;group;category;query\nЗюзино;Общепит;Ресторан;рестораны район Зюзино Москва\n', '03.csv');
  check('loading the next queries leaves the registry alone',
    (await many.api.storeTotals()).uniqueCount === 3);
  check('and the panel still shows what is stored, not zero',
    many.api.getBatch().uniqueCount === 3, `${many.api.getBatch().uniqueCount}`);
  await many.api.startBatch().catch(() => {});
  check('starting the next district does not reset the counter either',
    many.api.getBatch().uniqueCount === 3, `${many.api.getBatch().uniqueCount}`);

  await many.api.resetBatch();
  check('RESET BATCH is still the one thing that clears it',
    (await many.api.storeTotals()).uniqueCount === 0);
}

// --- the search must be centred on the district it is looking for ------------
section('search viewport');
{
  const view = await loadExtension({ withStore: true });
  const konkovo = view.api.districtView('Коньково');
  check('every district has a viewport derived from its own outline',
    konkovo && Math.abs(konkovo.lon - 37.53) < 0.05 && Math.abs(konkovo.lat - 55.64) < 0.05,
    JSON.stringify(konkovo));
  check('a large district gets a wider zoom than a small one',
    view.api.districtView('Южное Бутово').z < view.api.districtView('Ломоносовский').z,
    `${view.api.districtView('Южное Бутово').z} vs ${view.api.districtView('Ломоносовский').z}`);

  // A real run had ll pointing at Академический while searching Коньково,
  // because the URL kept whatever the previous search had left there.
  globalThis.location.href = 'https://yandex.ru/maps/213/moscow/search/x/?ll=37.577063%2C55.689009&z=13';
  const url = new URL(view.api.buildSearchUrl('кафе район Коньково Москва', 'Коньково'));
  check('the viewport follows the district, not the previous search',
    url.searchParams.get('ll') === `${konkovo.lon},${konkovo.lat}`, url.searchParams.get('ll'));
  check('and the zoom is the one that fits that district',
    url.searchParams.get('z') === String(konkovo.z), url.searchParams.get('z'));
  check('the query itself is still what was asked for',
    decodeURIComponent(url.pathname).includes('кафе район Коньково Москва'), url.pathname);
  const free = new URL(view.api.buildSearchUrl('что-нибудь', ''));
  check('a query with no district keeps the current view instead of jumping',
    free.searchParams.get('ll') === '37.577063,55.689009', free.searchParams.get('ll'));
  globalThis.location.href = 'https://yandex.ru/maps/213/moscow/search/test/';
  globalThis.location.search = '';
}

// --- a query Yandex rewrites must not turn into a reload loop ----------------
section('batch navigation');
{
  const nav = await loadExtension({ withStore: true });
  await nav.api.store('clearRaw');
  await nav.api.loadRawText('place_id,title,latitude,longitude\r\n"1","x","55.6","37.5"', 'seed.csv').catch(() => {});
  await nav.api.loadBatchText('district;group;category;query\nАкадемический;Общепит;Фастфуд;фастфуд Академический район Москва\n', 'q.csv');

  // Yandex reformats "фастфуд" into "фаст фуд" and changes the URL. This is the
  // exact rewrite that sent a real run into an endless reload.
  globalThis.__rewriteQuery = url => url.replace(encodeURIComponent('фастфуд'), encodeURIComponent('фаст фуд'));
  check('the rewrite is recognised as the same search',
    nav.api.looseQuery('фастфуд Академический район Москва') === nav.api.looseQuery('фаст фуд Академический район Москва'));

  await nav.api.startBatch();
  for (let i = 0; i < 12; i++) await nav.api.runBatchCurrent();
  const navigations = globalThis.location.navigations.length;
  check('navigation stops instead of looping forever', navigations <= 3, `${navigations} navigations`);
  check('the run continues on the page Yandex actually showed',
    nav.api.getState().status === 'RUNNING' || nav.api.getState().currentQueryId !== null,
    JSON.stringify({ status: nav.api.getState().status, id: nav.api.getState().currentQueryId }));
  check('AUTO is bound to the queue entry, not to the rewritten string',
    nav.api.getState().currentQueryId === nav.api.getBatch().queue[0].id,
    `${nav.api.getState().currentQueryId} vs ${nav.api.getBatch().queue[0].id}`);
  check('provenance keeps the query that was asked for',
    nav.api.getState().currentSearchQuery === 'фастфуд Академический район Москва',
    nav.api.getState().currentSearchQuery);
  check('the page Yandex substituted is recorded on the queue entry',
    nav.api.getBatch().queue[0].actualQuery === 'фаст фуд Академический район Москва',
    JSON.stringify(nav.api.getBatch().queue[0].actualQuery));
  globalThis.location.navigations.length = 0;
  globalThis.__rewriteQuery = null;
}

{
  // The harder case: Yandex substitutes something that is not just a
  // reformatting. Navigation must give up after a couple of tries rather than
  // reloading the page for ever.
  const nav = await loadExtension({ withStore: true });
  await nav.api.store('clearRaw');
  await nav.api.loadBatchText('district;group;category;query\nЯсенево;Общепит;Столовая;столовые Ясенево Москва\n', 'q.csv');
  globalThis.__rewriteQuery = () => 'https://yandex.ru/maps/213/moscow/search/' + encodeURIComponent('нечто совсем другое') + '/';
  await nav.api.startBatch();
  for (let i = 0; i < 12; i++) await nav.api.runBatchCurrent();
  const tries = globalThis.location.navigations.length;
  check('a substituted query is retried a couple of times, then let go',
    tries >= 2 && tries <= 3, `${tries} navigations`);
  check('and the batch keeps going instead of hanging',
    nav.api.getState().currentQueryId === nav.api.getBatch().queue[0].id,
    JSON.stringify({ id: nav.api.getState().currentQueryId }));
  globalThis.location.navigations.length = 0;
  globalThis.__rewriteQuery = null;
}

// --- migration off chrome.storage -------------------------------------------
section('migration of a v1.4.x dataset');
const legacy = await loadExtension({ withStore: true });
await legacy.api.store('clearRaw');
legacy.storage['yandex_batch_collect_v6'] = {
  status: 'COMPLETED', queue: [{ id: 'q-1', district: 'Академический', group: 'Общепит', category: 'Ресторан', query: 'q1', status: 'COMPLETED' }],
  completedQueries: 1, uniqueCount: 2, sourceHits: 2,
  data: [
    { place_id: '900', title: 'Старый RAW', source_records: '[{"district":"Академический","group":"Общепит","category":"Ресторан","query":"q1"}]' },
    { place_id: '901', title: 'Второй', source_records: '[{"district":"Академический","group":"Общепит","category":"Ресторан","query":"q1"}]' },
  ],
  cardCache: { 902: { place_id: '902', title: 'Только в кэше' } },
  finalData: [{ place_id: '900', title: 'Старый RAW', final_status: 'ACCEPTED' }],
};
legacy.storage['yandex_auto_collect_v5'] = {
  status: 'COMPLETED', currentSearchQuery: 'q1', uniqueCount: 1,
  data: [{ place_id: '903', title: 'Недособранный запрос' }],
};

await legacy.api.restore();
const migrated = await legacy.api.storeTotals();
check('every legacy row reached IndexedDB, including the card cache and the in-flight query',
  migrated.uniqueCount === 4, JSON.stringify(migrated));
check('legacy FINAL is preserved too', migrated.finalCount === 1, JSON.stringify(migrated));
const kept = await legacy.api.store('getRawByPlaceId', { place_id: '900' });
check('migrated rows keep their provenance', legacy.shared.sourceRecords(kept).length === 1, kept?.source_records);
const cacheOnly = await legacy.api.store('getRawByPlaceId', { place_id: '902' });
check('a card that only existed in the cache is not lost', cacheOnly?.title === 'Только в кэше');
const snapshot = legacy.storage['yandex_batch_collect_v6'];
check('the dataset is stripped from the chrome.storage snapshot',
  !('data' in snapshot) && !('cardCache' in snapshot) && !('finalData' in snapshot));
check('the snapshot is stamped so migration never runs twice', snapshot.storageVersion === 2);
check('totals in the snapshot match the store', snapshot.uniqueCount === 4 && snapshot.finalCount === 1);

await legacy.api.restore();
check('a second restore does not duplicate anything', (await legacy.api.storeTotals()).uniqueCount === 4);

// --- a run that cannot finish ----------------------------------------------
// The failure this covers: on a real 132-query batch the collector stopped
// after 44 organisations and sat at "работает" for an hour. Nothing threw,
// nothing timed out - a message to the service worker was never answered, and
// every check that would have ended the query lives inside the loop that was
// parked on that await.
section('a stalled run ends instead of waiting forever');
{
  const stall = await loadExtension({ withStore: true });
  stall.api.setConfig({ STORE_TIMEOUT_MS: 60, STORE_ATTEMPTS: 3, STALL_LIMIT_MS: 1000 });

  // A service worker that accepts the message, keeps the port open and never
  // answers - exactly what an evicted MV3 worker looks like from the page.
  const realSend = globalThis.chrome.runtime.sendMessage;
  let attempts = 0;
  globalThis.chrome.runtime.sendMessage = () => { attempts++; };
  const started = Date.now();
  let rejected = null;
  try { await api_race(stall.api.store('stats'), 5000); } catch (e) { rejected = e; }
  globalThis.chrome.runtime.sendMessage = realSend;

  check('a store call that is never answered rejects instead of hanging',
    rejected instanceof Error && /Хранилище не ответило за/.test(rejected.message), String(rejected));
  check('it is retried before giving up, so a woken worker still answers',
    attempts === 3, `attempts=${attempts}`);
  check('giving up takes the configured deadline, not forever',
    Date.now() - started < 4000, `${Date.now() - started}ms`);

  // The watchdog: the loop is parked, so only something outside it can notice.
  stall.api.setState({ status: 'RUNNING', uniqueCount: 44, currentSearchQuery: 'рестораны Гагаринский район Москва' });
  stall.api.setHeartbeat(Date.now() - 10 * 60 * 1000);
  await stall.api.watchdogTick();
  const after = stall.api.getState();
  check('a loop that has not turned for minutes is closed by the watchdog',
    after.status === 'COMPLETED', after.status);
  check('the 44 organisations already collected are kept, and the query is flagged, not silently trusted',
    after.uniqueCount === 44 && /завис/.test(after.warning || ''), after.warning);

  stall.api.setState({ status: 'RUNNING', uniqueCount: 0, warning: null, error: null });
  stall.api.setHeartbeat(Date.now() - 10 * 60 * 1000);
  await stall.api.watchdogTick();
  check('a stall with nothing collected is reported as an error, not as a finished query',
    stall.api.getState().status === 'ERROR' && /завис/.test(stall.api.getState().error || ''),
    stall.api.getState().error);

  stall.api.setState({ status: 'RUNNING', error: null });
  stall.api.beat();
  await stall.api.watchdogTick();
  check('a collector that is working is left alone', stall.api.getState().status === 'RUNNING');
}

console.log(`\n${failures ? `${failures} FAILURES` : 'all checks passed'}`);
process.exit(failures ? 1 : 0);
