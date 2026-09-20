// Extracts organisation entities out of whatever JSON Yandex Maps already
// loaded for itself - the `state-view` script embedded in the search page and
// the responses the SPA fetches as the list is scrolled.
//
// This file is compiled into both the content script and the page-world hook,
// which live in different realms, so it must not depend on either.
//
// Nothing here issues a request. The point of the fast path is to read data the
// browser has already received, instead of fetching one org page per card.
;(() => {
  // Field mapping mirrors the upstream org-page extractor
  // (`window.__glsYandexFetch` in vendor/mapscan-content.iife.js) so that a row
  // collected the fast way is indistinguishable from one collected the slow
  // way. Including its coordinate convention: upstream reads
  // `coordinates[0]` as latitude, and normalizeCoords() repairs the pair
  // afterwards. Matching it keeps both paths feeding the same repair.
  const asItem = entity => {
    const id = `${entity.id}`;
    if (!/^\d{5,}$/.test(id)) return null;
    const [first = 0, second = 0] = entity.coordinates || [];
    const rating = entity?.ratingData?.ratingValue;
    return {
      place_id: id,
      title: entity.title,
      address: entity.address || undefined,
      latitude: first,
      longitude: second,
      rating: typeof rating === 'number' ? parseFloat(rating.toFixed(2)) : undefined,
      review_count: entity?.ratingData?.ratingCount || undefined,
      opening_hours: entity?.workingTimeText ? String(entity.workingTimeText).replace(/\n/g, ',') : undefined,
      photos: typeof entity?.photos?.count === 'number' ? entity.photos.count : undefined,
      categories: Array.isArray(entity?.categories) ? entity.categories.map(c => c?.name).filter(Boolean).join(', ') : undefined,
      labels: Array.isArray(entity?.features) ? entity.features.map(f => f?.name).filter(Boolean).join(', ') : undefined,
      street: entity?.compositeAddress?.street || undefined,
      website: Array.isArray(entity?.urls) ? entity.urls[0] : undefined,
      phone: Array.isArray(entity?.phones) ? entity.phones[0]?.value : undefined,
      socials: Array.isArray(entity?.socialLinks) ? entity.socialLinks.map(s => s?.href).filter(Boolean).join(', ') : undefined,
      seoname: typeof entity?.seoname === 'string' ? entity.seoname : undefined,
    };
  };

  // Recognised by shape rather than by path: Yandex moves these objects around
  // between the search page, the org page and its XHR payloads, and a hardcoded
  // path would break silently. A shape test degrades to "found nothing", which
  // sends the collector back to the per-card fetch.
  const looksLikeOrg = value =>
    !!value && typeof value === 'object' && !Array.isArray(value)
    && (typeof value.id === 'string' || typeof value.id === 'number')
    && typeof value.title === 'string' && value.title.trim().length > 0
    && Array.isArray(value.coordinates) && value.coordinates.length >= 2
    && Number.isFinite(value.coordinates[0]) && Number.isFinite(value.coordinates[1]);

  const MAX_DEPTH = 24;
  const collect = (value, out, seen, depth) => {
    if (depth > MAX_DEPTH || !value || typeof value !== 'object') return;
    if (seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) { for (const v of value) collect(v, out, seen, depth + 1); return; }
    if (looksLikeOrg(value)) {
      const item = asItem(value);
      if (item && !out.has(item.place_id)) out.set(item.place_id, item);
      // Keep walking: an entity can carry nested ones (chains, branches).
    }
    for (const v of Object.values(value)) collect(v, out, seen, depth + 1);
  };

  const fromJson = json => {
    const out = new Map();
    try { collect(json, out, new WeakSet(), 0); } catch { /* malformed payload: fall back */ }
    return [...out.values()];
  };

  const fromText = text => {
    if (typeof text !== 'string' || text.length < 32) return [];
    // Cheap reject before paying for a parse of a large response.
    if (!text.includes('"coordinates"') || !text.includes('"title"')) return [];
    try { return fromJson(JSON.parse(text)); } catch { return []; }
  };

  globalThis.GLSEntities = { fromJson, fromText, asItem, looksLikeOrg };
})();

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

  const post = entities => {
    if (!entities.length) return;
    try { window.postMessage({ __glsEntities: entities }, '*'); } catch { /* ignore */ }
  };

  const harvest = text => {
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
