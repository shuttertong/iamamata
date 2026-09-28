// Report forms: flood (a spot or a flooded road line + depth) and help request (a spot + needs + private contact).
// Also move mode for an existing report.
import { CONFIG } from './config.js';
import { t, errText } from './i18n.js';
import { el, toast, distM, inArea, fmtLength, openSheet, closeSheet, locate } from './ui.js';
import { createDrawer } from './draw.js';
import { preparePhoto } from './photo.js';
import { sessionGate } from './captcha.js';
import { outbox, isNetworkError, flushOutbox } from './outbox.js';

const PHONE = /^[0-9+() -]{6,20}$/;
const phoneOk = (s) => PHONE.test(s) && s.replace(/\D/g, '').length >= 9;

/** Hint line + undo/clear tools that follow the drawer's mode. */
export function drawTools(helpText) {
  const hint = el('p', { class: 'hint' });
  const tools = el('div', { class: 'row path-tools', hidden: true });
  let drawer = null;
  const update = (ev) => {
    if (ev === 'full') toast(t('path.full', { n: CONFIG.path.maxPoints }));
    if (!drawer) return;
    const line = drawer.mode === 'line';
    hint.textContent = line
      ? `〰️ ${t('path.hint')}${drawer.count >= 2 ? ` · ${t('path.length', { m: fmtLength(drawer.length) })}` : ''}`
      : `📍 ${helpText}`;
    tools.hidden = !line;
  };
  tools.append(
    el('button', { type: 'button', class: 'ghost small', onclick: () => drawer?.undo() }, t('path.undo')),
    el('button', { type: 'button', class: 'ghost small', onclick: () => drawer?.clear() }, t('path.clear')));
  return { hint, tools, update, bind(d) { drawer = d; update(); } };
}

/** Returns an error message when the drawn shape can't be sent, else null. */
export function shapeError(drawer) {
  if (drawer.mode !== 'line') return null;
  if (drawer.count < 2) return t('path.needTwo');
  if (drawer.length > CONFIG.path.maxKm * 1000) return t('path.tooLong', { km: CONFIG.path.maxKm });
  return null;
}

export function depthPicker(optional, initial = 0) {
  let value = initial || 0;
  const btns = CONFIG.depths.map((d) => {
    const b = el('button', { type: 'button', class: 'depth-btn', 'aria-pressed': String(d.id === value) }, el('i', { style: `background:${d.color}` }), t(d.key));
    b.addEventListener('click', () => {
      value = optional && value === d.id ? 0 : d.id;
      btns.forEach((x, i) => x.setAttribute('aria-pressed', String(CONFIG.depths[i].id === value)));
    });
    return b;
  });
  return { node: el('div', { class: 'depth-list' }, btns), get value() { return value; } };
}

function photoField() {
  const photos = [];
  const thumbs = el('div', { class: 'thumbs' });
  const file = el('input', { type: 'file', accept: 'image/*', capture: 'environment', multiple: true, hidden: true });
  const add = el('button', { type: 'button', class: 'ghost', onclick: () => file.click() }, t('report.addPhoto'));
  const consent = el('input', { type: 'checkbox' });
  const consentRow = el('label', { class: 'consent', hidden: true }, consent, t('report.consent'));
  const draw = () => {
    thumbs.replaceChildren(...photos.map((p, i) => el('div', { class: 'thumb' },
      el('img', { src: p.preview, alt: '' }),
      el('button', { type: 'button', 'aria-label': '✕', onclick: () => { URL.revokeObjectURL(p.preview); photos.splice(i, 1); draw(); } }, '✕'))));
    consentRow.hidden = photos.length === 0;
    add.hidden = photos.length >= CONFIG.photo.max;
  };
  file.addEventListener('change', async () => {
    const files = [...file.files].slice(0, CONFIG.photo.max - photos.length);
    file.value = '';
    add.disabled = true;
    add.textContent = t('report.processing');
    for (const f of files) {
      try { photos.push(await preparePhoto(f)); } catch (e) { console.warn(e); toast(t('err.photo')); }
    }
    add.disabled = false;
    add.textContent = t('report.addPhoto');
    draw();
  });
  return {
    nodes: [el('h3', {}, t('report.photos', { n: CONFIG.photo.max })), thumbs, add, file, consentRow],
    photos,
    get consented() { return consent.checked; },
    release() { photos.forEach((p) => URL.revokeObjectURL(p.preview)); },
  };
}

function helpFields() {
  const needs = new Set();
  const people = el('input', { type: 'number', min: 1, max: CONFIG.help.peopleMax, value: 1, inputmode: 'numeric' });
  const name = el('input', { type: 'text', maxlength: 80, autocomplete: 'name' });
  const phone = el('input', { type: 'tel', maxlength: 20, autocomplete: 'tel', inputmode: 'tel' });
  const consent = el('input', { type: 'checkbox' });
  const emergency = el('div', { class: 'emergency' },
    el('strong', {}, t('help.emergency')),
    el('div', { class: 'calls' }, CONFIG.emergency.map((e) => el('a', { href: `tel:${e.tel}`, class: 'call' }, '📞 ', t(e.key)))));
  const needList = el('div', { class: 'needs' }, CONFIG.needs.map((k) => {
    const box = el('input', { type: 'checkbox', value: k });
    box.addEventListener('change', () => (box.checked ? needs.add(k) : needs.delete(k)));
    return el('label', { class: 'need' }, box, t(`need.${k}`));
  }));
  return {
    emergency,
    top: [el('h3', {}, t('help.needs')), needList, el('h3', {}, t('help.people')), people],
    contact: [
      el('h3', {}, t('help.contact')),
      el('label', { class: 'field' }, t('help.name'), name),
      el('label', { class: 'field' }, t('help.phone'), phone),
      el('label', { class: 'consent' }, consent, t('help.consent')),
    ],
    error() {
      if (!needs.size) return t('help.needNeeds');
      if (!phoneOk(phone.value.trim())) return t('help.needPhone');
      if (!consent.checked) return t('help.needConsent');
      return null;
    },
    value() {
      const n = Math.min(CONFIG.help.peopleMax, Math.max(1, parseInt(people.value, 10) || 1));
      return { needs: [...needs], people: n, contact: { name: name.value.trim(), phone: phone.value.trim() } };
    },
  };
}

export async function openReportForm(ctx, kind = 'flood', { at = null } = {}) {
  const { map, api } = ctx;
  closeSheet(ctx, false);   // the previous sheet may own a drawer (same map source)
  const help = kind === 'help';
  let device = null;
  let open = true;

  const tools = drawTools(t(help ? 'report.dragHelp' : 'report.drag'));
  const depth = depthPicker(help);
  const note = el('textarea', { rows: 2, maxlength: CONFIG.noteMax, placeholder: t('report.notePh') });
  const photo = photoField();
  const hf = help ? helpFields() : null;
  const gateBox = el('div', { class: 'captcha' });
  const sendBtn = el('button', { type: 'button', class: help ? 'danger' : 'primary' }, t('report.send'));

  const drawer = createDrawer(map, {
    point: at || map.getCenter().toArray(), color: help ? CONFIG.help.color : '#1565c0', onChange: tools.update,
  });
  tools.bind(drawer);

  const shapeBtns = ['point', 'line'].map((m) => el('button', {
    type: 'button', class: 'seg', 'aria-pressed': String(m === 'point'),
    onclick: (e) => {
      drawer.setMode(m);
      shapeBtns.forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget)));
    },
  }, t(m === 'point' ? 'shape.point' : 'shape.path')));

  ctx.drawing = true;
  openSheet(ctx, [
    el('h2', {}, t(help ? 'report.titleHelp' : 'report.title')),
    hf?.emergency,
    help && api.mode === 'demo' ? el('p', { class: 'hint warn' }, '⚠️ ', t('help.demoWarn')) : null,
    help ? null : el('div', { class: 'segmented' }, shapeBtns),
    tools.hint, tools.tools,
    ...(hf ? hf.top : []),
    el('h3', {}, t(help ? 'report.depthOptional' : 'report.depth')), depth.node,
    el('h3', {}, t('report.note')), note,
    ...photo.nodes,
    ...(hf ? hf.contact : []),
    gateBox,
    el('div', { class: 'row' }, el('button', { type: 'button', class: 'ghost', onclick: () => closeSheet(ctx) }, t('report.cancel')), sendBtn),
  ].filter(Boolean), () => {
    open = false;
    ctx.drawing = false;
    drawer.destroy();
    photo.release();
  });

  const ready = await sessionGate(api, gateBox, toast, t('report.needCaptcha'));

  // Start at the device position, but only inside the service area (outside it the pin would be off the map).
  locate().then((loc) => {
    device = loc;
    if (loc && open && !at && !drawer.pinMoved && drawer.mode === 'point' && inArea(loc.lat, loc.lng)) {
      drawer.movePin([loc.lng, loc.lat]);
      map.easeTo({ center: [loc.lng, loc.lat], zoom: Math.max(map.getZoom(), 16) });
    }
  });

  sendBtn.addEventListener('click', async () => {
    const problem = shapeError(drawer)
      || (!help && !depth.value ? t('report.needDepth') : null)
      || hf?.error()
      || (photo.photos.length && !photo.consented ? t('report.needConsent') : null);
    if (problem) return toast(problem);
    const shape = drawer.value();
    const report = {
      kind, ...shape, depth: depth.value || null, note: note.value.trim(),
      needs: [], people: null, contact: null, ...(hf ? hf.value() : {}),
      photos: photo.photos.map(({ blob, takenAt, hash }) => ({ blob, takenAt, hash })),
      deviceDistanceM: device ? Math.round(distM(device, shape)) : null,
    };
    sendBtn.disabled = true;
    sendBtn.textContent = t('report.sending');
    try {
      if (!navigator.onLine) throw new TypeError('offline');
      if (!(await ready())) return;
      await api.createReport(report);
      toast(t(help ? 'help.sent' : 'report.sent'), help ? 7000 : 3500);
      closeSheet(ctx);
      ctx.refresh();
      flushOutbox(api).then((n) => n && toast(t('report.flushed', { n })));
    } catch (e) {
      if (isNetworkError(e)) {
        try { await outbox.add(report); toast(t('report.queued')); closeSheet(ctx); } catch { toast(errText(e)); }
      } else { console.error(e); toast(errText(e)); }
    } finally {
      sendBtn.disabled = false;
      sendBtn.textContent = t('report.send');
    }
  });
}

/** Move an existing report (pin or road line). Own pending → saved directly; approved → suggestion for the admin. */
export async function openMove(ctx, report) {
  const { map, api } = ctx;
  closeSheet(ctx, false);
  const own = report.mine && report.status === 'pending';
  const help = report.kind === 'help';
  const tools = drawTools(t('move.title'));
  const drawer = createDrawer(map, {
    mode: report.path ? 'line' : 'point', point: [report.lng, report.lat], path: report.path,
    color: help ? CONFIG.help.color : '#1565c0', onChange: tools.update,
  });
  tools.bind(drawer);
  const gateBox = el('div', { class: 'captcha' });
  const saveBtn = el('button', { type: 'button', class: 'primary' }, t('move.save'));

  ctx.drawing = true;
  openSheet(ctx, [
    el('h2', {}, own ? t('detail.move') : t('detail.suggestMove')),
    tools.hint, tools.tools,
    gateBox,
    el('div', { class: 'row' },
      el('button', { type: 'button', class: 'ghost', onclick: () => closeSheet(ctx) }, t('report.cancel')), saveBtn),
  ], () => { ctx.drawing = false; drawer.destroy(); });

  const ready = own ? null : await sessionGate(api, gateBox, toast, t('report.needCaptcha'));

  saveBtn.addEventListener('click', async () => {
    const problem = shapeError(drawer);
    if (problem) return toast(problem);
    const shape = drawer.value();
    saveBtn.disabled = true;
    try {
      if (own) {
        await api.updateMyReport(report.id, shape);
        toast(t('detail.saved'));
      } else {
        if (!(await ready())) return;
        await api.proposeEdit(report.id, { kind: 'move', ...shape });
        toast(t('detail.suggested'));
      }
      closeSheet(ctx);
      ctx.refresh();
    } catch (e) { console.error(e); toast(errText(e)); } finally { saveBtn.disabled = false; }
  });
}
