/**
 * Viewer version history + stats dashboard integration tests.
 *
 * Verifies that the static viewer HTML:
 *   1. Includes local API history + stats rendering code and a stats button.
 *   2. Can fetch version history from /api/v1/articles/:key/history.
 *   3. Can fetch aggregate stats from /api/v1/stats.
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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-viewer-history-stats-'));
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
      path
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

// --- viewer/index.html includes history + stats integration code ---
{
  const html = fs.readFileSync(viewerPath, 'utf8');
  assert.ok(html.includes('/api/v1/articles/'), 'viewer should reference article API');
  assert.ok(html.includes('/api/v1/stats'), 'viewer should reference stats API');
  assert.ok(html.includes('fetchLocalHistory'), 'viewer should fetch local history');
  assert.ok(html.includes('renderHistoryTab'), 'viewer should render history tab');
  assert.ok(html.includes('renderStatsDashboard'), 'viewer should render stats dashboard');
  assert.ok(html.includes('showStats'), 'viewer should expose showStats');
  assert.ok(html.includes('id="statsBtn"'), 'viewer should have stats button');
}

// --- history endpoint returns versions and attestations ---
{
  const home = makeTempHome();
  await resetApi(home);

  // Publish two versions of the same article
  const v1 = await api.publish({
    content: '# History test v1\n\nFirst.',
    kind: 'subject',
    topic: 'viewer-history-stats',
    sourceUrl: 'https://example.com/viewer-history-stats',
    title: 'History Stats Test',
    key: 'subject/viewer-history-stats-test'
  });
  const v2 = await api.publish({
    content: '# History test v2\n\nSecond.',
    kind: 'subject',
    topic: 'viewer-history-stats',
    sourceUrl: 'https://example.com/viewer-history-stats',
    title: 'History Stats Test',
    key: 'subject/viewer-history-stats-test'
  });
  await api.attest('subject/viewer-history-stats-test', {
    opinion: 'valid',
    confidence: 0.9,
    reason: 'Good'
  });

  const { server, port } = await startServer({ port: 0, home });
  try {
    const res = await request(port, '/api/v1/articles/' + encodeURIComponent('subject/viewer-history-stats-test') + '/history');
    assert.equal(res.status, 200, 'history endpoint should return 200');
    assert.ok(res.json, 'history endpoint should return JSON');
    assert.equal(res.json.key, 'subject/viewer-history-stats-test');
    assert.equal(res.json.versionCount, 2, 'history should have two versions');
    assert.equal(res.json.attestationCount, 1, 'history should have one attestation');
    assert.ok(Array.isArray(res.json.timeline), 'history should include timeline');
    assert.ok(res.json.timeline.length >= 3, 'timeline should include versions + attestation');

    const statsRes = await request(port, '/api/v1/stats');
    assert.equal(statsRes.status, 200, 'stats endpoint should return 200');
    assert.ok(statsRes.json, 'stats endpoint should return JSON');
    assert.ok(statsRes.json.totals, 'stats should include totals');
    assert.equal(statsRes.json.totals.articles, 1, 'stats should count one article');
    assert.equal(statsRes.json.totals.attestations, 1, 'stats should count one attestation');
  } finally {
    await stopServer(server);
  }

  fs.rmSync(home, { recursive: true, force: true });
}

console.log('viewer-history-stats tests passed');
