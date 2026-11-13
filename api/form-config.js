'use strict';
// GET /api/form-config — public settings the contact form needs in the browser (same pattern as
// /api/analytics-config: the site has no build step, so public values come from server-side env vars).
//   TURNSTILE_SITE_KEY   Cloudflare Turnstile site key (public by design). Unset/invalid = null, and the form shows
//                        an honest "security check unavailable" message with WhatsApp/email alternatives.
// Only the PUBLIC site key is ever returned here. TURNSTILE_SECRET_KEY is read by api/contact.js only.

const SITE_KEY_RE = /^[0-9A-Za-z_-]{10,100}$/; // safe characters only (e.g. 0x4AAAA… or the 1x000…AA test keys); public value
const { ACTION } = require('./_lib/turnstile');

function formConfig(env = process.env) {
  const key = String(env.TURNSTILE_SITE_KEY || '').trim();
  return { turnstileSiteKey: SITE_KEY_RE.test(key) ? key : null, turnstileAction: ACTION };
}

module.exports = function handler(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405; res.setHeader('Allow', 'GET, HEAD');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({ ok: false, error: 'method_not_allowed' }));
  }
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  // Short CDN caching keeps function invocations low; key changes need a redeploy anyway.
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=600');
  res.end(req.method === 'HEAD' ? undefined : JSON.stringify(formConfig()));
};
module.exports.formConfig = formConfig;
module.exports.SITE_KEY_RE = SITE_KEY_RE;
