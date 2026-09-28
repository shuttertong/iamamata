// Small SVG line chart shared by the tide and river panels.
const SVG = 'http://www.w3.org/2000/svg';
const hhmm = (d) => d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false });

/**
 * pts:   [{ time: Date, m }]            the series (gaps allowed: m == null)
 * marks: [{ time, m, kind }]            labelled dots (kind: 'high' | 'low'), labelled with the time
 * refs:  [{ m, text, cls }]             horizontal reference lines (mean sea level, river bank …), kept in range
 * now:   ms timestamp for the "now" line; nowText: its label.  label: aria-label.
 */
export function lineChart({ pts, marks = [], refs = [], now = Date.now(), nowText = '', label = '' }) {
  const W = 480, H = 150, P = 18;
  const valid = pts.filter((p) => p.m != null);
  const t0 = pts[0].time.getTime(), t1 = pts.at(-1).time.getTime();
  const vals = valid.map((p) => p.m).concat(refs.map((r) => r.m));
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = (hi - lo) * 0.08 || 0.1;
  lo -= pad; hi += pad;
  const x = (d) => P + ((d.getTime() - t0) / (t1 - t0 || 1)) * (W - 2 * P);
  const y = (m) => H - P - ((m - lo) / (hi - lo || 1)) * (H - 2 * P);

  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'chart');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', label);
  const add = (tag, attrs, text) => {
    const n = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (text != null) n.textContent = text;
    svg.append(n);
    return n;
  };

  // The series, split at gaps so missing readings aren't drawn as straight lines.
  const runs = [];
  let run = [];
  for (const p of pts) {
    if (p.m == null) { if (run.length) runs.push(run); run = []; } else run.push(p);
  }
  if (run.length) runs.push(run);
  for (const r of runs) {
    const line = r.map((p) => `${x(p.time).toFixed(1)},${y(p.m).toFixed(1)}`).join(' ');
    add('polygon', { points: `${x(r[0].time)},${H - P} ${line} ${x(r.at(-1).time)},${H - P}`, class: 'chart-fill' });
    add('polyline', { points: line, class: 'chart-line' });
  }
  for (const r of refs) {
    add('line', { x1: P, x2: W - P, y1: y(r.m), y2: y(r.m), class: r.cls || 'chart-ref' });
    add('text', { x: W - P, y: y(r.m) - 3, class: 'chart-axis', 'text-anchor': 'end' }, r.text);
  }
  if (now > t0 && now < t1) {
    const nx = x(new Date(now));
    add('line', { x1: nx, x2: nx, y1: P - 6, y2: H - P, class: 'chart-now' });
    add('text', { x: nx, y: P - 8, class: 'chart-axis', 'text-anchor': 'middle' }, nowText);
  }
  for (const k of marks) {
    add('circle', { cx: x(k.time), cy: y(k.m), r: 3.5, class: `chart-${k.kind}` });
    add('text', { x: x(k.time), y: k.kind === 'high' ? y(k.m) - 7 : y(k.m) + 14, class: 'chart-lbl', 'text-anchor': 'middle' }, hhmm(k.time));
  }
  return svg;
}
