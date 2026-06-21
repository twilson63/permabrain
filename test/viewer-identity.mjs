/**
 * Viewer Identity panel tests.
 *
 * Verifies that the web viewer includes an Identity panel wired to
 * GET /api/v1/identity/report, supports deep-link state (?view=identity),
 * format toggling, and exposes the expected window functions.
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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-viewer-identity-'));
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

// --- viewer/index.html contains identity panel wiring ---
{
  const html = fs.readFileSync(viewerPath, 'utf8');
  assert.ok(html.includes('id="identityBtn"'), 'viewer should have identity button');
  assert.ok(html.includes('window.showIdentity'), 'viewer should expose showIdentity');
  assert.ok(html.includes('window.refreshIdentity'), 'viewer should expose refreshIdentity');
  assert.ok(html.includes('window.fetchIdentity'), 'viewer should expose fetchIdentity');
  assert.ok(html.includes('window.renderIdentity'), 'viewer should expose renderIdentity');
  assert.ok(html.includes('window.setIdentityFormat'), 'viewer should expose setIdentityFormat');
  assert.ok(html.includes('window.copyIdentityField'), 'viewer should expose copyIdentityField');
  assert.ok(html.includes('window.downloadIdentityJson'), 'viewer should expose downloadIdentityJson');
  assert.ok(html.includes("'identity'"), 'viewer should reference identity view in state handling');
  assert.ok(html.includes("viewMode === 'identity'"), 'identity panel render guard');
  assert.ok(html.includes('/api/v1/identity/report'), 'viewer should call identity report endpoint');
  assert.ok(html.includes('identityState'), 'viewer should have identityState');
  assert.ok(html.includes('identityFormat'), 'viewer should persist identity format in URL');
}

// --- local API identity report endpoint works, including markdown ---
{
  const home = makeTempHome();
  await resetApi(home);

  const apiKey = generateApiKey();
  const { server, port } = await startServer({ port: 0, home, apiKey });
  try {
    const report = await request(port, '/api/v1/identity/report', 'GET', null, { authorization: `Bearer ${apiKey}` });
    assert.equal(report.status, 200, 'identity report endpoint should return 200');
    assert.ok(report.json.agentId, 'identity report has agentId');
    assert.ok(report.json.keyType, 'identity report has keyType');
    assert.ok(report.json.home, 'identity report has home');
    assert.ok(report.json.transport, 'identity report has transport');
    assert.ok(report.json.config, 'identity report has config summary');
    assert.ok(report.json.publicKey, 'identity report has publicKey');
    assert.ok(report.json.encryptionPublicKey, 'identity report has encryptionPublicKey');
    assert.ok(report.json.encryptionFingerprint, 'identity report has encryptionFingerprint');

    const md = await request(port, '/api/v1/identity/report.md', 'GET', null, {
      authorization: `Bearer ${apiKey}`,
      accept: 'text/markdown'
    });
    assert.equal(md.status, 200, 'identity report markdown endpoint should return 200');
    assert.ok(md.headers['content-type'].includes('text/markdown'), 'content-type is markdown');
    assert.ok(md.body.includes('# PermaBrain Identity'), 'markdown includes heading');
    assert.ok(md.body.includes(report.json.agentId), 'markdown includes agentId');
  } finally {
    await stopServer(server);
    fs.rmSync(home, { recursive: true, force: true });
  }
}

console.log('viewer-identity tests passed');
