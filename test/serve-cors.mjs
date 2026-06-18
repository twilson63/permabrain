import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { startServer, stopServer } from '../src/serve.mjs';

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-cors-'));
process.env.PERMABRAIN_HOME = tmpHome;
process.env.PERMABRAIN_TRANSPORT = 'local';

function request(port, method, path, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost',
      port,
      method,
      path,
      headers: body ? { 'content-type': 'application/json', ...headers } : headers
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : {};
          resolve({ status: res.statusCode, headers: res.headers, body: parsed, raw: data });
        } catch {
          resolve({ status: res.statusCode, headers: res.headers, body: data, raw: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

console.log('1. default CORS headers on GET /health');
const s1 = await startServer({ home: tmpHome, port: 0 });
const h1 = await request(s1.port, 'GET', '/health');
assert.equal(h1.status, 200, 'health status 200');
assert.equal(h1.headers['access-control-allow-origin'], '*', 'open allow-origin');
assert.ok(h1.headers['access-control-allow-methods'].includes('POST'), 'methods include POST');
assert.ok(h1.headers['access-control-allow-headers'].toLowerCase().includes('x-api-key'), 'headers include x-api-key');
assert.equal(h1.headers.vary, 'Origin', 'Vary: Origin');
await stopServer(s1.server);
console.log('   ✓ default CORS headers present');

console.log('2. OPTIONS preflight returns 204 with CORS headers');
const s2 = await startServer({ home: tmpHome, port: 0 });
const preflight = await request(s2.port, 'OPTIONS', '/api/v1/articles', {
  origin: 'http://example.com',
  'access-control-request-method': 'POST',
  'access-control-request-headers': 'content-type, x-api-key'
});
assert.equal(preflight.status, 204, 'preflight status 204');
assert.equal(preflight.headers['access-control-allow-origin'], '*', 'preflight allow-origin');
assert.ok(preflight.headers['access-control-allow-headers'].toLowerCase().includes('x-api-key'), 'preflight allows x-api-key');
assert.equal(preflight.headers['access-control-max-age'], '86400', 'preflight max-age');
await stopServer(s2.server);
console.log('   ✓ OPTIONS preflight works');

console.log('3. POST with Origin header echoes CORS allow-origin');
const s3 = await startServer({ home: tmpHome, port: 0 });
const pub = await request(s3.port, 'POST', '/api/v1/articles', {
  origin: 'http://app.example.com'
}, {
  title: 'CORS test',
  content: 'CORS request body',
  kind: 'subject',
  topic: 'cors',
  sourceUrl: 'http://example.com/cors'
});
assert.equal(pub.status, 201, 'publish status 201');
assert.equal(pub.headers['access-control-allow-origin'], '*', 'publish allow-origin');
assert.ok(pub.body.summary?.key, 'publish returns key');
await stopServer(s3.server);
console.log('   ✓ actual CORS request works');

console.log('4. configured specific origin allows matching origin');
const s4 = await startServer({ home: tmpHome, port: 0, corsOrigin: 'http://trusted.app' });
const match = await request(s4.port, 'GET', '/health', { origin: 'http://trusted.app' });
assert.equal(match.status, 200, 'matching origin status 200');
assert.equal(match.headers['access-control-allow-origin'], 'http://trusted.app', 'echo matching origin');
await stopServer(s4.server);
console.log('   ✓ configured origin accepted');

console.log('5. configured specific origin omits header for non-matching origin');
const s5 = await startServer({ home: tmpHome, port: 0, corsOrigin: 'http://trusted.app' });
const mismatch = await request(s5.port, 'GET', '/health', { origin: 'http://evil.app' });
assert.equal(mismatch.status, 200, 'non-matching request still succeeds');
assert.ok(!mismatch.headers['access-control-allow-origin'], 'no CORS header for mismatch');
await stopServer(s5.server);
console.log('   ✓ non-matching origin blocked from CORS');

console.log('\n✅ All CORS tests passed');
