// Responsive / header layout check across required viewport widths.
// Usage: node tests/responsive.mjs <baseUrl> [label] [--shots]
// Fails (exit 1) on: horizontal page scroll, clipped/overflowing header controls, header wrapping,
// overlapping header groups, or uncaught exceptions.
import { launch, sleep } from './lib/cdp.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';

const BASE = process.argv[2] || 'http://localhost:4173/';
const LABEL = process.argv[3] || 'run';
const SHOTS = process.argv.includes('--shots');
const WIDTHS = [320, 375, 390, 414, 480, 768, 769, 820, 900, 1000, 1024, 1100, 1150, 1200, 1280, 1440, 1920];

const outDir = new URL(`./results/shots-${LABEL}/`, import.meta.url);
mkdirSync(outDir, { recursive: true });
const browser = await launch({ port: 9342 });
const results = {}; let failures = 0;

for (const w of WIDTHS) {
  const mobile = w <= 1024;
  const p = await browser.newPage({ width: w, height: mobile && w < 700 ? 800 : 900, mobile, disableCache: false });
  await p.goto(BASE);
  await sleep(2600);
  const r = await p.eval(`(() => {
    const vw = innerWidth, vis = el => { if (!el) return false; const cs = getComputedStyle(el), rc = el.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && rc.width > 0 && rc.height > 0; };
    // Site pages use the #nav header; legal pages (privacy, terms) use a simpler <header class="site-header">.
    const siteNav = !!document.getElementById('nav');
    const nav = document.getElementById('nav') || document.querySelector('header'), inner = nav.querySelector('.nav-inner') || nav.querySelector('.wrap') || nav;
    const groups = [...inner.children].filter(vis).map(el => { const r = el.getBoundingClientRect(); return { cls: el.className || el.tagName, left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom) }; });
    const controls = [...nav.querySelectorAll('a,button')].filter(vis).map(el => { const r = el.getBoundingClientRect(); return { t: (el.textContent || el.getAttribute('aria-label') || '').trim().replace(/\\s+/g,' '), left: Math.round(r.left), right: Math.round(r.right), h: Math.round(r.height) }; });
    const clipped = controls.filter(c => c.right > vw + 0.5 || c.left < -0.5);
    let overlap = false; for (let i = 1; i < groups.length; i++) if (groups[i].left < groups[i - 1].right - 1) overlap = true;
    const links = nav.querySelector('.nav-links');
    const linkItems = links && vis(links) ? [...links.querySelectorAll('a')].map(a => Math.round(a.getBoundingClientRect().height)) : [];
    const wrapped = linkItems.some(h => h > 40);
    return { vw, siteNav, scrollWidth: document.documentElement.scrollWidth, horizontalScroll: document.documentElement.scrollWidth > vw,
      navHeight: Math.round(nav.getBoundingClientRect().height), hamburger: vis(document.getElementById('hamburger')), desktopLinks: vis(links),
      groups, clipped, overlap, wrapped, cta: controls.find(c => /start project/i.test(c.t)) || null };
  })()`);
  r.exceptions = p.log.exceptions;
  // The "Start Project" CTA is required wherever the site navigation (#nav) is used; legal pages have none.
  const bad = r.horizontalScroll || r.clipped.length || r.overlap || r.wrapped || r.exceptions.length || (r.siteNav && !r.cta);
  r.pass = !bad; if (bad) failures++;
  results[w] = r;
  if (SHOTS) writeFileSync(new URL(`top-${w}.png`, outDir), await p.screenshot());
  console.log(`${String(w).padStart(4)}px ${r.pass ? 'PASS' : 'FAIL'} nav=${r.navHeight}px ${r.siteNav ? (r.hamburger ? 'hamburger' : 'links') : 'legal-header'} scrollW=${r.scrollWidth}` +
    (r.clipped.length ? ' CLIPPED:' + r.clipped.map(c => c.t + '[' + c.left + ',' + c.right + ']').join(',') : '') + (r.overlap ? ' OVERLAP' : '') + (r.wrapped ? ' WRAPPED' : '') + (r.exceptions.length ? ' EXC:' + r.exceptions[0].slice(0, 80) : '') + (r.siteNav && !r.cta ? ' NO-CTA' : ''));
  await p.close();
}
await browser.close();
writeFileSync(new URL(`./results/responsive-${LABEL}.json`, import.meta.url), JSON.stringify(results, null, 2));
console.log(failures ? `\n${failures} width(s) FAILED` : '\nALL WIDTHS PASS');
process.exit(failures ? 1 : 0);
