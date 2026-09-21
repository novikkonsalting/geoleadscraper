#!/usr/bin/env node
// Repairs an export written by v1.9.0, where rows topped up with a card card
// carried latitude and longitude the wrong way round. Rewrites only the rows
// that are actually swapped and leaves everything else byte-identical.
//   node tools/fix-swapped-coords.mjs <export.csv> [output.csv]
import { readFileSync, writeFileSync } from 'node:fs';

const input = process.argv[2];
if (!input) { console.error('usage: node tools/fix-swapped-coords.mjs <export.csv> [output.csv]'); process.exit(2); }
const output = process.argv[3] || input.replace(/\.csv$/i, '') + '-fixed.csv';

const text = readFileSync(input, 'utf8');
const bom = text.startsWith('\uFEFF') ? '\uFEFF' : '';
const body = bom ? text.slice(1) : text;

// Minimal CSV walk: the only thing being changed is two numeric cells per row.
const rows = [];
let row = [], cell = '', quoted = false;
for (let i = 0; i < body.length; i++) {
  const ch = body[i];
  if (quoted) {
    if (ch === '"' && body[i + 1] === '"') { cell += '""'; i++; }
    else if (ch === '"') { quoted = false; cell += ch; }
    else cell += ch;
    continue;
  }
  if (ch === '"') { quoted = true; cell += ch; }
  else if (ch === ',') { row.push(cell); cell = ''; }
  else if (ch === '\r' && body[i + 1] === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; }
  else if (ch === '\n' || ch === '\r') { row.push(cell); rows.push(row); row = []; cell = ''; }
  else cell += ch;
}
if (cell.length || row.length) { row.push(cell); rows.push(row); }

const headers = rows[0].map(h => h.replace(/^"|"$/g, '').trim());
const la = headers.indexOf('latitude'), lo = headers.indexOf('longitude');
if (la < 0 || lo < 0) { console.error('В файле нет колонок latitude/longitude.'); process.exit(1); }

const num = v => Number(String(v).replace(/^"|"$/g, '').replace(',', '.'));
let fixed = 0;
for (const r of rows.slice(1)) {
  if (r.length <= Math.max(la, lo)) continue;
  const a = num(r[la]), b = num(r[lo]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
  // Moscow: latitude ≈55.x, longitude ≈37.x. Only the inverted pair is touched.
  if (a >= 36 && a <= 39.5 && b >= 54.5 && b <= 57) { [r[la], r[lo]] = [r[lo], r[la]]; fixed++; }
}

writeFileSync(output, bom + rows.map(r => r.join(',')).join('\r\n'), 'utf8');
console.log(`исправлено строк: ${fixed} из ${rows.length - 1}`);
console.log(`записано: ${output}`);
