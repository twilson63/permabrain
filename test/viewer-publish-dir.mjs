/**
 * Viewer batch-publish panel tests.
 *
 * Verifies that the web viewer includes a batch-publish panel wired to
 * POST /api/v1/publish-dir/preview and POST /api/v1/publish-dir, supports
 * deep-link state (?view=publish), drag/drop file selection, metadata inputs,
 * inline report rendering, and API-key authentication.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { startServer, stopServer } from '../src/serve.mjs';
import { api } from '../src/agent-api.mjs';
import { initState } from '../src/config.mjs';
import { generateApiKey } from '../src/auth.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const viewerPath = path.resolve(__dirname, '..', 'viewer', 'index.html');

function makeTempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-viewer-publish-dir-'));
}

async function resetApi(home) {
  api._home = null;
  api._identity = null;
  api._config = null;
  process.env.PERMABRAIN_HOME = home;
  process.env.PERMABRAIN_TRANSPORT = 'local';
  initState({ env: { ...process.env, PERMABRAIN_HOME: home, PERMABRAIN_TRANSPORT: 'local' } });
  await api.init({ transport: 'local', keyType: 'ed25519' });
}

function request(port, reqPath, method = 'GET', body = null, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const headers = { ...extraHeaders };
    if (body) headers['content-type'] = 'application/json';
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      method,
      path: reqPath,
      headers
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch {}
        resolve({ status: res.statusCode, body: text, json, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// --- viewer/index.html contains batch-publish panel wiring ---
{
  const html = fs.readFileSync(viewerPath, 'utf8');
  assert.ok(html.includes('id="publishBtn"'), 'viewer should have publish button');
  assert.ok(html.includes('id="publishFileInput"'), 'viewer should have publish file input');
  assert.ok(html.includes('window.showPublish'), 'viewer should expose showPublish');
  assert.ok(html.includes('window.pickPublishFiles'), 'viewer should expose pickPublishFiles');
  assert.ok(html.includes('window.onPublishFilesSelected'), 'viewer should expose onPublishFilesSelected');
  assert.ok(html.includes('window.runPublishPreview'), 'viewer should expose runPublishPreview');
  assert.ok(html.includes('window.runPublish'), 'viewer should expose runPublish');
  assert.ok(html.includes('window.setPublishMeta'), 'viewer should expose setPublishMeta');
  assert.ok(html.includes('window.clearPublish'), 'viewer should expose clearPublish');
  assert.ok(html.includes('window.renderPublish'), 'viewer should expose renderPublish');
  assert.ok(html.includes('onPublishDragOver'), 'viewer should support dragover');
  assert.ok(html.includes('onPublishDrop'), 'viewer should support drop');
  assert.ok(html.includes('publish-dropzone'), 'viewer should have publish dropzone');
  assert.ok(html.includes('publish-report'), 'viewer should have publish report container');
  assert.ok(html.includes("params.set('view', viewMode)"), 'buildUrlState should encode view');
  assert.ok(html.includes("'publish'"), 'viewer should reference publish view in state handling');
  assert.ok(html.includes("viewMode === 'publish'"), 'boot should restore publish view');
  assert.ok(html.includes('/api/v1/publish-dir/preview'), 'viewer should call preview endpoint');
  assert.ok(html.includes('/api/v1/publish-dir'), 'viewer should call publish endpoint');
  assert.ok(html.includes("'authorization'"), 'viewer should set authorization header');
  assert.ok(html.includes('publishApiKey'), 'viewer should have API key input');
}

// --- local API publish-dir endpoints work and require auth ---
{
  const home = makeTempHome();
  await resetApi(home);

  const apiKey = generateApiKey();
  const { server, port } = await startServer({ port: 0, home, apiKey });
  try {
    const body = {
      files: [
        { path: 'viewer-batch/a.md', content: '# A\n\nContent A.' },
        { path: 'viewer-batch/b.md', content: '# B\n\nContent B.' }
      ],
      topic: 'viewer-batch',
      kind: 'subject'
    };

    // Preview without auth fails
    const previewNoAuth = await request(port, '/api/v1/publish-dir/preview', 'POST', body);
    assert.equal(previewNoAuth.status, 401, 'preview without key should 401');

    // Preview with auth succeeds
    const preview = await request(port, '/api/v1/publish-dir/preview', 'POST', body, { authorization: `Bearer ${apiKey}` });
    assert.equal(preview.status, 200, 'preview should return 200');
    assert.equal(preview.json.dryRun, true, 'preview should be dry-run');
    assert.equal(preview.json.count, 2, 'preview should count 2 files');
    assert.ok(preview.json.results.some((r) => r.key === 'subject/a'), 'preview derives subject/a');
    assert.ok(preview.json.results.some((r) => r.key === 'subject/b'), 'preview derives subject/b');

    // Live publish without auth fails
    const publishNoAuth = await request(port, '/api/v1/publish-dir', 'POST', body);
    assert.equal(publishNoAuth.status, 401, 'publish without key should 401');

    // Live publish with auth succeeds
    const publish = await request(port, '/api/v1/publish-dir', 'POST', body, { authorization: `Bearer ${apiKey}` });
    assert.equal(publish.status, 201, 'publish should return 201');
    assert.equal(publish.json.dryRun, false, 'publish should be live');
    assert.equal(publish.json.succeeded, 2, 'publish should succeed for 2 files');
    assert.equal(publish.json.failed, 0, 'publish should have no failures');

    // Published articles are queryable
    const a = await request(port, '/api/v1/articles/' + encodeURIComponent('subject/a'), 'GET', null, { authorization: `Bearer ${apiKey}` });
    assert.equal(a.status, 200, 'published article a retrievable');
    assert.equal(a.json.key, 'subject/a', 'article a has expected key');
    const b = await request(port, '/api/v1/articles/' + encodeURIComponent('subject/b'), 'GET', null, { authorization: `Bearer ${apiKey}` });
    assert.equal(b.status, 200, 'published article b retrievable');
    assert.equal(b.json.key, 'subject/b', 'article b has expected key');
  } finally {
    await stopServer(server);
    fs.rmSync(home, { recursive: true, force: true });
  }
}

console.log('viewer-publish-dir tests passed');
