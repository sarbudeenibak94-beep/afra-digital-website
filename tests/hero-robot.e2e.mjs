// Design D6 — AI robot hero: poster for everyone, live 3D only on eligible desktops, safe fallbacks, conversion intact.
// Starts its own local server (4230). Needs Chrome/Edge. Usage: node tests/hero-robot.e2e.mjs
import { spawn } from 'node:child_process';
import { launch, sleep } from './lib/cdp.mjs';

const ROOT = new URL('..', import.meta.url);
const S = 'http://localhost:4230';
const srv = spawn(process.execPath, ['dev/server.mjs', '4230'], { cwd: ROOT, env: { ...process.env, VERCEL: '', GA4_MEASUREMENT_ID: '', SPEED_INSIGHTS: '' }, stdio: 'ignore' });
let pass = 0, fail = 0;
const check = (name, ok, info = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); };
const ROBOT_JS = /\/assets\/js\/hero-robot\.js/;
const state = p => p.eval(`document.querySelector('.hero-robot').getAttribute('data-robot')`);
async function waitState(p, want, ms = 20000) { const t = Date.now(); let s; while (Date.now() - t < ms) { s = await state(p); if (want.includes(s)) return s; await sleep(200); } return s; }
const posterVisible = p => p.eval(`(() => { const i = document.querySelector('.hero-robot-poster'); const r = i.getBoundingClientRect(); return i.complete && i.naturalWidth > 0 && r.width > 100 && parseFloat(getComputedStyle(i).opacity) > 0.95; })()`);
const robotRequests = p => p.log.requests.filter(r => ROBOT_JS.test(r.url)).length;
const ENV_PNG = /\/assets\/img\/hero-robot-env\.png/; // baked reflections (D6.1)
const envRequests = p => p.log.requests.filter(r => ENV_PNG.test(r.url)).length;
const errors = p => p.log.exceptions.concat(p.log.console.filter(c => /^error/.test(c)), p.log.cspViolations);

for (let i = 0; i < 60; i++) { try { if ((await fetch(S + '/')).ok) break; } catch {} await sleep(250); }
const browser = await launch({ port: 9630 });
try {
  // ---------- 1 + 6: poster, preload and unchanged hero conversion elements ----------
  {
    const p = await browser.newPage({ width: 390, height: 844, mobile: true });
    await p.goto(S + '/'); await sleep(1500);
    const r = await p.eval(`(() => { const h = document.getElementById('hero'), host = h.querySelector('.hero-right .hero-dash .hero-robot'), img = host && host.querySelector('img.hero-robot-poster');
      const pre = document.querySelector('link[rel="preload"][as="image"]');
      const b = [...h.querySelectorAll('.hero-btns a')].map(a => ({ href: a.getAttribute('href'), cta: a.getAttribute('data-cta'), target: a.getAttribute('target'), rel: a.getAttribute('rel'), text: a.textContent.trim() }));
      return { host: !!host, alt: img && img.alt, srcset: img && img.srcset, pre: pre && pre.getAttribute('href'), prePrio: pre && pre.getAttribute('fetchpriority'), imgPrio: img && img.getAttribute('fetchpriority'), lazy: img && img.loading,
        eyebrow: h.querySelector('.hero-label').textContent.trim(), h1: h.querySelector('h1').textContent.replace(/\\s+/g, ' ').trim(), sub: h.querySelector('.hero-sub').textContent.trim(), b,
        oldLogo: !!h.querySelector('.hero-logo') }; })()`);
    check('poster is the hero visual: .hero-robot inside .hero-right/.hero-dash with an alt text', r.host && r.alt === 'Black-and-gold AI robot illustration' && !r.oldLogo, JSON.stringify({ host: r.host, alt: r.alt, oldLogo: r.oldLogo }));
    check('poster is preloaded with high priority and offered at 384/640/960 widths', r.pre === '/assets/img/hero-robot-640.webp' && r.prePrio === 'high' && r.imgPrio === 'high' && r.lazy !== 'lazy' && /384w/.test(r.srcset) && /960w/.test(r.srcset), JSON.stringify({ pre: r.pre, prePrio: r.prePrio, imgPrio: r.imgPrio }));
    check('poster has loaded and is visible on a phone', await posterVisible(p));
    check('hero copy unchanged (eyebrow, H1, subtitle)', r.eyebrow === 'Doha, Qatar — Design • Develop • Market' && r.h1 === 'Websites, Apps & AI Solutions for GCC Businesses' && r.sub.startsWith('AFRA DIGITAL designs, develops and markets websites, web and mobile apps, AI automation and custom software'), JSON.stringify([r.eyebrow, r.h1]));
    check('hero CTAs unchanged: Start Your Project → #contact (data-cta hero_start_project) and WhatsApp link', JSON.stringify(r.b) === JSON.stringify([
      { href: '#contact', cta: 'hero_start_project', target: null, rel: null, text: 'Start Your Project' },
      { href: 'https://wa.me/97430029799?text=Hello%20AFRA%20DIGITAL%2C%20I%20would%20like%20to%20discuss%20a%20project.', cta: null, target: '_blank', rel: 'noopener', text: 'Chat on WhatsApp' }]), JSON.stringify(r.b));
    await p.close();
  }

  // ---------- 3: phones and touch tablets never load the 3D module ----------
  for (const [w, h] of [[390, 844], [1024, 768]]) {
    const p = await browser.newPage({ width: w, height: h, mobile: true });
    await p.goto(S + '/'); await sleep(4000);
    const s = await state(p), canvas = await p.eval(`!!document.querySelector('.hero-robot canvas')`);
    check(`${w}px touch device: poster only, no 3D module or reflection PNG request, no canvas`, s === 'poster' && robotRequests(p) === 0 && envRequests(p) === 0 && !canvas && await posterVisible(p), JSON.stringify({ s, req: robotRequests(p), env: envRequests(p), canvas }));
    check(`${w}px touch device: no console errors, exceptions or CSP violations`, errors(p).length === 0, JSON.stringify(errors(p)).slice(0, 200));
    await p.close();
  }

  // ---------- 2 + 7(motion): eligible desktop goes live, tracks the pointer within limits, pauses off-screen ----------
  {
    const p = await browser.newPage({ width: 1440, height: 900, initScript: 'window.__afraRobotTest = true;' });
    await p.goto(S + '/');
    const s = await waitState(p, ['live', 'failed', 'unsupported']);
    const r = await p.eval(`(() => { const host = document.querySelector('.hero-robot'), c = host.querySelector('canvas'); return { canvas: !!c, hidden: c && c.getAttribute('aria-hidden'), w: c && c.width, cssW: Math.round(host.getBoundingClientRect().width), loadDone: document.readyState }; })()`);
    check('1440px desktop: module loads after the page and the robot goes live', s === 'live' && robotRequests(p) === 1 && r.canvas, JSON.stringify({ s, req: robotRequests(p), ...r }));
    check('baked reflections: the environment PNG is requested once (no in-browser PMREM)', envRequests(p) === 1, JSON.stringify({ env: envRequests(p) }));
    check('live canvas is decorative (aria-hidden) and fills the hero visual box', r.hidden === 'true' && r.w >= r.cssW, JSON.stringify(r));
    await sleep(1200);
    check('poster fades out once the robot is live (no double image)', await p.eval(`parseFloat(getComputedStyle(document.querySelector('.hero-robot-poster')).opacity) < 0.05`));
    // something is actually drawn: sample the composited screenshot inside the robot box
    const shot = (await p.screenshot()).toString('base64');
    const lit = await p.eval(`new Promise(res => { const im = new Image(); im.onload = () => { const r = document.querySelector('.hero-robot').getBoundingClientRect(); const c = document.createElement('canvas'); c.width = r.width; c.height = r.height; const g = c.getContext('2d'); g.drawImage(im, r.left, r.top, r.width, r.height, 0, 0, r.width, r.height); const d = g.getImageData(0, 0, c.width, c.height).data; let gold = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 150 && d[i + 1] > 110 && d[i + 2] < 120) gold++; res(gold); }; im.src = 'data:image/png;base64,${shot}'; })`);
    check('robot is rendered (gold pixels present in the hero visual)', lit > 500, `${lit} gold pixels`);
    await p.S('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 30, y: 300 }); await sleep(1800);
    const left = await p.eval('window.__afraRobot.pose');
    await p.S('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1410, y: 300 }); await sleep(1800);
    const right = await p.eval('window.__afraRobot.pose');
    await p.S('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1410, y: 880 }); await sleep(1800);
    const down = await p.eval('window.__afraRobot.pose');
    check('head and eyes follow the pointer (left vs right, smoothed)', left.yaw < -0.2 && right.yaw > 0.2 && left.eyeX < -0.5 && right.eyeX > 0.5, JSON.stringify({ left, right }));
    check('rotation stays within strict limits (|yaw| ≤ 0.42, |pitch| ≤ 0.2)', [left, right, down].every(q => Math.abs(q.yaw) <= 0.4201 && Math.abs(q.pitch) <= 0.2001), JSON.stringify(down));
    await p.eval(`document.documentElement.dispatchEvent(new PointerEvent('pointerleave')); 1`); await sleep(3500);
    const idle = await p.eval('window.__afraRobot.pose');
    check('pointer leaves the page → smooth return to the gentle idle pose', Math.abs(idle.yaw) < 0.2, JSON.stringify(idle));
    await p.eval(`document.documentElement.style.scrollBehavior = 'auto'; window.scrollTo(0, 3000); 1`); await sleep(600);
    const paused = await p.eval('!window.__afraRobot.running');
    await p.eval(`window.scrollTo(0, 0); 1`); await sleep(600);
    const resumed = await p.eval('window.__afraRobot.running');
    check('rendering pauses when the hero is off-screen and resumes when it returns', paused && resumed, JSON.stringify({ paused, resumed }));
    check('desktop: no console errors, exceptions or CSP violations', errors(p).length === 0, JSON.stringify(errors(p)).slice(0, 300));
    // context loss → poster comes back
    await p.eval(`window.__afraRobot.renderer.forceContextLoss(); 1`); await sleep(1200);
    const lost = await p.eval(`({ s: document.querySelector('.hero-robot').getAttribute('data-robot'), canvas: !!document.querySelector('.hero-robot canvas') })`);
    check('WebGL context loss → canvas removed and the poster is shown again', lost.s === 'context-lost' && !lost.canvas && await posterVisible(p), JSON.stringify(lost));
    await p.close();
  }

  // ---------- 4: reduced motion and Save-Data keep the static poster ----------
  {
    const p = await browser.newPage({ width: 1440, height: 900 });
    await p.S('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await p.goto(S + '/'); await sleep(4000);
    check('reduced motion (desktop): static poster, 3D module and reflection PNG never requested', await state(p) === 'poster' && robotRequests(p) === 0 && envRequests(p) === 0 && await posterVisible(p), JSON.stringify({ s: await state(p), req: robotRequests(p) }));
    await p.close();
  }
  {
    const p = await browser.newPage({ width: 1440, height: 900, initScript: `Object.defineProperty(navigator, 'connection', { value: { saveData: true, effectiveType: '4g' }, configurable: true });` });
    await p.goto(S + '/'); await sleep(4000);
    check('Save-Data (desktop): static poster, 3D module never requested', await state(p) === 'poster' && robotRequests(p) === 0, JSON.stringify({ s: await state(p), req: robotRequests(p) }));
    await p.close();
  }

  // ---------- 5: failures never leave the hero blank ----------
  {
    const p = await browser.newPage({ width: 1440, height: 900 });
    await p.S('Network.setBlockedURLs', { urls: ['*hero-robot.js*'] });
    await p.goto(S + '/');
    const s = await waitState(p, ['failed', 'live'], 12000);
    check('3D module fails to load → state "failed", poster stays visible, no uncaught exception', s === 'failed' && await posterVisible(p) && p.log.exceptions.length === 0, JSON.stringify({ s, ex: p.log.exceptions }));
    await p.close();
  }
  {
    const p = await browser.newPage({ width: 1440, height: 900 });
    await p.S('Network.setBlockedURLs', { urls: ['*hero-robot-env.png*'] });
    await p.goto(S + '/');
    const s = await waitState(p, ['live', 'failed', 'unsupported']);
    check('reflection PNG fails to load → falls back to in-browser reflections, robot still goes live', s === 'live' && await p.eval(`!!document.querySelector('.hero-robot canvas')`) && p.log.exceptions.length === 0, JSON.stringify({ s, ex: p.log.exceptions }));
    await p.close();
  }
  {
    const p = await browser.newPage({ width: 1440, height: 900, initScript: `const g = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (t, o) { return /webgl/i.test(t) ? null : g.call(this, t, o); };` });
    await p.goto(S + '/');
    const s = await waitState(p, ['unsupported', 'failed', 'live'], 15000);
    check('WebGL unavailable → robot not mounted, poster stays visible, no uncaught exception', ['unsupported', 'failed'].includes(s) && await posterVisible(p) && !(await p.eval(`!!document.querySelector('.hero-robot canvas')`)) && p.log.exceptions.length === 0, JSON.stringify({ s, ex: p.log.exceptions }));
    await p.close();
  }

  // ---------- 7: no horizontal overflow at the D6 widths ----------
  {
    const bad = [];
    for (const w of [320, 390, 430, 768, 901, 1024, 1280, 1440, 1920]) {
      const p = await browser.newPage({ width: w, height: w <= 430 ? 844 : 900, mobile: w < 1024 });
      await p.goto(S + '/'); await sleep(w >= 1024 ? 3500 : 1200);
      const r = await p.eval(`({ sw: document.documentElement.scrollWidth, vw: innerWidth, box: Math.round(document.querySelector('.hero-robot').getBoundingClientRect().width) })`);
      if (r.sw > r.vw || r.box < 200) bad.push(`${w}:${JSON.stringify(r)}`);
      await p.close();
    }
    check('no horizontal overflow and a sized hero visual at 320–1920 px (9 widths)', bad.length === 0, bad.join(' '));
  }
} finally { await browser.close(); srv.kill(); }
console.log(`${pass}/${pass + fail} hero robot checks passed`);
process.exit(fail ? 1 : 0);
