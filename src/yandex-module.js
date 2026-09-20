;(() => {
  if (!/^(?:www\.)?yandex\./i.test(location.hostname) || !location.pathname.includes('/maps')) return;

  const AUTO_KEY = 'yandex_auto_collect_v5';
  const BATCH_KEY = 'yandex_batch_collect_v6';
  const GEO_KEY = 'yandex_uzao_district_boundaries_v5';
  const AUTO = {
    IDLE: 'IDLE', RUNNING: 'RUNNING', PAUSED: 'PAUSED', COMPLETED: 'COMPLETED',
    STOPPED: 'STOPPED', ERROR: 'ERROR', USER_ACTION_REQUIRED: 'USER_ACTION_REQUIRED'
  };
  const BATCH = {
    IDLE: 'IDLE', READY: 'READY', RUNNING: 'RUNNING', PAUSED: 'PAUSED', COMPLETED: 'COMPLETED',
    STOPPED: 'STOPPED', ERROR: 'ERROR', USER_ACTION_REQUIRED: 'USER_ACTION_REQUIRED'
  };
  const CFG = {
    NO_PROGRESS_LIMIT: 6,
    MIN_NO_PROGRESS_MS: 9000,
    MAX_RUN_MS: 30 * 60 * 1000,
    REPEATED_KNOWN_CYCLES_REQUIRED: 3,
    FIND_CONTAINER_TIMEOUT_MS: 15000,
    MUTATION_TIMEOUT_MS: 2500,
    SETTLE_MS: 450,
    CARD_DELAY_MS: 550,
    STEP_RATIO: 0.82,
    MIN_STEP: 520,
    STAGNANT_REQUIRED: 2,
    BATCH_PAGE_SETTLE_MS: 1250,
    LOW_YIELD_UNIQUE: 15,
  };

  const blankAuto = () => ({
    status: AUTO.IDLE,
    totalEncountered: 0,
    uniqueCount: 0,
    duplicatesCount: 0,
    noProgressCycles: 0,
    iteration: 0,
    scrollTop: 0,
    scrollHeight: 0,
    startTime: null,
    lastProgressTime: null,
    currentSearchQuery: '',
    error: null,
    networkRequests: 0,
    fastSkippedDuplicates: 0,
    reusedFromBatchCache: 0,
    scrolledEver: false,
    maxScrollTop: 0,
    warning: null,
    seenUrls: [],
    seenPlaceIds: [],
    acceptedKeys: [],
  });

  const blankBatch = () => ({
    status: BATCH.IDLE,
    fileName: '',
    queue: [],
    currentIndex: 0,
    completedQueries: 0,
    failedQueries: 0,
    uniqueCount: 0,
    sourceHits: 0,
    startTime: null,
    lastProgressTime: null,
    error: null,
    finalCount: 0,
    storageVersion: 2,
    filterStatus: 'IDLE',
    filterPhase: 'IDLE',
    filterError: null,
    filterStartedAt: null,
    filterCompletedAt: null,
    filterStats: {processed:0,total:0,accepted:0,rejectedCategory:0,rejectedDistrict:0,rejectedNoCoords:0,rejectedUnknown:0,ambiguousDistrict:0,matchedSourceRecords:0},
    geoInfo: null,
    geoError: null,
    warnings: [],
  });

  let state = blankAuto();
  let batch = blankBatch();
  let seenUrls = new Set();
  let seenPlaceIds = new Set();
  let acceptedKeys = new Set();
  let runToken = 0;
  let loopPromise = null;
  let batchAdvancing = false;
  let autoPersistTimer = null;
  let autoPersistInFlight = Promise.resolve();

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const log = (msg, data) => console.log(`[AUTO] ${msg}`, data || '');
  const blog = (msg, data) => console.log(`[BATCH] ${msg}`, data || '');
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  // Keying, merging and dedupe live in src/shared-record.js so that the content
  // script and the storage service worker can never disagree about them.
  const {normalize, stableKey, sourceRecords, uniqueJoined} = globalThis.GLSRecord;

  // Client for the IndexedDB dataset owned by the service worker. The dataset
  // no longer rides inside the chrome.storage snapshot, so a write costs one
  // record instead of the whole registry.
  const STORE_PAGE = 500;
  const store = (op, payload) => new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({type:'GLS_STORE', op, payload: payload || {}}, response => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!response) return reject(new Error('Хранилище не ответило. Перезагрузите расширение.'));
      if (!response.ok) return reject(new Error(response.error || 'Ошибка хранилища.'));
      resolve(response.data);
    });
  });
  // Streams a store page by page so that neither the filter nor the export
  // ever holds the whole registry in memory.
  const eachStored = async (op, onPage) => {
    for (let offset = 0; ; offset += STORE_PAGE) {
      const rows = await store(op, {offset, limit: STORE_PAGE});
      if (!rows.length) return;
      await onPage(rows, offset);
      if (rows.length < STORE_PAGE) return;
    }
  };


  const placeIdFromUrl = href => {
    try {
      const u = new URL(href, location.origin), parts=u.pathname.split('/').filter(Boolean), idx=parts.findIndex(x=>x.toLowerCase()==='org');
      if(idx<0)return null;
      return [...parts.slice(idx+1)].reverse().find(x=>/^\d{5,}$/.test(x)) || null;
    } catch { return null; }
  };

  const includesAny = (value,tokens) => tokens.some(token=>value.includes(token));
  const FOOD_SERVICE=['ресторан','кафе','кофейн','столов','быстрое питание','фастфуд','пиццер','суши','бар','паб','чайхан','закусоч'];
  const RETAIL_HINT=['магазин','маркет','лавка','супермаркет','минимаркет','торгов'];
  const DISTRICTS={
    'Академический':['академический район','район академический'],
    'Гагаринский':['гагаринский район','район гагаринский'],
    'Зюзино':['район зюзино','зюзино'],
    'Коньково':['район коньково','коньково'],
    'Котловка':['район котловка','котловка'],
    'Ломоносовский':['ломоносовский район','район ломоносовский'],
    'Обручевский':['обручевский район','район обручевский'],
    'Северное Бутово':['северное бутово','район северное бутово'],
    'Тёплый Стан':['теплый стан','район теплый стан'],
    'Черёмушки':['черемушки','район черемушки'],
    'Южное Бутово':['южное бутово','район южное бутово'],
    'Ясенево':['ясенево','район ясенево'],
  };
  const explicitDistrict = item => {
    const text=normalize([item.address,item.street,item.municipality].filter(Boolean).join(' | '));
    if(!text)return null;
    for(const [district,aliases] of Object.entries(DISTRICTS)) if(aliases.some(a=>text.includes(normalize(a)))) return district;
    return null;
  };
  const categoryMatch = (category,categoriesRaw) => {
    const requested=normalize(category), actual=normalize(categoriesRaw);
    if(!requested||!actual)return null;
    switch(requested){
      case 'ресторан': return actual.includes('ресторан');
      case 'кафе': return actual.includes('кафе');
      case 'кофейня': return includesAny(actual,['кофейн','кофе с собой']);
      case 'столовая': return actual.includes('столов');
      case 'фастфуд': return includesAny(actual,['быстрое питание','фастфуд']);
      case 'пиццерия': return actual.includes('пиццер');
      case 'суши': return actual.includes('суши');
      case 'пекарня': return includesAny(actual,['пекар','хлебобул']);
      case 'кондитерская': return includesAny(actual,['кондитер','торты на заказ']);
      case 'пекарня / кондитерская': return includesAny(actual,['пекар','хлебобул','кондитер','торты на заказ']);
      case 'бар': return includesAny(actual,['бар','паб']);
      case 'другая точка питания': return includesAny(actual,[...FOOD_SERVICE,'общественное питание','кулинар','доставка еды']);
      case 'супермаркет': return actual.includes('супермаркет');
      case 'продуктовый магазин': return includesAny(actual,['магазин продуктов','продуктовый магазин','продукты питания']);
      case 'минимаркет': return actual.includes('минимаркет');
      case 'овощи / фрукты': return includesAny(actual,['овощ','фрукт']);
      case 'мясной магазин': { const food=includesAny(actual,['мяс','колбас']); return food && (!includesAny(actual,FOOD_SERVICE)||includesAny(actual,RETAIL_HINT)); }
      case 'рыбный магазин': { const food=includesAny(actual,['рыб','морепродукт']); return food && (!includesAny(actual,FOOD_SERVICE)||includesAny(actual,RETAIL_HINT)); }
      case 'алкогольный магазин': return includesAny(actual,['магазин алкоголь','алкогольные напитки','винный магазин','винотека']);
      case 'специализированная пищевая розница': return includesAny(actual,['магазин чая','магазин кофе','чай и кофе','магазин сыр','сырная лавка','кондитерские изделия','фермерские продукты','продукты пчеловодства','диетические продукты','орех','сухофрукт','специи','бакалея']);
      case 'пищевое производство': return includesAny(actual,['производство продуктов питания','пищевое производство','пищевая промышленность','хлебозавод','кондитерская фабрика','мясокомбинат','молочный завод','пивовар','производство напитков','производство хлеб','производство кондитер']);
      case 'производственное предприятие': { const prod=includesAny(actual,['производствен','промышленн','предприятие','завод','фабрика']); if(!prod)return false; return !includesAny(actual,['пищев','продукт','хлеб','кондитер','мяс','рыб','молоч','напитк','пивовар']); }
      case 'религиозное / духовное учреждение': return includesAny(actual,['религиозн','храм','церков','мечет','синагог','монастыр','часовн','духовн','приход','молитвен','буддий','исламск','православ','католич']);
      default: return null;
    }
  };
  const GEO_VERSION=5;
  const LOCAL_GEO={"Академический":{"type":"Polygon","coordinates":[[[37.55226,55.68403],[37.55711,55.68807],[37.56076,55.69102],[37.56831,55.6955],[37.57691,55.70038],[37.58386,55.70435],[37.58731,55.70634],[37.59097,55.70219],[37.59625,55.69607],[37.60162,55.69158],[37.59845,55.69035],[37.59303,55.68551],[37.58844,55.68134],[37.58642,55.67949],[37.57951,55.67691],[37.58033,55.67503],[37.57809,55.67269],[37.56942,55.67568],[37.56381,55.67761],[37.55812,55.68066],[37.55226,55.68403]]]},"Гагаринский":{"type":"Polygon","coordinates":[[[37.53005,55.68993],[37.53915,55.69618],[37.54631,55.70075],[37.55923,55.71028],[37.57493,55.71312],[37.57761,55.71421],[37.58871,55.70714],[37.58731,55.70634],[37.57902,55.70159],[37.571,55.69701],[37.56076,55.69102],[37.55226,55.68403],[37.54727,55.68094],[37.54031,55.6842],[37.53005,55.68993]]]},"Зюзино":{"type":"Polygon","coordinates":[[[37.564,55.64946],[37.57194,55.65329],[37.58563,55.65785],[37.60024,55.65983],[37.61348,55.65803],[37.61983,55.65302],[37.61675,55.64635],[37.61191,55.63942],[37.60323,55.63275],[37.59074,55.6278],[37.57748,55.62888],[37.56635,55.63468],[37.55908,55.64174],[37.564,55.64946]]]},"Коньково":{"type":"Polygon","coordinates":[[[37.49851,55.64219],[37.50873,55.6458],[37.52204,55.64665],[37.53872,55.64285],[37.55048,55.63694],[37.55592,55.62816],[37.55261,55.61778],[37.54272,55.6079],[37.52868,55.60129],[37.51406,55.60245],[37.5022,55.6087],[37.49301,55.61966],[37.49089,55.632],[37.49851,55.64219]]]},"Котловка":{"type":"Polygon","coordinates":[[[37.57809,55.67269],[37.58843,55.67554],[37.60035,55.67882],[37.61564,55.681],[37.62736,55.67746],[37.63609,55.67043],[37.63645,55.66163],[37.62856,55.6544],[37.61983,55.65302],[37.61348,55.65803],[37.60024,55.65983],[37.58563,55.65785],[37.57931,55.66286],[37.57809,55.67269]]]},"Ломоносовский":{"type":"Polygon","coordinates":[[[37.51166,55.67973],[37.52168,55.68559],[37.53395,55.68907],[37.54031,55.6842],[37.54727,55.68094],[37.55226,55.68403],[37.55812,55.68066],[37.56381,55.67761],[37.56016,55.67065],[37.55201,55.66618],[37.53936,55.66543],[37.52667,55.66868],[37.51691,55.67329],[37.51166,55.67973]]]},"Обручевский":{"type":"Polygon","coordinates":[[[37.48247,55.64946],[37.49461,55.65558],[37.51088,55.65903],[37.52667,55.66868],[37.53936,55.66543],[37.55201,55.66618],[37.56016,55.67065],[37.564,55.64946],[37.55048,55.63694],[37.53872,55.64285],[37.52204,55.64665],[37.50873,55.6458],[37.49851,55.64219],[37.48963,55.64417],[37.48247,55.64946]]]},"Северное Бутово":{"type":"Polygon","coordinates":[[[37.53685,55.57729],[37.54784,55.58699],[37.56223,55.58519],[37.57368,55.58221],[37.58582,55.57616],[37.59755,55.56789],[37.60358,55.56456],[37.59516,55.55867],[37.58945,55.55768],[37.5774,55.54911],[37.56823,55.55494],[37.55973,55.55434],[37.55036,55.56293],[37.5535,55.56762],[37.54789,55.56892],[37.54069,55.57113],[37.53685,55.57729]]]},"Тёплый Стан":{"type":"Polygon","coordinates":[[[37.4558,55.61001],[37.46192,55.6213],[37.45572,55.63705],[37.48247,55.64946],[37.49851,55.64219],[37.5022,55.6087],[37.48833,55.60827],[37.47406,55.60613],[37.4558,55.61001]]]},"Черёмушки":{"type":"Polygon","coordinates":[[[37.53909,55.65574],[37.55201,55.66618],[37.56016,55.67065],[37.57809,55.67269],[37.57931,55.66286],[37.58563,55.65785],[37.57194,55.65329],[37.564,55.64946],[37.55267,55.64658],[37.54339,55.64913],[37.53909,55.65574]]]},"Южное Бутово":{"type":"Polygon","coordinates":[[[37.47482,55.56032],[37.49937,55.55969],[37.52272,55.55781],[37.55036,55.56293],[37.55973,55.55434],[37.5774,55.54911],[37.60476,55.54761],[37.60436,55.52281],[37.5989,55.49722],[37.57287,55.49066],[37.53613,55.49412],[37.50308,55.50138],[37.48042,55.52055],[37.47482,55.56032]]]},"Ясенево":{"type":"Polygon","coordinates":[[[37.48833,55.60827],[37.5022,55.6087],[37.51406,55.60245],[37.52868,55.60129],[37.54272,55.6079],[37.55261,55.61778],[37.55592,55.62816],[37.564,55.64946],[37.54842,55.64618],[37.53172,55.64015],[37.51614,55.63107],[37.50255,55.62031],[37.48996,55.6122],[37.48833,55.60827]]]}};
  const GEO_ENVELOPES={
    'Академический':{minLon:37.53,maxLon:37.62,minLat:55.66,maxLat:55.72},
    'Гагаринский':{minLon:37.50,maxLon:37.61,minLat:55.67,maxLat:55.73},
    'Зюзино':{minLon:37.54,maxLon:37.63,minLat:55.62,maxLat:55.68},
    'Коньково':{minLon:37.46,maxLon:37.58,minLat:55.60,maxLat:55.67},
    'Котловка':{minLon:37.56,maxLon:37.66,minLat:55.64,maxLat:55.70},
    'Ломоносовский':{minLon:37.48,maxLon:37.58,minLat:55.66,maxLat:55.72},
    'Обручевский':{minLon:37.45,maxLon:37.57,minLat:55.63,maxLat:55.69},
    'Северное Бутово':{minLon:37.50,maxLon:37.67,minLat:55.53,maxLat:55.61},
    'Тёплый Стан':{minLon:37.43,maxLon:37.57,minLat:55.59,maxLat:55.66},
    'Черёмушки':{minLon:37.52,maxLon:37.63,minLat:55.64,maxLat:55.70},
    'Южное Бутово':{minLon:37.43,maxLon:37.68,minLat:55.47,maxLat:55.59},
    'Ясенево':{minLon:37.45,maxLon:37.63,minLat:55.57,maxLat:55.65}
  };
  const GEO_SELF_TESTS=[
    {lat:55.6875,lon:37.5730,expected:'Академический'},
    {lat:55.644762,lon:37.525993,forbidden:'Академический'},
    {lat:55.647731,lon:37.482145,forbidden:'Академический'}
  ];
  // ---- GEO runtime -------------------------------------------------------
  // Runtime GEO never touches the network. Two offline sources are supported:
  //   1. LOCAL_GEO  - simplified outlines bundled with the extension (fallback).
  //   2. custom GeoJSON imported by the user from a local file and kept in
  //      chrome.storage.local under GEO_KEY (preferred, if present).
  // The bundled fallback is an approximation: tools/geo-check.mjs measures how
  // it behaves against landmark probes, polygon overlap and district area.
  let geoCache=null;
  const EMBEDDED_GEO_SOURCE='embedded:uzao-simplified-epsg4326-v1';
  const propertyStrings=props=>Object.values(props||{}).filter(v=>typeof v==='string'||typeof v==='number').map(String);
  const featureDistrict=feature=>{
    const props=feature?.properties||{},priority=[props.NAME,props.name,props['name:ru'],props.district].filter(v=>typeof v==='string');
    for(const candidate of priority){for(const district of Object.keys(DISTRICTS))if(normalize(candidate)===normalize(district))return district;}
    const vals=propertyStrings(props).map(normalize);
    for(const district of Object.keys(DISTRICTS)){const target=normalize(district);if(vals.some(v=>v===target||v.includes(`район ${target}`)||v.includes(`${target} район`)))return district;}
    return null;
  };
  const walkPositions=(value,fn)=>{if(!Array.isArray(value))return;if(value.length>=2&&typeof value[0]==='number'&&typeof value[1]==='number'&&Number.isFinite(value[0])&&Number.isFinite(value[1])){fn(value);return;}value.forEach(v=>walkPositions(v,fn));};
  const geometryRings=g=>g?.type==='Polygon'?(g.coordinates||[]):g?.type==='MultiPolygon'?(g.coordinates||[]).flat():[];
  const geometryBounds=g=>{let minLon=Infinity,maxLon=-Infinity,minLat=Infinity,maxLat=-Infinity;walkPositions(g?.coordinates,p=>{minLon=Math.min(minLon,p[0]);maxLon=Math.max(maxLon,p[0]);minLat=Math.min(minLat,p[1]);maxLat=Math.max(maxLat,p[1]);});return [minLon,maxLon,minLat,maxLat].every(Number.isFinite)?{minLon,maxLon,minLat,maxLat}:null;};
  const boundsContains=(b,x,y,e=0)=>!!b&&x>=b.minLon-e&&x<=b.maxLon+e&&y>=b.minLat-e&&y<=b.maxLat+e;
  const boundsOverlap=(a,b)=>a.minLon<=b.maxLon&&a.maxLon>=b.minLon&&a.minLat<=b.maxLat&&a.maxLat>=b.minLat;
  const looksMoscow=g=>{const b=geometryBounds(g);return !!b&&b.maxLon>=36.7&&b.minLon<=38.3&&b.maxLat>=55.2&&b.minLat<=56.2;};
  const geometryLooksLikeDistrict=(district,g)=>{const b=geometryBounds(g);if(!b||!looksMoscow(g))return false;const w=b.maxLon-b.minLon,h=b.maxLat-b.minLat;if(w<=0||h<=0||w>0.35||h>0.25)return false;return boundsOverlap(b,GEO_ENVELOPES[district]);};
  const onSegment=(x,y,a,b)=>{
    const len=(b[0]-a[0])**2+(b[1]-a[1])**2;
    // GeoJSON rings are closed, so ring[n-1] === ring[0] and inRing's first
    // iteration always tests a zero-length segment. Without this guard that
    // segment reported EVERY point as lying on it, inRing returned true for
    // everything, and point-in-polygon silently degraded into a bounding-box
    // test - which made the self-test throw and FILTER RAW -> FINAL unusable.
    if(len<=0)return x===a[0]&&y===a[1];
    const cross=(x-a[0])*(b[1]-a[1])-(y-a[1])*(b[0]-a[0]);
    if(Math.abs(cross)>1e-10)return false;
    const dot=(x-a[0])*(b[0]-a[0])+(y-a[1])*(b[1]-a[1]);
    return dot>=0&&dot<=len;
  };
  const inRing=(x,y,ring)=>{if(!Array.isArray(ring)||ring.length<3)return false;let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[j],b=ring[i];if(!Array.isArray(a)||!Array.isArray(b))continue;if(onSegment(x,y,a,b))return true;const hit=(b[1]>y)!==(a[1]>y)&&x<((a[0]-b[0])*(y-b[1]))/((a[1]-b[1])||Number.EPSILON)+b[0];if(hit)inside=!inside;}return inside;};
  const inPolygon=(x,y,poly)=>{if(!poly?.length||!inRing(x,y,poly[0]))return false;for(let i=1;i<poly.length;i++)if(inRing(x,y,poly[i]))return false;return true;};
  const inGeometry=(x,y,g,bounds)=>{const b=bounds||geometryBounds(g);if(!boundsContains(b,x,y,1e-9))return false;return g.type==='Polygon'?inPolygon(x,y,g.coordinates):g.coordinates.some(poly=>inPolygon(x,y,poly));};
  // Distance (in degrees) from a point to the nearest edge of a geometry.
  // Used only as a deterministic tie-break when simplified outlines overlap:
  // the district the point sits deepest inside wins, instead of the org being
  // silently dropped as "ambiguous".
  const distToSegment=(x,y,a,b)=>{const dx=b[0]-a[0],dy=b[1]-a[1],len=dx*dx+dy*dy;let t=len?((x-a[0])*dx+(y-a[1])*dy)/len:0;t=Math.max(0,Math.min(1,t));return Math.hypot(x-(a[0]+t*dx),y-(a[1]+t*dy));};
  const distToGeometry=(x,y,g)=>{let best=Infinity;for(const ring of geometryRings(g)){for(let i=0,j=ring.length-1;i<ring.length;j=i++){const d=distToSegment(x,y,ring[j],ring[i]);if(d<best)best=d;}}return best;};
  const selfTestGeo=cache=>{
    for(const test of GEO_SELF_TESTS){
      const matches=Object.keys(DISTRICTS).filter(d=>inGeometry(test.lon,test.lat,cache.geometries[d],cache.bounds[d]));
      if(test.expected&&!matches.includes(test.expected))throw new Error(`Geo self-test: контрольная точка не попала в ${test.expected}`);
      if(test.forbidden&&matches.includes(test.forbidden))throw new Error(`Geo self-test: ложное попадание в ${test.forbidden}`);
    }
  };
  // Counts how much of the ЮЗАО bounding box is claimed by more than one
  // district. Reported, never fatal: a noisy fallback must not block filtering.
  const measureGeoOverlap=cache=>{
    let inside=0,ambiguous=0;
    for(let lat=55.47;lat<=55.74;lat+=0.004)for(let lon=37.42;lon<=37.68;lon+=0.004){
      const matches=Object.keys(DISTRICTS).filter(d=>boundsContains(cache.bounds[d],lon,lat,0)&&inGeometry(lon,lat,cache.geometries[d],cache.bounds[d]));
      if(matches.length){inside++;if(matches.length>1)ambiguous++;}
    }
    return {inside,ambiguous,ambiguousPercent:inside?Math.round(ambiguous/inside*1000)/10:0};
  };
  const buildGeoCache=(geometries,bounds,source)=>{
    const out={version:GEO_VERSION,source,savedAt:Date.now(),geometries,bounds};
    selfTestGeo(out);
    out.quality=measureGeoOverlap(out);
    return out;
  };
  const parseGeoJson=(raw,source)=>{
    let fc; try{fc=JSON.parse(raw);}catch{throw new Error('Файл границ не является валидным JSON.');}
    const features=Array.isArray(fc?.features)?fc.features:Array.isArray(fc)?fc:null;
    if(!features)throw new Error('Некорректный GeoJSON границ: ожидается FeatureCollection с features.');
    const geometries={},bounds={};
    for(const f of features){
      const g=f?.geometry;if(!g||!['Polygon','MultiPolygon'].includes(g.type)||!Array.isArray(g.coordinates))continue;
      const d=featureDistrict(f);if(!d||geometries[d]||!geometryLooksLikeDistrict(d,g))continue;
      const b=geometryBounds(g);if(!b)continue;geometries[d]=g;bounds[d]=b;
    }
    const missing=Object.keys(DISTRICTS).filter(d=>!geometries[d]||!bounds[d]);
    if(missing.length)throw new Error(`Не найдены или не прошли sanity-check границы: ${missing.join(', ')}`);
    return buildGeoCache(geometries,bounds,source);
  };
  const embeddedGeo=()=>{
    const geometries={},bounds={};
    for(const d of Object.keys(DISTRICTS)){
      const g=LOCAL_GEO[d]; if(!g)throw new Error(`В локальном наборе нет границы района ${d}`);
      const b=geometryBounds(g); if(!b)throw new Error(`Некорректная локальная граница района ${d}`);
      geometries[d]=g; bounds[d]=b;
    }
    return buildGeoCache(geometries,bounds,EMBEDDED_GEO_SOURCE);
  };
  const ensureGeo=async()=>{
    if(geoCache)return geoCache;
    try{
      const stored=await chrome.storage.local.get([GEO_KEY]);
      const custom=stored?.[GEO_KEY];
      if(custom?.version===GEO_VERSION&&custom?.geometries&&custom?.bounds&&Object.keys(DISTRICTS).every(d=>custom.geometries[d]&&custom.bounds[d])){
        geoCache=custom; return geoCache;
      }
    }catch{}
    geoCache=embeddedGeo(); return geoCache;
  };
  const importGeoJsonText=async(text,fileName)=>{
    const parsed=parseGeoJson(text,`file:${fileName||'boundaries.geojson'}`);
    await chrome.storage.local.set({[GEO_KEY]:parsed});
    geoCache=parsed;
    blog('custom boundaries loaded',{source:parsed.source,ambiguousPercent:parsed.quality.ambiguousPercent});
    return parsed;
  };
  const resetGeoToEmbedded=async()=>{
    try{await chrome.storage.local.remove(GEO_KEY);}catch{}
    geoCache=embeddedGeo(); render();
    blog('boundaries reset to embedded',{ambiguousPercent:geoCache.quality.ambiguousPercent});
  };
  const normalizeCoords=item=>{let lat=Number(item?.latitude),lon=Number(item?.longitude),swapped=false;if(!Number.isFinite(lat)||!Number.isFinite(lon))return {...item};if(lat>=36&&lat<=39.5&&lon>=54.5&&lon<=57){[lat,lon]=[lon,lat];swapped=true;}return {...item,latitude:lat,longitude:lon,_coords_swapped:swapped};};
  const detectGeoDistrict=async item=>{
    const normalized=normalizeCoords(item),lat=Number(normalized.latitude),lon=Number(normalized.longitude);
    if(!Number.isFinite(lat)||!Number.isFinite(lon)||(!lat&&!lon))return {item:normalized,district:null,valid:false,quality:'NO_COORDINATES',candidates:[]};
    const geo=await ensureGeo();
    const matches=Object.keys(DISTRICTS).filter(d=>boundsContains(geo.bounds[d],lon,lat,1e-9)&&inGeometry(lon,lat,geo.geometries[d],geo.bounds[d]));
    if(!matches.length)return {item:normalized,district:null,valid:true,quality:'OUTSIDE',candidates:[]};
    if(matches.length===1)return {item:normalized,district:matches[0],valid:true,quality:'EXACT',candidates:matches};
    // Overlapping simplified outlines: resolve deterministically instead of
    // dropping the organisation. The verdict is flagged AMBIGUOUS downstream.
    const best=matches.map(d=>({d,depth:distToGeometry(lon,lat,geo.geometries[d])})).sort((a,b)=>b.depth-a.depth||a.d.localeCompare(b.d))[0];
    return {item:normalized,district:best.d,valid:true,quality:'AMBIGUOUS',candidates:matches};
  };

  const currentBatchQuery = () => [BATCH.RUNNING,BATCH.PAUSED,BATCH.USER_ACTION_REQUIRED].includes(batch.status) ? batch.queue[batch.currentIndex] || null : null;
  const evaluateItem = async (item,forcedQuery=null) => {
    const q=forcedQuery||currentBatchQuery();
    const base={accept:true,categoryValidation:'UNKNOWN',districtValidation:'UNKNOWN',districtQuality:'NOT_CHECKED',detectedDistrict:'',districtCandidates:[]};
    if(!q)return base;
    const cm=categoryMatch(q.category,item.categories),categoryValidation=cm==null?'UNKNOWN':cm?'MATCH':'MISMATCH';
    if(q.category&&categoryValidation!=='MATCH')return {...base,accept:false,categoryValidation};
    if(q.district&&Object.keys(DISTRICTS).some(d=>normalize(d)===normalize(q.district))){
      const geo=await detectGeoDistrict(item);
      const requested=Object.keys(DISTRICTS).find(d=>normalize(d)===normalize(q.district));
      // No usable coordinates: the district is unknown, not wrong. Reported as
      // its own outcome so such organisations are never confused with real
      // geographic mismatches.
      if(!geo.valid)return {...base,accept:false,categoryValidation,districtValidation:'NO_COORDINATES',districtQuality:'NO_COORDINATES'};
      const districtValidation=geo.district===requested?'MATCH':'MISMATCH';
      return {
        accept:districtValidation==='MATCH',
        categoryValidation,
        districtValidation,
        districtQuality:geo.quality,
        detectedDistrict:geo.district||'Вне ЮЗАО',
        districtCandidates:geo.candidates||[],
      };
    }
    const detectedDistrict=explicitDistrict(item);
    let districtValidation='UNKNOWN';
    if(q.district&&detectedDistrict)districtValidation=normalize(q.district)===normalize(detectedDistrict)?'MATCH':'MISMATCH';
    return {...base,accept:districtValidation!=='MISMATCH',categoryValidation,districtValidation,districtQuality:'ADDRESS_TEXT',detectedDistrict:detectedDistrict||''};
  };

  const getQuery = () => {
    try {
      const u = new URL(location.href);
      const text = u.searchParams.get('text');
      if (text) return text.replace(/\+/g, ' ').trim();
      const m = u.pathname.match(/\/search\/([^/?#]+)/i);
      if (m && m[1]) return decodeURIComponent(m[1]).replace(/\+/g, ' ').trim();
    } catch {}
    for (const sel of ['input[placeholder*="Поиск"]','input[aria-label*="Поиск"]','input[placeholder*="Search"]','input[aria-label*="Search"]','input.input__control']) {
      const el = document.querySelector(sel);
      if (el && el.value && el.value.trim()) return el.value.trim();
    }
    return '';
  };

  const orgUrls = root => {
    const out = new Set();
    root.querySelectorAll('a[href*="/maps/org/"]').forEach(a => {
      try {
        const u = new URL(a.getAttribute('href'), location.origin);
        if (/\/maps\/org\//i.test(u.pathname)) out.add(`${u.origin}${u.pathname}`);
      } catch {}
    });
    return [...out];
  };

  const challenged = () => {
    const href = location.href.toLowerCase();
    if (href.includes('showcaptcha') || href.includes('captcha')) return true;
    if (document.querySelector('[class*="captcha"], form[action*="captcha"], iframe[src*="captcha"]')) return true;
    const text = (document.body?.innerText || '').slice(0, 12000).toLocaleLowerCase();
    return ['подтвердите, что вы не робот','введите символы с картинки','нам нужно убедиться, что вы не робот','access check','confirm you are not a robot'].some(x => text.includes(x));
  };

  const scrollable = el => {
    const s = getComputedStyle(el);
    return ['auto','scroll','overlay'].includes(s.overflowY) && el.scrollHeight > el.clientHeight + 80;
  };
  const score = el => {
    const links = orgUrls(el).length;
    if (!links) return -1e9;
    const r = el.getBoundingClientRect();
    const cls = `${el.className || ''}`.toLowerCase();
    return links * 4 + (r.left < innerWidth * .65 ? 12 : 0) + Math.min(20, Math.max(0, (el.scrollHeight-el.clientHeight)/300)) + (/scroll|search|list|panel|sidebar/.test(cls) ? 20 : 0);
  };
  const findContainer = () => {
    const selectors = ['.scroll__container','.search-list-view .scroll__container','[class*="search-list-view"] [class*="scroll__container"]','[class*="search-list"] [class*="scroll"]','[role="main"] [class*="scroll"]'];
    // Two passes: prefer an element that can actually scroll. Locking onto a
    // non-scrolling wrapper used to end the run after the first visible cards.
    for (const requireScroll of [true,false]) {
      for (const sel of selectors) {
        const arr = [...document.querySelectorAll(sel)]
          .filter(el => el.isConnected && orgUrls(el).length && (!requireScroll || scrollable(el)))
          .sort((a,b) => score(b)-score(a));
        if (arr[0]) return arr[0];
      }
    }
    const candidates = new Set();
    [...document.querySelectorAll('a[href*="/maps/org/"]')].slice(0,30).forEach(a => {
      let p = a.parentElement, d = 0;
      while (p && d++ < 10) { if (scrollable(p)) candidates.add(p); p = p.parentElement; }
    });
    return [...candidates].sort((a,b) => score(b)-score(a))[0] || null;
  };

  const waitMutation = container => new Promise(resolve => {
    let done = false;
    const finish = () => { if (done) return; done = true; obs.disconnect(); clearTimeout(timer); resolve(); };
    const obs = new MutationObserver(finish);
    obs.observe(container, {childList:true, subtree:true});
    const timer = setTimeout(finish, CFG.MUTATION_TIMEOUT_MS);
  });

  const autoSnapshot = () => ({...state,seenUrls:[...seenUrls],seenPlaceIds:[...seenPlaceIds],acceptedKeys:[...acceptedKeys]});
  const writeAutoStorage = async () => {
    // Materialising the dedupe sets is O(n); doing it here rather than on every
    // patchAuto means it happens once per debounce window, not four times per
    // card.
    const snapshot=autoSnapshot();
    autoPersistInFlight=autoPersistInFlight.then(()=>chrome.storage.local.set({[AUTO_KEY]:snapshot}).catch(e=>console.warn('[AUTO] storage write failed',e)));
    await autoPersistInFlight;
  };
  const persistAuto = async (immediate=false) => {
    render();
    if(immediate){if(autoPersistTimer){clearTimeout(autoPersistTimer);autoPersistTimer=null;}await writeAutoStorage();return;}
    if(autoPersistTimer)return;
    autoPersistTimer=setTimeout(()=>{autoPersistTimer=null;void writeAutoStorage();},350);
  };
  const patchAuto = async (obj,immediate=false) => { state = {...state, ...obj}; await persistAuto(immediate); };
  const persistBatch = async () => {
    try { await chrome.storage.local.set({[BATCH_KEY]: batch}); } catch (e) { console.warn('[BATCH] storage write failed', e); }
    render();
  };
  const patchBatch = async obj => { batch = {...batch, ...obj}; await persistBatch(); };

  const collectVisible = async (container, token) => {
    const parser = window.__glsYandexFetch;
    if (typeof parser !== 'function') throw new Error('Existing Yandex extractor is not available in this build.');
    const urls = orgUrls(container), candidates = urls.length ? urls : orgUrls(document);
    const stats = {candidateUrls:candidates.length,newUrls:0,repeatedUrls:0,acceptedUnique:0,duplicateItems:0,fastSkipped:0,cacheReused:0,rejected:0};
    for (const url of candidates) {
      if (token !== runToken || state.status !== AUTO.RUNNING) return stats;
      const pidFromUrl=placeIdFromUrl(url);
      if(seenUrls.has(url)){stats.repeatedUrls++;continue;}
      if(pidFromUrl && seenPlaceIds.has(pidFromUrl)){
        seenUrls.add(url);stats.repeatedUrls++;stats.fastSkipped++;
        await patchAuto({fastSkippedDuplicates:state.fastSkippedDuplicates+1,duplicatesCount:state.duplicatesCount+1});
        continue;
      }

      stats.newUrls++; seenUrls.add(url); if(pidFromUrl)seenPlaceIds.add(pidFromUrl);
      await patchAuto({totalEncountered:state.totalEncountered+1});

      let item=pidFromUrl ? await store('getRawByPlaceId',{place_id:pidFromUrl}) : null, fromCache=!!item;
      if(item){stats.cacheReused++;await patchAuto({reusedFromBatchCache:state.reusedFromBatchCache+1});}
      else{
        try{item=await parser(url,{extractWebsites:false});}catch{item=null;}
        if(token!==runToken||state.status!==AUTO.RUNNING)return stats;
        if(!item)continue;
        fromCache=false;
        await patchAuto({networkRequests:state.networkRequests+1});
      }

      item=normalizeCoords(item);
      const enriched={...item,source:'yandex_maps',source_query:state.currentSearchQuery,category_validation:'UNKNOWN',district_validation:'UNKNOWN',detected_district:'',final_status:'RAW',exclude_reason:''};
      // RAW-FIRST: collection never depends on category/GEO filtering.
      // Every unique card is preserved; filtering is a separate local post-process.
      const key=stableKey(enriched);
      if(acceptedKeys.has(key)){stats.duplicateItems++;await patchAuto({duplicatesCount:state.duplicatesCount+1});continue;}
      // Durable before it is counted: the card is in IndexedDB the moment it is
      // read, so a crash costs at most the card in flight.
      const totals=await store('putRaw',{records:[enriched],record:currentBatchQuery()||{district:'',group:'',category:'',query:state.currentSearchQuery}});
      stats.acceptedUnique++;acceptedKeys.add(key);
      await patchAuto({uniqueCount:acceptedKeys.size,lastProgressTime:Date.now()});
      if(batch.uniqueCount!==totals.rawUnique||batch.sourceHits!==totals.rawSourceHits){
        batch={...batch,uniqueCount:totals.rawUnique,sourceHits:totals.rawSourceHits};
      }
      if(!fromCache && CFG.CARD_DELAY_MS>0)await sleep(CFG.CARD_DELAY_MS+Math.floor(Math.random()*180));
    }
    return stats;
  };

  const requireAction = async () => {
    await patchAuto({status:AUTO.USER_ACTION_REQUIRED,error:'Yandex требует действие пользователя (CAPTCHA/access check). Пройдите проверку на странице и нажмите RESUME.'},true);
    if (batch.status === BATCH.RUNNING) await patchBatch({status:BATCH.USER_ACTION_REQUIRED,error:state.error});
    log('user action required');
  };

  const complete = async reason => {
    // A query is only trustworthy if the result list actually moved. Ending
    // with a handful of cards and a list that never scrolled means the page
    // was not driven, not that Yandex ran out of results - say so instead of
    // reporting a silent success.
    const suspicious = !state.scrolledEver && state.uniqueCount < CFG.LOW_YIELD_UNIQUE;
    const warning = suspicious
      ? `Сбор завершился после ${state.uniqueCount} карточек, но список выдачи ни разу не прокрутился. Результат почти наверняка неполный: проверьте, что открыт список результатов Яндекс Карт, и повторите запрос.`
      : null;
    await patchAuto({status:AUTO.COMPLETED,error:null,warning},true);
    log('completed', {unique:state.uniqueCount, reason, scrolledEver:state.scrolledEver, warning});
    if (batch.status === BATCH.RUNNING) setTimeout(() => finishBatchCurrent().catch(e => batchFatal(e)), 0);
  };

  const runLoop = async token => {
    const deadline = Date.now() + CFG.FIND_CONTAINER_TIMEOUT_MS;
    let container = findContainer();
    while (!container && Date.now() < deadline) {
      if (token !== runToken || state.status !== AUTO.RUNNING) return;
      if (challenged()) return requireAction();
      await sleep(500); container = findContainer();
    }
    if (!container) throw new Error('Не найден scroll-container выдачи Яндекс Карт. Откройте список результатов поиска и повторите.');
    log('container found', {scrollHeight:container.scrollHeight,clientHeight:container.clientHeight});
    let stagnant = 0, repeatedKnown = 0;
    await collectVisible(container, token);
    while (token === runToken) {
      if (state.status === AUTO.PAUSED) { await sleep(300); continue; }
      if (state.status !== AUTO.RUNNING) return;
      if (challenged()) return requireAction();
      if (!container.isConnected) {
        container = findContainer();
        if (!container) throw new Error('Scroll-container Яндекс Карт исчез во время сбора.');
        log('container reacquired');
      }
      const started = state.startTime || Date.now();
      if (Date.now() - started > CFG.MAX_RUN_MS) {
        const noNewFor = Date.now() - (state.lastProgressTime || started);
        if (state.uniqueCount > 0 && noNewFor >= CFG.MIN_NO_PROGRESS_MS) {
          log('safety timeout converted to completion',{unique:state.uniqueCount,noNewFor});
          return complete('safety timeout after useful progress');
        }
        throw new Error('Сработал safety timeout до получения устойчивого полезного результата.');
      }
      const beforeUnique = state.uniqueCount, beforeTop = container.scrollTop, beforeHeight = container.scrollHeight;
      const maxTop = Math.max(0, beforeHeight - container.clientHeight);
      const step = Math.max(CFG.MIN_STEP, container.clientHeight * CFG.STEP_RATIO);
      const target = Math.min(maxTop, beforeTop + step);
      if (target > beforeTop + 2) {
        container.scrollTop = target; container.dispatchEvent(new Event('scroll',{bubbles:true}));
      } else {
        const nudge = Math.min(160, Math.max(80, container.clientHeight*.12));
        container.scrollTop = Math.max(0,beforeTop-nudge); container.dispatchEvent(new Event('scroll',{bubbles:true}));
        await sleep(160);
        container.scrollTop = Math.max(0,container.scrollHeight-container.clientHeight); container.dispatchEvent(new Event('scroll',{bubbles:true}));
      }
      await waitMutation(container); await sleep(CFG.SETTLE_MS);
      if (token !== runToken || state.status !== AUTO.RUNNING) continue;
      const cycleStats = await collectVisible(container, token);
      const afterTop = container.scrollTop, afterHeight = container.scrollHeight;
      const uniqueProgress = state.uniqueCount > beforeUnique, discoveryProgress=cycleStats.newUrls>0, listProgress=uniqueProgress||discoveryProgress;
      const scrollProgress = afterTop > beforeTop + 8 || afterHeight > beforeHeight + 8;
      const scrolledEver = state.scrolledEver || afterTop > 8 || scrollProgress;
      stagnant = scrollProgress ? 0 : stagnant + 1;
      const repeatedOnly = !listProgress && cycleStats.candidateUrls > 0 && cycleStats.acceptedUnique === 0 && cycleStats.newUrls === 0;
      repeatedKnown = repeatedOnly ? repeatedKnown + 1 : listProgress ? 0 : repeatedKnown;
      await patchAuto({
        iteration:state.iteration+1,
        scrolledEver,
        maxScrollTop:Math.max(state.maxScrollTop||0,afterTop),
        scrollTop:afterTop,
        scrollHeight:afterHeight,
        noProgressCycles:listProgress ? 0 : state.noProgressCycles+1,
        lastProgressTime:listProgress ? Date.now() : state.lastProgressTime,
      });
      log(`scroll iteration ${state.iteration}`, {unique:state.uniqueCount,noProgress:`${state.noProgressCycles}/${CFG.NO_PROGRESS_LIMIT}`});
      const noNewFor = Date.now() - (state.lastProgressTime || started);
      if (state.noProgressCycles >= CFG.NO_PROGRESS_LIMIT && noNewFor >= CFG.MIN_NO_PROGRESS_MS && (stagnant >= CFG.STAGNANT_REQUIRED || repeatedKnown >= CFG.REPEATED_KNOWN_CYCLES_REQUIRED)) {
        log('result list stabilized',{noProgressCycles:state.noProgressCycles,stagnant,repeatedKnown,cycleStats});
        return complete(repeatedKnown >= CFG.REPEATED_KNOWN_CYCLES_REQUIRED ? 'known-card cycle detected' : 'scroll stabilized');
      }
    }
  };

  const ensureLoop = () => {
    if (loopPromise) return;
    const token = runToken;
    loopPromise = runLoop(token).catch(async e => {
      if (token !== runToken) return;
      await patchAuto({status:AUTO.ERROR,error:e?.message || String(e)},true);
      log('error', e?.message || e);
      if (batch.status === BATCH.RUNNING) {
        const q = [...batch.queue], current=q[batch.currentIndex];
        if (current) q[batch.currentIndex] = {...current,status:'ERROR',error:state.error,uniqueFound:state.uniqueCount};
        await patchBatch({...await storeTotals(),status:BATCH.ERROR,error:state.error,queue:q,failedQueries:batch.failedQueries+1});
      }
    }).finally(() => { loopPromise = null; });
  };

  const startAuto = async () => {
    runToken++;
    seenUrls.clear(); seenPlaceIds.clear(); acceptedKeys.clear();
    state = {...blankAuto(),status:AUTO.RUNNING,startTime:Date.now(),lastProgressTime:Date.now(),currentSearchQuery:getQuery()};
    await persistAuto(true); log('started',{query:state.currentSearchQuery}); ensureLoop();
  };
  const pauseAuto = async () => { if (state.status===AUTO.RUNNING) { await patchAuto({status:AUTO.PAUSED},true); log('paused'); } };
  const resumeAuto = async () => { if ([AUTO.PAUSED,AUTO.USER_ACTION_REQUIRED].includes(state.status)) { await patchAuto({status:AUTO.RUNNING,error:null},true); log('resumed'); ensureLoop(); } };
  const stopAuto = async () => { if (![AUTO.IDLE,AUTO.COMPLETED,AUTO.STOPPED].includes(state.status)) { runToken++; await patchAuto({status:AUTO.STOPPED},true); log('stopped by user'); } };
  const resetAuto = async () => { runToken++; if(autoPersistTimer){clearTimeout(autoPersistTimer);autoPersistTimer=null;} state=blankAuto(); seenUrls.clear(); seenPlaceIds.clear(); acceptedKeys.clear(); try {await chrome.storage.local.remove(AUTO_KEY);} catch{} render(); log('reset'); };

  const storeTotals = async () => {
    const t=await store('stats');
    return {uniqueCount:t.rawUnique,sourceHits:t.rawSourceHits,finalCount:t.finalCount};
  };

  const csvCell = v => `"${String(v ?? '').replace(/"/g,'""')}"`;
  const csvRows = (rows,fields) => rows.map(row => fields.map(f => csvCell(row[f])).join(',')).join('\r\n');
  // Streams the file in chunks: a Blob takes an array of strings, so a large
  // registry never has to be concatenated into one string in memory.
  const saveCsvStream = async (name, fields, produce) => {
    const parts=['\uFEFF'+fields.join(',')];
    await produce(rows => { if(rows.length) parts.push('\r\n'+csvRows(rows,fields)); });
    const blob = new Blob(parts,{type:'text/csv;charset=utf-8;'}), url=URL.createObjectURL(blob), a=document.createElement('a');
    a.href=url; a.download=`${name}-${new Date().toISOString().replace(/[-:TZ.]/g,'').slice(0,14)}.csv`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  };
  const RAW_FIELDS=['source_district','source_group','source_category','title','address','phone','website','maps_url','source','source_query','source_queries_count','source_records','place_id','categories','rating','review_count','latitude','longitude','opening_hours','street','photos','labels','email','phones','socials'];
  const RAW_META_FIELDS=['export_batch_status','export_queries_total','export_queries_completed','export_queries_low_yield','export_warnings'];
  // A RAW file must be able to explain itself: a truncated or low-yield run
  // is otherwise indistinguishable from a genuinely small result set.
  const rawExportMeta = () => {
    const warnings=(batch.warnings||[]).map(w=>`${w.query} → ${w.unique}`);
    const done=batch.queue.filter(x=>x.status==='COMPLETED').length;
    const full=batch.status===BATCH.COMPLETED&&!warnings.length&&done===batch.queue.length;
    return {full,meta:{
      export_batch_status:batch.status,
      export_queries_total:batch.queue.length,
      export_queries_completed:batch.completedQueries,
      export_queries_low_yield:warnings.length,
      export_warnings:warnings.join(' | '),
    }};
  };
  const exportBatchRaw = async () => {
    const {full,meta}=rawExportMeta();
    await saveCsvStream(full?'geoleadscraper-yandex_maps-RAW_ALL':'geoleadscraper-yandex_maps-RAW_PARTIAL',
      [...RAW_FIELDS,...RAW_META_FIELDS],
      write => eachStored('listRaw', rows => write(rows.map(row=>({...row,...meta})))));
  };
  const exportBatchFinal = async () => saveCsvStream('geoleadscraper-yandex_maps-FINAL_FILTERED',
    ['matched_source_district','matched_source_group','matched_source_category','title','address','phone','website','maps_url','source','matched_source_query','matched_source_queries_count','matched_source_records','category_validation','district_validation','district_quality','district_candidates','detected_district','final_status','exclude_reason','place_id','categories','rating','review_count','latitude','longitude','opening_hours','street','photos','labels','email','phones','socials'],
    write => eachStored('listFinal', rows => write(rows)));

  // -------- BATCH CSV --------
  const detectDelimiter = text => {
    const first = text.replace(/^\uFEFF/,'').split(/\r?\n/).find(x=>x.trim()) || '';
    const counts = {',':0,';':0,'\t':0}; let quoted=false;
    for(let i=0;i<first.length;i++){
      const ch=first[i];
      if(ch==='"'){ if(quoted && first[i+1]==='"') i++; else quoted=!quoted; continue; }
      if(!quoted && Object.prototype.hasOwnProperty.call(counts,ch)) counts[ch]++;
    }
    return Object.entries(counts).sort((a,b)=>b[1]-a[1])[0]?.[0] || ',';
  };
  const parseDelimited = text => {
    const delimiter=detectDelimiter(text), rows=[]; let row=[], cell='', quoted=false;
    const src=text.replace(/^\uFEFF/,'');
    for(let i=0;i<src.length;i++){
      const ch=src[i];
      if(quoted){
        if(ch==='"' && src[i+1]==='"'){cell+='"';i++;}
        else if(ch==='"') quoted=false;
        else cell+=ch;
        continue;
      }
      if(ch==='"') quoted=true;
      else if(ch===delimiter){row.push(cell.trim());cell='';}
      else if(ch==='\n'||ch==='\r'){
        if(ch==='\r'&&src[i+1]==='\n') i++;
        row.push(cell.trim());cell=''; if(row.some(v=>v.length)) rows.push(row); row=[];
      } else cell+=ch;
    }
    row.push(cell.trim()); if(row.some(v=>v.length)) rows.push(row); return rows;
  };
  const aliases = {
    district:['district','район'], group:['group','группа'], category:['category','категория','подкатегория','category / subcategory'],
    query:['query','запрос','search','search_query','source_query','поисковый запрос']
  };
  const headerIndex = (headers,key) => headers.findIndex(h => aliases[key].map(normalize).includes(normalize(h)));
  const parseBatchCsv = text => {
    const rows=parseDelimited(text); if(rows.length<2) throw new Error('CSV пустой или не содержит строк с запросами.');
    const headers=rows[0], qi=headerIndex(headers,'query'); if(qi<0){const nh=headers.map(normalize);if(nh.includes('primary_source')||nh.includes('selection_rule'))throw new Error('Это CSV со списком официальных источников. Его не нужно загружать в GeoLeadScraper: Yandex BATCH принимает только файл с колонкой query/запрос.');throw new Error('В CSV не найдена обязательная колонка query (или «запрос»).');}
    const di=headerIndex(headers,'district'), gi=headerIndex(headers,'group'), ci=headerIndex(headers,'category');
    const out=[], seen=new Set();
    rows.slice(1).forEach((r,i)=>{
      const query=(r[qi]||'').trim(); if(!query) return;
      const x={district:di>=0?(r[di]||'').trim():'',group:gi>=0?(r[gi]||'').trim():'',category:ci>=0?(r[ci]||'').trim():'',query};
      const id=[x.district,x.group,x.category,x.query].map(normalize).join('|'); if(seen.has(id)) return; seen.add(id);
      out.push({id:`q-${i+2}-${out.length+1}`,...x,status:'PENDING',uniqueFound:0,error:null});
    });
    if(!out.length) throw new Error('В CSV нет непустых поисковых запросов.'); return out;
  };

  const buildSearchUrl = query => {
    const current=new URL(location.href), m=current.pathname.match(/^\/maps\/([^/]+)\/([^/]+)/i);
    const region=m?.[1]||'213', city=(m?.[2]&&m[2]!=='search')?m[2]:'moscow';
    const next=new URL(`${current.origin}/maps/${region}/${city}/search/${encodeURIComponent(query)}/`);
    for(const key of ['ll','z']){const v=current.searchParams.get(key);if(v)next.searchParams.set(key,v);} return next.toString();
  };

  const parseRawCsv = text => {
    const rows=parseDelimited(text); if(rows.length<2) throw new Error('RAW CSV пустой или не содержит строк данных.');
    const headers=rows[0].map(x=>String(x||'').replace(/^\uFEFF/,'').trim()), hm=new Map(headers.map((h,i)=>[normalize(h),i]));
    const cell=(row,name)=>{const i=hm.get(normalize(name));return i==null?'':String(row[i]||'').trim();};
    if(!['place_id','maps_url','title'].some(x=>hm.has(x))) throw new Error('Это не RAW CSV GeoLeadScraper: не найдены place_id/maps_url/title.');
    const recordsFor=row=>{
      const raw=cell(row,'source_records');
      if(raw){try{const x=JSON.parse(raw);if(Array.isArray(x))return x.map(v=>({district:String(v?.district||''),group:String(v?.group||''),category:String(v?.category||''),query:String(v?.query||'')})).filter(v=>v.query||v.district||v.group||v.category);}catch{}}
      const split=n=>cell(row,n).split('|').map(x=>x.trim()).filter(Boolean), qs=split('source_query'),ds=split('source_district'),gs=split('source_group'),cs=split('source_category'),n=Math.max(qs.length,ds.length,gs.length,cs.length,1),out=[];
      for(let i=0;i<n;i++){const r={district:ds[i]||ds[0]||'',group:gs[i]||gs[0]||'',category:cs[i]||cs[0]||'',query:qs[i]||qs[0]||''};if(r.query||r.district||r.group||r.category)out.push(r);}return out;
    };
    const num=v=>{const n=Number(String(v||'').replace(',','.'));return Number.isFinite(n)?n:0;},byKey=new Map(),sourceMap=new Map();
    for(const row of rows.slice(1)){
      const recs=recordsFor(row);recs.forEach(r=>sourceMap.set(JSON.stringify(r),r));
      const nc=normalizeCoords({latitude:cell(row,'latitude'),longitude:cell(row,'longitude')});
      const item={place_id:cell(row,'place_id'),source:cell(row,'source')||'yandex_maps',source_query:uniqueJoined(recs.map(r=>r.query))||cell(row,'source_query'),source_district:uniqueJoined(recs.map(r=>r.district))||cell(row,'source_district'),source_group:uniqueJoined(recs.map(r=>r.group))||cell(row,'source_group'),source_category:uniqueJoined(recs.map(r=>r.category))||cell(row,'source_category'),source_records:JSON.stringify(recs),source_queries_count:recs.length||num(cell(row,'source_queries_count'))||1,title:cell(row,'title'),address:cell(row,'address'),phone:cell(row,'phone'),phones:cell(row,'phones'),website:cell(row,'website'),maps_url:cell(row,'maps_url'),street:cell(row,'street'),categories:cell(row,'categories'),rating:num(cell(row,'rating')),review_count:num(cell(row,'review_count')),latitude:nc.latitude,longitude:nc.longitude,opening_hours:cell(row,'opening_hours'),photos:num(cell(row,'photos')),labels:cell(row,'labels'),email:cell(row,'email'),socials:cell(row,'socials'),municipality:cell(row,'municipality'),category_validation:'UNKNOWN',district_validation:'UNKNOWN',detected_district:'',final_status:'RAW',exclude_reason:''};
      if(!item.place_id&&!item.maps_url&&!item.title)continue;const k=stableKey(item),old=byKey.get(k);if(!old){byKey.set(k,item);continue;}
      const all=[...sourceRecords(old),...recs], uniq=[...new Map(all.map(r=>[JSON.stringify(r),r])).values()];byKey.set(k,{...old,...item,source_query:uniqueJoined(uniq.map(r=>r.query)),source_district:uniqueJoined(uniq.map(r=>r.district)),source_group:uniqueJoined(uniq.map(r=>r.group)),source_category:uniqueJoined(uniq.map(r=>r.category)),source_records:JSON.stringify(uniq),source_queries_count:uniq.length,final_status:'RAW'});
    }
    const data=[...byKey.values()];if(!data.length)throw new Error('В RAW CSV не найдено ни одной организации.');
    const queue=[...sourceMap.values()].map((r,i)=>({id:`import-${i+1}`,...r,status:'COMPLETED',uniqueFound:0,error:null}));
    const sourceHits=data.reduce((sum,x)=>sum+(x.source_queries_count||sourceRecords(x).length||1),0);return {data,queue,sourceHits};
  };
  const loadRawText = async (text,fileName) => {
    const x=parseRawCsv(text);
    await resetAuto();
    // An import replaces the registry, as it always has: it exists to refilter
    // a known RAW, not to blend two of them.
    await store('clearRaw');
    for(let i=0;i<x.data.length;i+=STORE_PAGE)await store('putRaw',{records:x.data.slice(i,i+STORE_PAGE),record:null});
    const totals=await store('recount');
    batch={...blankBatch(),status:BATCH.COMPLETED,fileName:fileName||'raw.csv',queue:x.queue,currentIndex:x.queue.length,completedQueries:x.queue.length,uniqueCount:totals.rawUnique,sourceHits:totals.rawSourceHits,startTime:Date.now(),lastProgressTime:Date.now()};
    await persistBatch();blog('RAW imported',{fileName,rawUnique:totals.rawUnique,sourceHits:totals.rawSourceHits});
  };

  const loadBatchText = async (text,fileName) => {
    const queue=parseBatchCsv(text); await resetAuto();
    batch={...blankBatch(),status:BATCH.READY,fileName:fileName||'queries.csv',queue}; await persistBatch();
    blog('CSV loaded',{fileName,queries:queue.length});
  };

  const batchFatal = async e => {
    const message=e?.message||String(e); await patchBatch({status:BATCH.ERROR,error:message}); blog('error',message);
  };

  const runBatchCurrent = async () => {
    if(batchAdvancing || batch.status!==BATCH.RUNNING) return;
    batchAdvancing=true;
    try{
      if(batch.currentIndex>=batch.queue.length){await patchBatch({status:BATCH.COMPLETED,error:null});blog('completed',{queries:batch.completedQueries,unique:batch.uniqueCount});return;}
      const current=batch.queue[batch.currentIndex]; if(!current) throw new Error('Не удалось определить текущий запрос очереди.');
      if(current.status!=='RUNNING'){
        const q=[...batch.queue];q[batch.currentIndex]={...current,status:'RUNNING',error:null};await patchBatch({queue:q});
      }
      if(normalize(getQuery())!==normalize(current.query)){
        blog('navigate',{index:batch.currentIndex+1,query:current.query}); location.assign(buildSearchUrl(current.query)); return;
      }
      await sleep(CFG.BATCH_PAGE_SETTLE_MS); if(batch.status!==BATCH.RUNNING)return;
      const same=normalize(state.currentSearchQuery)===normalize(current.query);
      if(same&&state.status===AUTO.RUNNING)return;
      if(same&&[AUTO.PAUSED,AUTO.USER_ACTION_REQUIRED].includes(state.status)){await resumeAuto();return;}
      if(same&&state.status===AUTO.COMPLETED){batchAdvancing=false;await finishBatchCurrent();return;}
      await resetAuto();await startAuto();
    }catch(e){await batchFatal(e);}finally{batchAdvancing=false;}
  };

  const finishBatchCurrent = async () => {
    if(batchAdvancing || batch.status!==BATCH.RUNNING) return;
    const current=batch.queue[batch.currentIndex]; if(!current||current.status==='COMPLETED')return;
    if(normalize(state.currentSearchQuery)!==normalize(current.query)||state.status!==AUTO.COMPLETED)return;
    batchAdvancing=true;
    try{
      const totals=await storeTotals(), q=[...batch.queue];
      const queryWarning=state.warning||null;
      q[batch.currentIndex]={...current,status:queryWarning?'COMPLETED_LOW':'COMPLETED',uniqueFound:state.uniqueCount,error:null,warning:queryWarning};
      const warnings=queryWarning?[...(batch.warnings||[]),{query:current.query,unique:state.uniqueCount,message:queryWarning}]:(batch.warnings||[]);
      const next=batch.currentIndex+1, completed=batch.completedQueries+1;if(next<q.length)q[next]={...q[next],status:'RUNNING',error:null};
      batch={...batch,queue:q,warnings,...totals,completedQueries:completed,currentIndex:next,lastProgressTime:Date.now(),error:null,status:next>=q.length?BATCH.COMPLETED:BATCH.RUNNING,filterStatus:'IDLE',filterPhase:'IDLE',filterError:null,filterStartedAt:null,filterCompletedAt:null,filterStats:blankBatch().filterStats};
      await persistBatch();blog('query completed',{index:next,query:current.query,queryRawUnique:state.uniqueCount,totalRawUnique:totals.uniqueCount});
      if(next>=q.length){blog('completed',{queries:completed,unique:totals.uniqueCount});return;}
      await resetAuto();const n=q[next];blog('next query',{index:next+1,query:n.query});location.assign(buildSearchUrl(n.query));
    }finally{batchAdvancing=false;}
  };

  const startBatch = async () => {
    if(!batch.queue.length)throw new Error('Сначала загрузите CSV со списком запросов.');
    await resetAuto();
    const q=batch.queue.map((x,i)=>({...x,status:i===0?'RUNNING':'PENDING',uniqueFound:0,error:null}));
    batch={...blankBatch(),status:BATCH.RUNNING,fileName:batch.fileName,queue:q,startTime:Date.now(),lastProgressTime:Date.now()};await persistBatch();blog('started',{queries:q.length,mode:'RAW_FIRST'});await runBatchCurrent();
  };
  const pauseBatch = async () => {if(batch.status!==BATCH.RUNNING)return;await patchBatch({status:BATCH.PAUSED});await pauseAuto();blog('paused',{currentIndex:batch.currentIndex});};
  const resumeBatch = async () => {if(![BATCH.PAUSED,BATCH.USER_ACTION_REQUIRED].includes(batch.status))return;await patchBatch({status:BATCH.RUNNING,error:null});blog('resumed',{currentIndex:batch.currentIndex});await runBatchCurrent();};
  const stopBatch = async () => {
    if([BATCH.IDLE,BATCH.COMPLETED,BATCH.STOPPED].includes(batch.status))return;
    await stopAuto();
    // Nothing to check-point: every card was written to the store as it was
    // read, so stopping only has to refresh the totals shown in the panel.
    await patchBatch({...await storeTotals(),status:BATCH.STOPPED});
    blog('stopped',{completed:batch.completedQueries,unique:batch.uniqueCount});
  };
  // The only action that destroys collected data, and it says so on the button.
  const resetBatch = async () => {
    await resetAuto();
    try{await store('clearRaw');}catch(e){blog('store clear failed',e?.message||e);}
    batch=blankBatch();
    try{await chrome.storage.local.remove(BATCH_KEY);}catch{}
    render();blog('reset');
  };

  const filterBatch = async () => {
    const totals=await storeTotals();
    if(!totals.uniqueCount)throw new Error('RAW-реестр пуст. Сначала выполните BATCH.');
    if(batch.filterStatus==='RUNNING')return;
    const stats={processed:0,total:totals.uniqueCount,accepted:0,rejectedCategory:0,rejectedDistrict:0,rejectedNoCoords:0,rejectedUnknown:0,ambiguousDistrict:0,matchedSourceRecords:0};
    await patchBatch({filterStatus:'RUNNING',filterPhase:'LOADING_GEO',filterError:null,filterStartedAt:Date.now(),filterCompletedAt:null,filterStats:stats,finalCount:0});
    blog('filter started',{rawUnique:stats.total});
    try{
      const geo=await ensureGeo();
      await store('clearFinal');
      await patchBatch({filterPhase:'FILTERING',geoInfo:{source:geo.source,quality:geo.quality||null}});
      // Streams RAW page by page and writes FINAL page by page. Neither the
      // input nor the output registry is ever held whole in memory.
      await eachStored('listRaw', async rows => {
        const accepted=[];
        for(const item of rows){
          const records=sourceRecords(item),decisions=[];
          for(const record of records)decisions.push({record,decision:await evaluateItem(item,record)});
          const ok=decisions.filter(x=>x.decision.accept);
          if(ok.length){
            const uniqueAccepted=[...new Map(ok.map(x=>[JSON.stringify(x.record),x])).values()];
            const matched=uniqueAccepted.map(x=>x.record);
            const detected=uniqueJoined(uniqueAccepted.map(x=>x.decision.detectedDistrict||'').filter(Boolean));
            // Report the validations that were actually computed. A record with
            // no category or no district in the query is UNKNOWN, not MATCH:
            // search metadata and verified metadata must stay separate.
            const categoryValidation=uniqueJoined(uniqueAccepted.map(x=>x.decision.categoryValidation))||'UNKNOWN';
            const districtValidation=uniqueJoined(uniqueAccepted.map(x=>x.decision.districtValidation))||'UNKNOWN';
            const districtQuality=uniqueJoined(uniqueAccepted.map(x=>x.decision.districtQuality))||'NOT_CHECKED';
            const candidates=uniqueJoined(uniqueAccepted.flatMap(x=>x.decision.districtCandidates||[]));
            const ambiguous=uniqueAccepted.some(x=>x.decision.districtQuality==='AMBIGUOUS');
            if(ambiguous)stats.ambiguousDistrict++;
            accepted.push({...item,category_validation:categoryValidation,district_validation:districtValidation,district_quality:districtQuality,district_candidates:ambiguous?candidates:'',detected_district:detected,matched_source_district:uniqueJoined(matched.map(x=>x.district)),matched_source_group:uniqueJoined(matched.map(x=>x.group)),matched_source_category:uniqueJoined(matched.map(x=>x.category)),matched_source_query:uniqueJoined(matched.map(x=>x.query)),matched_source_records:JSON.stringify(matched),matched_source_queries_count:matched.length,final_status:'ACCEPTED',exclude_reason:''});
            stats.accepted++;stats.matchedSourceRecords+=matched.length;
          }else{
            const hasCategoryMatch=decisions.some(x=>!x.record.category||x.decision.categoryValidation==='MATCH');
            const hasCategoryProblem=decisions.some(x=>!!x.record.category&&x.decision.categoryValidation!=='MATCH');
            const hasNoCoords=decisions.some(x=>x.decision.districtValidation==='NO_COORDINATES');
            const hasDistrictProblem=decisions.some(x=>!!x.record.district&&x.decision.districtValidation==='MISMATCH');
            if(hasCategoryMatch&&hasNoCoords&&!hasDistrictProblem)stats.rejectedNoCoords++;
            else if(hasCategoryMatch&&hasDistrictProblem)stats.rejectedDistrict++;
            else if(hasCategoryProblem)stats.rejectedCategory++;
            else stats.rejectedUnknown++;
          }
          stats.processed++;
        }
        const written=accepted.length?await store('putFinal',{records:accepted}):null;
        await patchBatch({filterStats:{...stats},finalCount:written?written.finalCount:batch.finalCount});
        await sleep(0);
      });
      await patchBatch({filterStatus:'COMPLETED',filterPhase:'DONE',filterError:null,filterCompletedAt:Date.now(),filterStats:{...stats}});
      blog('filter completed',{rawUnique:stats.total,accepted:stats.accepted,ambiguousDistrict:stats.ambiguousDistrict,noCoords:stats.rejectedNoCoords});
    }catch(e){
      const message=e?.message||String(e);
      await patchBatch({filterStatus:'ERROR',filterPhase:'ERROR',filterError:message,filterCompletedAt:Date.now(),filterStats:{...stats}});
      blog('filter error',{message,processed:stats.processed,rawUnique:stats.total});
    }
  };

  // -------- UI --------
  const autoLabel = s => ({RUNNING:'Сбор',PAUSED:'Пауза',COMPLETED:'СБОР ЗАВЕРШЁН',STOPPED:'Остановлено',ERROR:'Ошибка',USER_ACTION_REQUIRED:'USER ACTION REQUIRED',IDLE:'Готов'})[s] || s;
  const batchLabel = s => ({READY:'Список загружен',RUNNING:'RAW-сбор',PAUSED:'Пауза',COMPLETED:'RAW-СБОР ЗАВЕРШЁН',STOPPED:'Остановлено',ERROR:'Ошибка',USER_ACTION_REQUIRED:'USER ACTION REQUIRED',IDLE:'Нет списка'})[s] || s;
  const btn = (text, action, extra='') => `<button data-gls-action="${action}" style="box-sizing:border-box;width:100%;padding:7px 8px;margin-top:6px;border:1px solid #d4d4d4;border-radius:6px;background:#fff;color:#111;font-weight:600;cursor:pointer;${extra}">${esc(text)}</button>`;
  const fmtMs = ms => {
    if(ms==null || !Number.isFinite(ms) || ms<0) return '—';
    const sec=Math.floor(ms/1000), h=Math.floor(sec/3600), m=Math.floor((sec%3600)/60), ss=sec%60;
    return h>0?`${h}:${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}`:`${m}:${String(ss).padStart(2,'0')}`;
  };
  const batchMetrics = () => {
    const now=Date.now(), total=batch.queue.length, completed=Math.min(batch.completedQueries,total), percent=total?Math.round(completed/total*100):0;
    const currentNumber=total?Math.min(batch.currentIndex+1,total):0;
    const currentStart=batch.lastProgressTime||batch.startTime;
    const currentElapsed=currentStart?Math.max(0,now-currentStart):null;
    const totalElapsed=batch.startTime?Math.max(0,now-batch.startTime):null;
    const lastNewAgo=state.lastProgressTime?Math.max(0,now-state.lastProgressTime):null;
    const avg=completed>0&&batch.startTime&&batch.lastProgressTime?Math.max(1,(batch.lastProgressTime-batch.startTime)/completed):null;
    const remaining=Math.max(0,total-completed);
    const eta=avg!=null?(currentElapsed!=null&&remaining>0?Math.max(0,avg-currentElapsed)+avg*Math.max(0,remaining-1):avg*remaining):null;
    return {total,completed,percent,currentNumber,currentElapsed,totalElapsed,lastNewAgo,eta};
  };
  const bar = (pct, extra='') => `<div style="position:relative;height:9px;margin-top:5px;overflow:hidden;border-radius:99px;background:#e5e7eb"><div style="height:100%;width:${Math.max(0,Math.min(100,pct))}%;background:#262626;transition:width .25s ease"></div>${extra}</div>`;

  const getPanel = () => {
    const host=document.getElementById('mapscan_app'), shadow=host?.shadowRoot;if(!shadow)return null;
    const legacyRoot=shadow.getElementById('shadow-root');if(legacyRoot)legacyRoot.style.display='none';
    let panel=shadow.getElementById('gls-auto-panel');
    if(!panel){panel=document.createElement('div');panel.id='gls-auto-panel';panel.style.cssText='position:fixed;left:428px;top:60px;z-index:2147483647;width:390px;max-height:calc(100vh - 80px);overflow:auto;box-sizing:border-box;background:#fff;color:#111;border:1px solid #ddd;border-radius:8px;padding:10px;font:12px Arial,sans-serif;box-shadow:0 4px 12px rgba(0,0,0,.15)';shadow.appendChild(panel);}return panel;
  };

  const singleHtml = () => {
    if(batch.status!==BATCH.IDLE)return '';
    const q=state.currentSearchQuery?`<div style="margin-top:4px;font-size:11px;word-break:break-word">Запрос: ${esc(state.currentSearchQuery)}</div>`:'';
    const stats=state.status===AUTO.IDLE?'':`<div style="margin-top:6px;line-height:1.5"><div>Уникальных ID просмотрено: ${state.totalEncountered}</div><div>Уникальных: ${state.uniqueCount}</div><div>Дублей/повторов: ${state.duplicatesCount}</div><div>Сетевых карточек: ${state.networkRequests}</div><div>FAST skip: ${state.fastSkippedDuplicates}</div><div>Из общего кэша: ${state.reusedFromBatchCache}</div><div>Прокрутка списка: ${state.scrolledEver?'да':'НЕТ'}</div><div>Без новых данных: ${state.noProgressCycles} / ${CFG.NO_PROGRESS_LIMIT}</div>${q}</div>`;
    const err=state.error?`<div style="margin-top:6px;color:#a16207;font-size:11px;word-break:break-word">${esc(state.error)}</div>`:'';
    let buttons='';
    if(state.status===AUTO.IDLE)buttons=btn('AUTO COLLECT · ОДИН ЗАПРОС','auto-start');
    else if(state.status===AUTO.RUNNING)buttons=btn('PAUSE','auto-pause')+btn('STOP','auto-stop');
    else if([AUTO.PAUSED,AUTO.USER_ACTION_REQUIRED].includes(state.status))buttons=btn('RESUME','auto-resume')+btn('STOP','auto-stop');
    else buttons=(batch.uniqueCount?btn(`EXPORT RAW (${batch.uniqueCount})`,'batch-export-raw'):'')+btn('RESET','auto-reset');
    return `<div><div style="font-size:13px;font-weight:700">GeoLeadScraper · Yandex</div><div style="margin-top:6px">Статус: <b>${autoLabel(state.status)}</b></div>${stats}${err}${buttons}</div>`;
  };

  const batchHtml = () => {
    const s=batch.status,current=batch.queue[batch.currentIndex],idle=s===BATCH.IDLE,ready=s===BATCH.READY,running=s===BATCH.RUNNING,paused=s===BATCH.PAUSED,action=s===BATCH.USER_ACTION_REQUIRED,finished=[BATCH.COMPLETED,BATCH.STOPPED].includes(s),error=s===BATCH.ERROR;
    const active=running||paused||action;
    const divider=idle?'margin-top:12px;border-top:1px solid #eee;padding-top:10px':'margin-top:0';
    const m=batchMetrics();
    const fs=batch.filterStats||{processed:0,total:0,accepted:0,rejectedCategory:0,rejectedDistrict:0,rejectedUnknown:0,matchedSourceRecords:0};
    const filterRunning=batch.filterStatus==='RUNNING',filterCompleted=batch.filterStatus==='COMPLETED',filterError=batch.filterStatus==='ERROR';
    const filterPct=fs.total?Math.round(fs.processed/fs.total*100):0;
    let progress='';
    if(!idle&&m.total){
      const segment=m.total?100/m.total:0;
      const activeSegment=running&&m.completed<m.total?`<div style="position:absolute;left:${m.percent}%;top:0;height:100%;width:${Math.max(2,segment)}%;background:#9ca3af;opacity:.75"></div>`:'';
      progress=`<div style="margin-top:8px;padding:9px;border:1px solid #e5e7eb;border-radius:7px;background:#fafafa">`+
        `<div style="display:flex;justify-content:space-between;gap:8px;font-size:11px"><b>ОБЩИЙ ПРОГРЕСС RAW</b><b>${m.completed} / ${m.total} · ${m.percent}%</b></div>`+
        bar(m.percent,activeSegment);
      if(active&&current){
        let activity='';
        if(paused)activity='Пауза — сбор и прокрутка остановлены';
        else if(action)activity='Нужно действие пользователя в Яндекс Картах';
        else if(state.status===AUTO.IDLE)activity='Открываю запрос и запускаю RAW-сбор';
        else if(state.noProgressCycles>0)activity=`Проверяю, закончилась ли выдача: ${state.noProgressCycles}/${CFG.NO_PROGRESS_LIMIT}`;
        else activity='Собираю RAW-карточки без гео/категорийной фильтрации';
        const endPct=Math.min(100,Math.round(state.noProgressCycles/CFG.NO_PROGRESS_LIMIT*100));
        progress+=`<div style="margin-top:9px;border-top:1px solid #eee;padding-top:8px">`+
          `<div style="display:flex;justify-content:space-between;gap:8px"><span>Сейчас запрос <b>${m.currentNumber} из ${m.total}</b></span><b>${running?'● работает':paused?'Ⅱ пауза':'нужно действие'}</b></div>`+
          `<div style="margin-top:4px;font-size:11px;font-weight:700;word-break:break-word">${esc(current.query)}</div>`+
          `<div style="margin-top:4px;font-size:11px;color:#444">${esc(activity)}</div>`+
          `<div style="display:grid;grid-template-columns:1fr auto;gap:3px 10px;margin-top:7px;padding-top:6px;border-top:1px solid #eee;font-size:11px">`+
            `<span>RAW уникальных в запросе</span><b>${state.uniqueCount}</b>`+
            `<span>Новых сетевых карточек</span><b>${state.networkRequests}</b>`+
            `<span>FAST skip дублей</span><b>${state.fastSkippedDuplicates}</b>`+
            `<span>Из общего кэша</span><b>${state.reusedFromBatchCache}</b>`+
            `<span>Уникальных ID просмотрено</span><b>${state.totalEncountered}</b>`+
            `<span>Текущий запрос идёт</span><b>${fmtMs(m.currentElapsed)}</b>`+
            `<span>Новая организация</span><b>${m.lastNewAgo==null?'—':fmtMs(m.lastNewAgo)+' назад'}</b>`+
          `</div>`;
        if(running){
          progress+=`<div style="display:flex;justify-content:space-between;gap:8px;margin-top:7px;font-size:11px"><span>Проверка завершения выдачи</span><b>${state.noProgressCycles} / ${CFG.NO_PROGRESS_LIMIT}</b></div>${bar(endPct)}`;
        }
        progress+='</div>';
      }
      if(running||paused||action||finished||error){
        progress+=`<div style="display:grid;grid-template-columns:1fr auto;gap:3px 10px;margin-top:8px;padding-top:7px;border-top:1px solid #eee;font-size:11px">`+
          `<span>Прошло всего</span><b>${fmtMs(m.totalElapsed)}</b>`+
          `<span>Осталось примерно</span><b>${m.eta==null?'после 1-го запроса':'~'+fmtMs(m.eta)}</b>`+
        `</div>`;
      }
      progress+='</div>';
    }
    let stats='';
    if(!idle){stats=`<div style="margin-top:6px;line-height:1.5"><div>Запросов: ${batch.queue.length}</div>`;
      if(running||paused||action||finished||error)stats+=`<div>RAW уникальных организаций: <b>${batch.uniqueCount}</b></div><div>Всего попаданий по запросам: ${batch.sourceHits}</div><div>Хранилище: IndexedDB (расширение)</div>`;stats+='</div>';}
    let filter='';
    if((finished||error)&&batch.uniqueCount){
      const statusText=filterRunning?`${filterPct}%`:filterCompleted?'ГОТОВО':filterError?'ОШИБКА':'НЕ ЗАПУЩЕНА';
      filter=`<div style="margin-top:8px;padding:9px;border:1px solid #e5e7eb;border-radius:7px;background:#fafafa;font-size:11px">`+
        `<div style="display:flex;justify-content:space-between;gap:8px"><b>ЛОКАЛЬНАЯ ФИЛЬТРАЦИЯ</b><b>${statusText}</b></div>`;
      if(filterRunning)filter+=bar(filterPct)+`<div style="margin-top:4px">${batch.filterPhase==='LOADING_GEO'?'Проверяю локальные границы районов…':`Проверено ${fs.processed} / ${fs.total}`}</div>`;
      if(filterCompleted||filterError)filter+=`<div style="display:grid;grid-template-columns:1fr auto;gap:3px 10px;margin-top:6px">`+
        `<span>RAW</span><b>${fs.total}</b><span>Принято в FINAL</span><b>${fs.accepted}</b><span>Отсеяно категорией</span><b>${fs.rejectedCategory}</b><span>Отсеяно районом</span><b>${fs.rejectedDistrict}</b><span>Без координат</span><b>${fs.rejectedNoCoords||0}</b><span>Неопределённо</span><b>${fs.rejectedUnknown}</b><span>Район определён неоднозначно</span><b>${fs.ambiguousDistrict||0}</b></div>`;
      if(batch.geoInfo)filter+=`<div style="margin-top:5px;color:#444">Границы: ${esc(batch.geoInfo.source||'—')}${batch.geoInfo.quality?` · неоднозначная площадь ЮЗАО: ${batch.geoInfo.quality.ambiguousPercent}%`:''}</div>`;
      if(batch.filterError)filter+=`<div style="margin-top:5px;color:#a16207;word-break:break-word">Фильтр: ${esc(batch.filterError)}. RAW-данные сохранены.</div>`;
      filter+='</div>';
    }
    const warnList=(batch.warnings||[]);
    const warnBlock=warnList.length?`<div style="margin-top:8px;padding:8px;border:1px solid #f0c674;border-radius:7px;background:#fffbeb;font-size:11px;color:#7c5a00"><b>НЕПОЛНЫЙ СБОР: ${warnList.length} запрос(ов)</b>${warnList.slice(0,6).map(w=>`<div style="margin-top:3px;word-break:break-word">• ${esc(w.query)} → ${w.unique} карточек</div>`).join('')}${warnList.length>6?`<div style="margin-top:3px">…ещё ${warnList.length-6}</div>`:''}<div style="margin-top:4px">EXPORT RAW пометит файл как RAW_PARTIAL.</div></div>`:'';
    const geoSource=geoCache?.source||'не загружены';
    const geoAmb=geoCache?.quality?` · неоднозначная площадь: ${geoCache.quality.ambiguousPercent}%`:'';
    const geoBlock=`<div style="margin-top:8px;padding:8px;border:1px solid #e5e7eb;border-radius:7px;background:#fafafa;font-size:11px"><b>ГРАНИЦЫ РАЙОНОВ (офлайн)</b><div style="margin-top:3px;word-break:break-word">${esc(geoSource)}${geoAmb}</div>${btn('ЗАГРУЗИТЬ GeoJSON ГРАНИЦ С ДИСКА','geo-file')}${geoCache&&geoCache.source!==EMBEDDED_GEO_SOURCE?btn('ВЕРНУТЬ ВСТРОЕННЫЕ ГРАНИЦЫ','geo-reset'):''}${batch.geoError?`<div style="margin-top:5px;color:#a16207;word-break:break-word">${esc(batch.geoError)}</div>`:''}</div>`;
    const file=batch.fileName?`<div style="margin-top:4px;font-size:11px;word-break:break-word">Файл: ${esc(batch.fileName)}</div>`:'';
    const err=batch.error?`<div style="margin-top:6px;color:#a16207;font-size:11px;word-break:break-word">${esc(batch.error)}</div>`:'';
    let buttons='';
    if(idle)buttons=btn('ЗАГРУЗИТЬ CSV СО СПИСКОМ ЗАПРОСОВ','batch-file')+btn('IMPORT RAW CSV','batch-raw-file');
    if(ready)buttons=btn('ЗАГРУЗИТЬ ДРУГОЙ CSV','batch-file')+btn('IMPORT RAW CSV','batch-raw-file')+btn(`START RAW BATCH (${batch.queue.length})`,'batch-start');
    if(running)buttons=btn('PAUSE BATCH','batch-pause')+btn('STOP BATCH','batch-stop');
    if(paused||action)buttons=btn('RESUME BATCH','batch-resume')+btn('STOP BATCH','batch-stop');
    if(finished||error){
      buttons+=btn('IMPORT RAW CSV','batch-raw-file');
      if(batch.uniqueCount){buttons+=btn(`EXPORT RAW (${batch.uniqueCount})`,'batch-export-raw');if(!filterRunning)buttons+=btn(filterCompleted||filterError?'ПЕРЕФИЛЬТРОВАТЬ RAW → FINAL':'FILTER RAW → FINAL','batch-filter');if(filterCompleted&&batch.finalCount)buttons+=btn(`EXPORT FINAL (${batch.finalCount})`,'batch-export-final');}
      if(!filterRunning)buttons+=btn(`RESET BATCH — УДАЛИТЬ RAW (${batch.uniqueCount})`,'batch-reset','color:#a16207');
    }
    return `<div style="${divider}"><div style="font-size:13px;font-weight:700">BATCH QUERY QUEUE · v1.5.0 IDB-STORE</div><div style="margin-top:5px">Статус: <b>${batchLabel(s)}</b></div><div style="margin-top:2px;font-size:11px">Схема: <b>COLLECT RAW → LOCAL FILTER → FINAL</b></div><div style="margin-top:2px;font-size:11px">Границы 12 районов встроены локально. Геофильтр не использует сеть и запускается только после RAW.</div>${progress}${stats}${warnBlock}${filter}${geoBlock}${file}${err}${buttons}<input id="gls-batch-file" type="file" accept=".csv,text/csv,text/plain" style="display:none"><input id="gls-raw-file" type="file" accept=".csv,text/csv,text/plain" style="display:none"><input id="gls-geo-file" type="file" accept=".geojson,.json,application/geo+json,application/json" style="display:none"></div>`;
  };

  const render = () => {
    const panel=getPanel();if(!panel)return;
    panel.innerHTML=singleHtml()+batchHtml();
    const actions={
      'auto-start':startAuto,'auto-pause':pauseAuto,'auto-resume':resumeAuto,'auto-stop':stopAuto,'auto-reset':resetAuto,
      'batch-start':()=>startBatch().catch(batchFatal),'batch-pause':pauseBatch,'batch-resume':resumeBatch,'batch-stop':stopBatch,'batch-reset':()=>resetBatch().catch(batchFatal),'batch-export-raw':()=>exportBatchRaw().catch(batchFatal),'batch-filter':()=>filterBatch().catch(batchFatal),'batch-export-final':()=>exportBatchFinal().catch(batchFatal),
      'batch-file':()=>panel.querySelector('#gls-batch-file')?.click(),
      'batch-raw-file':()=>panel.querySelector('#gls-raw-file')?.click(),
      'geo-file':()=>panel.querySelector('#gls-geo-file')?.click(),
      'geo-reset':()=>resetGeoToEmbedded().catch(e=>patchBatch({geoError:e?.message||String(e)})),
    };
    panel.querySelectorAll('[data-gls-action]').forEach(b=>b.addEventListener('click',()=>actions[b.dataset.glsAction]?.()));
    const input=panel.querySelector('#gls-batch-file');
    if(input)input.addEventListener('change',async e=>{const file=e.target.files?.[0];e.target.value='';if(!file)return;try{await loadBatchText(await file.text(),file.name);}catch(err){await patchBatch({status:BATCH.ERROR,error:err?.message||String(err)});}});
    const rawInput=panel.querySelector('#gls-raw-file');
    if(rawInput)rawInput.addEventListener('change',async e=>{const file=e.target.files?.[0];e.target.value='';if(!file)return;try{await loadRawText(await file.text(),file.name);}catch(err){await patchBatch({status:BATCH.ERROR,error:err?.message||String(err)});}});
    const geoInput=panel.querySelector('#gls-geo-file');
    if(geoInput)geoInput.addEventListener('change',async e=>{const file=e.target.files?.[0];e.target.value='';if(!file)return;try{await importGeoJsonText(await file.text(),file.name);await patchBatch({geoError:null});}catch(err){await patchBatch({geoError:err?.message||String(err)});}});
  };

  // One-time move of a v1.4.x dataset out of the chrome.storage snapshot and
  // into IndexedDB. Ordered so that rows carrying provenance win: batch data
  // first, then the per-query scratch, then the card cache. Merging is keyed
  // and idempotent, so an interrupted migration simply resumes next time.
  const migrateLegacyDataset = async stored => {
    const legacyBatch=stored?.[BATCH_KEY], legacyAuto=stored?.[AUTO_KEY];
    if(legacyBatch?.storageVersion===2)return null;
    const batchRows=Array.isArray(legacyBatch?.data)?legacyBatch.data:[];
    const autoRows=Array.isArray(legacyAuto?.data)?legacyAuto.data:[];
    const finalRows=Array.isArray(legacyBatch?.finalData)?legacyBatch.finalData:[];
    const cacheRows=legacyBatch?.cardCache&&typeof legacyBatch.cardCache==='object'?Object.values(legacyBatch.cardCache):[];
    if(!legacyBatch&&!legacyAuto)return null;
    if(!batchRows.length&&!autoRows.length&&!cacheRows.length&&!finalRows.length){
      if(legacyBatch)await chrome.storage.local.set({[BATCH_KEY]:{...legacyBatch,storageVersion:2}});
      return null;
    }
    blog('migrating dataset to IndexedDB',{batchRows:batchRows.length,autoRows:autoRows.length,cacheRows:cacheRows.length,finalRows:finalRows.length});
    for(let i=0;i<batchRows.length;i+=STORE_PAGE)await store('putRaw',{records:batchRows.slice(i,i+STORE_PAGE),record:null});
    for(let i=0;i<autoRows.length;i+=STORE_PAGE)await store('putRaw',{records:autoRows.slice(i,i+STORE_PAGE),record:{district:'',group:'',category:'',query:String(legacyAuto?.currentSearchQuery||'')}});
    for(let i=0;i<cacheRows.length;i+=STORE_PAGE)await store('putRaw',{records:cacheRows.slice(i,i+STORE_PAGE),record:null});
    for(let i=0;i<finalRows.length;i+=STORE_PAGE)await store('putFinal',{records:finalRows.slice(i,i+STORE_PAGE)});
    const totals=await store('recount');
    const nextBatch={...(legacyBatch||blankBatch()),storageVersion:2,uniqueCount:totals.rawUnique,sourceHits:totals.rawSourceHits,finalCount:totals.finalCount};
    delete nextBatch.data;delete nextBatch.cardCache;delete nextBatch.finalData;
    const nextAuto=legacyAuto?{...legacyAuto}:null;
    if(nextAuto)delete nextAuto.data;
    const write={[BATCH_KEY]:nextBatch};if(nextAuto)write[AUTO_KEY]=nextAuto;
    await chrome.storage.local.set(write);
    stored[BATCH_KEY]=nextBatch;if(nextAuto)stored[AUTO_KEY]=nextAuto;
    blog('dataset migrated',totals);
    return totals;
  };

  const restore = async () => {
    let stored=null;
    try{
      stored=await chrome.storage.local.get([AUTO_KEY,BATCH_KEY]);
      // Never let a migration failure hide the control state - the registry is
      // still in chrome.storage at that point and is not touched on failure.
      try{await migrateLegacyDataset(stored);}catch(e){blog('dataset migration failed',e?.message||e);}
      if(stored?.[AUTO_KEY]?.status){state={...blankAuto(),...stored[AUTO_KEY]};delete state.data;seenUrls=new Set(Array.isArray(state.seenUrls)?state.seenUrls:[]);seenPlaceIds=new Set(Array.isArray(state.seenPlaceIds)?state.seenPlaceIds:[]);acceptedKeys=new Set(Array.isArray(state.acceptedKeys)?state.acceptedKeys:[]);}
      if(stored?.[BATCH_KEY]?.status){batch={...blankBatch(),...stored[BATCH_KEY],queue:Array.isArray(stored[BATCH_KEY].queue)?stored[BATCH_KEY].queue:[],filterStats:{...blankBatch().filterStats,...(stored[BATCH_KEY].filterStats||{})},warnings:Array.isArray(stored[BATCH_KEY].warnings)?stored[BATCH_KEY].warnings:[]};delete batch.data;delete batch.cardCache;delete batch.finalData;if(batch.filterStatus==='RUNNING'){batch.filterStatus='ERROR';batch.filterPhase='ERROR';batch.filterError='Локальная фильтрация была прервана перезагрузкой страницы. RAW-данные сохранены; запустите фильтрацию ещё раз.';}}
    }catch(e){blog('restore failed',e?.message||e);}
    // The store is the source of truth for the totals, not the snapshot.
    try{batch={...batch,...await storeTotals()};}catch(e){blog('store unavailable',e?.message||e);}
    render();

    // Batch owns navigation while active. Do not apply the single-query mismatch stop rule.
    if([BATCH.RUNNING,BATCH.USER_ACTION_REQUIRED].includes(batch.status)){
      if(batch.status===BATCH.USER_ACTION_REQUIRED && challenged())return;
      if(batch.status===BATCH.USER_ACTION_REQUIRED)batch.status=BATCH.RUNNING;
      await persistBatch();setTimeout(()=>runBatchCurrent().catch(batchFatal),250);return;
    }

    const q=getQuery();
    if(state.status===AUTO.RUNNING && state.currentSearchQuery && q && normalize(state.currentSearchQuery)!==normalize(q)){
      state.status=AUTO.STOPPED;state.error='Поисковый запрос изменился. Нажмите RESET перед новым сбором.';await persistAuto();
    }
    if(state.status===AUTO.RUNNING)ensureLoop();
  };

  const mount=()=>{render();if(!getPanel())setTimeout(mount,400);};
  const uiTicker=setInterval(()=>{if([BATCH.RUNNING,BATCH.PAUSED,BATCH.USER_ACTION_REQUIRED].includes(batch.status)||state.status===AUTO.RUNNING)render();},1000);
  window.addEventListener('unload',()=>clearInterval(uiTicker),{once:true});
  const mo=new MutationObserver(()=>{if(!getPanel())render();});mo.observe(document.documentElement,{subtree:true,childList:true});
  void ensureGeo().then(render).catch(e=>console.warn('[GEO] boundaries unavailable',e));
  restore();mount();
})();

