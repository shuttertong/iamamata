// Rain radar on our map: RainViewer past radar (last ~2 h, one frame every 10 min), with playback.
// RainViewer's free tier (since 2026-01): past frames only, tiles up to zoom 7 (MapLibre scales them up),
// "Universal Blue" colours, personal / educational use, 100 requests per IP per minute.
import { CONFIG } from './config.js';
import { t } from './i18n.js';
import { el, toast } from './ui.js';

const API = 'https://api.rainviewer.com/public/weather-maps.json';
const R = CONFIG.radar;
const hhmm = (sec) => new Date(sec * 1000).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false });

/** box: element the control goes into. before: layer ids to draw the radar under (first one that exists). */
export function createRadar(map, box, { before = [] } = {}) {
  let frames = [];
  let idx = 0;
  let on = false;
  let playTimer = 0;
  let refreshTimer = 0;

  const btn = el('button', { type: 'button', class: 'radar-btn', 'aria-pressed': 'false' });
  const time = el('span', { class: 'radar-time', hidden: true });
  const key = el('span', { class: 'radar-key', hidden: true });   // colour key: light → heavy rain
  const play = el('button', { type: 'button', class: 'radar-play', hidden: true });
  box.prepend(el('div', { class: 'radar' }, btn, time, play, key));

  const id = (f) => `radar-${f.time}`;
  const beforeId = () => before.find((b) => map.getLayer(b));

  function addFrame(host, f) {
    map.addSource(id(f), {
      type: 'raster', tileSize: 256, maxzoom: 7,
      tiles: [`${host}${f.path}/256/{z}/{x}/{y}/${R.color}/1_1.png`],
      attribution: '<a href="https://www.rainviewer.com/" target="_blank" rel="noopener">RainViewer</a>',
    });
    map.addLayer({ id: id(f), type: 'raster', source: id(f), paint: { 'raster-opacity': 0, 'raster-fade-duration': 0 } }, beforeId());
  }
  function removeFrame(f) {
    if (map.getLayer(id(f))) map.removeLayer(id(f));
    if (map.getSource(id(f))) map.removeSource(id(f));
  }

  function show(i) {
    idx = i;
    frames.forEach((f, j) => map.setPaintProperty(id(f), 'raster-opacity', j === i ? R.opacity : 0));
    const latest = i === frames.length - 1;
    time.textContent = t('radar.time', { t: hhmm(frames[i].time) }) + (latest ? t('radar.latest') : '');
    time.classList.toggle('old', !latest);
  }

  async function load() {
    try {
      const json = await (await fetch(API)).json();
      const next = json.radar.past.slice(-R.frames);
      frames.filter((f) => !next.some((n) => n.time === f.time)).forEach(removeFrame);
      next.filter((f) => !map.getSource(id(f))).forEach((f) => addFrame(json.host, f));
      frames = next;
      if (!playTimer) show(frames.length - 1);
    } catch (e) {
      console.warn('radar', e);
      toast(t('radar.error'));
    }
  }

  function stopPlay() {
    clearInterval(playTimer);
    playTimer = 0;
    play.textContent = '▶';
    play.setAttribute('aria-label', t('radar.play'));
    if (frames.length) show(frames.length - 1);
  }
  function startPlay() {
    if (!frames.length) return;
    play.textContent = '⏸';
    play.setAttribute('aria-label', t('radar.pause'));
    show(0);
    playTimer = setInterval(() => {
      if (idx >= frames.length - 1) { stopPlay(); return; }   // one pass, then rest on the latest frame
      show(idx + 1);
    }, R.frameMs);
  }

  async function setOn(v) {
    on = v;
    btn.setAttribute('aria-pressed', String(on));
    time.hidden = !on;
    play.hidden = !on;
    key.hidden = !on;
    clearInterval(refreshTimer);
    if (on) {
      time.textContent = t('radar.loading');
      if (!map.isStyleLoaded()) await new Promise((r) => map.once('load', r));   // tapped before the map was ready
      await load();
      refreshTimer = setInterval(load, R.refreshMin * 60e3);
    } else {
      stopPlay();
      frames.forEach(removeFrame);
      frames = [];
    }
  }

  function label() {
    btn.textContent = t('radar.btn');
    key.replaceChildren(el('i'), t('radar.key'));
    if (!playTimer) { play.textContent = '▶'; play.setAttribute('aria-label', t('radar.play')); }
  }

  btn.addEventListener('click', () => setOn(!on));
  play.addEventListener('click', () => (playTimer ? stopPlay() : startPlay()));
  label();
  return { label, setOn };
}
