// Search box over the map: find a factory by name (Thai or English), fly there, mark it,
// and offer actions (e.g. report a flood / ask for help at that spot).
import { t } from './i18n.js';
import { el } from './ui.js';
import { pin } from './map.js';
import { searchPlaces } from './places.js';

/** Second line under a name: English name, else what the factory makes; plus the sub-district. */
function subLine(p) {
  const first = p.nameEn && p.nameEn !== p.name ? p.nameEn : p.what;
  return [first, p.where].filter(Boolean).join(' · ');
}

/**
 * box: container element. opts: { map, getPlaces(): places[], actions: [{ label, cls, run(place) }] }
 */
export function createSearch(box, { map, getPlaces, actions = [] }) {
  const input = el('input', { type: 'search', autocomplete: 'off', enterkeyhint: 'search', spellcheck: 'false' });
  const clearBtn = el('button', { type: 'button', class: 'search-clear', 'aria-label': '✕', hidden: true }, '✕');
  const list = el('ul', { class: 'search-results', role: 'listbox', hidden: true });
  const card = el('div', { class: 'search-card', hidden: true });
  let results = [];
  let active = -1;
  let marker = null;

  function label() {
    input.placeholder = t('search.ph');
    input.setAttribute('aria-label', t('search.ph'));
  }

  function drawList() {
    const q = input.value.trim();
    clearBtn.hidden = !q;
    if (!q) { list.hidden = true; return; }
    list.replaceChildren(...(results.length
      ? results.map((p, i) => {
        const li = el('li', { role: 'option', class: i === active ? 'active' : '', 'aria-selected': String(i === active) },
          el('span', { class: 'r-name' }, '🏭 ', p.name),
          subLine(p) ? el('span', { class: 'r-en' }, subLine(p)) : null);
        li.addEventListener('mousedown', (e) => { e.preventDefault(); pick(p); });
        return li;
      })
      : [el('li', { class: 'empty' }, t('search.none'))]));
    list.hidden = false;
  }

  function update() {
    card.hidden = true;   // a new search replaces the last picked place
    results = searchPlaces(getPlaces(), input.value);
    active = results.length ? 0 : -1;
    drawList();
  }

  function clear() {
    input.value = '';
    results = [];
    list.hidden = true;
    card.hidden = true;
    clearBtn.hidden = true;
    marker?.remove();
    marker = null;
  }

  function pick(p) {
    input.value = p.name;
    list.hidden = true;
    input.blur();
    marker?.remove();
    marker = pin(map, [p.lng, p.lat], '#0d4f8b');
    map.flyTo({ center: [p.lng, p.lat], zoom: Math.max(map.getZoom(), 16.5) });
    card.replaceChildren(...[
      el('div', { class: 'row between' },
        el('strong', {}, '🏭 ', p.name),
        el('button', { type: 'button', class: 'ghost small', onclick: clear }, '✕')),
      subLine(p) ? el('div', { class: 'meta' }, subLine(p)) : null,
      p.src === 'moi' ? el('div', { class: 'meta small' }, t('search.moiNote')) : null,
      actions.length ? el('div', { class: 'row' }, actions.map((a) => el('button', {
        type: 'button', class: a.cls,
        onclick: () => { card.hidden = true; marker?.remove(); marker = null; a.run(p); },
      }, a.label))) : null,
    ].filter(Boolean));
    card.hidden = false;
  }

  input.addEventListener('input', update);
  input.addEventListener('focus', () => { if (input.value.trim()) update(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!results.length) return;
      active = (active + (e.key === 'ArrowDown' ? 1 : results.length - 1)) % results.length;
      drawList();
    } else if (e.key === 'Enter' && results[active]) {
      e.preventDefault();
      pick(results[active]);
    } else if (e.key === 'Escape') {
      clear();
    }
  });
  input.addEventListener('blur', () => setTimeout(() => { list.hidden = true; }, 150));
  clearBtn.addEventListener('click', clear);

  label();
  box.replaceChildren(el('div', { class: 'search-field' }, el('span', { class: 'search-icon' }, '🔍'), input, clearBtn), list, card);
  return { clear, label, refresh: () => { if (!list.hidden) update(); } };
}
