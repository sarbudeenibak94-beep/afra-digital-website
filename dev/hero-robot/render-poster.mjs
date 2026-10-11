// Renders the static hero poster from the same procedural robot (assets/js/hero-robot.js → renderPoster) in headless
// Chrome and writes transparent WebP files: assets/img/hero-robot-{384,640,960}.webp.
// Needs the local preview server: node dev/server.mjs 4173, then: node dev/hero-robot/render-poster.mjs [baseUrl]
import { launch, sleep } from '../../tests/lib/cdp.mjs';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.argv[2] || 'http://localhost:4173';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SIZES = [384, 640, 960];
const browser = await launch({ port: 9610 });
try {
  const p = await browser.newPage({ width: 1200, height: 1000 });
  await p.goto(BASE + '/'); await sleep(500);
  for (const size of SIZES) {
    const url = await p.eval(`import('/assets/js/hero-robot.js?poster=' + Date.now()).then(m => m.renderPoster(${size}, 'image/webp', ${size <= 384 ? 0.9 : 0.86}))`);
    if (!url.startsWith('data:image/webp')) throw new Error('WebP encoding not supported by this Chrome');
    const buf = Buffer.from(url.split(',')[1], 'base64');
    const out = path.join(ROOT, 'assets', 'img', `hero-robot-${size}.webp`);
    writeFileSync(out, buf);
    console.log(`${path.relative(ROOT, out)}: ${size}×${size}, ${(buf.length / 1024).toFixed(1)} KB`);
  }
  if (p.log.exceptions.length) throw new Error(p.log.exceptions.join('\n'));
} finally { await browser.close(); }
