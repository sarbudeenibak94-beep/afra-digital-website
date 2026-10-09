// Unit + handler tests for the contact form backend. No network: provider calls are stubbed.
// Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const core = require('../api/_lib/contact-core.js');
const handler = require('../api/contact.js');

const VALID = Object.freeze({
  firstName: 'Test', lastName: 'Enquiry', email: 'TEST.enquiry@example.org', phone: '+974 0000 0000',
  company: 'Automated Test (not a real lead)', service: 'Website Development',
  message: 'AUTOMATED TEST — please ignore.\nSecond line.', hp: '', elapsed: 9000,
});

let ipCounter = 0;
const freshIp = () => `203.0.113.${++ipCounter % 250}.${ipCounter}`; // documentation range, unique per test

function mockReq({ method = 'POST', body = VALID, headers = {}, raw, preParsed } = {}) {
  const payload = raw !== undefined ? raw : JSON.stringify(body);
  const req = Readable.from([Buffer.from(payload)]);
  req.method = method;
  req.headers = { 'content-type': 'application/json', host: 'www.afra-digital.com', origin: 'https://www.afra-digital.com', 'x-real-ip': freshIp(), ...headers };
  if (preParsed !== undefined) req.body = preParsed;
  return req;
}
function mockRes() {
  return {
    statusCode: 200, headers: {}, body: '',
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(b) { this.body = b || ''; this.ended = true; },
    get json() { return JSON.parse(this.body); },
  };
}
const ENV = { RESEND_API_KEY: 'test_key_not_real', RESEND_API_URL: 'https://mock.invalid/emails' };
function okFetch(calls) {
  return async (url, init) => { calls.push({ url, init, body: JSON.parse(init.body) }); return { status: 200, json: async () => ({ id: 'x' }) }; };
}
async function run(reqOpts, deps) { const res = mockRes(); await handler(mockReq(reqOpts), res, deps); return res; }

// ---------- validation ----------
test('valid submission passes and is normalised', () => {
  const r = core.validateSubmission(VALID);
  assert.equal(r.ok, true);
  assert.equal(r.data.email, 'test.enquiry@example.org');
});

test('missing required fields are reported', () => {
  const r = core.validateSubmission({});
  assert.equal(r.ok, false);
  assert.deepEqual(r.fields, { firstName: 'required', lastName: 'required', email: 'required' });
});

test('invalid emails are rejected', () => {
  for (const email of ['plainaddress', 'a@b', 'a@b.c', 'a b@x.com', 'x@y.com\r\nBcc: victim@evil.test', '<a@b.com>', 'a@b.com,c@d.com']) {
    const r = core.validateSubmission({ ...VALID, email });
    assert.equal(r.ok, false, email);
    assert.ok(r.fields.email, email);
  }
});

test('length limits are enforced', () => {
  const r = core.validateSubmission({ ...VALID, firstName: 'a'.repeat(81), message: 'm'.repeat(5001), company: 'c'.repeat(121) });
  assert.equal(r.fields.firstName, 'too_long');
  assert.equal(r.fields.message, 'too_long');
  assert.equal(r.fields.company, 'too_long');
});

test('phone is optional but validated when present', () => {
  assert.equal(core.validateSubmission({ ...VALID, phone: '' }).ok, true);
  assert.equal(core.validateSubmission({ ...VALID, phone: 'call me maybe' }).fields.phone, 'invalid');
  assert.equal(core.validateSubmission({ ...VALID, phone: '12' }).fields.phone, 'invalid');
});

test('service must be one of the offered options', () => {
  assert.equal(core.validateSubmission({ ...VALID, service: 'Hacking' }).fields.service, 'invalid');
  assert.equal(core.validateSubmission({ ...VALID, service: '' }).ok, true);
});

test('non-string values are rejected', () => {
  const r = core.validateSubmission({ ...VALID, firstName: { $gt: '' }, message: ['x'] });
  assert.equal(r.fields.firstName, 'invalid');
  assert.equal(r.fields.message, 'invalid');
});

test('names must contain a letter', () => {
  assert.equal(core.validateSubmission({ ...VALID, firstName: '12345' }).fields.firstName, 'invalid');
  assert.equal(core.validateSubmission({ ...VALID, firstName: 'محمد' }).ok, true); // Arabic names allowed
});

// ---------- injection safety ----------
test('header/email injection: CR/LF stripped from single-line fields and subject', () => {
  const r = core.validateSubmission({ ...VALID, firstName: 'Evil\r\nBcc: x@y.com', company: 'Co\nX-Header: 1' });
  assert.equal(r.ok, true);
  assert.ok(!/[\r\n]/.test(r.data.firstName));
  assert.ok(!/[\r\n]/.test(r.data.company));
  const { subject } = core.composeEmail(r.data);
  assert.ok(!/[\r\n]/.test(subject));
});

test('email body is plain text (HTML is not rendered)', async () => {
  const calls = [];
  const res = await run({ body: { ...VALID, message: '<script>alert(1)</script><img src=x onerror=alert(1)>' } }, { env: ENV, fetch: okFetch(calls) });
  assert.equal(res.statusCode, 200);
  assert.equal(calls[0].body.html, undefined);
  assert.ok(calls[0].body.text.includes('<script>'));       // delivered as inert text
  assert.equal(calls[0].body.reply_to, 'test.enquiry@example.org');
});

// ---------- bot / abuse controls ----------
test('honeypot filled -> rejected, nothing sent', async () => {
  const calls = [];
  const res = await run({ body: { ...VALID, hp: 'http://spam.test' } }, { env: ENV, fetch: okFetch(calls) });
  assert.equal(res.statusCode, 400); assert.equal(res.json.error, 'rejected'); assert.equal(calls.length, 0);
});

test('submitted too fast -> rejected, nothing sent', async () => {
  const calls = [];
  const res = await run({ body: { ...VALID, elapsed: 300 } }, { env: ENV, fetch: okFetch(calls) });
  assert.equal(res.statusCode, 400); assert.equal(res.json.error, 'too_fast'); assert.equal(calls.length, 0);
});

test('rate limiting: 6th valid submission from one IP within window -> 429', async () => {
  const calls = []; const ip = '198.51.100.77';
  let last;
  for (let i = 0; i < 6; i++) {
    last = await run({ body: { ...VALID, message: 'rate test ' + i }, headers: { 'x-real-ip': ip } }, { env: ENV, fetch: okFetch(calls) });
  }
  assert.equal(calls.length, 5);
  assert.equal(last.statusCode, 429);
  assert.ok(Number(last.headers['retry-after']) > 0);
});

test('rate limiter unit behaviour', () => {
  let t = 0; const rl = core.createRateLimiter({ limit: 2, windowMs: 1000, now: () => t });
  assert.equal(rl.check('a').allowed, true); assert.equal(rl.check('a').allowed, true);
  assert.equal(rl.check('a').allowed, false);
  t = 1001; assert.equal(rl.check('a').allowed, true);
});

test('duplicate submission is delivered only once', async () => {
  const calls = []; const body = { ...VALID, message: 'duplicate check ' + Date.now() };
  const a = await run({ body }, { env: ENV, fetch: okFetch(calls) });
  const b = await run({ body }, { env: ENV, fetch: okFetch(calls) });
  assert.equal(a.statusCode, 200); assert.equal(b.statusCode, 200);
  assert.equal(b.json.duplicate, true);
  assert.equal(calls.length, 1);
});

// ---------- request handling ----------
test('GET -> 405', async () => {
  const res = await run({ method: 'GET' }, { env: ENV });
  assert.equal(res.statusCode, 405); assert.equal(res.headers.allow, 'POST');
});

test('foreign origin -> 403', async () => {
  const res = await run({ headers: { origin: 'https://evil.example' } }, { env: ENV, fetch: okFetch([]) });
  assert.equal(res.statusCode, 403);
});

test('same-origin preview deployment host is allowed', async () => {
  const res = await run({ headers: { origin: 'https://afra-preview-abc.vercel.app', host: 'afra-preview-abc.vercel.app' }, body: { ...VALID, message: 'preview ' + Date.now() } }, { env: ENV, fetch: okFetch([]) });
  assert.equal(res.statusCode, 200);
});

test('unsupported content type -> 415', async () => {
  const res = await run({ headers: { 'content-type': 'text/plain' } }, { env: ENV });
  assert.equal(res.statusCode, 415);
});

test('malformed JSON -> 400 bad_request', async () => {
  const res = await run({ raw: '{not json' }, { env: ENV });
  assert.equal(res.statusCode, 400); assert.equal(res.json.error, 'bad_request');
});

test('oversized body -> 413', async () => {
  const res = await run({ raw: JSON.stringify({ ...VALID, message: 'x'.repeat(30000) }) }, { env: ENV });
  assert.equal(res.statusCode, 413);
});

test('pre-parsed body (Vercel helpers) is accepted', async () => {
  const res = mockRes();
  await handler(mockReq({ preParsed: { ...VALID, message: 'preparsed ' + Date.now() } }), res, { env: ENV, fetch: okFetch([]) });
  assert.equal(res.statusCode, 200);
});

test('validation errors return field codes and never echo input', async () => {
  const res = await run({ body: { ...VALID, email: 'nope<script>' } }, { env: ENV });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json.fields.email, 'invalid');
  assert.ok(!res.body.includes('<script>'));
});

// ---------- delivery outcomes (never a false success) ----------
test('missing provider config -> 503 not_configured, no false success', async () => {
  const res = await run({ body: { ...VALID, message: 'noconfig ' + Date.now() } }, { env: {}, fetch: okFetch([]) });
  assert.equal(res.statusCode, 503); assert.equal(res.json.ok, false); assert.equal(res.json.error, 'not_configured');
});

test('provider 5xx -> 502 delivery_failed', async () => {
  const res = await run({ body: { ...VALID, message: 'fail ' + Date.now() } }, { env: ENV, fetch: async () => ({ status: 500, json: async () => ({}) }) });
  assert.equal(res.statusCode, 502); assert.equal(res.json.ok, false);
});

test('provider 4xx (e.g. unverified sender) -> 502 delivery_failed', async () => {
  const res = await run({ body: { ...VALID, message: 'reject ' + Date.now() } }, { env: ENV, fetch: async () => ({ status: 403, json: async () => ({}) }) });
  assert.equal(res.statusCode, 502); assert.equal(res.json.error, 'delivery_failed');
});

test('provider network error -> 502', async () => {
  const res = await run({ body: { ...VALID, message: 'neterr ' + Date.now() } }, { env: ENV, fetch: async () => { throw new TypeError('fetch failed'); } });
  assert.equal(res.statusCode, 502);
});

test('provider timeout -> 504 timeout', async () => {
  const slow = (url, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  const res = await run({ body: { ...VALID, message: 'timeout ' + Date.now() } }, { env: ENV, fetch: slow, timeoutMs: 50 });
  assert.equal(res.statusCode, 504); assert.equal(res.json.error, 'timeout');
});

test('failed delivery is not remembered as duplicate (retry can succeed)', async () => {
  const body = { ...VALID, message: 'retry ' + Date.now() }; const ip = '198.51.100.200';
  const a = await run({ body, headers: { 'x-real-ip': ip } }, { env: ENV, fetch: async () => ({ status: 500, json: async () => ({}) }) });
  const calls = [];
  const b = await run({ body, headers: { 'x-real-ip': ip } }, { env: ENV, fetch: okFetch(calls) });
  assert.equal(a.statusCode, 502); assert.equal(b.statusCode, 200); assert.equal(calls.length, 1); assert.notEqual(b.json.duplicate, true);
});

test('provider request: secret only in Authorization header, configured recipient, default sender', async () => {
  const calls = [];
  await run({ body: { ...VALID, message: 'shape ' + Date.now() } }, { env: ENV, fetch: okFetch(calls) });
  const c = calls[0];
  assert.equal(c.url, 'https://mock.invalid/emails');
  assert.equal(c.init.headers.Authorization, 'Bearer test_key_not_real');
  assert.deepEqual(c.body.to, ['afradigital.hello@gmail.com']);
  assert.ok(!JSON.stringify(c.body).includes('test_key_not_real'));
  assert.ok(!c.body.text.includes('203.0.113'), 'IP address must not be included in the email');
});

test('no-JS form post (urlencoded) works and returns HTML', async () => {
  const params = new URLSearchParams({ firstName: 'Test', lastName: 'NoJS', email: 'nojs@example.org', message: 'nojs ' + Date.now(), hp: '' });
  const res = await run({ raw: params.toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' } }, { env: ENV, fetch: okFetch([]) });
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.match(res.body, /Message sent/);
});

test('no-JS failure page escapes content and offers alternatives', async () => {
  const params = new URLSearchParams({ firstName: 'Test', lastName: 'NoJS', email: 'bad', hp: '' });
  const res = await run({ raw: params.toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' } }, { env: ENV });
  assert.equal(res.statusCode, 400);
  assert.match(res.body, /Message not sent/);
  assert.match(res.body, /wa\.me\/97430029799/);
});

test('responses are never cached', async () => {
  const res = await run({ body: { ...VALID, message: 'cache ' + Date.now() } }, { env: ENV, fetch: okFetch([]) });
  assert.equal(res.headers['cache-control'], 'no-store');
});

// ======================================================================
// Resend delivery fix (sender domain, 403 classification, retries, leakage)
// ======================================================================
const SECRET = 're_TESTSECRET_should_never_appear_123456';
const ENV2 = { RESEND_API_KEY: SECRET, RESEND_API_URL: 'https://mock.invalid/emails', VERCEL_ENV: 'preview' };
const respond = (status, body) => ({ status, json: async () => body });

/** Run the handler while capturing console.error output. */
async function runLogged(reqOpts, deps) {
  const logs = []; const orig = console.error;
  console.error = (...a) => logs.push(a.join(' '));
  try { const res = mockRes(); await handler(mockReq(reqOpts), res, deps); return { res, logs: logs.join('\n') }; }
  finally { console.error = orig; }
}
const uniq = label => ({ ...VALID, message: `${label} ${Date.now()} ${Math.random()}` });
function assertNoLeak(res, logs) {
  for (const s of [SECRET, 'test.enquiry@example.org', 'TEST.enquiry', 'Enquiry', 'AUTOMATED TEST']) {
    assert.ok(!logs.includes(s), `log leaked: ${s}`);
    assert.ok(!res.body.includes(s), `response leaked: ${s}`);
  }
}

test('default sender is on the verified domain (never resend.dev); recipient fixed; visitor is reply_to', async () => {
  const calls = [];
  const { res } = await runLogged({ body: { ...uniq('sender'), to: 'attacker@evil.test', from: 'x@evil.test', reply_to: 'y@evil.test' } }, { env: ENV2, fetch: okFetch(calls) });
  assert.equal(res.statusCode, 200);
  const b = calls[0].body;
  assert.equal(b.from, 'AFRA DIGITAL Website <website@afra-digital.com>');
  assert.deepEqual(b.to, ['afradigital.hello@gmail.com']);
  assert.equal(b.reply_to, 'test.enquiry@example.org');
  assert.ok(!JSON.stringify(b).includes('evil.test'), 'visitor must not control from/to');
  assert.ok(!/resend\.dev/.test(b.from));
});

test('CONTACT_FROM_EMAIL override on the verified domain is used', async () => {
  const calls = [];
  await runLogged({ body: uniq('override') }, { env: { ...ENV2, CONTACT_FROM_EMAIL: 'AFRA DIGITAL Website <enquiries@afra-digital.com>' }, fetch: okFetch(calls) });
  assert.equal(calls[0].body.from, 'AFRA DIGITAL Website <enquiries@afra-digital.com>');
});

test('missing RESEND_API_KEY -> 503, diagnostic log, provider never called', async () => {
  const calls = [];
  const { res, logs } = await runLogged({ body: uniq('nokey') }, { env: { RESEND_API_URL: 'x', VERCEL_ENV: 'preview' }, fetch: okFetch(calls) });
  assert.equal(res.statusCode, 503); assert.equal(res.json.error, 'not_configured'); assert.equal(calls.length, 0);
  assert.match(logs, /not configured: missing_api_key/); assert.match(logs, /env=preview/);
});

test('whitespace-only RESEND_API_KEY is treated as missing', async () => {
  const { res, logs } = await runLogged({ body: uniq('blank') }, { env: { RESEND_API_KEY: '   ' }, fetch: okFetch([]) });
  assert.equal(res.statusCode, 503); assert.match(logs, /missing_api_key/);
});

test('resend.dev sender is refused before calling the provider', async () => {
  const calls = [];
  const { res, logs } = await runLogged({ body: uniq('testsender') }, { env: { ...ENV2, CONTACT_FROM_EMAIL: 'AFRA <onboarding@resend.dev>' }, fetch: okFetch(calls) });
  assert.equal(res.statusCode, 503); assert.equal(calls.length, 0); assert.match(logs, /test_sender_not_allowed/);
});

test('sender outside the verified domain is refused', async () => {
  const calls = [];
  const { res, logs } = await runLogged({ body: uniq('mismatch') }, { env: { ...ENV2, CONTACT_FROM_EMAIL: 'AFRA <afradigital.hello@gmail.com>' }, fetch: okFetch(calls) });
  assert.equal(res.statusCode, 503); assert.equal(calls.length, 0); assert.match(logs, /sender_domain_mismatch/);
});

test('malformed / header-injecting sender config is refused', async () => {
  for (const from of ['not an address', 'AFRA <website@afra-digital.com>\r\nBcc: x@y.com']) {
    const { res, logs } = await runLogged({ body: uniq('badfrom') }, { env: { ...ENV2, CONTACT_FROM_EMAIL: from }, fetch: okFetch([]) });
    assert.equal(res.statusCode, 503); assert.match(logs, /invalid_from/);
  }
});

test('invalid recipient config is refused', async () => {
  const { res, logs } = await runLogged({ body: uniq('badto') }, { env: { ...ENV2, CONTACT_TO_EMAIL: 'a@b.com, c@d.com' }, fetch: okFetch([]) });
  assert.equal(res.statusCode, 503); assert.match(logs, /invalid_to/);
});

test('Resend 403 test-sender restriction -> 502, classified, NOT retried, emails stripped from log', async () => {
  let n = 0;
  const f = async () => { n++; return respond(403, { statusCode: 403, name: 'validation_error', message: 'The resend.dev domain is for testing and can only send to your own email address (owner@private.test). To send to other recipients, verify a domain and update the from address to use it.' }); };
  const { res, logs } = await runLogged({ body: uniq('403test') }, { env: ENV2, fetch: f });
  assert.equal(res.statusCode, 502); assert.equal(res.json.error, 'delivery_failed'); assert.equal(n, 1);
  assert.match(logs, /kind=test_sender_restriction status=403/);
  assert.ok(!logs.includes('owner@private.test')); assert.match(logs, /\[email\]/);
  assertNoLeak(res, logs);
});

test('Resend 403 domain not verified -> sender_unverified, not retried', async () => {
  let n = 0;
  const f = async () => { n++; return respond(403, { statusCode: 403, name: 'validation_error', message: 'The afra-digital.com domain is not verified. Please, add and verify your domain on https://resend.com/domains' }); };
  const { res, logs } = await runLogged({ body: uniq('403dom') }, { env: ENV2, fetch: f });
  assert.equal(res.statusCode, 502); assert.equal(n, 1); assert.match(logs, /kind=sender_unverified/);
});

test('invalid / missing / restricted API key -> kind=auth, key never logged', async () => {
  for (const [status, body] of [
    [403, { statusCode: 403, name: 'invalid_api_key', message: 'API key is invalid' }],
    [401, { statusCode: 401, name: 'missing_api_key', message: 'Missing API key in the authorization header.' }],
    [401, { statusCode: 401, name: 'restricted_api_key', message: 'This API key is restricted to only send emails.' }],
  ]) {
    let n = 0;
    const { res, logs } = await runLogged({ body: uniq('auth' + status) }, { env: ENV2, fetch: async () => { n++; return respond(status, body); } });
    assert.equal(res.statusCode, 502); assert.equal(n, 1); assert.match(logs, /kind=auth/);
    assertNoLeak(res, logs);
  }
});

test('Resend 422 validation -> kind=validation, not retried', async () => {
  let n = 0;
  const { logs } = await runLogged({ body: uniq('422') }, { env: ENV2, fetch: async () => { n++; return respond(422, { name: 'validation_error', message: 'Invalid `subject` field.' }); } });
  assert.equal(n, 1); assert.match(logs, /kind=validation status=422/);
});

test('Resend 429 -> provider_rate_limited, not retried', async () => {
  let n = 0;
  const { res, logs } = await runLogged({ body: uniq('429') }, { env: ENV2, fetch: async () => { n++; return respond(429, { name: 'rate_limit_exceeded', message: 'Too many requests' }); } });
  assert.equal(res.statusCode, 502); assert.equal(n, 1); assert.match(logs, /kind=provider_rate_limited/);
});

test('Resend 5xx once then success -> retried once with the same Idempotency-Key -> 200', async () => {
  const keys = []; let n = 0;
  const f = async (url, init) => { n++; keys.push(init.headers['Idempotency-Key']); return n === 1 ? respond(503, { message: 'unavailable' }) : respond(200, { id: 'ok' }); };
  const { res } = await runLogged({ body: uniq('5xxretry') }, { env: ENV2, fetch: f, retryDelayMs: 5 });
  assert.equal(res.statusCode, 200); assert.equal(n, 2); assert.equal(keys[0], keys[1]); assert.match(keys[0], /^afra-contact-[0-9a-f]{40}$/);
});

test('persistent 5xx -> 2 attempts total, then 502 provider_unavailable', async () => {
  let n = 0;
  const { res, logs } = await runLogged({ body: uniq('5xx') }, { env: ENV2, fetch: async () => { n++; return respond(500, {}); }, retryDelayMs: 5 });
  assert.equal(res.statusCode, 502); assert.equal(n, 2); assert.match(logs, /kind=provider_unavailable/);
});

test('network failure -> retried once, then 502 kind=network', async () => {
  let n = 0;
  const { res, logs } = await runLogged({ body: uniq('net') }, { env: ENV2, fetch: async () => { n++; throw new TypeError('fetch failed'); }, retryDelayMs: 5 });
  assert.equal(res.statusCode, 502); assert.equal(n, 2); assert.match(logs, /kind=network/);
});

test('timeout -> 504, not retried (delivery state unknown)', async () => {
  let n = 0;
  const slow = (url, init) => { n++; return new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))); };
  const { res, logs } = await runLogged({ body: uniq('to') }, { env: ENV2, fetch: slow, timeoutMs: 30 });
  assert.equal(res.statusCode, 504); assert.equal(n, 1); assert.match(logs, /kind=timeout/);
});

test('client-facing errors are generic: no provider message, status or kind exposed', async () => {
  const f = async () => respond(403, { name: 'validation_error', message: 'The resend.dev domain is for testing (owner@private.test)' });
  const { res } = await runLogged({ body: uniq('generic') }, { env: ENV2, fetch: f });
  assert.deepEqual(Object.keys(res.json).sort(), ['error', 'message', 'ok']);
  assert.ok(!/resend|403|test_sender|owner@/i.test(res.body));
});

test('successful delivery logs nothing and leaks nothing', async () => {
  const { res, logs } = await runLogged({ body: uniq('quiet') }, { env: ENV2, fetch: okFetch([]) });
  assert.equal(res.statusCode, 200); assert.equal(logs, ''); assertNoLeak(res, logs);
});

test('classifyProviderError mapping', () => {
  const c = core.classifyProviderError;
  assert.equal(c(401, { name: 'missing_api_key' }), 'auth');
  assert.equal(c(403, { name: 'invalid_api_key' }), 'auth');
  assert.equal(c(403, { name: 'validation_error', message: 'You can only send testing emails to your own email address' }), 'test_sender_restriction');
  assert.equal(c(403, { message: 'The x.com domain is not verified.' }), 'sender_unverified');
  assert.equal(c(422, { name: 'invalid_from_address' }), 'sender_unverified');
  assert.equal(c(429, {}), 'provider_rate_limited');
  assert.equal(c(502, null), 'provider_unavailable');
  assert.equal(c(400, { name: 'validation_error', message: 'bad' }), 'validation');
  assert.equal(c(404, {}), 'rejected');
});

test('idempotency key is stable per submission and differs between submissions', () => {
  const a = core.idempotencyKey(VALID), b = core.idempotencyKey({ ...VALID }), d = core.idempotencyKey({ ...VALID, message: 'other' });
  assert.equal(a, b); assert.notEqual(a, d);
});

// ======================================================================
// Phase 04 Batch 1: qualification fields, plan, source, reference ID
// ======================================================================
const QUAL = Object.freeze({ budget: 'QAR 10,000–25,000', timeline: 'Within 1–3 months', contactPref: 'Email', plan: 'Business', source: 'pricing_business' });
const ENV4 = { RESEND_API_KEY: 'test_key_not_real', RESEND_API_URL: 'https://mock.invalid/emails' };
const uniq4 = (label, extra = {}) => ({ ...VALID, ...extra, message: `${label} ${Date.now()} ${Math.random()}` });

test('P4 all confirmed qualification options are accepted', () => {
  for (const budget of core.BUDGETS) assert.equal(core.validateSubmission({ ...VALID, budget }).ok, true, budget);
  for (const timeline of core.TIMELINES) assert.equal(core.validateSubmission({ ...VALID, timeline }).ok, true, timeline);
  for (const contactPref of ['Email']) assert.equal(core.validateSubmission({ ...VALID, contactPref }).ok, true);
  for (const plan of core.PLANS) assert.equal(core.validateSubmission({ ...VALID, plan }).ok, true, plan);
  assert.deepEqual([...core.BUDGETS], ['Under QAR 10,000', 'QAR 10,000–25,000', 'QAR 25,000–50,000', 'Over QAR 50,000', 'Not sure yet']);
  assert.deepEqual([...core.TIMELINES], ['As soon as possible', 'Within 1–3 months', 'Within 3–6 months', 'Just exploring']);
  assert.deepEqual([...core.CONTACT_PREFS], ['Email', 'WhatsApp', 'Phone']);
});

test('P4 qualification fields are optional', () => {
  const r = core.validateSubmission({ ...VALID });
  assert.equal(r.ok, true);
  assert.equal(r.data.budget, ''); assert.equal(r.data.timeline, ''); assert.equal(r.data.contactPref, ''); assert.equal(r.data.plan, ''); assert.equal(r.data.source, '');
});

test('P4 values outside the allow-lists are rejected with field codes', () => {
  const r = core.validateSubmission({ ...VALID, budget: 'One million', timeline: 'Yesterday', contactPref: 'Fax', plan: 'Gold' });
  assert.equal(r.ok, false);
  assert.deepEqual(r.fields, { budget: 'invalid', timeline: 'invalid', contactPref: 'invalid', plan: 'invalid' });
  assert.equal(core.validateSubmission({ ...VALID, budget: 'Under QAR 10,000\r\nBcc: x@y.com' }).fields.budget, 'invalid');
  assert.equal(core.validateSubmission({ ...VALID, plan: { $ne: 1 } }).fields.plan, 'invalid');
});

test('P4 WhatsApp/Phone preference requires a phone number; Email does not', () => {
  assert.equal(core.validateSubmission({ ...VALID, phone: '', contactPref: 'WhatsApp' }).fields.phone, 'required_for_contact');
  assert.equal(core.validateSubmission({ ...VALID, phone: '', contactPref: 'Phone' }).fields.phone, 'required_for_contact');
  assert.equal(core.validateSubmission({ ...VALID, phone: '+974 5555 1234', contactPref: 'WhatsApp' }).ok, true);
  assert.equal(core.validateSubmission({ ...VALID, phone: '', contactPref: 'Email' }).ok, true);
});

test('P4 source CTA: valid ids kept, anything else silently dropped (never an error)', () => {
  assert.equal(core.validateSubmission({ ...VALID, source: 'pricing_business' }).data.source, 'pricing_business');
  for (const bad of ['Pricing Business', '<script>', 'x'.repeat(41), 'a@b.com', 'quick-after', 123]) {
    const r = core.validateSubmission({ ...VALID, source: bad });
    assert.equal(r.ok, true, String(bad)); assert.equal(r.data.source, '', String(bad));
  }
});

test('P4 reference ids are random, well-formed and have no ambiguous characters', () => {
  const seen = new Set();
  for (let i = 0; i < 500; i++) { const r = core.makeReference(); assert.match(r, core.REFERENCE_RE); assert.ok(!/[01IO]/.test(r.slice(5))); seen.add(r); }
  assert.ok(seen.size > 495, 'references should not repeat in a small sample');
});

test('P4 email includes package, budget, timeline, preferred contact, source and reference', async () => {
  const calls = [];
  const res = await run({ body: uniq4('qual', QUAL) }, { env: ENV4, fetch: okFetch(calls) });
  assert.equal(res.statusCode, 200);
  const ref = res.json.reference;
  assert.match(ref, core.REFERENCE_RE);
  const b = calls[0].body;
  assert.ok(b.subject.startsWith(`Website enquiry [${ref}]: Website Development`), b.subject);
  for (const line of ['Package:  Business', 'Budget:   QAR 10,000–25,000', 'Timeline: Within 1–3 months', 'Preferred contact: Email', `Reference: ${ref}`, 'Source:    website button "pricing_business"']) {
    assert.ok(b.text.includes(line), 'missing line: ' + line);
  }
});

test('P4 email shows dashes for unanswered optional fields and "direct" source', async () => {
  const calls = [];
  await run({ body: uniq4('noqual') }, { env: ENV4, fetch: okFetch(calls) });
  const t = calls[0].body.text;
  for (const line of ['Package:  —', 'Budget:   —', 'Timeline: —', 'Preferred contact: —', 'Source:    direct']) assert.ok(t.includes(line), line);
});

test('P4 duplicate submission returns the original reference and sends one email', async () => {
  const calls = []; const body = uniq4('dupref', QUAL);
  const a = await run({ body }, { env: ENV4, fetch: okFetch(calls) });
  const b = await run({ body }, { env: ENV4, fetch: okFetch(calls) });
  assert.equal(calls.length, 1);
  assert.equal(b.json.duplicate, true);
  assert.equal(b.json.reference, a.json.reference);
});

test('P4 failed delivery returns no reference', async () => {
  const res = await run({ body: uniq4('noref') }, { env: ENV4, fetch: async () => ({ status: 500, json: async () => ({}) }), retryDelayMs: 1 });
  assert.equal(res.statusCode, 502); assert.equal(res.json.reference, undefined);
});

test('P4 invalid qualification value -> 400 and nothing sent', async () => {
  const calls = [];
  const res = await run({ body: uniq4('badqual', { budget: 'Free please' }) }, { env: ENV4, fetch: okFetch(calls) });
  assert.equal(res.statusCode, 400); assert.equal(res.json.fields.budget, 'invalid'); assert.equal(calls.length, 0);
});

test('P4 no-JS success page shows the reference', async () => {
  const params = new URLSearchParams({ firstName: 'Test', lastName: 'NoJS', email: 'nojs4@example.org', budget: 'Not sure yet', message: 'p4 nojs ' + Date.now(), hp: '' });
  const res = await run({ raw: params.toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' } }, { env: ENV4, fetch: okFetch([]) });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Your reference: <strong>AFRA-[2-9A-HJ-NP-Z]{6}<\/strong>/);
});

test('P4 composeEmail ignores a malformed reference', () => {
  const { subject, text } = core.composeEmail({ ...VALID, budget: '', timeline: '', contactPref: '', plan: '', source: '' }, { reference: 'AFRA-<x>\r\nBcc:' });
  assert.ok(!subject.includes('[')); assert.ok(!text.includes('Reference:'));
});

// Phase 05: service-page source ids ("lp_<page>_<position>") pass the existing allow-list and reach the email.
test('P5 service-page source ids are accepted and shown in the enquiry email', async () => {
  for (const id of ['lp_web_form', 'lp_web_hero', 'lp_web_nav', 'lp_web_mobile_menu', 'lp_web_pricing_starter', 'lp_web_final']) {
    assert.equal(core.validateSubmission({ ...VALID, source: id }).data.source, id, id);
  }
  const calls = [];
  const res = await run({ body: uniq4('p5lp', { plan: 'Starter', source: 'lp_web_pricing_starter' }) }, { env: ENV4, fetch: okFetch(calls) });
  assert.equal(res.statusCode, 200);
  const b = calls[0].body;
  assert.ok(b.text.includes('Source:    website button "lp_web_pricing_starter"'), b.text);
  assert.ok(b.text.includes('Package:  Starter'), b.text);
});
