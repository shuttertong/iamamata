// Report detail sheet: what, how deep / what is needed, how old, photos, and the actions people can take.
import { CONFIG } from './config.js';
import { t, errText } from './i18n.js';
import { el, toast, timeAgo, timeLeft, depthBadge, pathLength, fmtLength, openSheet, closeSheet } from './ui.js';
import { sessionGate } from './captcha.js';
import { openMove } from './report.js';
import { showReport } from './map.js';

/** Photo thumbnails; tap to view full screen. Fills box asynchronously. */
export async function showPhotos(api, paths, box) {
  if (!paths.length) return;
  try {
    const urls = await api.photoUrls(paths);
    box.replaceChildren(...paths.filter((p) => urls[p]).map((p) => {
      const img = el('img', { src: urls[p], alt: '', loading: 'lazy' });
      img.addEventListener('click', () => img.classList.toggle('zoom'));
      return img;
    }));
  } catch (e) { console.warn('photos', e); }
}

/** Header: kind / depth / line length + needs + people. Shared with the admin page. */
export function summary(r) {
  const help = r.kind === 'help';
  return [
    el('div', { class: 'tags' },
      help ? el('span', { class: 'chip chip-help' }, t('help.label')) : null,
      r.depth ? depthBadge(r.depth) : null,
      r.path ? el('span', { class: 'chip chip-path' }, t('flag.path', { m: fmtLength(pathLength(r.path)) })) : null,
      help && r.people ? el('span', { class: 'chip' }, '👥 ', t('help.peopleN', { n: r.people })) : null),
    help && r.needs.length ? el('ul', { class: 'need-list' }, r.needs.map((k) => el('li', {}, t(`need.${k}`)))) : null,
  ];
}

export async function openDetail(ctx, r) {
  const { map, api } = ctx;
  const pending = r.status === 'pending';
  const help = r.kind === 'help';
  const photosBox = el('div', { class: 'photos' });
  const gateBox = el('div', { class: 'captcha' });
  const actions = el('div', { class: 'row wrap' });
  const depthPick = el('div', { class: 'depth-list', hidden: true });
  let ready = null;

  const run = async (btn, fn, done) => {
    btn.disabled = true;
    try {
      await fn();
      toast(done);
      closeSheet(ctx);
      ctx.refresh();
    } catch (e) { console.error(e); toast(errText(e)); } finally { btn.disabled = false; }
  };
  const suggest = (edit, btn) => run(btn, async () => {
    if (!(await ready())) throw new Error(t('report.needCaptcha'));
    await api.proposeEdit(r.id, edit);
  }, t('detail.suggested'));
  const button = (label, onClick, cls = 'ghost') => {
    const b = el('button', { type: 'button', class: cls }, label);
    b.addEventListener('click', () => onClick(b));
    return b;
  };

  if (r.mine) {
    // Your own report: move it while pending, and close it yourself when it's over.
    if (pending) actions.append(button(`✥ ${t('detail.move')}`, () => openMove(ctx, r)));
    actions.append(button(help ? t('help.done') : t('detail.closeFlood'),
      (b) => run(b, () => api.closeReport(r.id), t('detail.closed')), help ? 'primary' : 'ghost'));
  } else if (!pending) {
    actions.append(button(`✥ ${t('detail.suggestMove')}`, () => openMove(ctx, r)));
    if (help) {
      actions.append(button(t('help.done'), (b) => suggest({ kind: 'resolved' }, b)));
    } else {
      actions.append(
        button(`≋ ${t('detail.suggestDepth')}`, () => { depthPick.hidden = !depthPick.hidden; }),
        button(`☀ ${t('detail.receded')}`, (b) => suggest({ kind: 'receded' }, b)));
      depthPick.append(...CONFIG.depths.filter((d) => d.id !== r.depth).map((d) =>
        button([el('i', { style: `background:${d.color}` }), t(d.key)], (b) => suggest({ kind: 'depth', depth: d.id }, b), 'depth-btn')));
    }
  }

  openSheet(ctx, [
    el('div', { class: 'row between' },
      el('span', { class: 'meta' }, t('detail.reported', { t: timeAgo(r.createdAt) })),
      el('span', { class: `chip ${pending ? 'chip-pending' : 'chip-ok'}` }, pending ? t('detail.pending') : t('detail.approved'))),
    ...summary(r),
    r.note ? el('p', { class: 'note' }, r.note) : null,
    el('p', { class: 'meta' }, t('detail.expires', { t: timeLeft(r.expiresAt) })),
    photosBox,
    actions,
    depthPick,
    gateBox,
    el('button', { type: 'button', class: 'ghost wide', onclick: () => closeSheet(ctx) }, t('detail.close')),
  ].filter(Boolean));
  showReport(map, r);

  showPhotos(api, r.photos, photosBox);
  if (!pending && !r.mine) ready = await sessionGate(api, gateBox, toast, t('report.needCaptcha'));
}
