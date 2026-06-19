/**
 * Viewer activity/notifications panel tests.
 *
 * Verifies that the web viewer includes an Activity/Notifications panel wired to
 * GET /api/v1/activity, supports deep-link state (?view=activity), event-kind,
 * topic, key, agent, and date filters, renders a live activity feed, exposes
 * toast helpers, and consumes stream events.
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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-viewer-activity-'));
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

// --- viewer/index.html contains activity panel wiring ---
{
  const html = fs.readFileSync(viewerPath, 'utf8');
  assert.ok(html.includes('id="activityBtn"'), 'viewer should have activity button');
  assert.ok(html.includes('window.showActivity'), 'viewer should expose showActivity');
  assert.ok(html.includes('window.refreshActivity'), 'viewer should expose refreshActivity');
  assert.ok(html.includes('window.fetchActivity'), 'viewer should expose fetchActivity');
  assert.ok(html.includes('window.renderActivity'), 'viewer should expose renderActivity');
  assert.ok(html.includes('window.setActivityFilter'), 'viewer should expose setActivityFilter');
  assert.ok(html.includes('window.resetActivityFilters'), 'viewer should expose resetActivityFilters');
  assert.ok(html.includes('activityState.filters'), 'viewer should track activity filters');
  assert.ok(html.includes('activityState.limit'), 'viewer should track activity limit');
  assert.ok(html.includes("'activity'"), 'viewer should reference activity view in state handling');
  assert.ok(html.includes("viewMode === 'activity'"), 'viewer should render activity when in activity mode');
  assert.ok(html.includes('activity-panel'), 'viewer should have activity panel class');
  assert.ok(html.includes('activity-filters'), 'viewer should have activity filters class');
  assert.ok(html.includes('toast-container'), 'viewer should have toast container');
  assert.ok(html.includes('showToast'), 'viewer should expose showToast');
  assert.ok(html.includes('/api/v1/activity'), 'viewer should call activity endpoint');
  assert.ok(html.includes('handleStreamEvent'), 'viewer should handle stream events');
}

// --- local API activity endpoint works and returns feed events ---
{
  const home = makeTempHome();
  await resetApi(home);

  const apiKey = generateApiKey();
  const { server, port } = await startServer({ port: 0, home, apiKey });
  try {
    // Empty feed returns an events array
    const empty = await request(port, '/api/v1/activity', 'GET', null, { authorization: `Bearer ${apiKey}` });
    assert.equal(empty.status, 200, 'activity endpoint should return 200');
    assert.ok(Array.isArray(empty.json.events), 'activity response should have events array');

    // Without auth fails
    const noAuth = await request(port, '/api/v1/activity');
    assert.equal(noAuth.status, 401, 'activity endpoint without key should 401');

    // Publish an article so activity feed gets an event
    const body = {
      content: '# Activity test\n\nTesting the activity panel.',
      title: 'Activity test',
      key: 'subject/activity-test',
      kind: 'subject',
      topic: 'activity-tests',
      sourceUrl: 'https://example.com/activity',
      sourceName: 'Activity test',
      language: 'en',
      visibility: 'public'
    };
    const publish = await request(port, '/api/v1/articles', 'POST', body, { authorization: `Bearer ${apiKey}` });
    assert.equal(publish.status, 201, 'publish should return 201');

    const feed = await request(port, '/api/v1/activity?limit=10', 'GET', null, { authorization: `Bearer ${apiKey}` });
    assert.equal(feed.status, 200, 'activity feed should return 200');
    assert.ok(feed.json.events.length >= 1, 'activity feed should contain at least one event');
    const publishEvent = feed.json.events.find((e) => e.kind === 'publish' && e.key === 'subject/activity-test');
    assert.ok(publishEvent, 'activity feed should include the published article event');
    assert.equal(publishEvent.topic, 'activity-tests', 'publish event should carry topic');

    // Filter by event kind
    const filtered = await request(port, '/api/v1/activity?event-kind=publish&limit=10', 'GET', null, { authorization: `Bearer ${apiKey}` });
    assert.equal(filtered.status, 200, 'filtered activity feed should return 200');
    assert.ok(filtered.json.events.every((e) => e.kind === 'publish'), 'filtered feed should only contain publish events');

    // Filter by topic
    const topicFilter = await request(port, '/api/v1/activity?topic=activity-tests&limit=10', 'GET', null, { authorization: `Bearer ${apiKey}` });
    assert.equal(topicFilter.status, 200, 'topic-filtered activity feed should return 200');
    assert.ok(topicFilter.json.events.every((e) => e.topic === 'activity-tests' || e.targetTopic === 'activity-tests'), 'topic filter should match activity topic');
  } finally {
    await stopServer(server);
    fs.rmSync(home, { recursive: true, force: true });
  }
}

console.log('viewer-activity tests passed');
