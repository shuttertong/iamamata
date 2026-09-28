// Picks the backend. Both return the same interface:
//   mode, hasSession(), needsCaptcha(), ensureSession(captchaToken)
//   listPublic(), createReport(r), updateMyReport(id, patch), proposeEdit(reportId, edit), closeReport(id)
//   photoUrls(paths) → { path: url }, subscribe(fn), listPlaces()
//   places (admin): addPlace(p), updatePlace(id, patch), deletePlace(id), importPlaces(rows) → count
//   admin: signIn(email, pw), signOut(), isAdmin(), listForReview(), review(report, approve, reason), reviewEdit(id, approve),
//          adminUpdate(id, patch), adminRemove(report, reason)
// Report: { id, kind ('flood' | 'help'), lat, lng, path ([[lng, lat], ...] | null), depth, needs[], people, note, photos[],
//           photoTakenAt, photoHash, deviceDistanceM, status, mine, createdAt, expiresAt, contact? (admin only) }
// Edit:   { id, reportId, kind ('move' | 'depth' | 'receded' | 'resolved'), lat, lng, path, depth, status, createdAt }
import { CONFIG } from './config.js';

export async function createApi() {
  if (CONFIG.supabaseUrl && CONFIG.supabaseAnonKey) {
    return (await import('./api-supabase.js')).createSupabaseApi(CONFIG);
  }
  return (await import('./api-demo.js')).createDemoApi(CONFIG);
}

/** Review queue: help requests first, then reports with photos, oldest first. */
export function queueOrder(a, b) {
  return (b.kind === 'help') - (a.kind === 'help') || b.photos.length - a.photos.length || a.createdAt.localeCompare(b.createdAt);
}
