// Mock of the Resend "send email" endpoint and of Cloudflare Turnstile Siteverify — development/testing only, never deployed.
// Lets the real /api/contact code path run end-to-end without sending any real email.
// Behaviour is selected per request by the MOCK_MODE env var or the x-mock-mode header:
//   success (default) | fail (500) | reject (422) | slow (responds after 20 s)
// Received payloads are kept in memory and exposed at GET /__received (for test assertions).
// Usage: node dev/mock-email-provider.mjs [port]
import http from 'node:http';

const PORT = Number(process.argv[2] || 4174);
let mode = process.env.MOCK_MODE || 'success';
let tsMode = 'success';
const verifications = [], usedTokens = new Set();
const received = [];

http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/__received') {
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify(received));
  }
  if (req.method === 'POST' && req.url.startsWith('/__mode/')) {
    mode = req.url.split('/').pop();
    return res.end(mode);
  }
  if (req.method === 'POST' && req.url === '/emails') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      const auth = req.headers.authorization || '';
      const parsed = (() => { try { return JSON.parse(body); } catch { return null; } })();
      received.push({ at: new Date().toISOString(), mode, hasBearer: auth.startsWith('Bearer '), idempotencyKey: req.headers['idempotency-key'] || null, payload: parsed });
      const send = (code, obj) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(obj)); };
      if (mode === 'fail') return send(500, { name: 'internal_server_error', message: 'mock failure' });
      if (mode === 'reject') return send(422, { name: 'validation_error', message: 'mock rejection' });
      // Real-world Resend rejections observed / documented:
      if (mode === 'testing403') return send(403, { statusCode: 403, name: 'validation_error', message: 'The resend.dev domain is for testing and can only send to your own email address. To send to other recipients, verify a domain and update the from address to use it.' });
      if (mode === 'unverified403') return send(403, { statusCode: 403, name: 'validation_error', message: 'The afra-digital.com domain is not verified. Please, add and verify your domain on https://resend.com/domains' });
      if (mode === 'badkey') return send(403, { statusCode: 403, name: 'invalid_api_key', message: 'API key is invalid' });
      if (mode === 'slow') return setTimeout(() => send(200, { id: 'mock-slow' }), 20000);
      return send(200, { id: 'mock-' + received.length });
    });
    return;
  }
  // ---- Mock of Cloudflare Turnstile Siteverify (POST /siteverify, form-encoded like the real API) ----
  // Outcome per POST /__tsmode/<mode>: success (default; hostname "localhost", action "contact") | strict (single-use
  // tokens: a reused token gets timeout-or-duplicate) | invalid | expired | hostname | action | down (500) |
  // slow (answers after 10 s) | malformed (not JSON) | badsecret. GET /__siteverify lists what was received
  // (token length and whether a secret / remoteip was sent — never the secret itself).
  if (req.method === 'POST' && req.url.startsWith('/__tsmode/')) {
    tsMode = req.url.split('/').pop();
    return res.end(tsMode);
  }
  if (req.method === 'GET' && req.url === '/__siteverify') {
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify(verifications));
  }
  if (req.method === 'POST' && req.url === '/siteverify') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      const f = new URLSearchParams(body);
      const token = f.get('response') || '';
      verifications.push({ at: new Date().toISOString(), mode: tsMode, tokenLength: token.length, hasSecret: !!f.get('secret'), hasRemoteIp: !!f.get('remoteip'), form: req.headers['content-type'] || '' });
      const send = (code, obj) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(obj)); };
      const ok = (extra = {}) => send(200, { success: true, challenge_ts: new Date().toISOString(), hostname: 'localhost', action: 'contact', 'error-codes': [], ...extra });
      const no = codes => send(200, { success: false, 'error-codes': codes });
      if (!token) return no(['missing-input-response']);
      if (tsMode === 'invalid') return no(['invalid-input-response']);
      if (tsMode === 'expired') return no(['timeout-or-duplicate']);
      if (tsMode === 'badsecret') return no(['invalid-input-secret']);
      if (tsMode === 'hostname') return ok({ hostname: 'attacker.example' });
      if (tsMode === 'action') return ok({ action: 'login' });
      if (tsMode === 'down') return send(500, { error: 'mock outage' });
      if (tsMode === 'malformed') { res.statusCode = 200; res.setHeader('Content-Type', 'text/html'); return res.end('<html>not json</html>'); }
      if (tsMode === 'slow') return setTimeout(() => ok(), 10000);
      if (tsMode === 'strict') { if (usedTokens.has(token)) return no(['timeout-or-duplicate']); usedTokens.add(token); }
      return ok();
    });
    return;
  }
  res.statusCode = 404; res.end();
}).listen(PORT, () => console.log(`mock email provider http://localhost:${PORT} (mode=${mode})`));
