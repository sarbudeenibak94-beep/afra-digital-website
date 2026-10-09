'use strict';
// GET /api/analytics-config — tells the browser which measurement tools are switched on.
// Configuration comes only from server-side environment variables, so analytics can be
// enabled/disabled per Vercel environment without code changes (redeploy to apply):
//   GA4_MEASUREMENT_ID   e.g. G-XXXXXXXXXX (public identifier, not a secret). Unset/invalid = GA4 off.
//   SPEED_INSIGHTS       "on" | "off". Default: on when running on Vercel, off elsewhere.
//   ANALYTICS_DISABLED   "1" = kill switch: everything off (no consent banner is shown).
// Nothing is loaded by the browser until the visitor consents (see assets/js/analytics.js).

const GA4_ID_RE = /^G-[A-Z0-9]{4,16}$/;

function analyticsConfig(env = process.env) {
  if (String(env.ANALYTICS_DISABLED || '').trim() === '1') return { ga4: null, speedInsights: false };
  const id = String(env.GA4_MEASUREMENT_ID || '').trim().toUpperCase();
  const si = String(env.SPEED_INSIGHTS || '').trim().toLowerCase();
  const speedInsights = si === 'on' ? true : si === 'off' ? false : env.VERCEL === '1';
  return { ga4: GA4_ID_RE.test(id) ? id : null, speedInsights };
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
  // Short CDN caching keeps function invocations low; config changes need a redeploy anyway.
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=600');
  res.end(req.method === 'HEAD' ? undefined : JSON.stringify(analyticsConfig()));
};
module.exports.analyticsConfig = analyticsConfig;
module.exports.GA4_ID_RE = GA4_ID_RE;
