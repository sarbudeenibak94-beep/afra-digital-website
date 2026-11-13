// Request body size limit tests for /api/contact (api/contact.js readBody). Own file = own process, so the
// per-instance send limits (60 per 10 min site-wide) are fresh and successful sends can be asserted exactly.
// No network: Resend and Cloudflare Siteverify are stubbed. Run: node --test tests/
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
  message: 'AUTOMATED TEST — please ignore.', hp: '', elapsed: 9000,
  'cf-turnstile-response': 'XXXX.DUMMY.TOKEN.XXXX', // Cloudflare's published dummy token (test keys)
});
let ipCounter = 0;
const freshIp = () => `198.18.0.${++ipCounter}`; // benchmarking range, unique per request
function mockReq({ method = 'POST', body = VALID, headers = {}, raw, preParsed } = {}) {
  const payload = raw !== undefined ? raw : JSON.stringify(body);
  const req = Readable.from([Buffer.from(payload)]);
  req.method = method;
  req.headers = { 'content-type': 'application/json', host: 'www.afra-digital.com', origin: 'https://www.afra-digital.com', 'x-real-ip': freshIp(), ...headers };
  if (preParsed !== undefined) req.body = preParsed;
  return req;
}
function mockRes() {
  return { statusCode: 200, headers: {}, body: '', setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { this.body = b || ''; }, get json() { return JSON.parse(this.body); } };
}
// Test values only — never real keys.
const ENV = { RESEND_API_KEY: 'test_key_not_real', RESEND_API_URL: 'https://mock.invalid/emails', TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA' };
const okFetch = calls => async (url, init) => { calls.push(JSON.parse(init.body)); return { status: 200, json: async () => ({ id: 'x' }) }; };
const tsFetch = calls => async () => { calls.push(1); return { status: 200, json: async () => ({ success: true, hostname: 'www.afra-digital.com', action: 'contact', 'error-codes': [] }) }; };
const withTs = deps => deps;
async function run(reqOpts, deps) { const res = mockRes(); await handler(mockReq(reqOpts), res, deps); return res; }

// =====================================================================================================================
// Request body size limit (api/contact.js readBody): at most core.MAX_BODY_BYTES (20,480) UTF-8 bytes; larger → 413.
// On Vercel the body usually arrives already parsed (req.body object) — `preParsed` simulates that.
// =====================================================================================================================
const MAX_BYTES = core.MAX_BODY_BYTES;
const bytesOf = o => Buffer.byteLength(JSON.stringify(o), 'utf8');
// A valid enquiry padded (in an unknown field, ignored by validation) to an exact UTF-8 byte size.
function sized(targetBytes, ch = 'x') {
  const base = { ...VALID, message: `size test ${Date.now()} ${Math.random()}`, pad: '' };
  const per = Buffer.byteLength(ch, 'utf8');
  return { ...base, pad: ch.repeat(Math.floor((targetBytes - bytesOf(base)) / per)) };
}
async function sizeRun(reqOpts) {
  const calls = [], ver = [];
  const res = await run(reqOpts, { env: ENV, fetch: okFetch(calls), turnstileFetch: tsFetch(ver) });
  return { res, calls, ver };
}
const assertTooLarge = r => { assert.equal(r.res.statusCode, 413, r.res.body); assert.equal(r.res.json.error, 'too_large'); assert.equal(r.calls.length, 0, 'no email'); assert.equal(r.ver.length, 0, 'no Siteverify call'); };

test('SIZE1 pre-parsed body well below 20 KB is accepted (verified, one email)', async () => {
  const body = sized(10 * 1024); assert.ok(bytesOf(body) < MAX_BYTES);
  const r = await sizeRun({ preParsed: body });
  assert.equal(r.res.statusCode, 200, r.res.body); assert.equal(r.calls.length, 1); assert.equal(r.ver.length, 1);
});

test('SIZE2 pre-parsed body of exactly 20,480 bytes is accepted (limit is inclusive)', async () => {
  const body = sized(MAX_BYTES); assert.equal(bytesOf(body), MAX_BYTES);
  const r = await sizeRun({ preParsed: body });
  assert.equal(r.res.statusCode, 200, r.res.body); assert.equal(r.calls.length, 1);
});

test('SIZE3 pre-parsed body of 20,481 bytes → 413, before Siteverify and email', async () => {
  const body = sized(MAX_BYTES + 1); assert.equal(bytesOf(body), MAX_BYTES + 1);
  assertTooLarge(await sizeRun({ preParsed: body }));
});

test('SIZE4 multibyte UTF-8 is measured in bytes, not characters', async () => {
  const over = sized(MAX_BYTES + 300, '€'); // 3 bytes per character
  assert.ok(JSON.stringify(over).length < MAX_BYTES, 'fewer than 20,480 characters');
  assert.ok(bytesOf(over) > MAX_BYTES, 'but more than 20,480 bytes');
  assertTooLarge(await sizeRun({ preParsed: over }));
  const under = sized(MAX_BYTES - 300, '€'); assert.ok(bytesOf(under) <= MAX_BYTES);
  const ok = await sizeRun({ preParsed: under });
  assert.equal(ok.res.statusCode, 200, ok.res.body);
  // the same in the streamed (unparsed) path
  assertTooLarge(await sizeRun({ raw: JSON.stringify(sized(MAX_BYTES + 300, '€')) }));
});

test('SIZE5 streamed (unparsed) body: exactly 20,480 bytes accepted, 20,481 → 413', async () => {
  const at = sized(MAX_BYTES), over = sized(MAX_BYTES + 1);
  const a = await sizeRun({ raw: JSON.stringify(at) });
  assert.equal(a.res.statusCode, 200, a.res.body);
  assertTooLarge(await sizeRun({ raw: JSON.stringify(over) }));
});

test('SIZE6 a declared Content-Length above the limit → 413 without reading the body; a normal declaration is fine', async () => {
  assertTooLarge(await sizeRun({ body: { ...VALID, message: 'declared ' + Date.now() }, headers: { 'content-length': String(MAX_BYTES + 1) } }));
  const okBody = { ...VALID, message: 'declared ok ' + Date.now() };
  const ok = await sizeRun({ body: okBody, headers: { 'content-length': String(bytesOf(okBody)) } });
  assert.equal(ok.res.statusCode, 200, ok.res.body);
});

test('SIZE7 malformed JSON → 400 bad_request (streamed body, and Vercel throwing while parsing req.body)', async () => {
  const a = await sizeRun({ raw: '{"firstName": "Test", oops' });
  assert.equal(a.res.statusCode, 400); assert.equal(a.res.json.error, 'bad_request'); assert.equal(a.calls.length, 0); assert.equal(a.ver.length, 0);
  const calls = [], ver = []; const res = mockRes(); const req = mockReq({});
  Object.defineProperty(req, 'body', { get() { throw new SyntaxError('Invalid JSON'); } });
  await handler(req, res, withTs({ env: ENV, fetch: okFetch(calls), turnstileFetch: tsFetch(ver) }));
  assert.equal(res.statusCode, 400); assert.equal(res.json.error, 'bad_request'); assert.equal(calls.length, 0); assert.equal(ver.length, 0);
});

test('SIZE8 oversized pre-parsed no-JS form post → 413 HTML page, nothing sent', async () => {
  const form = { firstName: 'Test', lastName: 'NoJS', email: 'nojs-size@example.org', message: 'n', hp: '', pad: 'x'.repeat(MAX_BYTES) };
  const r = await sizeRun({ preParsed: form, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal(r.res.statusCode, 413); assert.match(r.res.headers['content-type'], /text\/html/); assert.match(r.res.body, /Message not sent/);
  assert.equal(r.calls.length, 0); assert.equal(r.ver.length, 0);
});
