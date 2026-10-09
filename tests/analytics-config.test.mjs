// Unit tests for GET /api/analytics-config (no network).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const handler = require('../api/analytics-config.js');
const { analyticsConfig } = handler;

function call(method = 'GET') {
  const res = { statusCode: 0, headers: {}, body: '', setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { this.body = b || ''; } };
  handler({ method }, res);
  return res;
}

test('nothing configured -> everything off', () => {
  assert.deepEqual(analyticsConfig({}), { ga4: null, speedInsights: false });
});
test('valid GA4 ID is returned (normalised to upper case)', () => {
  assert.equal(analyticsConfig({ GA4_MEASUREMENT_ID: ' g-abc123xyz9 ' }).ga4, 'G-ABC123XYZ9');
});
test('invalid / suspicious IDs are rejected', () => {
  for (const id of ['UA-12345-1', 'GTM-ABC123', 'G-', 'G-abc<script>', 'G-ABC 123', 'AW-123456', 'G-' + 'A'.repeat(30)]) {
    assert.equal(analyticsConfig({ GA4_MEASUREMENT_ID: id }).ga4, null, id);
  }
});
test('Speed Insights: default on only when running on Vercel; explicit on/off wins', () => {
  assert.equal(analyticsConfig({ VERCEL: '1' }).speedInsights, true);
  assert.equal(analyticsConfig({}).speedInsights, false);
  assert.equal(analyticsConfig({ VERCEL: '1', SPEED_INSIGHTS: 'off' }).speedInsights, false);
  assert.equal(analyticsConfig({ SPEED_INSIGHTS: 'on' }).speedInsights, true);
});
test('kill switch disables everything', () => {
  assert.deepEqual(analyticsConfig({ ANALYTICS_DISABLED: '1', GA4_MEASUREMENT_ID: 'G-ABC123XYZ9', VERCEL: '1' }), { ga4: null, speedInsights: false });
});
test('GET returns JSON with only the two switches and short public caching', () => {
  const r = call('GET');
  assert.equal(r.statusCode, 200);
  assert.deepEqual(Object.keys(JSON.parse(r.body)).sort(), ['ga4', 'speedInsights']);
  assert.match(r.headers['cache-control'], /s-maxage=600/);
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
});
test('non-GET methods -> 405', () => {
  const r = call('POST');
  assert.equal(r.statusCode, 405);
  assert.equal(r.headers.allow, 'GET, HEAD');
});
test('response never contains other environment variables', () => {
  const prev = { ...process.env };
  process.env.RESEND_API_KEY = 're_SHOULD_NOT_LEAK_123';
  try { assert.ok(!call('GET').body.includes('re_SHOULD_NOT_LEAK')); } finally { process.env = prev; }
});
