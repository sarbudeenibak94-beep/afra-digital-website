// Tiny Chrome DevTools Protocol helper (zero dependencies; uses the locally installed Chrome
// and Node's built-in WebSocket/fetch). Test tooling only — never deployed.
import { spawn } from 'node:child_process';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

export const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function launch({ port = 9340 } = {}) {
  const exe = CANDIDATES.find(p => existsSync(p));
  if (!exe) throw new Error('No Chrome/Edge found; set CHROME_PATH');
  const profile = mkdtempSync(path.join(tmpdir(), 'afra-cdp-'));
  const proc = spawn(exe, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--disable-extensions', 'about:blank'], { stdio: 'ignore' });
  let ver;
  for (let i = 0; i < 80 && !ver; i++) { try { ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); } catch { await sleep(150); } }
  if (!ver) throw new Error('Chrome did not start');
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map(); const listeners = new Set();
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
    else listeners.forEach(l => l(m));
  };
  const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
    const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params, sessionId }));
  });

  async function newPage({ width = 1440, height = 900, mobile = false, throttle = null, disableCache = true, initScript = '' } = {}) {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const S = (m, p) => send(m, p, sessionId);
    const log = { exceptions: [], console: [], requests: [], responses: [], cspViolations: [] };
    const waiters = [];
    const listener = m => {
      if (m.sessionId !== sessionId) return;
      const p = m.params;
      if (m.method === 'Runtime.exceptionThrown') log.exceptions.push(p.exceptionDetails.exception?.description || p.exceptionDetails.text);
      if (m.method === 'Runtime.consoleAPICalled' && (p.type === 'error' || p.type === 'warning')) log.console.push(`${p.type}: ` + p.args.map(a => a.value ?? a.description).join(' '));
      if (m.method === 'Log.entryAdded' && (p.entry.level === 'error' || p.entry.level === 'warning')) {
        const text = `${p.entry.level}: ${p.entry.text} ${p.entry.url || ''}`.trim();
        log.console.push(text);
        if (/Content Security Policy/i.test(p.entry.text)) log.cspViolations.push(text);
      }
      if (m.method === 'Network.requestWillBeSent') log.requests.push({ url: p.request.url, method: p.request.method, postData: p.request.postData });
      if (m.method === 'Network.responseReceived') log.responses.push({ url: p.response.url, status: p.response.status, headers: p.response.headers });
      waiters.forEach(w => w(m));
    };
    listeners.add(listener);
    await S('Runtime.enable'); await S('Log.enable'); await S('Network.enable'); await S('Page.enable');
    await S('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
    if (mobile) await S('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    if (throttle) {
      await S('Network.emulateNetworkConditions', { offline: false, latency: throttle.latency, downloadThroughput: throttle.down, uploadThroughput: throttle.up });
      await S('Emulation.setCPUThrottlingRate', { rate: throttle.cpu });
    }
    await S('Network.setCacheDisabled', { cacheDisabled: disableCache });
    if (initScript) await S('Page.addScriptToEvaluateOnNewDocument', { source: initScript });

    const page = {
      S, log,
      async goto(url, { waitFor = 'load', timeout = 90000 } = {}) {
        const evName = waitFor === 'load' ? 'Page.loadEventFired' : 'Page.domContentEventFired';
        const done = new Promise((res, rej) => {
          const t = setTimeout(() => rej(new Error('navigation timeout ' + url)), timeout);
          const w = m => { if (m.sessionId === sessionId && m.method === evName) { clearTimeout(t); waiters.splice(waiters.indexOf(w), 1); res(); } };
          waiters.push(w);
        });
        await S('Page.navigate', { url });
        await done;
      },
      async eval(expression) {
        const r = await S('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
        if (r.exceptionDetails) throw new Error('eval failed: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
        return r.result.value;
      },
      async screenshot(opts = {}) { return Buffer.from((await S('Page.captureScreenshot', { format: 'png', ...opts })).data, 'base64'); },
      async key(key, code = key, keyCode = 0, modifiers = 0) {
        await S('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: keyCode, modifiers });
        await S('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode, modifiers });
      },
      async close() { listeners.delete(listener); await send('Target.closeTarget', { targetId }); },
    };
    return page;
  }

  return {
    newPage,
    async close() { try { ws.close(); } catch {} proc.kill(); },
  };
}

// "Slow 4G-ish" profile used in the Phase 01 audit, kept identical for before/after comparison.
export const MOBILE_THROTTLE = { latency: 150, down: 1.6 * 1024 * 1024 / 8, up: 750 * 1024 / 8, cpu: 4 };
