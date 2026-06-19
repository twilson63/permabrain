/**
 * Viewer health / diagnostics panel tests.
 *
 * Verifies that the web viewer includes a Health panel wired to GET /health,
 * GET /api/v1/routes, and GET /api/v1/admin, supports deep-link state
 * (?view=health), and exposes the expected window functions.
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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-viewer-health-'));
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

// --- viewer/index.html contains health panel wiring ---
{
  const html = fs.readFileSync(viewerPath, 'utf8');
  assert.ok(html.includes('id="healthBtn"'), 'viewer should have health button');
  assert.ok(html.includes('window.showHealth'), 'viewer should expose showHealth');
  assert.ok(html.includes('window.refreshHealth'), 'viewer should expose refreshHealth');
  assert.ok(html.includes('window.fetchHealth'), 'viewer should expose fetchHealth');
  assert.ok(html.includes('window.renderHealth'), 'viewer should expose renderHealth');
  assert.ok(html.includes("'health'"), 'viewer should reference health view in state handling');
  assert.ok(html.includes("viewMode === 'health'"), 'health panel render guard');
  assert.ok(html.includes("viewMode !== 'health'"), 'health panel should not count as local list mode');
  assert.ok(html.includes('/health'), 'viewer should call health endpoint');
  assert.ok(html.includes('/api/v1/routes'), 'viewer should call routes endpoint');
  assert.ok(html.includes('/api/v1/admin'), 'viewer should call admin endpoint');
}

// --- local API health and routes endpoints work ---
{
  const home = makeTempHome();
  await resetApi(home);

  const apiKey = generateApiKey();
  const { server, port } = await startServer({ port: 0, home, apiKey });
  try {
    const health = await request(port, '/health');
    assert.equal(health.status, 200, 'health endpoint should return 200');
    assert.equal(health.json.ok, true, 'health status ok');
    assert.ok(health.json.transport, 'health has transport');
    assert.ok(health.json.home, 'health has home');

    const routes = await request(port, '/api/v1/routes', 'GET', null, { authorization: `Bearer ${apiKey}` });
    assert.equal(routes.status, 200, 'routes endpoint should return 200');
    assert.ok(Array.isArray(routes.json.routes), 'routes response is array');
    assert.ok(routes.json.routes.some((r) => r.route === '/health'), 'routes includes /health');
    assert.ok(routes.json.routes.some((r) => r.route === '/api/v1/routes'), 'routes includes /api/v1/routes');

    const admin = await request(port, '/api/v1/admin', 'GET', null, { authorization: `Bearer ${apiKey}` });
    assert.equal(admin.status, 200, 'admin endpoint should return 200');
    assert.ok(admin.json.generatedAt, 'admin has generatedAt');
    assert.ok(admin.json.agentId, 'admin has agentId');
    assert.ok(admin.json.transport, 'admin has transport');
    assert.ok(admin.json.metrics, 'admin has metrics');
    assert.ok(admin.json.metrics.runtime, 'admin metrics has runtime');
    assert.ok(admin.json.metrics.data, 'admin metrics has data');
  } finally {
    await stopServer(server);
    fs.rmSync(home, { recursive: true, force: true });
  }
}

console.log('viewer-health tests passed');
