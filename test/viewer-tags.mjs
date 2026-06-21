/**
 * Viewer tags catalog panel tests.
 *
 * Verifies that the web viewer includes a Tags panel wired to
 * GET /api/v1/tags, supports deep-link state (?view=tags), and
 * exposes the expected window functions.
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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-viewer-tags-'));
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

// --- viewer/index.html contains tags panel wiring ---
{
  const html = fs.readFileSync(viewerPath, 'utf8');
  assert.ok(html.includes('id="tagsBtn"'), 'viewer should have tags button');
  assert.ok(html.includes('window.showTags'), 'viewer should expose showTags');
  assert.ok(html.includes('window.refreshTags'), 'viewer should expose refreshTags');
  assert.ok(html.includes('window.fetchTags'), 'viewer should expose fetchTags');
  assert.ok(html.includes('window.renderTags'), 'viewer should expose renderTags');
  assert.ok(html.includes('window.setTagsSort'), 'viewer should expose setTagsSort');
  assert.ok(html.includes('window.setTagsLimit'), 'viewer should expose setTagsLimit');
  assert.ok(html.includes("'tags'"), 'viewer should reference tags view in state handling');
  assert.ok(html.includes("viewMode === 'tags'"), 'tags panel render guard');
  assert.ok(html.includes('/api/v1/tags'), 'viewer should call tags endpoint');
}

// --- local API tags endpoint works, and panel query params pass through ---
{
  const home = makeTempHome();
  await resetApi(home);

  const apiKey = generateApiKey();
  const { server, port } = await startServer({ port: 0, home, apiKey });
  try {
    const pub = await request(port, '/api/v1/articles', 'POST', {
      content: '# Viewer Tags Test\n\nA test article for the tags panel.',
      kind: 'subject',
      topic: 'viewer-tags-test',
      sourceUrl: 'https://example.com/viewer-tags-test',
      title: 'Viewer Tags Test'
    }, { authorization: `Bearer ${apiKey}` });
    assert.equal(pub.status, 201, 'publish should succeed');
    assert.ok(pub.json?.summary?.key, 'publish should return a key');

    const tags = await request(port, '/api/v1/tags', 'GET', null, { authorization: `Bearer ${apiKey}` });
    assert.equal(tags.status, 200, 'tags endpoint should return 200');
    assert.ok(tags.json.generatedAt, 'tags has generatedAt');
    assert.ok(Array.isArray(tags.json.tags), 'tags response is array');
    assert.equal(typeof tags.json.totals.tags, 'number', 'totals.tags is a number');
    assert.equal(typeof tags.json.totals.articles, 'number', 'totals.articles is a number');

    const sorted = await request(port, '/api/v1/tags?sort=name&limit=5', 'GET', null, { authorization: `Bearer ${apiKey}` });
    assert.equal(sorted.status, 200, 'tags endpoint should accept sort/limit');
    assert.ok(Array.isArray(sorted.json.tags), 'sorted tags response is array');
    assert.ok(sorted.json.tags.length <= 5, 'limit is respected');

    const md = await request(port, '/api/v1/tags', 'GET', null, { authorization: `Bearer ${apiKey}`, accept: 'text/markdown' });
    assert.equal(md.status, 200, 'markdown endpoint returns 200');
    assert.ok(md.headers['content-type'].includes('text/markdown'), 'markdown content type');
  } finally {
    await stopServer(server);
    fs.rmSync(home, { recursive: true, force: true });
  }
}

console.log('viewer-tags tests passed');
