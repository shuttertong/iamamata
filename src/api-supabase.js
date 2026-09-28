// Supabase backend. Access rules are enforced by RLS in supabase/migrations/0001_init.sql;
// this file only calls what the database allows.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { uuid } from './ui.js';
import { queueOrder } from './api.js';

const BUCKET = 'flood-photos';
const COLS = 'id,kind,lat,lng,path,depth,needs,people,note,photos,photo_taken_at,photo_hash,device_distance_m,status,reporter_id,created_at,expires_at';

export function createSupabaseApi(cfg) {
  const sb = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
  let uid = null;
  const urlCache = new Map();

  const ok = ({ data, error }) => { if (error) throw error; return data; };
  const norm = (r) => ({
    id: r.id, kind: r.kind, lat: r.lat, lng: r.lng, path: r.path || null, depth: r.depth, needs: r.needs || [],
    people: r.people, note: r.note || '', photos: r.photos || [],
    photoTakenAt: r.photo_taken_at, photoHash: r.photo_hash, deviceDistanceM: r.device_distance_m,
    status: r.status, mine: !!uid && r.reporter_id === uid, createdAt: r.created_at, expiresAt: r.expires_at,
  });
  async function refreshUid() {
    const { data } = await sb.auth.getSession();
    uid = data.session?.user?.id ?? null;
    return uid;
  }
  const activeRows = () => sb.from('flood_reports').select(COLS)
    .in('status', ['approved', 'pending']).gt('expires_at', new Date().toISOString()).limit(5000);

  return {
    mode: 'supabase',
    hasSession: async () => !!(await refreshUid()),
    needsCaptcha: () => !!cfg.turnstileSiteKey && !uid,

    async ensureSession(captchaToken) {
      if (await refreshUid()) return uid;
      const opts = captchaToken ? { options: { captchaToken } } : undefined;
      const data = ok(await sb.auth.signInAnonymously(opts));
      uid = data.user.id;
      return uid;
    },

    async listPublic() {
      await refreshUid();
      const rows = ok(await activeRows());
      // An admin session can read every pending row; the public map shows only confirmed + your own.
      return rows.filter((r) => r.status === 'approved' || r.reporter_id === uid).map(norm);
    },

    async createReport({ kind = 'flood', lat, lng, path = null, depth = null, needs = [], people = null, note, photos = [], deviceDistanceM = null, contact = null }) {
      if (!(await refreshUid())) throw new Error('no_session');
      const paths = [];
      for (const p of photos) {
        const key = `${uid}/${uuid()}.jpg`;
        ok(await sb.storage.from(BUCKET).upload(key, p.blob, { contentType: 'image/jpeg', upsert: false }));
        paths.push(key);
      }
      let row = null;
      try {
        row = ok(await sb.from('flood_reports').insert({
          kind, lat, lng, path: kind === 'help' ? null : path, depth, needs, people,
          note: note || null, photos: paths,
          photo_taken_at: photos[0]?.takenAt ?? null, photo_hash: photos[0]?.hash ?? null,
          device_distance_m: deviceDistanceM,
        }).select(COLS).single());
        if (kind === 'help') {
          ok(await sb.from('help_contacts').insert({ report_id: row.id, name: contact?.name || null, phone: contact?.phone }));
        }
        return norm(row);
      } catch (e) {
        // Don't leave half a request behind: a help request without a contact is useless.
        if (row) await sb.from('flood_reports').delete().eq('id', row.id);
        if (paths.length) await sb.storage.from(BUCKET).remove(paths);
        throw e;
      }
    },

    async updateMyReport(id, patch) {
      const keys = ['lat', 'lng', 'path', 'depth', 'needs', 'people', 'note'];
      const allowed = Object.fromEntries(Object.entries(patch).filter(([k]) => keys.includes(k)));
      ok(await sb.from('flood_reports').update(allowed).eq('id', id));
    },

    async proposeEdit(reportId, { kind, lat = null, lng = null, path = null, depth = null }) {
      ok(await sb.from('report_edits').insert({ report_id: reportId, kind, lat, lng, path, depth }));
    },

    async closeReport(id) {
      ok(await sb.rpc('close_report', { p_id: id }));
    },

    // ── places (factory names for search) ──
    async listPlaces() {
      const rows = ok(await sb.from('places').select('id,name,name_en,lat,lng').limit(20000));
      return rows.map((p) => ({ id: p.id, name: p.name, nameEn: p.name_en, lat: p.lat, lng: p.lng }));
    },
    async addPlace({ name, nameEn = null, lat, lng }) {
      ok(await sb.from('places').insert({ name: name.trim(), name_en: nameEn?.trim() || null, lat, lng }));
    },
    async updatePlace(id, patch) {
      const row = {};
      if ('name' in patch) row.name = patch.name.trim();
      if ('nameEn' in patch) row.name_en = patch.nameEn?.trim() || null;
      if ('lat' in patch) { row.lat = patch.lat; row.lng = patch.lng; }
      ok(await sb.from('places').update(row).eq('id', id));
    },
    async deletePlace(id) {
      ok(await sb.from('places').delete().eq('id', id));
    },
    async importPlaces(rows) {
      let n = 0;
      for (let i = 0; i < rows.length; i += 500) {
        const chunk = rows.slice(i, i + 500).map((r) => ({ name: r.name, name_en: r.nameEn || null, lat: r.lat, lng: r.lng }));
        ok(await sb.from('places').insert(chunk));
        n += chunk.length;
      }
      return n;
    },

    async photoUrls(paths) {
      const need = paths.filter((p) => !urlCache.has(p));
      if (need.length) {
        const signed = ok(await sb.storage.from(BUCKET).createSignedUrls(need, 3600));
        for (const s of signed) if (s.signedUrl) urlCache.set(s.path, s.signedUrl);
      }
      return Object.fromEntries(paths.filter((p) => urlCache.has(p)).map((p) => [p, urlCache.get(p)]));
    },

    subscribe(fn) {
      const ch = sb.channel('flood-changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'flood_reports' }, fn)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'report_edits' }, fn)
        .subscribe();
      return () => sb.removeChannel(ch);
    },

    // ── admin ──
    async signIn(email, password) {
      ok(await sb.auth.signInWithPassword({ email, password }));
      await refreshUid();
    },
    async signOut() { await sb.auth.signOut(); uid = null; },
    async isAdmin() {
      if (!(await refreshUid())) return false;
      return !!ok(await sb.rpc('is_admin'));
    },

    async listForReview() {
      const active = ok(await activeRows()).map(norm);
      const helpIds = active.filter((r) => r.kind === 'help').map((r) => r.id);
      const contacts = helpIds.length
        ? ok(await sb.from('help_contacts').select('report_id,name,phone').in('report_id', helpIds)) : [];
      const byId = Object.fromEntries(contacts.map((c) => [c.report_id, { name: c.name || '', phone: c.phone }]));
      active.forEach((r) => { r.contact = byId[r.id] || null; });
      const edits = ok(await sb.from('report_edits').select('id,report_id,kind,lat,lng,path,depth,status,created_at')
        .eq('status', 'pending').order('created_at'));
      return {
        pending: active.filter((r) => r.status === 'pending').sort(queueOrder),
        help: active.filter((r) => r.kind === 'help' && r.status === 'approved').sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
        active,
        edits: edits.map((e) => ({
          id: e.id, reportId: e.report_id, kind: e.kind, lat: e.lat, lng: e.lng, path: e.path || null,
          depth: e.depth, status: e.status, createdAt: e.created_at,
        })),
      };
    },

    async review(report, approve, reason = null) {
      // Delete rejected photos first; the RPC clears the paths (and the help contact).
      if (!approve && report.photos.length) ok(await sb.storage.from(BUCKET).remove(report.photos));
      ok(await sb.rpc('review_report', { p_id: report.id, p_approve: approve, p_reason: reason, p_hours: cfg.hours[report.kind] }));
    },

    async adminUpdate(id, patch) {
      const keys = ['lat', 'lng', 'path', 'depth', 'note', 'needs', 'people'];
      const p = Object.fromEntries(Object.entries(patch).filter(([k]) => keys.includes(k)));
      ok(await sb.rpc('admin_update_report', { p_id: id, p_patch: p }));
    },

    async adminRemove(report, reason = null) {
      if (report.photos.length) ok(await sb.storage.from(BUCKET).remove(report.photos));
      ok(await sb.rpc('admin_remove_report', { p_id: report.id, p_reason: reason }));
    },

    async reviewEdit(id, approve) {
      ok(await sb.rpc('review_edit', { p_id: id, p_approve: approve }));
    },
  };
}
