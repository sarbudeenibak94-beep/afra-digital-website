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
