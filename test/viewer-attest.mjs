/**
 * Viewer attest panel tests.
 *
 * Verifies that the web viewer includes an Attest panel wired to
 * GET /api/v1/list, POST /api/v1/articles/:key/attest, and
 * GET /api/v1/articles/:key/consensus, supports deep-link state (?view=attest),
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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-viewer-attest-'));
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

// --- viewer/index.html contains attest panel wiring ---
{
  const html = fs.readFileSync(viewerPath, 'utf8');
  assert.ok(html.includes('id="attestBtn"'), 'viewer should have attest button');
  assert.ok(html.includes('window.showAttest'), 'viewer should expose showAttest');
  assert.ok(html.includes('window.refreshAttest'), 'viewer should expose refreshAttest');
  assert.ok(html.includes('window.fetchAttestArticles'), 'viewer should expose fetchAttestArticles');
  assert.ok(html.includes('window.selectAttestKey'), 'viewer should expose selectAttestKey');
  assert.ok(html.includes('window.setAttestOpinion'), 'viewer should expose setAttestOpinion');
  assert.ok(html.includes('window.setAttestConfidence'), 'viewer should expose setAttestConfidence');
  assert.ok(html.includes('window.setAttestReason'), 'viewer should expose setAttestReason');
  assert.ok(html.includes('window.setAttestApiKey'), 'viewer should expose setAttestApiKey');
  assert.ok(html.includes('window.submitAttest'), 'viewer should expose submitAttest');
  assert.ok(html.includes('window.fetchConsensus'), 'viewer should expose fetchConsensus');
  assert.ok(html.includes('window.renderAttest'), 'viewer should expose renderAttest');
  assert.ok(html.includes("viewMode === 'attest'"), 'attest panel render guard');
  assert.ok(html.includes('/api/v1/articles/'), 'viewer should call articles endpoint');
  assert.ok(html.includes('/attest'), 'viewer should call attest endpoint');
  assert.ok(html.includes('/consensus'), 'viewer should call consensus endpoint');
}

// --- local API list/attest/consensus round-trip works ---
{
  const home = makeTempHome();
  await resetApi(home);

  const apiKey = generateApiKey();
  const { server, port } = await startServer({ port: 0, home, apiKey });
  try {
    const pub = await request(port, '/api/v1/articles', 'POST', {
      content: '# Viewer Attest Test\n\nA test article for the attest panel.',
      kind: 'subject',
      topic: 'viewer-attest-test',
      sourceUrl: 'https://example.com/viewer-attest-test',
      title: 'Viewer Attest Test'
    }, { authorization: `Bearer ${apiKey}` });
    assert.equal(pub.status, 201, 'publish should succeed');
    const key = pub.json?.summary?.key;
    assert.ok(key, 'publish should return a key');

    const list = await request(port, '/api/v1/list?limit=1000', 'GET', null, { authorization: `Bearer ${apiKey}` });
    assert.equal(list.status, 200, 'list endpoint should return 200');
    assert.ok(Array.isArray(list.json.articles), 'list response has articles array');
    assert.ok(list.json.articles.some((a) => a.key === key), 'published article appears in list');

    const before = await request(port, `/api/v1/articles/${encodeURIComponent(key)}/consensus`, 'GET', null, { authorization: `Bearer ${apiKey}` });
    assert.equal(before.status, 200, 'consensus endpoint should return 200');
    assert.equal(before.json.totalAttestations, 0, 'no attestations before submitting');

    const attest = await request(port, `/api/v1/articles/${encodeURIComponent(key)}/attest`, 'POST', {
      opinion: 'valid',
      confidence: 0.95,
      reason: 'Well sourced and clear.'
    }, { authorization: `Bearer ${apiKey}` });
    assert.equal(attest.status, 201, 'attest should return 201');
    assert.ok(attest.json.summary || attest.json.id || attest.json.targetKey, 'attest response contains summary/id/targetKey');

    const after = await request(port, `/api/v1/articles/${encodeURIComponent(key)}/consensus`, 'GET', null, { authorization: `Bearer ${apiKey}` });
    assert.equal(after.status, 200, 'consensus endpoint should return 200 after attestation');
    assert.equal(after.json.totalAttestations, 1, 'one attestation after submitting');
    assert.ok(typeof after.json.score === 'number', 'consensus score is a number');
  } finally {
    await stopServer(server);
    fs.rmSync(home, { recursive: true, force: true });
  }
}

console.log('viewer-attest tests passed');
