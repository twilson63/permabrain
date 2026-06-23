/**
 * Viewer Consensus panel tests.
 *
 * Verifies that the web viewer includes a Consensus panel wired to
 * GET /api/v1/articles/:key/consensus, supports a use-hyperbeam toggle,
 * deep-link state (?view=consensus&consensusKey=...), command-palette entry,
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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-viewer-consensus-'));
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

// --- viewer/index.html contains consensus panel wiring ---
{
  const html = fs.readFileSync(viewerPath, 'utf8');
  assert.ok(html.includes('id="consensusBtn"'), 'viewer should have consensus button');
  assert.ok(html.includes('window.showConsensus'), 'viewer should expose showConsensus');
  assert.ok(html.includes('window.refreshConsensus'), 'viewer should expose refreshConsensus');
  assert.ok(html.includes('window.fetchConsensusPanel'), 'viewer should expose fetchConsensusPanel');
  assert.ok(html.includes('window.renderConsensus'), 'viewer should expose renderConsensus');
  assert.ok(html.includes('window.setConsensusKey'), 'viewer should expose setConsensusKey');
  assert.ok(html.includes('window.setConsensusUseHyperbeam'), 'viewer should expose setConsensusUseHyperbeam');
  assert.ok(html.includes('consensusState'), 'viewer should have consensusState');
  assert.ok(html.includes("viewMode === 'consensus'"), 'consensus panel render guard');
  assert.ok(html.includes('/api/v1/articles/'), 'viewer should call articles endpoint');
  assert.ok(html.includes('/consensus'), 'viewer should call consensus endpoint');
  assert.ok(html.includes('consensusKey'), 'viewer should persist consensus key in URL');
  assert.ok(html.includes('consensusUseHyperbeam'), 'viewer should persist use-hyperbeam in URL');
  assert.ok(html.includes('Use Hyperbeam'), 'viewer should expose use-hyperbeam toggle label');
  assert.ok(html.includes('go-consensus'), 'command palette should include consensus entry');
  assert.ok(html.includes('Open Consensus panel'), 'keyboard shortcuts should include consensus');
}

// --- local API consensus endpoint works with and without use-hyperbeam ---
{
  const home = makeTempHome();
  await resetApi(home);

  const apiKey = generateApiKey();
  const { server, port } = await startServer({ port: 0, home, apiKey });
  try {
    const pub = await request(port, '/api/v1/articles', 'POST', {
      content: '# Viewer Consensus Test\n\nA test article for the consensus panel.',
      kind: 'subject',
      topic: 'viewer-consensus-test',
      sourceUrl: 'https://example.com/viewer-consensus-test',
      title: 'Viewer Consensus Test'
    }, { authorization: `Bearer ${apiKey}` });
    assert.equal(pub.status, 201, 'publish should succeed');
    const key = pub.json?.summary?.key;
    assert.ok(key, 'publish should return a key');

    const consensus = await request(port, `/api/v1/articles/${encodeURIComponent(key)}/consensus`, 'GET', null, { authorization: `Bearer ${apiKey}` });
    assert.equal(consensus.status, 200, 'consensus endpoint should return 200');
    assert.equal(consensus.json.key, key, 'consensus returns the article key');
    assert.equal(consensus.json.totalAttestations, 0, 'no attestations before submitting');
    assert.equal(typeof consensus.json.score, 'number', 'consensus score is a number');

    const attest = await request(port, `/api/v1/articles/${encodeURIComponent(key)}/attest`, 'POST', {
      opinion: 'valid',
      confidence: 0.95,
      reason: 'Well sourced and clear.'
    }, { authorization: `Bearer ${apiKey}` });
    assert.equal(attest.status, 201, 'attest should return 201');

    const after = await request(port, `/api/v1/articles/${encodeURIComponent(key)}/consensus`, 'GET', null, { authorization: `Bearer ${apiKey}` });
    assert.equal(after.status, 200, 'consensus endpoint should return 200 after attestation');
    assert.equal(after.json.totalAttestations, 1, 'one attestation after submitting');
    assert.ok(after.json.score > 0, 'consensus score is positive after valid attestation');

    const hyperbeam = await request(port, `/api/v1/articles/${encodeURIComponent(key)}/consensus?use-hyperbeam=true`, 'GET', null, { authorization: `Bearer ${apiKey}` });
    assert.equal(hyperbeam.status, 200, 'consensus endpoint should accept use-hyperbeam');
    assert.equal(hyperbeam.json.key, key, 'hyperbeam consensus returns the article key');
  } finally {
    await stopServer(server);
    fs.rmSync(home, { recursive: true, force: true });
  }
}

console.log('viewer-consensus tests passed');
