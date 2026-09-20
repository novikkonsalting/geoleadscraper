#!/usr/bin/env node
// Measures what the storage change actually buys, on this machine.
//
// v1.4.x wrote the whole registry into a chrome.storage.local key after every
// card, so the cost of collecting n cards grows as O(n²). v1.5.0 writes one
// record per card into IndexedDB. This compares the two on the same rows.
//   node tools/bench-store.mjs [rows]
import { loadExtension } from './harness.mjs';

const TOTAL = Number(process.argv[2] || 4000);
const card = i => ({
  place_id: String(1000000 + i),
  title: `Организация ${i}`,
  address: `ул. Тестовая, ${i}, Москва`,
  phone: `+7495${String(1000000 + i).slice(-7)}`,
  website: `https://example-${i}.ru/`,
  maps_url: `https://yandex.ru/maps/org/test/${1000000 + i}/`,
  categories: 'Ресторан, бар, кафе',
  latitude: 55.68 + (i % 100) / 10000,
  longitude: 37.56 + (i % 100) / 10000,
  opening_hours: 'ежедневно, 08:00–22:00',
  labels: 'доставка, Wi-Fi, парковка, средний счёт, кухня, тип заведения',
  socials: 'https://t.me/example, https://vk.ru/example',
});

const { api } = await loadExtension({ withStore: true });
const record = { district: 'Академический', group: 'Общепит', category: 'Ресторан', query: 'рестораны Академический район Москва' };
const rows = Array.from({ length: TOTAL }, (_, i) => card(i));
const sizeOf = value => JSON.stringify(value).length;

console.log(`rows: ${TOTAL}, ~${Math.round(sizeOf(card(0)) / 100) / 10} KB each\n`);

// --- v1.4.x: the dataset rides inside one chrome.storage key ----------------
// chrome.storage.local serialises the value on every set; this measures that
// serialisation, which is the part that grows with the dataset.
let snapshot = { status: 'RUNNING', queue: [], data: [], cardCache: {} };
let legacyBytes = 0;
const legacyStart = process.hrtime.bigint();
for (let i = 0; i < TOTAL; i++) {
  snapshot = { ...snapshot, data: [...snapshot.data, rows[i]] };
  snapshot.cardCache[rows[i].place_id] = rows[i];
  legacyBytes += sizeOf(snapshot);
}
const legacyMs = Number(process.hrtime.bigint() - legacyStart) / 1e6;

// --- v1.5.0: one put per card into IndexedDB --------------------------------
await api.store('clearRaw');
const idbStart = process.hrtime.bigint();
for (let i = 0; i < TOTAL; i++) await api.store('putRaw', { records: [rows[i]], record });
const idbMs = Number(process.hrtime.bigint() - idbStart) / 1e6;
const totals = await api.storeTotals();

const gb = bytes => `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
console.log(`v1.4.x full-snapshot writes : ${legacyMs.toFixed(0).padStart(7)} ms, ${gb(legacyBytes)} serialised`);
console.log(`v1.5.0 IndexedDB per record : ${idbMs.toFixed(0).padStart(7)} ms, ${totals.uniqueCount} rows stored`);
console.log(`\nper-card cost at the end of the run:`);
console.log(`  v1.4.x  ${(sizeOf(snapshot) / 1024).toFixed(0)} KB serialised per card, and growing`);
console.log(`  v1.5.0  ${(sizeOf(rows[0]) / 1024).toFixed(1)} KB written per card, flat`);
console.log(`\nspeedup on this run: ${(legacyMs / idbMs).toFixed(1)}×  (the gap widens with the dataset: the left column is O(n²), the right is O(n))`);
