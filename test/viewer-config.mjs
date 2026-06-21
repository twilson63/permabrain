/**
 * Viewer Configuration panel tests.
 *
 * Verifies that the web viewer includes a Configuration panel wired to
 * GET/POST /api/v1/config, supports deep-link state (?view=config),
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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-viewer-config-'));
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

// --- viewer/index.html contains config panel wiring ---
{
  const html = fs.readFileSync(viewerPath, 'utf8');
  assert.ok(html.includes('id="configBtn"'), 'viewer should have config button');
  assert.ok(html.includes('window.showConfig'), 'viewer should expose showConfig');
  assert.ok(html.includes('window.refreshConfig'), 'viewer should expose refreshConfig');
  assert.ok(html.includes('window.fetchConfig'), 'viewer should expose fetchConfig');
  assert.ok(html.includes('window.renderConfig'), 'viewer should expose renderConfig');
  assert.ok(html.includes('window.runConfigSet'), 'viewer should expose runConfigSet');
  assert.ok(html.includes('window.runConfigReset'), 'viewer should expose runConfigReset');
  assert.ok(html.includes('window.runConfigValidate'), 'viewer should expose runConfigValidate');
  assert.ok(html.includes('window.runConfigEnv'), 'viewer should expose runConfigEnv');
  assert.ok(html.includes("'config'"), 'viewer should reference config view in state handling');
  assert.ok(html.includes("viewMode === 'config'"), 'config panel render guard');
  assert.ok(html.includes('/api/v1/config'), 'viewer should call config endpoint');
  assert.ok(html.includes('configState'), 'viewer should have configState');
}

// --- local API config endpoint works: get, set, env, validate, auth ---
{
  const home = makeTempHome();
  await resetApi(home);

  const apiKey = generateApiKey();
  const { server, port } = await startServer({ port: 0, home, apiKey });
  try {
    const cfg = await request(port, '/api/v1/config', 'GET', null, { authorization: `Bearer ${apiKey}` });
    assert.equal(cfg.status, 200, 'config endpoint should return 200');
    assert.ok(cfg.json.config, 'config response has config');
    assert.ok(cfg.json.config.transport, 'config has transport');
    assert.ok(cfg.json.config.gateway, 'config has gateway');

    const set = await request(port, '/api/v1/config', 'POST', { action: 'set', path: 'transport', value: 'local' }, {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json'
    });
    assert.equal(set.status, 200, 'config set should return 200');
    assert.equal(set.json.path, 'transport');
    assert.equal(set.json.value, 'local');
    const saved = JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf8'));
    assert.equal(saved.transport, 'local', 'set persists to config.json');

    const env = await request(port, '/api/v1/config?action=env', 'GET', null, { authorization: `Bearer ${apiKey}` });
    assert.equal(env.status, 200, 'config env endpoint should return 200');
    assert.ok(env.json.env.PERMABRAIN_TRANSPORT, 'env map includes PERMABRAIN_TRANSPORT');

    const val = await request(port, '/api/v1/config?action=validate', 'GET', null, { authorization: `Bearer ${apiKey}` });
    assert.equal(val.status, 200, 'config validate endpoint should return 200');
    assert.equal(typeof val.json.ok, 'boolean');
    assert.ok(Array.isArray(val.json.errors), 'validate returns errors array');

    const nokey = await request(port, '/api/v1/config');
    assert.equal(nokey.status, 401, 'config endpoint requires API key');
  } finally {
    await stopServer(server);
    fs.rmSync(home, { recursive: true, force: true });
  }
}

console.log('viewer-config tests passed');
