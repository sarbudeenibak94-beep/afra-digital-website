'use strict';
// Contact-form core: validation, sanitisation, abuse controls and email delivery.
// Pure functions + small in-memory stores so it can be unit-tested without a server.
// Files in /api prefixed with "_" are helpers, not deployed as endpoints.

const DEFAULT_TO = 'afradigital.hello@gmail.com';
const DEFAULT_FROM = 'AFRA DIGITAL Website <onboarding@resend.dev>';
const DEFAULT_API_URL = 'https://api.resend.com/emails';

// Must match the <option> values in the contact form.
const SERVICES = Object.freeze([
  'AI Solutions',
  'Business Automation',
  'Website Development',
  'Web Applications',
  'Custom Software',
  'SaaS Development',
  'Mobile App Development',
  'UI/UX Design',
  'Branding',
  'E-Commerce Development',
  'Digital Marketing',
  'Digital Transformation',
  'Cook With Fire (Restaurant Platform)',
  'SAANIX (Business Platform)',
  'Other / Not Sure',
]);

const LIMITS = Object.freeze({ firstName: 80, lastName: 80, email: 254, phone: 30, company: 120, message: 5000 });
const MAX_BODY_BYTES = 20 * 1024;
const MIN_FILL_MS = 2500;

const CONTROL_SINGLE = new RegExp("[\u0000-\u001F\u007F-\u009F\u2028\u2029]", "g"); // includes CR/LF/TAB and Unicode line separators
const CONTROL_MULTI = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g; // keeps \n and \t
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;
const PHONE_RE = /^\+?[0-9 ().-]{6,30}$/;

/** Normalise a submitted value. Returns '' for missing, null for non-string (invalid). */
function cleanText(value, { multiline = false } = {}) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') return null;
  let v = value.normalize('NFC');
  if (multiline) v = v.replace(/\r\n?/g, '\n').replace(CONTROL_MULTI, '');
  else v = v.replace(CONTROL_SINGLE, ' ').replace(/\s+/g, ' ');
  return v.trim();
}

/**
 * Validate and sanitise a raw submission.
 * @returns {{ ok: true, data: object } | { ok: false, fields: Record<string,string> }}
 * Field error codes: required | too_long | invalid
 */
function validateSubmission(raw) {
  const fields = {};
  const src = raw && typeof raw === 'object' ? raw : {};
  const data = {
    firstName: cleanText(src.firstName),
    lastName: cleanText(src.lastName),
    email: cleanText(src.email),
    phone: cleanText(src.phone),
    company: cleanText(src.company),
    service: cleanText(src.service),
    message: cleanText(src.message, { multiline: true }),
  };
  for (const [k, v] of Object.entries(data)) if (v === null) { fields[k] = 'invalid'; data[k] = ''; }

  for (const k of ['firstName', 'lastName']) {
    if (fields[k]) continue;
    if (!data[k]) fields[k] = 'required';
    else if (data[k].length > LIMITS[k]) fields[k] = 'too_long';
    else if (!/\p{L}/u.test(data[k])) fields[k] = 'invalid';
  }
  if (!fields.email) {
    if (!data.email) fields.email = 'required';
    else if (data.email.length > LIMITS.email) fields.email = 'too_long';
    else if (!EMAIL_RE.test(data.email) || data.email.split('@')[0].length > 64) fields.email = 'invalid';
    else data.email = data.email.toLowerCase();
  }
  if (!fields.phone && data.phone) {
    const digits = data.phone.replace(/\D/g, '').length;
    if (data.phone.length > LIMITS.phone) fields.phone = 'too_long';
    else if (!PHONE_RE.test(data.phone) || digits < 6 || digits > 15) fields.phone = 'invalid';
  }
  if (!fields.company && data.company.length > LIMITS.company) fields.company = 'too_long';
  if (!fields.service && data.service && !SERVICES.includes(data.service)) fields.service = 'invalid';
  if (!fields.message && data.message.length > LIMITS.message) fields.message = 'too_long';

  return Object.keys(fields).length ? { ok: false, fields } : { ok: true, data };
}

/** Bot heuristics. Returns null if OK, otherwise a reason code. */
function checkBotSignals(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  if (typeof src.hp === 'string' && src.hp.trim() !== '') return 'rejected';
  if (src.hp !== undefined && typeof src.hp !== 'string') return 'rejected';
  // `elapsed` is filled by the page script (ms since the form was shown). Missing = no-JS submission.
  if (src.elapsed !== undefined && src.elapsed !== '') {
    const n = Number(src.elapsed);
    if (!Number.isFinite(n) || n < MIN_FILL_MS) return 'too_fast';
  }
  return null;
}

/** Sliding-window rate limiter (per serverless instance — best effort, see report). */
function createRateLimiter({ limit, windowMs, now = () => Date.now() }) {
  const hits = new Map();
  return {
    check(key) {
      const t = now();
      const arr = (hits.get(key) || []).filter(x => t - x < windowMs);
      if (arr.length >= limit) {
        hits.set(key, arr);
        return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((windowMs - (t - arr[0])) / 1000)) };
      }
      arr.push(t); hits.set(key, arr);
      if (hits.size > 5000) for (const [k, v] of hits) if (!v.length || t - v[v.length - 1] > windowMs) hits.delete(k);
      return { allowed: true, retryAfterSec: 0 };
    },
  };
}

/** Remembers recently delivered submissions so a double-submit doesn't send twice. */
function createDuplicateGuard({ windowMs, now = () => Date.now() }) {
  const seen = new Map();
  const key = d => [d.email, d.firstName, d.lastName, d.service, d.message].join('\u0001');
  return {
    isDuplicate(d) { const t = seen.get(key(d)); return t !== undefined && now() - t < windowMs; },
    remember(d) {
      const t = now(); seen.set(key(d), t);
      if (seen.size > 2000) for (const [k, v] of seen) if (t - v > windowMs) seen.delete(k);
    },
  };
}

function singleLine(s, max) {
  const v = String(s).replace(CONTROL_SINGLE, ' ').replace(/\s+/g, ' ').trim();
  return v.length > max ? v.slice(0, max - 1) + '…' : v;
}

/** Build a plain-text email (no HTML => no HTML injection in the inbox). */
function composeEmail(data, { submittedAt = new Date() } = {}) {
  const name = `${data.firstName} ${data.lastName}`.trim();
  const subject = singleLine(`Website enquiry: ${data.service || 'General'} — ${name}`, 150);
  const lines = [
    'New enquiry from the AFRA DIGITAL website contact form.',
    '',
    `Name:     ${name}`,
    `Email:    ${data.email}`,
    `Phone:    ${data.phone || '—'}`,
    `Company:  ${data.company || '—'}`,
    `Service:  ${data.service || '—'}`,
    '',
    'Project brief:',
    data.message || '—',
    '',
    '---',
    `Submitted: ${submittedAt.toISOString()} (UTC)`,
    'Reply to this email to respond directly to the enquirer.',
  ];
  return { subject, text: lines.join('\n') };
}

class DeliveryError extends Error {
  constructor(kind, status) { super(`delivery ${kind}`); this.kind = kind; this.status = status; }
}

/** Read provider configuration from the environment. Never returns secret values to callers outside the server. */
function getConfig(env = process.env) {
  const apiKey = (env.RESEND_API_KEY || '').trim();
  return {
    configured: apiKey.length > 0,
    apiKey,
    apiUrl: (env.RESEND_API_URL || DEFAULT_API_URL).trim(),
    to: (env.CONTACT_TO_EMAIL || DEFAULT_TO).trim(),
    from: (env.CONTACT_FROM_EMAIL || DEFAULT_FROM).trim(),
    allowedOrigins: (env.CONTACT_ALLOWED_ORIGINS || 'https://www.afra-digital.com,https://afra-digital.com')
      .split(',').map(s => s.trim()).filter(Boolean),
  };
}

/** Send via the Resend HTTP API. Throws DeliveryError('timeout'|'rejected'|'failed'). */
async function deliver(config, data, { fetchImpl = fetch, timeoutMs = 8000, submittedAt } = {}) {
  const { subject, text } = composeEmail(data, { submittedAt });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetchImpl(config.apiUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: config.from, to: [config.to], reply_to: data.email, subject, text }),
      signal: controller.signal,
    });
  } catch (err) {
    throw new DeliveryError(err && err.name === 'AbortError' ? 'timeout' : 'failed');
  } finally {
    clearTimeout(timer);
  }
  if (res.status >= 200 && res.status < 300) {
    let id = null;
    try { id = (await res.json()).id || null; } catch { /* body not needed */ }
    return { id };
  }
  throw new DeliveryError(res.status >= 400 && res.status < 500 ? 'rejected' : 'failed', res.status);
}

/** Same-origin or allow-listed Origin. Requests without Origin (e.g. no-JS form posts in some browsers) are allowed. */
function isOriginAllowed(origin, host, allowedOrigins) {
  if (!origin) return true;
  if (origin === 'null') return false;
  if (allowedOrigins.includes(origin)) return true;
  try { return host && new URL(origin).host === host; } catch { return false; }
}

module.exports = {
  SERVICES, LIMITS, MAX_BODY_BYTES, MIN_FILL_MS,
  cleanText, validateSubmission, checkBotSignals, createRateLimiter, createDuplicateGuard,
  composeEmail, deliver, DeliveryError, getConfig, isOriginAllowed,
};
