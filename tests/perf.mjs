// Lab performance comparison (same conditions as the Phase 01 audit).
// Usage: node tests/perf.mjs <baseUrl> [runs] [label]
// "contentVisibleMs" = time until the full-screen #loader overlay is gone (or FCP if there is no loader),
// i.e. when a visitor can actually see the page.
import { launch, sleep, MOBILE_THROTTLE } from './lib/cdp.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';

const BASE = process.argv[2] || 'http://localhost:4173/';
const RUNS = Number(process.argv[3] || 3);
const LABEL = process.argv[4] || 'run';

const INIT = `
window.__perf = { lcp: 0, lcpEl: '', cls: 0, visible: null };
new PerformanceObserver(l => { for (const e of l.getEntries()) { window.__perf.lcp = Math.round(e.startTime); window.__perf.lcpEl = e.element ? e.element.tagName + '.' + (e.element.className || '') : (e.url || ''); } }).observe({ type: 'largest-contentful-paint', buffered: true });
new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__perf.cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
(function poll(){
  const l = document.getElementById('loader');
  const gone = document.readyState !== 'loading' && (!l || l.classList.contains('hidden') || getComputedStyle(l).display === 'none' || getComputedStyle(l).visibility === 'hidden' || parseFloat(getComputedStyle(l).opacity) < 0.05);
  if (gone && window.__perf.visible === null) {
    const fcp = performance.getEntriesByName('first-contentful-paint')[0];
    window.__perf.visible = Math.round(Math.max(performance.now(), fcp ? fcp.startTime : 0));
    if (!l) window.__perf.visible = fcp ? Math.round(fcp.startTime) : window.__perf.visible;
    return;
  }
  requestAnimationFrame(poll);
})();`;

const median = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

const browser = await launch({ port: 9341 });
const out = {};
for (const [name, w, h, mobile, throttle, settle] of [
  ['mobile-390-throttled', 390, 844, true, MOBILE_THROTTLE, 30000],
  ['desktop-1440', 1440, 900, false, null, 5000],
]) {
  const runs = [];
  for (let i = 0; i < RUNS; i++) {
    const p = await browser.newPage({ width: w, height: h, mobile, throttle, initScript: INIT });
    const t0 = Date.now();
    await p.goto(BASE, { waitFor: 'load', timeout: 120000 });
    const loadWall = Date.now() - t0;
    // wait until content is visible (or settle timeout)
    for (let waited = 0; waited < settle; waited += 250) { if (await p.eval('window.__perf.visible !== null')) break; await sleep(250); }
    await sleep(1500);
    const r = await p.eval(`(() => { const n = performance.getEntriesByType('navigation')[0]; const res = performance.getEntriesByType('resource');
      const fcp = performance.getEntriesByName('first-contentful-paint')[0];
      return { fcpMs: fcp ? Math.round(fcp.startTime) : null, lcpMs: window.__perf.lcp, lcpElement: window.__perf.lcpEl, contentVisibleMs: window.__perf.visible,
        loadEventMs: Math.round(n.loadEventEnd), domContentLoadedMs: Math.round(n.domContentLoadedEventEnd), cls: +window.__perf.cls.toFixed(4),
        transferKB: Math.round((n.transferSize + res.reduce((a, x) => a + (x.transferSize || 0), 0)) / 1024),
        imageKB: Math.round(res.filter(x => x.initiatorType === 'img' || /\\.(png|jpe?g|webp|avif|ico)(\\?|$)/.test(x.name)).reduce((a, x) => a + (x.transferSize || 0), 0) / 1024),
        requests: res.length + 1 }; })()`);
    r.loadWallMs = loadWall;
    runs.push(r);
    await p.close();
  }
  const keys = ['fcpMs', 'lcpMs', 'contentVisibleMs', 'loadEventMs', 'domContentLoadedMs', 'cls', 'transferKB', 'imageKB', 'requests'];
  out[name] = { median: Object.fromEntries(keys.map(k => [k, median(runs.map(r => r[k]))])), lcpElement: runs[0].lcpElement, runs };
}
await browser.close();
mkdirSync(new URL('./results/', import.meta.url), { recursive: true });
writeFileSync(new URL(`./results/perf-${LABEL}.json`, import.meta.url), JSON.stringify(out, null, 2));
for (const [k, v] of Object.entries(out)) console.log(k, JSON.stringify(v.median), 'LCP el:', v.lcpElement);
process.exit(0);
