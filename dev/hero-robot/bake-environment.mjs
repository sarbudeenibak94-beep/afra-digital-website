// Bakes the robot's studio reflections (assets/js/hero-robot.js → bakeEnvironment) in headless Chrome and writes
// assets/img/hero-robot-env.png: the pre-filtered PMREM environment in three.js' cube-UV layout (768×1024, sRGB 8 bit,
// WebGL row order). The live robot loads this file instead of running PMREMGenerator in the browser.
// Re-bake only when studioEnvironment() changes; results differ slightly between GPUs, so commit the baked file.
// Needs the local preview server: node dev/server.mjs 4173, then: node dev/hero-robot/bake-environment.mjs [baseUrl]
import { launch, sleep } from '../../tests/lib/cdp.mjs';
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.argv[2] || 'http://localhost:4173';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const browser = await launch({ port: 9611 });
try {
  const p = await browser.newPage({ width: 1200, height: 1000 });
  await p.goto(BASE + '/'); await sleep(500);
  const r = await p.eval(`import('/assets/js/hero-robot.js?bake=' + Date.now()).then(m => m.bakeEnvironment())`);
  if (r.maxLinear > 1) throw new Error(`environment is HDR (max ${r.maxLinear}); 8-bit storage would clip it`);
  const buf = Buffer.from(r.url.split(',')[1], 'base64');
  const out = path.join(ROOT, 'assets', 'img', 'hero-robot-env.png');
  writeFileSync(out, buf);
  console.log(`${path.relative(ROOT, out)}: ${r.width}×${r.height}, ${(buf.length / 1024).toFixed(1)} KB, max ${r.maxLinear.toFixed(4)}, sha256 ${createHash('sha256').update(buf).digest('hex')}`);
  if (p.log.exceptions.length) throw new Error(p.log.exceptions.join('\n'));
} finally { await browser.close(); }
