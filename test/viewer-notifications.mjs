/**
 * Viewer notifications toast stack tests.
 *
 * Verifies that the web viewer includes a notifications bell with an unread
 * badge, a dropdown history panel, toast auto-dismiss persistence into the
 * notification history, deep-link support (?view=notifications / ?notifications=true),
 * and integration with the live stream event toasts.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { startServer, stopServer } from '../src/serve.mjs';
import { api } from '../src/agent-api.mjs';
import { initState } from '../src/config.mjs';
import { generateApiKey } from '../src/auth.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const viewerPath = path.resolve(__dirname, '..', 'viewer', 'index.html');

function makeTempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-viewer-notifications-'));
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

// --- viewer/index.html contains notifications wiring ---
{
  const html = fs.readFileSync(viewerPath, 'utf8');
  assert.ok(html.includes('id="notificationsBtn"'), 'viewer should have notifications button');
  assert.ok(html.includes('id="notificationsBadge"'), 'viewer should have notifications badge');
  assert.ok(html.includes('class="notifications-badge"'), 'viewer should have notifications badge class');
  assert.ok(html.includes('id="notificationsDropdown"'), 'viewer should have notifications dropdown');
  assert.ok(html.includes('id="notificationsList"'), 'viewer should have notifications list container');
  assert.ok(html.includes('window.toggleNotifications'), 'viewer should expose toggleNotifications');
  assert.ok(html.includes('window.showNotifications'), 'viewer should expose showNotifications');
  assert.ok(html.includes('window.hideNotifications'), 'viewer should expose hideNotifications');
  assert.ok(html.includes('window.markNotificationsRead'), 'viewer should expose markNotificationsRead');
  assert.ok(html.includes('window.clearNotifications'), 'viewer should expose clearNotifications');
  assert.ok(html.includes('window.handleNotificationClick'), 'viewer should expose handleNotificationClick');
  assert.ok(html.includes('notificationsState'), 'viewer should track notificationsState');
  assert.ok(html.includes('addNotification'), 'viewer should expose addNotification helper');
  assert.ok(html.includes('renderNotificationsList'), 'viewer should expose renderNotificationsList');
  assert.ok(html.includes('renderNotificationsDropdown'), 'viewer should expose renderNotificationsDropdown');
  assert.ok(html.includes('loadNotificationsState'), 'viewer should load notifications state');
  assert.ok(html.includes('saveNotificationsState'), 'viewer should save notifications state');
  assert.ok(html.includes('updateNotificationsBadge'), 'viewer should update notifications badge');
  assert.ok(html.includes('permabrain-notifications'), 'viewer should persist notifications in localStorage key');
  assert.ok(html.includes("'notifications'"), 'viewer should reference notifications view in state handling');
  assert.ok(html.includes('showToast'), 'viewer should expose showToast');
  assert.ok(html.includes('addNotification(title, body, type'), 'showToast should call addNotification');
}

// --- local API activity endpoint works and returns feed events for notifications ---
{
  const home = makeTempHome();
  await resetApi(home);

  const apiKey = generateApiKey();
  const { server, port } = await startServer({ port: 0, home, apiKey });
  try {
    const empty = await request(port, '/api/v1/activity', 'GET', null, { authorization: `Bearer ${apiKey}` });
    assert.equal(empty.status, 200, 'activity endpoint should return 200');
    assert.ok(Array.isArray(empty.json.events), 'activity response should have events array');

    const body = {
      content: '# Notifications test\n\nTesting the notifications toast stack.',
      title: 'Notifications test',
      key: 'subject/notifications-test',
      kind: 'subject',
      topic: 'notifications-tests',
      sourceUrl: 'https://example.com/notifications',
      sourceName: 'Notifications test',
      language: 'en',
      visibility: 'public'
    };
    const publish = await request(port, '/api/v1/articles', 'POST', body, { authorization: `Bearer ${apiKey}` });
    assert.equal(publish.status, 201, 'publish should return 201');

    const feed = await request(port, '/api/v1/activity?limit=10', 'GET', null, { authorization: `Bearer ${apiKey}` });
    assert.equal(feed.status, 200, 'activity feed should return 200');
    const publishEvent = feed.json.events.find((e) => e.kind === 'publish' && e.key === 'subject/notifications-test');
    assert.ok(publishEvent, 'activity feed should include the published article event');
  } finally {
    await stopServer(server);
    fs.rmSync(home, { recursive: true, force: true });
  }
}

console.log('viewer-notifications tests passed');
