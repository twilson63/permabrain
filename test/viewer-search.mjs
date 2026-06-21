/**
 * Viewer Search panel tests.
 *
 * Verifies that the web viewer includes a Search panel wired to
 * GET /api/v1/search, supports deep-link state (?view=search&searchQ=...),
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const viewerPath = path.resolve(__dirname, '..', 'viewer', 'index.html');

function makeTempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-viewer-search-'));
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

// --- viewer/index.html contains search panel wiring ---
{
  const html = fs.readFileSync(viewerPath, 'utf8');
  assert.ok(html.includes('id="searchBtn"'), 'viewer should have search button');
  assert.ok(html.includes('window.showSearch'), 'viewer should expose showSearch');
  assert.ok(html.includes('window.refreshSearch'), 'viewer should expose refreshSearch');
  assert.ok(html.includes('window.runSearch'), 'viewer should expose runSearch');
  assert.ok(html.includes('window.fetchSearch'), 'viewer should expose fetchSearch');
  assert.ok(html.includes('window.renderSearch'), 'viewer should expose renderSearch');
  assert.ok(html.includes('window.setSearchSort'), 'viewer should expose setSearchSort');
  assert.ok(html.includes('window.setSearchLimit'), 'viewer should expose setSearchLimit');
  assert.ok(html.includes("'search'"), 'viewer should reference search view in state handling');
  assert.ok(html.includes("viewMode === 'search'"), 'search panel render guard');
  assert.ok(html.includes('/api/v1/search'), 'viewer should call search endpoint');
  assert.ok(html.includes('searchState'), 'viewer should have searchState');
  assert.ok(html.includes('searchQ'), 'viewer should persist search query in URL');
}

// --- local API search endpoint works ---
{
  const home = makeTempHome();
  await resetApi(home);

  const apiKey = generateApiKey();
  const { server, port } = await startServer({ port: 0, home, apiKey });
  try {
    const pub = await request(port, '/api/v1/articles', 'POST', {
      content: '# Searchable Article\n\nThis article is about quantum computing and permabrain search.',
      kind: 'subject',
      topic: 'search-test',
      sourceUrl: 'https://example.com/search-test',
      title: 'Searchable Article'
    }, { authorization: `Bearer ${apiKey}` });
    assert.equal(pub.status, 201, 'publish should succeed: ' + pub.body);
    assert.ok(pub.json?.summary?.key, 'publish should return a key');

    const search = await request(port, '/api/v1/search?q=quantum', 'GET', null, { authorization: `Bearer ${apiKey}` });
    assert.equal(search.status, 200, 'search endpoint should return 200');
    assert.ok(Array.isArray(search.json.results), 'search results is array');
    assert.ok(search.json.results.length >= 1, 'expected at least one search result');
    assert.ok(search.json.results.some((r) => (r.article?.key || r.key || '').includes('searchable')), 'expected the published article');

    const kindFilter = await request(port, '/api/v1/search?q=quantum&kind=subject', 'GET', null, { authorization: `Bearer ${apiKey}` });
    assert.equal(kindFilter.status, 200, 'search with kind filter should return 200');
    assert.ok(Array.isArray(kindFilter.json.results), 'kind filter results is array');

    const noResults = await request(port, '/api/v1/search?q=xyznotfound', 'GET', null, { authorization: `Bearer ${apiKey}` });
    assert.equal(noResults.status, 200, 'empty search should return 200');
    assert.equal(noResults.json.results.length, 0, 'no results for nonsense query');
  } finally {
    await stopServer(server);
  }
}

console.log('All viewer-search tests passed.');
