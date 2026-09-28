// Rain outlook for the service area: a chip with the chance of rain in the next hours
// (Open-Meteo, free, no key, CC BY 4.0) and a sheet with a 24-hour chart + the Windy rain map.
import { CONFIG } from './config.js';
import { t } from './i18n.js';
import { el, openSheet, closeSheet } from './ui.js';

const R = CONFIG.rain;

function forecastUrl() {
  const q = new URLSearchParams({
    latitude: R.lat, longitude: R.lng, timezone: 'Asia/Bangkok', forecast_days: 2,
    hourly: 'precipitation_probability,precipitation',
  });
  return `https://api.open-meteo.com/v1/forecast?${q}`;
}

function windyUrl() {
  const q = new URLSearchParams({
    lat: R.lat, lon: R.lng, detailLat: R.lat, detailLon: R.lng, zoom: R.windyZoom, level: 'surface',
    overlay: 'rain', product: 'ecmwf', menu: '', message: 'true', marker: 'true', calendar: 'now',
    pressure: '', type: 'map', location: 'coordinates', detail: '', metricWind: 'default', metricTemp: 'default', radarRange: '-1',
  });
  return `https://embed.windy.com/embed2.html?${q}`;
}

/** The next `hours` hours from now: [{ time: Date, prob, mm }]. */
function upcoming(json, hours) {
  const h = json.hourly;
  const now = Date.now() - 3600e3;   // include the current hour
  return h.time.map((s, i) => ({ time: new Date(`${s}:00+07:00`), prob: h.precipitation_probability[i] ?? 0, mm: h.precipitation[i] ?? 0 }))
    .filter((x) => x.time.getTime() >= now).slice(0, hours);
}

const level = (prob, mm) => (mm >= R.heavyMm ? 'heavy' : prob >= R.highProb ? 'high' : prob >= R.midProb ? 'mid' : 'low');
const hourLabel = (d) => `${String(d.getHours()).padStart(2, '0')}:00`;

export function createRain(ctx, box, { onUpdate = () => {} } = {}) {
  let hours = [];
  const chip = el('button', { type: 'button', class: 'rain-chip', hidden: true });
  box.replaceChildren(chip);

  function drawChip() {
    if (!hours.length) { chip.hidden = true; return; }
    const next = hours.slice(0, 3);
    const prob = Math.max(...next.map((x) => x.prob));
    const heavy = hours.slice(0, 6).some((x) => x.mm >= R.heavyMm);
    chip.className = `rain-chip rain-${heavy ? 'heavy' : level(prob, 0)}`;
    chip.textContent = heavy ? t('rain.chipHeavy') : t('rain.chip', { p: prob });
    chip.hidden = false;
  }

  async function load() {
    try {
      const res = await fetch(forecastUrl());
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      hours = upcoming(await res.json(), 24);
    } catch (e) { console.warn('rain forecast', e); }
    drawChip();
    onUpdate();
  }

  function openPanel() {
    const next3 = Math.max(0, ...hours.slice(0, 3).map((x) => x.prob));
    const total = hours.reduce((s, x) => s + x.mm, 0);
    const heavyHours = hours.filter((x) => x.mm >= R.heavyMm);
    const maxMm = Math.max(1, ...hours.map((x) => x.mm));
    const chart = el('div', { class: 'rain-chart', role: 'img', 'aria-label': t('rain.chartLabel') },
      hours.map((x, i) => el('div', { class: 'rain-col', title: `${hourLabel(x.time)} · ${x.prob}% · ${x.mm.toFixed(1)} mm` },
        el('span', { class: 'rain-mm' }, x.mm >= 1 ? x.mm.toFixed(0) : ''),
        el('div', { class: `rain-bar rain-${level(x.prob, x.mm)}`, style: `height:${Math.max(3, x.prob)}%` }),
        el('span', { class: 'rain-hour' }, i % 3 === 0 ? hourLabel(x.time).slice(0, 2) : ''))));
    const frame = el('iframe', { class: 'windy', src: windyUrl(), title: 'Windy', loading: 'lazy', referrerpolicy: 'no-referrer' });
    openSheet(ctx, [
      el('div', { class: 'row between' }, el('h2', {}, t('rain.title')), el('button', { type: 'button', class: 'ghost small', onclick: () => closeSheet(ctx) }, '✕')),
      el('p', { class: 'meta' }, t('rain.where')),
      hours.length ? el('div', { class: 'rain-summary' },
        el('div', {}, el('b', {}, `${next3}%`), t('rain.next3')),
        el('div', {}, el('b', {}, `${total.toFixed(0)} mm`), t('rain.total24')),
        el('div', {}, el('b', {}, String(heavyHours.length)), t('rain.heavyHours', { mm: R.heavyMm }))) : el('p', {}, t('rain.unavailable')),
      heavyHours.length ? el('p', { class: 'hint warn' }, '⚠️ ', t('rain.heavyWarn', { at: hourLabel(heavyHours[0].time) })) : null,
      hours.length ? chart : null,
      hours.length ? el('p', { class: 'meta small' }, t('rain.chartNote', { max: maxMm.toFixed(0) })) : null,
      el('h3', {}, t('rain.windy')),
      frame,
      el('a', { class: 'ghost wide link-btn', href: `https://www.windy.com/?rain,${R.lat},${R.lng},${R.windyZoom}`, target: '_blank', rel: 'noopener' }, t('rain.openWindy')),
      el('p', { class: 'meta small' }, t('rain.credit')),
    ].filter(Boolean));
  }

  chip.addEventListener('click', openPanel);
  load();
  setInterval(load, R.refreshMin * 60e3);
  return { refresh: load, label: drawChip, get hours() { return hours; } };
}
