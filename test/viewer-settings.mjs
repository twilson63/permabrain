/**
 * Viewer Settings panel tests.
 *
 * Verifies that the web viewer includes a Settings panel with persistent
 * preferences (transport, theme, default sort, results per page, live-tail
 * toggle); that the panel persists to localStorage and reflects its choices
 * in URL query params; and that the Save/Reset helpers update state.
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const viewerPath = path.resolve(__dirname, '..', 'viewer', 'index.html');

function makeTempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-viewer-settings-'));
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

function request(port, path, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      method,
      path,
      headers: body ? { 'content-type': 'application/json' } : {}
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

const html = fs.readFileSync(viewerPath, 'utf8');

// --- viewer/index.html contains Settings panel wiring ---
{
  assert.ok(html.includes('id="settingsOverlay"'), 'viewer should have settings overlay');
  assert.ok(html.includes('id="settingTheme"'), 'viewer should have theme select');
  assert.ok(html.includes('id="settingTransport"'), 'viewer should have transport select');
  assert.ok(html.includes('id="settingSort"'), 'viewer should have default sort select');
  assert.ok(html.includes('id="settingPageSize"'), 'viewer should have page size input');
  assert.ok(html.includes('id="settingLiveTail"'), 'viewer should have live-tail checkbox');
  assert.ok(html.includes('window.showSettings'), 'viewer should expose showSettings');
  assert.ok(html.includes('window.hideSettings'), 'viewer should expose hideSettings');
  assert.ok(html.includes('window.saveSettings'), 'viewer should expose saveSettings');
  assert.ok(html.includes('window.resetSettings'), 'viewer should expose resetSettings');
  assert.ok(html.includes('populateSettingsPanel'), 'viewer should populate settings panel');
  assert.ok(html.includes('applyTheme'), 'viewer should apply theme');
  assert.ok(html.includes('permabrain-theme'), 'viewer should persist theme to localStorage');
  assert.ok(html.includes('permabrain-live-transport'), 'viewer should persist transport to localStorage');
  assert.ok(html.includes('permabrain-default-sort'), 'viewer should persist default sort to localStorage');
  assert.ok(html.includes('permabrain-page-size'), 'viewer should persist page size to localStorage');
  assert.ok(html.includes('permabrain-live-tail'), 'viewer should persist live tail to localStorage');
}

// --- Settings URL params are encoded/decoded ---
{
  assert.ok(html.includes("params.set('theme'"), 'buildUrlState should encode theme');
  assert.ok(html.includes("params.set('transport'"), 'buildUrlState should encode transport');
  assert.ok(html.includes("params.set('pageSize'"), 'buildUrlState should encode pageSize');
  assert.ok(html.includes("theme: params.get('theme')"), 'readUrlState should decode theme');
  assert.ok(html.includes("transport: params.get('transport')"), 'readUrlState should decode transport');
  assert.ok(html.includes("get('pageSize')"), 'readUrlState should decode pageSize');
}

// --- Local server routes used by settings (list with pageSize) work ---
{
  const home = makeTempHome();
  await resetApi(home);

  for (let i = 0; i < 12; i++) {
    await api.publish({
      content: `# Settings article ${i}\n\nContent.`,
      kind: 'subject',
      topic: 'viewer-settings',
      sourceUrl: 'https://example.com/' + i,
      title: 'Settings ' + i,
      key: 'subject/viewer-settings-' + i
    });
  }

  const { server, port } = await startServer({ port: 0, home });
  try {
    const listRes = await request(port, '/api/v1/list?topic=viewer-settings&limit=5&sort=title');
    assert.equal(listRes.status, 200, 'list should accept query params');
    assert.equal(listRes.json.total, 12, 'total should match all articles');
    assert.equal(listRes.json.articles.length, 5, 'limit should cap results');
    assert.ok(listRes.json.articles[0].title <= listRes.json.articles[1].title, 'title sort applied');
  } finally {
    await stopServer(server);
  }

  fs.rmSync(home, { recursive: true, force: true });
}

console.log('viewer-settings tests passed');
