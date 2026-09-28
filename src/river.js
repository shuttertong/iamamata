// Bang Pakong river water level from ThaiWater (คลังข้อมูลน้ำแห่งชาติ, HII): telemetry stations along the
// main river, downstream → upstream. The station nearest us (บางปะกง, BPK001) gets a marker on the map,
// a chip and a 3-day chart with the river bank; upstream stations show what is coming down the river.
/* global maplibregl */
import { CONFIG } from './config.js';
import { t } from './i18n.js';
import { el, openSheet, closeSheet } from './ui.js';
import { lineChart } from './chart.js';

const V = CONFIG.river;
const API = 'https://api-v3.thaiwater.net/api/v1/thaiwater30/public/waterlevel_graph';
const ymd = (d) => d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
const hhmm = (d) => d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false });
const signed = (m) => `${m >= 0 ? '+' : ''}${m.toFixed(2)}`;

/** ThaiWater's situation bands, by % of the channel filled (ground → bank). */
function situation(pct) {
  if (pct > 100) return 'over';
  if (pct > 70) return 'high';
  if (pct > 30) return 'normal';
  if (pct > 10) return 'low';
  return 'dry';
}

async function loadStation(s, days) {
  const now = new Date();
  const q = new URLSearchParams({
    station_type: 'tele_waterlevel', station_id: s.id,
    start_date: ymd(new Date(now.getTime() - days * 86400e3)), end_date: ymd(now),
  });
  const json = await (await fetch(`${API}?${q}`)).json();
  const d = json.data;
  const pts = d.graph_data.map((p) => ({ time: new Date(`${p.datetime.replace(' ', 'T')}:00+07:00`), m: p.value }));
  const valid = pts.filter((p) => p.m != null);
  if (!valid.length) return { ...s, pts, ok: false };
  const last = valid.at(-1);
  const at = (hoursAgo) => valid.findLast((p) => p.time.getTime() <= last.time.getTime() - hoursAgo * 3600e3);
  const bank = d.min_bank, ground = d.ground_level;
  const pct = bank > ground ? ((last.m - ground) / (bank - ground)) * 100 : null;
  return {
    ...s, pts, ok: true, bank, ground, last, pct,
    level: pct == null ? 'normal' : situation(pct),
    toBank: bank - last.m,                           // > 0: below the bank; < 0: over it
    change1h: at(1) ? last.m - at(1).m : null,
    change24h: at(24) ? last.m - at(24).m : null,
  };
}

const trendArrow = (c) => (c == null ? '' : c > V.trendM ? '↑' : c < -V.trendM ? '↓' : '→');

export function createRiver(ctx, box, map) {
  let data = [];
  const chip = el('button', { type: 'button', class: 'river-chip', hidden: true });
  box.prepend(chip);
  const markerEl = el('button', { type: 'button', class: 'river-marker', hidden: true });
  let marker = null;

  const main = () => data.find((s) => s.main && s.ok);

  function draw() {
    const m = main();
    if (!m) { chip.hidden = true; markerEl.hidden = true; return; }
    const over = data.filter((s) => !s.main && s.ok && s.level === 'over').length;
    chip.className = `river-chip lvl-${m.level}`;
    chip.textContent = t('river.chip', { name: m.name, p: Math.round(m.pct), s: t(`river.lvl.${m.level}`), a: trendArrow(m.change1h) })
      + (over ? t('river.chipUpstream', { n: over }) : '');
    chip.hidden = false;
    markerEl.className = `river-marker lvl-${m.level}`;
    markerEl.textContent = `🏞 ${Math.round(m.pct)}%`;
    markerEl.title = `${m.name} ${signed(m.last.m)} ${t('river.msl')}`;
    markerEl.hidden = false;
    if (!marker) marker = new maplibregl.Marker({ element: markerEl }).setLngLat([m.lng, m.lat]).addTo(map);
  }

  async function load() {
    const res = await Promise.allSettled(V.stations.map((s) => loadStation(s, s.main ? V.days : 1)));
    data = res.map((r, i) => (r.status === 'fulfilled' ? r.value : { ...V.stations[i], ok: false }));
    res.filter((r) => r.status === 'rejected').forEach((r) => console.warn('river', r.reason));
    draw();
  }

  function stationRow(s) {
    if (!s.ok) return el('tr', {}, el('td', {}, s.name), el('td', { colspan: 3, class: 'meta' }, t('river.noData')));
    return el('tr', {},
      el('td', {}, s.name, el('small', {}, s.river || '')),
      el('td', {}, el('span', { class: `chip lvl-${s.level}` }, t(`river.lvl.${s.level}`))),
      el('td', {}, `${Math.round(s.pct)}%`),
      el('td', {}, s.toBank >= 0 ? t('river.below', { m: s.toBank.toFixed(2) }) : t('river.over', { m: (-s.toBank).toFixed(2) })));
  }

  function openPanel() {
    const m = main();
    const up = data.filter((s) => !s.main);
    const overUp = up.filter((s) => s.ok && s.level === 'over');
    openSheet(ctx, [
      el('div', { class: 'row between' }, el('h2', {}, t('river.title')), el('button', { type: 'button', class: 'ghost small', onclick: () => closeSheet(ctx) }, '✕')),
      m ? el('p', { class: 'meta' }, t('river.station', { name: m.name, code: m.code, t: hhmm(m.last.time) })) : el('p', {}, t('river.noData')),
      m ? el('div', { class: 'rain-summary' },
        el('div', {}, el('b', {}, t('unit.m', { n: signed(m.last.m) })), t('river.msl')),
        el('div', {}, el('b', {}, `${Math.round(m.pct)}%`), t(`river.lvl.${m.level}`)),
        el('div', {}, el('b', {}, t('unit.m', { n: m.toBank >= 0 ? m.toBank.toFixed(2) : `+${(-m.toBank).toFixed(2)}` })), t(m.toBank >= 0 ? 'river.toBank' : 'river.overBank'))) : null,
      m && m.change24h != null ? el('p', { class: 'meta' }, t('river.change', { h1: `${trendArrow(m.change1h)} ${signed(m.change1h ?? 0)}`, h24: signed(m.change24h) })) : null,
      m?.level === 'over' ? el('p', { class: 'hint warn' }, '⚠️ ', t('river.overWarn', { name: m.name })) : null,
      overUp.length ? el('p', { class: 'hint warn' }, '⚠️ ', t('river.upWarn', { names: overUp.map((s) => s.name).join(', ') })) : null,
      m ? lineChart({
        pts: m.pts, now: Date.now(), nowText: t('tide.now'), label: t('river.chartLabel'),
        refs: [{ m: m.bank, text: t('river.bankLine', { m: signed(m.bank) }), cls: 'chart-bank' }, { m: 0, text: t('tide.msl') }],
      }) : null,
      m ? el('p', { class: 'meta small' }, t('river.tidal')) : null,
      el('h3', {}, t('river.upstream')),
      el('table', { class: 'tide-table river-table' }, el('tbody', {}, up.map(stationRow))),
      el('p', { class: 'meta small' }, t('river.upNote')),
      el('p', { class: 'meta small' }, t('river.credit')),
    ].filter(Boolean));
  }

  chip.addEventListener('click', openPanel);
  markerEl.addEventListener('click', openPanel);
  load();
  setInterval(load, V.refreshMin * 60e3);
  return { label: draw, refresh: load, get stations() { return data; } };
}
