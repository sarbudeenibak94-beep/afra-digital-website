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
  res.statusCode = 404; res.end();
}).listen(PORT, () => console.log(`mock email provider http://localhost:${PORT} (mode=${mode})`));
