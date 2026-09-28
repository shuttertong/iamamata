// Admin review page: pending reports (help requests first, with evidence flags),
// open help requests (contact + mark as helped), and edit suggestions.
import { CONFIG } from './config.js';
import { t, applyI18n, toggleLang, errText } from './i18n.js';
import { el, toast, debounce, timeAgo, distM, depthOf, pathLength, fmtLength } from './ui.js';
import { createMap, whenLoaded, addAreaLayer, addReportLayer, setReports, showReport, pin } from './map.js';
import { createApi } from './api.js';
import { hamming } from './photo.js';
import { showPhotos, summary } from './detail.js';
import { openAdminEdit } from './adminedit.js';
import { renderPlacesTab } from './adminplaces.js';
import { loadPlaces } from './places.js';
import { createSearch } from './search.js';

const $ = (id) => document.getElementById(id);
const REASONS = ['duplicate', 'not_flood', 'inappropriate', 'other'];
const TABS = { queue: 'tabQueue', help: 'tabHelp', edits: 'tabEdits', all: 'tabAll', places: 'tabPlaces' };

applyI18n();
const api = await createApi();
const map = createMap('map');
let data = { pending: [], help: [], active: [], edits: [] };
let tab = 'queue';
let focusPins = [];
let editing = false;          // the editor owns the side panel; realtime reloads must not redraw over it
const ctx = { drawing: false }; // map taps add path points while the editor draws

// The list can load (after login) before the map style does, so wait for the layers before drawing.
const mapReady = whenLoaded(map).then(() => addAreaLayer(map)).then(() => {
  addReportLayer(map, (id) => {
    if (ctx.drawing) return;
    const r = data.active.find((x) => x.id === id);
    if (r) edit(r);   // tap any report on the map to edit it
  });
  map.addSource('preview', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({ id: 'preview', type: 'line', source: 'preview', paint: { 'line-color': '#1565c0', 'line-width': 5, 'line-dasharray': [1.5, 1] } });
});

function drawChrome() {
  $('lang').textContent = t('lang.other');
  $('mode').hidden = api.mode !== 'demo';
  $('mode').textContent = t('mode.demo');
  $('demoHint').hidden = api.mode !== 'demo';
}

/** Evidence checks shown on each pending report. */
function flags(r) {
  const { staleHours, farKm, nearM, similarBits } = CONFIG.review;
  const out = [];
  const others = data.active.filter((o) => o.id !== r.id);
  if (r.photos.length) out.push(['ok', t('flag.photo')]);
  if (r.photoTakenAt && new Date(r.createdAt) - new Date(r.photoTakenAt) > staleHours * 3600e3) out.push(['warn', t('flag.stale', { h: staleHours })]);
  if (r.deviceDistanceM == null) out.push(['info', t('flag.noGps')]);
  else if (r.deviceDistanceM > farKm * 1000) out.push(['warn', t('flag.far', { km: farKm })]);
  if (r.photoHash && others.some((o) => o.photoHash && hamming(o.photoHash, r.photoHash) <= similarBits)) out.push(['warn', t('flag.similar')]);
  const near = others.filter((o) => distM(o, r) <= nearM).length;
  if (near) out.push(['info', t('flag.near', { n: near })]);
  return out;
}

function preview(path) {
  map.getSource('preview')?.setData(path
    ? { type: 'Feature', geometry: { type: 'LineString', coordinates: path }, properties: {} }
    : { type: 'FeatureCollection', features: [] });
}

function focus(r, extra = []) {
  focusPins.forEach((m) => m.remove());
  focusPins = [{ lat: r.lat, lng: r.lng, color: r.kind === 'help' ? CONFIG.help.color : depthOf(r.depth).color }, ...extra]
    .filter((p) => p.lat != null)
    .map((p) => pin(map, [p.lng, p.lat], p.color));
  showReport(map, r);
}

function edit(r) {
  focusPins.forEach((m) => m.remove());
  focusPins = [];
  preview(null);
  editing = true;
  openAdminEdit({ map, api, box: $('list'), tabs: document.querySelector('.tabs'), ctx }, r, async () => {
    editing = false;
    await load();
  });
}

const editButton = (r) => el('button', { type: 'button', class: 'ghost', onclick: () => edit(r) }, t('admin.edit'));

async function act(btn, fn, doneText) {
  btn.disabled = true;
  try { await fn(); toast(doneText); await load(); } catch (e) { console.error(e); toast(errText(e)); btn.disabled = false; }
}

function contactBlock(r) {
  if (r.kind !== 'help') return null;
  const c = r.contact;
  if (!c) return el('p', { class: 'contact muted' }, t('admin.noContact'));
  return el('p', { class: 'contact' }, c.name ? `${c.name} · ` : '', el('a', { href: `tel:${c.phone}` }, `📞 ${c.phone}`));
}

function card(r, ...rest) {
  const node = el('article', { class: `card${r.kind === 'help' ? ' card-help' : ''}`, 'data-id': r.id },
    el('div', { class: 'row between' }, el('span', { class: 'meta' }, timeAgo(r.createdAt)), r.kind === 'help' && r.status === 'approved' ? el('span', { class: 'chip chip-ok' }, t('detail.approved')) : null),
    ...summary(r),
    r.note ? el('p', { class: 'note' }, r.note) : null,
    ...rest);
  node.addEventListener('click', (e) => {
    if (e.target.closest('button, select, img, a')) return;
    preview(null);
    focus(r);
  });
  return node;
}

function reportCard(r) {
  const photos = el('div', { class: 'photos' });
  showPhotos(api, r.photos, photos);
  const reason = el('select', { 'aria-label': t('admin.reason') }, REASONS.map((k) => el('option', { value: k }, t(`reason.${k}`))));
  const approve = el('button', { type: 'button', class: 'primary' }, t('admin.approve'));
  const reject = el('button', { type: 'button', class: 'danger' }, t('admin.reject'));
  approve.addEventListener('click', () => act(approve, () => api.review(r, true), t('admin.approved')));
  reject.addEventListener('click', () => act(reject, () => api.review(r, false, reason.value), t('admin.rejected')));
  return card(r,
    contactBlock(r),
    el('div', { class: 'flags' }, flags(r).map(([k, s]) => el('span', { class: `flag flag-${k}` }, s))),
    photos,
    el('div', { class: 'row' }, reason, reject, approve),
    el('div', { class: 'row' }, editButton(r)));
}

function helpCard(r) {
  const done = el('button', { type: 'button', class: 'primary' }, t('admin.markResolved'));
  done.addEventListener('click', () => act(done, () => api.closeReport(r.id), t('admin.resolved')));
  return card(r, contactBlock(r), el('div', { class: 'row' }, editButton(r), done));
}

function allCard(r) {
  return card(r, contactBlock(r), el('div', { class: 'row' }, editButton(r)));
}

function editCard(e) {
  const r = data.active.find((x) => x.id === e.reportId);
  if (!r) return null;
  let text;
  if (e.kind === 'move') text = e.path ? `${t('edit.path')} (${fmtLength(pathLength(e.path))})` : t('edit.move', { m: Math.round(distM(r, e)) });
  else if (e.kind === 'depth') text = t('edit.depth', { d: t(depthOf(e.depth).key) });
  else text = t(e.kind === 'resolved' ? 'edit.resolved' : 'edit.receded');
  const approve = el('button', { type: 'button', class: 'primary' }, t('admin.approve'));
  const reject = el('button', { type: 'button', class: 'danger' }, t('admin.reject'));
  approve.addEventListener('click', () => act(approve, () => api.reviewEdit(e.id, true), t('admin.approved')));
  reject.addEventListener('click', () => act(reject, () => api.reviewEdit(e.id, false), t('admin.rejected')));
  const node = el('article', { class: 'card' },
    el('div', { class: 'row between' }, el('span', { class: 'meta' }, timeAgo(e.createdAt))),
    ...summary(r),
    el('p', { class: 'note' }, `→ ${text}`),
    el('div', { class: 'row' }, reject, approve));
  node.addEventListener('click', (ev) => {
    if (ev.target.closest('button')) return;
    preview(e.kind === 'move' ? e.path : null);
    focus(r, e.kind === 'move' && !e.path ? [{ lat: e.lat, lng: e.lng, color: '#1565c0' }] : []);
  });
  return node;
}

let places = [];
async function reloadPlaces() {
  places = await loadPlaces(api);
  render();
}
const search = createSearch($('search'), { map, getPlaces: () => places });

function render() {
  if (editing) return;
  const approved = data.active.filter((r) => r.status === 'approved');
  $('tabPlaces').textContent = t('places.tab', { n: places.length });
  $('tabAll').textContent = t('admin.allTab', { n: approved.length });
  $('tabQueue').textContent = t('admin.queue', { n: data.pending.length });
  $('tabHelp').textContent = t('admin.helpTab', { n: data.help.length });
  $('tabEdits').textContent = t('admin.edits', { n: data.edits.length });
  for (const [k, id] of Object.entries(TABS)) $(id).setAttribute('aria-selected', String(tab === k));
  if (tab === 'places') {
    renderPlacesTab({
      map, api, box: $('list'), ctx, places: () => places, reload: reloadPlaces,
      setEditing: (on) => { editing = on; },
    });
    return;
  }
  const cards = tab === 'queue' ? data.pending.map(reportCard)
    : tab === 'help' ? data.help.map(helpCard)
    : tab === 'all' ? approved.map(allCard)
    : data.edits.map(editCard).filter(Boolean);
  const empty = t(tab === 'help' ? 'admin.emptyHelp' : tab === 'all' ? 'admin.emptyAll' : 'admin.empty');
  $('list').replaceChildren(...(cards.length ? cards : [el('p', { class: 'empty' }, empty)]));
}

async function load() {
  try {
    data = await api.listForReview();
    render();
    await mapReady;
    setReports(map, data.active);
  } catch (e) { console.error(e); toast(t('err.load')); }
}

async function showMain() {
  $('login').hidden = true;
  $('main').hidden = false;
  $('logout').hidden = false;
  map.resize();
  await Promise.all([load(), reloadPlaces()]);
}

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api.signIn($('email').value.trim(), $('password').value);
    if (!(await api.isAdmin())) { await api.signOut(); return toast(t('admin.notAdmin')); }
    showMain();
  } catch (err) { toast(errText(err)); }
});
$('logout').addEventListener('click', async () => { await api.signOut(); location.reload(); });
$('lang').addEventListener('click', () => { toggleLang(); drawChrome(); search.label(); render(); });
for (const [k, id] of Object.entries(TABS)) $(id).addEventListener('click', () => { tab = k; preview(null); render(); });

drawChrome();
api.subscribe(debounce(() => { if (!$('main').hidden) load(); }, 400));
if (await api.isAdmin()) showMain();

window.__flood = { api, map, load, get data() { return data; } };
