'use strict';
// POST /api/contact — receives website enquiries and delivers them by email.
// Vercel Node.js serverless function (no npm dependencies).
// Required server-side env var: RESEND_API_KEY. Optional: CONTACT_FROM_EMAIL, CONTACT_SENDER_DOMAIN,
// CONTACT_TO_EMAIL, CONTACT_ALLOWED_ORIGINS, RESEND_API_URL (tests only). See README.md / .env.example.
const core = require('./_lib/contact-core');

// Per-instance, best-effort limits (serverless instances are short-lived and may run in parallel).
const requestLimiter = createLimiterSafe(30, 10 * 60 * 1000); // any request per IP
const sendLimiter = createLimiterSafe(5, 10 * 60 * 1000);     // valid submissions per IP
const globalSendLimiter = createLimiterSafe(60, 10 * 60 * 1000);
const duplicates = core.createDuplicateGuard({ windowMs: 10 * 60 * 1000 });

function createLimiterSafe(limit, windowMs) { return core.createRateLimiter({ limit, windowMs }); }

const MESSAGES = {
  validation: 'Please check the highlighted fields and try again.',
  too_fast: 'Please wait a few seconds and send your message again.',
  rejected: 'Your message could not be sent. Please contact us on WhatsApp or by email.',
  rate_limited: 'Too many messages have been sent from your connection. Please try again later, or contact us on WhatsApp.',
  not_configured: 'Our contact form is temporarily unavailable. Please contact us on WhatsApp or by email.',
  delivery_failed: 'Sorry, your message could not be sent right now. Please contact us on WhatsApp or by email.',
  timeout: 'Sorry, sending took too long and your message may not have been delivered. Please contact us on WhatsApp or by email.',
  bad_request: 'Your message could not be read. Please try again.',
  forbidden: 'This request is not allowed.',
  method_not_allowed: 'Method not allowed.',
  unsupported_type: 'Unsupported request format.',
  too_large: 'Your message is too long. Please shorten it and try again.',
};

// Server-log hints for operators (never sent to the browser).
const CONFIG_HINTS = {
  missing_api_key: 'RESEND_API_KEY is not set for this Vercel environment; add it and redeploy',
  invalid_from: 'CONTACT_FROM_EMAIL is not a valid "Name <address>" or address',
  test_sender_not_allowed: 'resend.dev test sender only delivers to the Resend account owner; use an address on the verified domain',
  sender_domain_mismatch: 'CONTACT_FROM_EMAIL must use the verified sender domain (CONTACT_SENDER_DOMAIN)',
  invalid_to: 'CONTACT_TO_EMAIL must be a single valid address',
};
const DELIVERY_HINTS = {
  auth: 'Resend rejected the API key (missing, invalid, revoked or restricted) - check RESEND_API_KEY for this environment',
  test_sender_restriction: 'Resend test sender restriction - use a from-address on the verified domain',
  sender_unverified: 'from-address domain is not verified in Resend - check Resend > Domains',
  recipient_rejected: 'Resend refused the recipient - check account/domain restrictions',
  validation: 'Resend rejected the request payload',
  provider_rate_limited: 'Resend rate limit reached',
  provider_unavailable: 'Resend returned a server error (retried once)',
  network: 'could not reach Resend (retried once)',
  timeout: 'no response from Resend in time; delivery state unknown',
};

function clientIp(req) {
  const h = req.headers || {};
  const real = h['x-real-ip'];
  if (typeof real === 'string' && real) return real.trim();
  const fwd = h['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd) return fwd.split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

function readRawBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('too large'), { code: 'too_large' })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function readBody(req, type) {
  // On Vercel the body may already be parsed (req.body); locally we read the stream.
  let raw = req.body;
  if (raw === undefined) raw = await readRawBody(req, core.MAX_BODY_BYTES);
  if (Buffer.isBuffer(raw)) raw = raw.toString('utf8');
  if (typeof raw === 'string' && Buffer.byteLength(raw) > core.MAX_BODY_BYTES) throw Object.assign(new Error('too large'), { code: 'too_large' });
  if (type === 'form') {
    if (raw && typeof raw === 'object') return raw;
    return Object.fromEntries(new URLSearchParams(raw || ''));
  }
  if (raw && typeof raw === 'object') return raw;
  if (!raw) throw Object.assign(new Error('empty'), { code: 'bad_request' });
  try { return JSON.parse(raw); } catch { throw Object.assign(new Error('bad json'), { code: 'bad_request' }); }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Minimal HTML response for browsers that submitted the form without JavaScript.
function htmlPage(ok, message) {
  const title = ok ? 'Message sent' : 'Message not sent';
  const body = ok
    ? 'Thank you — your enquiry has been sent to AFRA DIGITAL. We will reply by email.'
    : escapeHtml(message);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${title} — AFRA DIGITAL</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#020617;color:#F1F5F9;font-family:system-ui,sans-serif;padding:24px}
main{max-width:520px;text-align:center}h1{color:#F0CF5A}a{color:#F0CF5A}</style></head>
<body><main><h1>${title}</h1><p>${body}</p>
<p><a href="https://wa.me/97430029799">WhatsApp +974 3002 9799</a> · <a href="mailto:afradigital.hello@gmail.com">afradigital.hello@gmail.com</a></p>
<p><a href="/#contact">Back to AFRA DIGITAL</a></p></main></body></html>`;
}

function send(res, status, payload, mode, extraHeaders = {}) {
  res.statusCode = status;
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  for (const [k, v] of Object.entries(extraHeaders)) res.setHeader(k, v);
  if (mode === 'form') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(htmlPage(payload.ok, payload.message || ''));
  } else {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(payload));
  }
}

const fail = (res, status, error, mode, extra, fields) =>
  send(res, status, { ok: false, error, message: MESSAGES[error], ...(fields ? { fields } : {}) }, mode, extra);

async function handler(req, res, deps = {}) {
  const env = deps.env || process.env;
  const fetchImpl = deps.fetch || fetch;
  const config = core.getConfig(env);

  if (req.method !== 'POST') return fail(res, 405, 'method_not_allowed', 'json', { Allow: 'POST' });

  const headers = req.headers || {};
  if (!core.isOriginAllowed(headers.origin, headers['x-forwarded-host'] || headers.host, config.allowedOrigins)) {
    return fail(res, 403, 'forbidden', 'json');
  }

  const ctype = String(headers['content-type'] || '').toLowerCase();
  const mode = ctype.includes('application/json') ? 'json' : ctype.includes('application/x-www-form-urlencoded') ? 'form' : null;
  if (!mode) return fail(res, 415, 'unsupported_type', 'json');

  const ip = clientIp(req);
  const reqLimit = requestLimiter.check(ip);
  if (!reqLimit.allowed) return fail(res, 429, 'rate_limited', mode, { 'Retry-After': String(reqLimit.retryAfterSec) });

  let body;
  try { body = await readBody(req, mode); } catch (err) {
    return err.code === 'too_large' ? fail(res, 413, 'too_large', mode) : fail(res, 400, 'bad_request', mode);
  }

  const bot = core.checkBotSignals(body);
  if (bot) return fail(res, 400, bot, mode);

  const result = core.validateSubmission(body);
  if (!result.ok) return fail(res, 400, 'validation', mode, {}, result.fields);
  const data = result.data;

  if (duplicates.isDuplicate(data)) return send(res, 200, { ok: true, duplicate: true }, mode);

  const ipLimit = sendLimiter.check(ip);
  const globalLimit = ipLimit.allowed ? globalSendLimiter.check('global') : { allowed: true };
  if (!ipLimit.allowed || !globalLimit.allowed) {
    const retry = String(ipLimit.retryAfterSec || globalLimit.retryAfterSec || 600);
    return fail(res, 429, 'rate_limited', mode, { 'Retry-After': retry });
  }

  if (!config.configured) {
    // Configuration diagnostics only — no secret values, no visitor data.
    console.error(`[contact] email provider not configured: ${config.problem} (${CONFIG_HINTS[config.problem] || 'check environment'})` +
      ` env=${env.VERCEL_ENV || 'unknown'}`);
    return fail(res, 503, 'not_configured', mode);
  }

  try {
    await core.deliver(config, data, { fetchImpl, timeoutMs: deps.timeoutMs || 7000, retryDelayMs: deps.retryDelayMs });
  } catch (err) {
    const kind = err.kind || 'error';
    console.error(`[contact] delivery failed kind=${kind}${err.status ? ' status=' + err.status : ''}` +
      ` sender_domain=${config.fromDomain} env=${env.VERCEL_ENV || 'unknown'}` +
      (DELIVERY_HINTS[kind] ? ` hint="${DELIVERY_HINTS[kind]}"` : '') +
      (err.detail ? ` provider="${err.detail}"` : ''));
    return kind === 'timeout' ? fail(res, 504, 'timeout', mode) : fail(res, 502, 'delivery_failed', mode);
  }

  duplicates.remember(data);
  return send(res, 200, { ok: true }, mode);
}

module.exports = handler;
module.exports.handler = handler;
module.exports.MESSAGES = MESSAGES;
