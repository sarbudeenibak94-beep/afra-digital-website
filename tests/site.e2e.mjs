// End-to-end checks in headless Chrome against the local preview server (dev/server.mjs).
// Starts its own servers: an unconfigured site (4180), a site wired to the mock email provider (4181)
// and the mock provider itself (4182). No real email is ever sent.
// Usage: node tests/site.e2e.mjs
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { launch, sleep } from './lib/cdp.mjs';

const ROOT = new URL('..', import.meta.url);
const PROD = 'https://www.afra-digital.com';
const results = []; let failed = 0;
function check(name, ok, detail = '') { results.push({ name, ok, detail }); if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); }

const procs = [];
function start(args, env = {}) {
  const p = spawn(process.execPath, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  p.stderr.on('data', d => { const s = String(d); if (!/\[contact\]/.test(s)) process.stderr.write(s); });
  procs.push(p); return p;
}
start(['dev/mock-email-provider.mjs', '4182']);
start(['dev/server.mjs', '4180'], { RESEND_API_KEY: '' });
start(['dev/server.mjs', '4181'], { RESEND_API_KEY: 'test_key_not_real', RESEND_API_URL: 'http://localhost:4182/emails' });
async function waitUp(url) { for (let i = 0; i < 60; i++) { try { await fetch(url); return; } catch { await sleep(150); } } throw new Error('server not up ' + url); }
await Promise.all([waitUp('http://localhost:4180/'), waitUp('http://localhost:4181/'), waitUp('http://localhost:4182/__received')]);
const A = 'http://localhost:4180', B = 'http://localhost:4181', MOCK = 'http://localhost:4182';
const setMode = m => fetch(`${MOCK}/__mode/${m}`, { method: 'POST' });

try {
  // ---------------- HTTP-level checks ----------------
  const get = (p, base = A) => fetch(base + p, { redirect: 'manual' });
  for (const p of ['/', '/privacy-policy', '/terms', '/robots.txt', '/sitemap.xml', '/manifest.json', '/favicon.ico', '/apple-touch-icon.png', '/assets/img/og-afra-digital-1200x630.jpg', '/assets/js/site.js', '/assets/css/legal.css']) {
    const r = await get(p); check(`GET ${p} -> 200`, r.status === 200, String(r.status));
  }
  { const r = await get('/index.html'); check('/index.html -> 308 /', r.status === 308 && r.headers.get('location') === '/', `${r.status} ${r.headers.get('location')}`); }
  { const r = await get('/terms.html'); check('/terms.html -> 308 /terms (cleanUrls)', r.status === 308 && r.headers.get('location') === '/terms', `${r.status} ${r.headers.get('location')}`); }
  { const r = await get('/no-such-page'); const t = await r.text(); check('unknown path -> 404 branded page (noindex)', r.status === 404 && /We couldn’t find that page/.test(t) && /noindex/.test(t), String(r.status)); }
  for (const p of ['/dev/server.mjs', '/tests/site.e2e.mjs', '/api/_lib/contact-core.js', '/vercel.json']) { const r = await get(p); check(`internal file not served: ${p}`, r.status === 404, String(r.status)); }
  { const r = await get('/'); const csp = r.headers.get('content-security-policy') || '';
    check('security headers present', /script-src 'self'/.test(csp) && r.headers.get('x-content-type-options') === 'nosniff' && r.headers.get('x-frame-options') === 'DENY' && !!r.headers.get('referrer-policy'), csp.slice(0, 60)); }
  { const r = await get('/assets/img/og-afra-digital-1200x630.jpg'); const buf = Buffer.from(await r.arrayBuffer());
    const isJpeg = buf[0] === 0xFF && buf[1] === 0xD8; let w = 0, h = 0;
    for (let i = 2; i < buf.length;) { if (buf[i] !== 0xFF) break; const mk = buf[i + 1], len = buf.readUInt16BE(i + 2); if (mk >= 0xC0 && mk <= 0xC2) { h = buf.readUInt16BE(i + 5); w = buf.readUInt16BE(i + 7); break; } i += 2 + len; }
    check('social image is real JPEG 1200x630 under 300 KB', isJpeg && w === 1200 && h === 630 && buf.length < 300 * 1024, `${w}x${h} ${(buf.length / 1024).toFixed(0)}KB ${r.headers.get('content-type')}`); }
  { const t = await (await get('/robots.txt')).text();
    check('robots.txt: correct sitemap, nothing essential blocked', /Sitemap: https:\/\/www\.afra-digital\.com\/sitemap\.xml/.test(t) && !/Disallow: \/\s*$/m.test(t) && !/Disallow: \/assets/.test(t), t.replace(/\n/g, ' | ')); }
  { const xml = await (await get('/sitemap.xml')).text();
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
    check('sitemap: only www https URLs, no placeholder', locs.length === 3 && locs.every(u => u.startsWith(PROD + '/')) && !/yourdomain/.test(xml), locs.join(', '));
    for (const u of locs) {
      const path = u.slice(PROD.length) || '/';
      const r = await get(path); const html = await r.text();
      const canon = (html.match(/<link rel="canonical" href="([^"]+)"/) || [])[1];
      const robots = (html.match(/<meta name="robots" content="([^"]+)"/) || [])[1] || '';
      check(`sitemap URL ${path}: 200, self-canonical, indexable`, r.status === 200 && canon === u && !/noindex/.test(robots), `${r.status} canonical=${canon}`);
    } }
  { const m = JSON.parse(await (await get('/manifest.json')).text());
    const ok = await Promise.all(m.icons.map(async i => (await get(i.src)).status === 200));
    check('manifest icons exist', ok.every(Boolean), m.icons.map(i => i.src).join(', ')); }
  for (const f of ['index.html', 'privacy-policy.html', 'terms.html', '404.html', 'robots.txt', 'sitemap.xml', 'manifest.json']) {
    const t = readFileSync(new URL(f, ROOT), 'utf8'); check(`no placeholder domain in ${f}`, !/yourdomain/i.test(t));
  }

  // ---------------- Browser checks ----------------
  const browser = await launch({ port: 9345 });
  try {
    // Page integrity, SEO tags, structured data
    {
      const p = await browser.newPage({ width: 1440, height: 900 });
      await p.goto(A + '/'); await sleep(1500);
      const r = await p.eval(`(() => {
        const q = s => document.querySelector(s); const meta = (k, attr='property') => (q('meta['+attr+'="'+k+'"]')||{}).content;
        const ld = [...document.querySelectorAll('script[type="application/ld+json"]')].map(s => { try { return JSON.parse(s.textContent); } catch (e) { return { error: e.message }; } });
        const faqVisible = [...document.querySelectorAll('.faq-item')].map(i => ({ q: i.querySelector('.faq-q span').textContent.trim(), a: i.querySelector('.faq-a-inner').textContent.trim() }));
        const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map(h => +h.tagName[1]);
        let skips = 0; for (let i = 1; i < headings.length; i++) if (headings[i] > headings[i-1] + 1) skips++;
        const imgs = [...document.images].map(i => ({ src: i.getAttribute('src'), alt: i.getAttribute('alt'), w: i.getAttribute('width'), h: i.getAttribute('height'), lazy: i.loading === 'lazy', ok: i.loading === 'lazy' || (i.complete && i.naturalWidth > 0) }));
        return { canonical: (q('link[rel=canonical]')||{}).href, ogUrl: meta('og:url'), ogImage: meta('og:image'), twImage: meta('twitter:image','name'), title: document.title, desc: meta('description','name'),
          h1: document.querySelectorAll('h1').length, h1Text: q('h1').textContent.replace(/\\s+/g,' ').trim(), skips, ld, faqVisible, imgs,
          main: document.querySelectorAll('main').length, skip: !!q('a.skip-link[href="#main"]'),
          sectionOrder: [...document.querySelectorAll('main > section[id], main > .cta-strip')].map(s => s.id || 'cta-strip') };
      })()`);
      check('canonical = https://www.afra-digital.com/', r.canonical === PROD + '/', r.canonical);
      check('og:url / og:image / twitter:image on www origin', r.ogUrl === PROD + '/' && r.ogImage === PROD + '/assets/img/og-afra-digital-1200x630.jpg' && r.twImage === r.ogImage);
      check('title <= 60 chars, description <= 160 chars', r.title.length <= 60 && r.desc.length <= 160, `${r.title.length}/${r.desc.length}`);
      check('exactly one H1, descriptive', r.h1 === 1 && /Websites, Apps & AI Solutions for GCC Businesses/.test(r.h1Text), r.h1Text);
      check('no skipped heading levels', r.skips === 0, String(r.skips));
      check('<main> landmark + skip link', r.main === 1 && r.skip);
      check('services appear before own products', r.sectionOrder.indexOf('services') > -1 && r.sectionOrder.indexOf('services') < r.sectionOrder.indexOf('software-products'), r.sectionOrder.join(' > '));
      check('testimonials removed', !r.sectionOrder.includes('testimonials'));
      check('JSON-LD parses', r.ld.length === 1 && !r.ld[0].error);
      const graph = r.ld[0]['@graph'] || [];
      const org = graph.find(n => n['@type'] === 'Organization');
      check('Organization schema: verified fields only (no address/legalName/ratings)', org && org.url === PROD + '/' && !org.address && !org.legalName && !org.aggregateRating && !org.review && org.telephone === '+974 3002 9799');
      const faqNode = graph.find(n => [].concat(n['@type']).includes('FAQPage'));
      const ldFaq = faqNode ? faqNode.mainEntity.map(e => ({ q: e.name, a: e.acceptedAnswer.text })) : [];
      check('FAQPage schema matches visible FAQ text exactly', JSON.stringify(ldFaq) === JSON.stringify(r.faqVisible), `${ldFaq.length} vs ${r.faqVisible.length}`);
      const lazyOk = (await Promise.all(r.imgs.filter(i => i.lazy).map(async i => (await fetch(A + i.src)).status === 200))).every(Boolean);
      check('all images load (lazy ones reachable), have alt attribute and dimensions', lazyOk && r.imgs.every(i => i.ok && i.alt !== null && i.w && i.h), JSON.stringify(r.imgs.filter(i => !(i.ok && i.alt !== null && i.w && i.h))));
      await sleep(500);
      check('no console errors / CSP violations / exceptions on load', !p.log.exceptions.length && !p.log.cspViolations.length && !p.log.console.filter(c => /^error/.test(c)).length, JSON.stringify([...p.log.exceptions, ...p.log.cspViolations, ...p.log.console]).slice(0, 300));
      check('no request to retired heavy images', !p.log.requests.some(q => /afra-logo\.png|ai-background\.jpg|afra-social-preview/.test(q.url)));

      // anchors & clicks that used to throw
      p.log.exceptions.length = 0;
      await p.eval(`document.querySelector('footer .nav-logo').click()`); await sleep(400);
      await p.eval(`document.querySelector('footer a[href="#cook-with-fire"]').click()`); await sleep(2500);
      const cwf = await p.eval(`(() => { const r = document.getElementById('cook-with-fire').getBoundingClientRect(); return Math.round(r.top); })()`);
      check('footer "Cook With Fire" link scrolls to the product (was broken #product)', cwf > -10 && cwf < 200, `top=${cwf}`);
      check('logo / in-page links throw no exceptions', !p.log.exceptions.length, p.log.exceptions.join(' | '));
      const legal = await p.eval(`[...document.querySelectorAll('.foot-legal a')].map(a => a.getAttribute('href'))`);
      check('footer legal links are real pages', JSON.stringify(legal) === JSON.stringify(['/privacy-policy', '/terms', '/privacy-policy#cookies']), legal.join(', '));
      const contacts = await p.eval(`({ wa: [...document.querySelectorAll('a[href^="https://wa.me/"]')].every(a => a.href.startsWith('https://wa.me/97430029799')), tel: [...document.querySelectorAll('a[href^="tel:"]')].every(a => a.getAttribute('href') === 'tel:+97430029799'), telCount: document.querySelectorAll('a[href^="tel:"]').length, li: !!document.querySelector('a[href="https://www.linkedin.com/in/sarbudeen-ibak"]') })`);
      check('WhatsApp + phone links use the confirmed number; LinkedIn linked', contacts.wa && contacts.tel && contacts.telCount >= 2 && contacts.li, JSON.stringify(contacts));
      // claims that must be gone
      const text = await p.eval('document.body.innerText');
      const banned = ['50+', '24/7', '99.9%', 'millions of records', 'Award-level', 'Apple-quality', 'Al-Rashidi', 'Sara Khalid', 'Zenith', '195 Source Files', '98', 'Equity partnership'];
      const found = banned.filter(b => b === '98' ? /\b98\b/.test(text) : text.includes(b));
      check('unsupported claims removed from visible text', !found.length, found.join(', '));
      await p.close();
    }

    // Keyboard: skip link, FAQ, mobile menu
    {
      const p = await browser.newPage({ width: 1440, height: 900 });
      await p.goto(A + '/'); await sleep(1200);
      await p.key('Tab', 'Tab', 9);
      const first = await p.eval(`document.activeElement.className + '|' + document.activeElement.textContent.trim()`);
      check('first Tab focuses "Skip to main content"', /skip-link/.test(first), first);
      await p.eval(`document.getElementById('faq-q-1').focus()`);
      await p.key('Enter', 'Enter', 13); await sleep(600);
      const faq = await p.eval(`({ exp: document.getElementById('faq-q-1').getAttribute('aria-expanded'), h: Math.round(document.getElementById('faq-a-1').getBoundingClientRect().height), inner: document.getElementById('faq-a-1').scrollHeight })`);
      check('FAQ opens with keyboard and shows full answer', faq.exp === 'true' && faq.h >= faq.inner - 2, JSON.stringify(faq));
      await p.key(' ', 'Space', 32); await sleep(500);
      check('FAQ closes with Space', await p.eval(`document.getElementById('faq-q-1').getAttribute('aria-expanded')`) === 'false');
      await p.close();

      const m = await browser.newPage({ width: 390, height: 844, mobile: true });
      await m.goto(A + '/'); await sleep(1200);
      const tabbableClosed = await m.eval(`[...document.querySelectorAll('#mob-nav a')].some(a => getComputedStyle(a).visibility !== 'hidden')`);
      check('closed mobile menu links are not focusable/visible', !tabbableClosed);
      await m.eval(`document.getElementById('hamburger').focus()`);
      await m.key('Enter', 'Enter', 13); await sleep(450);
      const open = await m.eval(`({ exp: document.getElementById('hamburger').getAttribute('aria-expanded'), focus: document.activeElement.closest('#mob-nav') !== null, label: document.getElementById('hamburger').getAttribute('aria-label') })`);
      check('mobile menu opens with keyboard, focus moves into menu', open.exp === 'true' && open.focus, JSON.stringify(open));
      await m.key('Escape', 'Escape', 27); await sleep(450);
      const closed = await m.eval(`({ exp: document.getElementById('hamburger').getAttribute('aria-expanded'), back: document.activeElement.id })`);
      check('Escape closes menu and returns focus to the button', closed.exp === 'false' && closed.back === 'hamburger', JSON.stringify(closed));
      await m.close();
    }

    // ---------------- Contact form ----------------
    const fill = (p, extra = '') => p.eval(`(() => { const f = document.getElementById('contact-form');
      f.firstName.value = 'Test'; f.lastName.value = 'Automated'; f.email.value = 'e2e-test@example.org'; f.phone.value = '+974 0000 0000';
      f.company.value = 'AUTOMATED TEST - not a real lead'; f.service.value = 'Website Development'; f.message.value = 'AUTOMATED E2E TEST ' + Date.now() + ' - please ignore'; ${extra} })()`);
    const state = p => p.eval(`({ success: !document.getElementById('form-success').hidden, formHidden: document.getElementById('contact-form').hidden, error: document.getElementById('form-error').hidden ? '' : document.getElementById('form-error-msg').textContent, btn: document.getElementById('form-btn').textContent.trim(), disabled: document.getElementById('form-btn').disabled, dl: (window.afraEvents || []).map(e => e.event), dlRaw: JSON.stringify(window.afraEvents || []) })`);
    const apiCalls = p => p.log.requests.filter(r => r.url.endsWith('/api/contact') && r.method === 'POST');

    // 1. client validation: nothing sent
    {
      const p = await browser.newPage({ width: 1280, height: 900 });
      await p.goto(A + '/'); await sleep(800);
      await p.eval(`document.getElementById('form-btn').click()`); await sleep(400);
      const r = await p.eval(`({ invalid: [...document.querySelectorAll('#contact-form [aria-invalid="true"]')].map(e => e.name), msgs: [...document.querySelectorAll('.f-err:not([hidden])')].map(e => e.textContent), focus: document.activeElement.name })`);
      check('empty submit: required errors shown, focus on first field, no request', JSON.stringify(r.invalid) === '["firstName","lastName","email"]' && r.focus === 'firstName' && apiCalls(p).length === 0, JSON.stringify(r));
      await p.eval(`(() => { const f = document.getElementById('contact-form'); f.firstName.value='A'; f.lastName.value='B'; f.email.value='not-an-email'; f.phone.value='abc'; })()`);
      await p.eval(`document.getElementById('form-btn').click()`); await sleep(300);
      const r2 = await p.eval(`[...document.querySelectorAll('#contact-form [aria-invalid="true"]')].map(e => e.name)`);
      check('invalid email/phone rejected client-side, no request', JSON.stringify(r2) === '["email","phone"]' && apiCalls(p).length === 0, JSON.stringify(r2));
      await p.close();
    }
    // 2. provider not configured -> honest error, no success
    {
      const p = await browser.newPage({ width: 1280, height: 900 });
      await p.goto(A + '/'); await sleep(3000);
      await fill(p); await p.eval(`document.getElementById('form-btn').click()`); await sleep(1500);
      const s = await state(p);
      check('not configured: truthful error + alternatives, NO success shown', !s.success && /temporarily unavailable/.test(s.error) && !s.dl.includes('generate_lead'), s.error);
      check('failure tracked as form_error (no PII)', s.dl.includes('form_error') && !/e2e-test|Automated|0000/.test(s.dlRaw), s.dl.join(','));
      check('button re-enabled after failure', !s.disabled && /Send Message/.test(s.btn), s.btn);
      await p.close();
    }
    // 3. too fast (bot-like) -> rejected
    {
      const p = await browser.newPage({ width: 1280, height: 900 });
      await setMode('success');
      await p.goto(B + '/'); await sleep(200);
      await fill(p); await p.eval(`document.getElementById('form-btn').click()`); await sleep(1200);
      const s = await state(p);
      check('submission within 2.5 s is rejected (anti-bot), no success', !s.success && /wait a few seconds/.test(s.error), s.error);
      await p.close();
    }
    // 4. success via mock provider (+ double-click guard)
    {
      const before = (await (await fetch(`${MOCK}/__received`)).json()).length;
      const p = await browser.newPage({ width: 1280, height: 900 });
      await setMode('success');
      await p.goto(B + '/'); await sleep(3000);
      await fill(p);
      await p.eval(`(() => { const b = document.getElementById('form-btn'); b.click(); b.click(); document.getElementById('contact-form').requestSubmit(); })()`);
      const mid = await state(p);
      await sleep(1500);
      const s = await state(p);
      const received = (await (await fetch(`${MOCK}/__received`)).json()).slice(before);
      check('loading state shown while sending', /Sending/.test(mid.btn) && mid.disabled, mid.btn);
      check('rapid double submit sends exactly one request', apiCalls(p).length === 1 && received.length === 1, `browser=${apiCalls(p).length} provider=${received.length}`);
      check('success shown only after provider accepted the email', s.success && s.formHidden && received.length === 1);
      const pl = received[0] && received[0].payload;
      check('email delivered to afradigital.hello@gmail.com with reply-to = enquirer, plain text', pl && pl.to[0] === 'afradigital.hello@gmail.com' && pl.reply_to === 'e2e-test@example.org' && !pl.html && /AUTOMATED E2E TEST/.test(pl.text) && received[0].hasBearer, pl && pl.subject);
      check('generate_lead tracked once, without personal data', s.dl.filter(e => e === 'generate_lead').length === 1 && !/e2e-test|Automated|0000|AUTOMATED/.test(s.dlRaw), s.dlRaw.slice(0, 200));
      check('sender is on the verified domain (not resend.dev) and an Idempotency-Key is sent', pl && pl.from === 'AFRA DIGITAL Website <website@afra-digital.com>' && /^afra-contact-[0-9a-f]{40}$/.test(received[0].idempotencyKey || ''), pl && `${pl.from} key=${received[0].idempotencyKey}`);
      await p.close();
    }
    // 4b. real-world Resend 403 rejections -> generic error, input preserved, no retry, no false success
    for (const mode of ['testing403', 'unverified403', 'badkey']) {
      const before = (await (await fetch(`${MOCK}/__received`)).json()).length;
      const p = await browser.newPage({ width: 1280, height: 900 });
      await setMode(mode);
      await p.goto(B + '/'); await sleep(3000);
      await fill(p); await p.eval(`document.getElementById('form-btn').click()`); await sleep(1500);
      const s = await state(p);
      const kept = await p.eval(`(() => { const f = document.getElementById('contact-form'); return !f.hidden && f.email.value === 'e2e-test@example.org' && f.firstName.value === 'Test' && /AUTOMATED E2E TEST/.test(f.message.value); })()`);
      const attempts = (await (await fetch(`${MOCK}/__received`)).json()).length - before;
      const body = await p.eval(`document.getElementById('form-error').textContent`);
      check(`Resend ${mode}: generic error, NO success, input kept, provider called once`, !s.success && /could not be sent/.test(s.error) && kept && attempts === 1 && !/resend|403|verify|api key/i.test(body), `attempts=${attempts} kept=${kept} msg=${s.error}`);
      await p.close();
    }
    await setMode('success');
    // 5. provider failure -> honest error
    {
      const p = await browser.newPage({ width: 1280, height: 900 });
      await setMode('fail');
      await p.goto(B + '/'); await sleep(3000);
      await fill(p); await p.eval(`document.getElementById('form-btn').click()`); await sleep(2500);
      const s = await state(p);
      check('provider 500: error with WhatsApp/email alternatives, NO success', !s.success && /could not be sent/.test(s.error), s.error);
      const links = await p.eval(`[...document.querySelectorAll('#form-error a')].map(a => a.getAttribute('href').split('?')[0])`);
      check('error box offers WhatsApp, phone and email', links.includes('https://wa.me/97430029799') && links.includes('tel:+97430029799') && links.includes('mailto:afradigital.hello@gmail.com'), links.join(', '));
      await p.close();
    }
    // 6. provider timeout -> honest "may not have been delivered"
    {
      const p = await browser.newPage({ width: 1280, height: 900 });
      await setMode('slow');
      await p.goto(B + '/'); await sleep(3000);
      await fill(p); await p.eval(`document.getElementById('form-btn').click()`);
      await sleep(10500);
      const s = await state(p);
      check('provider timeout: "may not have been delivered" error, NO success', !s.success && /may not have been delivered/.test(s.error), s.error);
      await setMode('success');
      await p.close();
    }
    // 7. server unreachable -> network error message
    {
      const p = await browser.newPage({ width: 1280, height: 900 });
      await p.goto(B + '/'); await sleep(3000);
      await p.S('Network.setBlockedURLs', { urls: ['*/api/contact'] });
      await fill(p); await p.eval(`document.getElementById('form-btn').click()`); await sleep(1500);
      const s = await state(p);
      check('network failure: honest error, NO success', !s.success && /could not reach our server/.test(s.error), s.error);
      await p.close();
    }
    // 8. analytics click events, no PII
    {
      const p = await browser.newPage({ width: 1280, height: 900 });
      await p.goto(A + '/'); await sleep(800);
      await p.eval(`(() => { const stop = e => e.preventDefault(); document.addEventListener('click', stop);
        document.querySelector('.hero-btns a[data-cta]').click();
        document.querySelector('#contact a[href^="https://wa.me/"]').click();
        document.querySelector('#contact a[href^="tel:"]').click();
        document.querySelector('#contact a[href^="mailto:"]').click(); })()`);
      await sleep(200);
      const dl = await p.eval(`window.afraEvents || []`);
      const ev = dl.map(e => e.event);
      check('CTA / WhatsApp / phone / email clicks produce analytics events (in-memory log)', ['cta_click', 'whatsapp_click', 'phone_click', 'email_click'].every(e => ev.includes(e)), ev.join(','));
      check('analytics events carry no personal data', !/@|\+974|3002|afradigital\.hello/.test(JSON.stringify(dl)), JSON.stringify(dl).slice(0, 200));
      const thirdParty = p.log.requests.filter(r => !/^(http:\/\/localhost|data:|https:\/\/fonts\.(googleapis|gstatic)\.com)/.test(r.url));
      check('no third-party tracking requests', thirdParty.length === 0, thirdParty.map(r => r.url).join(', '));
      await p.close();
    }
    // 9. legal pages render cleanly
    for (const path of ['/privacy-policy', '/terms', '/no-such-page']) {
      const p = await browser.newPage({ width: 390, height: 844, mobile: true });
      await p.goto(A + path); await sleep(500);
      const r = await p.eval(`({ h1: document.querySelectorAll('h1').length, sw: document.documentElement.scrollWidth, vw: innerWidth, home: !!document.querySelector('a[href="/"]') })`);
      check(`${path}: renders, one H1, home link, no horizontal scroll, no errors`, r.h1 === 1 && r.sw <= r.vw && r.home && !p.log.exceptions.length && !p.log.cspViolations.length, JSON.stringify(r));
      await p.close();
    }
  } finally { await browser.close(); }
} catch (err) {
  check('test harness error', false, err.stack);
} finally {
  procs.forEach(p => p.kill());
}
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
