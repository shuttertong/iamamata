// Factory names for the search box: OSM names (data/factories.json, baked) + places admins added (api.listPlaces()).
import { CONFIG } from './config.js';
import { thaiKey, soundScore } from './phonetic.js';

// Words that don't help find a factory: "บริษัท … จำกัด", "Co., Ltd.", "(Thailand)".
const NOISE_TH = /บริษัท|บจก\.?|บมจ\.?|หจก\.?|จำกัด|\(?มหาชน\)?|\(?ประเทศไทย\)?/g;
const NOISE_EN = /\b(co|ltd|limited|inc|corp|corporation|company|public|pcl|thailand)\b\.?/g;

/** Lower-case, drop company boilerplate, spaces and punctuation, so "บจก. สยาม ยูเคน" matches "สยามยูเคน". */
export const norm = (s) => (s || '').toLowerCase()
  .replace(NOISE_TH, ' ').replace(NOISE_EN, ' ')
  .replace(/[\s.,()/\-–_'"&+]+/g, '');

let baked = null;

async function loadFile(url) {
  try {
    const json = await (await fetch(url, { cache: 'no-cache' })).json();
    const src = json.src || 'osm';
    return json.places.map((p) => ({ name: p.n, nameEn: p.en || null, what: p.d || null, where: p.a || null, lat: p.lat, lng: p.lng, src }));
  } catch (e) { console.warn('factories', url, e); return []; }
}

/**
 * [{ id?, name, nameEn, what, where, lat, lng, src: 'admin' | 'moi' | 'osm' }]
 * The same name within ~150 m is listed once (admin > Ministry of Industry > OSM).
 */
export async function loadPlaces(api) {
  baked ??= (await Promise.all([].concat(CONFIG.map.factories).map(loadFile))).flat();
  let added = [];
  try { added = (await api.listPlaces()).map((p) => ({ ...p, src: 'admin' })); } catch (e) { console.warn('places', e); }
  const seen = new Set();
  return [...added, ...baked].filter((p) => {
    const key = `${norm(p.name)}|${p.lat.toFixed(3)}|${p.lng.toFixed(3)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const soundKeys = new WeakMap();   // place → { words, whole } sound keys of its name (computed once)
const keysOf = (p) => {
  if (!soundKeys.has(p)) {
    const plain = (p.name || '').toLowerCase().replace(NOISE_TH, ' ').replace(NOISE_EN, ' ');
    const words = plain.split(/[\s()/,.\-–]+/).map(thaiKey).filter(Boolean);
    soundKeys.set(p, { words, whole: words.join('') });
  }
  return soundKeys.get(p);
};

/**
 * Ranked matches: name starts with the query (3) > contains it (2) > contains every word (1)
 * > for Latin queries, sounds like it (0.5 − distance): "toyota" finds โตโยต้า.
 */
export function searchPlaces(places, query, limit = 8) {
  const q = norm(query);
  if (!q) return [];
  const words = query.toLowerCase().split(/\s+/).map(norm).filter(Boolean);
  const latin = /[a-z]/i.test(query);
  const plain = query.replace(/\b(co|ltd|limited|inc|corp|corporation|company|public|pcl|thailand|of|the|and)\b\.?/gi, ' ');
  const hits = [];
  for (const p of places) {
    const a = norm(p.name);
    const b = norm(p.nameEn);
    let score = 0;
    if (a.startsWith(q) || b.startsWith(q)) score = 3;
    else if (a.includes(q) || b.includes(q)) score = 2;
    else if (words.length > 1 && words.every((w) => a.includes(w) || b.includes(w))) score = 1;
    else if (latin && plain.trim()) {
      const { words: ws, whole } = keysOf(p);
      score = soundScore(ws, whole, plain);
    }
    if (score > 0) hits.push([score, p]);
  }
  return hits
    .sort((x, y) => y[0] - x[0] || x[1].name.localeCompare(y[1].name, 'th'))
    .slice(0, limit)
    .map(([, p]) => p);
}
