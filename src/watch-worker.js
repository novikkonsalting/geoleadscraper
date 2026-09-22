// Keeps an unattended batch alive across a renderer crash.
//
// A Yandex Maps tab that runs out of memory goes white: the page is gone, the
// batch was never paused, and nothing inside the page can notice, because there
// is no page left to notice with. The service worker can. The content script
// sends a heartbeat while a batch is collecting; a tab that stops sending one
// is reloaded, and the content script picks the queue up again on load. An
// overnight run then survives a crash instead of waiting until morning for
// someone to press reload.
//
// It never reloads a page that is waiting for a person. A CAPTCHA or an access
// check puts the collector into USER_ACTION_REQUIRED, the heartbeat says so,
// and such a tab is left exactly as it is - reloading it would be answering a
// check that is addressed to the user, not to us.
;(() => {
  const KEY = 'gls_tab_watch_v1';
  const ALARM = 'gls-tab-watch';
  // Two minutes of silence from a tab that was collecting. A healthy page
  // reports every fifteen seconds, and a slow cycle is seconds, not minutes.
  const SILENT_MS = 120000;
  // A reload that did not help must not turn into a reload loop.
  const COOLDOWN_MS = 180000;
  const MAX_RELOADS = 40;
  const FORGET_MS = 3600000;

  const read = async () => {
    try { const s = await chrome.storage.local.get(KEY); return s?.[KEY] && typeof s[KEY] === 'object' ? s[KEY] : {}; }
    catch { return {}; }
  };
  const write = async state => { try { await chrome.storage.local.set({ [KEY]: state }); } catch {} };

  // Every update is read-modify-write on one storage key, so two of them at the
  // same time lose one another's changes - and losing a tab's entry is exactly
  // the case this file exists for. One chain, one writer at a time.
  let chain = Promise.resolve();
  const serialize = task => { const next = chain.then(task, task); chain = next.catch(() => {}); return next; };

  const note = (tabId, payload = {}) => serialize(async () => {
    if (!tabId && tabId !== 0) return;
    const state = await read(), now = Date.now(), prev = state[tabId] || {};
    // A heartbeat arriving well after a reload means the page came back on its
    // own feet, so the reload budget starts over.
    const recovered = prev.lastReload && now - prev.lastReload > 20000;
    state[tabId] = {
      at: now,
      batchRunning: !!payload.batchRunning,
      autoStatus: payload.autoStatus || '',
      query: payload.query || '',
      reloads: recovered ? 0 : (prev.reloads || 0),
      lastReload: prev.lastReload || 0,
    };
    await write(state);
  });

  const sweep = () => serialize(async () => {
    const state = await read(), now = Date.now();
    let changed = false;
    for (const [id, entry] of Object.entries(state)) {
      if (!entry || (!entry.batchRunning && now - (entry.at || 0) > FORGET_MS)) { delete state[id]; changed = true; continue; }
      if (!entry.batchRunning) continue;
      if (entry.autoStatus === 'USER_ACTION_REQUIRED') continue;
      if (now - entry.at < SILENT_MS) continue;
      if (now - (entry.lastReload || 0) < COOLDOWN_MS) continue;
      if ((entry.reloads || 0) >= MAX_RELOADS) continue;
      const tabId = Number(id);
      try {
        await chrome.tabs.get(tabId);
        await chrome.tabs.reload(tabId);
        console.log('[GLS WATCH] tab reloaded after', Math.round((now - entry.at) / 1000), 's without a heartbeat', { tabId, query: entry.query });
        // at:now buys the page the same silence window to come back before the
        // next reload is even considered.
        state[id] = { ...entry, at: now, lastReload: now, reloads: (entry.reloads || 0) + 1 };
      } catch { delete state[id]; }
      changed = true;
    }
    if (changed) await write(state);
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.type !== 'GLS_ALIVE') return;
    note(sender?.tab?.id, message.payload || {})
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  });

  try {
    chrome.alarms.create(ALARM, { periodInMinutes: 1 });
    // Returning the promise: Chrome ignores it, but it is what lets a test wait
    // for the sweep instead of racing it.
    chrome.alarms.onAlarm.addListener(alarm => alarm.name === ALARM ? sweep().catch(() => {}) : undefined);
  } catch {}

  globalThis.GLSWatch = { note, sweep, read, write, KEY, SILENT_MS, COOLDOWN_MS, MAX_RELOADS };
})();
