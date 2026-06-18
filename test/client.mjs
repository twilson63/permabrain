/**
 * Test: HTTP client SDK for permabrain serve
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createClient } from '../src/client.mjs';
import { startServer, stopServer } from '../src/serve.mjs';
import { api } from '../src/agent-api.mjs';

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-client-'));
process.env.PERMABRAIN_HOME = tmpHome;
process.env.PERMABRAIN_TRANSPORT = 'local';

let server;
let port;
let client;

console.log('1. startServer and createClient connect to /health');
const started = await startServer({ home: tmpHome, port: 0 });
server = started.server;
port = started.port;
client = createClient({ baseUrl: `http://localhost:${port}` });
const health = await client.health();
assert.equal(health.ok, true, 'health ok');
assert.equal(health.transport, 'local', 'health transport local');
assert.equal(health.streamTransport, 'sse', 'client health advertises default sse streamTransport');
assert.ok(health.agentId, 'health agentId present');
console.log('   ✓ /health via client');

console.log('2. init is idempotent via client');
const init = await client.init({ transport: 'local' });
assert.ok(init.agentId, 'init returns agentId');
assert.equal(init.home, tmpHome, 'init home matches');
console.log('   ✓ /api/v1/init via client');

console.log('3. publish an article via client');
const pub = await client.publish({
  title: 'Client SDK Test',
  content: 'Published through the HTTP client SDK.',
  kind: 'subject',
  topic: 'client-sdk',
  sourceUrl: 'http://example.com/client-sdk',
  sourceName: 'sdk-test',
  language: 'en'
});
assert.ok(pub.summary?.id, 'publish returns summary.id');
assert.ok(pub.summary?.key, 'publish returns key');
console.log('   ✓ publish via client');

const key = pub.summary.key;

console.log('4. get article via client');
const article = await client.get(key);
assert.equal(article.content, 'Published through the HTTP client SDK.');
assert.equal(article.topic, 'client-sdk');
console.log('   ✓ get via client');

console.log('5. query articles via client');
const query = await client.query({ topic: 'client-sdk' });
assert.ok(query.articles.length >= 1, 'query has results');
console.log('   ✓ query via client');

console.log('6. attest via client');
const attest = await client.attest(key, { opinion: 'valid', confidence: 0.92, reason: 'Client SDK works.' });
assert.ok(attest.summary?.id, 'attest returns id');
console.log('   ✓ attest via client');

console.log('7. consensus via client');
const consensus = await client.consensus(key);
assert.ok(consensus.score !== undefined, 'consensus has score');
console.log('   ✓ consensus via client');

console.log('8. history via client');
const history = await client.history(key);
assert.equal(history.key, key, 'history key matches');
assert.ok(history.versionCount >= 1, 'history has versions');
console.log('   ✓ history via client');

console.log('9. list articles via client');
const list = await client.listArticles({ topic: 'client-sdk' });
assert.ok(list.total >= 1, 'list has total');
assert.ok(list.articles.length >= 1, 'list has articles');
console.log('   ✓ listArticles via client');

console.log('10. search via client');
const search = await client.search('SDK', { topic: 'client-sdk' });
assert.ok(search.total >= 1, 'search has results');
console.log('   ✓ search via client');

console.log('11. status via client');
const status = await client.status();
assert.equal(status.transport, 'local', 'status transport');
assert.ok(status.summary, 'status summary');
console.log('   ✓ status via client');

console.log('12. identity via client');
const identity = await client.identity();
assert.ok(identity.agentId, 'identity agentId');
console.log('   ✓ identity via client');

console.log('13. metrics and stats via client');
const metrics = await client.metrics();
assert.ok(metrics.totals, 'metrics totals');
const stats = await client.stats();
assert.ok(stats.totals, 'stats totals');
console.log('   ✓ metrics + stats via client');

console.log('14. dashboard via client');
const dashboard = await client.dashboard({ topic: 'client-sdk' });
assert.ok(dashboard.stats, 'dashboard stats');
assert.ok(dashboard.list && dashboard.list.articles, 'dashboard list articles');
console.log('   ✓ dashboard via client');

console.log('15. dashboardHTML via client');
const html = await client.dashboardHTML({ topic: 'client-sdk' });
assert.ok(html.includes('<html'), 'html includes html tag');
assert.ok(html.includes('Client SDK Test') || html.includes('client-sdk'), 'html contains content/topic');
console.log('   ✓ dashboardHTML via client');

console.log('16. log via client');
const log = await client.log({ action: 'publish', limit: 5 });
assert.ok(log.entries, 'log has entries');
console.log('   ✓ log via client');

console.log('17. auditLog via client');
const audit = await client.auditLog({ action: 'test-client', status: 'ok', message: 'client test audit' });
assert.equal(audit.action, 'test-client', 'audit action');
console.log('   ✓ auditLog via client');

console.log('18. exportArticles via client');
const exported = await client.exportArticles({ topic: 'client-sdk', format: 'json' });
assert.ok(exported.articles, 'exportArticles has articles');
console.log('   ✓ exportArticles via client');

console.log('19. createClient with custom fetch');
let lastUrl;
const customClient = createClient({
  baseUrl: `http://localhost:${port}`,
  fetch: (url, opts) => { lastUrl = url; return globalThis.fetch(url, opts); }
});
await customClient.health();
assert.ok(lastUrl.includes('/health'), 'custom fetch invoked');
console.log('   ✓ custom fetch option');

console.log('20. error handling for unknown route');
try {
  await customClient.request('GET', '/api/v1/not-a-real-route');
  assert.fail('should throw for unknown route');
} catch (err) {
  assert.equal(err.status, 404, 'unknown route 404');
}
console.log('   ✓ error handling');

console.log('21. validate via client');
const validateArticle = await client.validate({ type: 'article', tags: {
  'App-Name': 'PermaBrain',
  'App-Version': '0.2.0',
  'PermaBrain-Type': 'article',
  'Article-Key': 'subject/client-validate',
  'Article-Kind': 'subject',
  'Article-Title': 'Client Validate',
  'Article-Slug': 'client-validate',
  'Article-Topic': 'client-sdk',
  'Article-Language': 'en',
  'Article-Version': '1',
  'Article-Source-Name': 'Test',
  'Article-Source-Url': 'https://example.com/v',
  'Article-Content-Hash': 'sha256:' + 'a'.repeat(64),
  'Article-Published-At': '2024-01-01T00:00:00Z',
  'Article-Updated-At': '2024-01-01T00:00:00Z',
  'Author-Agent-Id': 'ed25519:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'Visibility': 'public'
} });
assert.equal(validateArticle.valid, true, 'article tags valid');

const validateInvalid = await client.validate({ type: 'article', tags: { 'Article-Key': 'bad key' } }).catch(e => e.body || e);
assert.equal(validateInvalid.valid, false, 'invalid article tags rejected');
assert.ok(validateInvalid.errors.some(e => e.path === 'Article-Key'), 'errors include Article-Key');
console.log('   ✓ validate via client');

console.log('22. schema via client');
const schemas = await client.schema();
assert.ok(schemas.article, 'article schema present');
assert.ok(schemas.attestation, 'attestation schema present');
console.log('   ✓ schema via client');

await stopServer(server);

api._home = undefined;
api._identity = undefined;
api._config = undefined;

fs.rmSync(tmpHome, { recursive: true, force: true });

console.log('\n✅ All client SDK tests passed');
