var R={exports:{}},X=R.exports,j;function V(){return j||(j=1,(function(s,r){(function(i,m){m(s)})(typeof globalThis<"u"?globalThis:typeof self<"u"?self:X,function(i){if(!(globalThis.chrome&&globalThis.chrome.runtime&&globalThis.chrome.runtime.id))throw new Error("This script should only be loaded in a browser extension.");if(globalThis.browser&&globalThis.browser.runtime&&globalThis.browser.runtime.id)i.exports=globalThis.browser;else{const m="The message port closed before a response was received.",u=o=>{const d={alarms:{clear:{minArgs:0,maxArgs:1},clearAll:{minArgs:0,maxArgs:0},get:{minArgs:0,maxArgs:1},getAll:{minArgs:0,maxArgs:0}},bookmarks:{create:{minArgs:1,maxArgs:1},get:{minArgs:1,maxArgs:1},getChildren:{minArgs:1,maxArgs:1},getRecent:{minArgs:1,maxArgs:1},getSubTree:{minArgs:1,maxArgs:1},getTree:{minArgs:0,maxArgs:0},move:{minArgs:2,maxArgs:2},remove:{minArgs:1,maxArgs:1},removeTree:{minArgs:1,maxArgs:1},search:{minArgs:1,maxArgs:1},update:{minArgs:2,maxArgs:2}},browserAction:{disable:{minArgs:0,maxArgs:1,fallbackToNoCallback:!0},enable:{minArgs:0,maxArgs:1,fallbackToNoCallback:!0},getBadgeBackgroundColor:{minArgs:1,maxArgs:1},getBadgeText:{minArgs:1,maxArgs:1},getPopup:{minArgs:1,maxArgs:1},getTitle:{minArgs:1,maxArgs:1},openPopup:{minArgs:0,maxArgs:0},setBadgeBackgroundColor:{minArgs:1,maxArgs:1,fallbackToNoCallback:!0},setBadgeText:{minArgs:1,maxArgs:1,fallbackToNoCallback:!0},setIcon:{minArgs:1,maxArgs:1},setPopup:{minArgs:1,maxArgs:1,fallbackToNoCallback:!0},setTitle:{minArgs:1,maxArgs:1,fallbackToNoCallback:!0}},browsingData:{remove:{minArgs:2,maxArgs:2},removeCache:{minArgs:1,maxArgs:1},removeCookies:{minArgs:1,maxArgs:1},removeDownloads:{minArgs:1,maxArgs:1},removeFormData:{minArgs:1,maxArgs:1},removeHistory:{minArgs:1,maxArgs:1},removeLocalStorage:{minArgs:1,maxArgs:1},removePasswords:{minArgs:1,maxArgs:1},removePluginData:{minArgs:1,maxArgs:1},settings:{minArgs:0,maxArgs:0}},commands:{getAll:{minArgs:0,maxArgs:0}},contextMenus:{remove:{minArgs:1,maxArgs:1},removeAll:{minArgs:0,maxArgs:0},update:{minArgs:2,maxArgs:2}},cookies:{get:{minArgs:1,maxArgs:1},getAll:{minArgs:1,maxArgs:1},getAllCookieStores:{minArgs:0,maxArgs:0},remove:{minArgs:1,maxArgs:1},set:{minArgs:1,maxArgs:1}},devtools:{inspectedWindow:{eval:{minArgs:1,maxArgs:2,singleCallbackArg:!1}},panels:{create:{minArgs:3,maxArgs:3,singleCallbackArg:!0},elements:{createSidebarPane:{minArgs:1,maxArgs:1}}}},downloads:{cancel:{minArgs:1,maxArgs:1},download:{minArgs:1,maxArgs:1},erase:{minArgs:1,maxArgs:1},getFileIcon:{minArgs:1,maxArgs:2},open:{minArgs:1,maxArgs:1,fallbackToNoCallback:!0},pause:{minArgs:1,maxArgs:1},removeFile:{minArgs:1,maxArgs:1},resume:{minArgs:1,maxArgs:1},search:{minArgs:1,maxArgs:1},show:{minArgs:1,maxArgs:1,fallbackToNoCallback:!0}},extension:{isAllowedFileSchemeAccess:{minArgs:0,maxArgs:0},isAllowedIncognitoAccess:{minArgs:0,maxArgs:0}},history:{addUrl:{minArgs:1,maxArgs:1},deleteAll:{minArgs:0,maxArgs:0},deleteRange:{minArgs:1,maxArgs:1},deleteUrl:{minArgs:1,maxArgs:1},getVisits:{minArgs:1,maxArgs:1},search:{minArgs:1,maxArgs:1}},i18n:{detectLanguage:{minArgs:1,maxArgs:1},getAcceptLanguages:{minArgs:0,maxArgs:0}},identity:{launchWebAuthFlow:{minArgs:1,maxArgs:1}},idle:{queryState:{minArgs:1,maxArgs:1}},management:{get:{minArgs:1,maxArgs:1},getAll:{minArgs:0,maxArgs:0},getSelf:{minArgs:0,maxArgs:0},setEnabled:{minArgs:2,maxArgs:2},uninstallSelf:{minArgs:0,maxArgs:1}},notifications:{clear:{minArgs:1,maxArgs:1},create:{minArgs:1,maxArgs:2},getAll:{minArgs:0,maxArgs:0},getPermissionLevel:{minArgs:0,maxArgs:0},update:{minArgs:2,maxArgs:2}},pageAction:{getPopup:{minArgs:1,maxArgs:1},getTitle:{minArgs:1,maxArgs:1},hide:{minArgs:1,maxArgs:1,fallbackToNoCallback:!0},setIcon:{minArgs:1,maxArgs:1},setPopup:{minArgs:1,maxArgs:1,fallbackToNoCallback:!0},setTitle:{minArgs:1,maxArgs:1,fallbackToNoCallback:!0},show:{minArgs:1,maxArgs:1,fallbackToNoCallback:!0}},permissions:{contains:{minArgs:1,maxArgs:1},getAll:{minArgs:0,maxArgs:0},remove:{minArgs:1,maxArgs:1},request:{minArgs:1,maxArgs:1}},runtime:{getBackgroundPage:{minArgs:0,maxArgs:0},getPlatformInfo:{minArgs:0,maxArgs:0},openOptionsPage:{minArgs:0,maxArgs:0},requestUpdateCheck:{minArgs:0,maxArgs:0},sendMessage:{minArgs:1,maxArgs:3},sendNativeMessage:{minArgs:2,maxArgs:2},setUninstallURL:{minArgs:1,maxArgs:1}},sessions:{getDevices:{minArgs:0,maxArgs:1},getRecentlyClosed:{minArgs:0,maxArgs:1},restore:{minArgs:0,maxArgs:1}},storage:{local:{clear:{minArgs:0,maxArgs:0},get:{minArgs:0,maxArgs:1},getBytesInUse:{minArgs:0,maxArgs:1},remove:{minArgs:1,maxArgs:1},set:{minArgs:1,maxArgs:1}},managed:{get:{minArgs:0,maxArgs:1},getBytesInUse:{minArgs:0,maxArgs:1}},sync:{clear:{minArgs:0,maxArgs:0},get:{minArgs:0,maxArgs:1},getBytesInUse:{minArgs:0,maxArgs:1},remove:{minArgs:1,maxArgs:1},set:{minArgs:1,maxArgs:1}}},tabs:{captureVisibleTab:{minArgs:0,maxArgs:2},create:{minArgs:1,maxArgs:1},detectLanguage:{minArgs:0,maxArgs:1},discard:{minArgs:0,maxArgs:1},duplicate:{minArgs:1,maxArgs:1},executeScript:{minArgs:1,maxArgs:2},get:{minArgs:1,maxArgs:1},getCurrent:{minArgs:0,maxArgs:0},getZoom:{minArgs:0,maxArgs:1},getZoomSettings:{minArgs:0,maxArgs:1},goBack:{minArgs:0,maxArgs:1},goForward:{minArgs:0,maxArgs:1},highlight:{minArgs:1,maxArgs:1},insertCSS:{minArgs:1,maxArgs:2},move:{minArgs:2,maxArgs:2},query:{minArgs:1,maxArgs:1},reload:{minArgs:0,maxArgs:2},remove:{minArgs:1,maxArgs:1},removeCSS:{minArgs:1,maxArgs:2},sendMessage:{minArgs:2,maxArgs:3},setZoom:{minArgs:1,maxArgs:2},setZoomSettings:{minArgs:1,maxArgs:2},update:{minArgs:1,maxArgs:2}},topSites:{get:{minArgs:0,maxArgs:0}},webNavigation:{getAllFrames:{minArgs:1,maxArgs:1},getFrame:{minArgs:1,maxArgs:1}},webRequest:{handlerBehaviorChanged:{minArgs:0,maxArgs:0}},windows:{create:{minArgs:0,maxArgs:1},get:{minArgs:1,maxArgs:2},getAll:{minArgs:0,maxArgs:1},getCurrent:{minArgs:0,maxArgs:1},getLastFocused:{minArgs:0,maxArgs:1},remove:{minArgs:1,maxArgs:1},update:{minArgs:2,maxArgs:2}}};if(Object.keys(d).length===0)throw new Error("api-metadata.json has not been included in browser-polyfill");class p extends WeakMap{constructor(t,a=void 0){super(a),this.createItem=t}get(t){return this.has(t)||this.set(t,this.createItem(t)),super.get(t)}}const w=e=>e&&typeof e=="object"&&typeof e.then=="function",E=(e,t)=>(...a)=>{o.runtime.lastError?e.reject(new Error(o.runtime.lastError.message)):t.singleCallbackArg||a.length<=1&&t.singleCallbackArg!==!1?e.resolve(a[0]):e.resolve(a)},y=e=>e==1?"argument":"arguments",k=(e,t)=>function(g,...c){if(c.length<t.minArgs)throw new Error(`Expected at least ${t.minArgs} ${y(t.minArgs)} for ${e}(), got ${c.length}`);if(c.length>t.maxArgs)throw new Error(`Expected at most ${t.maxArgs} ${y(t.maxArgs)} for ${e}(), got ${c.length}`);return new Promise((x,f)=>{if(t.fallbackToNoCallback)try{g[e](...c,E({resolve:x,reject:f},t))}catch(n){console.warn(`${e} API method doesn't seem to support the callback parameter, falling back to call it without a callback: `,n),g[e](...c),t.fallbackToNoCallback=!1,t.noCallback=!0,x()}else t.noCallback?(g[e](...c),x()):g[e](...c,E({resolve:x,reject:f},t))})},_=(e,t,a)=>new Proxy(t,{apply(g,c,x){return a.call(c,e,...x)}});let P=Function.call.bind(Object.prototype.hasOwnProperty);const O=(e,t={},a={})=>{let g=Object.create(null),c={has(f,n){return n in e||n in g},get(f,n,h){if(n in g)return g[n];if(!(n in e))return;let A=e[n];if(typeof A=="function")if(typeof t[n]=="function")A=_(e,e[n],t[n]);else if(P(a,n)){let C=k(n,a[n]);A=_(e,e[n],C)}else A=A.bind(e);else if(typeof A=="object"&&A!==null&&(P(t,n)||P(a,n)))A=O(A,t[n],a[n]);else if(P(a,"*"))A=O(A,t[n],a["*"]);else return Object.defineProperty(g,n,{configurable:!0,enumerable:!0,get(){return e[n]},set(C){e[n]=C}}),A;return g[n]=A,A},set(f,n,h,A){return n in g?g[n]=h:e[n]=h,!0},defineProperty(f,n,h){return Reflect.defineProperty(g,n,h)},deleteProperty(f,n){return Reflect.deleteProperty(g,n)}},x=Object.create(e);return new Proxy(x,c)},B=e=>({addListener(t,a,...g){t.addListener(e.get(a),...g)},hasListener(t,a){return t.hasListener(e.get(a))},removeListener(t,a){t.removeListener(e.get(a))}}),J=new p(e=>typeof e!="function"?e:function(a){const g=O(a,{},{getContent:{minArgs:0,maxArgs:0}});e(g)}),G=new p(e=>typeof e!="function"?e:function(a,g,c){let x=!1,f,n=new Promise(S=>{f=function(T){x=!0,S(T)}}),h;try{h=e(a,g,f)}catch(S){h=Promise.reject(S)}const A=h!==!0&&w(h);if(h!==!0&&!A&&!x)return!1;const C=S=>{S.then(T=>{c(T)},T=>{let L;T&&(T instanceof Error||typeof T.message=="string")?L=T.message:L="An unexpected error occurred",c({__mozWebExtensionPolyfillReject__:!0,message:L})}).catch(T=>{console.error("Failed to send onMessage rejected reply",T)})};return C(A?h:n),!0}),K=({reject:e,resolve:t},a)=>{o.runtime.lastError?o.runtime.lastError.message===m?t():e(new Error(o.runtime.lastError.message)):a&&a.__mozWebExtensionPolyfillReject__?e(new Error(a.message)):t(a)},F=(e,t,a,...g)=>{if(g.length<t.minArgs)throw new Error(`Expected at least ${t.minArgs} ${y(t.minArgs)} for ${e}(), got ${g.length}`);if(g.length>t.maxArgs)throw new Error(`Expected at most ${t.maxArgs} ${y(t.maxArgs)} for ${e}(), got ${g.length}`);return new Promise((c,x)=>{const f=K.bind(null,{resolve:c,reject:x});g.push(f),a.sendMessage(...g)})},H={devtools:{network:{onRequestFinished:B(J)}},runtime:{onMessage:B(G),onMessageExternal:B(G),sendMessage:F.bind(null,"sendMessage",{minArgs:1,maxArgs:3})},tabs:{sendMessage:F.bind(null,"sendMessage",{minArgs:2,maxArgs:3})}},I={clear:{minArgs:1,maxArgs:1},get:{minArgs:1,maxArgs:1},set:{minArgs:1,maxArgs:1}};return d.privacy={network:{"*":I},services:{"*":I},websites:{"*":I}},O(o,H,d)};i.exports=u(chrome)}})})(R)),R.exports}V();const b={CONTENT_SCRIPT_LOADED:"CONTENT_SCRIPT_LOADED",GET_STORE:"GET_STORE",LOGGER:"LOGGER",PARSE_PAGE:"PARSE_PAGE",OPEN_NEW_TAB:"OPEN_NEW_TAB",OPEN_EXTENSION_PAGE:"OPEN_EXTENSION_PAGE",FETCH_URL:"FETCH_URL",EXTRACT_WEBSITES:"EXTRACT_WEBSITES",CHECK_BACKEND:"CHECK_BACKEND",UPDATE_GOOGLE_MAPS_CONFIG:"UPDATE_GOOGLE_MAPS_CONFIG",CONTENT_READY:"CONTENT_READY",SUBMIT_JOB_RESULTS:"SUBMIT_JOB_RESULTS",JOB_FAILED:"JOB_FAILED"};class Z{constructor({baseUrl:r}){this.baseUrl=r.replace(/\/$/,"")}setBaseUrl(r){this.baseUrl=r.replace(/\/$/,"")}async request({path:r,method:i,body:m,timeoutMs:u}){const{baseUrl:o}=this,d={};m&&(d["Content-Type"]="application/json");const p=new AbortController,w=u?setTimeout(()=>p.abort(),u):null;try{const E=await fetch(`${o}/${r}`,{method:i,headers:d,body:m?JSON.stringify(m):void 0,signal:p.signal}),y=E.headers.get("content-type"),k={};if(y&&y.includes("application/json")){const _=await E.json();_?.message?k.message=_.message:k.data=_}return{...k,status:E.status,error:!E.ok}}catch(E){return{error:!0,status:0,message:E?.message}}finally{w&&clearTimeout(w)}}async health(){return this.request({method:"GET",path:"",timeoutMs:2500})}async extractWebsites({urls:r}){return this.request({path:"v1/extract-website",method:"POST",body:{urls:r}})}}var z={DEFAULT_BACKEND_URL:"http://localhost:5050"};const U=async()=>new Promise(s=>{chrome.storage.local.get("store",({store:r})=>{const i=r?.backend_url;s(typeof i=="string"?i:z.DEFAULT_BACKEND_URL)})}),Y="http://localhost:5050",N=new Z({baseUrl:Y});chrome.runtime.onInstalled.addListener(async()=>{const s=chrome.runtime.getManifest();await chrome.storage.local.set({extension:{APP_ID:chrome.runtime.id,APP_VERSION:s.version}})});const $=(s,r)=>{s&&console.log(s,r||"")};let l=null;const Q=240*1e3,ee=s=>{if(s.url)return s.url;const r=encodeURIComponent(s.query);switch(s.platform){case"yandex_maps":return`https://yandex.com/maps/?mode=search&text=${r}`;case"gis":return`https://2gis.ru/search/${r}`;default:return`https://www.google.com/maps/search/${r}`}},D=async(s,r,i)=>{await fetch(`${s}/v1/jobs/${r}/error`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({error:i})}).catch(()=>{})},M=async s=>{if(!l||l.tabId!==s)return;clearTimeout(l.timer);const{tabId:r}=l;l=null,await chrome.tabs.remove(r).catch(()=>{})},re=async(s,r)=>{const i=ee(r),u=(await chrome.tabs.create({url:i,active:!1})).id,o=setTimeout(async()=>{l&&l.tabId===u&&(await D(s,r.id,"timed out while collecting"),await M(u))},Q);l={job:r,backend:s,tabId:u,timer:o},$("job started",{id:r.id,platform:r.platform,query:r.query,tabId:u})},se=async()=>{if(l)return;const s=await U();if(!s)return;const r=await fetch(`${s}/v1/jobs/next`).then(i=>i.ok?i.json():null).catch(()=>null);!r||!r.id||await re(s,r).catch(async i=>{await D(s,r.id,i?.message||"failed to start"),l=null})};let W=null;const q=()=>{if(W)return;const s=async()=>{await se().catch(()=>{}),W=setTimeout(s,5e3)};s()};try{chrome.alarms.create("gls-poll",{periodInMinutes:1}),chrome.alarms.onAlarm.addListener(s=>{s.name==="gls-poll"&&q()})}catch{}q();chrome.runtime.onMessage.addListener((s,r,i)=>{try{const m=s.type,u=s.payload;if(te({action:m,payload:u,callback:i}),m===b.GET_STORE&&chrome.storage.local.get("store",({store:o})=>{i({data:o,error:!1})}),m===b.CONTENT_READY){const o=r.tab?.id,d=l&&o===l.tabId?l.job:null;i({data:{job:d},error:!1})}if(m===b.SUBMIT_JOB_RESULTS){const{jobId:o,data:d,results:p}=u||{};if(l&&l.job.id===o){const w=l.backend,E=l.tabId;fetch(`${w}/v1/jobs/${o}/results`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({data:d,results:p})}).catch(()=>{}).finally(()=>M(E))}i({data:{},error:!1})}if(m===b.JOB_FAILED){const{jobId:o,error:d}=u||{};if(l&&l.job.id===o){const p=l.backend,w=l.tabId;D(p,o,d||"collection failed").finally(()=>M(w))}i({data:{},error:!1})}if(m===b.OPEN_NEW_TAB){const{url:o}=u||{};chrome.tabs.create({url:o})}return m===b.OPEN_EXTENSION_PAGE&&chrome.runtime.openOptionsPage(),!0}catch(m){return $("background error",{message:m?.message}),!1}});const te=({action:s,payload:r={},callback:i})=>{r=r||{};const m=u=>{u.then(o=>i({error:!1,data:o})).catch(o=>i({error:!0,message:o?.message}))};switch(s===b.LOGGER&&$(r?.text,r?.data),s){case b.FETCH_URL:m(v.fetchUrl({url:r.url}));break;case b.EXTRACT_WEBSITES:m(v.extractWebsites({urls:r.urls}));break;case b.CHECK_BACKEND:m(v.checkBackend());break;case b.UPDATE_GOOGLE_MAPS_CONFIG:m(v.getGoogleMapsConfig(r));break}},v={fetchUrl:async({url:s})=>{const r=new AbortController,i=setTimeout(()=>r.abort(),45e3);try{const m=await fetch(s,{cache:"no-store",signal:r.signal});if(!m.ok)throw new Error(`HTTP ${m.status} ${m.statusText}`.trim());const u=await m.text();if(!u)throw new Error("empty response");return u}finally{clearTimeout(i)}},checkBackend:async()=>{const s=await U();if(!s)return{available:!1,url:""};N.setBaseUrl(s);const{error:r}=await N.health();return{available:!r,url:s}},extractWebsites:async({urls:s})=>{const r=await U();if(!r)throw new Error("backend is not configured");N.setBaseUrl(r);const{data:i,error:m}=await N.extractWebsites({urls:s});if(m||!i)throw new Error(`${b.EXTRACT_WEBSITES}: failed`);return i},getGoogleMapsConfig:async s=>(chrome.storage.local.set({config:{google_maps:s}}),s)};

// Shared between the content script and the storage service worker.
// Both bundles are assembled by tools/build.mjs, so this file is the single
// definition of how an organisation is keyed, merged and deduplicated.
// Never edit the copies inside extension/ - they are build output.
;(() => {
  const normalize = v => (v || '').toLocaleLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
  const normPhone = v => (v || '').replace(/\D+/g, '');

  // place_id is the only primary key for Yandex. The fallbacks exist for cards
  // that never exposed one; fuzzy matching is deliberately not used.
  const stableKey = item => {
    if (item.place_id) return `id:${item.place_id}`;
    const p = normPhone(item.phone || item.phones), a = normalize(item.address), t = normalize(item.title);
    if (p && a) return `phone-address:${p}|${a}`;
    if (t && a) return `title-address:${t}|${a}`;
    return `url:${item.maps_url || ''}`;
  };

  const sourceRecords = item => {
    try { const x = JSON.parse(item?.source_records || '[]'); return Array.isArray(x) ? x : []; }
    catch { return []; }
  };

  const uniqueJoined = arr => [...new Set(arr.map(x => (x || '').trim()).filter(Boolean))].join(' | ');

  const cleanRecord = record => record ? {
    district: String(record.district || ''),
    group: String(record.group || ''),
    category: String(record.category || ''),
    query: String(record.query || ''),
  } : null;

  const isEmptyRecord = r => !r || (!r.district && !r.group && !r.category && !r.query);

  // Merges one collected card into whatever is already stored under the same
  // key. The first version of a card wins on field values; source records
  // accumulate, so provenance survives an organisation being found by several
  // queries - and, when a RAW export is merged back in, by several runs.
  // Returns the row to store plus how many new source records it gained, which
  // the caller uses to keep the source-hits total exact.
  // How complete a row is known to be. A card fetch beats a list entry; a row
  // whose card could not be fetched sits in between.
  const DETAIL_RANK = { LIST: 0, LIST_ONLY: 1, CARD: 2 };
  const PROVENANCE = new Set(['key', 'source_records', 'source_queries_count', 'source_district', 'source_group', 'source_category', 'source_query']);
  const isBlank = v => v === undefined || v === null || v === '';

  // The stored version of a field wins, but an empty one is not a version: it
  // is a gap, and the incoming row may have what fills it. Without this, an
  // organisation first seen as a thin list entry in one district's export kept
  // that emptiness forever, and the full record from the district that actually
  // fetched its card was thrown away on merge.
  const fillBlanks = (existing, incoming) => {
    if (!incoming || incoming === existing) return existing;
    const out = { ...existing };
    for (const [field, value] of Object.entries(incoming)) {
      if (PROVENANCE.has(field) || isBlank(value)) continue;
      if (field === 'detail_level') {
        if ((DETAIL_RANK[value] ?? -1) > (DETAIL_RANK[out.detail_level] ?? -1)) out.detail_level = value;
        continue;
      }
      if (isBlank(out[field])) out[field] = value;
    }
    return out;
  };

  const mergeRecord = (existing, incoming, record) => {
    const records = sourceRecords(existing);
    let addedHits = 0;
    const add = candidate => {
      const rec = cleanRecord(candidate);
      if (isEmptyRecord(rec)) return;
      const seen = JSON.stringify(rec);
      if (records.some(x => JSON.stringify(cleanRecord(x)) === seen)) return;
      records.push(rec);
      addedHits++;
    };
    // A freshly collected card carries no provenance of its own and gets the
    // query's; a row coming back from a RAW import carries the provenance it
    // was exported with, and merging must keep both sides' history.
    for (const own of sourceRecords(incoming)) add(own);
    add(record);
    const base = existing ? fillBlanks(existing, incoming) : incoming;
    return {
      row: {
        ...base,
        key: stableKey(base),
        source: 'yandex_maps',
        source_district: uniqueJoined(records.map(x => x.district)),
        source_group: uniqueJoined(records.map(x => x.group)),
        source_category: uniqueJoined(records.map(x => x.category)),
        source_query: uniqueJoined(records.map(x => x.query)),
        source_records: JSON.stringify(records),
        source_queries_count: records.length,
        category_validation: 'UNKNOWN',
        district_validation: 'UNKNOWN',
        detected_district: '',
        final_status: 'RAW',
        exclude_reason: '',
      },
      inserted: !existing,
      addedHits,
    };
  };

  globalThis.GLSRecord = { normalize, normPhone, stableKey, sourceRecords, uniqueJoined, cleanRecord, mergeRecord, fillBlanks };
})();

// IndexedDB dataset store, hosted in the extension service worker.
//
// Why here and not in the content script: a content script's IndexedDB belongs
// to the visited page's origin (yandex.ru), so it would be wiped by clearing
// that site's data and would compete with the page for quota. In the service
// worker the database belongs to the extension origin, like chrome.storage.
//
// Why IndexedDB and not chrome.storage.local: chrome.storage serialises the
// whole value on every write, so persisting a growing dataset there costs
// O(n) per card and O(n²) per run. Here each card is one put, and the totals
// are maintained inside the same transaction so they can never drift.
//
// The worker keeps no state between messages beyond the open database handle,
// so MV3 shutting it down mid-run is harmless.
;(() => {
  const DB_NAME = 'geoleadscraper';
  const DB_VERSION = 4;
  const RAW = 'raw', FINAL = 'final', META = 'meta', REJECTED = 'rejected';
  const TOTALS = 'totals';
  const { stableKey, mergeRecord, sourceRecords } = globalThis.GLSRecord;

  let dbPromise = null;
  const openDb = () => {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result, tx = req.transaction;
        const raw = db.objectStoreNames.contains(RAW)
          ? tx.objectStore(RAW)
          : db.createObjectStore(RAW, { keyPath: 'key' });
        if (!raw.indexNames.contains('place_id')) raw.createIndex('place_id', 'place_id', { unique: false });
        // Rows collected from the page's own list data are marked LIST until a
        // card fetch fills in the contact fields. Rows written before this
        // index existed carry no detail_level, so they are absent from it -
        // which is correct: they were all full card fetches.
        if (!raw.indexNames.contains('detail_level')) raw.createIndex('detail_level', 'detail_level', { unique: false });
        // Rows the local filter either accepted or could not decide on. These
        // are the ones worth spending a card fetch on; the flag is cleared when
        // the card arrives, so the index drains as the pass runs.
        if (!raw.indexNames.contains('enrich_priority')) raw.createIndex('enrich_priority', 'enrich_priority', { unique: false });
        if (!db.objectStoreNames.contains(FINAL)) db.createObjectStore(FINAL, { keyPath: 'key' });
        // Why the discards are kept: a row that did not reach FINAL is not
        // noise, it is an answer that has to be auditable. Without it the
        // only way to ask "where did those 800 organisations go" is to
        // re-run the whole collection.
        if (!db.objectStoreNames.contains(REJECTED)) db.createObjectStore(REJECTED, { keyPath: 'key' });
        if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'id' });
      };
      req.onsuccess = () => {
        req.result.onclose = () => { dbPromise = null; };
        resolve(req.result);
      };
      req.onerror = () => reject(req.error);
    }).catch(e => { dbPromise = null; throw e; });
    return dbPromise;
  };

  const promise = req => new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const done = tx => new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Транзакция хранилища прервана.'));
  });

  const readTotals = store => promise(store.get(TOTALS)).then(t => t || { id: TOTALS, rawUnique: 0, rawSourceHits: 0, finalCount: 0, rejectedCount: 0 });

  // Writes a batch of collected cards under one transaction, merging each into
  // whatever is already stored for the same key and keeping the totals exact.
  //
  // Every await inside a transaction resolves from an IndexedDB request, and
  // all requests of a phase are issued in the same turn. Awaiting anything
  // else - or issuing a request a turn late - lets the transaction auto-close.
  const putRaw = async ({ records, record }) => {
    const incoming = (records || [])
      .map(item => ({ item, key: stableKey(item) }))
      .filter(x => x.key && x.key !== 'url:');
    const db = await openDb();
    const tx = db.transaction([RAW, META], 'readwrite');
    const raw = tx.objectStore(RAW), meta = tx.objectStore(META);

    const [totals, ...existing] = await Promise.all([
      readTotals(meta),
      ...incoming.map(x => promise(raw.get(x.key))),
    ]);

    // Merge in memory so that a card appearing twice within one batch is
    // folded together instead of the second put clobbering the first.
    const pending = new Map();
    let inserted = 0, hits = 0;
    incoming.forEach((x, i) => {
      const previous = pending.get(x.key) || existing[i];
      const merged = mergeRecord(previous, x.item, record);
      if (merged.inserted && !pending.has(x.key)) inserted++;
      hits += merged.addedHits;
      pending.set(x.key, merged.row);
    });
    totals.rawUnique += inserted;
    totals.rawSourceHits += hits;

    await Promise.all([...[...pending.values()].map(row => promise(raw.put(row))), promise(meta.put(totals))]);
    await done(tx);
    return { rawUnique: totals.rawUnique, rawSourceHits: totals.rawSourceHits, inserted, addedHits: hits };
  };

  const getRawByPlaceId = async ({ place_id }) => {
    if (!place_id) return null;
    const db = await openDb();
    const tx = db.transaction(RAW, 'readonly');
    const found = await promise(tx.objectStore(RAW).index('place_id').get(String(place_id)));
    await done(tx);
    return found || null;
  };

  const page = async (storeName, { offset = 0, limit = 500 }) => {
    const db = await openDb();
    const tx = db.transaction(storeName, 'readonly');
    const rows = [];
    await new Promise((resolve, reject) => {
      const req = tx.objectStore(storeName).openCursor();
      let skipped = offset === 0;
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return resolve();
        if (!skipped) { skipped = true; cursor.advance(offset); return; }
        rows.push(cursor.value);
        if (rows.length >= limit) return resolve();
        cursor.continue();
      };
    });
    return rows;
  };

  // Overlays freshly fetched card fields onto rows already in the registry.
  // Deliberately not putRaw: that one keeps the stored version of a field and
  // would discard exactly what the enrichment pass just fetched. The org card
  // is the authoritative source, so a row read from the list and then enriched
  // ends up identical to one collected by card fetch in the first place. Empty
  // incoming values never erase stored ones, and provenance and the row key are
  // never touched.
  const enrichRaw = async ({ records }) => {
    const wanted = (records || []).filter(x => x?.key && x.fields);
    const db = await openDb();
    const tx = db.transaction(RAW, 'readwrite');
    const raw = tx.objectStore(RAW);
    const existing = await Promise.all(wanted.map(x => promise(raw.get(x.key))));
    const rows = [];
    wanted.forEach((x, i) => {
      const current = existing[i];
      if (!current) return;
      const next = { ...current };
      for (const [field, value] of Object.entries(x.fields)) {
        if (value === undefined || value === null || value === '') continue;
        if (['key', 'place_id', 'source_records', 'source_queries_count', 'source_district', 'source_group', 'source_category', 'source_query'].includes(field)) continue;
        next[field] = value;
      }
      next.detail_level = x.detailLevel || 'CARD';
      delete next.enrich_priority;
      rows.push(next);
    });
    await Promise.all(rows.map(row => promise(raw.put(row))));
    await done(tx);
    return { updated: rows.length };
  };

  const countPendingDetail = store => promise(store.index('detail_level').count('LIST')).catch(() => 0);
  const countPendingPriority = store => promise(store.index('enrich_priority').count(1)).catch(() => 0);

  // Marks the rows the filter cares about, so the enrichment pass can fetch
  // those instead of the whole registry.
  const flagForEnrich = async ({ keys }) => {
    const wanted = (keys || []).filter(Boolean);
    if (!wanted.length) return { flagged: 0 };
    const db = await openDb();
    const tx = db.transaction(RAW, 'readwrite');
    const raw = tx.objectStore(RAW);
    const existing = await Promise.all(wanted.map(key => promise(raw.get(key))));
    const rows = existing.filter(row => row && row.detail_level === 'LIST' && row.enrich_priority !== 1)
      .map(row => ({ ...row, enrich_priority: 1 }));
    await Promise.all(rows.map(row => promise(raw.put(row))));
    await done(tx);
    return { flagged: rows.length };
  };

  const putFinal = async ({ records }) => {
    const db = await openDb();
    const tx = db.transaction([FINAL, META], 'readwrite');
    const store = tx.objectStore(FINAL), meta = tx.objectStore(META);
    await Promise.all((records || []).map(row => promise(store.put({ ...row, key: row.key || stableKey(row) }))));
    const [totals, finalCount] = await Promise.all([readTotals(meta), promise(store.count())]);
    totals.finalCount = finalCount;
    await promise(meta.put(totals));
    await done(tx);
    return { finalCount: totals.finalCount };
  };

  const putRejected = async ({ records }) => {
    const db = await openDb();
    const tx = db.transaction([REJECTED, META], 'readwrite');
    const store = tx.objectStore(REJECTED), meta = tx.objectStore(META);
    await Promise.all((records || []).map(row => promise(store.put({ ...row, key: row.key || stableKey(row) }))));
    const [totals, rejectedCount] = await Promise.all([readTotals(meta), promise(store.count())]);
    totals.rejectedCount = rejectedCount;
    await promise(meta.put(totals));
    await done(tx);
    return { rejectedCount: totals.rejectedCount };
  };

  const clearStores = async names => {
    const db = await openDb();
    const tx = db.transaction([...names, META], 'readwrite');
    const meta = tx.objectStore(META);
    const [totals] = await Promise.all([readTotals(meta), ...names.map(name => promise(tx.objectStore(name).clear()))]);
    if (names.includes(RAW)) { totals.rawUnique = 0; totals.rawSourceHits = 0; }
    if (names.includes(FINAL)) totals.finalCount = 0;
    if (names.includes(REJECTED)) totals.rejectedCount = 0;
    await promise(meta.put(totals));
    await done(tx);
    return { cleared: names };
  };

  // Rebuilds the totals from the rows themselves. Used after an import and
  // available as a repair path if a crash ever leaves them inconsistent.
  const recount = async () => {
    const db = await openDb();
    const tx = db.transaction([RAW, FINAL, REJECTED, META], 'readwrite');
    const raw = tx.objectStore(RAW);
    let rawUnique = 0, rawSourceHits = 0;
    await new Promise((resolve, reject) => {
      const req = raw.openCursor();
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return resolve();
        rawUnique++;
        rawSourceHits += sourceRecords(cursor.value).length || 1;
        cursor.continue();
      };
    });
    const [finalCount, rejectedCount] = await Promise.all([
      promise(tx.objectStore(FINAL).count()),
      promise(tx.objectStore(REJECTED).count()),
    ]);
    const totals = { id: TOTALS, rawUnique, rawSourceHits, finalCount, rejectedCount };
    await promise(tx.objectStore(META).put(totals));
    await done(tx);
    return totals;
  };

  const stats = async () => {
    const db = await openDb();
    const tx = db.transaction([META, RAW], 'readonly');
    const raw = tx.objectStore(RAW);
    const [totals, pendingDetail, pendingPriority] = await Promise.all([
      readTotals(tx.objectStore(META)),
      countPendingDetail(raw),
      countPendingPriority(raw),
    ]);
    await done(tx);
    return { rawUnique: totals.rawUnique, rawSourceHits: totals.rawSourceHits, finalCount: totals.finalCount, rejectedCount: totals.rejectedCount || 0, pendingDetail, pendingPriority };
  };

  // Pages over the rows still waiting for a card fetch. Driven off the index,
  // so the pass is resumable: a row leaves the set as soon as it is enriched.
  const listPendingDetail = async ({ limit = 200 }) => {
    const db = await openDb();
    const tx = db.transaction(RAW, 'readonly');
    const rows = await promise(tx.objectStore(RAW).index('detail_level').getAll('LIST', limit));
    await done(tx);
    return rows || [];
  };

  // The same queue, narrowed to what the local filter flagged: organisations it
  // accepted, plus the ones it could not decide on because the list entry was
  // too thin. RAW-first makes this possible - the registry is classified before
  // any card is fetched, so the expensive pass goes only where it matters.
  const listPendingDetailFinal = async ({ limit = 200 }) => {
    const db = await openDb();
    const tx = db.transaction(RAW, 'readonly');
    const rows = await promise(tx.objectStore(RAW).index('enrich_priority').getAll(1, limit));
    await done(tx);
    return (rows || []).filter(row => row.detail_level === 'LIST');
  };

  const OPS = {
    putRaw,
    getRawByPlaceId,
    listRaw: args => page(RAW, args || {}),
    listFinal: args => page(FINAL, args || {}),
    listRejected: args => page(REJECTED, args || {}),
    putFinal,
    putRejected,
    enrichRaw,
    flagForEnrich,
    listPendingDetail,
    listPendingDetailFinal,
    clearRaw: () => clearStores([RAW, FINAL, REJECTED]),
    clearFinal: () => clearStores([FINAL, REJECTED]),
    recount,
    stats,
  };

  const handle = async message => {
    const op = OPS[message.op];
    if (!op) throw new Error(`Неизвестная операция хранилища: ${message.op}`);
    return op(message.payload || {});
  };

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.type !== 'GLS_STORE') return;
    handle(message)
      .then(data => sendResponse({ ok: true, data }))
      .catch(error => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  });

  globalThis.GLSStore = { handle };
})();

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
      // Local filtering is not collection, and reloading the page through it
      // throws away a pass over the whole registry.
      filtering: !!payload.filtering,
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
      if (entry.filtering) continue;
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
