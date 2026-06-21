/**
 * Viewer forks panel tests.
 *
 * Verifies that the web viewer includes a Forks panel wired to
 * GET /api/v1/articles/:key/forks, supports deep-link state (?view=forks&forksKey=...),
 * and exposes the expected window functions.
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
import { forkArticle } from '../src/fork.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const viewerPath = path.resolve(__dirname, '..', 'viewer', 'index.html');

function makeTempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-viewer-forks-'));
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

// --- viewer/index.html contains forks panel wiring ---
{
  const html = fs.readFileSync(viewerPath, 'utf8');
  assert.ok(html.includes('id="forksBtn"'), 'viewer should have forks button');
  assert.ok(html.includes('window.showForks'), 'viewer should expose showForks');
  assert.ok(html.includes('window.refreshForks'), 'viewer should expose refreshForks');
  assert.ok(html.includes('window.fetchForks'), 'viewer should expose fetchForks');
  assert.ok(html.includes('window.renderForks'), 'viewer should expose renderForks');
  assert.ok(html.includes('window.setForksKey'), 'viewer should expose setForksKey');
  assert.ok(html.includes('window.setForksSort'), 'viewer should expose setForksSort');
  assert.ok(html.includes('window.setForksLimit'), 'viewer should expose setForksLimit');
  assert.ok(html.includes('window.openForkCompare'), 'viewer should expose openForkCompare');
  assert.ok(html.includes('window.openForkArticle'), 'viewer should expose openForkArticle');
  assert.ok(html.includes("'forks'"), 'viewer should reference forks view in state handling');
  assert.ok(html.includes("viewMode === 'forks'"), 'forks panel render guard');
  assert.ok(html.includes('/api/v1/articles/') && html.includes('/forks'), 'viewer should call forks endpoint');
  assert.ok(html.includes('forksKey'), 'viewer should reference forksKey URL state');
}

// --- local API forks endpoint works ---
{
  const home = makeTempHome();
  await resetApi(home);

  const apiKey = generateApiKey();
  const { server, port } = await startServer({ port: 0, home, apiKey });
  try {
    const sourceKey = 'subject/fork-viewer-source';
    const pub = await request(port, '/api/v1/articles', 'POST', {
      content: '# Fork Viewer Source\n\nOriginal body.',
      kind: 'subject',
      topic: 'viewer-forks-test',
      sourceUrl: 'https://example.com/fork-viewer-source',
      title: 'Fork Viewer Source'
    }, { authorization: `Bearer ${apiKey}` });
    assert.equal(pub.status, 201, 'publish should succeed');
    assert.equal(pub.json?.summary?.key, sourceKey, 'source key should match');

    const fork = await forkArticle(sourceKey, {
      title: 'Forked Viewer Variant',
      content: '# Fork\n\nForked body.',
      topic: 'viewer-forks-test-evolved'
    }, { home });
    const forkKey = fork.fork?.key;
    assert.ok(forkKey && forkKey.startsWith('subject/'), 'fork key should be generated');
    assert.equal(fork.source?.key, sourceKey, 'fork source matches');

    const list = await request(port, `/api/v1/articles/${encodeURIComponent(sourceKey)}/forks`, 'GET', null, { authorization: `Bearer ${apiKey}` });
    assert.equal(list.status, 200, 'forks endpoint should return 200');
    assert.equal(typeof list.json.count, 'number', 'forks response has count');
    assert.ok(Array.isArray(list.json.forks), 'forks response is array');
    assert.equal(list.json.count, 1, 'one fork found');
    assert.equal(list.json.forks[0].key, forkKey, 'fork key matches');

    const sorted = await request(port, `/api/v1/articles/${encodeURIComponent(sourceKey)}/forks?sort=date&limit=5`, 'GET', null, { authorization: `Bearer ${apiKey}` });
    assert.equal(sorted.status, 200, 'forks endpoint should accept sort/limit');
    assert.ok(Array.isArray(sorted.json.forks), 'sorted forks response is array');
    assert.ok(sorted.json.forks.length <= 5, 'limit is respected');
  } finally {
    await stopServer(server);
    fs.rmSync(home, { recursive: true, force: true });
  }
}

console.log('viewer-forks tests passed');
