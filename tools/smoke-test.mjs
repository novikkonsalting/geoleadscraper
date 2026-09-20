#!/usr/bin/env node
// Loads src/yandex-module.js against a minimal DOM/chrome stub and exercises the
// parts that have no business touching a browser: RAW CSV import, batch CSV
// parsing, coordinate normalisation and offline district classification.
// Run: node tools/smoke-test.mjs
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'src/yandex-module.js'), 'utf8');

const store = {};
const noElement = { isConnected: false, scrollHeight: 0, clientHeight: 0, style: {}, className: '',
  querySelector: () => null, querySelectorAll: () => [], appendChild() {}, append() {}, remove() {},
  addEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0 }), attachShadow: () => noElement };
const document = {
  body: noElement, head: noElement, documentElement: noElement,
  getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
  createElement: () => ({ ...noElement }), addEventListener() {},
};
const sandbox = {
  console, setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {}, Promise, URL, Date, Math, JSON, Number, String, Array, Object, Set, Map, Error, isFinite, parseInt, parseFloat,
  document,
  location: { hostname: 'yandex.ru', pathname: '/maps/213/moscow/search/test/', href: 'https://yandex.ru/maps/213/moscow/search/test/', origin: 'https://yandex.ru', search: '', assign() {} },
  window: { addEventListener() {}, innerWidth: 1600 },
  navigator: { userAgent: 'node' },
  MutationObserver: class { observe() {} disconnect() {} },
  Blob: class {}, URL_createObjectURL: () => '',
  getComputedStyle: () => ({ overflowY: 'visible' }),
  chrome: {
    runtime: { getURL: p => p, sendMessage() {}, lastError: null },
    storage: { local: {
      async get(keys) { const out = {}; for (const k of [].concat(keys)) if (k in store) out[k] = store[k]; return out; },
      async set(obj) { Object.assign(store, obj); },
      async remove(k) { delete store[k]; },
    } },
  },
};
sandbox.globalThis = sandbox;
sandbox.self = sandbox;
vm.createContext(sandbox);

// The module is an IIFE with no exports; expose its internals for testing by
// running it with a probe appended inside the same closure.
const probe = `
globalThis.__test = {
  parseRawCsv, parseBatchCsv, normalizeCoords, detectGeoDistrict, categoryMatch,
  stableKey, placeIdFromUrl, ensureGeo, evaluateItem, sourceRecords,
};
`;
const patched = src.replace(/\n\s*void ensureGeo\(\)[\s\S]*?\n\s*restore\(\);mount\(\);/, `\n${probe}\n`);
if (patched === src) throw new Error('could not neutralise module bootstrap for testing');
vm.runInContext(patched, sandbox);

const t = sandbox.__test;
let failures = 0;
const check = (name, cond, detail = '') => {
  if (cond) console.log(`ok   ${name}`);
  else { failures++; console.log(`FAIL ${name} ${detail}`); }
};

// --- place_id dedupe key ----------------------------------------------------
check('place_id parsed from org url',
  t.placeIdFromUrl('https://yandex.ru/maps/org/shtolle/1175665694/') === '1175665694');
check('place_id is the dedupe key',
  t.stableKey({ place_id: '123456', title: 'a' }) === 'id:123456');

// --- coordinate normalisation ----------------------------------------------
const swapped = t.normalizeCoords({ latitude: 37.572078, longitude: 55.687149 });
check('legacy swapped lat/lon is repaired',
  Math.round(swapped.latitude * 1e4) === 556871 && swapped._coords_swapped === true,
  JSON.stringify(swapped));
const sane = t.normalizeCoords({ latitude: 55.687149, longitude: 37.572078 });
check('correct lat/lon is left alone', sane.latitude === 55.687149 && sane._coords_swapped === false);

// --- batch query CSV --------------------------------------------------------
const queue = t.parseBatchCsv('district;group;category;query\nАкадемический;Общепит;Ресторан;рестораны Академический район Москва\n');
check('batch CSV parsed', queue.length === 1 && queue[0].category === 'Ресторан', JSON.stringify(queue));

// --- RAW CSV round trip -----------------------------------------------------
const rawCsv = [
  'source_district,source_group,source_category,title,address,phone,website,maps_url,source,source_query,source_queries_count,source_records,place_id,categories,rating,review_count,latitude,longitude',
  '"Академический","Общепит","Ресторан","Штолле","Профсоюзная ул., 4","+74956444045","https://x","https://yandex.ru/maps/org/shtolle/1175665694/","yandex_maps","рестораны Академический район Москва","1","[{""district"":""Академический"",""group"":""Общепит"",""category"":""Ресторан"",""query"":""рестораны Академический район Москва""}]","1175665694","Пекарня, ресторан, кафе","4.5","1060","55.687149","37.572078"',
  '"Академический","Общепит","Ресторан","Штолле","Профсоюзная ул., 4","+74956444045","https://x","https://yandex.ru/maps/org/shtolle/1175665694/","yandex_maps","кафе Академический район Москва","1","[{""district"":""Академический"",""group"":""Общепит"",""category"":""Кафе"",""query"":""кафе Академический район Москва""}]","1175665694","Пекарня, ресторан, кафе","4.5","1060","55.687149","37.572078"',
].join('\r\n');
const raw = t.parseRawCsv(rawCsv);
check('RAW import dedupes by place_id', raw.data.length === 1, `got ${raw.data.length}`);
check('RAW import keeps both source records', t.sourceRecords(raw.data[0]).length === 2,
  JSON.stringify(raw.data[0].source_records));
check('RAW import rebuilds the query queue', raw.queue.length === 2, `got ${raw.queue.length}`);
check('RAW import reports source hits', raw.sourceHits === 2, `got ${raw.sourceHits}`);

// --- extra export columns must not break re-import --------------------------
const withMeta = rawCsv.replace('source_queries_count,', 'export_batch_status,export_warnings,source_queries_count,')
  .replace(/"yandex_maps","(рестораны|кафе) Академический район Москва",/g, '"yandex_maps","$1 Академический район Москва","STOPPED","",');
check('RAW import tolerates the new export columns', t.parseRawCsv(withMeta).data.length === 1);

// --- category matching ------------------------------------------------------
check('restaurant category matches', t.categoryMatch('Ресторан', 'Пекарня, ресторан, кафе') === true);
check('restaurant category rejects a shop', t.categoryMatch('Ресторан', 'Магазин продуктов') === false);
check('unknown category stays UNKNOWN', t.categoryMatch('Ночной клуб', 'Ресторан') === null);

// --- offline geo ------------------------------------------------------------
const geo = await t.ensureGeo();
check('boundaries load offline', geo.source.startsWith('embedded:'), geo.source);
check('boundary quality is measured', typeof geo.quality?.ambiguousPercent === 'number', JSON.stringify(geo.quality));

const akademicheskiy = await t.detectGeoDistrict({ latitude: 55.6875, longitude: 37.5730 });
check('regression probe -> Академический',
  akademicheskiy.district === 'Академический' && akademicheskiy.quality === 'EXACT', JSON.stringify(akademicheskiy));

const noCoords = await t.detectGeoDistrict({ latitude: '', longitude: '' });
check('missing coordinates are NO_COORDINATES, not a district mismatch',
  noCoords.valid === false && noCoords.quality === 'NO_COORDINATES');

const overlap = await t.detectGeoDistrict({ latitude: 55.6062, longitude: 37.5337 }); // м. Ясенево, overlapping outlines
check('overlapping outlines resolve to one district instead of dropping the org',
  overlap.district !== null && overlap.quality === 'AMBIGUOUS' && overlap.candidates.length > 1,
  JSON.stringify(overlap));

const farAway = await t.detectGeoDistrict({ latitude: 55.9000, longitude: 37.4000 });
check('a point outside ЮЗАО is OUTSIDE', farAway.district === null && farAway.quality === 'OUTSIDE');

// --- evaluateItem honesty ---------------------------------------------------
const accepted = await t.evaluateItem(
  { latitude: 55.6875, longitude: 37.5730, categories: 'Ресторан, бар' },
  { district: 'Академический', group: 'Общепит', category: 'Ресторан', query: 'q' });
check('matching org is accepted with real validations',
  accepted.accept && accepted.categoryValidation === 'MATCH' && accepted.districtValidation === 'MATCH',
  JSON.stringify(accepted));

const noGeo = await t.evaluateItem(
  { latitude: '', longitude: '', categories: 'Ресторан' },
  { district: 'Академический', group: 'Общепит', category: 'Ресторан', query: 'q' });
check('org without coordinates is NO_COORDINATES, not a district mismatch',
  !noGeo.accept && noGeo.districtValidation === 'NO_COORDINATES', JSON.stringify(noGeo));

const noQueryContext = await t.evaluateItem({ latitude: 55.6875, longitude: 37.5730, categories: 'Ресторан' },
  { district: '', group: '', category: '', query: 'свободный запрос' });
check('a query without district/category yields UNKNOWN, never a fake MATCH',
  noQueryContext.accept && noQueryContext.categoryValidation === 'UNKNOWN' && noQueryContext.districtValidation === 'UNKNOWN',
  JSON.stringify(noQueryContext));

console.log(`\n${failures ? `${failures} FAILURES` : 'all checks passed'}`);
process.exit(failures ? 1 : 0);
