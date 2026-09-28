/* global maplibregl */
// Geometry editor: a draggable pin ('point') or a path the user taps out along a road ('line'),
// whose vertices can be dragged. Both shapes are kept, so switching mode back and forth loses nothing.
import { CONFIG } from './config.js';
import { pathLength, inArea } from './ui.js';

const SRC = 'draft';
const EMPTY = { type: 'FeatureCollection', features: [] };
const round6 = (x) => Math.round(x * 1e6) / 1e6;

/**
 * opts: { mode, point: [lng, lat], path, color, onChange(event?) }
 * onChange receives 'full' when the vertex limit is hit, otherwise nothing.
 */
export function createDrawer(map, { mode = 'point', point, path = null, color = '#1565c0', onChange = () => {} }) {
  let current = null;
  let pts = path ? path.map((p) => [...p]) : [];
  let vertices = [];
  let pinMoved = false;
  const pin = new maplibregl.Marker({ draggable: true, color }).setLngLat(point);
  pin.on('dragstart', () => { pinMoved = true; });

  map.addSource(SRC, { type: 'geojson', data: EMPTY });
  const layout = { 'line-cap': 'round', 'line-join': 'round' };
  map.addLayer({ id: 'draft-casing', type: 'line', source: SRC, layout, paint: { 'line-color': '#fff', 'line-width': 10 } });
  map.addLayer({ id: 'draft-line', type: 'line', source: SRC, layout, paint: { 'line-color': color, 'line-width': 5 } });

  function drawLine() {
    map.getSource(SRC)?.setData(pts.length >= 2
      ? { type: 'Feature', geometry: { type: 'LineString', coordinates: pts }, properties: {} }
      : EMPTY);
  }

  function rebuild() {
    vertices.forEach((m) => m.remove());
    vertices = [];
    if (current === 'line') {
      vertices = pts.map((p, i) => {
        const el = document.createElement('div');
        el.className = `vertex${i === pts.length - 1 ? ' last' : ''}`;
        const m = new maplibregl.Marker({ element: el, draggable: true }).setLngLat(p).addTo(map);
        m.on('drag', () => {
          const ll = m.getLngLat();
          pts[i] = [ll.lng, ll.lat];
          drawLine();
          onChange();
        });
        return m;
      });
    }
    drawLine();
    onChange();
  }

  function onMapClick(e) {
    if (current !== 'line') return;
    if (pts.length >= CONFIG.path.maxPoints) return onChange('full');
    if (!inArea(e.lngLat.lat, e.lngLat.lng)) return;
    pts.push([e.lngLat.lng, e.lngLat.lat]);
    rebuild();
  }
  map.on('click', onMapClick);

  const api = {
    get mode() { return current; },
    get pinMoved() { return pinMoved; },
    get count() { return pts.length; },
    get length() { return pathLength(pts); },

    setMode(m) {
      current = m;
      if (m === 'point') pin.addTo(map); else pin.remove();
      map.getCanvas().style.cursor = m === 'line' ? 'crosshair' : '';
      map.setLayoutProperty('draft-line', 'visibility', m === 'line' ? 'visible' : 'none');
      map.setLayoutProperty('draft-casing', 'visibility', m === 'line' ? 'visible' : 'none');
      rebuild();
    },
    movePin(lngLat) { pin.setLngLat(lngLat); },
    undo() { pts.pop(); rebuild(); },
    clear() { pts = []; rebuild(); },

    /** { lat, lng, path }: a point, or a path with its middle vertex as the anchor point. */
    value() {
      if (current === 'point') {
        const { lat, lng } = pin.getLngLat();
        return { lat: round6(lat), lng: round6(lng), path: null };
      }
      const path = pts.map(([x, y]) => [round6(x), round6(y)]);
      const mid = path[Math.floor(path.length / 2)] || [];
      return { lat: mid[1], lng: mid[0], path };
    },

    destroy() {
      map.off('click', onMapClick);
      pin.remove();
      vertices.forEach((m) => m.remove());
      for (const id of ['draft-line', 'draft-casing']) if (map.getLayer(id)) map.removeLayer(id);
      if (map.getSource(SRC)) map.removeSource(SRC);
      map.getCanvas().style.cursor = '';
    },
  };
  api.setMode(mode);
  return api;
}
