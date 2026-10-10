// Phase 05 Batch 2 — /services hub page: end-to-end checks.
// Covers routing (clean URL, trailing slash), metadata, structured data, sitemap, service cards and their
// destinations, links between the hub and /services/website-development, form attribution for every CTA,
// shared header/menu/form/footer parity with the homepage, consent, claims guard, keyboard and focus,
// reduced motion, mobile layout and 14 widths. The form is NEVER submitted (attribution is checked in the
// form state only), so no request reaches /api/contact and no email (not even a mock one) is produced.
// Usage: node tests/services-hub.e2e.mjs
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { launch, sleep } from './lib/cdp.mjs';

const ROOT = new URL('..', import.meta.url);
const read = f => readFileSync(new URL(f, ROOT), 'utf8');
const PROD = 'https://www.afra-digital.com';
const PATH = '/services', CANONICAL = PROD + PATH, FILE = 'services/index.html';

// Cards on the hub, in order: [name, form service value, destination]. Only Website Development has a page.
const CARDS = [
  ['Website Design & Development', 'Website Development', '/services/website-development'],
  ['E-Commerce', 'E-Commerce Development', '#contact'],
  ['Web Applications', 'Web Applications', '#contact'],
  ['Custom Software', 'Custom Software', '#contact'],
  ['SaaS Development', 'SaaS Development', '#contact'],
  ['Mobile Apps', 'Mobile App Development', '#contact'],
  ['AI Solutions', 'AI Solutions', '#contact'],
  ['Business Automation', 'Business Automation', '#contact'],
  ['Digital Transformation', 'Digital Transformation', '#contact'],
  ['UI/UX Design', 'UI/UX Design', '#contact'],
  ['Branding', 'Branding', '#contact'],
  ['Digital Marketing', 'Digital Marketing', '#contact'],
];
const CTAS = ['lp_hub_nav', 'lp_hub_mobile_menu', 'lp_hub_hero', 'lp_hub_final', 'lp_hub_e_commerce', 'lp_hub_web_applications', 'lp_hub_custom_software', 'lp_hub_saas_development',
  'lp_hub_mobile_apps', 'lp_hub_ai_solutions', 'lp_hub_business_automation', 'lp_hub_digital_transformation', 'lp_hub_ui_ux_design', 'lp_hub_branding', 'lp_hub_digital_marketing'];
const OTHER_PAGES = ['index.html', 'services/website-development.html', 'privacy-policy.html', 'terms.html', '404.html'];

const results = []; let failed = 0;
function check(name, ok, detail = '') { results.push({ name, ok }); if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); }

const procs = [];
function start(args, env = {}) {
  const p = spawn(process.execPath, args, { cwd: ROOT, env: { ...process.env, VERCEL: '', GA4_MEASUREMENT_ID: '', SPEED_INSIGHTS: '', ANALYTICS_DISABLED: '', RESEND_API_KEY: '', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  p.stderr.on('data', d => process.stderr.write(String(d)));
  procs.push(p); return p;
}
start(['dev/server.mjs', '4220']);
start(['dev/server.mjs', '4222'], { GA4_MEASUREMENT_ID: 'G-TEST1234AB', SPEED_INSIGHTS: 'on' }); // consent checks only (local, stubbed)
async function waitUp(url) { for (let i = 0; i < 60; i++) { try { await fetch(url); return; } catch { await sleep(150); } } throw new Error('not up ' + url); }
await Promise.all(['http://localhost:4220/', 'http://localhost:4222/'].map(waitUp));
const S = 'http://localhost:4220', GA = 'http://localhost:4222';
const get = (p, base = S) => fetch(base + p, { redirect: 'manual' });
const STUBS = [
  { urlPattern: 'googletagmanager\\.com/gtag/js', respond: () => ({ body: 'window.__gtagLoads=(window.__gtagLoads||0)+1;' }) },
  { urlPattern: '/_vercel/speed-insights/script\\.js', respond: () => ({ body: 'window.__siLoads=(window.__siLoads||0)+1;' }) },
];
const ANALYTICS_URL = /googletagmanager\.com|google-analytics\.com|analytics\.google\.com|doubleclick\.net|_vercel\/speed-insights|vercel-insights\.com/;
const meta = (html, re) => { const m = html.match(re); return m ? m[1] : null; };
const decode = s => s.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const CLAIMS = [/\b\d+\s*\+\s*(projects|clients|businesses|customers)\b/i, /★/, /\baward/i, /#1\b/, /\bbest in\b/i, /\bleading\b/i, /\bguarantee/i, /%\s*(increase|more|growth)/i, /\btrusted by\b/i, /\btestimonial/i, /\bclient projects\b/i, /\breviews?\b/i, /\brated\b/i, /\bcase stud/i];
const RETIRED = [/24 hours/i, /2[–-]3 weeks/i, /8[–-]16 weeks/i, /full Arabic/i, /Arabic RTL/i];
const noErrors = p => !p.log.exceptions.length && !p.log.console.filter(c => /^error/.test(c)).length && !p.log.cspViolations.length && !p.log.responses.filter(r => r.status >= 400).length;
const errDetail = p => JSON.stringify([p.log.exceptions, p.log.console, p.log.cspViolations, p.log.responses.filter(r => r.status >= 400).map(r => r.status + ' ' + r.url)]).slice(0, 400);
const browser = await launch({ port: 9440 });
try {
  // ======================= A. HTTP + static checks =======================
  const html = read(FILE);
  { const r = await get(PATH); const csp = r.headers.get('content-security-policy') || '';
    check(`${PATH}: 200 text/html with the site security headers`, r.status === 200 && /text\/html/.test(r.headers.get('content-type') || '') && /script-src 'self' https:\/\/www\.googletagmanager\.com;/.test(csp) && /frame-ancestors 'none'/.test(csp) &&
      r.headers.get('x-content-type-options') === 'nosniff' && r.headers.get('x-frame-options') === 'DENY' && !!r.headers.get('referrer-policy') && !!r.headers.get('permissions-policy'), `${r.status} ${r.headers.get('content-type')}`);
    const body = await r.text(); check(`${PATH}: serves services/index.html`, body === html); }
  { const r = await get(PATH + '/'); check(`${PATH}/ -> 308 ${PATH} (trailingSlash: false)`, r.status === 308 && r.headers.get('location') === PATH, `${r.status} ${r.headers.get('location')}`); }
  { const r = await get(PATH + '/index.html'); check(`${PATH}/index.html -> 308 ${PATH} (cleanUrls)`, r.status === 308 && r.headers.get('location') === PATH, `${r.status} ${r.headers.get('location')}`); }
  { const r = await get('/services/website-development'); check('/services/website-development still 200', r.status === 200, String(r.status)); }
  { const r = await get('/services/web-applications'); check('no page exists for services without one (e.g. /services/web-applications -> 404)', r.status === 404, String(r.status)); }
  const otherTitles = OTHER_PAGES.map(f => decode(meta(read(f), /<title>([^<]*)<\/title>/) || ''));
  const otherDescs = OTHER_PAGES.map(f => decode(meta(read(f), /<meta name="description" content="([^"]*)"/) || ''));
  const title = decode(meta(html, /<title>([^<]*)<\/title>/) || ''), desc = decode(meta(html, /<meta name="description" content="([^"]*)"/) || '');
  check(`${PATH}: exactly one <title>, unique, ≤ 65 chars`, (html.match(/<title>/g) || []).length === 1 && title === 'Digital Services in Qatar & the GCC | AFRA DIGITAL' && title.length <= 65 && !otherTitles.includes(title), `${title.length}: ${title}`);
  check(`${PATH}: meta description unique, 70–160 chars`, desc.length >= 70 && desc.length <= 160 && !otherDescs.includes(desc), `${desc.length}`);
  check(`${PATH}: canonical = og:url = ${CANONICAL} (no trailing slash, matches the served URL); indexable; lang en`, meta(html, /<link rel="canonical" href="([^"]*)"/) === CANONICAL && meta(html, /<meta property="og:url" content="([^"]*)"/) === CANONICAL &&
    /<meta name="robots" content="index, follow/.test(html) && /<html lang="en"/.test(html));
  const sitemap = await (await get('/sitemap.xml')).text(); const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
  check('sitemap.xml lists /services exactly once, no duplicate URLs, no trailing-slash variant', locs.filter(l => l === CANONICAL).length === 1 && new Set(locs).size === locs.length && !locs.includes(CANONICAL + '/'), locs.join(' '));
  { const bad = []; for (const l of locs) { const r = await get(l.replace(PROD, '')); if (r.status !== 200) bad.push(`${l} ${r.status}`); } check('every sitemap URL returns 200 locally', bad.length === 0, bad.join(', ')); }
  const scripts = [...html.matchAll(/<script\b([^>]*)>/g)].map(m => m[1]);
  check(`${PATH}: no inline scripts or inline event handlers (CSP)`, scripts.every(a => /\bsrc="\/assets\/js\/[a-z-]+\.js(\?v=[a-z0-9]+)?"/.test(a) || /type="application\/ld\+json"/.test(a)) && !/\son[a-z]+="/i.test(html), scripts.join(' | '));
  const resHosts = [...html.matchAll(/<(?:script|img|link)\b[^>]*\b(?:src|href)="(https?:\/\/[^"/]+)/g)].map(m => m[1]).filter(h => !/^https:\/\/www\.afra-digital\.com$/.test(h));
  check(`${PATH}: no third-party resources except Google Fonts`, resHosts.every(h => /^https:\/\/fonts\.(googleapis|gstatic)\.com$/.test(h)), [...new Set(resHosts)].join(', '));
  const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => m[1]);
  let graph = []; let ldOk = true; try { graph = ld.flatMap(j => JSON.parse(j)['@graph'] || []); } catch { ldOk = false; }
  const byType = t => graph.filter(n => [].concat(n['@type']).includes(t));
  const crumbs = byType('BreadcrumbList')[0], page = byType('CollectionPage')[0];
  check(`${PATH}: JSON-LD parses; BreadcrumbList Home > Services ends at this page`, ldOk && crumbs && crumbs.itemListElement.length === 2 && crumbs.itemListElement.every((it, i) => it.position === i + 1) && crumbs.itemListElement[1].item === CANONICAL);
  check(`${PATH}: CollectionPage url = canonical; hasPart lists only existing pages (website-development)`, page && page.url === CANONICAL && JSON.stringify(page.hasPart.map(x => x.url)) === JSON.stringify([PROD + '/services/website-development']));
  check(`${PATH}: no Review / AggregateRating / LocalBusiness / Offer / FAQPage / Service markup (not supported by this page's content)`, !/"(Review|AggregateRating|LocalBusiness|Offer|FAQPage|Service)"/.test(ld.join('')));
  { const wd = read('services/website-development.html');
    check('website-development: breadcrumb "Services" and "All services" link to /services; its BreadcrumbList item 2 = /services',
      /<li><a href="\/services">Services<\/a><\/li>/.test(wd) && /<a href="\/services">All services/.test(wd) && wd.includes(`{ "@type": "ListItem", "position": 2, "name": "Services", "item": "${CANONICAL}" }`)); }
  { const r = await get('/assets/css/service-page.css?v=p5b3'); const css = await r.text();
    check('hub stylesheet version p5b3 served (adds the .svh-* rules) with the /assets cache policy', r.status === 200 && /max-age=604800/.test(r.headers.get('cache-control') || '') && /\.svh-card\{/.test(css) && /service-page\.css\?v=p5b3/.test(html)); }

  // ======================= B. Desktop browser checks =======================
  {
    const p = await browser.newPage({ width: 1440, height: 900 });
    await p.goto(S + PATH); await sleep(1200);
    const h = await p.eval(`(() => { const hs = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map(x => ({ l: +x.tagName[1], t: x.textContent.trim() }));
      let skip = false; for (let i = 1; i < hs.length; i++) if (hs[i].l > hs[i - 1].l + 1) skip = true;
      return { h1: hs.filter(x => x.l === 1).map(x => x.t), skip, empty: hs.filter(x => !x.t).length }; })()`);
    check(`${PATH}: exactly one H1 ("Digital Services … Qatar …"); no skipped heading levels; no empty headings`, h.h1.length === 1 && /^Digital Services for Businesses in Qatar and the GCC$/.test(h.h1[0]) && !h.skip && h.empty === 0, JSON.stringify(h));
    // cards
    const cards = await p.eval(`[...document.querySelectorAll('.svh-card')].map(c => { const a = c.querySelector('a.svh-link'); return { name: c.querySelector('h4').textContent.trim(), status: c.querySelector('.svh-status').textContent.trim(),
      href: a.getAttribute('href'), service: a.getAttribute('data-service'), cta: a.getAttribute('data-cta'), label: a.textContent.trim(), group: c.closest('.svh-group').querySelector('.svh-group-h').textContent.trim(), text: c.querySelector('p').textContent.trim() }; })`);
    check(`${PATH}: 12 service cards in the expected order, in 4 groups`, JSON.stringify(cards.map(c => c.name)) === JSON.stringify(CARDS.map(c => c[0])) && new Set(cards.map(c => c.group)).size === 4, cards.map(c => c.name).join(' | '));
    const wdCard = cards[0];
    check(`${PATH}: Website Design & Development card links to /services/website-development, labelled "Service page"`, wdCard.href === '/services/website-development' && wdCard.status === 'Service page' && /website design and development/i.test(wdCard.label) && !wdCard.cta, JSON.stringify(wdCard));
    const others = cards.slice(1);
    check(`${PATH}: the other 11 cards are labelled "Enquire" and open the form here (no link to a page that does not exist)`, others.every((c, i) => c.status === 'Enquire' && c.href === '#contact' && c.service === CARDS[i + 1][1] && /^Discuss /.test(c.label)) && cards.filter(c => c.status === 'Service page').length === 1, JSON.stringify(others.filter((c, i) => !(c.status === 'Enquire' && c.href === '#contact' && c.service === CARDS[i + 1][1]))));
    const options = await p.eval(`[...document.getElementById('cf-service').options].map(o => o.value)`);
    check(`${PATH}: every card's service exists in the form's service list`, cards.every(c => !c.service || options.includes(c.service)) && options.includes('Website Development'), options.join('|'));
    const homeSvc = await (async () => { const hp = await browser.newPage({ width: 1280, height: 900 }); await hp.goto(S + '/'); await sleep(600); const x = await hp.eval(`[...document.querySelectorAll('.svc-card a.svc-link')].map(a => a.getAttribute('data-service'))`); await hp.close(); return x; })();
    check(`${PATH}: the hub covers exactly the homepage's 12 services (no new or dropped service)`, JSON.stringify([...homeSvc].sort()) === JSON.stringify(CARDS.map(c => c[1]).sort()), homeSvc.join('|'));
    check(`${PATH}: E-Commerce card keeps the approved RTL qualification`, cards[1].text.includes('Arabic and right-to-left (RTL) support can be discussed during project scoping and confirmed in the proposal.'), cards[1].text);
    // form defaults
    const f = await p.eval(`(() => { const f = document.getElementById('contact-form'); const ctrls = [...f.querySelectorAll('input:not([type=hidden]), select, textarea')].filter(el => el.name !== 'hp');
      return { service: f.service.value, source: f.source.value, plan: f.plan.value, action: f.getAttribute('action'), method: f.getAttribute('method'), hp: !!f.querySelector('input[name=hp]'), elapsed: !!f.querySelector('input[name=elapsed]'),
        privacy: !!f.querySelector('.form-note a[href="/privacy-policy"]'), unlabelled: ctrls.filter(el => !document.querySelector('label[for="' + el.id + '"]')).map(el => el.name) }; })()`);
    check(`${PATH}: form uses the existing flow (POST /api/contact, honeypot, timing field, privacy link); no service preselected; default source "lp_hub_form"`,
      f.action === '/api/contact' && f.method === 'post' && f.hp && f.elapsed && f.privacy && f.service === '' && f.source === 'lp_hub_form' && f.plan === '' && f.unlabelled.length === 0, JSON.stringify(f));
    // CTA attribution
    await p.eval(`document.documentElement.style.scrollBehavior = 'auto'; true`);
    const ctaIds = await p.eval(`[...document.querySelectorAll('a[href="#contact"][data-cta]')].map(a => a.getAttribute('data-cta'))`);
    check(`${PATH}: CTA ids are exactly the expected 15 (nav, menu, hero, final, 11 cards)`, JSON.stringify([...ctaIds].sort()) === JSON.stringify([...CTAS].sort()), ctaIds.join(', '));
    const bad = [];
    for (const id of CTAS) {
      const r = await p.eval(`(() => { const f = document.getElementById('contact-form'); f.source.value = 'lp_hub_form'; f.service.value = ''; const a = document.querySelector('a[data-cta="${id}"]'); a.click();
        return { source: f.source.value, service: f.service.value, want: a.getAttribute('data-service') || '' }; })()`);
      if (r.source !== id || r.service !== r.want) bad.push(`${id}:${JSON.stringify(r)}`);
    }
    check(`${PATH}: each CTA records its own source id; card CTAs preselect their service`, bad.length === 0, bad.join(' '));
    check(`${PATH}: no request to /api/contact was made (form never submitted)`, p.log.requests.filter(r => /\/api\/contact/.test(r.url)).length === 0);
    // WhatsApp, tel, mailto
    const wa = await p.eval(`[...document.querySelectorAll('a[href^="https://wa.me/"]')].map(a => ({ num: a.getAttribute('href').split('?')[0], text: decodeURIComponent(a.getAttribute('href').split('text=')[1] || ''), rel: a.getAttribute('rel') || '', target: a.getAttribute('target') }))`);
    check(`${PATH}: WhatsApp links use the business number, open safely, carry no digits or personal data`, wa.length >= 5 && wa.every(x => x.num === 'https://wa.me/97430029799' && /noopener/.test(x.rel) && x.target === '_blank' && x.text && !/\d|@/.test(x.text)), String(wa.length));
    const contacts = await p.eval(`[...new Set([...document.querySelectorAll('a[href^="tel:"],a[href^="mailto:"]')].map(a => a.getAttribute('href')))].sort()`);
    check(`${PATH}: tel/mailto links match the homepage values`, JSON.stringify(contacts) === JSON.stringify(['mailto:afradigital.hello@gmail.com', 'tel:+97430029799']), contacts.join(', '));
    // internal links resolve
    const hrefs = await p.eval(`[...new Set([...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href')).filter(h => h.startsWith('/') || h.startsWith('#')))]`);
    const broken = [];
    for (const hr of hrefs) {
      const [pth, frag] = hr.split('#');
      if (!pth) { if (!(await p.eval(`!!document.getElementById(${JSON.stringify(frag)})`))) broken.push(hr); continue; }
      const r = await get(pth); const body = r.status === 200 ? await r.text() : '';
      if (r.status !== 200 || (frag && !new RegExp(`id="${frag}"`).test(body))) broken.push(`${hr} (${r.status})`);
    }
    check(`${PATH}: every internal link and anchor resolves (${hrefs.length} unique)`, broken.length === 0, broken.join(', '));
    check(`${PATH}: links to /services/website-development, /#pricing and the privacy policy`, ['/services/website-development', '/#pricing', '/privacy-policy', '/terms'].every(x => hrefs.includes(x)), hrefs.join(' '));
    // claims and retired wording
    const text = await p.eval(`document.body.innerText`), all = await p.eval(`document.documentElement.textContent`);
    const hits = CLAIMS.filter(re => re.test(text)).map(String);
    check(`${PATH}: no unsupported claims (counts, stars, awards, "leading", guarantees, testimonials, reviews, case studies)`, hits.length === 0, hits.join(' '));
    check(`${PATH}: no retired commitments (24 hours, 2–3 / 8–16 weeks, full/unqualified Arabic RTL)`, RETIRED.every(re => !re.test(all)), RETIRED.filter(re => re.test(all)).map(String).join(' '));
    check(`${PATH}: contact copy uses the owner-approved response wording`, (await p.eval(`document.querySelector('#contact .section-head .t1').textContent.trim()`)) === 'Share a few details about your business and what you need. We aim to respond as soon as possible with a clear, no-pressure next step.');
    // shared blocks parity with the homepage
    const sig = `(() => { const norm = h => { if (!h) return h; if (h === '/' || h === '#hero') return 'HOME'; return h.replace(/^\\/(?=#)/, ''); };
      const links = sel => [...document.querySelectorAll(sel + ' a')].map(a => a.textContent.trim().replace(/\\s+/g, ' ') + ' => ' + norm(a.getAttribute('href')));
      const f = document.getElementById('contact-form');
      const fields = [...f.querySelectorAll('input,select,textarea,button')].map(el => [el.tagName, el.name || '', el.id, el.type || '', el.required, el.tagName === 'SELECT' ? [...el.options].map(o => o.value).join('|') : '', el.getAttribute('maxlength') || '', el.getAttribute('autocomplete') || ''].join(':'));
      return { nav: links('#nav'), mob: links('#mob-nav'), foot: links('footer'), fields, labels: [...f.querySelectorAll('label')].map(l => l.textContent.trim()), error: document.getElementById('form-error').textContent.trim().replace(/\\s+/g, ' ') }; })()`;
    const mine = await p.eval(sig);
    const home = await browser.newPage({ width: 1280, height: 900 }); await home.goto(S + '/'); await sleep(800);
    const theirs = await home.eval(sig); const homeMain = await home.eval(`document.querySelector('main').innerText`); await home.close();
    for (const k of ['nav', 'mob', 'foot', 'fields', 'labels', 'error']) check(`${PATH}: shared block "${k}" matches the homepage`, JSON.stringify(mine[k]) === JSON.stringify(theirs[k]),
      JSON.stringify(mine[k]) === JSON.stringify(theirs[k]) ? '' : JSON.stringify({ only_here: mine[k].filter?.(x => !theirs[k].includes(x)), only_home: theirs[k].filter?.(x => !mine[k].includes(x)) }));
    // duplicate content vs the homepage and the website-development page
    const own = await p.eval(`(() => { const m = document.querySelector('main').cloneNode(true); m.querySelectorAll('#contact').forEach(n => n.remove()); return m.innerText; })()`);
    const wdp = await browser.newPage({ width: 1280, height: 900 }); await wdp.goto(S + '/services/website-development'); await sleep(600);
    const wdMain = await wdp.eval(`(() => { const m = document.querySelector('main').cloneNode(true); m.querySelectorAll('#contact').forEach(n => n.remove()); return m.innerText; })()`); await wdp.close();
    const grams = t => { const w = t.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean); const g = new Set(); for (let i = 0; i + 5 <= w.length; i++) g.add(w.slice(i, i + 5).join(' ')); return g; };
    const overlap = (a, b) => { const A = grams(a), B = grams(b); let n = 0; A.forEach(x => { if (B.has(x)) n++; }); return n / Math.max(1, A.size); };
    const oh = overlap(own, homeMain), ow = overlap(own, wdMain);
    check(`${PATH}: copy is substantially unique (5-gram overlap < 20% vs the homepage and vs the website-development page)`, oh < 0.2 && ow < 0.2, `home ${(oh * 100).toFixed(1)}%, website page ${(ow * 100).toFixed(1)}%`);
    // keyboard + visible focus
    await p.goto(S + PATH); await sleep(800);
    await p.key('Tab', 'Tab', 9);
    check(`${PATH}: first Tab focuses the skip link`, await p.eval(`document.activeElement.classList.contains('skip-link')`));
    let reached = null;
    for (let i = 0; i < 60 && !reached; i++) { await p.key('Tab', 'Tab', 9); reached = await p.eval(`(() => { const a = document.activeElement; if (!a || !a.classList.contains('svh-link')) return null; const s = getComputedStyle(a); return { href: a.getAttribute('href'), outline: s.outlineStyle, width: s.outlineWidth, fv: a.matches(':focus-visible') }; })()`); }
    check(`${PATH}: service-card links are reachable by Tab and show a visible focus outline`, reached && reached.fv && reached.outline !== 'none' && parseFloat(reached.width) >= 2, JSON.stringify(reached));
    await p.eval(`document.querySelector('a.svh-link[href="/services/website-development"]').focus(); true`); await p.key('Enter', 'Enter', 13); await sleep(1200);
    check(`${PATH}: Enter on the Website Design & Development card navigates to /services/website-development`, await p.eval(`location.pathname === '/services/website-development'`));
    await p.eval(`document.querySelector('.svp-crumbs a[href="/services"]').click(); true`); await sleep(1200);
    check('website-development breadcrumb "Services" navigates back to the hub', await p.eval(`location.pathname === '/services' && !!document.querySelector('.svh-card')`));
    await p.close();
    const d = await browser.newPage({ width: 1440, height: 900 }); await d.goto(S + PATH); await sleep(1500);
    const perf = await d.eval(`new Promise(res => { let cls = 0; new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) cls += e.value; }).observe({ type: 'layout-shift', buffered: true }); setTimeout(() => res(+cls.toFixed(4)), 600); })`);
    check(`${PATH} desktop: CLS < 0.05`, perf < 0.05, String(perf));
    check(`${PATH} desktop: no exceptions, console errors, CSP violations or failed requests`, noErrors(d), errDetail(d));
    await d.close();
  }

  // ======================= C. Reduced motion =======================
  {
    const p = await browser.newPage({ width: 1280, height: 900 });
    await p.S('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await p.goto(S + PATH); await sleep(800);
    const r = await p.eval(`({ sb: getComputedStyle(document.documentElement).scrollBehavior, td: parseFloat(getComputedStyle(document.querySelector('.svh-card')).transitionDuration),
      wa: getComputedStyle(document.getElementById('wa-float')).animationName, infinite: document.getAnimations().filter(a => a.effect && a.effect.getComputedTiming().iterations === Infinity).length })`);
    await p.eval(`document.querySelector('a[data-cta="lp_hub_hero"]').click(); true`); await sleep(60);
    const jumped = await p.eval(`Math.abs(document.getElementById('contact').getBoundingClientRect().top) < 5`);
    check(`${PATH}: prefers-reduced-motion → no smooth scrolling, transitions effectively off, no floating button or endless animation, instant jump to the form`, r.sb === 'auto' && r.td <= 0.001 && r.wa === 'none' && r.infinite === 0 && jumped, JSON.stringify({ ...r, jumped }));
    await p.close();
  }

  // ======================= D. Consent / analytics privacy (local server with a TEST GA4 id, stubbed) =======================
  {
    const p = await browser.newPage({ width: 1280, height: 900, intercept: STUBS });
    await p.goto(GA + PATH); await sleep(1500);
    const b = await p.eval(`(() => { const x = document.getElementById('afra-consent'); return x ? { role: x.getAttribute('role') } : null; })()`);
    const hits = () => (p.log.intercepted || []).concat(p.log.requests.filter(r => ANALYTICS_URL.test(r.url)));
    check(`${PATH}: first visit shows the consent banner; zero analytics requests before a choice`, b && b.role === 'dialog' && hits().length === 0 && await p.eval(`typeof window.gtag === 'undefined'`), JSON.stringify({ banner: !!b, hits: hits().length }));
    await p.eval(`document.querySelector('#afra-consent [data-consent="reject"]').click(); true`); await sleep(500);
    check(`${PATH}: Reject → banner closes, still zero analytics requests`, !(await p.eval(`!!document.getElementById('afra-consent')`)) && hits().length === 0);
    await p.eval(`document.querySelector('[data-cookie-settings]').click(); true`); await sleep(500);
    check(`${PATH}: footer "Cookie settings" reopens the choices`, await p.eval(`!!document.getElementById('afra-consent')`));
    await p.close();
    check('default local server (as production): GA4 not configured', (await (await get('/api/analytics-config')).json()).ga4 === null);
  }

  // ======================= E. Mobile =======================
  for (const [w, hgt] of [[390, 844], [320, 568]]) {
    const p = await browser.newPage({ width: w, height: hgt, mobile: true });
    await p.goto(S + PATH); await sleep(1200);
    const m = await p.eval(`(() => { const vis = el => el && el.offsetWidth > 0;
      const small = [...document.querySelectorAll('.svp-btns .btn, .svh-link, .svh-guide a, #form-btn, #hamburger, .nav-right .btn-prime')].filter(vis).filter(el => el.getBoundingClientRect().height < 44).map(el => el.textContent.trim().slice(0, 24) || el.id);
      const over = [...document.querySelectorAll('main *')].filter(el => { const b = el.getBoundingClientRect(); return b.width > 0 && b.right > innerWidth + 1; }).map(el => el.className || el.tagName).slice(0, 5);
      const minFont = Math.min(...[...document.querySelectorAll('.svh-card p, .svh-guide-q, .t1')].map(el => parseFloat(getComputedStyle(el).fontSize)));
      return { sw: document.documentElement.scrollWidth, vw: innerWidth, over, small, minFont, hamburger: vis(document.getElementById('hamburger')), navLinksHidden: !vis(document.querySelector('.nav-links')), cols: getComputedStyle(document.querySelector('.svh-grid')).gridTemplateColumns.split(' ').length }; })()`);
    check(`${PATH} ${w}×${hgt}: no horizontal overflow, single-column cards, hamburger shown, touch targets ≥ 44px, body text ≥ 13px`, m.sw <= m.vw && m.over.length === 0 && m.cols === 1 && m.hamburger && m.navLinksHidden && m.small.length === 0 && m.minFont >= 13, JSON.stringify(m));
    if (w === 390) {
      await p.eval(`document.getElementById('hamburger').focus(); true`); await p.key('Enter', 'Enter', 13); await sleep(450);
      const menu = await p.eval(`({ open: document.getElementById('hamburger').getAttribute('aria-expanded'), items: [...document.querySelectorAll('#mob-nav a')].map(a => a.textContent.trim()) })`);
      check(`${PATH}: mobile menu opens by keyboard with WhatsApp, Call and "Start Your Project →"`, menu.open === 'true' && menu.items.includes('WhatsApp us') && menu.items.includes('Call +974 3002 9799') && menu.items.at(-1) === 'Start Your Project →', menu.items.join(' | '));
      await p.key('Escape', 'Escape', 27); await sleep(400);
      check(`${PATH}: Escape closes the mobile menu and returns focus to the button`, await p.eval(`document.getElementById('hamburger').getAttribute('aria-expanded') === 'false' && document.activeElement.id === 'hamburger'`));
      await p.eval(`document.getElementById('hamburger').click(); true`); await sleep(400);
      await p.eval(`document.querySelector('#mob-nav a[data-cta="lp_hub_mobile_menu"]').click(); true`); await sleep(2200);
      check(`${PATH}: mobile menu "Start Your Project" closes the menu, jumps to the form and records its source`, await p.eval(`!document.getElementById('mob-nav').classList.contains('open') && document.getElementById('cf-source').value === 'lp_hub_mobile_menu' && Math.abs(document.getElementById('contact').getBoundingClientRect().top) < 40`));
    }
    check(`${PATH} ${w}px: no exceptions, console errors, CSP violations or failed requests`, noErrors(p), errDetail(p));
    await p.close();
  }
  {
    const bad = [];
    for (const w of [320, 360, 375, 390, 414, 480, 768, 769, 820, 1024, 1100, 1280, 1440, 1920]) {
      const p = await browser.newPage({ width: w, height: w === 320 ? 568 : 900, mobile: w <= 1024 });
      await p.goto(S + PATH); await sleep(500);
      const r = await p.eval(`(() => { const vw = innerWidth; const clipped = [...document.querySelector('.nav-inner').querySelectorAll('a,button')].filter(el => el.offsetWidth > 0).filter(el => { const b = el.getBoundingClientRect(); return b.right > vw + 0.5 || b.left < -0.5; }).length;
        const btn = document.getElementById('form-btn').getBoundingClientRect(); return { sw: document.documentElement.scrollWidth, vw, clipped, formBtnFits: btn.left >= 0 && btn.right <= vw }; })()`);
      if (r.sw > r.vw || r.clipped || !r.formBtnFits) bad.push(`${w}:${JSON.stringify(r)}`);
      await p.close();
    }
    check(`${PATH}: 14 widths 320–1920 — no horizontal scroll, header controls not clipped, form button fits`, bad.length === 0, bad.join(' '));
  }
  {
    const diffs = [];
    const hdr = `(() => { const m = document.querySelector('#nav .nav-mark'), l = document.querySelector('#nav .nav-logo'), b = document.querySelector('#nav .nav-right .btn-prime');
      return { mark: Math.round(m.getBoundingClientRect().width), font: getComputedStyle(l).fontSize, ham: getComputedStyle(document.getElementById('hamburger')).display, links: getComputedStyle(document.querySelector('.nav-links')).display, btnFont: getComputedStyle(b).fontSize }; })()`;
    for (const w of [320, 390, 768, 1024, 1280, 1440]) {
      const out = [];
      for (const url of [S + '/', S + PATH]) { const p = await browser.newPage({ width: w, height: 900, mobile: w <= 1024 }); await p.goto(url); await sleep(500); out.push(await p.eval(hdr)); await p.close(); }
      if (JSON.stringify(out[0]) !== JSON.stringify(out[1])) diffs.push(`${w}: home=${JSON.stringify(out[0])} hub=${JSON.stringify(out[1])}`);
    }
    check(`${PATH}: header matches the homepage at 6 widths`, diffs.length === 0, diffs.join(' '));
  }
} catch (err) {
  check('harness error', false, err.stack);
} finally {
  await browser.close();
  procs.forEach(p => p.kill());
}
console.log(`\n${results.length - failed}/${results.length} services-hub checks passed`);
process.exit(failed ? 1 : 0);
