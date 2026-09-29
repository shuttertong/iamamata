// GISTDA satellite flood areas (สทอภ.): polygons baked every 3 h by GitHub Actions (tools/bake_gistda.py)
// into data/gistda-flood.json — the API key stays a repository secret and never reaches the browser.
// Drawn as an indigo fill under the people's reports; a chip in the info column says what the satellite saw.
import { CONFIG } from './config.js';
import { t } from './i18n.js';
import { el, toast } from './ui.js';
import { whenLoaded } from './map.js';

const G = CONFIG.gistda;
const SRC = 'gistda';

/** before: layer ids to draw under (first one that exists). */
export function createGistda(map, box, { before = [] } = {}) {
  let data = null;
  const chip = el('button', { type: 'button', class: 'gistda-chip', hidden: true });
  box.prepend(chip);

  const when = (iso) => new Date(iso).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  function draw() {
    if (!data?.fetched_at) { chip.hidden = true; return; }   // not connected yet (no API key secret)
    const n = data.features.length;
    chip.className = `gistda-chip${n ? ' found' : ''}`;
    chip.textContent = t(n ? 'gistda.found' : 'gistda.none', { n, d: t(`gistda.period.${data.period}`) });
    chip.title = t('gistda.asOf', { t: when(data.fetched_at) });
    chip.hidden = false;
  }

  async function load() {
    try {
      data = await (await fetch(G.file, { cache: 'no-cache' })).json();
    } catch (e) {
      console.warn('gistda', e);
      data = null;
    }
    await whenLoaded(map);
    const fc = { type: 'FeatureCollection', features: data?.features || [] };
    if (map.getSource(SRC)) {
      map.getSource(SRC).setData(fc);
    } else {
      map.addSource(SRC, { type: 'geojson', data: fc, attribution: 'น้ำท่วมจากดาวเทียม © GISTDA' });
      const beforeId = before.find((b) => map.getLayer(b));
      map.addLayer({ id: 'gistda-fill', type: 'fill', source: SRC, paint: { 'fill-color': G.color, 'fill-opacity': 0.3 } }, beforeId);
      map.addLayer({ id: 'gistda-line', type: 'line', source: SRC, paint: { 'line-color': G.color, 'line-width': 1.2, 'line-opacity': 0.8 } }, beforeId);
    }
    draw();
  }

  // Tap the chip: frame the flooded areas (or say there are none).
  chip.addEventListener('click', () => {
    const feats = data?.features || [];
    if (!feats.length) { toast(t('gistda.noneToast', { t: when(data.fetched_at) })); return; }
    const pts = [];
    const walk = (c) => (typeof c[0] === 'number' ? pts.push(c) : c.forEach(walk));
    feats.forEach((f) => walk(f.geometry.coordinates));
    const lngs = pts.map((p) => p[0]), lats = pts.map((p) => p[1]);
    map.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], { padding: 60, maxZoom: 15 });
    toast(t('gistda.asOf', { t: when(data.fetched_at) }));
  });

  load();
  setInterval(load, G.refreshMin * 60e3);
  return { label: draw };
}
