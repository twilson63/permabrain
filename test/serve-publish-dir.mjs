/**
 * Test: HTTP API batch directory publish for `permabrain serve`.
 *
 * Covers:
 *   - POST /api/v1/publish-dir with inline file batch
 *   - POST /api/v1/publish-dir/preview dry-run
 *   - POST /api/v1/publish-dir with server-local directory
 *   - Markdown report via Accept: text/markdown
 *   - Auth enforcement
 *   - Validation errors (missing files/dir)
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

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-serve-publish-dir-'));
process.env.PERMABRAIN_HOME = tmpHome;
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
          resolve({ status: res.statusCode, body: json, raw: data, headers: res.headers });
        } catch {
          resolve({ status: res.statusCode, body: data, raw: data, headers: res.headers });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

api._home = undefined;
api._identity = undefined;
api._config = undefined;

console.log('1. startServer with API key');
const { server, port } = await startServer({ home: tmpHome, port: 0, apiKey });
assert.ok(port > 0, 'port assigned');
console.log('   ✓ server started on port', port);

const client = createClient({ baseUrl: `http://localhost:${port}`, apiKey });

console.log('2. POST /api/v1/publish-dir/preview dry-run with inline files');
const preview = await client.previewDirectory({
  dir: 'docs/ai',
  files: [
    { path: 'docs/ai/overview.md', content: '# AI Overview\n\nArtificial intelligence overview.' },
    { path: 'docs/ai/ethics.md', content: '# AI Ethics\n\nEthics in AI.' }
  ],
  topic: 'ai',
  kind: 'subject'
});
assert.equal(preview.dryRun, true, 'preview is dry-run');
assert.equal(preview.count, 2, 'preview counts 2 files');
assert.equal(preview.succeeded, 0, 'preview does not publish');
assert.equal(preview.results.length, 2, 'preview has 2 results');
assert.equal(preview.results[0].status, 'dry-run', 'preview result status dry-run');
assert.equal(preview.results[0].key, 'subject/overview', 'preview derives key overview');
assert.equal(preview.results[1].key, 'subject/ethics', 'preview derives key ethics');
console.log('   ✓ preview dry-run works');

console.log('3. POST /api/v1/publish-dir publishes inline file batch');
const batch = await client.publishDirectory({
  dir: 'docs/ai',
  files: [
    { path: 'docs/ai/overview.md', content: '# AI Overview\n\nArtificial intelligence overview.' },
    { path: 'docs/ai/ethics.md', content: '# AI Ethics\n\nEthics in AI.' }
  ],
  topic: 'ai',
  kind: 'subject',
  sourceName: 'HTTP Batch Publish'
});
assert.equal(batch.dryRun, false, 'batch is live');
assert.equal(batch.count, 2, 'batch counts 2 files');
assert.equal(batch.succeeded, 2, 'batch publishes 2 files');
assert.equal(batch.failed, 0, 'batch has no failures');
assert.ok(batch.results[0].id, 'batch result has id');
assert.equal(batch.results[0].status, 'ok', 'batch result status ok');
console.log('   ✓ batch publish works');

console.log('4. Published articles are queryable');
const overview = await client.article('subject/overview');
assert.equal(overview.key, 'subject/overview', 'overview article retrievable');
const ethics = await client.article('subject/ethics');
assert.equal(ethics.key, 'subject/ethics', 'ethics article retrievable');
console.log('   ✓ published articles queryable');

console.log('5. POST /api/v1/publish-dir from server-local directory');
const localDir = path.join(tmpHome, 'local-docs');
fs.mkdirSync(path.join(localDir, 'sub'), { recursive: true });
fs.writeFileSync(path.join(localDir, 'article-a.md'), '# Article A\n\nContent A.\n');
fs.writeFileSync(path.join(localDir, 'sub', 'article-b.md'), '# Article B\n\nContent B.\n');
const local = await client.publishDirectory({
  dir: 'local-docs',
  recursive: true,
  topic: 'local-batch',
  kind: 'subject'
});
assert.equal(local.count, 2, 'local dir counts 2 markdown files');
assert.equal(local.succeeded, 2, 'local dir publishes 2 files');
assert.ok(local.results.some((r) => r.key === 'subject/article-a'), 'local article-a key');
assert.ok(local.results.some((r) => r.key === 'subject/article-b'), 'local article-b key');
console.log('   ✓ server-local directory publish works');

console.log('6. Markdown report via Accept: text/markdown');
const markdown = await client.publishDirectoryMarkdown({
  dir: 'docs/ai',
  files: [
    { path: 'docs/ai/future.md', content: '# AI Future\n\nFuture of AI.' }
  ],
  topic: 'ai',
  kind: 'subject'
});
assert.ok(typeof markdown === 'string', 'markdown report is string');
assert.ok(markdown.includes('# Directory Publish:'), 'markdown has heading');
assert.ok(markdown.includes('subject/future'), 'markdown includes derived key');
console.log('   ✓ markdown report works');

console.log('7. Publish-dir endpoint requires auth');
const noAuth = await httpRequest(port, 'POST', '/api/v1/publish-dir', { dir: 'docs', files: [] });
assert.equal(noAuth.status, 401, 'publish-dir without key 401');
const previewNoAuth = await httpRequest(port, 'POST', '/api/v1/publish-dir/preview', { files: [] });
assert.equal(previewNoAuth.status, 401, 'preview without key 401');
console.log('   ✓ auth enforced');

console.log('8. Validation error when files/dir missing');
const missing = await client.publishDirectory({ files: [] }).catch((err) => err);
assert.ok(missing instanceof Error || missing.status === 400, 'missing files/dir errors');
if (missing instanceof Error) assert.ok(missing.status === 400 || missing.message.includes('files'), 'error mentions files/dir');
console.log('   ✓ validation errors');

console.log('9. Preview endpoint returns 200 (not 201)');
const previewStatus = await httpRequest(port, 'POST', '/api/v1/publish-dir/preview', {
  files: [{ path: 'docs/ai/x.md', content: '# X' }]
}, { authorization: `Bearer ${apiKey}` });
assert.equal(previewStatus.status, 200, 'preview returns 200');
assert.equal(previewStatus.body.dryRun, true, 'preview body dryRun');
console.log('   ✓ preview status 200');

await stopServer(server);
api._home = undefined;
api._identity = undefined;
api._config = undefined;
fs.rmSync(tmpHome, { recursive: true, force: true });

console.log('\n✅ All serve-publish-dir tests passed');
