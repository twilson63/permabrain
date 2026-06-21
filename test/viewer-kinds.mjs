/**
 * Viewer kinds catalog panel tests.
 *
 * Verifies that the web viewer includes a Kinds panel wired to
 * GET /api/v1/kinds, supports deep-link state (?view=kinds), and
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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-viewer-kinds-'));
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

// --- viewer/index.html contains kinds panel wiring ---
{
  const html = fs.readFileSync(viewerPath, 'utf8');
  assert.ok(html.includes('id="kindsBtn"'), 'viewer should have kinds button');
  assert.ok(html.includes('window.showKinds'), 'viewer should expose showKinds');
  assert.ok(html.includes('window.refreshKinds'), 'viewer should expose refreshKinds');
  assert.ok(html.includes('window.fetchKinds'), 'viewer should expose fetchKinds');
  assert.ok(html.includes('window.renderKinds'), 'viewer should expose renderKinds');
  assert.ok(html.includes('window.setKindsSort'), 'viewer should expose setKindsSort');
  assert.ok(html.includes('window.setKindsLimit'), 'viewer should expose setKindsLimit');
  assert.ok(html.includes("'kinds'"), 'viewer should reference kinds view in state handling');
  assert.ok(html.includes("viewMode === 'kinds'"), 'kinds panel render guard');
  assert.ok(html.includes('/api/v1/kinds'), 'viewer should call kinds endpoint');
}

// --- local API kinds endpoint works, and panel query params pass through ---
{
  const home = makeTempHome();
  await resetApi(home);

  const apiKey = generateApiKey();
  const { server, port } = await startServer({ port: 0, home, apiKey });
  try {
    const pub = await request(port, '/api/v1/articles', 'POST', {
      content: '# Viewer Kinds Test\n\nA test article for the kinds panel.',
      kind: 'subject',
      topic: 'viewer-kinds-test',
      sourceUrl: 'https://example.com/viewer-kinds-test',
      title: 'Viewer Kinds Test'
    }, { authorization: `Bearer ${apiKey}` });
    assert.equal(pub.status, 201, 'publish should succeed');
    assert.ok(pub.json?.summary?.key, 'publish should return a key');

    const kinds = await request(port, '/api/v1/kinds', 'GET', null, { authorization: `Bearer ${apiKey}` });
    assert.equal(kinds.status, 200, 'kinds endpoint should return 200');
    assert.ok(kinds.json.generatedAt, 'kinds has generatedAt');
    assert.ok(kinds.json.home, 'kinds has home');
    assert.ok(Array.isArray(kinds.json.kinds), 'kinds response is array');
    assert.equal(typeof kinds.json.totals.kinds, 'number', 'totals.kinds is a number');
    assert.equal(typeof kinds.json.totals.articles, 'number', 'totals.articles is a number');
    const seeded = kinds.json.kinds.find((k) => k.name === 'subject');
    assert.ok(seeded, 'seeded subject kind appears in catalog');
    assert.ok(seeded.count >= 1, 'seeded kind has at least one article');
    assert.ok(seeded.uniqueKeys >= 1, 'seeded kind has at least one unique key');
    assert.ok(seeded.byTopic['viewer-kinds-test'] >= 1, 'kind topic breakdown includes seeded topic');

    const sorted = await request(port, '/api/v1/kinds?sort=name&limit=5', 'GET', null, { authorization: `Bearer ${apiKey}` });
    assert.equal(sorted.status, 200, 'kinds endpoint should accept sort/limit');
    assert.ok(Array.isArray(sorted.json.kinds), 'sorted kinds response is array');
    assert.ok(sorted.json.kinds.length <= 5, 'limit is respected');

    const md = await request(port, '/api/v1/kinds?sort=name', 'GET', null, { authorization: `Bearer ${apiKey}`, accept: 'text/markdown' });
    assert.equal(md.status, 200, 'kinds markdown endpoint should return 200');
    assert.ok(md.headers['content-type'].includes('text/markdown'), 'markdown content type');
    assert.ok(md.body.includes('# PermaBrain Kinds'), 'markdown body has header');
  } finally {
    await stopServer(server);
    fs.rmSync(home, { recursive: true, force: true });
  }
}

console.log('viewer-kinds tests passed');
