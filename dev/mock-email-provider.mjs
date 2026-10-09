// Mock of the Resend "send email" endpoint — development/testing only, never deployed.
// Lets the real /api/contact code path run end-to-end without sending any real email.
// Behaviour is selected per request by the MOCK_MODE env var or the x-mock-mode header:
//   success (default) | fail (500) | reject (422) | slow (responds after 20 s)
// Received payloads are kept in memory and exposed at GET /__received (for test assertions).
// Usage: node dev/mock-email-provider.mjs [port]
import http from 'node:http';

const PORT = Number(process.argv[2] || 4174);
let mode = process.env.MOCK_MODE || 'success';
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
      received.push({ at: new Date().toISOString(), mode, hasBearer: auth.startsWith('Bearer '), payload: parsed });
      const send = (code, obj) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(obj)); };
      if (mode === 'fail') return send(500, { name: 'internal_server_error', message: 'mock failure' });
      if (mode === 'reject') return send(422, { name: 'validation_error', message: 'mock rejection' });
      if (mode === 'slow') return setTimeout(() => send(200, { id: 'mock-slow' }), 20000);
      return send(200, { id: 'mock-' + received.length });
    });
    return;
  }
  res.statusCode = 404; res.end();
}).listen(PORT, () => console.log(`mock email provider http://localhost:${PORT} (mode=${mode})`));
