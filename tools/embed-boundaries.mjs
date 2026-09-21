#!/usr/bin/env node
// Regenerates the LOCAL_GEO constant inside src/yandex-module.js from
// data/uzao_districts.geojson, so the outlines shipped in the extension are a
// build product of a reviewable data file rather than hand-typed numbers.
//   node tools/embed-boundaries.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fc = JSON.parse(readFileSync(join(root, 'data/uzao_districts.geojson'), 'utf8'));

const geo = {}, envelopes = {};
for (const feature of fc.features) {
  const name = feature.properties.name;
  geo[name] = feature.geometry;
  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
  const walk = value => {
    if (Array.isArray(value) && typeof value[0] === 'number') {
      minLon = Math.min(minLon, value[0]); maxLon = Math.max(maxLon, value[0]);
      minLat = Math.min(minLat, value[1]); maxLat = Math.max(maxLat, value[1]);
      return;
    }
    value.forEach(walk);
  };
  walk(feature.geometry.coordinates);
  // Padded a little: the envelope only sanity-checks an imported boundary set,
  // it must not be so tight that a slightly different rendering of the same
  // district fails the check.
  const pad = 0.01;
  envelopes[name] = {
    minLon: +(minLon - pad).toFixed(3), maxLon: +(maxLon + pad).toFixed(3),
    minLat: +(minLat - pad).toFixed(3), maxLat: +(maxLat + pad).toFixed(3),
  };
}

const modulePath = join(root, 'src/yandex-module.js');
let src = readFileSync(modulePath, 'utf8');

const replaceConst = (name, value) => {
  const start = src.indexOf(`  const ${name}=`);
  if (start < 0) throw new Error(`${name} not found in src/yandex-module.js`);
  const end = src.indexOf('\n', start);
  src = src.slice(0, start) + `  const ${name}=${JSON.stringify(value)};` + src.slice(end);
};

replaceConst('LOCAL_GEO', geo);
const envLines = Object.entries(envelopes)
  .map(([d, e]) => `    '${d}':{minLon:${e.minLon},maxLon:${e.maxLon},minLat:${e.minLat},maxLat:${e.maxLat}}`)
  .join(',\n');
const envStart = src.indexOf('  const GEO_ENVELOPES={');
const envEnd = src.indexOf('\n  };', envStart) + 5;
src = src.slice(0, envStart) + `  const GEO_ENVELOPES={\n${envLines}\n  };` + src.slice(envEnd);

writeFileSync(modulePath, src, 'utf8');
const vertices = Object.values(geo).reduce((n, g) =>
  n + (g.type === 'Polygon' ? g.coordinates : g.coordinates.flat()).reduce((m, r) => m + r.length, 0), 0);
console.log(`embedded ${Object.keys(geo).length} districts, ${vertices} vertices, ${JSON.stringify(geo).length} bytes`);
