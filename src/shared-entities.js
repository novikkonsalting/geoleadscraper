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
  // Yandex Maps also fetches map data, which can be tens of megabytes of deeply
  // nested arrays. Walking that on the main thread is what freezes the tab, so
  // the walk is bounded and simply gives up on anything that large.
  const MAX_NODES = 200000;
  // A Yandex search payload carrying ~40 organisations is around 60 KB. Map and
  // tile payloads are orders of magnitude larger, and parsing them repeatedly
  // over an hour-long run is what pushes the tab towards a renderer crash.
  const MAX_TEXT_BYTES = 1024 * 1024;
  const collect = (value, out, seen, depth, budget) => {
    if (depth > MAX_DEPTH || !value || typeof value !== 'object') return;
    if (budget.left-- <= 0) return;
    if (seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) { for (const v of value) collect(v, out, seen, depth + 1, budget); return; }
    if (looksLikeOrg(value)) {
      const item = asItem(value);
      if (item && !out.has(item.place_id)) out.set(item.place_id, item);
      // Keep walking: an entity can carry nested ones (chains, branches).
    }
    for (const v of Object.values(value)) collect(v, out, seen, depth + 1, budget);
  };

  const fromJson = json => {
    const out = new Map();
    try { collect(json, out, new WeakSet(), 0, { left: MAX_NODES }); } catch { /* malformed payload: fall back */ }
    return [...out.values()];
  };

  const fromText = text => {
    if (typeof text !== 'string' || text.length < 32 || text.length > MAX_TEXT_BYTES) return [];
    // Cheap rejects before paying for a parse. A search payload names its
    // organisations; map data does not.
    if (!text.includes('"coordinates"') || !text.includes('"title"')) return [];
    try { return fromJson(JSON.parse(text)); } catch { return []; }
  };

  globalThis.GLSEntities = { fromJson, fromText, asItem, looksLikeOrg, MAX_TEXT_BYTES };
})();
