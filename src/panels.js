// Collapsible map panels (the legend, the rain/river/tide/radar column), so a phone screen shows the map.
// Each panel gets a small toggle as its first child; the choice is remembered per device.
import { t } from './i18n.js';
import { el } from './ui.js';

const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage blocked: fine */ } };

/**
 * box: panel element.  key: storage key.  openLabel / closedLabel: i18n keys for the toggle.
 * openByDefault(): whether a first-time visitor sees it open (e.g. not on small phones).
 * Returns { label() } to redraw the toggle text after a language change.
 */
export function collapsible(box, { key, openLabel, closedLabel, openByDefault = () => true }) {
  const stored = read(`floodmap.panel.${key}`);
  let open = stored == null ? openByDefault() : stored === '1';
  const btn = el('button', { type: 'button', class: 'panel-toggle' });

  function draw() {
    box.classList.toggle('collapsed', !open);
    btn.setAttribute('aria-expanded', String(open));
    btn.textContent = t(open ? openLabel : closedLabel);
  }
  btn.addEventListener('click', () => {
    open = !open;
    write(`floodmap.panel.${key}`, open ? '1' : '0');
    draw();
  });
  box.prepend(btn);
  draw();
  return { label: draw };
}

/** Small or short screens start with panels folded away. */
export const roomy = () => window.innerWidth >= 800 && window.innerHeight >= 700;
