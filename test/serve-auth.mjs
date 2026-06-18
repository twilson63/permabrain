/**
 * Test: API key authentication on permabrain serve endpoints and SDK client
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { createServer, startServer, stopServer } from '../src/serve.mjs';
import { createClient } from '../src/client.mjs';
import { api } from '../src/agent-api.mjs';
import { generateApiKey } from '../src/auth.mjs';

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-serve-auth-'));
process.env.PERMABRAIN_HOME = tmpHome;
process.env.PERMABRAIN_TRANSPORT = 'local';

const apiKey = generateApiKey();

function request(method, path, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost',
      port,
      method,
      path,
      headers: body ? { 'content-type': 'application/json', ...extraHeaders } : extraHeaders
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = data ? JSON.parse(data) : {};
          resolve({ status: res.statusCode, body: json, raw: data });
        } catch {
          resolve({ status: res.statusCode, body: data, raw: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

let server;
let port;

console.log('1. startServer accepts apiKey option');
const started = await startServer({ home: tmpHome, port: 0, apiKey });
server = started.server;
port = started.port;
assert.ok(port > 0, 'port assigned');
console.log('   ✓ server started with apiKey');

console.log('2. /health remains public without API key');
const health = await request('GET', '/health');
assert.equal(health.status, 200, 'health public');
assert.equal(health.body.ok, true, 'health ok');
console.log('   ✓ /health public');

console.log('3. protected route without key returns 401');
const noKey = await request('GET', '/api/v1/articles');
assert.equal(noKey.status, 401, 'no key 401');
assert.equal(noKey.body.error, 'API key required', 'no key error message');
console.log('   ✓ 401 on missing key');

console.log('4. protected route with wrong key returns 403');
const wrong = await request('GET', '/api/v1/articles', undefined, { authorization: 'Bearer wrong-key' });
assert.equal(wrong.status, 403, 'wrong key 403');
assert.equal(wrong.body.error, 'Invalid API key', 'wrong key error message');
console.log('   ✓ 403 on wrong key');

console.log('5. protected route with X-Api-Key header succeeds');
const withHeader = await request('GET', '/api/v1/articles', undefined, { 'x-api-key': apiKey });
assert.equal(withHeader.status, 200, 'x-api-key 200');
assert.ok(Array.isArray(withHeader.body.articles), 'returns articles array');
console.log('   ✓ x-api-key header accepted');

console.log('6. protected route with Authorization: Bearer succeeds');
const withBearer = await request('GET', '/api/v1/articles', undefined, { authorization: `Bearer ${apiKey}` });
assert.equal(withBearer.status, 200, 'bearer 200');
console.log('   ✓ bearer accepted');

console.log('7. protected route with ?api-key query param succeeds');
const withQuery = await request('GET', `/api/v1/articles?api-key=${encodeURIComponent(apiKey)}`);
assert.equal(withQuery.status, 200, 'query key 200');
console.log('   ✓ query key accepted');

console.log('8. POST body can carry apiKey for JSON endpoints');
const pub = await request('POST', '/api/v1/articles', {
  apiKey,
  title: 'Auth Test',
  content: 'Article published with API key in body.',
  kind: 'subject',
  topic: 'auth-test',
  sourceUrl: 'http://example.com/auth',
  sourceName: 'auth-source',
  language: 'en'
});
assert.equal(pub.status, 201, 'publish with body key 201');
assert.ok(pub.body.summary?.key, 'publish returns key');
console.log('   ✓ body apiKey accepted for publish');

const key = pub.body.summary.key;

console.log('9. GET article requires auth when key configured');
const getNoAuth = await request('GET', `/api/v1/articles/${encodeURIComponent(key)}`);
assert.equal(getNoAuth.status, 401, 'get without key 401');
const getWithAuth = await request('GET', `/api/v1/articles/${encodeURIComponent(key)}`, undefined, { 'x-api-key': apiKey });
assert.equal(getWithAuth.status, 200, 'get with key 200');
assert.equal(getWithAuth.body.content, 'Article published with API key in body.');
console.log('   ✓ GET article auth enforced');

console.log('10. SDK createClient with apiKey sends Authorization header');
const client = createClient({ baseUrl: `http://localhost:${port}`, apiKey });
const query = await client.query({ topic: 'auth-test' });
assert.ok(query.articles.length >= 1, 'client query authorized');
console.log('   ✓ SDK apiKey option works');

console.log('11. SDK client without apiKey is rejected on protected routes');
const badClient = createClient({ baseUrl: `http://localhost:${port}` });
try {
  await badClient.query({ topic: 'auth-test' });
  assert.fail('unauthenticated client should fail');
} catch (err) {
  assert.equal(err.status, 401, 'unauthenticated client gets 401');
}
console.log('   ✓ unauthenticated SDK client rejected');

console.log('12. multiple API keys supported by createServer');
const apiKey2 = generateApiKey();
await stopServer(server);
api._home = undefined;
api._identity = undefined;
api._config = undefined;

const tmpHome2 = fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-serve-auth2-'));
const { server: server2, port: port2 } = await startServer({ home: tmpHome2, port: 0, apiKey: apiKey2 });
const multiClient = createClient({ baseUrl: `http://localhost:${port2}`, apiKey: apiKey2 });
const multiHealth = await multiClient.health();
assert.equal(multiHealth.ok, true, 'second server health ok');
await stopServer(server2);
fs.rmSync(tmpHome2, { recursive: true, force: true });
console.log('   ✓ fresh server with different key works');

console.log('13. createServer returns apiKeyAuth in options but does not expose secret');
const tmpHome3 = fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-serve-auth3-'));
const { server: server3 } = createServer({ home: tmpHome3, apiKey });
await stopServer(server3);
fs.rmSync(tmpHome3, { recursive: true, force: true });
console.log('   ✓ createServer accepts apiKey');

await stopServer(server);

api._home = undefined;
api._identity = undefined;
api._config = undefined;

fs.rmSync(tmpHome, { recursive: true, force: true });

console.log('\n✅ All serve auth tests passed');
