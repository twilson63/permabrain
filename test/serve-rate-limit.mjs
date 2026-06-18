/**
 * Test: HTTP API rate limiting on permabrain serve endpoints
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { startServer, stopServer } from '../src/serve.mjs';

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-serve-rate-limit-'));
process.env.PERMABRAIN_HOME = tmpHome;
process.env.PERMABRAIN_TRANSPORT = 'local';

function request(method, path, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost',
      port,
      method,
      path,
      headers: extraHeaders
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = data ? JSON.parse(data) : {};
          resolve({ status: res.statusCode, body: json, raw: data, headers: res.headers });
        } catch {
          resolve({ status: res.statusCode, body: data, raw: data, headers: res.headers });
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

let server;
let port;

console.log('1. startServer with rate limiting');
const started = await startServer({
  home: tmpHome,
  port: 0,
  rateLimit: 2,
  rateWindow: 1000,
  rateBurst: 1
});
server = started.server;
port = started.port;
assert.ok(port > 0, 'port assigned');
console.log('   ✓ server started with rate limit');

console.log('2. rate limit headers on successful requests');
const r1 = await request('GET', '/health');
assert.equal(r1.status, 200);
assert.equal(r1.headers['ratelimit-limit'], '3', 'limit is max+burst');
assert.equal(r1.headers['ratelimit-remaining'], '2', 'one consumed');
assert.ok(r1.headers['ratelimit-reset'], 'reset present');
console.log('   ✓ rate limit headers present');

console.log('3. burst allowance is consumed');
const r2 = await request('GET', '/health');
assert.equal(r2.headers['ratelimit-remaining'], '1');
const r3 = await request('GET', '/health');
assert.equal(r3.headers['ratelimit-remaining'], '0');
console.log('   ✓ burst consumed sequentially');

console.log('4. exceeding limit returns 429 with Retry-After');
const r4 = await request('GET', '/health');
assert.equal(r4.status, 429, 'status 429');
assert.ok(r4.body.error?.includes('Rate limit'), 'error message');
assert.ok(r4.headers['retry-after'], 'Retry-After present');
assert.equal(r4.headers['ratelimit-remaining'], '0');
console.log('   ✓ 429 returned when limit exceeded');

console.log('5. stream routes are exempt from HTTP rate limiting');
const sse = await new Promise((resolve, reject) => {
  const req = http.request({ hostname: 'localhost', port, method: 'GET', path: '/api/v1/events/stream' }, (res) => {
    resolve({ status: res.statusCode });
    // Destroy the response so the server-side SSE connection closes.
    res.destroy();
  });
  req.on('error', reject);
  req.end();
});
assert.equal(sse.status, 200, 'SSE not rate limited');
console.log('   ✓ stream routes exempt');

console.log('6. rate limit disabled with max=0');
const tmpHome2 = fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-serve-rate-limit-off-'));
const started2 = await startServer({ home: tmpHome2, port: 0, rateLimit: 0 });
const server2 = started2.server;
const port2 = started2.port;
for (let i = 0; i < 5; i++) {
  const r = await new Promise((resolve, reject) => {
    const req = http.request({ hostname: 'localhost', port: port2, method: 'GET', path: '/health' }, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => resolve({ status: res.statusCode }));
    });
    req.on('error', reject);
    req.end();
  });
  assert.equal(r.status, 200, `request ${i + 1} allowed when disabled`);
}
await stopServer(server2);
console.log('   ✓ disabled limiter allows unlimited requests');

await stopServer(server);
console.log('\n✅ All serve rate-limit tests passed');
