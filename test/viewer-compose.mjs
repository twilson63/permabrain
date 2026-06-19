/**
 * Viewer compose panel tests.
 *
 * Verifies that the web viewer includes a Compose article-editor panel wired to
 * POST /api/v1/articles, supports deep-link state (?view=compose), metadata
 * inputs, markdown preview, localStorage draft save/restore, and API-key auth.
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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-viewer-compose-'));
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

// --- viewer/index.html contains compose panel wiring ---
{
  const html = fs.readFileSync(viewerPath, 'utf8');
  assert.ok(html.includes('id="composeBtn"'), 'viewer should have compose button');
  assert.ok(html.includes('window.showCompose'), 'viewer should expose showCompose');
  assert.ok(html.includes('window.updateComposeDraft'), 'viewer should expose updateComposeDraft');
  assert.ok(html.includes('window.runComposePublish'), 'viewer should expose runComposePublish');
  assert.ok(html.includes('window.clearCompose'), 'viewer should expose clearCompose');
  assert.ok(html.includes('window.renderCompose'), 'viewer should expose renderCompose');
  assert.ok(html.includes('window.refreshComposePreview'), 'viewer should expose refreshComposePreview');
  assert.ok(html.includes("'compose'"), 'viewer should reference compose view in state handling');
  assert.ok(html.includes("viewMode === 'compose'"), 'boot should restore compose view');
  assert.ok(html.includes('compose-grid'), 'viewer should have compose grid layout');
  assert.ok(html.includes('compose-form'), 'viewer should have compose form class');
  assert.ok(html.includes('compose-preview'), 'viewer should have compose preview class');
  assert.ok(html.includes('id="composeContent"'), 'viewer should have compose content textarea');
  assert.ok(html.includes('id="composeTitle"'), 'viewer should have compose title input');
  assert.ok(html.includes('id="composeTopic"'), 'viewer should have compose topic input');
  assert.ok(html.includes('id="composeKind"'), 'viewer should have compose kind select');
  assert.ok(html.includes('id="composeVisibility"'), 'viewer should have compose visibility select');
  assert.ok(html.includes('id="composeApiKey"'), 'viewer should have compose API key input');
  assert.ok(html.includes('/api/v1/articles'), 'viewer should call articles endpoint');
  assert.ok(html.includes("'authorization'"), 'viewer should set authorization header');
  assert.ok(html.includes('permabrain-compose-draft'), 'viewer should use localStorage draft key');
  assert.ok(html.includes('loadComposeDraft'), 'viewer should load draft from localStorage');
  assert.ok(html.includes('saveComposeDraft'), 'viewer should save draft to localStorage');
}

// --- local API article publish endpoint works and requires auth ---
{
  const home = makeTempHome();
  await resetApi(home);

  const apiKey = generateApiKey();
  const { server, port } = await startServer({ port: 0, home, apiKey });
  try {
    const body = {
      content: '# Hello compose\n\nThis article was created in the compose panel.',
      title: 'Hello compose',
      key: 'subject/hello-compose',
      kind: 'subject',
      topic: 'compose-tests',
      sourceUrl: 'https://example.com/compose',
      sourceName: 'Compose editor',
      language: 'en',
      visibility: 'public'
    };

    // Publish without auth fails
    const noAuth = await request(port, '/api/v1/articles', 'POST', body);
    assert.equal(noAuth.status, 401, 'publish without key should 401');

    // Publish with auth succeeds
    const publish = await request(port, '/api/v1/articles', 'POST', body, { authorization: `Bearer ${apiKey}` });
    assert.equal(publish.status, 201, 'publish should return 201');
    assert.equal(publish.json.summary.key, 'subject/hello-compose', 'published key matches');
    assert.equal(publish.json.summary.title, 'Hello compose', 'published title matches');
    assert.equal(publish.json.summary.topic, 'compose-tests', 'published topic matches');
    assert.equal(publish.json.summary.version, 1, 'published version is 1');

    // Published article is queryable
    const get = await request(port, '/api/v1/articles/' + encodeURIComponent('subject/hello-compose'), 'GET', null, { authorization: `Bearer ${apiKey}` });
    assert.equal(get.status, 200, 'published article retrievable');
    assert.equal(get.json.key, 'subject/hello-compose', 'retrieved key matches');
    assert.equal(get.json.title, 'Hello compose', 'retrieved title matches');
  } finally {
    await stopServer(server);
    fs.rmSync(home, { recursive: true, force: true });
  }
}

console.log('viewer-compose tests passed');
