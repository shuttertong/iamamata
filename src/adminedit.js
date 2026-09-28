// Admin editor: change any active report directly (spot / road line, depth, needs, people, note),
// close it, or take it off the map. Shown in the admin side panel in place of the list.
import { CONFIG } from './config.js';
import { t, errText } from './i18n.js';
import { el, toast } from './ui.js';
import { createDrawer } from './draw.js';
import { drawTools, shapeError, depthPicker } from './report.js';
import { summary } from './detail.js';
import { showReport } from './map.js';

const REASONS = ['duplicate', 'not_flood', 'inappropriate', 'other'];

/**
 * env: { map, api, box (panel element), tabs (element hidden while editing), ctx ({ drawing }) }
 * done() runs after save / close / remove / back.
 */
export function openAdminEdit(env, r, done) {
  const { map, api, box, tabs, ctx } = env;
  const help = r.kind === 'help';
  let drawer = null;

  const tools = drawTools(t('move.title'));
  tools.hint.hidden = true;
  const depth = depthPicker(help, r.depth || 0);
  const note = el('textarea', { rows: 3, maxlength: CONFIG.noteMax });
  note.value = r.note || '';

  const needs = new Set(r.needs);
  const needList = help ? el('div', { class: 'needs' }, CONFIG.needs.map((k) => {
    const cb = el('input', { type: 'checkbox' });
    cb.checked = needs.has(k);
    cb.addEventListener('change', () => (cb.checked ? needs.add(k) : needs.delete(k)));
    return el('label', { class: 'need' }, cb, t(`need.${k}`));
  })) : null;
  const people = help ? el('input', { type: 'number', min: 1, max: CONFIG.help.peopleMax, value: r.people || 1 }) : null;

  // Shape: start the drawer on demand; flood reports can switch between a spot and a road line.
  const segBtns = help ? [] : ['point', 'line'].map((m) => el('button', {
    type: 'button', class: 'seg', 'aria-pressed': String((m === 'line') === !!r.path),
    onclick: (e) => {
      drawer?.setMode(m);
      segBtns.forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget)));
    },
  }, t(m === 'point' ? 'shape.point' : 'shape.path')));
  const seg = help ? null : el('div', { class: 'segmented', hidden: true }, segBtns);
  const shapeBtn = el('button', { type: 'button', class: 'ghost wide' }, t(r.path ? 'admin.editPath' : 'admin.editShape'));
  shapeBtn.addEventListener('click', () => {
    ctx.drawing = true;
    drawer = createDrawer(map, {
      mode: r.path ? 'line' : 'point', point: [r.lng, r.lat], path: r.path,
      color: help ? CONFIG.help.color : '#1565c0', onChange: tools.update,
    });
    tools.bind(drawer);
    tools.hint.hidden = false;
    shapeBtn.hidden = true;
    if (seg) seg.hidden = false;
  });

  function finish() {
    drawer?.destroy();
    drawer = null;
    ctx.drawing = false;
    tabs.hidden = false;
    done();
  }

  async function run(btn, fn, doneText) {
    btn.disabled = true;
    try { await fn(); toast(doneText); finish(); } catch (e) { console.error(e); toast(errText(e)); btn.disabled = false; }
  }

  const save = el('button', { type: 'button', class: 'primary' }, t('admin.save'));
  save.addEventListener('click', () => {
    const patch = { note: note.value.trim() };
    if (help) {
      if (!needs.size) return toast(t('help.needNeeds'));
      patch.needs = [...needs];
      patch.people = Math.min(CONFIG.help.peopleMax, Math.max(1, parseInt(people.value, 10) || 1));
      patch.depth = depth.value || null;
    } else {
      if (!depth.value) return toast(t('report.needDepth'));
      patch.depth = depth.value;
    }
    if (drawer) {
      const problem = shapeError(drawer);
      if (problem) return toast(problem);
      Object.assign(patch, drawer.value());
    }
    return run(save, () => api.adminUpdate(r.id, patch), t('admin.saved'));
  });

  const closeBtn = el('button', { type: 'button', class: 'ghost' }, t(help ? 'admin.closeHelp' : 'admin.closeFlood'));
  closeBtn.addEventListener('click', () => run(closeBtn, () => api.closeReport(r.id), t('detail.closed')));
  const reason = el('select', { 'aria-label': t('admin.reason') }, REASONS.map((k) => el('option', { value: k }, t(`reason.${k}`))));
  const removeBtn = el('button', { type: 'button', class: 'danger' }, t('admin.remove'));
  removeBtn.addEventListener('click', () => {
    if (!window.confirm(t('admin.removeConfirm'))) return;
    run(removeBtn, () => api.adminRemove(r, reason.value), t('admin.removed'));
  });

  tabs.hidden = true;
  box.replaceChildren(el('article', { class: 'card editor' },
    el('div', { class: 'row between' },
      el('button', { type: 'button', class: 'ghost small', onclick: finish }, t('admin.back')),
      el('span', { class: `chip ${r.status === 'pending' ? 'chip-pending' : 'chip-ok'}` }, t(r.status === 'pending' ? 'legend.pending' : 'detail.approved'))),
    el('h2', {}, t('admin.editTitle')),
    ...summary(r),
    el('h3', {}, t('admin.position')), shapeBtn, seg, tools.hint, tools.tools,
    el('h3', {}, t(help ? 'report.depthOptional' : 'report.depth')), depth.node,
    help ? el('h3', {}, t('help.needs')) : null, needList,
    help ? el('h3', {}, t('help.people')) : null, people,
    el('h3', {}, t('report.note')), note,
    el('div', { class: 'row' }, el('button', { type: 'button', class: 'ghost', onclick: finish }, t('report.cancel')), save),
    el('h3', { class: 'danger-title' }, t('admin.endTitle')),
    el('div', { class: 'row' }, closeBtn),
    el('div', { class: 'row' }, reason, removeBtn)));
  box.scrollTop = 0;
  showReport(map, r);
}
