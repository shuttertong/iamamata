/* global turnstile */
// Cloudflare Turnstile, only when CONFIG.turnstileSiteKey is set (Supabase checks the token on anonymous sign-in).
import { CONFIG } from './config.js';

let loading = null;
function load() {
  loading ??= new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.onload = res;
    s.onerror = () => rej(new Error('captcha_load_failed'));
    document.head.append(s);
  });
  return loading;
}

/** Renders the widget into box; returns { token(): string|null }. Without a site key token() is always ''. */
export async function mountCaptcha(box) {
  if (!CONFIG.turnstileSiteKey) return { token: () => '' };
  let tok = null;
  await load();
  turnstile.render(box, {
    sitekey: CONFIG.turnstileSiteKey,
    callback: (t) => { tok = t; },
    'expired-callback': () => { tok = null; },
  });
  return { token: () => tok };
}

/**
 * Prepares a session for writing. Shows the captcha in box only when one is needed.
 * Returns ready(): resolves true once signed in, false (with a toast) when the captcha is not done.
 */
export async function sessionGate(api, box, toast, needCaptchaText) {
  await api.hasSession();
  let captcha = null;
  if (api.needsCaptcha()) {
    try { captcha = await mountCaptcha(box); } catch (e) { console.warn(e); }
  }
  return async () => {
    if (!captcha) { await api.ensureSession(); return true; }
    const tok = captcha.token();
    if (!tok) { toast(needCaptchaText); return false; }
    await api.ensureSession(tok);
    return true;
  };
}
