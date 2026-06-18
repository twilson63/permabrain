/**
 * Test: POST /api/v1/validate HTTP route
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { startServer, stopServer } from '../src/serve.mjs';
import { api } from '../src/agent-api.mjs';

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-serve-validate-'));
process.env.PERMABRAIN_HOME = tmpHome;
process.env.PERMABRAIN_TRANSPORT = 'local';

let server;
let port;

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost',
      port,
      method,
      path,
      headers: body ? { 'content-type': 'application/json' } : {}
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = data ? JSON.parse(data) : {};
          resolve({ status: res.statusCode, body: json, raw: data });
        } catch (e) {
          resolve({ status: res.statusCode, body: data, raw: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

const validArticle = {
  'App-Name': 'PermaBrain',
  'App-Version': '0.2.0',
  'PermaBrain-Type': 'article',
  'Article-Key': 'subject/http-validate',
  'Article-Kind': 'subject',
  'Article-Title': 'HTTP Validate',
  'Article-Slug': 'http-validate',
  'Article-Topic': 'test',
  'Article-Language': 'en',
  'Article-Version': 1,
  'Article-Source-Name': 'Test',
  'Article-Source-Url': 'https://example.com/v',
  'Article-Content-Hash': 'sha256:' + 'a'.repeat(64),
  'Article-Published-At': '2024-01-01T00:00:00Z',
  'Article-Updated-At': '2024-01-01T00:00:00Z',
  'Author-Agent-Id': 'ed25519:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'Visibility': 'public'
};

const validAttestation = {
  'App-Name': 'PermaBrain',
  'App-Version': '0.2.0',
  'PermaBrain-Type': 'attestation',
  'Attestation-Target-Id': 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'Attestation-Target-Key': 'subject/http-validate',
  'Attestation-Opinion': 'valid',
  'Attestation-Confidence': 0.95,
  'Attestation-Reason': 'Looks good',
  'Attestation-Agent-Id': 'ed25519:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'Attestation-Created-At': '2024-01-01T00:00:00Z'
};

function tagsToDataItem(tags) {
  return { tags: Object.entries(tags).map(([name, value]) => ({ name, value })) };
}

console.log('1. startServer for validate tests');
const started = await startServer({ home: tmpHome, port: 0 });
server = started.server;
port = started.port;
assert.ok(port > 0, 'port assigned');
console.log('   ✓ server started');

console.log('2. POST /api/v1/validate accepts valid article tags');
const r1 = await request('POST', '/api/v1/validate', { type: 'article', tags: validArticle });
assert.equal(r1.status, 200, 'status 200');
assert.equal(r1.body.valid, true, 'valid true');
assert.equal(r1.body.errors.length, 0, 'no errors');
console.log('   ✓ article tags valid');

console.log('3. POST /api/v1/validate accepts valid attestation tags');
const r2 = await request('POST', '/api/v1/validate', { type: 'attestation', tags: validAttestation });
assert.equal(r2.status, 200, 'status 200');
assert.equal(r2.body.valid, true, 'valid true');
console.log('   ✓ attestation tags valid');

console.log('4. POST /api/v1/validate rejects invalid article tags with 422');
const invalid = { ...validArticle };
delete invalid['Article-Title'];
const r3 = await request('POST', '/api/v1/validate', { type: 'article', tags: invalid });
assert.equal(r3.status, 422, 'status 422');
assert.equal(r3.body.valid, false, 'valid false');
assert.ok(r3.body.errors.some(e => e.path === 'Article-Title'), 'missing Article-Title error');
console.log('   ✓ invalid article tags rejected');

console.log('5. POST /api/v1/validate accepts ANS-104 DataItem tag array');
const r4 = await request('POST', '/api/v1/validate', { type: 'article', dataItem: tagsToDataItem(validArticle) });
assert.equal(r4.status, 200, 'status 200');
assert.equal(r4.body.valid, true, 'valid true');
console.log('   ✓ DataItem valid');

console.log('6. POST /api/v1/validate requires tags or dataItem');
const r5 = await request('POST', '/api/v1/validate', { type: 'article' });
assert.equal(r5.status, 400, 'status 400');
assert.ok(r5.body.error.includes('tags') || r5.body.error.includes('dataItem'), 'error mentions tags/dataItem');
console.log('   ✓ missing input rejected');

console.log('7. GET /api/v1/validate returns info');
const r6 = await request('GET', '/api/v1/validate?type=attestation');
assert.equal(r6.status, 200, 'status 200');
assert.equal(r6.body.type, 'attestation', 'type attestation');
assert.ok(r6.body.note.includes('POST'), 'note mentions POST');
console.log('   ✓ validate info returned');

console.log('8. GET /api/v1/schema returns schemas');
const r7 = await request('GET', '/api/v1/schema');
assert.equal(r7.status, 200, 'status 200');
assert.ok(r7.body.article, 'article schema present');
assert.ok(r7.body.attestation, 'attestation schema present');
console.log('   ✓ schemas returned');

await stopServer(server);

api._home = undefined;
api._identity = undefined;
api._config = undefined;

fs.rmSync(tmpHome, { recursive: true, force: true });

console.log('\n✅ All serve-validate tests passed');
