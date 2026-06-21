/**
 * Viewer Sources catalog panel tests.
 *
 * Verifies that the web viewer includes a Sources panel wired to
 * GET /api/v1/sources, supports deep-link state (?view=sources), and
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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-viewer-sources-'));
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

// --- viewer/index.html contains sources panel wiring ---
{
  const html = fs.readFileSync(viewerPath, 'utf8');
  assert.ok(html.includes('id="sourcesBtn"'), 'viewer should have sources button');
  assert.ok(html.includes('window.showSources'), 'viewer should expose showSources');
  assert.ok(html.includes('window.refreshSources'), 'viewer should expose refreshSources');
  assert.ok(html.includes('window.fetchSources'), 'viewer should expose fetchSources');
  assert.ok(html.includes('window.renderSources'), 'viewer should expose renderSources');
  assert.ok(html.includes('window.setSourcesSort'), 'viewer should expose setSourcesSort');
  assert.ok(html.includes('window.setSourcesLimit'), 'viewer should expose setSourcesLimit');
  assert.ok(html.includes("'sources'"), 'viewer should reference sources view in state handling');
  assert.ok(html.includes("viewMode === 'sources'"), 'sources panel render guard');
  assert.ok(html.includes('/api/v1/sources'), 'viewer should call sources endpoint');
  assert.ok(html.includes('sourcesState'), 'viewer should have sourcesState');
  assert.ok(html.includes('sourcesSort'), 'viewer should persist sources sort in URL');
  assert.ok(html.includes('sourcesLimit'), 'viewer should persist sources limit in URL');
}

// --- local API sources endpoint works, and query params pass through ---
{
  const home = makeTempHome();
  await resetApi(home);

  const apiKey = generateApiKey();
  const { server, port } = await startServer({ port: 0, home, apiKey });
  try {
    const pub = await request(port, '/api/v1/articles', 'POST', {
      content: '# Viewer Sources Test\n\nA test article for the sources panel.',
      kind: 'subject',
      topic: 'viewer-sources-test',
      sourceUrl: 'https://example.com/viewer-sources-test',
      title: 'Viewer Sources Test'
    }, { authorization: `Bearer ${apiKey}` });
    assert.equal(pub.status, 201, 'publish should succeed');
    assert.ok(pub.json?.summary?.key, 'publish should return a key');

    const sources = await request(port, '/api/v1/sources', 'GET', null, { authorization: `Bearer ${apiKey}` });
    assert.equal(sources.status, 200, 'sources endpoint should return 200');
    assert.ok(sources.json.generatedAt, 'sources has generatedAt');
    assert.ok(sources.json.home, 'sources has home');
    assert.ok(Array.isArray(sources.json.sources), 'sources response is array');
    assert.equal(typeof sources.json.totals.sources, 'number', 'totals.sources is a number');
    assert.equal(typeof sources.json.totals.articles, 'number', 'totals.articles is a number');
    assert.ok(sources.json.sources.length >= 1, 'at least one source in catalog');
    const s = sources.json.sources.find((x) => x.name === 'example.com');
    assert.ok(s || sources.json.sources.some((x) => x.url === 'https://example.com/viewer-sources-test'), 'expected example.com source');

    const sorted = await request(port, '/api/v1/sources?sort=name&limit=5', 'GET', null, { authorization: `Bearer ${apiKey}` });
    assert.equal(sorted.status, 200, 'sources endpoint should accept sort/limit');
    assert.ok(Array.isArray(sorted.json.sources), 'sorted sources response is array');
    assert.ok(sorted.json.sources.length <= 5, 'limit is respected');

    const md = await request(port, '/api/v1/sources?limit=1', 'GET', null, {
      authorization: `Bearer ${apiKey}`,
      accept: 'text/markdown'
    });
    assert.equal(md.status, 200, 'sources markdown endpoint should return 200');
    assert.ok(md.headers['content-type'].includes('text/markdown'), 'content-type is markdown');
    assert.ok(md.body.includes('# PermaBrain Sources'), 'markdown includes heading');
  } finally {
    await stopServer(server);
    fs.rmSync(home, { recursive: true, force: true });
  }
}

console.log('viewer-sources tests passed');
