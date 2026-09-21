// Loads the extension's own scripts into this process with a minimal
// browser/chrome shim, so the content module and the storage service worker can
// be exercised end to end without Chrome. Used by smoke-test.mjs and
// analyze-raw.mjs.
//
// The scripts are plain (non-module) sources, so they are run with indirect
// eval in the real global scope rather than inside a vm context: IndexedDB
// values must not cross realms, or structured cloning rejects them.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = p => readFileSync(join(root, p), 'utf8');

const element = {
  isConnected: false, scrollHeight: 0, clientHeight: 0, style: {}, className: '', dataset: {},
  querySelector: () => null, querySelectorAll: () => [], appendChild() {}, append() {}, remove() {},
  addEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0 }),
  get attachShadow() { return () => element; },
};

export async function loadExtension({ withStore = false } = {}) {
  const storage = {};
  const listeners = [];

  // Import the IndexedDB polyfill before the DOM shim exists: it installs onto
  // `window` when it finds one, and our `window` is a stub the store cannot see.
  if (withStore) {
    await import('fake-indexeddb/auto');
    if (typeof globalThis.indexedDB === 'undefined') throw new Error('fake-indexeddb did not install');
  }

  globalThis.document = {
    body: element, head: element, documentElement: element,
    getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
    createElement: () => ({ ...element }), addEventListener() {},
  };
  globalThis.location = {
    hostname: 'yandex.ru', pathname: '/maps/213/moscow/search/test/',
    href: 'https://yandex.ru/maps/213/moscow/search/test/', origin: 'https://yandex.ru',
    search: '', searchParams: new URLSearchParams(),
    // Records navigations and lets a test emulate what Yandex actually does to
    // the URL, including rewriting the query.
    navigations: [],
    assign(url) {
      this.navigations.push(url);
      const rewritten = globalThis.__rewriteQuery ? globalThis.__rewriteQuery(url) : url;
      const u = new URL(rewritten);
      this.href = rewritten; this.pathname = u.pathname; this.search = u.search;
    },
  };
  const windowListeners = {};
  globalThis.window = {
    innerWidth: 1600,
    addEventListener(type, fn) { (windowListeners[type] ||= []).push(fn); },
    postMessage(data) { for (const fn of windowListeners.message || []) fn({ source: globalThis.window, data }); },
  };
  globalThis.MutationObserver = class { observe() {} disconnect() {} };
  globalThis.getComputedStyle = () => ({ overflowY: 'visible' });
  globalThis.chrome = {
    runtime: {
      getURL: p => p,
      lastError: null,
      onMessage: { addListener: fn => listeners.push(fn) },
      // Mirrors Chrome closely enough to catch a handler that forgets to keep
      // the message port open: a listener that does not return true and does
      // not answer synchronously leaves the caller without a response.
      sendMessage(message, callback) {
        let answered = false;
        const respond = response => { if (!answered) { answered = true; callback?.(response); } };
        let kept = false;
        for (const listener of listeners) if (listener(message, {}, respond) === true) kept = true;
        if (!kept && !answered) respond(undefined);
      },
    },
    storage: { local: {
      async get(keys) { const out = {}; for (const k of [].concat(keys)) if (k in storage) out[k] = structuredClone(storage[k]); return out; },
      async set(obj) { Object.assign(storage, structuredClone(obj)); },
      async remove(keys) { for (const k of [].concat(keys)) delete storage[k]; },
    } },
  };

  const run = src => (0, eval)(src);
  run(read('src/shared-record.js'));
  run(read('src/shared-entities.js'));

  if (withStore) run(read('src/store-worker.js'));

  // Replace the module's bootstrap with a probe that publishes its internals.
  const module_ = read('src/yandex-module.js').replace(
    /\n\s*void ensureGeo\(\)[\s\S]*?\n\s*restore\(\);mount\(\);/,
    `\nglobalThis.__gls = {
      parseRawCsv, parseBatchCsv, parseDelimited, normalizeCoords, detectGeoDistrict, categoryMatch,
      placeIdFromUrl, ensureGeo, evaluateItem, store, storeTotals, eachStored,
      loadRawText, filterBatch, resetBatch, restore, migrateLegacyDataset,
      stopFilter, needsCardData, seedFromDocument, rememberEntities,
      runBatchCurrent, startBatch, loadBatchText, looseQuery,
      setBatch: b => { batch = { ...batch, ...b }; },
      setGeoCache: c => { geoCache = c; },
      buildGeoCache, embeddedGeo,
      getListEntities: () => listEntities,
      getBatch: () => batch, getState: () => state, STORE_PAGE,
    };\n`);
  if (!module_.includes('globalThis.__gls')) throw new Error('could not neutralise the module bootstrap for testing');
  // The module starts a 1s UI ticker at load time. Under Node that is a real
  // timer and would keep the process alive forever, so neutralise it while the
  // module is being evaluated.
  const realSetInterval = globalThis.setInterval;
  globalThis.setInterval = () => 0;
  try { run(module_); } finally { globalThis.setInterval = realSetInterval; }

  return {
    api: globalThis.__gls,
    shared: globalThis.GLSRecord,
    entities: globalThis.GLSEntities,
    storage,
    // Simulates the page-world hook posting into the content script.
    postFromPage: data => globalThis.window.postMessage(data),
    setDocumentStateView: text => { globalThis.document.querySelector = sel => String(sel).includes('state-view') ? { textContent: text } : null; },
    setCardFetcher: fn => { globalThis.window.__glsYandexFetch = fn; },
  };
}
