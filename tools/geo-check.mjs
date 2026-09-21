#!/usr/bin/env node
// Boundary QA for the district outlines used by FILTER RAW -> FINAL.
// Works on the outlines bundled in src/yandex-module.js (default) or on any
// GeoJSON FeatureCollection passed as an argument, so a candidate boundary set
// can be judged before it is imported into the extension.
//   node tools/geo-check.mjs [boundaries.geojson]
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DISTRICTS = ['Академический','Гагаринский','Зюзино','Коньково','Котловка','Ломоносовский','Обручевский','Северное Бутово','Тёплый Стан','Черёмушки','Южное Бутово','Ясенево'];

// The okrug's own area is a single well-known figure, unlike per-district
// areas, so the total is what gets checked. A district is only checked against
// a plausibility band.
const UZAO_AREA_KM2 = 111.3;
const DISTRICT_AREA_BAND = [1, 80];

// Ground truth, not recollection. These three probes were supplied by the
// project owner from real misclassifications; the rest are organisations from
// an actual Yandex export, on streets that sit squarely inside one district.
const PROBES = [
  { lat: 55.6875, lon: 37.5730, expected: 'Академический', note: 'контрольная точка проекта' },
  { lat: 55.644762, lon: 37.525993, forbidden: 'Академический', note: 'ложное попадание v1.3.2' },
  { lat: 55.647731, lon: 37.482145, forbidden: 'Академический', note: 'ложное попадание v1.3.2' },
  { lat: 55.687149, lon: 37.572078, expected: 'Академический', note: 'Штолле, Профсоюзная ул., 4' },
  { lat: 55.700545, lon: 37.578120, expected: 'Академический', note: 'Ривьера, просп. 60-летия Октября, 8А' },
  { lat: 55.679711, lon: 37.571931, expected: 'Академический', note: 'Гамбринус, ул. Кржижановского, 15к3' },
  { lat: 55.688449, lon: 37.573502, expected: 'Академический', note: 'Jolly leprechaun, просп. 60-летия Октября, 20' },
];

const rings = g => g.type === 'Polygon' ? g.coordinates : g.coordinates.flat();
const inRing = (x, y, ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j], b = ring[i];
    if ((b[1] > y) !== (a[1] > y)) {
      const cut = ((a[0] - b[0]) * (y - b[1])) / ((a[1] - b[1]) || Number.EPSILON) + b[0];
      if (x < cut) inside = !inside;
    }
  }
  return inside;
};
const inGeometry = (x, y, g) => {
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  return polys.some(p => p.length && inRing(x, y, p[0]) && !p.slice(1).some(h => inRing(x, y, h)));
};

const loadEmbedded = () => {
  const src = readFileSync(join(root, 'src/yandex-module.js'), 'utf8');
  const start = src.indexOf('const LOCAL_GEO=');
  const json = src.slice(src.indexOf('{', start), src.indexOf('\n', start));
  return JSON.parse(json.replace(/;\s*$/, ''));
};
const loadGeoJson = path => {
  const fc = JSON.parse(readFileSync(path, 'utf8'));
  const out = {};
  for (const f of fc.features || []) {
    const props = f.properties || {};
    const name = [props.NAME, props.name, props['name:ru'], props.district]
      .find(v => typeof v === 'string' && DISTRICTS.some(d => d.toLowerCase().replace(/ё/g, 'е') === v.toLowerCase().replace(/ё/g, 'е')));
    if (!name) continue;
    const district = DISTRICTS.find(d => d.toLowerCase().replace(/ё/g, 'е') === name.toLowerCase().replace(/ё/g, 'е'));
    if (district && !out[district] && f.geometry) out[district] = f.geometry;
  }
  return out;
};

const file = process.argv[2];
const geo = file ? loadGeoJson(file) : loadEmbedded();
console.log(`source: ${file || 'src/yandex-module.js (LOCAL_GEO)'}`);

const missing = DISTRICTS.filter(d => !geo[d]);
if (missing.length) {
  console.error(`MISSING districts: ${missing.join(', ')}`);
  process.exit(1);
}

const hits = (lat, lon) => DISTRICTS.filter(d => inGeometry(lon, lat, geo[d]));

console.log('\n== regression probes ==');
let probeFail = 0;
for (const p of PROBES) {
  const got = hits(p.lat, p.lon);
  const ok = p.expected ? (got.length === 1 && got[0] === p.expected) : !got.includes(p.forbidden);
  if (!ok) probeFail++;
  const want = p.expected ? `= ${p.expected}` : `≠ ${p.forbidden}`;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${want.padEnd(20)} -> [${got.join(', ') || 'вне ЮЗАО'}]   ${p.note}`);
}

console.log('\n== overlap / coverage (0.002° grid over the ЮЗАО bbox) ==');
let inside = 0, ambiguous = 0;
const pairs = new Map();
for (let lat = 55.47; lat <= 55.74; lat += 0.002) {
  for (let lon = 37.42; lon <= 37.68; lon += 0.002) {
    const got = hits(lat, lon);
    if (!got.length) continue;
    inside++;
    if (got.length > 1) {
      ambiguous++;
      const key = got.join(' × ');
      pairs.set(key, (pairs.get(key) || 0) + 1);
    }
  }
}
const pct = inside ? (ambiguous / inside * 100) : 0;
console.log(`claimed cells: ${inside}, claimed by 2+ districts: ${ambiguous} (${pct.toFixed(1)}%)`);
for (const [k, v] of [...pairs].sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v} cells`);

console.log('\n== area sanity ==');
const kmLat = 111.32;
let total = 0, areaFail = 0;
for (const d of DISTRICTS) {
  let a = 0, lats = [], n = 0;
  for (const ring of rings(geo[d])) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    for (const p of ring) { lats.push(p[1]); n++; }
  }
  const lat0 = lats.reduce((s, v) => s + v, 0) / n;
  const km = Math.abs(a / 2) * kmLat * (111.32 * Math.cos(lat0 * Math.PI / 180));
  total += km;
  const bad = km < DISTRICT_AREA_BAND[0] || km > DISTRICT_AREA_BAND[1];
  if (bad) areaFail++;
  console.log(`${bad ? 'WARN' : 'ok  '} ${d.padEnd(18)} ${km.toFixed(2).padStart(6)} km²`);
}
const totalOff = Math.abs(total - UZAO_AREA_KM2) / UZAO_AREA_KM2 * 100;
const totalBad = totalOff > 10;
if (totalBad) areaFail++;
console.log(`${totalBad ? 'WARN' : 'ok  '} ${'ВСЕГО'.padEnd(18)} ${total.toFixed(2).padStart(6)} km² против ≈${UZAO_AREA_KM2} km² у ЮЗАО (расхождение ${totalOff.toFixed(1)}%)`);

console.log(`\nsummary: probes ${PROBES.length - probeFail}/${PROBES.length}, ambiguous area ${pct.toFixed(1)}%, area warnings ${areaFail}`);
process.exit(probeFail || pct > 0.5 || areaFail ? 1 : 0);
