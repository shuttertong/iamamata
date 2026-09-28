// Demo backend: everything stays in this browser (localStorage). Tabs sync through BroadcastChannel.
// It mirrors the database rules so the UI behaves the same as with Supabase.
import { uuid, inArea, pathLength } from './ui.js';
import { queueOrder } from './api.js';

const KEY = 'floodmap.demo.v4';   // bumped: sample phones are obviously fake now
const HOUR = 3600e3;
const channel = 'BroadcastChannel' in globalThis ? new BroadcastChannel('floodmap-demo') : null;

// Sample reports inside the AMATA / Phan Thong area (demo data only).
function seed(cfg) {
  const now = Date.now();
  const r = (o, ageMin, status = 'approved') => ({
    id: uuid(), kind: 'flood', path: null, depth: null, needs: [], people: null, note: '', photos: [],
    photoTakenAt: null, photoHash: null, deviceDistanceM: 40, status, reporterId: 'seed',
    createdAt: new Date(now - ageMin * 60e3).toISOString(),
    expiresAt: new Date(now + cfg.hours[o.kind || 'flood'] * HOUR - ageMin * 60e3).toISOString(),
    ...o,
  });
  const reports = [
    r({ lat: 13.4450, lng: 101.0850, depth: 2, note: 'ถนนในนิคม น้ำขังหน้าโรงงาน รถเล็กผ่านลำบาก' }, 35),
    r({ lat: 13.4155, lng: 101.0672, depth: 1, note: 'ถนนศุขประยูร หน้าวัดหนองตำลึง น้ำขังริมทาง' }, 80),
    r({ lat: 13.4685, lng: 101.0975, depth: 3, note: 'ถนนมาบโป่ง–หัวไผ่ ใกล้ รพ.พานทอง น้ำสูงระดับเอว' }, 15),
    r({
      lat: 13.4312, lng: 101.0402, depth: 2, note: 'ถนนเลียบมอเตอร์เวย์ น้ำท่วมยาวทั้งช่วง',
      path: [[101.0371, 13.4335], [101.0392, 13.4318], [101.0412, 13.4306], [101.0436, 13.4296]],
    }, 25),
    r({ lat: 13.4413, lng: 101.0457, depth: 2, note: 'รอตรวจ: ทางลอดใต้มอเตอร์เวย์ น้ำเริ่มขึ้น' }, 5, 'pending'),
    r({ kind: 'help', lat: 13.4580, lng: 101.0905, depth: 3, needs: ['trapped', 'vulnerable'], people: 4, note: 'ผู้สูงอายุ 2 คน ออกจากบ้านไม่ได้' }, 20),
    r({ kind: 'help', lat: 13.4225, lng: 101.0590, needs: ['food'], people: 12, note: 'รอตรวจ: หอพักคนงาน อาหารหมด' }, 3, 'pending'),
  ];
  const contacts = {
    [reports[5].id]: { name: 'คุณเอ (ตัวอย่าง)', phone: '000-000-0001' },
    [reports[6].id]: { name: '', phone: '000-000-0002' },
  };
  return { reports, edits: [], photos: {}, contacts, seededAt: now };
}

/** Sample reports age out like real ones; refresh them (keeping the user's own) so the demo never looks empty. */
function freshen(db, cfg) {
  if (db.seededAt && Date.now() - db.seededAt < 6 * HOUR) return db;
  const fresh = seed(cfg);
  const oldSeed = new Set(db.reports.filter((r) => r.reporterId === 'seed').map((r) => r.id));
  return {
    ...db,
    reports: [...fresh.reports, ...db.reports.filter((r) => !oldSeed.has(r.id))],
    edits: db.edits.filter((e) => !oldSeed.has(e.reportId)),
    contacts: { ...Object.fromEntries(Object.entries(db.contacts || {}).filter(([id]) => !oldSeed.has(id))), ...fresh.contacts },
    seededAt: fresh.seededAt,
  };
}

export function createDemoApi(cfg) {
  let uid = null;
  try { uid = localStorage.getItem('floodmap.demo.uid'); } catch { /* ignore */ }
  let admin = false;
  try { admin = sessionStorage.getItem('floodmap.demo.admin') === '1'; } catch { /* ignore */ }
  const stored = load();
  let db = freshen(stored || seed(cfg), cfg);
  const listeners = new Set();
  if (db !== stored) save();   // share the (re)seeded data with the other tabs

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* quota: keep in memory */ }
    channel?.postMessage('changed');
    listeners.forEach((fn) => fn());
  }
  channel?.addEventListener('message', () => { db = load() || db; listeners.forEach((fn) => fn()); });

  const live = (r) => new Date(r.expiresAt) > Date.now();
  const view = (r) => ({ ...r, mine: !!uid && r.reporterId === uid });
  const needAdmin = () => { if (!admin) throw new Error('not_admin'); };
  const blobToDataUrl = (blob) => new Promise((res) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.readAsDataURL(blob);
  });
  // Same checks as the SQL trigger.
  function checkGeometry(lat, lng, path) {
    if (!inArea(lat, lng) || (path && path.some(([x, y]) => !inArea(y, x)))) throw new Error('outside_area');
    if (path && (path.length < 2 || path.length > cfg.path.maxPoints)) throw new Error('bad_path');
    if (path && pathLength(path) > cfg.path.maxKm * 1000) throw new Error('path_too_long');
  }
  function close(r) {
    r.status = r.kind === 'help' ? 'resolved' : 'expired';
    r.expiresAt = new Date().toISOString();
  }

  return {
    mode: 'demo',
    hasSession: async () => !!uid,
    needsCaptcha: () => false,
    async ensureSession() {
      if (!uid) {
        uid = uuid();
        try { localStorage.setItem('floodmap.demo.uid', uid); } catch { /* ignore */ }
      }
      return uid;
    },

    async listPublic() {
      return db.reports
        .filter((r) => live(r) && (r.status === 'approved' || (r.status === 'pending' && r.reporterId === uid)))
        .map(view);
    },

    async createReport({ kind = 'flood', lat, lng, path = null, depth = null, needs = [], people = null, note, photos = [], deviceDistanceM = null, contact = null }) {
      await this.ensureSession();
      checkGeometry(lat, lng, kind === 'help' ? null : path);
      if (kind === 'flood' && !depth) throw new Error('depth_required');
      if (kind === 'help' && !contact?.phone) throw new Error('phone_required');
      const paths = [];
      for (const p of photos) {
        const key = `${uid}/${uuid()}.jpg`;
        db.photos[key] = await blobToDataUrl(p.blob);
        paths.push(key);
      }
      const now = Date.now();
      const r = {
        id: uuid(), kind, lat, lng, path: kind === 'help' ? null : path, depth, needs, people,
        note: (note || '').slice(0, cfg.noteMax), photos: paths,
        photoTakenAt: photos[0]?.takenAt ?? null, photoHash: photos[0]?.hash ?? null, deviceDistanceM,
        status: 'pending', reporterId: uid, createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + cfg.hours[kind] * HOUR).toISOString(),
      };
      db.reports.push(r);
      if (kind === 'help') db.contacts[r.id] = { name: contact.name || '', phone: contact.phone };
      save();
      return view(r);
    },

    async updateMyReport(id, patch) {
      const r = db.reports.find((x) => x.id === id && x.reporterId === uid && x.status === 'pending');
      if (!r) throw new Error('not_allowed');
      const next = { ...r, ...patch };
      checkGeometry(next.lat, next.lng, next.path);
      for (const k of ['lat', 'lng', 'path', 'depth', 'needs', 'people', 'note']) if (k in patch) r[k] = patch[k];
      save();
    },

    async proposeEdit(reportId, { kind, lat = null, lng = null, path = null, depth = null }) {
      await this.ensureSession();
      const r = db.reports.find((x) => x.id === reportId && x.status === 'approved' && live(x));
      if (!r) throw new Error('not_allowed');
      if (kind === 'move') checkGeometry(lat, lng, path);
      db.edits.push({ id: uuid(), reportId, kind, lat, lng, path, depth, status: 'pending', proposerId: uid, createdAt: new Date().toISOString() });
      save();
    },

    /** Owner or admin: help → resolved, flood → expired. */
    async closeReport(id) {
      const r = db.reports.find((x) => x.id === id && (x.status === 'pending' || x.status === 'approved'));
      if (!r || !(admin || r.reporterId === uid)) throw new Error('not_allowed');
      close(r);
      save();
    },

    // ── places (factory names for search); read by anyone, written by admins ──
    async listPlaces() { return [...(db.places || [])]; },
    async addPlace({ name, nameEn = null, lat, lng }) {
      needAdmin();
      if (!name?.trim()) throw new Error('name_required');
      if (!inArea(lat, lng)) throw new Error('outside_area');
      (db.places ||= []).push({ id: uuid(), name: name.trim(), nameEn: nameEn?.trim() || null, lat, lng });
      save();
    },
    async updatePlace(id, patch) {
      needAdmin();
      const p = (db.places || []).find((x) => x.id === id);
      if (!p) throw new Error('not_found');
      const next = { ...p, ...patch };
      if (!next.name?.trim()) throw new Error('name_required');
      if (!inArea(next.lat, next.lng)) throw new Error('outside_area');
      Object.assign(p, next);
      save();
    },
    async deletePlace(id) {
      needAdmin();
      db.places = (db.places || []).filter((x) => x.id !== id);
      save();
    },
    /** rows: [{ name, nameEn, lat, lng }] already validated by the caller; returns the count added. */
    async importPlaces(rows) {
      needAdmin();
      const ok = rows.filter((r) => r.name && inArea(r.lat, r.lng));
      (db.places ||= []).push(...ok.map((r) => ({ id: uuid(), name: r.name, nameEn: r.nameEn || null, lat: r.lat, lng: r.lng })));
      save();
      return ok.length;
    },

    async photoUrls(paths) {
      return Object.fromEntries(paths.map((p) => [p, db.photos[p]]).filter(([, u]) => u));
    },

    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    // ── admin ──
    async signIn() {
      admin = true;
      try { sessionStorage.setItem('floodmap.demo.admin', '1'); } catch { /* ignore */ }
    },
    async signOut() {
      admin = false;
      try { sessionStorage.removeItem('floodmap.demo.admin'); } catch { /* ignore */ }
    },
    isAdmin: async () => admin,

    async listForReview() {
      needAdmin();
      const active = db.reports
        .filter((r) => live(r) && (r.status === 'pending' || r.status === 'approved'))
        .map((r) => ({ ...view(r), contact: db.contacts[r.id] || null }));
      return {
        pending: active.filter((r) => r.status === 'pending').sort(queueOrder),
        help: active.filter((r) => r.kind === 'help' && r.status === 'approved').sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
        active,
        edits: db.edits.filter((e) => e.status === 'pending'),
      };
    },

    async review(report, approve, reason = null) {
      needAdmin();
      const r = db.reports.find((x) => x.id === report.id && x.status === 'pending');
      if (!r) throw new Error('not_pending');
      r.status = approve ? 'approved' : 'rejected';
      r.rejectReason = approve ? null : reason;
      if (approve) r.expiresAt = new Date(Date.now() + cfg.hours[r.kind] * HOUR).toISOString();
      else {
        r.photos.forEach((p) => delete db.photos[p]);
        r.photos = [];
        delete db.contacts[r.id];
      }
      save();
    },

    /** Admin edits any active report directly (same checks as SQL admin_update_report). */
    async adminUpdate(id, patch) {
      needAdmin();
      const r = db.reports.find((x) => x.id === id && (x.status === 'pending' || x.status === 'approved'));
      if (!r) throw new Error('not_found');
      const next = { ...r, ...patch };
      checkGeometry(next.lat, next.lng, next.path);
      if (next.kind === 'flood' && !next.depth) throw new Error('depth_required');
      for (const k of ['lat', 'lng', 'path', 'depth', 'note', 'needs', 'people']) if (k in patch) r[k] = patch[k];
      save();
    },

    /** Admin takes a report off the map. */
    async adminRemove(report, reason = null) {
      needAdmin();
      const r = db.reports.find((x) => x.id === report.id && (x.status === 'pending' || x.status === 'approved'));
      if (!r) throw new Error('not_found');
      r.status = 'rejected';
      r.rejectReason = reason;
      r.photos.forEach((p) => delete db.photos[p]);
      r.photos = [];
      delete db.contacts[r.id];
      save();
    },

    async reviewEdit(id, approve) {
      needAdmin();
      const e = db.edits.find((x) => x.id === id && x.status === 'pending');
      if (!e) throw new Error('not_pending');
      e.status = approve ? 'approved' : 'rejected';
      const r = db.reports.find((x) => x.id === e.reportId);
      if (approve && r) {
        if (e.kind === 'move') { r.lat = e.lat; r.lng = e.lng; r.path = e.path; }
        if (e.kind === 'depth') r.depth = e.depth;
        if (e.kind === 'receded' || e.kind === 'resolved') close(r);
      }
      save();
    },
  };
}
