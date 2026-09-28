// Sea level (tides) off the Bang Pakong river mouth: Open-Meteo Marine API, hourly `sea_level_height_msl`
// (tide + surge model, metres above mean sea level; free, no key, CC BY 4.0).
// Why it matters: at high tide the canals and the Bang Pakong drain slowly, so heavy rain then floods more.
import { CONFIG } from './config.js';
import { t } from './i18n.js';
import { el, openSheet, closeSheet } from './ui.js';
import { lineChart } from './chart.js';

const T = CONFIG.tide;
const hhmm = (d) => d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false });
const day = (d) => d.toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short' });
const metres = (m) => t('unit.m', { n: `${m >= 0 ? '+' : ''}${m.toFixed(2)}` });

function url() {
  const q = new URLSearchParams({
    latitude: T.lat, longitude: T.lng, hourly: 'sea_level_height_msl', timezone: 'Asia/Bangkok', forecast_days: T.days, past_days: 1,
  });
  return `https://marine-api.open-meteo.com/v1/marine?${q}`;
}

/** Highs and lows, with the time refined by a parabola through the three hourly values around each turn. */
function turns(pts) {
  const out = [];
  for (let i = 1; i < pts.length - 1; i++) {
    const [a, b, c] = [pts[i - 1].m, pts[i].m, pts[i + 1].m];
    const high = b > a && b >= c;
    const low = b < a && b <= c;
    if (!high && !low) continue;
    const den = a - 2 * b + c;
    const off = den ? (a - c) / (2 * den) : 0;            // -0.5 … 0.5 hour
    const m = b - ((a - c) * off) / 4;
    out.push({ kind: high ? 'high' : 'low', time: new Date(pts[i].time.getTime() + off * 3600e3), m });
  }
  return out;
}

/**
 * box: the right-hand column; the chip goes above the rain chip.
 * rainHours(): [{ time, prob, mm }] from rain.js, to warn when heavy rain meets high tide.
 */
export function createTide(ctx, box, { rainHours = () => [] } = {}) {
  let pts = [];
  let marks = [];
  const chip = el('button', { type: 'button', class: 'tide-chip', hidden: true });
  box.prepend(chip);

  const nowLevel = () => {
    const now = Date.now();
    const i = pts.findIndex((p) => p.time.getTime() > now);
    if (i <= 0) return null;
    const a = pts[i - 1], b = pts[i];
    const f = (now - a.time.getTime()) / 3600e3;
    return { m: a.m + (b.m - a.m) * f, rising: b.m > a.m };
  };
  const nextHigh = () => marks.find((k) => k.kind === 'high' && k.time.getTime() > Date.now());

  /** High tides (≥ T.highM) that meet heavy rain within ±T.rainWindowH hours. */
  function danger() {
    const heavy = rainHours().filter((h) => h.mm >= CONFIG.rain.heavyMm || (h.prob >= CONFIG.rain.highProb && h.mm >= T.rainMm));
    return marks.filter((k) => k.kind === 'high' && k.m >= T.highM && k.time.getTime() > Date.now()
      && heavy.some((h) => Math.abs(h.time.getTime() - k.time.getTime()) <= T.rainWindowH * 3600e3));
  }

  function drawChip() {
    const cur = nowLevel();
    const hi = nextHigh();
    if (!cur || !hi) { chip.hidden = true; return; }
    const risk = danger().length > 0;
    chip.className = `tide-chip${risk ? ' tide-risk' : hi.m >= T.highM ? ' tide-highwater' : ''}`;
    chip.textContent = t(cur.rising ? 'tide.chipUp' : 'tide.chipDown', { t: hhmm(hi.time), m: hi.m.toFixed(1) });
    chip.hidden = false;
  }

  async function load() {
    try {
      const json = await (await fetch(url())).json();
      const h = json.hourly;
      pts = h.time.map((s, i) => ({ time: new Date(`${s}:00+07:00`), m: h.sea_level_height_msl[i] })).filter((p) => p.m != null);
      marks = turns(pts);
    } catch (e) { console.warn('tide', e); }
    drawChip();
  }

  function openPanel() {
    const now = Date.now();
    const from = now - 6 * 3600e3, to = now + 42 * 3600e3;
    const view = pts.filter((p) => p.time.getTime() >= from && p.time.getTime() <= to);
    const viewMarks = marks.filter((k) => k.time.getTime() >= from && k.time.getTime() <= to);
    const cur = nowLevel();
    const risks = danger();
    const upcoming = marks.filter((k) => k.time.getTime() > now).slice(0, 6);
    openSheet(ctx, [
      el('div', { class: 'row between' }, el('h2', {}, t('tide.title')), el('button', { type: 'button', class: 'ghost small', onclick: () => closeSheet(ctx) }, '✕')),
      el('p', { class: 'meta' }, t('tide.where')),
      cur ? el('div', { class: 'rain-summary' },
        el('div', {}, el('b', {}, metres(cur.m)), t('tide.nowLevel')),
        el('div', {}, el('b', {}, cur.rising ? '↑' : '↓'), t(cur.rising ? 'tide.rising' : 'tide.falling')),
        el('div', {}, el('b', {}, nextHigh() ? hhmm(nextHigh().time) : '–'), t('tide.nextHigh'))) : el('p', {}, t('tide.unavailable')),
      ...risks.map((k) => el('p', { class: 'hint warn' }, '⚠️ ', t('tide.riskWarn', { t: `${day(k.time)} ${hhmm(k.time)}`, m: k.m.toFixed(1) }))),
      view.length > 2 ? lineChart({ pts: view, marks: viewMarks, refs: [{ m: 0, text: t('tide.msl') }], now, nowText: t('tide.now'), label: t('tide.chartLabel') }) : null,
      upcoming.length ? el('table', { class: 'tide-table' },
        el('tbody', {}, upcoming.map((k) => el('tr', { class: k.kind === 'high' && k.m >= T.highM ? 'hw' : '' },
          el('td', {}, k.kind === 'high' ? t('tide.high') : t('tide.low')),
          el('td', {}, t('tide.at', { d: day(k.time), t: hhmm(k.time) })),
          el('td', {}, metres(k.m)))))) : null,
      el('p', { class: 'meta small' }, t('tide.note', { m: T.highM })),
      el('p', { class: 'meta small' }, t('tide.credit')),
    ].filter(Boolean));
  }

  chip.addEventListener('click', openPanel);
  load();
  setInterval(load, T.refreshMin * 60e3);
  setInterval(drawChip, 5 * 60e3);   // trend and "next high" move on with the clock
  return { label: drawChip, refresh: load };
}
