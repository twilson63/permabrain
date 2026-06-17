import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { createServer, startServer, stopServer } from '../src/serve.mjs';
import { api } from '../src/agent-api.mjs';

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-serve-'));
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

console.log('1. startServer initializes identity and exposes /health');
const started = await startServer({ home: tmpHome, port: 0 });
server = started.server;
port = started.port;
assert.ok(port > 0, 'port assigned');
assert.ok(started.agentId, 'agentId created');
assert.equal(started.home, tmpHome, 'home set');
const health = await request('GET', '/health');
assert.equal(health.status, 200, 'health status 200');
assert.equal(health.body.ok, true, 'health ok');
assert.equal(health.body.home, tmpHome, 'health home');
assert.equal(health.body.transport, 'local', 'health transport local');
console.log('   ✓ /health returns identity and home');

console.log('2. POST /api/v1/init runs idempotently');
const init = await request('POST', '/api/v1/init', { home: tmpHome, transport: 'local' });
assert.equal(init.status, 200, 'init status 200');
assert.ok(init.body.agentId, 'init returns agentId');
assert.equal(init.body.home, tmpHome, 'init returns home');
console.log('   ✓ /api/v1/init initializes');

console.log('3. POST /api/v1/articles publishes an article');
const article = await request('POST', '/api/v1/articles', {
  title: 'HTTP Server Test',
  content: 'Local HTTP server test article',
  kind: 'subject',
  topic: 'server-test',
  sourceUrl: 'http://example.com/test',
  sourceName: 'test-source',
  language: 'en'
});
assert.equal(article.status, 201, 'publish status 201');
assert.ok(article.body.summary?.id, 'publish returns summary.id');
assert.ok(article.body.summary?.key, 'publish returns key');
console.log('   ✓ /api/v1/articles publishes and returns key');

const key = article.body.summary.key;

console.log('4. GET /api/v1/articles/:key returns the article');
const get = await request('GET', `/api/v1/articles/${encodeURIComponent(key)}`);
assert.equal(get.status, 200, 'get status 200');
assert.equal(get.body.content, 'Local HTTP server test article', 'get content');
assert.equal(get.body.topic, 'server-test', 'get topic');
console.log('   ✓ /api/v1/articles/:key returns article');

console.log('5. GET /api/v1/articles queries by topic');
const query = await request('GET', '/api/v1/articles?topic=server-test');
assert.equal(query.status, 200, 'query status 200');
assert.ok(query.body.articles.length >= 1, 'query has results');
console.log('   ✓ /api/v1/articles query works');

console.log('6. POST /api/v1/articles/:key/attest creates attestation');
const attest = await request('POST', `/api/v1/articles/${encodeURIComponent(key)}/attest`, {
  opinion: 'valid',
  confidence: 0.9,
  reason: 'It looks correct via HTTP.'
});
assert.equal(attest.status, 201, 'attest status 201');
assert.ok(attest.body.summary?.id, 'attest returns summary.id');
console.log('   ✓ /api/v1/articles/:key/attest works');

console.log('7. GET /api/v1/articles/:key/consensus returns consensus');
const consensus = await request('GET', `/api/v1/articles/${encodeURIComponent(key)}/consensus`);
assert.equal(consensus.status, 200, 'consensus status 200');
assert.ok(consensus.body.score !== undefined, 'consensus has score');
console.log('   ✓ /api/v1/articles/:key/consensus works');

console.log('8. GET /api/v1/metrics returns aggregate metrics');
const metrics = await request('GET', '/api/v1/metrics');
assert.equal(metrics.status, 200, 'metrics status 200');
assert.equal(metrics.body.totals.articles, 1, 'metrics articles count');
console.log('   ✓ /api/v1/metrics works');

console.log('9. GET /api/v1/stats returns dashboard stats');
const stats = await request('GET', '/api/v1/stats');
assert.equal(stats.status, 200, 'stats status 200');
assert.ok(stats.body.totals, 'stats has totals');
assert.ok(stats.body.consensus, 'stats has consensus');
assert.ok(stats.body.agents, 'stats has agents');
assert.ok(stats.body.activity, 'stats has activity');
console.log('   ✓ /api/v1/stats works');

console.log('10. GET /api/v1/status returns node status');
const status = await request('GET', '/api/v1/status');
assert.equal(status.status, 200, 'status 200');
assert.equal(status.body.transport, 'local', 'status transport local');
assert.ok(status.body.summary, 'status has summary');
console.log('   ✓ /api/v1/status works');

console.log('11. GET /api/v1/identity returns public identity');
const identity = await request('GET', '/api/v1/identity');
assert.equal(identity.status, 200, 'identity status 200');
assert.ok(identity.body.agentId, 'identity has agentId');
assert.ok(identity.body.type, 'identity has type');
console.log('   ✓ /api/v1/identity works');

console.log('12. unknown route returns 404');
const notFound = await request('GET', '/api/v1/not-a-route');
assert.equal(notFound.status, 404, 'unknown route 404');
console.log('   ✓ 404 on unknown routes');

await stopServer(server);

// Reset singleton state to avoid leaking into other tests
api._home = undefined;
api._identity = undefined;
api._config = undefined;

fs.rmSync(tmpHome, { recursive: true, force: true });

console.log('\n✅ All serve tests passed');
