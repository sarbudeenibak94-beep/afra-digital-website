// Generates optimised web assets from the original brand images (originals are left untouched).
// Uses headless Chrome's canvas encoders (WebP/PNG/JPEG) — no image libraries required.
// Usage: node dev/build-images.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from '../tests/lib/cdp.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'assets', 'img');
mkdirSync(OUT, { recursive: true });

const dataUrl = (file, mime) => `data:${mime};base64,` + readFileSync(path.join(ROOT, file)).toString('base64');
const SRC = {
  logo: dataUrl('afra-logo.png', 'image/png'),
  social: dataUrl('afra-social-preview.jpg', 'image/png'), // file is PNG data despite .jpg name
  bg: dataUrl('ai-background.jpg', 'image/png'),           // file is PNG data despite .jpg name
};
const BRAND_BG = '#020617';
// Crop of the "AD" falcon mark inside the 1024x1024 logo (excludes the small wordmark text).
const MARK = { x: 100, y: 110, w: 820, h: 600 };

const browser = await launch({ port: 9343 });
const page = await browser.newPage({ width: 800, height: 600 });
await page.goto('about:blank');
await page.eval(`window.__src = ${JSON.stringify(SRC)}; window.__imgs = {}; Promise.all(Object.entries(window.__src).map(([k, u]) => new Promise((res, rej) => { const i = new Image(); i.onload = () => { window.__imgs[k] = i; res(); }; i.onerror = rej; i.src = u; })))`);

async function render(spec) {
  // spec: { img, w, h, mime, q, bg, sx, sy, sw, sh, fit:'cover'|'contain'|'stretch', pad }
  return page.eval(`(() => {
    const s = ${JSON.stringify(spec)}; const img = window.__imgs[s.img];
    const c = document.createElement('canvas'); c.width = s.w; c.height = s.h; const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    if (s.bg) { ctx.fillStyle = s.bg; if (s.radius) { ctx.beginPath(); ctx.roundRect(0, 0, s.w, s.h, s.radius); ctx.fill(); } else ctx.fillRect(0, 0, s.w, s.h); }
    const sx = s.sx ?? 0, sy = s.sy ?? 0, sw = s.sw ?? img.naturalWidth, sh = s.sh ?? img.naturalHeight;
    const pad = s.pad || 0, bw = s.w - pad * 2, bh = s.h - pad * 2;
    let dw = bw, dh = bh;
    if (s.fit === 'contain') { const r = Math.min(bw / sw, bh / sh); dw = sw * r; dh = sh * r; }
    if (s.fit === 'cover') { const r = Math.max(bw / sw, bh / sh); dw = sw * r; dh = sh * r; }
    // Progressive halving for large downscales gives sharper results than one big step.
    let srcCanvas = img, curW = sw, curH = sh, ox = sx, oy = sy;
    while (curW / 2 > dw && curH / 2 > dh) {
      const t = document.createElement('canvas'); t.width = Math.round(curW / 2); t.height = Math.round(curH / 2);
      const tc = t.getContext('2d'); tc.imageSmoothingQuality = 'high'; tc.drawImage(srcCanvas, ox, oy, curW, curH, 0, 0, t.width, t.height);
      srcCanvas = t; curW = t.width; curH = t.height; ox = 0; oy = 0;
    }
    ctx.drawImage(srcCanvas, ox, oy, curW, curH, pad + (bw - dw) / 2, pad + (bh - dh) / 2, dw, dh);
    return c.toDataURL(s.mime, s.q);
  })()`);
}
const save = (name, durl) => { const buf = Buffer.from(durl.split(',')[1], 'base64'); writeFileSync(path.join(OUT, name), buf); return buf.length; };
const report = [];
const put = async (name, spec, dest) => {
  const durl = await render(spec);
  const buf = Buffer.from(durl.split(',')[1], 'base64');
  writeFileSync(dest || path.join(OUT, name), buf);
  report.push(`${name.padEnd(34)} ${spec.w}x${spec.h} ${(buf.length / 1024).toFixed(1)} KB`);
  return buf;
};

// 1) Full logo (transparent) for on-page use
for (const w of [128, 256, 384, 640, 960]) await put(`afra-logo-${w}.webp`, { img: 'logo', w, h: w, mime: 'image/webp', q: 0.86, fit: 'stretch' });
await put('afra-logo-512.png', { img: 'logo', w: 512, h: 512, mime: 'image/png', fit: 'stretch' }); // for structured data / fallbacks

// 2) Icons: falcon "AD" mark on brand background (legible at small sizes)
const icon = (w, extra = {}) => ({ img: 'logo', w, h: w, mime: 'image/png', bg: BRAND_BG, sx: MARK.x, sy: MARK.y, sw: MARK.w, sh: MARK.h, fit: 'contain', ...extra });
const fav16 = await put('favicon-16.png', icon(16, { pad: 0 }));
const fav32 = await put('favicon-32.png', icon(32, { pad: 1 }));
const fav48 = await put('favicon-48.png', icon(48, { pad: 2 }));
await put('apple-touch-icon.png', icon(180, { pad: 14 }), path.join(ROOT, 'apple-touch-icon.png'));
await put('icon-192.png', icon(192, { pad: 14, radius: 0 }));
await put('icon-512.png', icon(512, { pad: 36 }));
await put('icon-maskable-512.png', icon(512, { pad: 72 })); // content inside the 80% safe zone

// favicon.ico — ICO container with embedded PNGs (supported by all current browsers)
{
  const imgs = [[16, fav16], [32, fav32], [48, fav48]];
  const header = Buffer.alloc(6); header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(imgs.length, 4);
  const dir = Buffer.alloc(16 * imgs.length); let offset = 6 + dir.length;
  imgs.forEach(([s, b], i) => {
    const o = i * 16; dir.writeUInt8(s, o); dir.writeUInt8(s, o + 1); dir.writeUInt8(0, o + 2); dir.writeUInt8(0, o + 3);
    dir.writeUInt16LE(1, o + 4); dir.writeUInt16LE(32, o + 6); dir.writeUInt32LE(b.length, o + 8); dir.writeUInt32LE(offset, o + 12); offset += b.length;
  });
  const ico = Buffer.concat([header, dir, ...imgs.map(x => x[1])]);
  writeFileSync(path.join(ROOT, 'favicon.ico'), ico);
  report.push(`${'favicon.ico'.padEnd(34)} 16/32/48 ${(ico.length / 1024).toFixed(1)} KB`);
}

// 3) About-panel background
for (const w of [800, 1300]) await put(`ai-background-${w}.webp`, { img: 'bg', w, h: Math.round(w * 1024 / 1536), mime: 'image/webp', q: 0.72, fit: 'cover' });

// 4) Social preview: 1200x630 JPEG, quality stepped down until <= 300 KB
{
  let q = 0.86, buf;
  for (;;) {
    const durl = await render({ img: 'social', w: 1200, h: 630, mime: 'image/jpeg', q, fit: 'cover', bg: '#000000' });
    buf = Buffer.from(durl.split(',')[1], 'base64');
    if (buf.length <= 300 * 1024 || q <= 0.6) break; q -= 0.04;
  }
  writeFileSync(path.join(OUT, 'og-afra-digital-1200x630.jpg'), buf);
  report.push(`${'og-afra-digital-1200x630.jpg'.padEnd(34)} 1200x630 ${(buf.length / 1024).toFixed(1)} KB (q=${q.toFixed(2)})`);
}

await browser.close();
console.log(report.join('\n'));
process.exit(0);
