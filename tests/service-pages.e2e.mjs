// Phase 05 service pages — end-to-end checks (Batch 1: /services/website-development).
// Covers routing, metadata, structured data, sitemap, shared header/menu/form/footer parity with the
// homepage, form attribution (default source + every CTA), WhatsApp links, internal links, validation,
// delivery via the MOCK email provider (no real email is ever sent), consent/analytics privacy,
// keyboard and reduced-motion behaviour, contrast, responsive layout and homepage regression points.
// Usage: node tests/service-pages.e2e.mjs
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { launch, sleep } from './lib/cdp.mjs';

const ROOT = new URL('..', import.meta.url);
const read = f => readFileSync(new URL(f, ROOT), 'utf8');
const PROD = 'https://www.afra-digital.com';

// One expectation object per released service page. Batch 2/3 pages are added here.
const PAGES = [{
  slug: 'website-development', file: 'services/website-development.html', service: 'Website Development', h1Term: /Website Design & Development/,
  defaultSource: 'lp_web_form',
  ctas: { lp_web_nav: null, lp_web_mobile_menu: null, lp_web_hero: null, lp_web_pricing_starter: 'Starter', lp_web_final: null },
  waContext: { hero: /website project/i, start: /website project/i, contact: /website project/i, pricing: /Starter package/ },
}];
const OTHER_PAGES = ['index.html', 'privacy-policy.html', 'terms.html', '404.html'];

const results = []; let failed = 0;
function check(name, ok, detail = '') { results.push({ name, ok }); if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); }

const procs = [];
function start(args, env = {}) {
  const p = spawn(process.execPath, args, { cwd: ROOT, env: { ...process.env, VERCEL: '', GA4_MEASUREMENT_ID: '', SPEED_INSIGHTS: '', ANALYTICS_DISABLED: '', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  p.stderr.on('data', d => { const s = String(d); if (!/\[contact\]/.test(s)) process.stderr.write(s); });
  procs.push(p); return p;
}
start(['dev/mock-email-provider.mjs', '4211']);
start(['dev/server.mjs', '4210'], { RESEND_API_KEY: 'test_key_not_real', RESEND_API_URL: 'http://localhost:4211/emails' });
start(['dev/server.mjs', '4212'], { GA4_MEASUREMENT_ID: 'G-TEST1234AB', SPEED_INSIGHTS: 'on' }); // consent checks only (local, stubbed)
async function waitUp(url) { for (let i = 0; i < 60; i++) { try { await fetch(url); return; } catch { await sleep(150); } } throw new Error('not up ' + url); }
await Promise.all(['http://localhost:4210/', 'http://localhost:4212/', 'http://localhost:4211/__received'].map(waitUp));
const S = 'http://localhost:4210', GA = 'http://localhost:4212', MOCK = 'http://localhost:4211';
const received = async () => (await fetch(`${MOCK}/__received`)).json();
const setMode = m => fetch(`${MOCK}/__mode/${m}`, { method: 'POST' });
const get = (p, base = S) => fetch(base + p, { redirect: 'manual' });
const blockNav = p => p.eval(`document.addEventListener('click', e => { const a = e.target.closest && e.target.closest('a[href]'); if (a && /^(tel:|mailto:|https:\\/\\/wa\\.me)/.test(a.getAttribute('href'))) e.preventDefault(); }, false); true`);
const STUBS = [
  { urlPattern: 'googletagmanager\\.com/gtag/js', respond: () => ({ body: 'window.__gtagLoads=(window.__gtagLoads||0)+1;' }) },
  { urlPattern: '/_vercel/speed-insights/script\\.js', respond: () => ({ body: 'window.__siLoads=(window.__siLoads||0)+1;' }) },
];
const ANALYTICS_URL = /googletagmanager\.com|google-analytics\.com|analytics\.google\.com|doubleclick\.net|_vercel\/speed-insights|vercel-insights\.com/;
const meta = (html, re) => { const m = html.match(re); return m ? m[1] : null; };
const decode = s => s.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const CLAIMS = [/\b\d+\s*\+\s*(projects|clients|businesses|customers)\b/i, /★/, /\baward/i, /#1\b/, /\bbest in\b/i, /\bleading\b/i, /\bguarantee/i, /%\s*(increase|more|growth)/i, /\btrusted by\b/i, /\btestimonial/i, /\bclient projects\b/i, /\bnot from a template\b/i];

const browser = await launch({ port: 9430 });
try {
  // ======================= A. HTTP + static checks =======================
  const otherTitles = OTHER_PAGES.map(f => decode(meta(read(f), /<title>([^<]*)<\/title>/) || ''));
  const otherDescs = OTHER_PAGES.map(f => decode(meta(read(f), /<meta name="description" content="([^"]*)"/) || ''));
  const sitemap = await (await get('/sitemap.xml')).text();
  for (const pg of PAGES) {
    const path = `/services/${pg.slug}`, canonical = PROD + path, html = read(pg.file);
    { const r = await get(path); check(`${path}: 200 text/html`, r.status === 200 && /text\/html/.test(r.headers.get('content-type') || ''), `${r.status} ${r.headers.get('content-type')}`);
      const csp = r.headers.get('content-security-policy') || '';
      check(`${path}: security headers present (CSP script-src 'self', nosniff, DENY, referrer, permissions)`, /script-src 'self' https:\/\/www\.googletagmanager\.com;/.test(csp) && /frame-ancestors 'none'/.test(csp) && r.headers.get('x-content-type-options') === 'nosniff' && r.headers.get('x-frame-options') === 'DENY' && !!r.headers.get('referrer-policy') && !!r.headers.get('permissions-policy')); }
    { const r = await get(path + '.html'); check(`${path}.html -> 308 ${path} (cleanUrls)`, r.status === 308 && r.headers.get('location') === path, `${r.status} ${r.headers.get('location')}`); }
    const title = decode(meta(html, /<title>([^<]*)<\/title>/) || '');
    const desc = decode(meta(html, /<meta name="description" content="([^"]*)"/) || '');
    check(`${path}: exactly one <title>, unique, ≤ 65 chars`, (html.match(/<title>/g) || []).length === 1 && title.length > 0 && title.length <= 65 && !otherTitles.includes(title), `${title.length}: ${title}`);
    check(`${path}: meta description unique, 70–160 chars`, desc.length >= 70 && desc.length <= 160 && !otherDescs.includes(desc), `${desc.length}`);
    check(`${path}: canonical = og:url = absolute self URL; indexable; lang en`, meta(html, /<link rel="canonical" href="([^"]*)"/) === canonical && meta(html, /<meta property="og:url" content="([^"]*)"/) === canonical &&
      /<meta name="robots" content="index, follow/.test(html) && /<html lang="en"/.test(html));
    check(`${path}: listed in sitemap.xml`, sitemap.includes(`<loc>${canonical}</loc>`));
    const scripts = [...html.matchAll(/<script\b([^>]*)>/g)].map(m => m[1]);
    check(`${path}: no inline scripts or inline event handlers (CSP)`, scripts.every(a => /\bsrc="\/assets\/js\/[a-z-]+\.js(\?v=[a-z0-9]+)?"/.test(a) || /type="application\/ld\+json"/.test(a)) && !/\son[a-z]+="/i.test(html), scripts.join(' | '));
    const resHosts = [...html.matchAll(/<(?:script|img|link)\b[^>]*\b(?:src|href)="(https?:\/\/[^"/]+)/g)].map(m => m[1]).filter(h => !/^https:\/\/www\.afra-digital\.com$/.test(h));
    check(`${path}: no third-party resources except Google Fonts`, resHosts.every(h => /^https:\/\/fonts\.(googleapis|gstatic)\.com$/.test(h)), [...new Set(resHosts)].join(', '));
    const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => m[1]);
    let graph = []; let ldOk = true; try { graph = ld.flatMap(j => JSON.parse(j)['@graph'] || []); } catch { ldOk = false; }
    const byType = t => graph.filter(n => [].concat(n['@type']).includes(t));
    const svc = byType('Service')[0], crumbs = byType('BreadcrumbList')[0], faq = byType('FAQPage')[0];
    check(`${path}: JSON-LD parses; Service provider = #organization; serviceType set`, ldOk && svc && svc.provider && svc.provider['@id'] === `${PROD}/#organization` && !!svc.serviceType && svc.url === canonical);
    check(`${path}: BreadcrumbList 1..n ends at this page`, crumbs && crumbs.itemListElement.every((it, i) => it.position === i + 1) && crumbs.itemListElement.at(-1).item === canonical);
    check(`${path}: no Review / AggregateRating / LocalBusiness / Offer markup`, !/"(Review|AggregateRating|LocalBusiness|Offer)"/.test(ld.join('')));
    pg.faqLd = faq ? faq.mainEntity.map(q => ({ q: q.name, a: q.acceptedAnswer.text })) : [];
    // service-page script must not depend on homepage-only elements
    const spjs = read('assets/js/service-page.js');
    const lookups = [...spjs.matchAll(/(?:getElementById|querySelector(?:All)?)\(\s*'([^']+)'/g)].map(m => m[1]);
    const ALLOWED = ['nav', 'nav-ghost-cta', 'hamburger', 'mob-nav', 'a[href],button', 'a[href]', 'a'];
    check('service-page.js only looks up shared header/menu elements (no homepage-only sections)', lookups.length > 0 && lookups.every(x => ALLOWED.includes(x)), lookups.join(', '));
  }
  { const r = await get('/services/does-not-exist'); check('unknown /services/* path -> 404', r.status === 404, String(r.status)); }
  { const r = await get('/services'); check('/services (no hub page in Batch 1) -> 404 locally', r.status === 404, String(r.status)); }
  { const r = await get('/assets/css/service-page.css?v=p5b1'); check('service-page.css served with the /assets cache policy and correct type', r.status === 200 && /text\/css/.test(r.headers.get('content-type') || '') && /max-age=604800/.test(r.headers.get('cache-control') || ''), r.headers.get('cache-control')); }

  // ======================= B. Homepage regression (static) =======================
  { const idx = read('index.html'), cf = read('assets/js/contact-form.js');
    const site = read('assets/js/site.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''); // code only, comments removed
    const tags = [...idx.matchAll(/<script src="([^"]+)" defer><\/script>/g)].map(m => m[1]);
    check('homepage loads analytics.js, site.js and contact-form.js (deferred, in that order; changed files versioned)',
      JSON.stringify(tags) === JSON.stringify(['/assets/js/analytics.js', '/assets/js/site.js?v=p5b1', '/assets/js/contact-form.js?v=p5b1']), tags.join(' | '));
    check('form logic lives only in contact-form.js (site.js has none; no double binding)', !/contact-form|cf-source|form-btn|generate_lead/.test(site) && /getElementById\('contact-form'\)/.test(cf) && /generate_lead/.test(cf));
    check('homepage no longer says "Alongside client projects"', !/Alongside client projects/i.test(idx));
    check('homepage Website Development card links to the service page', /data-cta="service_website_development"[\s\S]{0,700}<p class="svc-more"><a href="\/services\/website-development">Learn more about website development/.test(idx));
    check('homepage footer "Website Development" links to the service page', /<a href="\/services\/website-development">Website Development<\/a>/.test(idx));
    check('privacy policy discloses page-or-button source', /which page or button on the website you used to reach the form/.test(read('privacy-policy.html'))); }

  for (const pg of PAGES) {
    const path = `/services/${pg.slug}`;
    // ======================= C. Desktop browser checks =======================
    {
      const p = await browser.newPage({ width: 1280, height: 900 });
      await p.goto(S + path); await sleep(1200);
      const h = await p.eval(`(() => { const hs = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map(x => ({ l: +x.tagName[1], t: x.textContent.trim() }));
        let skip = false; for (let i = 1; i < hs.length; i++) if (hs[i].l > hs[i - 1].l + 1) skip = true;
        return { h1: hs.filter(x => x.l === 1).map(x => x.t), skip, empty: hs.filter(x => !x.t).length }; })()`);
      check(`${path}: exactly one H1 naming the service; no skipped heading levels; no empty headings`, h.h1.length === 1 && pg.h1Term.test(h.h1[0]) && !h.skip && h.empty === 0, JSON.stringify(h));
      // FAQ structured data matches visible FAQ text
      const vis = await p.eval(`[...document.querySelectorAll('.svp-faq details')].map(d => ({ q: d.querySelector('summary').textContent.trim(), a: d.querySelector('.svp-faq-a').textContent.trim().replace(/\\s+/g, ' ') }))`);
      check(`${path}: FAQPage JSON-LD questions and answers match the visible FAQ exactly`, pg.faqLd.length === vis.length && pg.faqLd.every((x, i) => x.q === vis[i].q && x.a === vis[i].a), `${pg.faqLd.length} vs ${vis.length}`);
      // form defaults + labels
      const f = await p.eval(`(() => { const f = document.getElementById('contact-form');
        const ctrls = [...f.querySelectorAll('input:not([type=hidden]), select, textarea')].filter(el => el.name !== 'hp');
        return { service: f.service.value, source: f.source.value, plan: f.plan.value, chip: !document.getElementById('cf-plan-chip').hidden,
          unlabelled: ctrls.filter(el => !document.querySelector('label[for="' + el.id + '"]')).map(el => el.name),
          brokenDescribedBy: ctrls.filter(el => (el.getAttribute('aria-describedby') || '').split(' ').some(id => id && !document.getElementById(id))).map(el => el.name) }; })()`);
      check(`${path}: form preselects "${pg.service}", default source "${pg.defaultSource}", no package`, f.service === pg.service && f.source === pg.defaultSource && f.plan === '' && !f.chip, JSON.stringify(f));
      check(`${path}: every visible form control has a label and valid aria-describedby`, f.unlabelled.length === 0 && f.brokenDescribedBy.length === 0, JSON.stringify(f));
      // every CTA sets its own source id (and plan where relevant)
      await p.eval(`document.documentElement.style.scrollBehavior = 'auto'; window.afraEvents.length = 0; true`);
      const ctaIds = await p.eval(`[...document.querySelectorAll('a[href="#contact"][data-cta]')].map(a => a.getAttribute('data-cta'))`);
      check(`${path}: CTA ids on the page are exactly the expected set`, JSON.stringify([...ctaIds].sort()) === JSON.stringify(Object.keys(pg.ctas).sort()), ctaIds.join(', '));
      let ctaOk = true; const ctaDetail = [];
      for (const [id, plan] of Object.entries(pg.ctas)) {
        const r = await p.eval(`(() => { document.getElementById('cf-source').value = '${pg.defaultSource}'; document.querySelector('a[data-cta="${id}"]').click();
          return { source: document.getElementById('cf-source').value, plan: document.getElementById('cf-plan').value, chip: !document.getElementById('cf-plan-chip').hidden, service: document.getElementById('cf-service').value }; })()`);
        const ok = r.source === id && r.service === pg.service && (plan ? r.plan === plan && r.chip : true);
        if (!ok) { ctaOk = false; ctaDetail.push(id + ':' + JSON.stringify(r)); }
      }
      check(`${path}: each CTA records its own source id; the pricing CTA sets the package chip`, ctaOk, ctaDetail.join(' '));
      await p.eval(`document.getElementById('cf-plan-clear').click(); true`);
      check(`${path}: removing the package chip clears the package`, await p.eval(`document.getElementById('cf-plan').value === '' && document.getElementById('cf-plan-chip').hidden`));
      const ev = await p.eval(`window.afraEvents.filter(e => e.event === 'cta_click').map(e => e.params)`);
      const hero = ev.find(e => e.cta_id === 'lp_web_hero'), price = ev.find(e => e.cta_id === 'lp_web_pricing_starter');
      check(`${path}: cta_click events carry section link_location and plan only (allow-listed)`, hero && hero.link_location === 'hero' && price && price.plan === 'Starter' && price.link_location === 'pricing' &&
        ev.every(e => Object.keys(e).every(k => ['cta_id', 'link_location', 'plan'].includes(k))), JSON.stringify(ev.slice(0, 3)));
      // WhatsApp, tel, mailto
      const wa = await p.eval(`[...document.querySelectorAll('a[href^="https://wa.me/"]')].map(a => ({ sec: (a.closest('section[id]') || {}).id || (a.id || 'chrome'), num: a.getAttribute('href').split('?')[0], text: decodeURIComponent(a.getAttribute('href').split('text=')[1] || ''), rel: a.getAttribute('rel') || '', target: a.getAttribute('target'), svc: a.getAttribute('data-wa-service'), plan: a.getAttribute('data-wa-plan') }))`);
      check(`${path}: WhatsApp links use the business number, open safely, carry no digits or personal data in the text`, wa.length >= 6 && wa.every(x => x.num === 'https://wa.me/97430029799' && /noopener/.test(x.rel) && x.target === '_blank' && x.text && !/\d|@/.test(x.text)), String(wa.length));
      const ctxOk = Object.entries(pg.waContext).every(([sec, re]) => wa.some(x => x.sec === sec && re.test(x.text)));
      check(`${path}: contextual WhatsApp messages in hero, CTA, contact and pricing (service/package attributes set)`, ctxOk && wa.filter(x => x.svc).every(x => x.svc === pg.service) && wa.some(x => x.plan === 'Starter'), JSON.stringify(wa.map(x => x.sec + ':' + x.text.slice(0, 40))));
      const contactsHere = await p.eval(`[...new Set([...document.querySelectorAll('a[href^="tel:"],a[href^="mailto:"]')].map(a => a.getAttribute('href')))].sort()`);
      check(`${path}: tel/mailto links match the homepage values`, JSON.stringify(contactsHere) === JSON.stringify(['mailto:afradigital.hello@gmail.com', 'tel:+97430029799']), contactsHere.join(', '));
      // internal links resolve
      const hrefs = await p.eval(`[...new Set([...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href')).filter(h => h.startsWith('/') || h.startsWith('#')))]`);
      const bad = [];
      for (const hr of hrefs) {
        const [pth, frag] = hr.split('#');
        if (!pth) { if (!(await p.eval(`!!document.getElementById(${JSON.stringify(frag)})`))) bad.push(hr); continue; }
        const r = await get(pth); const body = r.status === 200 ? await r.text() : '';
        if (r.status !== 200 || (frag && !new RegExp(`id="${frag}"`).test(body))) bad.push(`${hr} (${r.status})`);
      }
      check(`${path}: every internal link and anchor resolves (${hrefs.length} unique)`, bad.length === 0, bad.join(', '));
      // claims guard
      const text = await p.eval(`document.body.innerText`);
      const hits = CLAIMS.filter(re => re.test(text)).map(String);
      check(`${path}: no unsupported claims (counts, stars, awards, "leading", guarantees, client projects, testimonials)`, hits.length === 0, hits.join(' '));
      // Owner-approved wording (Batch 1 review): Launch step must match exactly.
      const launchText = await p.eval(`[...document.querySelectorAll('.svp-steps li')].find(li => li.querySelector('h3').textContent.trim() === 'Launch').querySelector('p').textContent.trim()`);
      check(`${path}: Launch step uses the owner-approved wording`, launchText === 'We test the finished website, publish it after your approval, and verify that it works as agreed.', launchText);
      // shared blocks parity with the homepage (behaviour-relevant structure)
      const sig = `(() => { const norm = h => { if (!h) return h; if (h === '/' || h === '#hero') return 'HOME'; return h.replace(/^\\/(?=#)/, ''); };
        const links = sel => [...document.querySelectorAll(sel + ' a')].map(a => a.textContent.trim().replace(/\\s+/g, ' ') + ' => ' + norm(a.getAttribute('href')));
        const f = document.getElementById('contact-form');
        const fields = [...f.querySelectorAll('input,select,textarea,button')].map(el => [el.tagName, el.name || '', el.id, el.type || '', el.required, el.tagName === 'SELECT' ? [...el.options].map(o => o.value).join('|') : '', el.getAttribute('maxlength') || '', el.getAttribute('autocomplete') || ''].join(':'));
        const labels = [...f.querySelectorAll('label')].map(l => l.textContent.trim());
        return { nav: links('#nav'), mob: links('#mob-nav'), foot: links('footer'), fields, labels, success: document.getElementById('form-success').innerText.trim(), error: document.getElementById('form-error').textContent.trim().replace(/\\s+/g, ' ') }; })()`;
      const mine = await p.eval(sig);
      const home = await browser.newPage({ width: 1280, height: 900 }); await home.goto(S + '/'); await sleep(800);
      const theirs = await home.eval(sig);
      const homeMain = await home.eval(`document.querySelector('main').innerText`);
      await home.close();
      for (const k of ['nav', 'mob', 'foot', 'fields', 'labels', 'error']) check(`${path}: shared block "${k}" matches the homepage`, JSON.stringify(mine[k]) === JSON.stringify(theirs[k]),
        JSON.stringify(mine[k]) === JSON.stringify(theirs[k]) ? '' : JSON.stringify({ only_here: mine[k].filter?.(x => !theirs[k].includes(x)), only_home: theirs[k].filter?.(x => !mine[k].includes(x)) }));
      // duplicate content: 5-gram overlap of the page's own copy (excluding the shared form and package card) with the homepage
      const ownText = await p.eval(`(() => { const m = document.querySelector('main').cloneNode(true); m.querySelectorAll('#contact, .price-card').forEach(n => n.remove()); return m.innerText; })()`);
      const grams = t => { const w = t.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean); const g = new Set(); for (let i = 0; i + 5 <= w.length; i++) g.add(w.slice(i, i + 5).join(' ')); return g; };
      const gMine = grams(ownText), gHome = grams(homeMain); let shared = 0; gMine.forEach(x => { if (gHome.has(x)) shared++; });
      const overlap = shared / Math.max(1, gMine.size);
      check(`${path}: page copy is substantially unique vs the homepage (5-gram overlap < 20%)`, overlap < 0.2, `${(overlap * 100).toFixed(1)}% of ${gMine.size} 5-grams`);
      // keyboard: skip link first, FAQ details by keyboard
      await p.goto(S + path); await sleep(800);
      await p.key('Tab', 'Tab', 9);
      check(`${path}: first Tab focuses the skip link`, await p.eval(`document.activeElement.classList.contains('skip-link')`));
      await p.eval(`document.querySelector('.svp-faq summary').focus(); true`); await p.key('Enter', 'Enter', 13); await sleep(150);
      check(`${path}: FAQ items open with the keyboard (native details/summary)`, await p.eval(`document.querySelector('.svp-faq details').open === true`));
      // contrast of body text against the page background
      const contrast = await p.eval(`(() => { const lum = c => { const v = c.match(/[\\d.]+/g).slice(0, 3).map(Number).map(x => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
        const bg = lum('rgb(2,6,23)'); const out = [];
        ['.t1', '.svp-card p', '.svp-steps p', '.svp-note', '.price-feat:not(.dim)', '.price-per', '.fl', '.foot-links a', '.foot-copy', '.svp-crumbs a', '.ci-s', '.svp-checks li', '.svp-text p', '.form-note', '.svp-related a'].forEach(sel => {
          const el = document.querySelector(sel); if (!el) { out.push({ sel, missing: true }); return; }
          const L = lum(getComputedStyle(el).color); out.push({ sel, ratio: +((Math.max(L, bg) + 0.05) / (Math.min(L, bg) + 0.05)).toFixed(2) }); });
        return out; })()`);
      check(`${path}: text contrast ≥ 4.5:1 for body copy, labels, footer and notes`, contrast.every(c => !c.missing && c.ratio >= 4.5), JSON.stringify(contrast.filter(c => c.missing || c.ratio < 4.5)));
      // layout stability and weight
      const perf = await p.eval(`new Promise(res => { let cls = 0; new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
        setTimeout(() => res({ cls: +cls.toFixed(4), bytes: performance.getEntriesByType('resource').concat(performance.getEntriesByType('navigation')).reduce((s, e) => s + (e.transferSize || 0), 0) }), 800); })`);
      const hp = await browser.newPage({ width: 1280, height: 900 }); await hp.goto(S + '/'); await sleep(1500);
      const hpBytes = await hp.eval(`performance.getEntriesByType('resource').concat(performance.getEntriesByType('navigation')).reduce((s, e) => s + (e.transferSize || 0), 0)`); await hp.close();
      check(`${path}: CLS < 0.05 and page transfer smaller than the homepage`, perf.cls < 0.05 && perf.bytes < hpBytes, `cls=${perf.cls} bytes=${perf.bytes} home=${hpBytes}`);
      const hv = await p.eval(`(() => { const v = document.querySelector('.svp-visual'), c = document.querySelector('.svp-hero-copy'), ph = document.querySelector('.svp-phone'), lg = document.querySelector('.svp-logo-lg');
        const rv = v.getBoundingClientRect(), rc = c.getBoundingClientRect();
        return { shown: getComputedStyle(v).display !== 'none', hidden: v.getAttribute('aria-hidden'), focusables: v.querySelectorAll('a,button,input,[tabindex]').length,
          clearOfCopy: rv.left >= rc.right - 1, logoClear: lg.getBoundingClientRect().left >= ph.getBoundingClientRect().right,
          anim: [getComputedStyle(document.querySelector('.svp-window')).animationName, getComputedStyle(ph).animationName, getComputedStyle(document.querySelector('.svp-orbit-2')).animationName] }; })()`);
      check(`${path}: desktop hero visual shown, decorative (aria-hidden, no focusable content), clear of the copy, logo not covered, restrained motion`,
        hv.shown && hv.hidden === 'true' && hv.focusables === 0 && hv.clearOfCopy && hv.logoClear && JSON.stringify(hv.anim) === JSON.stringify(['svpFloat', 'svpFloat', 'svpSpin']), JSON.stringify(hv));
      check(`${path}: floating WhatsApp button uses the homepage "waFloat" motion on desktop`, await p.eval(`getComputedStyle(document.getElementById('wa-float')).animationName === 'waFloat'`));
      check(`${path} desktop: no exceptions, console errors or CSP violations`, !p.log.exceptions.length && !p.log.console.filter(c => /^error/.test(c)).length && !p.log.cspViolations.length, JSON.stringify([p.log.exceptions, p.log.console, p.log.cspViolations]).slice(0, 300));
      await p.close();
    }

    // ======================= D. Reduced motion =======================
    {
      const p = await browser.newPage({ width: 1280, height: 900 });
      await p.S('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
      await p.goto(S + path); await sleep(600);
      const r = await p.eval(`(() => { const b = document.querySelector('.svp-btns .btn'); return { sb: getComputedStyle(document.documentElement).scrollBehavior, td: parseFloat(getComputedStyle(b).transitionDuration), wa: getComputedStyle(document.getElementById('wa-float')).animationName,
        hero: ['.svp-visual', '.svp-window', '.svp-phone', '.svp-orbit-2'].map(s => getComputedStyle(document.querySelector(s)).animationName).join(',') }; })()`);
      await p.eval(`document.querySelector('a[data-cta="lp_web_hero"]').click(); true`); await sleep(60);
      const jumped = await p.eval(`Math.abs(document.getElementById('contact').getBoundingClientRect().top) < 5`);
      check(`${path}: prefers-reduced-motion → no smooth scrolling, transitions effectively off, no floating or hero animation, instant jump to the form`, r.sb === 'auto' && r.td <= 0.001 && r.wa === 'none' && r.hero === 'none,none,none,none' && jumped, JSON.stringify({ ...r, jumped }));
      await p.close();
    }

    // ======================= E. Validation + delivery (mock provider) =======================
    {
      const before = (await received()).length;
      const p = await browser.newPage({ width: 1280, height: 900 });
      await p.goto(S + path); await sleep(2600); await blockNav(p);
      await p.eval(`(() => { const f = document.getElementById('contact-form'); f.firstName.value = 'Svc'; f.lastName.value = 'Pagetest'; f.email.value = 'p5-test@example.org';
        f.phone.value = ''; f.contactPref.value = 'WhatsApp'; f.message.value = 'P5 AUTOMATED TEST default ' + Date.now(); document.getElementById('form-btn').click(); return true; })()`);
      await sleep(400);
      const pv = await p.eval(`({ invalid: document.getElementById('cf-phone').getAttribute('aria-invalid'), msg: document.getElementById('cf-phone-err').textContent, focus: document.activeElement.id })`);
      const posts0 = p.log.requests.filter(r => r.url.endsWith('/api/contact') && r.method === 'POST').length;
      check(`${path}: WhatsApp preference without a phone → phone error, focus on phone, nothing sent`, pv.invalid === 'true' && /phone number so we can contact you/.test(pv.msg) && pv.focus === 'cf-phone' && posts0 === 0, JSON.stringify(pv));
      await p.eval(`(() => { const f = document.getElementById('contact-form'); f.contactPref.value = 'Email'; f.contactPref.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`); await sleep(100);
      check(`${path}: switching to Email clears the phone error`, await p.eval(`document.getElementById('cf-phone').getAttribute('aria-invalid') === null`));
      await p.eval(`(() => { window.afraEvents.length = 0; const b = document.getElementById('form-btn'); b.click(); b.click(); return true; })()`);
      await sleep(2000);
      const done = await p.eval(`({ success: !document.getElementById('form-success').hidden, ref: document.getElementById('form-ref').hidden ? null : document.getElementById('form-ref-code').textContent, events: window.afraEvents.map(e => ({ e: e.event, p: e.params })) })`);
      const got = (await received()).slice(before); const pl = got[0] && got[0].payload;
      check(`${path}: default submission → exactly one email; reference shown only after acceptance and matches the subject`, done.success && got.length === 1 && /^AFRA-[2-9A-HJ-NP-Z]{6}$/.test(done.ref || '') && pl.subject.startsWith(`Website enquiry [${done.ref}]: ${pg.service} — Svc Pagetest`), JSON.stringify({ ref: done.ref, n: got.length, subject: pl && pl.subject }));
      check(`${path}: email records the page source "${pg.defaultSource}", no package, preferred contact`, pl && pl.text.includes(`Source:    website button "${pg.defaultSource}"`) && pl.text.includes('Package:  —') && pl.text.includes('Preferred contact: Email') && pl.text.includes(`Reference: ${done.ref}`), pl && pl.text.split('\n').slice(2, 14).join(' | '));
      const lead = done.events.filter(x => x.e === 'generate_lead');
      check(`${path}: exactly one generate_lead {form_id, method, service, plan:none}; no personal data or reference in events`, lead.length === 1 && JSON.stringify(lead[0].p) === JSON.stringify({ form_id: 'contact', method: 'contact_form', service: pg.service, plan: 'none' }) && !/AFRA-|p5-test|Pagetest|Svc"/.test(JSON.stringify(done.events)), JSON.stringify(lead));
      await p.close();
    }
    {
      const before = (await received()).length;
      const p = await browser.newPage({ width: 1280, height: 900 });
      await p.goto(S + path); await sleep(600); await blockNav(p);
      await p.eval(`document.documentElement.style.scrollBehavior = 'auto'; document.querySelector('a[data-cta="lp_web_pricing_starter"]').click(); true`); await sleep(2200);
      await p.eval(`(() => { const f = document.getElementById('contact-form'); f.firstName.value = 'Svc'; f.lastName.value = 'Starter'; f.email.value = 'p5-starter@example.org';
        f.budget.value = 'Under QAR 10,000'; f.timeline.value = 'Within 1–3 months'; f.message.value = 'P5 AUTOMATED TEST starter ' + Date.now(); window.afraEvents.length = 0; document.getElementById('form-btn').click(); return true; })()`);
      await sleep(2000);
      const done = await p.eval(`({ success: !document.getElementById('form-success').hidden, ref: document.getElementById('form-ref-code').textContent, lead: window.afraEvents.filter(e => e.event === 'generate_lead').map(e => e.params) })`);
      const got = (await received()).slice(before); const pl = got[0] && got[0].payload;
      check(`${path}: pricing CTA submission → email has Package Starter, source lp_web_pricing_starter, budget and timeline`, done.success && got.length === 1 && pl.text.includes('Package:  Starter') && pl.text.includes('Source:    website button "lp_web_pricing_starter"') && pl.text.includes('Budget:   Under QAR 10,000') && pl.text.includes('Timeline: Within 1–3 months'), pl && pl.text.split('\n').slice(2, 14).join(' | '));
      check(`${path}: generate_lead carries plan Starter`, done.lead.length === 1 && done.lead[0].plan === 'Starter' && done.lead[0].service === pg.service, JSON.stringify(done.lead));
      await p.close();
    }
    {
      await setMode('fail');
      const p = await browser.newPage({ width: 1280, height: 900 });
      await p.goto(S + path); await sleep(2600); await blockNav(p);
      await p.eval(`(() => { const f = document.getElementById('contact-form'); f.firstName.value = 'Svc'; f.lastName.value = 'Failure'; f.email.value = 'p5-fail@example.org'; f.message.value = 'P5 AUTOMATED TEST failure ' + Date.now(); window.afraEvents.length = 0; document.getElementById('form-btn').click(); return true; })()`);
      await sleep(4000);
      const r = await p.eval(`({ success: !document.getElementById('form-success').hidden, ref: !document.getElementById('form-ref').hidden, error: document.getElementById('form-error').hidden ? '' : document.getElementById('form-error-msg').textContent, kept: document.getElementById('contact-form').email.value, lead: window.afraEvents.filter(e => e.event === 'generate_lead').length })`);
      check(`${path}: provider failure → honest error, no success, no reference, input kept, no generate_lead`, !r.success && !r.ref && /could not be sent|try again|WhatsApp/i.test(r.error) && r.kept === 'p5-fail@example.org' && r.lead === 0, JSON.stringify(r));
      await setMode('success');
      await p.close();
    }

    // ======================= F. Consent / analytics privacy (local server with a TEST GA4 id, stubbed) =======================
    {
      const p = await browser.newPage({ width: 1280, height: 900, intercept: STUBS });
      await p.goto(GA + path); await sleep(1500);
      const b = await p.eval(`(() => { const x = document.getElementById('afra-consent'); return x ? { text: x.textContent, role: x.getAttribute('role') } : null; })()`);
      const hits = () => (p.log.intercepted || []).concat(p.log.requests.filter(r => ANALYTICS_URL.test(r.url)));
      check(`${path}: first visit shows the consent banner; zero analytics requests and no gtag before a choice`, b && b.role === 'dialog' && /Google Analytics/.test(b.text) && hits().length === 0 && await p.eval(`typeof window.gtag === 'undefined'`), JSON.stringify({ banner: !!b, hits: hits().length }));
      await p.eval(`document.querySelector('#afra-consent [data-consent="reject"]').click(); true`); await sleep(500);
      check(`${path}: Reject → banner closes, still zero analytics requests`, !(await p.eval(`!!document.getElementById('afra-consent')`)) && hits().length === 0);
      await p.eval(`document.querySelector('[data-cookie-settings]').click(); true`); await sleep(500);
      check(`${path}: footer "Cookie settings" reopens the choices`, await p.eval(`!!document.getElementById('afra-consent')`));
      check(`${path} (consent run): no exceptions or CSP violations`, !p.log.exceptions.length && !p.log.cspViolations.length, JSON.stringify([p.log.exceptions, p.log.cspViolations]).slice(0, 300));
      await p.close();
      const cfg = await (await get('/api/analytics-config')).json();
      check('default local server (as production): GA4 not configured', cfg.ga4 === null, JSON.stringify(cfg));
    }

    // ======================= G. Mobile + responsive =======================
    {
      const p = await browser.newPage({ width: 390, height: 844, mobile: true });
      await p.goto(S + path); await sleep(1200);
      const m = await p.eval(`(() => { const r = el => el.getBoundingClientRect(); const vis = el => el && el.offsetWidth > 0;
        const small = [...document.querySelectorAll('.svp-btns .btn, #form-btn, .price-card .btn-full, #hamburger, .nav-right .btn-prime, .svp-related a')].filter(vis).filter(el => r(el).height < 44).map(el => el.textContent.trim().slice(0, 20) || el.id);
        return { sw: document.documentElement.scrollWidth, vw: innerWidth, hamburger: vis(document.getElementById('hamburger')), navLinksHidden: !vis(document.querySelector('.nav-links')), small, waAnim: getComputedStyle(document.getElementById('wa-float')).animationName,
          heroVisual: getComputedStyle(document.querySelector('.svp-visual')).display, logoFetched: performance.getEntriesByType('resource').filter(e => /afra-logo-384/.test(e.name)).length }; })()`);
      check(`${path} 390×844: no horizontal scroll, hamburger shown, desktop links hidden, touch targets ≥ 44px, no floating animation on phones (as homepage)`, m.sw <= m.vw && m.hamburger && m.navLinksHidden && m.small.length === 0 && m.waAnim === 'none', JSON.stringify(m));
      check(`${path} 390×844: hero visual not rendered on phones and its logo image not downloaded`, m.heroVisual === 'none' && m.logoFetched === 0, JSON.stringify({ heroVisual: m.heroVisual, logoFetched: m.logoFetched }));
      await p.eval(`document.getElementById('hamburger').focus(); true`); await p.key('Enter', 'Enter', 13); await sleep(450);
      const menu = await p.eval(`({ open: document.getElementById('hamburger').getAttribute('aria-expanded'), items: [...document.querySelectorAll('#mob-nav a')].map(a => a.textContent.trim()) })`);
      check(`${path}: mobile menu opens by keyboard with WhatsApp, Call and "Start Your Project →"`, menu.open === 'true' && menu.items.includes('WhatsApp us') && menu.items.includes('Call +974 3002 9799') && menu.items.at(-1) === 'Start Your Project →', menu.items.join(' | '));
      let reachedCall = false;
      for (let i = 0; i < 14 && !reachedCall; i++) { await p.key('Tab', 'Tab', 9); reachedCall = await p.eval(`document.activeElement && document.activeElement.getAttribute('href') === 'tel:+97430029799'`); }
      check(`${path}: mobile menu items reachable by keyboard (focus trap)`, reachedCall);
      await p.key('Escape', 'Escape', 27); await sleep(400);
      check(`${path}: Escape closes the mobile menu and returns focus to the button`, await p.eval(`document.getElementById('hamburger').getAttribute('aria-expanded') === 'false' && document.activeElement.id === 'hamburger'`));
      await p.eval(`document.getElementById('hamburger').click(); true`); await sleep(400);
      await p.eval(`document.querySelector('#mob-nav a[data-cta="lp_web_mobile_menu"]').click(); true`); await sleep(2200); // smooth scroll on a long page takes ~1.5 s
      check(`${path}: mobile menu "Start Your Project" closes the menu, jumps to the form and records its source`, await p.eval(`!document.getElementById('mob-nav').classList.contains('open') && document.getElementById('cf-source').value === 'lp_web_mobile_menu' && Math.abs(document.getElementById('contact').getBoundingClientRect().top) < 40`));
      check(`${path} mobile: no exceptions, console errors or CSP violations`, !p.log.exceptions.length && !p.log.console.filter(c => /^error/.test(c)).length && !p.log.cspViolations.length, JSON.stringify([p.log.exceptions, p.log.console, p.log.cspViolations]).slice(0, 300));
      await p.close();
    }
    {
      const bad = [];
      for (const w of [320, 360, 375, 390, 414, 480, 768, 769, 820, 1024, 1100, 1280, 1440, 1920]) {
        const mobile = w <= 1024;
        const p = await browser.newPage({ width: w, height: w === 320 ? 568 : 900, mobile });
        await p.goto(S + path); await sleep(500);
        const r = await p.eval(`(() => { const vw = innerWidth; const nav = document.querySelector('.nav-inner');
          const clipped = [...nav.querySelectorAll('a,button')].filter(el => el.offsetWidth > 0).filter(el => { const b = el.getBoundingClientRect(); return b.right > vw + 0.5 || b.left < -0.5; }).length;
          const btn = document.getElementById('form-btn').getBoundingClientRect();
          return { sw: document.documentElement.scrollWidth, vw, clipped, navH: Math.round(document.getElementById('nav').getBoundingClientRect().height), formBtnFits: btn.left >= 0 && btn.right <= vw }; })()`);
        if (r.sw > r.vw || r.clipped || !r.formBtnFits || r.navH > 130) bad.push(`${w}:${JSON.stringify(r)}`);
        await p.close();
      }
      check(`${path}: 14 widths 320–1920 — no horizontal scroll, header controls not clipped, form button fits (320×568 included)`, bad.length === 0, bad.join(' '));
    }
    {
      // Header renders like the homepage's (same height, logo mark and wordmark size) at each breakpoint.
      const diffs = [];
      const hdr = `(() => { const m = document.querySelector('#nav .nav-mark'), l = document.querySelector('#nav .nav-logo'), b = document.querySelector('#nav .nav-right .btn-prime');
        return { navH: Math.round(document.getElementById('nav').getBoundingClientRect().height), mark: Math.round(m.getBoundingClientRect().width), font: getComputedStyle(l).fontSize, ham: getComputedStyle(document.getElementById('hamburger')).display, links: getComputedStyle(document.querySelector('.nav-links')).display, btnFont: getComputedStyle(b).fontSize }; })()`;
      for (const w of [320, 390, 768, 900, 1024, 1100, 1180, 1280, 1440]) {
        const mobile = w <= 1024, out = [];
        for (const url of [S + '/', S + path]) { const p = await browser.newPage({ width: w, height: 900, mobile }); await p.goto(url); await sleep(500); out.push(await p.eval(hdr)); await p.close(); }
        const [a, b] = out; delete a.navH; delete b.navH; // the service page's taller mobile "Start Project" touch target may change nav height by a few px
        if (JSON.stringify(a) !== JSON.stringify(b)) diffs.push(`${w}: home=${JSON.stringify(a)} page=${JSON.stringify(b)}`);
      }
      check(`${path}: header matches the homepage at 9 widths (logo mark, wordmark size, nav links vs hamburger, button text)`, diffs.length === 0, diffs.join(' '));
    }
  }

  // ======================= H. Homepage attribution still works through the shared module =======================
  {
    const p = await browser.newPage({ width: 1280, height: 900 });
    await p.goto(S + '/'); await sleep(1000);
    const r = await p.eval(`(() => { document.documentElement.style.scrollBehavior = 'auto'; document.querySelector('a[data-cta="service_website_development"]').click();
      const a = { source: document.getElementById('cf-source').value, service: document.getElementById('cf-service').value };
      document.querySelector('a[data-plan="Enterprise"]').click(); a.plan = document.getElementById('cf-plan').value; a.src2 = document.getElementById('cf-source').value; return a; })()`);
    check('homepage: CTA context capture (service, package, source) still works via contact-form.js', r.source === 'service_website_development' && r.service === 'Website Development' && r.plan === 'Enterprise' && r.src2 === 'pricing_enterprise', JSON.stringify(r));
    const fresh = await browser.newPage({ width: 1280, height: 900 }); await fresh.goto(S + '/'); await sleep(800);
    check('homepage: fresh load has no preselected service and an empty source', await fresh.eval(`document.getElementById('cf-service').value === '' && document.getElementById('cf-source').value === ''`));
    const learn = await fresh.eval(`(() => { const a = document.querySelector('.svc-more a'); return a ? { href: a.getAttribute('href'), visible: a.offsetWidth > 0 } : null; })()`);
    check('homepage: "Learn more about website development" link visible on the card', learn && learn.href === '/services/website-development' && learn.visible, JSON.stringify(learn));
    check('homepage: no exceptions, console errors or CSP violations', !p.log.exceptions.length && !fresh.log.exceptions.length && !p.log.cspViolations.length && !fresh.log.cspViolations.length && !fresh.log.console.filter(c => /^error/.test(c)).length, JSON.stringify([p.log.exceptions, fresh.log.exceptions, fresh.log.console]).slice(0, 300));
    await fresh.close(); await p.close();
    // Homepage header "Start Project": 44px touch target on phones; header height and tablet/desktop unchanged.
    const hdr = [];
    for (const [w, expectH, expectNav] of [[320, 44, 75], [360, 44, 75], [390, 44, 75], [414, 44, 75], [768, 44, 75], [769, null, 85], [1024, null, 85], [1280, null, 105]]) {
      const q = await browser.newPage({ width: w, height: 800, mobile: w <= 1024 }); await q.goto(S + '/'); await sleep(600);
      const r = await q.eval(`({ btnH: +document.querySelector('#nav .nav-right .btn-prime').getBoundingClientRect().height.toFixed(1), navH: Math.round(document.getElementById('nav').getBoundingClientRect().height), sw: document.documentElement.scrollWidth, vw: innerWidth })`);
      await q.close();
      const ok = (expectH === null ? r.btnH < 44 && r.btnH > 30 : r.btnH >= expectH) && r.navH === expectNav && r.sw <= r.vw;
      if (!ok) hdr.push(`${w}:${JSON.stringify(r)}`);
    }
    check('homepage: header "Start Project" is ≥ 44px on phones (≤768), header height unchanged (75/85/105), tablet/desktop button unchanged', hdr.length === 0, hdr.join(' '));
  }
} catch (err) {
  check('harness error', false, err.stack);
} finally {
  await browser.close();
  procs.forEach(p => p.kill());
}
console.log(`\n${results.length - failed}/${results.length} service-page checks passed`);
process.exit(failed ? 1 : 0);
