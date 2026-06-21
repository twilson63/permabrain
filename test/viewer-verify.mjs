/**
 * Viewer verify / signature panel tests.
 *
 * Verifies that the web viewer includes a Verify panel wired to
 * POST /api/v1/verify, supports deep-link state (?view=verify), and
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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-viewer-verify-'));
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

// --- viewer/index.html contains verify panel wiring ---
{
  const html = fs.readFileSync(viewerPath, 'utf8');
  assert.ok(html.includes('id="verifyBtn"'), 'viewer should have verify button');
  assert.ok(html.includes('window.showVerify'), 'viewer should expose showVerify');
  assert.ok(html.includes('window.refreshVerify'), 'viewer should expose refreshVerify');
  assert.ok(html.includes('window.runVerify'), 'viewer should expose runVerify');
  assert.ok(html.includes('window.fetchVerifyArticles'), 'viewer should expose fetchVerifyArticles');
  assert.ok(html.includes('window.setVerifyIdOrKey'), 'viewer should expose setVerifyIdOrKey');
  assert.ok(html.includes('window.setVerifyNoVerifyChain'), 'viewer should expose setVerifyNoVerifyChain');
  assert.ok(html.includes('window.setVerifyNoVerifyTarget'), 'viewer should expose setVerifyNoVerifyTarget');
  assert.ok(html.includes('window.setVerifyApiKey'), 'viewer should expose setVerifyApiKey');
  assert.ok(html.includes('window.renderVerify'), 'viewer should expose renderVerify');
  assert.ok(html.includes("viewMode === 'verify'"), 'verify panel render guard');
  assert.ok(html.includes("viewMode !== 'verify'"), 'verify panel should not count as local list mode');
  assert.ok(html.includes('/api/v1/verify'), 'viewer should call verify endpoint');
  assert.ok(html.includes('verifyState'), 'viewer should have verifyState object');
}

// --- local API verify round-trip works ---
{
  const home = makeTempHome();
  await resetApi(home);

  const apiKey = generateApiKey();
  const { server, port } = await startServer({ port: 0, home, apiKey });
  try {
    const pub = await request(port, '/api/v1/articles', 'POST', {
      content: '# Viewer Verify Test\n\nA test article for the verify panel.',
      kind: 'subject',
      topic: 'viewer-verify-test',
      sourceUrl: 'https://example.com/viewer-verify-test',
      title: 'Viewer Verify Test'
    }, { authorization: `Bearer ${apiKey}` });
    assert.equal(pub.status, 201, 'publish should succeed');
    const key = pub.json?.summary?.key;
    const id = pub.json?.summary?.id;
    assert.ok(key, 'publish should return a key');
    assert.ok(id, 'publish should return an id');

    // Verify by canonical key
    const byKey = await request(port, '/api/v1/verify', 'POST', {
      idOrKey: key,
      noVerifyChain: false,
      noVerifyTarget: false
    }, { authorization: `Bearer ${apiKey}` });
    assert.equal(byKey.status, 200, 'verify by key should return 200');
    assert.equal(byKey.json.valid, true, 'valid article should verify');
    assert.equal(byKey.json.type, 'article', 'type should be article');
    assert.ok(Array.isArray(byKey.json.checks), 'verify report has checks');
    assert.ok(byKey.json.checks.some((c) => c.name === 'dataitem-signature' && c.ok), 'signature check passes');
    assert.ok(byKey.json.checks.some((c) => c.name === 'article-content-hash' && c.ok), 'content hash check passes');
    assert.equal(byKey.json.article?.key, key, 'verify report article key matches');

    // Verify by DataItem ID
    const byId = await request(port, '/api/v1/verify', 'POST', {
      idOrKey: id,
      noVerifyChain: true,
      noVerifyTarget: true
    }, { authorization: `Bearer ${apiKey}` });
    assert.equal(byId.status, 200, 'verify by id should return 200');
    assert.equal(byId.json.valid, true, 'valid article id should verify');
    assert.equal(byId.json.id, id, 'verify report id matches');

    // Missing idOrKey should return 400
    const missing = await request(port, '/api/v1/verify', 'POST', {}, { authorization: `Bearer ${apiKey}` });
    assert.equal(missing.status, 400, 'verify without idOrKey should return 400');

    // Unknown key should return a non-valid report (resolved as not found)
    const unknown = await request(port, '/api/v1/verify', 'POST', {
      idOrKey: 'subject/does-not-exist',
      noVerifyChain: false,
      noVerifyTarget: false
    }, { authorization: `Bearer ${apiKey}` });
    assert.ok(unknown.status === 200 || unknown.status === 404, 'verify unknown key should return 200 or 404');
    if (unknown.status === 200) {
      assert.equal(unknown.json.valid, false, 'unknown article should not verify');
    } else {
      assert.ok(unknown.body.includes('not found') || unknown.body.includes('Not found') || unknown.body.includes('notFound'), 'unknown key error should mention not found');
    }
  } finally {
    await stopServer(server);
    fs.rmSync(home, { recursive: true, force: true });
  }
}

console.log('viewer-verify tests passed');
