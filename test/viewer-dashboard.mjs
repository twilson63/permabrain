/**
 * Viewer dashboard integration tests.
 *
 * Verifies that the static viewer HTML includes the local dashboard UI,
 * and that the local HTTP API's dashboard endpoint returns live stats/activity.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, stopServer } from '../src/serve.mjs';
import { api } from '../src/agent-api.mjs';
import { initState } from '../src/config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const viewerPath = path.resolve(__dirname, '..', 'viewer', 'index.html');

function makeTempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-viewer-dashboard-'));
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

// --- viewer/index.html contains the dashboard integration code ---
{
  const html = fs.readFileSync(viewerPath, 'utf8');
  assert.ok(html.includes('window.showDashboard'), 'viewer should expose showDashboard');
  assert.ok(html.includes('window.showHome'), 'viewer should expose showHome');
  assert.ok(html.includes('/api/v1/dashboard'), 'viewer should fetch /api/v1/dashboard');
  assert.ok(html.includes('Local Dashboard'), 'viewer should title the local dashboard');
  assert.ok(html.includes('dashboard-section'), 'viewer should have dashboard-section CSS');
  assert.ok(html.includes('dashboardBtn'), 'viewer should have dashboard button');
  assert.ok(html.includes('homeBtn'), 'viewer should have home button');
}

// --- local server dashboard JSON route returns live stats/activity/audit ---
{
  const home = makeTempHome();
  await resetApi(home);

  // Publish an article so the dashboard has data
  const publish = await api.publish({
    content: '# Local dashboard test article\n\nHello from the viewer dashboard.',
    kind: 'subject',
    topic: 'viewer-dashboard',
    sourceUrl: 'https://example.com/viewer-dashboard',
    key: 'subject/viewer-dashboard-test'
  });
  assert.ok(publish.id || publish.summary?.id, 'publish should return an id');

  // Attest to it
  const attest = await api.attest('subject/viewer-dashboard-test', {
    opinion: 'valid',
    confidence: 0.9,
    reason: 'looks good'
  });
  assert.ok(attest.id || attest.summary?.id, 'attest should return an id');

  const { server, port } = await startServer({ port: 0, home });
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/dashboard`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.generatedAt, 'dashboard should have generatedAt');
    assert.ok(data.agentId, 'dashboard should have agentId');
    assert.equal(data.transport, 'local');
    assert.ok(data.stats, 'dashboard should have stats');
    assert.ok(data.stats.totals, 'dashboard should have stats.totals');
    assert.equal(data.stats.totals.articles, 1, 'should count 1 article');
    assert.equal(data.stats.totals.attestations, 1, 'should count 1 attestation');
    assert.ok(data.list, 'dashboard should have list');
    assert.equal(data.list.total, 1, 'list total should be 1');
    assert.equal(data.list.articles[0]?.key, 'subject/viewer-dashboard-test');
    assert.ok(data.activity, 'dashboard should have activity');
    assert.ok(data.activity.total >= 2, 'activity total should include publish and attest');
    assert.ok(data.log, 'dashboard should have log');
    assert.ok(Array.isArray(data.log.entries), 'log entries should be an array');
    assert.ok(data.log.entries.length >= 2, 'audit log should include publish and attest');

    const htmlRes = await fetch(`http://127.0.0.1:${port}/api/v1/dashboard.html`);
    assert.equal(htmlRes.status, 200);
    const html = await htmlRes.text();
    assert.ok(html.includes('PermaBrain Dashboard'), 'dashboard.html should have title');
    assert.ok(html.includes(data.agentId), 'dashboard.html should include agent id');
  } finally {
    await stopServer(server);
  }

  fs.rmSync(home, { recursive: true, force: true });
}

console.log('viewer-dashboard tests passed');
