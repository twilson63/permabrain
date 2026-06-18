/**
 * Test: HTTP metrics endpoint (`GET /api/v1/metrics`)
 *
 * Verifies runtime counters, JSON/Prometheus responses, filtering,
 * and SDK client.metrics().
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { startServer, stopServer } from '../src/serve.mjs';
import { createClient } from '../src/client.mjs';

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-serve-metrics-'));
process.env.PERMABRAIN_HOME = tmpHome;
process.env.PERMABRAIN_TRANSPORT = 'local';

let server, port;

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: 'localhost', port, method, path, headers: body ? { 'content-type': 'application/json' } : {} }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        const contentType = res.headers['content-type'] || '';
        const parsed = contentType.includes('application/json') && data ? JSON.parse(data) : data;
        resolve({ status: res.statusCode, body: parsed, contentType, raw: data });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

console.log('1. start server');
const started = await startServer({ home: tmpHome, port: 0 });
server = started.server;
port = started.port;
console.log('   ✓ serving on port', port);

console.log('2. GET /api/v1/metrics returns JSON with runtime + data');
const json = await request('GET', '/api/v1/metrics');
assert.equal(json.status, 200, 'metrics status 200');
assert.ok(json.body.generatedAt, 'generatedAt');
assert.ok(json.body.runtime, 'runtime block');
assert.ok(json.body.data, 'data block');
assert.equal(typeof json.body.runtime.requests.total, 'number', 'requests.total');
assert.equal(typeof json.body.data.totals.articles, 'number', 'totals.articles');
console.log('   ✓ JSON metrics ok');

console.log('3. GET /api/v1/metrics?format=prometheus returns Prometheus text');
const prom = await request('GET', '/api/v1/metrics?format=prometheus');
assert.equal(prom.status, 200, 'prometheus status 200');
assert.ok(prom.contentType.includes('text/plain'), 'text/plain content type');
assert.ok(prom.body.includes('permabrain_runtime_uptime_seconds'), 'uptime metric');
assert.ok(prom.body.includes('permabrain_runtime_requests_total'), 'requests metric');
assert.ok(prom.body.includes('permabrain_articles_total'), 'articles metric');
console.log('   ✓ Prometheus metrics ok');

console.log('4. Publishing increments runtime request/event counters');
const publish = await request('POST', '/api/v1/articles', {
  title: 'Metrics Test',
  content: 'Runtime metrics test article',
  kind: 'subject',
  topic: 'metrics-test',
  sourceUrl: 'http://example.com/metrics',
  sourceName: 'test-source',
  language: 'en'
});
assert.equal(publish.status, 201, 'publish status 201');
const after = await request('GET', '/api/v1/metrics');
assert.equal(after.body.data.totals.articles, 1, 'one article indexed');
assert.ok(after.body.runtime.requests.total >= json.body.runtime.requests.total + 2, 'request counter incremented');
console.log('   ✓ counters reflect activity');

console.log('5. SDK client.metrics() works');
const client = createClient({ baseUrl: `http://localhost:${port}` });
const clientMetrics = await client.metrics();
assert.ok(clientMetrics.generatedAt, 'client metrics generatedAt');
assert.equal(clientMetrics.data.totals.articles, 1, 'client sees article');
console.log('   ✓ client.metrics() ok');

console.log('6. Unknown route increments 404 counter');
const notFound = await request('GET', '/api/v1/no-such-route');
assert.equal(notFound.status, 404, '404 response');
const after404 = await request('GET', '/api/v1/metrics');
assert.equal(after404.body.runtime.requests.byStatus[400], 1, '4xx bucket has one 404');
console.log('   ✓ 404 counted');

console.log('7. Filters pass through to data metrics');
const filtered = await request('GET', '/api/v1/metrics?topic=other');
assert.equal(filtered.status, 200, 'filtered status 200');
assert.equal(filtered.body.data.totals.articles, 0, 'no articles for other topic');
console.log('   ✓ filters work');

console.log('8. Route registry lists /api/v1/metrics');
const routes = await request('GET', '/api/v1/routes');
assert.equal(routes.status, 200, 'routes status 200');
const found = routes.body.routes.some((r) => r.route === '/api/v1/metrics');
assert.ok(found, 'route registry contains metrics endpoint');
console.log('   ✓ route registry updated');

await stopServer(server);
console.log('✅ All serve-metrics tests passed');
