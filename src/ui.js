// Small DOM and math helpers shared by both pages.
import { CONFIG } from './config.js';
import { t } from './i18n.js';

/** el('div', { class: 'x', onclick }, child, 'text') — text children become text nodes (safe for user input). */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k === 'class') node.className = v;
    else if (k === 'style') node.style.cssText = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

let toastTimer = 0;
export function toast(msg, ms = 3500) {
  const box = document.getElementById('toast');
  if (!box) return;
  box.textContent = msg;
  box.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { box.hidden = true; }, ms);
}

export function timeAgo(date) {
  const min = Math.round((Date.now() - new Date(date)) / 60000);
  if (min < 1) return t('time.now');
  if (min < 60) return t('time.min', { n: min });
  if (min < 48 * 60) return t('time.hour', { n: Math.round(min / 60) });
  return t('time.day', { n: Math.round(min / 1440) });
}

export function timeLeft(date) {
  const min = Math.max(0, Math.round((new Date(date) - Date.now()) / 60000));
  return min < 60 ? t('time.inMin', { n: min }) : t('time.inHour', { n: Math.round(min / 60) });
}

/** Great-circle distance in metres between {lat, lng} points. */
export function distM(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Length in metres of a [[lng, lat], ...] path. */
export function pathLength(path) {
  let m = 0;
  for (let i = 1; i < (path?.length || 0); i++) {
    m += distM({ lng: path[i - 1][0], lat: path[i - 1][1] }, { lng: path[i][0], lat: path[i][1] });
  }
  return m;
}

export const fmtLength = (m) => (m < 1000 ? t('unit.m', { n: Math.round(m) }) : t('unit.km', { n: (m / 1000).toFixed(1) }));

/** Inside the service area (CONFIG.map.bounds)? */
export function inArea(lat, lng) {
  if (!CONFIG.map.bounds) return true;
  const [[w, s], [e, n]] = CONFIG.map.bounds;
  return lat >= s && lat <= n && lng >= w && lng <= e;
}

export const depthOf = (id) => CONFIG.depths.find((d) => d.id === id) || CONFIG.depths[0];

export function debounce(fn, ms) {
  let id = 0;
  return (...a) => { clearTimeout(id); id = setTimeout(() => fn(...a), ms); };
}

/** crypto.randomUUID needs a secure context; plain http on a LAN IP does not have one. */
export function uuid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Colour swatch + label for a depth level. */
export function depthBadge(id) {
  const d = depthOf(id);
  return el('span', { class: 'depth' }, el('i', { style: `background:${d.color}` }), t(d.key));
}

export function renderLegend(box) {
  box.replaceChildren(
    ...CONFIG.depths.map((d) => depthBadge(d.id)),
    el('span', { class: 'depth' }, el('b', { class: 'path-swatch' }), t('legend.path')),
    el('span', { class: 'depth' }, el('b', { class: 'road-swatch' }), t('legend.roads')),
    el('span', { class: 'depth' }, el('b', { class: 'gistda-swatch' }), t('legend.gistda')),
    el('span', { class: 'depth' }, el('i', { class: 'sos-dot' }), t('legend.help')),
    el('span', { class: 'depth' }, el('i', { class: 'pending-dot' }), t('legend.pending')),
  );
}

// ── Bottom sheet (side panel on wide screens) ───────────────────────
let sheetCleanup = null;

/** Shows content in ctx.sheet and pads the map so the sheet never covers the pin. */
export function openSheet(ctx, children, cleanup = null) {
  closeSheet(ctx, false);
  sheetCleanup = cleanup;
  ctx.sheet.replaceChildren(...children);
  ctx.sheet.hidden = false;
  document.body.classList.add('sheet-open');
  const wide = window.innerWidth >= 800;
  const pad = wide ? { left: ctx.sheet.offsetWidth + 16, bottom: 0 } : { left: 0, bottom: ctx.sheet.offsetHeight };
  ctx.map.easeTo({ padding: { top: 0, right: 0, ...pad }, duration: 250 });
}

export function closeSheet(ctx, unpad = true) {
  const fn = sheetCleanup;
  sheetCleanup = null;
  fn?.();
  ctx.sheet.hidden = true;
  document.body.classList.remove('sheet-open');
  ctx.sheet.replaceChildren();
  if (unpad) ctx.map.easeTo({ padding: { top: 0, right: 0, bottom: 0, left: 0 }, duration: 250 });
}

/** Device position once, or null (denied / unavailable). */
export function locate() {
  return new Promise((res) => {
    if (!navigator.geolocation) return res(null);
    navigator.geolocation.getCurrentPosition(
      (p) => res({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }),
      () => res(null),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  });
}
