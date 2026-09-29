// Reads one RainViewer radar frame and answers "is it raining over our area, and if not, where is the
// nearest rain?", so an empty radar overlay doesn't look broken. Tiles allow CORS (Access-Control-Allow-Origin: *),
// so their pixels can be read in the browser. Zoom 7 is the free tier's most detailed level (~1 km per pixel here).
import { CONFIG } from './config.js';

const Z = 7;
const WORLD = 256 * 2 ** Z;
const lngToX = (lng) => ((lng + 180) / 360) * WORLD;
const latToY = (lat) => {
  const s = Math.sin((lat * Math.PI) / 180);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * WORLD;
};
const xToLng = (x) => (x / WORLD) * 360 - 180;
const yToLat = (y) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / WORLD))) * 180) / Math.PI;
const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

async function tileBitmap(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`radar tile HTTP ${res.status}`);
  return createImageBitmap(await res.blob());
}

/**
 * host + frame: from RainViewer's weather-maps.json.  scanKm: how far around the area to look.
 * Returns { pct } when it rains over the area (share of the area with rain),
 * { nearKm, dir } for the nearest rain outside it, or { none: true } within scanKm.
 */
export async function rainOverArea(host, frame, scanKm) {
  const [[w, s], [e, n]] = CONFIG.map.bounds;
  const padLat = scanKm / 110.5, padLng = scanKm / 107.6;
  const x0 = lngToX(w - padLng), x1 = lngToX(e + padLng);
  const y0 = latToY(n + padLat), y1 = latToY(s - padLat);
  const tx0 = Math.floor(x0 / 256), tx1 = Math.floor(x1 / 256);
  const ty0 = Math.floor(y0 / 256), ty1 = Math.floor(y1 / 256);

  const canvas = document.createElement('canvas');
  canvas.width = (tx1 - tx0 + 1) * 256;
  canvas.height = (ty1 - ty0 + 1) * 256;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  const jobs = [];
  for (let tx = tx0; tx <= tx1; tx++) {
    for (let ty = ty0; ty <= ty1; ty++) {
      const url = `${host}${frame.path}/256/${Z}/${tx}/${ty}/${CONFIG.radar.color}/1_1.png`;
      jobs.push(tileBitmap(url).then((bmp) => g.drawImage(bmp, (tx - tx0) * 256, (ty - ty0) * 256)));
    }
  }
  await Promise.all(jobs);
  const data = g.getImageData(0, 0, canvas.width, canvas.height).data;

  const cx = (w + e) / 2, cy = (s + n) / 2;
  let inside = 0, total = 0, best = null;
  const pxFrom = Math.max(0, Math.floor(x0 - tx0 * 256)), pxTo = Math.min(canvas.width, Math.ceil(x1 - tx0 * 256));
  const pyFrom = Math.max(0, Math.floor(y0 - ty0 * 256)), pyTo = Math.min(canvas.height, Math.ceil(y1 - ty0 * 256));
  for (let py = pyFrom; py < pyTo; py++) {
    const lat = yToLat(ty0 * 256 + py + 0.5);
    for (let px = pxFrom; px < pxTo; px++) {
      const lng = xToLng(tx0 * 256 + px + 0.5);
      const inArea = lat >= s && lat <= n && lng >= w && lng <= e;
      if (inArea) total++;
      if (data[(py * canvas.width + px) * 4 + 3] === 0) continue;   // transparent = no rain
      if (inArea) { inside++; continue; }
      const dLat = Math.max(s - lat, 0, lat - n), dLng = Math.max(w - lng, 0, lng - e);
      const km = Math.hypot(dLat * 110.5, dLng * 107.6);
      if (km <= scanKm && (!best || km < best.km)) best = { km, lat, lng };
    }
  }
  if (inside) return { pct: (inside / Math.max(total, 1)) * 100 };
  if (!best) return { none: true };
  const angle = ((Math.atan2(best.lng - cx, best.lat - cy) * 180) / Math.PI + 360) % 360;
  return { nearKm: best.km, dir: DIRS[Math.round(angle / 45) % 8] };
}
