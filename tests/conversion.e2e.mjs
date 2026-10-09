// Phase 04 Batch 1 (C1–C7) end-to-end checks: contextual WhatsApp, quick enquiry blocks, shorter mobile
// journey, qualification fields, plan carry-over, enquiry reference, mobile menu, PII-free event context.
// Uses a local server wired to the mock email provider: no real email is ever sent.
// Usage: node tests/conversion.e2e.mjs
import { spawn } from 'node:child_process';
import { launch, sleep } from './lib/cdp.mjs';

const ROOT = new URL('..', import.meta.url);
// Phase 03 mobile page height at 390x844 (measured with this same method before Phase 04).
const BASELINE_MOBILE_HEIGHT = 25134;
const results = []; let failed = 0;
function check(name, ok, detail = '') { results.push({ name, ok }); if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); }

const procs = [];
function start(args, env = {}) {
  const p = spawn(process.execPath, args, { cwd: ROOT, env: { ...process.env, VERCEL: '', GA4_MEASUREMENT_ID: '', SPEED_INSIGHTS: '', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  p.stderr.on('data', d => { const s = String(d); if (!/\[contact\]/.test(s)) process.stderr.write(s); });
  procs.push(p); return p;
}
start(['dev/mock-email-provider.mjs', '4203']);
start(['dev/server.mjs', '4202'], { RESEND_API_KEY: 'test_key_not_real', RESEND_API_URL: 'http://localhost:4203/emails' });
async function waitUp(url) { for (let i = 0; i < 60; i++) { try { await fetch(url); return; } catch { await sleep(150); } } throw new Error('not up ' + url); }
await Promise.all(['http://localhost:4202/', 'http://localhost:4203/__received'].map(waitUp));
const S = 'http://localhost:4202', MOCK = 'http://localhost:4203';
const received = async () => (await fetch(`${MOCK}/__received`)).json();
const WA_NUMBER = 'https://wa.me/97430029799';
const blockNav = p => p.eval(`document.addEventListener('click', e => { const a = e.target.closest && e.target.closest('a[href]'); if (a && /^(tel:|mailto:|https:\\/\\/wa\\.me)/.test(a.getAttribute('href'))) e.preventDefault(); }, false); true`);

const browser = await launch({ port: 9395 });
try {
  // ---------- C1: contextual WhatsApp links ----------
  {
    const p = await browser.newPage({ width: 1440, height: 900 });
    await p.goto(S + '/'); await sleep(1200);
    const links = await p.eval(`[...document.querySelectorAll('a[href^="https://wa.me/"]')].map(a => ({ href: a.getAttribute('href'), text: decodeURIComponent((a.getAttribute('href').split('text=')[1] || '')), svc: a.getAttribute('data-wa-service'), plan: a.getAttribute('data-wa-plan'), name: (a.getAttribute('aria-label') || a.textContent).trim(), target: a.getAttribute('target'), rel: a.getAttribute('rel') || '' }))`);
    check('C1 every WhatsApp link uses the confirmed number', links.length > 0 && links.every(l => l.href.startsWith(WA_NUMBER + '?text=')), `${links.length} links`);
    const svc = links.filter(l => l.svc && !/demo/.test(l.text));
    const cards = await p.eval(`[...document.querySelectorAll('.svc-card')].map(c => ({ name: c.querySelector('.svc-name').textContent, svc: c.querySelector('.svc-link').getAttribute('data-service'), wa: c.querySelector('.svc-wa') && c.querySelector('.svc-wa').getAttribute('data-wa-service') }))`);
    check('C1 all 12 service cards offer a WhatsApp option for the same service', cards.length === 12 && cards.every(c => c.wa === c.svc), JSON.stringify(cards.filter(c => c.wa !== c.svc)));
    check('C1 service WhatsApp prefills name the service', svc.length === 12 && svc.every(l => l.text.includes(`interested in ${l.svc}.`)), svc.map(l => l.text).slice(0, 2).join(' | '));
    const prod = links.filter(l => /demo of/.test(l.text));
    check('C1 product WhatsApp prefills name the product (Cook With Fire, SAANIX)', prod.length === 2 && /Cook With Fire/.test(prod[0].text) && /SAANIX/.test(prod[1].text), prod.map(l => l.text).join(' | '));
    const plans = links.filter(l => l.plan);
    check('C1 pricing WhatsApp prefills name the package', plans.length === 3 && plans.every(l => l.text.includes(`the ${l.plan} package`)), plans.map(l => l.plan).join(','));
    check('C1 prefills contain no personal data or prices; external links open safely', links.every(l => !/@|\d{7,}|QAR/.test(l.text) && l.target === '_blank' && /noopener/.test(l.rel)) || links.filter(l => l.target !== '_blank').every(l => !/@|\d{7,}/.test(l.text)));
    check('C1 service WhatsApp links have descriptive accessible names', svc.every(l => l.name === `Ask about ${l.svc} on WhatsApp`));

    // ---------- C7: event context ----------
    await blockNav(p);
    await p.eval(`window.afraEvents.length = 0; document.querySelector('.svc-wa[data-wa-service="AI Solutions"]').click(); document.querySelector('.price-wa[data-wa-plan="Enterprise"]').click(); document.querySelector('a[data-plan="Starter"]').click(); true`);
    await sleep(300);
    const ev = await p.eval(`window.afraEvents.map(e => ({ e: e.event, p: e.params }))`);
    const waSvc = ev.find(x => x.e === 'whatsapp_click' && x.p.service === 'AI Solutions');
    const waPlan = ev.find(x => x.e === 'whatsapp_click' && x.p.plan === 'Enterprise');
    const ctaPlan = ev.find(x => x.e === 'cta_click' && x.p.plan === 'Starter');
    check('C7 whatsapp_click carries service / plan context', waSvc && waSvc.p.link_location === 'services' && waPlan && waPlan.p.link_location === 'pricing', JSON.stringify(ev.slice(0, 2)));
    check('C7 pricing cta_click carries the plan', ctaPlan && ctaPlan.p.cta_id === 'pricing_starter', JSON.stringify(ctaPlan));

    // ---------- C4: plan carried into the form ----------
    for (const plan of ['Starter', 'Business', 'Enterprise']) {
      await p.eval(`document.querySelector('a[data-plan="${plan}"]').click(); true`); await sleep(150);
      const st = await p.eval(`({ chip: !document.getElementById('cf-plan-chip').hidden, name: document.getElementById('cf-plan-name').textContent, plan: document.getElementById('cf-plan').value, source: document.getElementById('cf-source').value })`);
      check(`C4 "Choose ${plan}" shows the package chip and sets plan + source`, st.chip && st.name === plan && st.plan === plan && st.source === 'pricing_' + plan.toLowerCase(), JSON.stringify(st));
    }
    await p.eval(`document.getElementById('cf-plan-clear').click(); true`); await sleep(100);
    const cleared = await p.eval(`({ chip: !document.getElementById('cf-plan-chip').hidden, plan: document.getElementById('cf-plan').value, focus: document.activeElement.id })`);
    check('C4 removing the chip clears the plan and moves focus to the service field', !cleared.chip && cleared.plan === '' && cleared.focus === 'cf-service', JSON.stringify(cleared));
    await p.eval(`document.querySelector('.svc-link[data-service="E-Commerce Development"]').click(); true`); await sleep(100);
    check('Service CTA still pre-selects the service and records its source', await p.eval(`document.getElementById('cf-service').value === 'E-Commerce Development' && document.getElementById('cf-source').value === 'service_e_commerce_development'`));

    // ---------- C6 (desktop): wording ----------
    const pricingText = await p.eval(`[...document.querySelectorAll('#pricing a[data-plan]')].map(a => a.textContent.trim())`);
    check('C6 pricing CTAs use consistent "Choose …" wording', JSON.stringify(pricingText) === JSON.stringify(['Choose Starter', 'Choose Business →', 'Choose Enterprise']), pricingText.join(' | '));

    // ---------- C2 (desktop unchanged) ----------
    const desk = await p.eval(`({ dash: [...document.querySelectorAll('#software-products .sp-product-visual')].every(e => getComputedStyle(e).display !== 'none'),
      why: getComputedStyle(document.querySelector('.sp-why-block')).display !== 'none', toggles: [...document.querySelectorAll('.sp-feats-toggle')].map(b => getComputedStyle(b).display),
      chipsHidden: [...document.querySelectorAll('.sp-feat')].filter(c => getComputedStyle(c).display === 'none').length, tags: getComputedStyle(document.querySelector('.svc-tags')).display !== 'none', portVis: getComputedStyle(document.querySelector('.port-vis')).display !== 'none' })`);
    check('C2 desktop unchanged: dashboards, product "why", tags, portfolio visuals and all feature chips visible; toggles hidden',
      desk.dash && desk.why && desk.tags && desk.portVis && desk.chipsHidden === 0 && desk.toggles.every(d => d === 'none'), JSON.stringify(desk));
    const quick = await p.eval(`[...document.querySelectorAll('.quick-enquiry')].map(q => ({ id: q.id, prev: q.previousElementSibling && (q.previousElementSibling.id || q.previousElementSibling.className), actions: [...q.querySelectorAll('a')].map(a => a.getAttribute('href').split('?')[0]) }))`);
    check('C2 two quick-enquiry blocks (after Services and after Work) with message / WhatsApp / call', quick.length === 2 && quick[0].id === 'quick-after-services' && quick[1].id === 'quick-after-work' &&
      quick.every(q => JSON.stringify(q.actions) === JSON.stringify(['#contact', WA_NUMBER, 'tel:+97430029799'])), JSON.stringify(quick));
    check('No console errors / CSP violations / exceptions (desktop)', !p.log.exceptions.length && !p.log.cspViolations.length && !p.log.console.filter(c => /^error/.test(c)).length, JSON.stringify([...p.log.exceptions, ...p.log.cspViolations]).slice(0, 200));
    await p.close();
  }

  // ---------- C3 + C5: qualification fields, reference, delivery via mock provider ----------
  {
    await fetch(`${MOCK}/__mode/success`, { method: 'POST' });
    const before = (await received()).length;
    const p = await browser.newPage({ width: 1280, height: 900 });
    await p.goto(S + '/'); await sleep(800);
    const labels = await p.eval(`['cf-budget','cf-timeline','cf-contact-pref'].map(id => { const el = document.getElementById(id); return { id, label: el.labels && el.labels[0] && el.labels[0].textContent.replace(/\\s+/g,' ').trim(), required: el.required, options: [...el.options].map(o => o.value) }; })`);
    check('C3 budget / timeline / preferred-contact selects are labelled, optional and use the confirmed options',
      labels[0].label === 'Budget (optional)' && labels[1].label === 'Timeline (optional)' && labels[2].label === 'Preferred contact (optional)' && labels.every(l => !l.required) &&
      JSON.stringify(labels[0].options) === JSON.stringify(['', 'Under QAR 10,000', 'QAR 10,000–25,000', 'QAR 25,000–50,000', 'Over QAR 50,000', 'Not sure yet']) &&
      JSON.stringify(labels[1].options) === JSON.stringify(['', 'As soon as possible', 'Within 1–3 months', 'Within 3–6 months', 'Just exploring']) &&
      JSON.stringify(labels[2].options) === JSON.stringify(['', 'Email', 'WhatsApp', 'Phone']), JSON.stringify(labels));

    // WhatsApp preference without a phone number -> client error, nothing sent
    await sleep(2200);
    await p.eval(`(() => { const f = document.getElementById('contact-form'); f.firstName.value = 'Test'; f.lastName.value = 'Conversion'; f.email.value = 'p4-test@example.org';
      f.phone.value = ''; f.contactPref.value = 'WhatsApp'; f.message.value = 'P4 AUTOMATED TEST'; document.getElementById('form-btn').click(); return true; })()`);
    await sleep(400);
    const pv = await p.eval(`({ invalid: document.getElementById('cf-phone').getAttribute('aria-invalid'), msg: document.getElementById('cf-phone-err').textContent, focus: document.activeElement.id })`);
    const posts0 = p.log.requests.filter(r => r.url.endsWith('/api/contact') && r.method === 'POST').length;
    check('C3 WhatsApp/Phone preference without a number: helpful phone error, focus on phone, nothing sent', pv.invalid === 'true' && /phone number so we can contact you/.test(pv.msg) && pv.focus === 'cf-phone' && posts0 === 0, JSON.stringify(pv));
    await p.eval(`(() => { const f = document.getElementById('contact-form'); f.contactPref.value = 'Email'; f.contactPref.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await sleep(100);
    check('C3 switching preference to Email clears the phone error', await p.eval(`document.getElementById('cf-phone').getAttribute('aria-invalid') === null`));

    // Full submission with plan + qualification fields
    await blockNav(p);
    await p.eval(`document.querySelector('a[data-plan="Business"]').click(); true`); await sleep(200);
    await p.eval(`(() => { const f = document.getElementById('contact-form'); f.budget.value = 'QAR 25,000–50,000'; f.timeline.value = 'Within 1–3 months'; f.contactPref.value = 'WhatsApp';
      f.phone.value = '+974 5555 0000'; f.service.value = 'Website Development'; f.message.value = 'P4 AUTOMATED TEST please ignore ' + Date.now();
      window.afraEvents.length = 0; const b = document.getElementById('form-btn'); b.click(); b.click(); return true; })()`);
    await sleep(2000);
    const done = await p.eval(`({ success: !document.getElementById('form-success').hidden, ref: document.getElementById('form-ref').hidden ? null : document.getElementById('form-ref-code').textContent,
      events: window.afraEvents.map(e => ({ e: e.event, p: e.params })), focus: document.activeElement.id })`);
    const got = (await received()).slice(before);
    const pl = got[0] && got[0].payload;
    check('C5 success shows a well-formed reference only after the provider accepted', done.success && /^AFRA-[2-9A-HJ-NP-Z]{6}$/.test(done.ref || '') && got.length === 1, JSON.stringify({ ref: done.ref, sends: got.length }));
    check('C5 the reference shown to the visitor matches the email subject', pl && pl.subject.startsWith(`Website enquiry [${done.ref}]: Website Development`), pl && pl.subject);
    check('C3/C4 email contains package, budget, timeline, preferred contact and source',
      pl && ['Package:  Business', 'Budget:   QAR 25,000–50,000', 'Timeline: Within 1–3 months', 'Preferred contact: WhatsApp', 'Source:    website button "pricing_business"', `Reference: ${done.ref}`].every(x => pl.text.includes(x)), pl && pl.text.split('\n').slice(2, 14).join(' | '));
    const lead = done.events.filter(x => x.e === 'generate_lead');
    check('C7 exactly one generate_lead with service + plan, and no budget/timeline/contact/reference in any event',
      lead.length === 1 && JSON.stringify(lead[0].p) === JSON.stringify({ form_id: 'contact', method: 'contact_form', service: 'Website Development', plan: 'Business' }) &&
      !/QAR|Within|WhatsApp"|AFRA-|5555|p4-test|Conversion/.test(JSON.stringify(done.events)), JSON.stringify(lead));
    await p.close();
  }

  // ---------- C2 + C6: mobile journey ----------
  {
    const p = await browser.newPage({ width: 390, height: 844, mobile: true });
    await p.goto(S + '/'); await sleep(1500);
    const geo = await p.eval(`(() => { const vh = innerHeight, H = document.documentElement.scrollHeight;
      const vis = el => { const cs = getComputedStyle(el), rc = el.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && rc.width > 0 && rc.height > 0; };
      const y = el => el.getBoundingClientRect().top + scrollY;
      const actions = [...document.querySelectorAll('main a[href="#contact"], main a[href^="https://wa.me"], main a[href^="tel:"], #contact-form')].filter(vis).map(y).sort((a, b) => a - b);
      const sections = [...document.querySelectorAll('main > section[id]')].filter(vis).map(s => ({ id: s.id, top: y(s), bottom: y(s) + s.getBoundingClientRect().height }));
      const gaps = sections.map(s => { const next = actions.find(a => a >= s.top); return { id: s.id, screens: next === undefined ? 99 : +((next - s.top) / vh).toFixed(2) }; });
      return { H, formScreens: +(y(document.getElementById('contact-form')) / vh).toFixed(1), gaps, sw: document.documentElement.scrollWidth, vw: innerWidth }; })()`);
    const reduction = 1 - geo.H / BASELINE_MOBILE_HEIGHT;
    check('C2 mobile page height reduced by at least 15% vs Phase 03 (390×844)', reduction >= 0.15, `${BASELINE_MOBILE_HEIGHT} -> ${geo.H} px (${(reduction * 100).toFixed(1)}% shorter); form at screen ${geo.formScreens}`);
    const far = geo.gaps.filter(g => g.screens > 2);
    check('C2 from the top of every section, a contact action is within 2 screens', far.length === 0, JSON.stringify(far.length ? far : geo.gaps));
    check('C2 no horizontal scroll on mobile', geo.sw <= geo.vw);
    const mob = await p.eval(`({ dash: [...document.querySelectorAll('#software-products .sp-product-visual')].every(e => getComputedStyle(e).display === 'none'), why: getComputedStyle(document.querySelector('.sp-why-block')).display === 'none',
      hiddenChips: [...document.querySelectorAll('.sp-feats-collapsible .sp-feat')].filter(c => getComputedStyle(c).display === 'none').length,
      toggles: [...document.querySelectorAll('.sp-feats-toggle')].map(b => ({ vis: getComputedStyle(b).display !== 'none', exp: b.getAttribute('aria-expanded'), ctl: b.getAttribute('aria-controls'), h: Math.round(b.getBoundingClientRect().height), t: b.textContent })) })`);
    check('C2 mobile: demo dashboards and the duplicate product "why" hidden; long feature lists collapsed behind visible toggles',
      mob.dash && mob.why && mob.hiddenChips > 0 && mob.toggles.length === 2 && mob.toggles.every(t => t.vis && t.exp === 'false' && t.ctl && t.h >= 44), JSON.stringify(mob.toggles));
    // keyboard: toggle with Enter
    await p.eval(`document.querySelector('.sp-feats-toggle').focus(); true`);
    await p.key('Enter', 'Enter', 13); await sleep(150);
    const exp = await p.eval(`(() => { const b = document.querySelector('.sp-feats-toggle'); const g = document.getElementById(b.getAttribute('aria-controls')); return { exp: b.getAttribute('aria-expanded'), t: b.textContent, hidden: [...g.querySelectorAll('.sp-feat')].filter(c => getComputedStyle(c).display === 'none').length }; })()`);
    check('C2 feature toggle works from the keyboard (Enter) and updates aria-expanded', exp.exp === 'true' && exp.hidden === 0 && /fewer/.test(exp.t), JSON.stringify(exp));

    // ---------- C6: mobile menu ----------
    await p.eval(`document.getElementById('hamburger').focus(); true`);
    await p.key('Enter', 'Enter', 13); await sleep(450);
    const menu = await p.eval(`[...document.querySelectorAll('#mob-nav a')].map(a => ({ t: a.textContent.trim(), href: a.getAttribute('href').split('?')[0] }))`);
    check('C6 mobile menu offers WhatsApp and Call, and "Start Your Project"',
      menu.some(m => m.t === 'WhatsApp us' && m.href === WA_NUMBER) && menu.some(m => m.t === 'Call +974 3002 9799' && m.href === 'tel:+97430029799') && menu[menu.length - 1].t === 'Start Your Project →', menu.map(m => m.t).join(' | '));
    let reachedCall = false;
    for (let i = 0; i < 14 && !reachedCall; i++) { await p.key('Tab', 'Tab', 9); reachedCall = await p.eval(`document.activeElement && document.activeElement.getAttribute('href') === 'tel:+97430029799'`); }
    check('C6 new menu items are reachable by keyboard (focus trap intact)', reachedCall);
    await p.key('Escape', 'Escape', 27); await sleep(400);
    check('C6 Escape still closes the menu and returns focus', await p.eval(`document.getElementById('hamburger').getAttribute('aria-expanded') === 'false' && document.activeElement.id === 'hamburger'`));
    check('No console errors / CSP violations / exceptions (mobile)', !p.log.exceptions.length && !p.log.cspViolations.length, JSON.stringify([...p.log.exceptions, ...p.log.cspViolations]).slice(0, 200));
    await p.close();
  }
  // ---------- C6: small phone menu fits/scrolls ----------
  {
    const p = await browser.newPage({ width: 320, height: 568, mobile: true });
    await p.goto(S + '/'); await sleep(1200);
    await p.eval(`document.getElementById('hamburger').click(); true`); await sleep(450);
    const r = await p.eval(`(() => { const m = document.getElementById('mob-nav'); const last = [...m.querySelectorAll('a')].pop(); last.scrollIntoView({ block: 'nearest' });
      const rc = last.getBoundingClientRect(); return { overflowY: getComputedStyle(m).overflowY, lastVisible: rc.bottom <= innerHeight + 1 && rc.top >= 0, first: m.querySelector('a').getBoundingClientRect().top }; })()`);
    check('C6 320×568: mobile menu scrolls and every item (incl. the last) can be reached', r.overflowY === 'auto' && r.lastVisible, JSON.stringify(r));
    await p.close();
  }
} catch (err) {
  check('harness error', false, err.stack);
} finally {
  await browser.close();
  procs.forEach(p => p.kill());
}
console.log(`\n${results.length - failed}/${results.length} conversion checks passed`);
process.exit(failed ? 1 : 0);
