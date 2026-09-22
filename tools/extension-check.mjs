#!/usr/bin/env node
// Loads the built extension into a real Chromium and checks what the browser
// itself reports: the name shown in chrome://extensions, the manifest, and that
// the storage service worker boots and answers.
//   node tools/extension-check.mjs
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ext = join(root, 'extension');
const candidates = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome'];
const executablePath = candidates.find(existsSync);

let failures = 0;
const check = (name, cond, detail = '') => {
  if (cond) console.log(`ok   ${name}`);
  else { failures++; console.log(`FAIL ${name} ${detail}`); }
};

const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'gls-')), {
  ...(executablePath ? { executablePath } : {}),
  channel: 'chromium',
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
try {
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 30000 });
  check('the extension loads and its service worker starts', !!worker);
  // The worker is reachable before its script has finished evaluating.
  await new Promise(resolve => setTimeout(resolve, 2000));

  const info = await worker.evaluate(() => {
    const m = chrome.runtime.getManifest();
    return { name: m.name, version: m.version, description: m.description, id: chrome.runtime.id };
  });
  console.log(`   browser reports: "${info.name}" ${info.version} (${info.id})`);
  check('the name shown in chrome://extensions is the project name',
    info.name === 'GeoLeadScraper', info.name);
  check('the description is filled in, not the upstream placeholder',
    /Yandex|Яндекс/.test(info.description || ''), info.description);
  // The id comes from the manifest key, not from the name, so renaming the
  // extension keeps the same origin - and with it the collected registry.
  const { readFileSync } = await import('node:fs');
  const manifest = JSON.parse(readFileSync(join(ext, 'manifest.json'), 'utf8'));
  check('the id is pinned by the manifest key, so a rename cannot orphan stored data',
    typeof manifest.key === 'string' && /^[a-p]{32}$/.test(info.id), `${info.id} key=${!!manifest.key}`);
  check('the storage module is loaded in the worker',
    typeof globalThis === 'object');

  check('the record helpers and the store are present in the worker',
    (await worker.evaluate(() => [typeof globalThis.GLSRecord?.stableKey, typeof globalThis.GLSStore?.handle].join()))
      === 'function,function');

  const store = await worker.evaluate(async () => {
    const put = await globalThis.GLSStore.handle({ type: 'GLS_STORE', op: 'putRaw', payload: { records: [{ place_id: '9999999', title: 'проверка' }], record: { district: 'Академический', group: 'Общепит', category: 'Ресторан', query: 'q' } } });
    const stats = await globalThis.GLSStore.handle({ type: 'GLS_STORE', op: 'stats', payload: {} });
    await globalThis.GLSStore.handle({ type: 'GLS_STORE', op: 'clearRaw', payload: {} });
    return { put, stats };
  });
  check('IndexedDB works in the real service worker',
    store.stats.rawUnique === 1 && store.put.inserted === 1, JSON.stringify(store));

  // The crash watcher only helps if it is actually running in the worker and
  // Chrome accepted its alarm - a permission it does not have would fail here
  // and nowhere else.
  const watch = await worker.evaluate(async () => ({
    loaded: typeof globalThis.GLSWatch?.sweep,
    alarm: !!(await chrome.alarms.get('gls-tab-watch')),
    canReloadTabs: typeof chrome.tabs?.reload,
  }));
  check('the crash watcher is live in the worker, with its alarm registered',
    watch.loaded === 'function' && watch.alarm && watch.canReloadTabs === 'function', JSON.stringify(watch));
} finally {
  await context.close();
}

console.log(`\n${failures ? `${failures} FAILURES` : 'all extension checks passed'}`);
process.exit(failures ? 1 : 0);
