/**
 * Viewer batch attest panel tests.
 *
 * Verifies that the web viewer includes a Batch Attest panel wired to
 * POST /api/v1/batch-attest, supports deep-link state (?view=batch-attest),
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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-viewer-batch-attest-'));
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

// --- viewer/index.html contains batch attest panel wiring ---
{
  const html = fs.readFileSync(viewerPath, 'utf8');
  assert.ok(html.includes('id="batchAttestBtn"'), 'viewer should have batch attest button');
  assert.ok(html.includes('window.showBatchAttest'), 'viewer should expose showBatchAttest');
  assert.ok(html.includes('window.submitBatchAttest'), 'viewer should expose submitBatchAttest');
  assert.ok(html.includes('window.addBatchAttestRow'), 'viewer should expose addBatchAttestRow');
  assert.ok(html.includes('window.removeBatchAttestRow'), 'viewer should expose removeBatchAttestRow');
  assert.ok(html.includes('window.setBatchAttestKey'), 'viewer should expose setBatchAttestKey');
  assert.ok(html.includes('window.setBatchAttestOpinion'), 'viewer should expose setBatchAttestOpinion');
  assert.ok(html.includes('window.setBatchAttestConfidence'), 'viewer should expose setBatchAttestConfidence');
  assert.ok(html.includes('window.setBatchAttestReason'), 'viewer should expose setBatchAttestReason');
  assert.ok(html.includes('window.setBatchAttestSourceUrl'), 'viewer should expose setBatchAttestSourceUrl');
  assert.ok(html.includes('window.setBatchAttestApiKey'), 'viewer should expose setBatchAttestApiKey');
  assert.ok(html.includes('window.setBatchAttestJson'), 'viewer should expose setBatchAttestJson');
  assert.ok(html.includes('window.loadBatchAttestFromJson'), 'viewer should expose loadBatchAttestFromJson');
  assert.ok(html.includes('window.exportBatchAttestJson'), 'viewer should expose exportBatchAttestJson');
  assert.ok(html.includes('window.clearBatchAttestResult'), 'viewer should expose clearBatchAttestResult');
  assert.ok(html.includes('window.renderBatchAttest'), 'viewer should expose renderBatchAttest');
  assert.ok(html.includes("viewMode === 'batch-attest'"), 'batch attest panel render guard');
  assert.ok(html.includes('/api/v1/batch-attest'), 'viewer should call batch-attest endpoint');
}

// --- local API batch-attest round-trip works ---
{
  const home = makeTempHome();
  await resetApi(home);

  const apiKey = generateApiKey();
  const { server, port } = await startServer({ port: 0, home, apiKey });
  try {
    const results = [];
    for (let i = 0; i < 3; i++) {
      const pub = await request(port, '/api/v1/articles', 'POST', {
        content: `# Batch Attest Test ${i}\n\nTest article ${i}.`,
        kind: 'subject',
        topic: 'viewer-batch-attest-test',
        sourceUrl: `https://example.com/batch-${i}`,
        title: `Batch Attest Test ${i}`
      }, { authorization: `Bearer ${apiKey}` });
      assert.equal(pub.status, 201, `publish ${i} should succeed`);
      const key = pub.json?.summary?.key;
      assert.ok(key, `publish ${i} should return a key`);
      results.push(key);
    }

    const before = await request(port, `/api/v1/articles/${encodeURIComponent(results[0])}/consensus`, 'GET', null, { authorization: `Bearer ${apiKey}` });
    assert.equal(before.status, 200, 'consensus endpoint should return 200');
    assert.equal(before.json.totalAttestations, 0, 'no attestations before submitting');

    const batch = await request(port, '/api/v1/batch-attest', 'POST', {
      attestations: [
        { key: results[0], opinion: 'valid', confidence: 0.95, reason: 'First article looks good.' },
        { key: results[1], opinion: 'partially-valid', confidence: 0.6, reason: 'Second article is mixed.' },
        { key: results[2], opinion: 'invalid', confidence: 0.8, reason: 'Third article is wrong.' }
      ]
    }, { authorization: `Bearer ${apiKey}` });
    assert.equal(batch.status, 200, 'batch-attest should return 200');
    assert.equal(batch.json.succeeded, 3, 'all three attestations should succeed');
    assert.equal(batch.json.failed, 0, 'no failures expected');
    assert.ok(Array.isArray(batch.json.results), 'results is an array');
    assert.equal(batch.json.results.length, 3, 'three result entries');
    assert.ok(batch.json.results.every((r) => r.status === 'ok'), 'every result status is ok');

    const after = await request(port, `/api/v1/articles/${encodeURIComponent(results[0])}/consensus`, 'GET', null, { authorization: `Bearer ${apiKey}` });
    assert.equal(after.status, 200, 'consensus endpoint should return 200 after batch attestation');
    assert.equal(after.json.totalAttestations, 1, 'first article has one attestation');
  } finally {
    await stopServer(server);
    fs.rmSync(home, { recursive: true, force: true });
  }
}

console.log('viewer-batch-attest tests passed');
