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

// Official district areas (km2), used only as an order-of-magnitude sanity check.
const OFFICIAL_AREA = {
  'Академический':5.6,'Гагаринский':7.5,'Зюзино':7.8,'Коньково':7.7,'Котловка':4.0,
  'Ломоносовский':4.6,'Обручевский':7.9,'Северное Бутово':10.0,'Тёплый Стан':9.1,
  'Черёмушки':5.9,'Южное Бутово':69.2,'Ясенево':17.0,
};

// Landmarks with an unambiguous district, used as accuracy probes.
const LANDMARKS = [
  ['м. Академическая', 55.6872, 37.5731, 'Академический'],
  ['м. Профсоюзная', 55.6775, 37.5625, 'Академический'],
  ['м. Университет', 55.6926, 37.5347, 'Гагаринский'],
  ['м. Новые Черёмушки', 55.6700, 37.5497, 'Черёмушки'],
  ['м. Калужская', 55.6556, 37.5401, 'Обручевский'],
  ['м. Беляево', 55.6425, 37.5261, 'Коньково'],
  ['м. Коньково', 55.6333, 37.5194, 'Коньково'],
  ['м. Тёплый Стан', 55.6187, 37.5074, 'Тёплый Стан'],
  ['м. Ясенево', 55.6062, 37.5337, 'Ясенево'],
  ['м. Новоясеневская', 55.6002, 37.5356, 'Ясенево'],
  ['м. Нахимовский проспект', 55.6650, 37.5836, 'Котловка'],
  ['м. Каховская', 55.6529, 37.6027, 'Зюзино'],
  ['м. Бульвар Дмитрия Донского', 55.5694, 37.5697, 'Северное Бутово'],
  ['м. Улица Скобелевская', 55.5495, 37.5432, 'Южное Бутово'],
  ['м. Бунинская аллея', 55.5399, 37.5136, 'Южное Бутово'],
  ['м. Ломоносовский проспект', 55.6807, 37.5142, 'Ломоносовский'],
];

// Regression probes carried over from v1.3.2 / v1.4.1.
const PROBES = [
  { lat: 55.6875, lon: 37.5730, expected: 'Академический' },
  { lat: 55.644762, lon: 37.525993, forbidden: 'Академический' },
  { lat: 55.647731, lon: 37.482145, forbidden: 'Академический' },
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
  const ok = p.expected ? got.includes(p.expected) : !got.includes(p.forbidden);
  if (!ok) probeFail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${p.lat},${p.lon} ${p.expected ? `expect ${p.expected}` : `forbid ${p.forbidden}`} -> [${got.join(', ') || '—'}]`);
}

console.log('\n== landmark accuracy ==');
let good = 0;
for (const [name, lat, lon, expected] of LANDMARKS) {
  const got = hits(lat, lon);
  const ok = got.length === 1 && got[0] === expected;
  if (ok) good++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name.padEnd(28)} expect ${expected.padEnd(17)} -> [${got.join(', ') || 'нет района'}]`);
}
console.log(`landmarks: ${good}/${LANDMARKS.length}`);

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
const kmLat = 111.32, kmLon = 111.32 * Math.cos(55.63 * Math.PI / 180);
let areaFail = 0;
for (const d of DISTRICTS) {
  let a = 0;
  for (const ring of rings(geo[d])) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  a = Math.abs(a / 2) * kmLat * kmLon;
  const ratio = a / OFFICIAL_AREA[d];
  if (ratio < 0.75 || ratio > 1.3) areaFail++;
  console.log(`${ratio < 0.75 || ratio > 1.3 ? 'WARN' : 'ok  '} ${d.padEnd(18)} ${a.toFixed(2).padStart(6)} km² vs official ≈${String(OFFICIAL_AREA[d]).padStart(5)} km²  ratio ${ratio.toFixed(2)}`);
}

console.log(`\nsummary: probes ${PROBES.length - probeFail}/${PROBES.length}, landmarks ${good}/${LANDMARKS.length}, ambiguous area ${pct.toFixed(1)}%, area warnings ${areaFail}`);
process.exit(probeFail ? 1 : 0);
