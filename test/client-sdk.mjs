/**
 * Test: HTTP API client SDK coverage for article CRUD operations.
 *
 * Covers client.publish(), client.createArticle(), client.article(),
 * client.articles(), client.attest(), and client.search() against a live
 * permabrain serve instance.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createClient } from '../src/client.mjs';
import { startServer, stopServer } from '../src/serve.mjs';
import { api } from '../src/agent-api.mjs';
import { generateApiKey } from '../src/auth.mjs';

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-client-sdk-'));
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
console.log('   ✓ /health via client');

console.log('2. client.publish() publishes an article');
const pub = await client.publish({
  title: 'Client SDK Article Test',
  content: 'Published through client.publish().',
  kind: 'subject',
  topic: 'client-sdk-article',
  sourceUrl: 'http://example.com/client-publish',
  sourceName: 'sdk-test',
  language: 'en'
});
assert.ok(pub.summary?.id, 'publish returns summary.id');
assert.ok(pub.summary?.key, 'publish returns key');
assert.equal(pub.summary.title, 'Client SDK Article Test');
assert.equal(pub.summary.kind, 'subject');
assert.equal(pub.summary.topic, 'client-sdk-article');
assert.equal(pub.encrypted, false, 'publish plaintext article');
console.log('   ✓ client.publish()');

const key = pub.summary.key;

console.log('3. client.createArticle() is an alias for publish');
const pub2 = await client.createArticle({
  title: 'Create Article Alias Test',
  content: 'Published through client.createArticle().',
  kind: 'subject',
  topic: 'client-sdk-article',
  sourceUrl: 'http://example.com/client-create',
  sourceName: 'sdk-test',
  language: 'en'
});
assert.ok(pub2.summary?.key, 'createArticle returns key');
assert.ok(pub2.summary?.id, 'createArticle returns id');
console.log('   ✓ client.createArticle() alias');

console.log('4. client.article() returns a single article by key');
const article = await client.article(key);
assert.equal(article.content, 'Published through client.publish().');
assert.equal(article.topic, 'client-sdk-article');
assert.equal(article.key, key);
assert.equal(article.title, 'Client SDK Article Test');
console.log('   ✓ client.article()');

console.log('5. client.articles() queries articles by topic');
const articlesResult = await client.articles({ topic: 'client-sdk-article' });
assert.ok(Array.isArray(articlesResult.articles), 'articles returns articles array');
assert.ok(articlesResult.articles.length >= 2, 'articles has both test articles');
assert.equal(articlesResult.count, articlesResult.articles.length, 'count matches array length');
const keys = articlesResult.articles.map((a) => a.key);
assert.ok(keys.includes(key), 'articles result includes primary key');
assert.ok(keys.includes(pub2.summary.key), 'articles result includes alias key');
console.log('   ✓ client.articles()');

console.log('6. client.attest() creates an attestation');
const attest = await client.attest(key, { opinion: 'valid', confidence: 0.88, reason: 'Client SDK attestation works.' });
assert.ok(attest.summary?.id, 'attest returns summary.id');
assert.equal(attest.summary?.targetKey, key, 'attest targetKey matches');
console.log('   ✓ client.attest()');

console.log('7. client.search() finds articles by query');
const search = await client.search('client.publish', { topic: 'client-sdk-article' });
assert.ok(search.total >= 1, 'search has total');
assert.ok(Array.isArray(search.results), 'search returns results');
const found = search.results.some((r) => r.key === key);
assert.ok(found, 'search finds the published article');
console.log('   ✓ client.search()');

console.log('8. client.articles() with kind filter');
const kindResult = await client.articles({ kind: 'subject' });
assert.ok(kindResult.articles.length >= 2, 'kind filter returns results');
assert.ok(kindResult.articles.every((a) => a.kind === 'subject'), 'all results match kind filter');
console.log('   ✓ articles() kind filter');

console.log('9. client.article() 404 for unknown key');
try {
  await client.article('subject/does-not-exist-sdk-test');
  assert.fail('unknown article should throw');
} catch (err) {
  assert.equal(err.status, 404, 'unknown article 404');
}
console.log('   ✓ article() 404 handling');

console.log('10. SDK methods preserve apiKey if provided');
const apiKey = generateApiKey();
const tmpHome2 = fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-client-sdk-auth-'));
process.env.PERMABRAIN_HOME = tmpHome2;
const { server: server2, port: port2 } = await startServer({ home: tmpHome2, port: 0, apiKey });
const authClient = createClient({ baseUrl: `http://localhost:${port2}`, apiKey });
const authArticles = await authClient.articles({});
assert.ok(Array.isArray(authArticles.articles), 'auth client articles works');
const authPublish = await authClient.publish({
  title: 'Auth SDK Publish',
  content: 'SDK publish with API key.',
  kind: 'subject',
  topic: 'client-sdk-auth',
  sourceUrl: 'http://example.com/auth-sdk',
  sourceName: 'sdk-auth',
  language: 'en'
});
assert.ok(authPublish.summary?.key, 'auth publish succeeds');
const authArticle = await authClient.article(authPublish.summary.key);
assert.equal(authArticle.content, 'SDK publish with API key.');
const authSearch = await authClient.search('API key', { topic: 'client-sdk-auth' });
assert.ok(authSearch.total >= 1, 'auth search finds result');
await stopServer(server2);
fs.rmSync(tmpHome2, { recursive: true, force: true });
console.log('   ✓ SDK methods with apiKey');

await stopServer(server);

api._home = undefined;
api._identity = undefined;
api._config = undefined;

fs.rmSync(tmpHome, { recursive: true, force: true });

console.log('\n✅ All client SDK article tests passed');
