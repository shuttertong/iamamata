/* global maplibregl */
// MapLibre setup: service-area outline, flood spots (circles), flooded roads (lines), help requests (SOS pins).
import { CONFIG } from './config.js';

// Used when the vector style cannot load (blocked or offline CDN).
const RASTER_STYLE = {
  version: 8,
  sources: {
    osm: {
      type: 'raster', tileSize: 256,
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
};

export function createMap(container) {
  const map = new maplibregl.Map({
    container,
    style: CONFIG.map.style,
    bounds: CONFIG.map.area,
    fitBoundsOptions: { padding: 20 },
    maxBounds: CONFIG.map.bounds || undefined,
    minZoom: CONFIG.map.minZoom,
    attributionControl: { compact: true, customAttribution: ['© OpenStreetMap contributors', 'ข้อมูลโรงงาน © กระทรวงอุตสาหกรรม (Open Data Common)'] },
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
  map.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true } }), 'top-right');
  map.once('error', () => { if (!map.isStyleLoaded()) map.setStyle(RASTER_STYLE); });
  return map;
}

export function whenLoaded(map) {
  return new Promise((res) => (map.isStyleLoaded() ? res() : map.once('load', res)));
}

/** Static data: always revalidate (never a stale copy) and retry once, e.g. if a bake was writing the file. */
async function loadJson(url) {
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(url, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (i >= 1) throw e;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

/** Width by zoom for the estate roads (rank 1 = through road, 2 = estate road); the casing is thin when zoomed out. */
const roadWidth = (casing) => {
  const at = (main, estate, edge) => ['case', ['==', ['get', 'rank'], 1], main + (casing ? edge : 0), estate + (casing ? edge : 0)];
  return ['interpolate', ['exponential', 1.6], ['zoom'], 11, at(2.5, 1.6, 1), 14, at(6, 4.5, 2), 17, at(18, 13, 3)];
};

/**
 * Estate outline + main estate roads (static GeoJSON baked from OSM), placed under the
 * basemap's labels so road names stay readable on top of the white roads.
 */
export async function addAreaLayer(map) {
  // Above every basemap line/fill (bridges included, or they'd paint over our white roads), below every label.
  const base = map.getStyle().layers;
  const lastShape = base.findLastIndex((l) => l.type === 'line' || l.type === 'fill');
  const labels = base.find((l, i) => i > lastShape && l.type === 'symbol')?.id;
  try {
    if (CONFIG.map.outline) {
      map.addSource('area', { type: 'geojson', data: await loadJson(CONFIG.map.outline) });
      map.addLayer({ id: 'area-fill', type: 'fill', source: 'area', paint: { 'fill-color': '#0d4f8b', 'fill-opacity': 0.06 } }, labels);
      map.addLayer({ id: 'area-line', type: 'line', source: 'area', paint: { 'line-color': '#0d4f8b', 'line-width': 1.5, 'line-dasharray': [3, 2], 'line-opacity': 0.7 } }, labels);
    }
  } catch (e) { console.warn('area outline', e); }
  try {
    if (CONFIG.map.roads) {
      map.addSource('estate-roads', { type: 'geojson', data: await loadJson(CONFIG.map.roads) });
      const layout = { 'line-cap': 'round', 'line-join': 'round' };
      map.addLayer({ id: 'estate-roads-casing', type: 'line', source: 'estate-roads', layout, paint: { 'line-color': CONFIG.map.roadCasing, 'line-width': roadWidth(true) } }, labels);
      map.addLayer({ id: 'estate-roads', type: 'line', source: 'estate-roads', layout, paint: { 'line-color': CONFIG.map.roadColor, 'line-width': roadWidth(false) } }, labels);
    }
  } catch (e) { console.warn('main roads', e); }
}

export const DEPTH_COLOR = ['match', ['get', 'depth'], ...CONFIG.depths.flatMap((d) => [d.id, d.color]), '#888'];
const EMPTY = { type: 'FeatureCollection', features: [] };
const IS_LINE = ['==', ['geometry-type'], 'LineString'];
const IS_POINT = ['==', ['geometry-type'], 'Point'];
const FLOOD = ['==', ['get', 'kind'], 'flood'];
const HELP = ['==', ['get', 'kind'], 'help'];
const PENDING = ['get', 'pending'];
export const CLICK_LAYERS = ['reports', 'reports-line', 'reports-line-pending', 'help'];

/** Red round "SOS" icon drawn on a canvas (no sprite or glyph server needed). */
function sosImage() {
  const s = 72, c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  g.beginPath();
  g.arc(s / 2, s / 2, s / 2 - 4, 0, Math.PI * 2);
  g.fillStyle = CONFIG.help.color;
  g.fill();
  g.lineWidth = 5;
  g.strokeStyle = '#fff';
  g.stroke();
  g.fillStyle = '#fff';
  g.font = 'bold 21px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('SOS', s / 2, s / 2 + 1);
  return g.getImageData(0, 0, s, s);
}

/** Adds the report layers. onClick(id) fires when a report is tapped. */
export function addReportLayer(map, onClick) {
  if (!map.hasImage('sos')) map.addImage('sos', sosImage(), { pixelRatio: 2 });
  map.addSource('reports', { type: 'geojson', data: EMPTY });

  // Flooded roads: white casing + depth colour; pending lines are dashed and faded.
  const lineWidth = ['interpolate', ['linear'], ['zoom'], 11, 3, 17, 10];
  map.addLayer({
    id: 'reports-line-casing', type: 'line', source: 'reports', filter: ['all', IS_LINE, FLOOD],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#fff', 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 6, 17, 13], 'line-opacity': ['case', PENDING, 0.5, 0.9] },
  });
  map.addLayer({
    id: 'reports-line', type: 'line', source: 'reports', filter: ['all', IS_LINE, FLOOD, ['!', PENDING]],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': DEPTH_COLOR, 'line-width': lineWidth },
  });
  map.addLayer({
    id: 'reports-line-pending', type: 'line', source: 'reports', filter: ['all', IS_LINE, FLOOD, PENDING],
    layout: { 'line-join': 'round' },
    paint: { 'line-color': DEPTH_COLOR, 'line-width': lineWidth, 'line-opacity': 0.55, 'line-dasharray': [1.5, 1] },
  });

  // Flooded spots.
  const spot = ['all', IS_POINT, FLOOD];
  map.addLayer({
    id: 'reports-halo', type: 'circle', source: 'reports', filter: spot,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, ['+', 6, ['*', 1.5, ['get', 'depth']]], 17, ['+', 22, ['*', 6, ['get', 'depth']]]],
      'circle-color': DEPTH_COLOR,
      'circle-opacity': ['case', PENDING, 0.1, 0.22],
      'circle-blur': 0.4,
    },
  });
  map.addLayer({
    id: 'reports', type: 'circle', source: 'reports', filter: spot,
    paint: {
      // Deeper water → bigger dot (depth 1–4).
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, ['+', 3.5, ['get', 'depth']], 17, ['+', 8, ['*', 2, ['get', 'depth']]]],
      'circle-color': DEPTH_COLOR,
      'circle-opacity': ['case', PENDING, 0.45, 1],
      'circle-stroke-width': ['case', ['get', 'photo'], 3, 2],
      'circle-stroke-color': ['case', PENDING, '#6b6b6b', '#ffffff'],
    },
  });

  // Help requests: on top of everything.
  map.addLayer({
    id: 'help-halo', type: 'circle', source: 'reports', filter: HELP,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 14, 17, 40],
      'circle-color': CONFIG.help.color,
      'circle-opacity': ['case', PENDING, 0.08, 0.2],
      'circle-blur': 0.5,
    },
  });
  map.addLayer({
    id: 'help', type: 'symbol', source: 'reports', filter: HELP,
    layout: { 'icon-image': 'sos', 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-size': ['interpolate', ['linear'], ['zoom'], 10, 0.8, 16, 1.2] },
    paint: { 'icon-opacity': ['case', PENDING, 0.55, 1] },
  });

  for (const id of CLICK_LAYERS) {
    map.on('click', id, (e) => onClick(e.features[0].properties.id));
    map.on('mouseenter', id, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', id, () => { map.getCanvas().style.cursor = ''; });
  }
}

export function toFeature(r) {
  return {
    type: 'Feature',
    geometry: r.path ? { type: 'LineString', coordinates: r.path } : { type: 'Point', coordinates: [r.lng, r.lat] },
    properties: { id: r.id, kind: r.kind, depth: r.depth || 0, pending: r.status === 'pending', photo: r.photos.length > 0 },
  };
}

export function setReports(map, reports) {
  map.getSource('reports')?.setData({ type: 'FeatureCollection', features: reports.map(toFeature) });
}

/** Fits the view to a report (a line) or centres on it (a point). */
export function showReport(map, r) {
  if (r.path) {
    const b = new maplibregl.LngLatBounds();
    r.path.forEach((p) => b.extend(p));
    map.fitBounds(b, { padding: 60, maxZoom: 17 });
  } else {
    map.easeTo({ center: [r.lng, r.lat], zoom: Math.max(map.getZoom(), 15) });
  }
}

/** A draggable pin; returns the maplibre Marker. */
export function dragPin(map, lngLat, color = '#1565c0') {
  return new maplibregl.Marker({ draggable: true, color }).setLngLat(lngLat).addTo(map);
}

export function pin(map, lngLat, color) {
  return new maplibregl.Marker({ color }).setLngLat(lngLat).addTo(map);
}
