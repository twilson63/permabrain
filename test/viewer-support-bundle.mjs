/**
 * Viewer support-bundle panel tests.
 *
 * Verifies that the web viewer includes a Support Bundle diagnostics panel
 * wired to GET /api/v1/support-bundle, supports deep-link state (?view=support),
 * JSON/Markdown format toggle, copy/download actions, redaction notice, and
 * API-key auth.
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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-viewer-support-bundle-'));
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

// --- viewer/index.html contains support-bundle panel wiring ---
{
  const html = fs.readFileSync(viewerPath, 'utf8');
  assert.ok(html.includes('id="supportBundleBtn"'), 'viewer should have support bundle button');
  assert.ok(html.includes('window.showSupportBundle'), 'viewer should expose showSupportBundle');
  assert.ok(html.includes('window.refreshSupportBundle'), 'viewer should expose refreshSupportBundle');
  assert.ok(html.includes('window.renderSupportBundle'), 'viewer should expose renderSupportBundle');
  assert.ok(html.includes('window.copySupportBundle'), 'viewer should expose copySupportBundle');
  assert.ok(html.includes('window.downloadSupportBundle'), 'viewer should expose downloadSupportBundle');
  assert.ok(html.includes("'support'"), 'viewer should reference support view in state handling');
  assert.ok(html.includes("viewMode === 'support'"), 'boot should restore support view');
  assert.ok(html.includes('support-bundle-panel'), 'viewer should have support bundle panel class');
  assert.ok(html.includes('support-bundle-json'), 'viewer should have support bundle json class');
  assert.ok(html.includes('/api/v1/support-bundle'), 'viewer should call support bundle endpoint');
  assert.ok(html.includes('Redacted'), 'viewer should display redaction notice');
  assert.ok(html.includes('supportBundleState.format'), 'viewer should track bundle format');
  assert.ok(html.includes("'markdown'"), 'viewer should support markdown format');
}

// --- local API support-bundle endpoint works and requires auth ---
{
  const home = makeTempHome();
  await resetApi(home);

  const apiKey = generateApiKey();
  const { server, port } = await startServer({ port: 0, home, apiKey });
  try {
    // Without auth fails
    const noAuth = await request(port, '/api/v1/support-bundle');
    assert.equal(noAuth.status, 401, 'support bundle without key should 401');

    // With auth returns JSON bundle
    const json = await request(port, '/api/v1/support-bundle', 'GET', null, { authorization: `Bearer ${apiKey}` });
    assert.equal(json.status, 200, 'support bundle should return 200');
    assert.ok(json.json.generatedAt, 'bundle has generatedAt');
    assert.equal(json.json.home, home, 'bundle home matches');
    assert.ok(json.json.identity, 'bundle has identity');
    assert.ok(json.json.config, 'bundle has config');
    assert.ok(json.json.indexSummary, 'bundle has indexSummary');
    assert.ok(json.json.metrics, 'bundle has metrics');
    assert.ok(Array.isArray(json.json.routes), 'bundle has routes');
    assert.ok(json.json.routes.some((r) => r.route === '/api/v1/support-bundle'), 'support-bundle route listed');
    assert.ok(!json.json.identity.secretKey, 'secret key not exposed');

    // Markdown variant
    const md = await request(port, '/api/v1/support-bundle', 'GET', null, {
      authorization: `Bearer ${apiKey}`,
      accept: 'text/markdown'
    });
    assert.equal(md.status, 200, 'markdown support bundle should return 200');
    assert.ok(md.headers['content-type'].includes('text/markdown'), 'markdown content-type');
    assert.ok(md.body.includes('# PermaBrain Support Bundle'), 'markdown header present');
    assert.ok(md.body.includes(json.json.identity.agentId), 'markdown includes agent id');
  } finally {
    await stopServer(server);
    fs.rmSync(home, { recursive: true, force: true });
  }
}

console.log('viewer-support-bundle tests passed');
