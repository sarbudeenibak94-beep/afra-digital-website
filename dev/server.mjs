// Local preview server — development/testing only, never deployed (see .vercelignore).
// Zero dependencies. Approximates Vercel's static hosting for this project:
//   - serves files from the project root
//   - emulates `cleanUrls` (/terms -> terms.html, /terms.html -> 308 /terms; /services -> services/index.html)
//   - emulates `trailingSlash: false` (/services/ -> 308 /services)
//   - applies `headers` rules from vercel.json
//   - routes /api/<name> to api/<name>.js (Node req/res handler)
//   - serves 404.html for unknown paths
// Usage: node dev/server.mjs [port]
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { brotliCompressSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || process.env.PORT || 4173);
const require = createRequire(import.meta.url);

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.md': 'text/markdown; charset=utf-8',
};

// Paths Vercel would not serve (mirrors .vercelignore intent).
const BLOCKED = [/^\/dev\//, /^\/tests\//, /^\/\.git/, /^\/\.vercelignore$/, /^\/\.gitignore$/, /^\/api\/_/, /^\/vercel\.json$/];

function loadConfig() {
  const p = path.join(ROOT, 'vercel.json');
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {};
}

// Minimal path-to-regexp for the patterns used in vercel.json ("/(.*)", "/assets/(.*)", exact paths).
// Each "(.*)" is kept as a wildcard; everything else is matched literally. (Before Phase 05 the "." inside
// "(.*)" was escaped first, so "/(.*)" only matched "/" and nested paths got no headers locally.)
function sourceToRegex(source) {
  const esc = source.split('(.*)').map(s => s.replace(/[.+?^${}()|[\]\\*]/g, '\\$&')).join('(.*)');
  return new RegExp('^' + esc + '$');
}

function applyHeaders(cfg, urlPath, res) {
  for (const rule of cfg.headers || []) {
    if (sourceToRegex(rule.source).test(urlPath)) for (const h of rule.headers) res.setHeader(h.key, h.value);
  }
}

async function tryFile(p) {
  try { const s = await stat(p); return s.isFile() ? p : null; } catch { return null; }
}

async function resolveStatic(urlPath, cfg) {
  const clean = cfg.cleanUrls;
  const rel = decodeURIComponent(urlPath).replace(/^\/+/, '');
  const abs = path.join(ROOT, rel);
  if (!abs.startsWith(ROOT)) return { status: 403 };
  const noSlash = cfg.trailingSlash === false;
  if (clean && /\.html$/.test(urlPath)) {
    let target = urlPath.replace(/(index)?\.html$/, '') || '/';
    if (noSlash && target.length > 1) target = target.replace(/\/$/, '');
    return { redirect: target === '' ? '/' : target };
  }
  // `trailingSlash: false`: /services/ -> 308 /services (as on Vercel)
  if (noSlash && urlPath.length > 1 && urlPath.endsWith('/')) return { redirect: urlPath.replace(/\/+$/, '') };
  if (urlPath.endsWith('/')) { const f = await tryFile(path.join(abs, 'index.html')); if (f) return { file: f }; }
  const direct = await tryFile(abs); if (direct) return { file: direct };
  if (clean) { const f = await tryFile(abs + '.html'); if (f) return { file: f }; }
  // a directory's index.html at its clean path (/services -> services/index.html), as on Vercel
  { const f = await tryFile(path.join(abs, 'index.html')); if (f) return { file: f }; }
  return { status: 404 };
}

const server = http.createServer(async (req, res) => {
  const cfg = loadConfig();
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;
  try {
    if (BLOCKED.some(r => r.test(p))) { res.statusCode = 404; return res.end('Not found'); }
    const redirect = (cfg.redirects || []).find(r => sourceToRegex(r.source).test(p));
    if (redirect) { res.statusCode = redirect.permanent ? 308 : 307; res.setHeader('Location', redirect.destination); return res.end(); }
    if (p.startsWith('/api/')) {
      const name = p.slice(5).replace(/[^a-z0-9-]/gi, '');
      const file = path.join(ROOT, 'api', name + '.js');
      if (!existsSync(file)) { res.statusCode = 404; return res.end('Not found'); }
      delete require.cache[require.resolve(file)];
      const mod = require(file);
      const handler = mod.default || mod;
      applyHeaders(cfg, p, res);
      return await handler(req, res);
    }
    const r = await resolveStatic(p, cfg);
    if (r.redirect) { res.statusCode = 308; res.setHeader('Location', r.redirect + url.search); return res.end(); }
    if (r.file) {
      applyHeaders(cfg, p, res);
      const type = TYPES[path.extname(r.file).toLowerCase()] || 'application/octet-stream';
      res.setHeader('Content-Type', type);
      let body = await readFile(r.file);
      // Vercel serves text assets with Brotli; mirror that so throttled timings are realistic.
      if (/text|javascript|json|xml|svg|manifest/.test(type) && /\bbr\b/.test(req.headers['accept-encoding'] || '')) {
        body = brotliCompressSync(body); res.setHeader('Content-Encoding', 'br');
      }
      return res.end(body);
    }
    res.statusCode = r.status || 404;
    const nf = await tryFile(path.join(ROOT, '404.html'));
    if (nf) { applyHeaders(cfg, '/404', res); res.setHeader('Content-Type', TYPES['.html']); return res.end(await readFile(nf)); }
    res.end('Not found');
  } catch (err) {
    console.error('[dev-server]', err && err.message);
    if (!res.headersSent) res.statusCode = 500;
    res.end('Internal error');
  }
});

server.listen(PORT, () => console.log(`dev server http://localhost:${PORT}`));
