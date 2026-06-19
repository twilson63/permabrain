/**
 * Viewer dedicated history panel tests.
 *
 * Verifies that the web viewer includes a top-level History panel with a visual
 * timeline, version selection, and diff against prior versions, wired to
 * /api/v1/articles/:key/history and /api/v1/diff, and deep-linked via
 * ?view=history and historyKey=<key>.
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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-viewer-history-'));
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

// --- viewer/index.html contains history panel wiring ---
{
  const html = fs.readFileSync(viewerPath, 'utf8');
  assert.ok(html.includes('id="historyBtn"'), 'viewer should have history button');
  assert.ok(html.includes('window.showHistory'), 'viewer should expose showHistory');
  assert.ok(html.includes('window.refreshHistory'), 'viewer should expose refreshHistory');
  assert.ok(html.includes('window.fetchHistory'), 'viewer should expose fetchHistory');
  assert.ok(html.includes('window.setHistoryKey'), 'viewer should expose setHistoryKey');
  assert.ok(html.includes('window.selectHistoryVersion'), 'viewer should expose selectHistoryVersion');
  assert.ok(html.includes('window.renderHistory'), 'viewer should expose renderHistory');
  assert.ok(html.includes('historyPanelState'), 'viewer should track history panel state');
  assert.ok(html.includes("'history'"), 'viewer should reference history view in state handling');
  assert.ok(html.includes("viewMode === 'history'"), 'viewer should render history when in history mode');
  assert.ok(html.includes('historyKeySelect'), 'viewer should have history key select');
  assert.ok(html.includes('historyKey'), 'viewer should support historyKey URL param');
  assert.ok(html.includes('/api/v1/articles/'), 'viewer should call article history endpoint');
  assert.ok(html.includes('/api/v1/diff'), 'viewer should call diff endpoint');
  assert.ok(html.includes('renderHistoryTimeline'), 'viewer should have timeline renderer');
  assert.ok(html.includes('renderHistoryDiffResult'), 'viewer should have diff renderer');
}

// --- local API history and diff endpoints work across two versions ---
{
  const home = makeTempHome();
  await resetApi(home);

  await api.publish({
    content: '# History test v1\n\nFirst version.',
    kind: 'subject',
    topic: 'viewer-history',
    sourceUrl: 'https://example.com/viewer-history',
    title: 'History Test',
    key: 'subject/viewer-history-test'
  });

  await api.publish({
    content: '# History test v2\n\nSecond version.',
    kind: 'subject',
    topic: 'viewer-history',
    sourceUrl: 'https://example.com/viewer-history',
    title: 'History Test',
    key: 'subject/viewer-history-test'
  });

  await api.attest('subject/viewer-history-test', {
    opinion: 'valid',
    confidence: 0.8,
    reason: 'Looks solid'
  });

  const apiKey = generateApiKey();
  const { server, port } = await startServer({ port: 0, home, apiKey });
  try {
    // History endpoint returns versions + attestations
    const res = await request(port, '/api/v1/articles/' + encodeURIComponent('subject/viewer-history-test') + '/history', 'GET', null, { authorization: `Bearer ${apiKey}` });
    assert.equal(res.status, 200, 'history endpoint should return 200');
    assert.ok(res.json, 'history endpoint should return JSON');
    assert.equal(res.json.key, 'subject/viewer-history-test');
    assert.equal(res.json.versionCount, 2, 'history should have two versions');
    assert.equal(res.json.attestationCount, 1, 'history should have one attestation');
    assert.ok(Array.isArray(res.json.timeline), 'history should include timeline');
    const versions = res.json.timeline.filter((e) => e.type === 'version');
    assert.equal(versions.length, 2, 'timeline should contain two versions');

    // Diff endpoint returns unified diff between version IDs
    const ids = versions.map((e) => e.id);
    const diffRes = await request(port, '/api/v1/diff?base=' + encodeURIComponent(ids[0]) + '&head=' + encodeURIComponent(ids[1]) + '&format=unified', 'GET', null, { authorization: `Bearer ${apiKey}` });
    assert.equal(diffRes.status, 200, 'diff endpoint should return 200');
    assert.ok(diffRes.json, 'diff endpoint should return JSON');
    assert.ok(typeof diffRes.json.text === 'string', 'diff result should include unified text');
    assert.ok(typeof diffRes.json.changes === 'number', 'diff result should include changes count');
    assert.ok(diffRes.json.text.includes('Second version') || diffRes.json.text.includes('First version'), 'diff text should mention one of the versions');
  } finally {
    await stopServer(server);
  }

  fs.rmSync(home, { recursive: true, force: true });
}

console.log('viewer-history tests passed');
