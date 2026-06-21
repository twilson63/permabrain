/**
 * Viewer agents catalog panel tests.
 *
 * Verifies that the web viewer includes an Agents panel wired to
 * GET /api/v1/agents, supports deep-link state (?view=agents), and
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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-viewer-agents-'));
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

// --- viewer/index.html contains agents panel wiring ---
{
  const html = fs.readFileSync(viewerPath, 'utf8');
  assert.ok(html.includes('id="agentsBtn"'), 'viewer should have agents button');
  assert.ok(html.includes('window.showAgents'), 'viewer should expose showAgents');
  assert.ok(html.includes('window.refreshAgents'), 'viewer should expose refreshAgents');
  assert.ok(html.includes('window.fetchAgents'), 'viewer should expose fetchAgents');
  assert.ok(html.includes('window.renderAgents'), 'viewer should expose renderAgents');
  assert.ok(html.includes('window.setAgentsSort'), 'viewer should expose setAgentsSort');
  assert.ok(html.includes('window.setAgentsLimit'), 'viewer should expose setAgentsLimit');
  assert.ok(html.includes("'agents'"), 'viewer should reference agents view in state handling');
  assert.ok(html.includes("viewMode === 'agents'"), 'agents panel render guard');
  assert.ok(html.includes('/api/v1/agents'), 'viewer should call agents endpoint');
}

// --- local API agents endpoint works, and panel query params pass through ---
{
  const home = makeTempHome();
  await resetApi(home);

  const apiKey = generateApiKey();
  const { server, port } = await startServer({ port: 0, home, apiKey });
  try {
    const pub = await request(port, '/api/v1/articles', 'POST', {
      content: '# Viewer Agents Test\n\nA test article for the agents panel.',
      kind: 'subject',
      topic: 'viewer-agents-test',
      sourceUrl: 'https://example.com/viewer-agents-test',
      title: 'Viewer Agents Test'
    }, { authorization: `Bearer ${apiKey}` });
    assert.equal(pub.status, 201, 'publish should succeed');
    assert.ok(pub.json?.summary?.key, 'publish should return a key');

    const agents = await request(port, '/api/v1/agents', 'GET', null, { authorization: `Bearer ${apiKey}` });
    assert.equal(agents.status, 200, 'agents endpoint should return 200');
    assert.ok(agents.json.generatedAt, 'agents has generatedAt');
    assert.ok(agents.json.home, 'agents has home');
    assert.ok(Array.isArray(agents.json.agents), 'agents response is array');
    assert.equal(typeof agents.json.totals.agents, 'number', 'totals.agents is a number');
    assert.equal(typeof agents.json.totals.articles, 'number', 'totals.articles is a number');
    assert.ok(agents.json.agents.length >= 1, 'at least one agent in catalog');

    const sorted = await request(port, '/api/v1/agents?sort=name&limit=5', 'GET', null, { authorization: `Bearer ${apiKey}` });
    assert.equal(sorted.status, 200, 'agents endpoint should accept sort/limit');
    assert.ok(Array.isArray(sorted.json.agents), 'sorted agents response is array');
    assert.ok(sorted.json.agents.length <= 5, 'limit is respected');
  } finally {
    await stopServer(server);
    fs.rmSync(home, { recursive: true, force: true });
  }
}

console.log('viewer-agents tests passed');
