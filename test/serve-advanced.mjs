/**
 * Test: remaining `permabrain serve` HTTP routes with API-key auth.
 *
 * Covers:
 *   - GET/POST /api/v1/bundles (export/import)
 *   - GET /api/v1/export-all
 *   - GET/POST /api/v1/history-export / /api/v1/history-import
 *   - GET /api/v1/diff
 *   - POST /api/v1/completion
 *   - GET/POST /api/v1/config
 *
 * All protected routes are tested both with and without the configured API
 * key to verify auth enforcement.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { startServer, stopServer } from '../src/serve.mjs';
import { createClient } from '../src/client.mjs';
import { api } from '../src/agent-api.mjs';
import { generateApiKey } from '../src/auth.mjs';

const tmpHome1 = fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-serve-adv1-'));
process.env.PERMABRAIN_HOME = tmpHome1;
process.env.PERMABRAIN_TRANSPORT = 'local';

const apiKey = generateApiKey();

function httpRequest(port, method, path, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const headers = { ...extraHeaders };
    if (body) headers['content-type'] = 'application/json';
    const req = http.request({ hostname: 'localhost', port, method, path, headers }, (res) => {
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

// Reset singleton state so startServer initializes fresh identity/config for this test.
api._home = undefined;
api._identity = undefined;
api._config = undefined;

console.log('1. startServer with API key');
const { server: server1, port } = await startServer({ home: tmpHome1, port: 0, apiKey });
assert.ok(port > 0, 'port assigned');
console.log('   ✓ server started on port', port);

const client = createClient({ baseUrl: `http://localhost:${port}`, apiKey });

console.log('2. publish articles for bundle/diff/history tests');
const baseKey = 'subject/serve-adv-base';
const headKey = 'subject/serve-adv-head';
const historyKey = 'subject/serve-adv-history';

const baseArticle = await client.publish({
  title: 'Base Article',
  content: 'First line.\nSecond line is shared.',
  kind: 'subject',
  topic: 'serve-adv',
  sourceUrl: 'http://example.com/base',
  key: baseKey,
  language: 'en'
});
assert.ok(baseArticle.summary?.key, 'base article published');

const headArticle = await client.publish({
  title: 'Head Article',
  content: 'First line.\nSecond line is shared.\nThird line is new.',
  kind: 'subject',
  topic: 'serve-adv',
  sourceUrl: 'http://example.com/head',
  key: headKey,
  language: 'en'
});
assert.ok(headArticle.summary?.key, 'head article published');

const historyV1 = await client.publish({
  title: 'History Article',
  content: 'Version one content.',
  kind: 'subject',
  topic: 'serve-adv',
  sourceUrl: 'http://example.com/history',
  key: historyKey,
  language: 'en'
});
assert.equal(historyV1.summary?.key, historyKey, 'history v1 published');

const historyV2 = await client.publish({
  title: 'History Article',
  content: 'Version two content adds more detail.',
  kind: 'subject',
  topic: 'serve-adv',
  sourceUrl: 'http://example.com/history',
  key: historyKey,
  language: 'en'
});
assert.equal(historyV2.summary?.key, historyKey, 'history v2 published');
console.log('   ✓ articles published');

console.log('3. GET /api/v1/bundles exports an article bundle');
const bundle = await client.exportBundle({ key: baseKey });
assert.ok(bundle.entries, 'bundle has entries');
assert.ok(bundle.entries.some((e) => e.type === 'article'), 'bundle has article entries');
assert.equal(bundle.version, 'permabrain-bundle/1.0.0', 'bundle version');
console.log('   ✓ export bundle works');

console.log('4. bundle endpoint requires auth');
const bundleNoAuth = await httpRequest(port, 'GET', `/api/v1/bundles?key=${encodeURIComponent(baseKey)}`);
assert.equal(bundleNoAuth.status, 401, 'bundle without key 401');
console.log('   ✓ bundle auth enforced');

console.log('5. GET /api/v1/export-all returns all articles');
const all = await client.exportAll();
assert.ok(Array.isArray(all.articles), 'export-all has articles');
assert.ok(all.articles.length >= 3, 'export-all has at least 3 articles');
console.log('   ✓ export-all works');

console.log('6. export-all endpoint requires auth');
const allNoAuth = await httpRequest(port, 'GET', '/api/v1/export-all');
assert.equal(allNoAuth.status, 401, 'export-all without key 401');
console.log('   ✓ export-all auth enforced');

console.log('7. GET /api/v1/history-export returns a versioned history bundle');
const historyBundle = await client.exportHistory(historyKey);
assert.equal(historyBundle.type, 'history', 'history bundle type');
assert.ok(historyBundle.entries.length >= 2, 'history bundle has at least 2 entries');
assert.equal(historyBundle.meta.sourceKey, historyKey, 'history bundle sourceKey');
console.log('   ✓ history-export works');

console.log('8. history-export endpoint requires auth');
const histNoAuth = await httpRequest(port, 'GET', `/api/v1/history-export?key=${encodeURIComponent(historyKey)}`);
assert.equal(histNoAuth.status, 401, 'history-export without key 401');
console.log('   ✓ history-export auth enforced');

console.log('9. GET /api/v1/diff compares two articles');
const diff = await client.diff({ base: baseKey, head: headKey });
assert.equal(diff.format, 'unified', 'diff format unified');
assert.ok(typeof diff.text === 'string', 'diff text is string');
assert.ok(diff.changes >= 1, 'diff has changes');
console.log('   ✓ diff works');

console.log('10. diff endpoint requires auth');
const diffNoAuth = await httpRequest(port, 'GET', `/api/v1/diff?base=${encodeURIComponent(baseKey)}&head=${encodeURIComponent(headKey)}`);
assert.equal(diffNoAuth.status, 401, 'diff without key 401');
console.log('   ✓ diff auth enforced');

console.log('11. POST /api/v1/completion generates shell script');
const completion = await client.completion({ shell: 'bash' });
assert.equal(completion.shell, 'bash', 'completion shell');
assert.ok(typeof completion.script === 'string', 'completion script is string');
assert.ok(completion.script.includes('permabrain'), 'completion script mentions permabrain');
assert.ok(Array.isArray(completion.shells), 'completion shells list');
console.log('   ✓ completion works');

console.log('12. completion endpoint requires auth');
const compNoAuth = await httpRequest(port, 'POST', '/api/v1/completion', { shell: 'bash' });
assert.equal(compNoAuth.status, 401, 'completion without key 401');
console.log('   ✓ completion auth enforced');

console.log('13. GET /api/v1/config returns configuration');
const configGet = await client.config({ action: 'get' });
assert.ok(configGet.config, 'config get returns config');
console.log('   ✓ config get works');

console.log('14. POST /api/v1/config sets a value');
const configSet = await client.config({ action: 'set', path: 'server.testValue', value: '42' });
assert.equal(configSet.path, 'server.testValue', 'config set path');
assert.equal(configSet.value, '42', 'config set value');
console.log('   ✓ config set works');

console.log('15. config endpoints require auth');
const configNoAuth = await httpRequest(port, 'GET', '/api/v1/config?action=get');
assert.equal(configNoAuth.status, 401, 'config without key 401');
const configSetNoAuth = await httpRequest(port, 'POST', '/api/v1/config', { action: 'set', path: 'server.other', value: 'x' });
assert.equal(configSetNoAuth.status, 401, 'config set without key 401');
console.log('   ✓ config auth enforced');

console.log('16. POST /api/v1/bundles imports into a fresh server');
await stopServer(server1);
api._home = undefined;
api._identity = undefined;
api._config = undefined;

const tmpHome2 = fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-serve-adv2-'));
const { server: server2, port: port2 } = await startServer({ home: tmpHome2, port: 0, apiKey });
const client2 = createClient({ baseUrl: `http://localhost:${port2}`, apiKey });

const importBundle = await client2.importBundle(bundle);
assert.ok(importBundle.results, 'import bundle has results');
const importedArticles = importBundle.results.filter((r) => r.type === 'article' && r.imported).length;
assert.ok(importedArticles >= 1, 'bundle import imported at least one article');
console.log('   ✓ bundle import works');

console.log('17. POST /api/v1/history-import into a fresh server');
const importHistory = await client2.importHistory(historyBundle);
assert.ok(importHistory.importedArticles >= 2, 'history import imported both versions');
console.log('   ✓ history import works');

console.log('18. import endpoints require auth');
const bundleImportNoAuth = await httpRequest(port2, 'POST', '/api/v1/bundles', { bundle });
assert.equal(bundleImportNoAuth.status, 401, 'bundle import without key 401');
const historyImportNoAuth = await httpRequest(port2, 'POST', '/api/v1/history-import', { bundle: historyBundle });
assert.equal(historyImportNoAuth.status, 401, 'history import without key 401');
console.log('   ✓ import endpoints auth enforced');

await stopServer(server2);
api._home = undefined;
api._identity = undefined;
api._config = undefined;

fs.rmSync(tmpHome1, { recursive: true, force: true });
fs.rmSync(tmpHome2, { recursive: true, force: true });

console.log('\n✅ All serve-advanced tests passed');
