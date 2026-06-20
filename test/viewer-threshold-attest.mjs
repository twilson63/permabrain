/**
 * Viewer threshold attestation panel tests.
 *
 * Verifies that the web viewer includes a Threshold Attest panel wired to
 * POST /api/v1/threshold-attest, /sign-local, /verify, /finalize, and /import,
 * supports deep-link state (?view=threshold-attest), and exposes the expected
 * window functions.
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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-viewer-threshold-'));
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

// --- viewer/index.html contains threshold attestation panel wiring ---
{
  const html = fs.readFileSync(viewerPath, 'utf8');
  assert.ok(html.includes('id="thresholdAttestBtn"'), 'viewer should have threshold attest button');
  assert.ok(html.includes('window.showThresholdAttest'), 'viewer should expose showThresholdAttest');
  assert.ok(html.includes('window.refreshThresholdAttest'), 'viewer should expose refreshThresholdAttest');
  assert.ok(html.includes('window.fetchThresholdArticles'), 'viewer should expose fetchThresholdArticles');
  assert.ok(html.includes('window.selectThresholdKey'), 'viewer should expose selectThresholdKey');
  assert.ok(html.includes('window.setThresholdOpinion'), 'viewer should expose setThresholdOpinion');
  assert.ok(html.includes('window.setThresholdConfidence'), 'viewer should expose setThresholdConfidence');
  assert.ok(html.includes('window.setThresholdReason'), 'viewer should expose setThresholdReason');
  assert.ok(html.includes('window.setThresholdCount'), 'viewer should expose setThresholdCount');
  assert.ok(html.includes('window.setThresholdCoSignerIds'), 'viewer should expose setThresholdCoSignerIds');
  assert.ok(html.includes('window.setThresholdApiKey'), 'viewer should expose setThresholdApiKey');
  assert.ok(html.includes('window.createThresholdEnvelope'), 'viewer should expose createThresholdEnvelope');
  assert.ok(html.includes('window.importThresholdEnvelope'), 'viewer should expose importThresholdEnvelope');
  assert.ok(html.includes('window.signThresholdEnvelopeLocal'), 'viewer should expose signThresholdEnvelopeLocal');
  assert.ok(html.includes('window.verifyThresholdEnvelope'), 'viewer should expose verifyThresholdEnvelope');
  assert.ok(html.includes('window.finalizeThresholdEnvelope'), 'viewer should expose finalizeThresholdEnvelope');
  assert.ok(html.includes('window.copyThresholdEnvelope'), 'viewer should expose copyThresholdEnvelope');
  assert.ok(html.includes('window.downloadThresholdEnvelope'), 'viewer should expose downloadThresholdEnvelope');
  assert.ok(html.includes('window.clearThresholdEnvelope'), 'viewer should expose clearThresholdEnvelope');
  assert.ok(html.includes('window.renderThresholdAttest'), 'viewer should expose renderThresholdAttest');
  assert.ok(html.includes("viewMode === 'threshold-attest'"), 'threshold attest panel render guard');
  assert.ok(html.includes('/api/v1/threshold-attest'), 'viewer should call threshold-attest endpoint');
  assert.ok(html.includes('/api/v1/threshold-attest/sign-local'), 'viewer should call sign-local endpoint');
  assert.ok(html.includes('/api/v1/threshold-attest/verify'), 'viewer should call verify endpoint');
  assert.ok(html.includes('/api/v1/threshold-attest/finalize'), 'viewer should call finalize endpoint');
  assert.ok(html.includes('/api/v1/threshold-attest/import'), 'viewer should call import endpoint');
  assert.ok(html.includes('thresholdKey'), 'viewer should encode thresholdKey in URL state');
  assert.ok(html.includes('thresholdOpinion'), 'viewer should encode thresholdOpinion in URL state');
  assert.ok(html.includes('thresholdCount'), 'viewer should encode thresholdCount in URL state');
  assert.ok(html.includes('thresholdCoSigners'), 'viewer should encode thresholdCoSigners in URL state');
}

// --- local API threshold envelope lifecycle round-trip works ---
{
  const home = makeTempHome();
  await resetApi(home);

  const apiKey = generateApiKey();
  const { server, port } = await startServer({ port: 0, home, apiKey });
  try {
    const pub = await request(port, '/api/v1/articles', 'POST', {
      content: '# Viewer Threshold Test\n\nA test article for threshold attestations.',
      kind: 'subject',
      topic: 'viewer-threshold-test',
      sourceUrl: 'https://example.com/viewer-threshold-test',
      title: 'Viewer Threshold Test'
    }, { authorization: `Bearer ${apiKey}` });
    assert.equal(pub.status, 201, 'publish should succeed');
    const key = pub.json?.summary?.key;
    assert.ok(key, 'publish should return a key');

    const list = await request(port, '/api/v1/list?limit=1000', 'GET', null, { authorization: `Bearer ${apiKey}` });
    assert.equal(list.status, 200, 'list endpoint should return 200');
    assert.ok(list.json.articles.some((a) => a.key === key), 'published article appears in list');

    const id = await api.whoami().then((r) => r.agentId);
    const create = await request(port, '/api/v1/threshold-attest', 'POST', {
      key,
      opinion: 'valid',
      confidence: 0.9,
      reason: 'Multi-sig test.',
      sourceUrl: 'https://example.com/source',
      policy: { threshold: 1, coSignerAgentIds: [id] }
    }, { authorization: `Bearer ${apiKey}` });
    assert.equal(create.status, 201, 'threshold create should return 201');
    const envelope = create.json;
    assert.ok(envelope?.envelopeId, 'create response contains envelopeId');
    assert.ok(Array.isArray(envelope.signers), 'envelope has signers array');

    const sign = await request(port, '/api/v1/threshold-attest/sign-local', 'POST', {
      envelopeId: envelope.envelopeId
    }, { authorization: `Bearer ${apiKey}` });
    assert.equal(sign.status, 200, 'sign-local should return 200');
    assert.ok(sign.json.signers.length >= 1, 'envelope retains at least one local signer');

    const verify = await request(port, '/api/v1/threshold-attest/verify', 'POST', {
      envelope: sign.json
    }, { authorization: `Bearer ${apiKey}` });
    assert.equal(verify.status, 200, 'verify should return 200');
    assert.equal(verify.json.ok, true, 'threshold (1-of-1) should be met after local signing');
    assert.ok(verify.json.valid >= 1, 'at least one valid signature');

    const finalize = await request(port, '/api/v1/threshold-attest/finalize', 'POST', {
      envelopeId: envelope.envelopeId
    }, { authorization: `Bearer ${apiKey}` });
    assert.equal(finalize.status, 201, 'finalize should return 201');
    assert.ok(finalize.json.item?.id || finalize.json.summary?.id, 'finalize returns a published item');

    const importRes = await request(port, '/api/v1/threshold-attest/import', 'POST', {
      envelope: envelope
    }, { authorization: `Bearer ${apiKey}` });
    assert.equal(importRes.status, 200, 'import should return 200');
    assert.equal(importRes.json.envelopeId, envelope.envelopeId, 'import stores the same envelope');

    const get = await request(port, `/api/v1/threshold/envelope/${encodeURIComponent(envelope.envelopeId)}`, 'GET', null, { authorization: `Bearer ${apiKey}` });
    assert.equal(get.status, 200, 'get envelope should return 200');
    assert.equal(get.json.envelopeId, envelope.envelopeId, 'get envelope returns correct id');
  } finally {
    await stopServer(server);
    fs.rmSync(home, { recursive: true, force: true });
  }
}

console.log('viewer-threshold-attest tests passed');
