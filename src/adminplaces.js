// Admin "🏭 โรงงาน" tab: the factory list behind the search box.
// OSM names are read-only; admins add their own (tap the map / drag the pin) or import a CSV.
import { t, errText } from './i18n.js';
import { el, toast, inArea } from './ui.js';
import { createDrawer } from './draw.js';
import { norm } from './places.js';

/** Minimal CSV parser: commas, quoted fields ("a, b" and "" escapes), CRLF. */
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (c === '"') quoted = false; else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

/** CSV → { rows: [{ name, nameEn, lat, lng }], skipped }. Header: name, name_en, lat, lng (lon/longitude/latitude accepted). */
export function placesFromCsv(text) {
  const [head = [], ...body] = parseCsv(text.replace(/^﻿/, ''));
  const h = head.map((x) => x.trim().toLowerCase());
  const col = (...names) => h.findIndex((x) => names.includes(x));
  const iName = col('name', 'ชื่อ'), iEn = col('name_en', 'name:en', 'english'), iLat = col('lat', 'latitude'), iLng = col('lng', 'lon', 'long', 'longitude');
  if (iName < 0 || iLat < 0 || iLng < 0) throw new Error('csv_header');
  const rows = [];
  let skipped = 0;
  for (const r of body) {
    const name = (r[iName] || '').trim();
    const lat = parseFloat(r[iLat]), lng = parseFloat(r[iLng]);
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lng) || !inArea(lat, lng)) { skipped++; continue; }
    rows.push({ name, nameEn: iEn >= 0 ? (r[iEn] || '').trim() || null : null, lat, lng });
  }
  return { rows, skipped };
}

/**
 * env: { map, api, box, ctx, places(): list, reload(): Promise, setEditing(bool) }
 */
export function renderPlacesTab(env) {
  const { api, box, places } = env;
  const all = places();
  const filter = el('input', { type: 'search', placeholder: t('places.filter') });
  const list = el('div', { class: 'place-list' });
  const file = el('input', { type: 'file', accept: '.csv,text/csv', hidden: true });

  const draw = () => {
    const q = norm(filter.value);
    const shown = all.filter((p) => !q || norm(p.name).includes(q) || norm(p.nameEn).includes(q)).slice(0, 300);
    list.replaceChildren(...shown.map((p) => el('div', { class: 'place-row' },
      el('div', { class: 'place-name' }, p.name, p.nameEn || p.where ? el('small', {}, [p.nameEn, p.where].filter(Boolean).join(' · ')) : null),
      p.src !== 'admin'
        ? el('span', { class: 'chip chip-path' }, p.src === 'moi' ? t('places.srcMoi') : 'OSM')
        : el('span', { class: 'row' },
          el('button', { type: 'button', class: 'ghost small', onclick: () => openForm(env, p) }, '✎'),
          el('button', { type: 'button', class: 'ghost small', onclick: () => remove(p) }, '🗑')))));
  };

  async function remove(p) {
    if (!window.confirm(t('places.deleteConfirm', { n: p.name }))) return;
    try { await api.deletePlace(p.id); toast(t('places.deleted')); await env.reload(); } catch (e) { toast(errText(e)); }
  }

  file.addEventListener('change', async () => {
    const f = file.files[0];
    file.value = '';
    if (!f) return;
    try {
      const { rows, skipped } = placesFromCsv(await f.text());
      const n = rows.length ? await api.importPlaces(rows) : 0;
      toast(t('places.imported', { n, s: skipped }), 6000);
      await env.reload();
    } catch (e) {
      console.error(e);
      toast(e.message === 'csv_header' ? t('places.csvHeader') : errText(e), 6000);
    }
  });

  filter.addEventListener('input', draw);
  box.replaceChildren(el('div', { class: 'card places' },
    el('div', { class: 'row' },
      el('button', { type: 'button', class: 'primary', onclick: () => openForm(env, null) }, t('places.add')),
      el('button', { type: 'button', class: 'ghost', onclick: () => file.click() }, t('places.import'))),
    file,
    el('p', { class: 'meta' }, t('places.csvHint')),
    el('p', { class: 'meta' }, t('places.count', { a: all.filter((p) => p.src === 'admin').length, m: all.filter((p) => p.src === 'moi').length, o: all.filter((p) => p.src === 'osm').length })),
    filter, list));
  draw();
}

/** Add (p = null) or edit a place: name, English name, and a draggable pin (tap the map to move it). */
function openForm(env, p) {
  const { map, api, box, ctx } = env;
  env.setEditing(true);
  const name = el('input', { type: 'text', maxlength: 160, value: p?.name || '' });
  const nameEn = el('input', { type: 'text', maxlength: 160, value: p?.nameEn || '' });
  const at = p ? [p.lng, p.lat] : map.getCenter().toArray();
  const drawer = createDrawer(map, { point: at, color: '#0d4f8b' });
  ctx.drawing = true;
  const onTap = (e) => drawer.movePin(e.lngLat);   // tap the map to drop the pin there
  map.on('click', onTap);
  map.easeTo({ center: at, zoom: Math.max(map.getZoom(), 16) });

  const done = async (reload) => {
    map.off('click', onTap);
    drawer.destroy();
    ctx.drawing = false;
    env.setEditing(false);
    if (reload) await env.reload(); else renderPlacesTab(env);
  };
  const save = el('button', { type: 'button', class: 'primary' }, t('admin.save'));
  save.addEventListener('click', async () => {
    const { lat, lng } = drawer.value();
    if (!name.value.trim()) return toast(t('places.needName'));
    if (!inArea(lat, lng)) return toast(t('err.outside_area'));
    save.disabled = true;
    try {
      const data = { name: name.value, nameEn: nameEn.value, lat, lng };
      if (p) await api.updatePlace(p.id, data); else await api.addPlace(data);
      toast(t('places.saved'));
      await done(true);
    } catch (e) { toast(errText(e)); save.disabled = false; }
  });

  box.replaceChildren(el('article', { class: 'card editor' },
    el('h2', {}, t(p ? 'places.editTitle' : 'places.addTitle')),
    el('p', { class: 'hint' }, '📍 ', t('places.pinHint')),
    el('label', { class: 'field' }, t('places.name'), name),
    el('label', { class: 'field' }, t('places.nameEn'), nameEn),
    el('div', { class: 'row' }, el('button', { type: 'button', class: 'ghost', onclick: () => done(false) }, t('report.cancel')), save)));
  name.focus();
}
