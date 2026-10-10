// Phase 03 analytics / consent end-to-end checks (headless Chrome, zero real analytics traffic).
// All requests to Google Analytics / Tag Manager / Speed Insights are intercepted and answered with
// local stubs, so nothing reaches Google or Vercel. Uses a clearly fake test-only ID: G-TEST1234AB.
// Usage: node tests/analytics.e2e.mjs
import { spawn } from 'node:child_process';
import { launch, sleep } from './lib/cdp.mjs';

const ROOT = new URL('..', import.meta.url);
const TEST_GA_ID = 'G-TEST1234AB'; // fake, for tests only
const results = []; let failed = 0;
function check(name, ok, detail = '') { results.push({ name, ok }); if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); }

const procs = [];
function start(args, env = {}) {
  const p = spawn(process.execPath, args, { cwd: ROOT, env: { ...process.env, VERCEL: '', GA4_MEASUREMENT_ID: '', SPEED_INSIGHTS: '', ANALYTICS_DISABLED: '', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  p.stderr.on('data', d => { const s = String(d); if (!/\[contact\]/.test(s)) process.stderr.write(s); });
  procs.push(p); return p;
}
start(['dev/mock-email-provider.mjs', '4197']);
start(['dev/server.mjs', '4195'], { GA4_MEASUREMENT_ID: TEST_GA_ID, SPEED_INSIGHTS: 'on', RESEND_API_KEY: 'test_key_not_real', RESEND_API_URL: 'http://localhost:4197/emails' });
start(['dev/server.mjs', '4196'], {}); // nothing configured
start(['dev/server.mjs', '4198'], { GA4_MEASUREMENT_ID: TEST_GA_ID, ANALYTICS_DISABLED: '1' }); // kill switch
async function waitUp(url) { for (let i = 0; i < 60; i++) { try { await fetch(url); return; } catch { await sleep(150); } } throw new Error('not up ' + url); }
await Promise.all(['http://localhost:4195/', 'http://localhost:4196/', 'http://localhost:4198/', 'http://localhost:4197/__received'].map(waitUp));
const C = 'http://localhost:4195', NONE = 'http://localhost:4196', KILL = 'http://localhost:4198', MOCK = 'http://localhost:4197';
const setMode = m => fetch(`${MOCK}/__mode/${m}`, { method: 'POST' });
// Mode the mock provider was in when it answered the payload containing `tag` (it records this per request).
const mockModesFor = async tag => (await (await fetch(`${MOCK}/__received`)).json()).filter(x => JSON.stringify(x.payload || {}).includes(tag)).map(x => x.mode);

const STUBS = [
  { urlPattern: 'googletagmanager\\.com/gtag/js', respond: () => ({ body: 'window.__gtagLoads=(window.__gtagLoads||0)+1;' }) },
  { urlPattern: '/_vercel/speed-insights/script\\.js', respond: () => ({ body: 'window.__siLoads=(window.__siLoads||0)+1;' }) },
];
const ANALYTICS_URL = /googletagmanager\.com|google-analytics\.com|analytics\.google\.com|doubleclick\.net|_vercel\/speed-insights|vercel-insights\.com/;

// Read the gtag command queue (Arguments objects pushed by window.gtag) in a JSON-safe form.
const COMMANDS = `(window.dataLayer || []).filter(x => Object.prototype.toString.call(x) === '[object Arguments]')
  .map(a => Array.from(a).map(v => v instanceof Date ? 'DATE' : v))`;
const gtagEvents = p => p.eval(`${COMMANDS}.filter(c => c[0] === 'event')`);
// Wait until a submission started after event index `from` has settled (generate_lead or form_error), instead of a
// fixed sleep: a slow round trip must not leak its outcome into the next check, or reach the mock after the next
// setMode() (Phase 05 Batch 1: intermittent T10 42/44, reproduced with a 3.5 s provider delay).
async function settle(p, from, timeoutMs = 25000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const names = (await gtagEvents(p)).slice(from).map(e => e[1]);
    if (names.includes('generate_lead') || names.includes('form_error')) return Date.now() - t0;
    await sleep(100);
  }
  return null;
}
// Wait until a page expression is truthy (15 s cap) before a positive check, instead of a fixed sleep: banner
// rendering, config lookups and script loads are async and take longer on a busy machine (Phase 05 Batch 1).
async function waitFor(p, expr, timeoutMs = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) { try { if (await p.eval(expr)) return true; } catch {} await sleep(100); }
  return false;
}
const configCount = p => p.eval(`${COMMANDS}.filter(c => c[0] === 'config').length`);
const analyticsHits = p => (p.log.intercepted || []).concat(p.log.requests.filter(r => ANALYTICS_URL.test(r.url) && !(p.log.intercepted || []).some(i => i.url === r.url)));
const blockNavigation = p => p.eval(`document.addEventListener('click', e => { const a = e.target.closest && e.target.closest('a[href]'); if (a && /^(tel:|mailto:|https:\\/\\/wa\\.me)/.test(a.getAttribute('href'))) e.preventDefault(); }, false); true`);
const setConsent = (p, analytics, ts = Date.now()) => p.eval(`localStorage.setItem('afra_consent_v1', JSON.stringify({ v: 1, analytics: ${analytics}, ts: ${ts} })); true`);

const browser = await launch({ port: 9360 });
const newPage = (opts = {}) => browser.newPage({ width: 1280, height: 900, intercept: STUBS, ...opts });
try {
  // ---------- T1: nothing configured -> no banner, no analytics requests ----------
  {
    const p = await newPage();
    await p.goto(NONE + '/'); await sleep(1500);
    const banner = await p.eval(`!!document.getElementById('afra-consent')`);
    check('T1 no tool configured: no banner, no analytics requests, gtag never defined', !banner && analyticsHits(p).length === 0 && await p.eval(`typeof window.gtag`) === 'undefined');
    await p.eval(`document.querySelector('[data-cookie-settings]').click()`);
    await waitFor(p, `/uses no analytics tools/.test((document.getElementById('afra-consent') || {}).textContent || '')`);
    const msg = await p.eval(`(document.getElementById('afra-consent') || {}).textContent || ''`);
    check('T1b "Cookie settings" with nothing configured says no analytics is used', /uses no analytics tools/.test(msg), msg.slice(0, 80));
    await p.close();
  }
  // ---------- kill switch ----------
  {
    const p = await newPage();
    await p.goto(KILL + '/'); await sleep(1500);
    check('Kill switch ANALYTICS_DISABLED=1 overrides a configured ID (no banner, no requests)', !(await p.eval(`!!document.getElementById('afra-consent')`)) && analyticsHits(p).length === 0);
    await p.close();
  }
  // ---------- T2: first visit -> banner, zero requests before choice ----------
  {
    const p = await newPage();
    await p.goto(C + '/'); await waitFor(p, `!!document.getElementById('afra-consent')`); await sleep(300);
    const r = await p.eval(`(() => { const b = document.getElementById('afra-consent'); if (!b) return null;
      const btns = [...b.querySelectorAll('button[data-consent]')].map(x => { const cs = getComputedStyle(x), rc = x.getBoundingClientRect(); return { t: x.textContent, cls: x.className, bg: cs.backgroundColor, color: cs.color, fw: cs.fontWeight, fs: cs.fontSize, w: Math.round(rc.width), h: Math.round(rc.height) }; });
      return { role: b.getAttribute('role'), labelled: !!document.getElementById(b.getAttribute('aria-labelledby')), text: b.textContent, btns, position: getComputedStyle(b).position, firstInBody: document.body.firstElementChild === b }; })()`);
    check('T2 first visit: banner shown (role=dialog, labelled, fixed, first in body)', r && r.role === 'dialog' && r.labelled && r.position === 'fixed' && r.firstInBody);
    check('T2 banner names exactly the configured tools', r && /Google Analytics/.test(r.text) && /Speed Insights/.test(r.text));
    const [rej, acc] = r ? r.btns : [];
    check('T2 equal prominence: Reject and Accept share class, colours, weight, size', rej && acc && rej.t === 'Reject' && acc.t === 'Accept' && rej.cls === acc.cls && rej.bg === acc.bg && rej.color === acc.color && rej.fw === acc.fw && rej.fs === acc.fs && Math.abs(rej.w - acc.w) <= 2 && rej.h === acc.h, JSON.stringify(r && r.btns));
    check('T2 zero analytics requests and no gtag before a choice', analyticsHits(p).length === 0 && await p.eval(`typeof window.gtag`) === 'undefined' && await p.eval(`(${COMMANDS}).length`) === 0);
    // events before consent are logged locally but never sent
    await blockNavigation(p);
    await p.eval(`document.querySelector('#contact a[href^="https://wa.me/"]').click()`); await sleep(200);
    const pre = await p.eval(`window.afraEvents.filter(e => e.event === 'whatsapp_click')`);
    check('T2 interactions before consent are not sent anywhere', pre.length === 1 && pre[0].sent === false && analyticsHits(p).length === 0);
    // T16 keyboard: Tab reaches the banner buttons early
    await p.eval(`document.activeElement && document.activeElement.blur(); window.scrollTo(0,0); true`);
    let reached = false;
    for (let i = 0; i < 6 && !reached; i++) { await p.key('Tab', 'Tab', 9); reached = await p.eval(`!!(document.activeElement && document.activeElement.closest('#afra-consent'))`); }
    check('T16 keyboard: banner buttons are reachable within the first Tab stops', reached);

    // ---------- T3: Reject ----------
    await p.eval(`document.querySelector('#afra-consent [data-consent="reject"]').click()`); await sleep(400);
    const afterReject = await p.eval(`({ banner: !!document.getElementById('afra-consent'), stored: JSON.parse(localStorage.getItem('afra_consent_v1')) })`);
    check('T3 Reject: banner closes, choice stored as rejected', !afterReject.banner && afterReject.stored && afterReject.stored.analytics === false);
    check('T3 Reject: still no analytics requests', analyticsHits(p).length === 0 && await p.eval(`typeof window.gtag`) === 'undefined');
    await p.close();
    // reload as a rejected visitor (fresh page, same profile => localStorage persists)
    const p2 = await newPage();
    await p2.goto(C + '/'); await sleep(1800);
    const cfgCalls = p2.log.requests.filter(q => q.url.endsWith('/api/analytics-config')).length;
    check('T3/T5 rejected choice persists across reloads: no banner, no config lookup, no analytics requests', !(await p2.eval(`!!document.getElementById('afra-consent')`)) && cfgCalls === 0 && analyticsHits(p2).length === 0, `configCalls=${cfgCalls}`);
    await p2.close();
  }
  // ---------- T4: Accept ----------
  {
    const p = await newPage();
    await p.goto(C + '/'); await p.eval(`localStorage.clear(); true`);
    await p.goto(C + '/?utm_source=newsletter&utm_medium=email&utm_campaign=launch_2026&utm_content=call+97455512345&utm_term=john%40example.org&email=john%40example.org&ref=abc#contact');
    await waitFor(p, `!!document.getElementById('afra-consent')`);
    await p.eval(`document.querySelector('#afra-consent [data-consent="accept"]').click()`);
    await waitFor(p, `window.__gtagLoads === 1 && window.__siLoads === 1`); await sleep(300); // extra time so a double load would be caught
    const st = await p.eval(`({ gtagLoads: window.__gtagLoads || 0, siLoads: window.__siLoads || 0, stored: JSON.parse(localStorage.getItem('afra_consent_v1')), cmds: ${COMMANDS} })`);
    const cfg = st.cmds.find(c => c[0] === 'config');
    const consentDefault = st.cmds.find(c => c[0] === 'consent' && c[1] === 'default');
    check('T4 Accept: GA4 loaded exactly once with the configured ID, choice stored', st.gtagLoads === 1 && cfg && cfg[1] === TEST_GA_ID && st.stored.analytics === true);
    check('T4 Accept: Speed Insights loaded exactly once (only after consent)', st.siLoads === 1);
    check('T4 Google signals + ad personalisation off; ad storage denied', cfg && cfg[2].allow_google_signals === false && cfg[2].allow_ad_personalization_signals === false && consentDefault && consentDefault[2].ad_storage === 'denied' && consentDefault[2].ad_user_data === 'denied' && consentDefault[2].ad_personalization === 'denied');
    const loc = cfg && cfg[2].page_location;
    check('T13 UTM: page_location keeps clean utm_source/medium/campaign only; drops PII-like UTMs, other params and hash',
      loc === 'http://localhost:4195/?utm_source=newsletter&utm_medium=email&utm_campaign=launch_2026', loc);
    check('T6 exactly one page view (one config command) per page load', await configCount(p) === 1);

    // ---------- T7: hash / in-page navigation adds no page views ----------
    const hrefBefore = await p.eval('location.href');
    for (const id of ['services', 'industries', 'portfolio', 'pricing', 'faq', 'contact', 'about', 'process', 'software-products', 'services']) {
      await p.eval(`document.querySelector('a[href="#${id}"]').click()`); await sleep(120);
    }
    const hrefAfter = await p.eval('location.href');
    check('T7 ten in-page nav clicks: still one page view, URL/history not rewritten', await configCount(p) === 1 && hrefAfter === hrefBefore, `${hrefBefore} -> ${hrefAfter}`);
    await p.eval(`location.hash = 'faq'; true`); await sleep(300);
    check('T7 manual hash change: no new config/page_view from our code', await configCount(p) === 1);

    // ---------- T8/T11: events, names, once per interaction ----------
    await blockNavigation(p);
    const before = (await gtagEvents(p)).length;
    await p.eval(`document.getElementById('cf-first').focus(); document.getElementById('cf-last').focus(); document.getElementById('cf-email').focus(); true`); await sleep(150);
    await p.eval(`(() => {
      document.querySelector('#contact a[href^="https://wa.me/"]').click();
      document.querySelector('#contact a[href^="tel:"]').click();
      document.querySelector('#contact a[href^="mailto:"]').click();
      document.querySelector('#services a[data-service="Website Development"]').click();
      document.querySelector('.hero-btns a[data-cta]').click();
      document.getElementById('wa-float').click();
      return true; })()`);
    await sleep(300);
    const ev = (await gtagEvents(p)).slice(before);
    const names = ev.map(e => e[1]);
    const count = n => names.filter(x => x === n).length;
    check('T8 contact_form_start fires once despite focusing several fields', count('contact_form_start') === 1, names.join(','));
    check('T11 whatsapp_click / phone_click / email_click / service_cta_click use the required names, once per click',
      count('whatsapp_click') === 2 && count('phone_click') === 1 && count('email_click') === 1 && count('service_cta_click') === 1 && count('cta_click') === 1, names.join(','));
    const svc = ev.find(e => e[1] === 'service_cta_click');
    check('T11 service_cta_click carries only allow-listed params', svc && JSON.stringify(Object.keys(svc[2]).sort()) === '["link_location","service"]' && svc[2].service === 'Website Development' && svc[2].link_location === 'services', JSON.stringify(svc && svc[2]));
    const wa = ev.filter(e => e[1] === 'whatsapp_click').map(e => e[2].link_location);
    check('T11 link_location identifies the section (contact, floating button)', wa.includes('contact') && wa.includes('floating_button'), wa.join(','));

    // ---------- T9: successful submission -> exactly one generate_lead ----------
    await setMode('success');
    const lb = (await gtagEvents(p)).length;
    await p.eval(`(() => { const f = document.getElementById('contact-form');
      f.firstName.value = 'Test'; f.lastName.value = 'Automated'; f.email.value = 'e2e-test@example.org'; f.phone.value = '+974 5555 1234';
      f.company.value = 'AUTOMATED TEST'; f.service.value = 'Website Development'; f.message.value = 'AUTOMATED ANALYTICS TEST please ignore';
      const b = document.getElementById('form-btn'); b.click(); b.click(); f.requestSubmit(); return true; })()`);
    await settle(p, lb); await sleep(500); // extra time so a duplicate generate_lead would be caught
    const lev = (await gtagEvents(p)).slice(lb);
    const leads = lev.filter(e => e[1] === 'generate_lead');
    check('T9 successful submission: exactly one generate_lead (double-click included)', leads.length === 1 && await p.eval(`!document.getElementById('form-success').hidden`), lev.map(e => e[1]).join(','));
    // Phase 04 (C7): generate_lead also carries the package ("none" when no plan was chosen). Budget is never included.
    check('T9 generate_lead params are fixed values only', leads[0] && JSON.stringify(leads[0][2]) === JSON.stringify({ form_id: 'contact', method: 'contact_form', service: 'Website Development', plan: 'none' }), JSON.stringify(leads[0] && leads[0][2]));

    // ---------- T12: PII scan of everything that would go to analytics ----------
    // The fake measurement ID (G-TEST1234AB) legitimately appears in config/script URLs; remove it so
    // the scan only judges data that could come from the visitor.
    const all = (JSON.stringify(await p.eval(COMMANDS)) + JSON.stringify(p.log.intercepted || [])).split(TEST_GA_ID).join('[GA_ID]');
    const pii = ['e2e-test', 'example.org', '@', 'Automated', 'AUTOMATED', '5555', '1234', '97455512345', 'john'].filter(x => all.includes(x));
    check('T12 no personal data in any analytics command or request', pii.length === 0, pii.join(','));
    check('T6 still exactly one page view after all interactions', await configCount(p) === 1);
    check('No CSP violations or exceptions with analytics active', !p.log.cspViolations.length && !p.log.exceptions.length, JSON.stringify([...p.log.cspViolations, ...p.log.exceptions]).slice(0, 200));
    await p.close();

    // ---------- T5: consent persists across reloads (granted) ----------
    const p2 = await newPage();
    await p2.goto(C + '/'); await waitFor(p2, `window.__gtagLoads === 1`); await sleep(300);
    check('T5 accepted choice persists: no banner, analytics loads once on the next page', !(await p2.eval(`!!document.getElementById('afra-consent')`)) && await p2.eval(`window.__gtagLoads || 0`) === 1 && await configCount(p2) === 1);

    // ---------- T10: failed submissions never count ----------
    // Each submission must clear the server's 2.5 s minimum-fill check, otherwise it is rejected as too_fast and never
    // reaches the provider. The form's clock starts when the deferred contact-form.js runs (always before
    // DOMContentLoaded), so wait until 3 s after DOMContentLoaded. The check asserts the mock really answered in `mode`.
    await blockNavigation(p2);
    for (const mode of ['fail', 'testing403']) {
      await setMode(mode);
      await p2.eval(`new Promise(r => setTimeout(() => r(true), Math.max(0, performance.getEntriesByType('navigation')[0].domContentLoadedEventStart + 3000 - performance.now())))`);
      const fb = (await gtagEvents(p2)).length;
      const tag = `AUTOMATED FAIL ${mode} ${Date.now()}`;
      await p2.eval(`(() => { const f = document.getElementById('contact-form'); f.hidden = false; document.getElementById('form-success').hidden = true;
        f.firstName.value = 'Test'; f.lastName.value = 'Automated'; f.email.value = 'e2e-test@example.org'; f.message.value = ${JSON.stringify(tag)};
        document.getElementById('form-btn').click(); return true; })()`);
      const ms = await settle(p2, fb);
      const fe = (await gtagEvents(p2)).slice(fb);
      const fev = fe.map(e => e[1]), codes = fe.filter(e => e[1] === 'form_error').map(e => e[2].error_code);
      const modes = await mockModesFor(tag);
      check(`T10 failed submission (${mode}): reaches the provider, no generate_lead, form_error recorded`,
        !fev.includes('generate_lead') && fev.includes('form_error') && modes.length > 0 && modes.every(m => m === mode),
        `${fev.join(',')} | error_code ${codes.join(',')} | settled in ${ms ?? 'TIMEOUT'} ms | mock answered as ${modes.join('+') || 'none'}`);
    }
    await setMode('success');
    // client-side validation failure
    const vb = (await gtagEvents(p2)).length;
    await p2.eval(`(() => { const f = document.getElementById('contact-form'); f.reset(); document.getElementById('form-btn').click(); return true; })()`); await sleep(300);
    const vev = (await gtagEvents(p2)).slice(vb).map(e => e[1]);
    check('T10 invalid form: no generate_lead', !vev.includes('generate_lead') && vev.includes('form_error'), vev.join(','));

    // ---------- T4b: withdraw consent via Cookie settings ----------
    await p2.eval(`document.cookie = '_ga=GA1.1.123.456; path=/'; document.cookie = '_ga_TEST1234AB=GS1.1.1; path=/'; true`);
    await p2.eval(`document.querySelector('[data-cookie-settings]').click()`);
    await waitFor(p2, `/accepted/.test((document.querySelector('.afra-consent-status') || {}).textContent || '') && !!(document.activeElement && document.activeElement.closest('#afra-consent'))`);
    const settings = await p2.eval(`({ open: !!document.getElementById('afra-consent'), focusInside: !!(document.activeElement && document.activeElement.closest('#afra-consent')), status: (document.querySelector('.afra-consent-status') || {}).textContent })`);
    check('T14 Cookie settings reopens the banner, moves focus into it, shows current choice', settings.open && settings.focusInside && /accepted/.test(settings.status || ''), JSON.stringify(settings));
    await p2.eval(`window.__beforeWithdrawal = true; document.querySelector('#afra-consent [data-consent="reject"]').click()`);
    await waitFor(p2, `!window.__beforeWithdrawal && document.readyState === 'complete'`); await sleep(1000); // page reloads after withdrawal
    const after = await p2.eval(`({ gtagLoads: window.__gtagLoads || 0, si: window.__siLoads || 0, cookies: document.cookie, stored: JSON.parse(localStorage.getItem('afra_consent_v1')), banner: !!document.getElementById('afra-consent') })`);
    check('T4b withdrawal: reloads without GA/Speed Insights, cookies removed, stored as rejected', after.gtagLoads === 0 && after.si === 0 && !/_ga/.test(after.cookies) && after.stored.analytics === false && !after.banner, JSON.stringify(after));
    await p2.close();
  }
  // ---------- consent expiry ----------
  {
    const p = await newPage();
    await p.goto(C + '/'); await setConsent(p, true, Date.now() - 366 * 24 * 3600 * 1000);
    const p2 = await newPage();
    await p2.goto(C + '/'); await waitFor(p2, `!!document.getElementById('afra-consent')`);
    check('Consent older than 12 months is ignored: banner shown again, nothing loaded', await p2.eval(`!!document.getElementById('afra-consent')`) && analyticsHits(p2).length === 0);
    await p2.eval(`localStorage.clear(); true`);
    await p.close(); await p2.close();
  }
  // ---------- legal pages ----------
  {
    const p = await newPage({ width: 390, height: 844, mobile: true });
    await p.goto(C + '/privacy-policy'); await waitFor(p, `!!document.getElementById('afra-consent')`); await sleep(300);
    const r = await p.eval(`({ banner: !!document.getElementById('afra-consent'), sw: document.documentElement.scrollWidth, vw: innerWidth, h1: document.querySelectorAll('h1').length,
      inView: (() => { const b = document.querySelector('.afra-consent-inner'); if (!b) return false; const rc = b.getBoundingClientRect(); return rc.left >= 0 && rc.right <= innerWidth && rc.bottom <= innerHeight; })() })`);
    check('T14 Privacy page (mobile): banner shown and fits the viewport, no horizontal scroll, page intact', r.banner && r.inView && r.sw <= r.vw && r.h1 === 1, JSON.stringify(r));
    check('T14 Privacy page: no analytics requests before consent', analyticsHits(p).length === 0);
    await p.eval(`document.querySelector('#afra-consent [data-consent="accept"]').click()`); await waitFor(p, `window.__gtagLoads === 1`);
    await blockNavigation(p);
    await p.eval(`document.querySelector('main a[href^="tel:"]').click(); document.querySelector('main a[href^="mailto:"]').click(); true`); await sleep(200);
    const names = (await gtagEvents(p)).map(e => e[1] + ':' + e[2].link_location);
    check('T14 Privacy page after consent: GA loads once, phone/email clicks tracked', await p.eval(`window.__gtagLoads || 0`) === 1 && names.includes('phone_click:privacy_policy') && names.includes('email_click:privacy_policy'), names.join(','));
    await p.goto(C + '/terms'); await waitFor(p, `window.__gtagLoads === 1`); await sleep(300);
    check('T14 Terms page: consent remembered, GA loads once, page intact', await p.eval(`window.__gtagLoads || 0`) === 1 && await p.eval(`document.querySelectorAll('h1').length`) === 1 && !p.log.cspViolations.length);
    // Escape closes settings and returns focus to the trigger
    await p.eval(`document.querySelector('[data-cookie-settings]').focus(); document.querySelector('[data-cookie-settings]').click(); true`);
    await waitFor(p, `!!(document.activeElement && document.activeElement.closest('#afra-consent'))`);
    await p.key('Escape', 'Escape', 27); await sleep(200);
    const esc = await p.eval(`({ open: !!document.getElementById('afra-consent'), focus: document.activeElement && document.activeElement.hasAttribute('data-cookie-settings') })`);
    check('T16 Escape closes Cookie settings and returns focus to the footer button', !esc.open && esc.focus, JSON.stringify(esc));
    await p.eval(`localStorage.clear(); true`);
    await p.close();
  }
  // ---------- T15: CSP + headers ----------
  {
    const r = await fetch(C + '/');
    const csp = r.headers.get('content-security-policy') || '';
    const scriptSrc = (csp.match(/script-src ([^;]+)/) || [])[1] || '';
    check('T15 CSP script-src allows only self + googletagmanager; no unsafe-inline/eval for scripts',
      scriptSrc.trim() === "'self' https://www.googletagmanager.com" && !/unsafe-eval/.test(csp), scriptSrc);
    check('T15 other directives unchanged (frame-ancestors none, object-src none, form-action self, base-uri self)',
      /frame-ancestors 'none'/.test(csp) && /object-src 'none'/.test(csp) && /form-action 'self'/.test(csp) && /base-uri 'self'/.test(csp) && r.headers.get('x-frame-options') === 'DENY' && r.headers.get('x-content-type-options') === 'nosniff');
    const cfg = await (await fetch(C + '/api/analytics-config')).json();
    check('Config endpoint exposes only tool switches (no secrets)', JSON.stringify(Object.keys(cfg).sort()) === '["ga4","speedInsights"]' && cfg.ga4 === TEST_GA_ID && cfg.speedInsights === true, JSON.stringify(cfg));
  }
  // ---------- layout: banner causes no layout shift ----------
  {
    const p = await newPage({ initScript: `window.__cls=0;new PerformanceObserver(l=>{for(const e of l.getEntries())if(!e.hadRecentInput)window.__cls+=e.value;}).observe({type:'layout-shift',buffered:true});` });
    await p.goto(C + '/'); await sleep(2500);
    const cls = await p.eval('window.__cls');
    check('Banner appearance adds no measurable layout shift (CLS < 0.01)', cls < 0.01, String(cls));
    await p.eval(`localStorage.clear(); true`);
    await p.close();
  }
} catch (err) {
  check('harness error', false, err.stack);
} finally {
  await browser.close();
  procs.forEach(p => p.kill());
}
console.log(`\n${results.length - failed}/${results.length} analytics checks passed`);
process.exit(failed ? 1 : 0);
