// Public map page.
import { CONFIG } from './config.js';
import { t, applyI18n, toggleLang } from './i18n.js';
import { toast, debounce, renderLegend } from './ui.js';
import { createMap, whenLoaded, addAreaLayer, addReportLayer, setReports } from './map.js';
import { createApi } from './api.js';
import { openReportForm } from './report.js';
import { openDetail } from './detail.js';
import { flushOutbox } from './outbox.js';
import { loadPlaces } from './places.js';
import { createSearch } from './search.js';
import { createRain } from './rain.js';
import { createRadar } from './radar.js';
import { createTide } from './tide.js';
import { createRiver } from './river.js';
import { collapsible, roomy } from './panels.js';

const $ = (id) => document.getElementById(id);

applyI18n();
const api = await createApi();
const map = createMap('map');
let reports = [];

async function refresh() {
  try {
    reports = await api.listPublic();
    setReports(map, reports);
  } catch (e) {
    console.error(e);
    toast(t('err.load'));
  }
}

const ctx = { map, api, sheet: $('sheet'), refresh, drawing: false };

let places = [];
loadPlaces(api).then((p) => { places = p; });
const search = createSearch($('search'), {
  map,
  getPlaces: () => places,
  actions: [
    { label: t('search.reportHere'), cls: 'primary', run: (p) => openReportForm(ctx, 'flood', { at: [p.lng, p.lat] }) },
    { label: t('search.helpHere'), cls: 'danger', run: (p) => openReportForm(ctx, 'help', { at: [p.lng, p.lat] }) },
  ],
});

const rain = createRain(ctx, $('rain'), { onUpdate: () => tide?.label() });   // re-check rain + high tide
const tide = createTide(ctx, $('rain'), { rainHours: () => rain.hours });
const river = createRiver(ctx, $('rain'), map);
// Radar goes under the report layers so flood spots and SOS pins stay on top.
const radar = createRadar(map, $('rain'), { before: ['reports-line-casing', 'reports-halo', 'help-halo'] });
// Fold-away panels: the legend starts folded on phones; the info column starts open.
const legendPanel = collapsible($('legend'), { key: 'legend', openLabel: 'panel.legendOpen', closedLabel: 'panel.legendClosed', openByDefault: roomy });
const infoPanel = collapsible($('rain'), { key: 'info', openLabel: 'panel.infoOpen', closedLabel: 'panel.infoClosed' });

/** Push the search box and legend down by the demo banner's real height. */
function fitBanner() {
  const h = $('demoBanner').hidden ? 0 : $('demoBanner').offsetHeight;
  document.documentElement.style.setProperty('--banner-h', `${h}px`);
}
window.addEventListener('resize', fitBanner);

function drawChrome() {
  $('lang').textContent = t('lang.other');
  $('mode').hidden = api.mode !== 'demo';
  $('mode').textContent = t('mode.demo');
  $('demoBanner').hidden = api.mode !== 'demo';
  $('demoBanner').textContent = t('mode.demoBanner');
  fitBanner();
  renderLegend($('legendItems'));
  search?.label();
  rain?.label();
  tide?.label();
  river?.label();
  radar?.label();
  legendPanel?.label();
  infoPanel?.label();
}
drawChrome();
$('lang').addEventListener('click', () => { toggleLang(); drawChrome(); });
$('floodBtn').addEventListener('click', () => openReportForm(ctx, 'flood'));
$('helpBtn').addEventListener('click', () => openReportForm(ctx, 'help'));

await whenLoaded(map);
await addAreaLayer(map);
addReportLayer(map, (id) => {
  if (ctx.drawing) return;   // taps add path points while drawing
  const r = reports.find((x) => x.id === id);
  if (r) openDetail(ctx, r);
});
await refresh();

api.subscribe(debounce(refresh, 400));
setInterval(refresh, CONFIG.refreshMs);
const flush = () => flushOutbox(api).then((n) => { if (n) { toast(t('report.flushed', { n })); refresh(); } });
window.addEventListener('online', flush);
flush();

// Console handle for debugging.
window.__flood = { api, map, ctx, refresh, rain, tide, radar, river, get reports() { return reports; } };
