/**
 * Viewer Webhooks / Integrations panel tests.
 *
 * Verifies that the web viewer includes a Webhooks panel wired to
 * GET/POST /api/v1/webhooks, POST /api/v1/webhooks/test,
 * GET /api/v1/webhooks/history, and POST /api/v1/webhooks/toggle;
 * supports deep-link state (?view=webhooks), and exposes the expected
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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-viewer-webhooks-'));
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

// --- viewer/index.html contains webhooks panel wiring ---
{
  const html = fs.readFileSync(viewerPath, 'utf8');
  assert.ok(html.includes('id="webhooksBtn"'), 'viewer should have webhooks button');
  assert.ok(html.includes('window.showWebhooks'), 'viewer should expose showWebhooks');
  assert.ok(html.includes('window.refreshWebhooks'), 'viewer should expose refreshWebhooks');
  assert.ok(html.includes('window.fetchWebhooks'), 'viewer should expose fetchWebhooks');
  assert.ok(html.includes('window.renderWebhooks'), 'viewer should expose renderWebhooks');
  assert.ok(html.includes('window.setWebhookForm'), 'viewer should expose setWebhookForm');
  assert.ok(html.includes('window.setWebhookTest'), 'viewer should expose setWebhookTest');
  assert.ok(html.includes('window.setWebhooksApiKey'), 'viewer should expose setWebhooksApiKey');
  assert.ok(html.includes('window.setWebhooksShowJson'), 'viewer should expose setWebhooksShowJson');
  assert.ok(html.includes('window.setWebhooksHistoryLimit'), 'viewer should expose setWebhooksHistoryLimit');
  assert.ok(html.includes('window.setWebhooksSelectedId'), 'viewer should expose setWebhooksSelectedId');
  assert.ok(html.includes('window.addWebhookFromForm'), 'viewer should expose addWebhookFromForm');
  assert.ok(html.includes('window.toggleWebhookById'), 'viewer should expose toggleWebhookById');
  assert.ok(html.includes('window.deleteWebhookById'), 'viewer should expose deleteWebhookById');
  assert.ok(html.includes('window.runWebhookTest'), 'viewer should expose runWebhookTest');
  assert.ok(html.includes('window.copyWebhooksJson'), 'viewer should expose copyWebhooksJson');
  assert.ok(html.includes('window.downloadWebhooksJson'), 'viewer should expose downloadWebhooksJson');
  assert.ok(html.includes("viewMode === 'webhooks'"), 'webhooks panel render guard');
  assert.ok(html.includes("'webhooks'"), 'viewer should reference webhooks view in state handling');
  assert.ok(html.includes('/api/v1/webhooks'), 'viewer should call webhooks endpoint');
  assert.ok(html.includes('/api/v1/webhooks/test'), 'viewer should call webhooks test endpoint');
  assert.ok(html.includes('/api/v1/webhooks/history'), 'viewer should call webhooks history endpoint');
  assert.ok(html.includes('/api/v1/webhooks/toggle'), 'viewer should call webhooks toggle endpoint');
  assert.ok(html.includes('webhooksState'), 'viewer should have webhooksState');
  assert.ok(html.includes('webhooksApiKey'), 'viewer should encode webhooks API key in URL state');
  assert.ok(html.includes('webhooksShowJson'), 'viewer should encode webhooks showJson in URL state');
  assert.ok(html.includes('webhooksHistoryLimit'), 'viewer should encode webhooks history limit in URL state');
  assert.ok(html.includes('webhooksSelectedId'), 'viewer should encode webhooks selected id in URL state');
}

// --- local API webhooks lifecycle round-trip works ---
{
  const home = makeTempHome();
  await resetApi(home);

  const apiKey = generateApiKey();
  const { server, port } = await startServer({ port: 0, home, apiKey });
  try {
    // Empty list
    const listEmpty = await request(port, '/api/v1/webhooks', 'GET', null, { authorization: `Bearer ${apiKey}` });
    assert.equal(listEmpty.status, 200, 'list webhooks should return 200');
    assert.deepEqual(listEmpty.json.subscriptions, [], 'no webhooks initially');
    assert.equal(listEmpty.json.count, 0, 'count is 0');

    // Register webhook
    const add = await request(port, '/api/v1/webhooks', 'POST', {
      url: 'https://example.com/hook',
      events: ['article.published'],
      active: true
    }, { authorization: `Bearer ${apiKey}` });
    assert.equal(add.status, 201, 'add webhook should return 201');
    assert.equal(add.json.created, true, 'add reports created');
    assert.equal(add.json.subscription.url, 'https://example.com/hook', 'added webhook url');
    assert.ok(add.json.subscription.id, 'added webhook has id');
    assert.equal(add.json.subscription.active, true, 'added webhook active');

    // List after add
    const listAfter = await request(port, '/api/v1/webhooks', 'GET', null, { authorization: `Bearer ${apiKey}` });
    assert.equal(listAfter.json.count, 1, 'count after add');
    assert.equal(listAfter.json.subscriptions[0].url, 'https://example.com/hook', 'webhook persisted');
    const id = listAfter.json.subscriptions[0].id;

    // Toggle off
    const toggle = await request(port, '/api/v1/webhooks/toggle', 'POST', { id }, { authorization: `Bearer ${apiKey}` });
    assert.equal(toggle.status, 200, 'toggle webhook should return 200');
    assert.equal(toggle.json.active, false, 'toggle disabled webhook');
    const listOff = await request(port, '/api/v1/webhooks', 'GET', null, { authorization: `Bearer ${apiKey}` });
    assert.equal(listOff.json.subscriptions[0].active, false, 'toggle persisted');

    // Test webhook to local HTTP endpoint is hard without a listener; use an invalid URL to exercise route
    const testHook = await request(port, '/api/v1/webhooks/test', 'POST', {
      url: 'http://127.0.0.1:1/invalid',
      payload: { type: 'test' }
    }, { authorization: `Bearer ${apiKey}` });
    assert.equal(testHook.status, 200, 'test webhook should return 200');
    assert.equal(testHook.json.ok, false, 'test reports failure for unreachable url');
    assert.ok(testHook.json.record, 'test returns delivery record');

    // History
    const history = await request(port, '/api/v1/webhooks/history', 'GET', null, { authorization: `Bearer ${apiKey}` });
    assert.equal(history.status, 200, 'history should return 200');
    assert.equal(history.json.count, 1, 'history contains test delivery');
    assert.equal(history.json.deliveries[0].event, 'test', 'history event is test');

    // Delete
    const del = await request(port, `/api/v1/webhooks?id=${encodeURIComponent(id)}`, 'DELETE', null, { authorization: `Bearer ${apiKey}` });
    assert.equal(del.status, 200, 'delete webhook should return 200');
    assert.equal(del.json.deleted, true, 'delete reports deleted');
    const listFinal = await request(port, '/api/v1/webhooks', 'GET', null, { authorization: `Bearer ${apiKey}` });
    assert.equal(listFinal.json.count, 0, 'final count is 0');

    // Auth enforcement
    const listNoAuth = await request(port, '/api/v1/webhooks', 'GET');
    assert.equal(listNoAuth.status, 401, 'list webhooks requires auth');

    const addNoAuth = await request(port, '/api/v1/webhooks', 'POST', { url: 'https://x' });
    assert.equal(addNoAuth.status, 401, 'add webhook requires auth');

    const testNoAuth = await request(port, '/api/v1/webhooks/test', 'POST', { url: 'https://x' });
    assert.equal(testNoAuth.status, 401, 'test webhook requires auth');
  } finally {
    await stopServer(server);
    fs.rmSync(home, { recursive: true, force: true });
  }
}

console.log('viewer-webhooks tests passed');
