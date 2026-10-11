// Builds assets/js/hero-robot.js from dev/hero-robot/hero-robot.src.js: one self-hosted ES module containing only the
// Three.js parts the robot uses (tree-shaken, minified, Three.js MIT licence kept at the end of the file).
// The site itself has no package.json or build step, so the two build tools live in a throwaway folder:
//   mkdir robot-build && cd robot-build && npm init -y && npm i --save-exact three@0.186.1 esbuild@0.25.10
//   node dev/hero-robot/build.mjs <path-to-robot-build>
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { statSync } from 'node:fs';
import { gzipSync, brotliCompressSync } from 'node:zlib';
import { readFileSync } from 'node:fs';

const deps = process.argv[2];
if (!deps) { console.error('usage: node dev/hero-robot/build.mjs <folder with node_modules/three and node_modules/esbuild>'); process.exit(1); }
const require = createRequire(path.join(path.resolve(deps), 'package.json'));
const esbuild = require('esbuild');
const threeVersion = JSON.parse(readFileSync(path.join(path.resolve(deps), 'node_modules', 'three', 'package.json'), 'utf8')).version;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = path.join(ROOT, 'assets', 'js', 'hero-robot.js');

await esbuild.build({
  entryPoints: [path.join(ROOT, 'dev', 'hero-robot', 'hero-robot.src.js')],
  outfile: out, bundle: true, format: 'esm', minify: true, target: ['es2020'],
  legalComments: 'eof', nodePaths: [path.join(path.resolve(deps), 'node_modules')],
  banner: { js: `/* AFRA DIGITAL hero robot (Design D6) — built from dev/hero-robot/hero-robot.src.js with three@${threeVersion} (MIT). */` },
  logLevel: 'warning',
});
const buf = readFileSync(out);
console.log(`built ${path.relative(ROOT, out)}: ${(statSync(out).size / 1024).toFixed(1)} KB raw, ${(gzipSync(buf).length / 1024).toFixed(1)} KB gzip, ${(brotliCompressSync(buf).length / 1024).toFixed(1)} KB brotli (three@${threeVersion})`);
