'use strict';
// Cloudflare Turnstile — server-side token verification (Siteverify) for /api/contact. No npm dependencies.
//
// Env (server-side only; never sent to the browser):
//   TURNSTILE_SECRET_KEY        required. Missing = verification unavailable (the form fails closed with 503).
//   TURNSTILE_ALLOWED_HOSTNAMES optional, comma-separated. Default: afra-digital.com, www.afra-digital.com.
//                               On Vercel Preview deployments the deployment's own hostnames (VERCEL_URL,
//                               VERCEL_BRANCH_URL, set by Vercel) are added automatically.
//   TURNSTILE_VERIFY_URL        tests/local development only (points at a mock). Ignored in production.
//
// Tokens are single-use and expire after 300 s; Cloudflare reports reused or expired tokens as
// "timeout-or-duplicate". Tokens and the secret are never logged.

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const ACTION = 'contact';                                 // must match the widget's `action` in assets/js/contact-form.js
const DEFAULT_HOSTNAMES = ['afra-digital.com', 'www.afra-digital.com'];
const TOKEN_MAX_LENGTH = 2048;                            // Cloudflare's documented maximum token length
const TOKEN_RE = /^[\x21-\x7E]+$/;                        // printable ASCII, no whitespace
const IP_RE = /^[0-9a-fA-F:.]{2,45}$/;

const hostList = s => String(s || '').split(',').map(h => h.trim().toLowerCase()).filter(Boolean);

function turnstileConfig(env = process.env) {
  const secret = String(env.TURNSTILE_SECRET_KEY || '').trim();
  const production = env.VERCEL_ENV === 'production';
  const custom = String(env.TURNSTILE_VERIFY_URL || '').trim();
  const allowedHostnames = new Set(env.TURNSTILE_ALLOWED_HOSTNAMES ? hostList(env.TURNSTILE_ALLOWED_HOSTNAMES) : DEFAULT_HOSTNAMES);
  if (env.VERCEL_ENV === 'preview') for (const h of [env.VERCEL_URL, env.VERCEL_BRANCH_URL]) for (const x of hostList(h)) allowedHostnames.add(x);
  return {
    configured: secret !== '',
    secret,
    verifyUrl: custom && !production ? custom : VERIFY_URL,
    allowedHostnames,
    action: ACTION,
  };
}

/** Reads the token from a parsed request body. Returns '' when absent or not a string. */
function tokenFrom(body) {
  const t = body && typeof body === 'object' ? body['cf-turnstile-response'] : undefined;
  return typeof t === 'string' ? t.trim() : '';
}

/**
 * Verify a Turnstile token with Cloudflare Siteverify.
 * @returns {Promise<{ ok: true } | { ok: false, status: 400 | 503, reason: string, codes?: string[] }>}
 *   400 reasons (visitor must retry with a new token): missing, invalid, expired_or_reused, hostname, action
 *   503 reasons (fail closed — never bypassed):        not_configured, unavailable, timeout, malformed, misconfigured
 */
async function verifyTurnstile(token, { config, remoteIp, fetchImpl = fetch, timeoutMs = 4000 } = {}) {
  if (!config || !config.configured) return { ok: false, status: 503, reason: 'not_configured' };
  if (!token) return { ok: false, status: 400, reason: 'missing' };
  if (token.length > TOKEN_MAX_LENGTH || !TOKEN_RE.test(token)) return { ok: false, status: 400, reason: 'invalid' };

  const form = new URLSearchParams({ secret: config.secret, response: token });
  if (remoteIp && IP_RE.test(remoteIp)) form.set('remoteip', remoteIp);

  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = setTimeout(() => { if (controller) controller.abort(); }, timeoutMs);
  let data;
  try {
    const res = await fetchImpl(config.verifyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      signal: controller ? controller.signal : undefined,
    });
    if (!res || typeof res.status !== 'number' || res.status >= 500) return { ok: false, status: 503, reason: 'unavailable' };
    try { data = await res.json(); } catch { return { ok: false, status: 503, reason: 'malformed' }; }
  } catch (err) {
    return { ok: false, status: 503, reason: err && err.name === 'AbortError' ? 'timeout' : 'unavailable' };
  } finally { clearTimeout(timer); }

  if (!data || typeof data !== 'object' || typeof data.success !== 'boolean') return { ok: false, status: 503, reason: 'malformed' };
  const codes = Array.isArray(data['error-codes']) ? data['error-codes'].filter(c => typeof c === 'string' && /^[a-z-]{1,40}$/.test(c)).slice(0, 5) : [];

  if (data.success !== true) {
    // Our own request or key is wrong, or Cloudflare had a problem: fail closed (503), the visitor's token is not at fault.
    if (codes.some(c => /^(missing|invalid)-input-secret$|^bad-request$|^internal-error$/.test(c))) {
      return { ok: false, status: 503, reason: codes.includes('internal-error') ? 'unavailable' : 'misconfigured', codes };
    }
    if (codes.includes('timeout-or-duplicate')) return { ok: false, status: 400, reason: 'expired_or_reused', codes };
    return { ok: false, status: 400, reason: 'invalid', codes };
  }
  const hostname = typeof data.hostname === 'string' ? data.hostname.toLowerCase() : '';
  if (!config.allowedHostnames.has(hostname)) return { ok: false, status: 400, reason: 'hostname' };
  if (config.action && data.action !== config.action) return { ok: false, status: 400, reason: 'action' };
  return { ok: true };
}

module.exports = { turnstileConfig, tokenFrom, verifyTurnstile, VERIFY_URL, ACTION, DEFAULT_HOSTNAMES, TOKEN_MAX_LENGTH };
