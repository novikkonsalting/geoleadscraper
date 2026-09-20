#!/usr/bin/env node
// Audits a GeoLeadScraper RAW or FINAL CSV export: row/place_id counts, source
// provenance, field completeness, coordinate sanity and - for RAW files - what
// the local filter would accept, using the extension's own classifier.
//   node tools/analyze-raw.mjs <export.csv>
import { readFileSync } from 'node:fs';
import { loadExtension } from './harness.mjs';

const file = process.argv[2];
if (!file) { console.error('usage: node tools/analyze-raw.mjs <export.csv>'); process.exit(2); }

// No store needed: the audit only uses the pure parsing and classification.
const { api: t } = await loadExtension();

const text = readFileSync(file, 'utf8');
const rows = t.parseDelimited(text);
const headers = rows[0].map(h => h.replace(/^﻿/, '').trim());
const body = rows.slice(1);
const col = name => headers.indexOf(name);
const get = (row, name) => { const i = col(name); return i < 0 ? '' : String(row[i] ?? '').trim(); };
const isFinal = headers.includes('final_status') || headers.includes('matched_source_query');

console.log(`file: ${file}`);
console.log(`kind: ${isFinal ? 'FINAL (filtered)' : 'RAW'}`);
console.log(`rows: ${body.length}`);
console.log(`columns: ${headers.length}`);

const ids = body.map(r => get(r, 'place_id')).filter(Boolean);
const unique = new Set(ids);
console.log(`place_id: ${ids.length} filled, ${unique.size} unique, ${body.length - ids.length} empty`);
if (ids.length !== unique.size) {
  const seen = new Map();
  ids.forEach(id => seen.set(id, (seen.get(id) || 0) + 1));
  console.log(`  DUPLICATES: ${[...seen].filter(([, n]) => n > 1).map(([id, n]) => `${id}×${n}`).join(', ')}`);
}

let hits = 0;
const perQuery = new Map(), perDistrict = new Map(), perCategory = new Map();
for (const row of body) {
  let recs = [];
  try { recs = JSON.parse(get(row, 'source_records') || get(row, 'matched_source_records') || '[]'); } catch {}
  if (!Array.isArray(recs) || !recs.length) recs = [{ query: get(row, 'source_query'), district: get(row, 'source_district'), category: get(row, 'source_category') }];
  hits += recs.length;
  for (const r of recs) {
    perQuery.set(r.query || '—', (perQuery.get(r.query || '—') || 0) + 1);
    perDistrict.set(r.district || '—', (perDistrict.get(r.district || '—') || 0) + 1);
    perCategory.set(r.category || '—', (perCategory.get(r.category || '—') || 0) + 1);
  }
}
console.log(`source hits (organisation × query): ${hits}`);

const show = (title, map, limit = 15) => {
  console.log(`\n${title}`);
  [...map].sort((a, b) => b[1] - a[1]).slice(0, limit).forEach(([k, v]) => console.log(`  ${String(v).padStart(5)}  ${k}`));
  if (map.size > limit) console.log(`  … ещё ${map.size - limit}`);
};
show('source_query:', perQuery);
show('source_district (район запроса, не факт):', perDistrict);
show('source_category (категория запроса, не факт):', perCategory);

console.log('\nfield completeness:');
for (const f of ['title', 'address', 'phone', 'website', 'email', 'latitude', 'longitude', 'categories', 'opening_hours', 'rating', 'socials']) {
  if (col(f) < 0) continue;
  const n = body.filter(r => get(r, f)).length;
  console.log(`  ${f.padEnd(14)} ${String(n).padStart(5)} / ${body.length}  (${Math.round(n / body.length * 100)}%)`);
}

console.log('\ncoordinate sanity (Moscow: lat≈55.x, lon≈37.x):');
let bad = 0, swapped = 0, empty = 0;
for (const row of body) {
  const la = Number(get(row, 'latitude')), lo = Number(get(row, 'longitude'));
  if (!get(row, 'latitude') || !get(row, 'longitude')) { empty++; continue; }
  if (!Number.isFinite(la) || !Number.isFinite(lo)) { bad++; continue; }
  if (la >= 36 && la <= 39.5 && lo >= 54.5 && lo <= 57) { swapped++; continue; }
  if (!(la > 54.5 && la < 57 && lo > 36 && lo < 39.5)) bad++;
}
console.log(`  empty: ${empty}, swapped lat/lon: ${swapped}, outside the Moscow region: ${bad}`);

if (headers.includes('export_batch_status')) {
  console.log('\nrun provenance (v1.4.2+ exports):');
  for (const f of ['export_batch_status', 'export_queries_total', 'export_queries_completed', 'export_queries_low_yield', 'export_warnings']) {
    if (col(f) >= 0) console.log(`  ${f.padEnd(26)} ${get(body[0] || [], f) || '—'}`);
  }
} else if (!isFinal) {
  console.log('\nrun provenance: missing (exported by v1.4.1 or earlier - the file cannot say whether the batch finished).');
}

if (isFinal) {
  console.log('\nFINAL verdicts:');
  for (const f of ['final_status', 'category_validation', 'district_validation', 'district_quality', 'detected_district', 'exclude_reason']) {
    if (col(f) < 0) continue;
    const m = new Map();
    body.forEach(r => m.set(get(r, f) || '—', (m.get(get(r, f) || '—') || 0) + 1));
    console.log(`  ${f}: ${[...m].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(', ')}`);
  }
} else {
  const parsed = t.parseRawCsv(text);
  const geo = await t.ensureGeo();
  console.log(`\nlocal filter dry run (boundaries: ${geo.source}, ambiguous area ${geo.quality.ambiguousPercent}%):`);
  const stats = { accepted: 0, rejectedCategory: 0, rejectedDistrict: 0, rejectedNoCoords: 0, ambiguous: 0 };
  const detected = new Map();
  for (const item of parsed.data) {
    const recs = globalThis.GLSRecord.sourceRecords(item);
    const decisions = [];
    for (const r of recs) decisions.push(await t.evaluateItem(item, r));
    const ok = decisions.filter(d => d.accept);
    if (ok.length) {
      stats.accepted++;
      if (ok.some(d => d.districtQuality === 'AMBIGUOUS')) stats.ambiguous++;
      ok.forEach(d => { const k = d.detectedDistrict || '—'; detected.set(k, (detected.get(k) || 0) + 1); });
    } else if (decisions.some(d => d.districtValidation === 'NO_COORDINATES')) stats.rejectedNoCoords++;
    else if (decisions.some(d => d.categoryValidation !== 'MATCH')) stats.rejectedCategory++;
    else stats.rejectedDistrict++;
  }
  console.log(`  RAW unique: ${parsed.data.length}`);
  console.log(`  accepted:   ${stats.accepted} (район определён неоднозначно: ${stats.ambiguous})`);
  console.log(`  rejected — категория: ${stats.rejectedCategory}, район: ${stats.rejectedDistrict}, без координат: ${stats.rejectedNoCoords}`);
  show('  detected_district среди принятых:', detected);
}
