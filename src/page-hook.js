// Runs in the page's own world on Yandex Maps.
//
// Yandex Maps fetches its result list as JSON for itself. Those responses
// already contain everything the registry needs - name, address, coordinates,
// categories, phone, site - for about twenty organisations at a time. Reading
// them means the collector does not have to fetch one org page per card.
//
// This observes responses the page requested on its own behalf. It issues no
// requests, changes no requests, and never blocks or alters what the page
// receives: fetch responses are cloned, XHR is read from an extra listener.
// Every failure path falls through to the original behaviour, so the worst case
// is that the collector learns nothing here and fetches cards as before.
;(() => {
  if (window.__glsPageHookInstalled) return;
  window.__glsPageHookInstalled = true;

  // One page load serves one query, so there is a natural ceiling on how much
  // is worth reading. Past it the hook stops parsing entirely, which keeps a
  // long batch from spending the whole run in JSON.parse.
  const HARVEST_BUDGET = 8000;
  let harvested = 0;

  const post = entities => {
    if (!entities.length) return;
    harvested += entities.length;
    try { window.postMessage({ __glsEntities: entities }, '*'); } catch { /* ignore */ }
  };

  const harvest = text => {
    if (harvested >= HARVEST_BUDGET) return;
    try { post(globalThis.GLSEntities.fromText(text)); } catch { /* ignore */ }
  };

  // --- fetch ---------------------------------------------------------------
  const originalFetch = window.fetch;
  if (typeof originalFetch === 'function') {
    window.fetch = function (...args) {
      const result = originalFetch.apply(this, args);
      try {
        result.then(response => {
          try {
            const type = response.headers?.get?.('content-type') || '';
            if (!/json|javascript|text/i.test(type)) return;
            // Skip anything too big to be a result list. Cloning and reading a
            // multi-megabyte map payload is what made long runs exhaust memory.
            const length = Number(response.headers?.get?.('content-length') || 0);
            if (length > globalThis.GLSEntities.MAX_TEXT_BYTES) return;
            // clone() so the page still reads the body itself.
            response.clone().text().then(harvest, () => {});
          } catch { /* ignore */ }
        }, () => {});
      } catch { /* ignore */ }
      return result;
    };
  }

  // --- XMLHttpRequest ------------------------------------------------------
  const originalSend = XMLHttpRequest.prototype.send;
  if (typeof originalSend === 'function') {
    XMLHttpRequest.prototype.send = function (...args) {
      try {
        this.addEventListener('load', () => {
          try {
            if (this.responseType && this.responseType !== 'text' && this.responseType !== 'json') return;
            if (this.responseType === 'json') harvest(JSON.stringify(this.response));
            else harvest(this.responseText);
          } catch { /* ignore */ }
        });
      } catch { /* ignore */ }
      return originalSend.apply(this, args);
    };
  }

  window.postMessage({ __glsPageHookReady: true }, '*');
})();
