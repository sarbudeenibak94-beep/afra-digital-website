// Checks that tests/lib/cdp.mjs removes its throwaway Chrome profiles (they filled the C: drive before this fix).
// Each case runs in a child Node process with its own private TEMP folder, so leftovers can be counted exactly.
// Needs Chrome/Edge (like the other e2e suites). Usage: node tests/cdp-cleanup.e2e.mjs
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const LIB = new URL('./lib/cdp.mjs', import.meta.url).href;
let pass = 0, fail = 0;
const check = (name, ok, info = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); };

function run(code, env = {}) {
  const tmp = mkdtempSync(path.join(tmpdir(), 'cdp-cleanup-check-'));
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', `import { launch } from ${JSON.stringify(LIB)};\n${code}`],
    { env: { ...process.env, TEMP: tmp, TMP: tmp, TMPDIR: tmp, ...env }, encoding: 'utf8', timeout: 90000 });
  const left = readdirSync(tmp).filter(n => n.startsWith('afra-cdp-'));
  rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  return { out: (r.stdout || '').trim(), err: (r.stderr || '').trim(), status: r.status, left };
}

{ // 1. normal use: launch, open a page, close
  const r = run(`const b = await launch({ port: 9590 }); const p = await b.newPage(); await p.goto('about:blank'); console.log(b.profile ? 'profile-ok' : ''); await b.close();`);
  check('close() removes the profile after a normal run', r.status === 0 && r.out === 'profile-ok' && r.left.length === 0, JSON.stringify({ status: r.status, left: r.left, err: r.err.slice(0, 160) }));
}
{ // 2. the script ends without calling close() (e.g. a failing test that calls process.exit)
  const r = run(`const b = await launch({ port: 9591 }); console.log('launched'); process.exit(1);`);
  check('the exit hook removes the profile when close() is never called', r.out === 'launched' && r.left.length === 0, JSON.stringify({ status: r.status, left: r.left }));
}
{ // 3. Chrome never opens its DevTools port (start-up failure): node.exe stands in for a broken Chrome
  const r = run(`try { await launch({ port: 9592 }); console.log('unexpected'); } catch (e) { console.log(e.message); }`, { CHROME_PATH: process.execPath });
  check('a failed start-up removes the profile and reports the error', r.out === 'Chrome did not start' && r.left.length === 0, JSON.stringify({ out: r.out, left: r.left }));
}
{ // 4. opt-out for debugging keeps the profile
  const r = run(`const b = await launch({ port: 9593 }); await b.close();`, { CDP_KEEP_PROFILE: '1' });
  check('CDP_KEEP_PROFILE=1 keeps the profile for debugging', r.status === 0 && r.left.length === 1, JSON.stringify({ left: r.left }));
}
console.log(`${pass}/${pass + fail} cdp cleanup checks passed`);
process.exit(fail ? 1 : 0);
