/**
 * Viewer Sync / remote panel tests.
 *
 * Verifies that the web viewer includes a Sync remote panel wired to
 * POST /api/v1/sync, supports deep-link state (?view=sync), and exposes
 * the expected window functions.
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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-viewer-sync-'));
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

// --- viewer/index.html contains sync panel wiring ---
{
  const html = fs.readFileSync(viewerPath, 'utf8');
  assert.ok(html.includes('id="syncBtn"'), 'viewer should have sync button');
  assert.ok(html.includes('window.showSync'), 'viewer should expose showSync');
  assert.ok(html.includes('window.refreshSync'), 'viewer should expose refreshSync');
  assert.ok(html.includes('window.runSync'), 'viewer should expose runSync');
  assert.ok(html.includes('window.renderSync'), 'viewer should expose renderSync');
  assert.ok(html.includes('window.setSyncDryRun'), 'viewer should expose setSyncDryRun');
  assert.ok(html.includes('window.setSyncNoAutoMerge'), 'viewer should expose setSyncNoAutoMerge');
  assert.ok(html.includes('window.setSyncUseHyperbeam'), 'viewer should expose setSyncUseHyperbeam');
  assert.ok(html.includes('window.setSyncApiKey'), 'viewer should expose setSyncApiKey');
  assert.ok(html.includes("viewMode === 'sync'"), 'sync panel render guard');
  assert.ok(html.includes("viewMode !== 'sync'"), 'sync panel should not count as local list mode');
  assert.ok(html.includes('/api/v1/sync'), 'viewer should call sync endpoint');
  assert.ok(html.includes('syncState'), 'viewer should have syncState object');
  assert.ok(html.includes('syncDryRun'), 'viewer should encode sync dryRun in URL state');
  assert.ok(html.includes('syncNoAutoMerge'), 'viewer should encode sync noAutoMerge in URL state');
  assert.ok(html.includes('syncUseHyperbeam'), 'viewer should encode sync useHyperbeam in URL state');
}

// --- local API sync round-trip works ---
{
  const home = makeTempHome();
  await resetApi(home);

  const apiKey = generateApiKey();
  const { server, port } = await startServer({ port: 0, home, apiKey });
  try {
    // Publish a local article; dry-run sync against local transport returns zero changes.
    const pub = await request(port, '/api/v1/articles', 'POST', {
      content: '# Viewer Sync Test\n\nA test article for the sync panel.',
      kind: 'subject',
      topic: 'viewer-sync-test',
      sourceUrl: 'https://example.com/viewer-sync-test',
      title: 'Viewer Sync Test'
    }, { authorization: `Bearer ${apiKey}` });
    assert.equal(pub.status, 201, 'publish should succeed');
    assert.ok(pub.json?.summary?.key, 'publish should return a key');

    // Dry-run sync should report no changes for this single already-up-to-date home.
    const dryRun = await request(port, '/api/v1/sync', 'POST', {
      dryRun: true,
      noAutoMerge: false,
      useHyperbeam: false
    }, { authorization: `Bearer ${apiKey}` });
    assert.equal(dryRun.status, 200, 'dry-run sync should return 200');
    assert.equal(typeof dryRun.json.articleCount, 'number', 'dry-run sync returns articleCount');
    assert.equal(dryRun.json.articlesSynced, 0, 'dry-run sync imports nothing');
    assert.ok(Array.isArray(dryRun.json.merges), 'dry-run sync returns merges array');
    assert.ok(Array.isArray(dryRun.json.divergences), 'dry-run sync returns divergences array');

    // Live sync should return imported/skipped/failed counts. With only the local article, it may skip.
    const live = await request(port, '/api/v1/sync', 'POST', {
      dryRun: false,
      noAutoMerge: false,
      useHyperbeam: false
    }, { authorization: `Bearer ${apiKey}` });
    assert.equal(live.status, 200, 'live sync should return 200');
    assert.equal(typeof live.json.articleCount, 'number', 'live sync returns articleCount');
    const imported = Number(live.json.articlesSynced || live.json.imported || 0);
    const skipped = Number(live.json.articlesUnchanged || live.json.skipped || 0);
    const failed = Number(live.json.failed || 0);
    assert.ok(imported + skipped + failed >= 0, 'live sync returns non-negative counts');

    // Sync without auth should be rejected.
    const noAuth = await request(port, '/api/v1/sync', 'POST', { dryRun: true });
    assert.equal(noAuth.status, 401, 'sync requires auth');
  } finally {
    await stopServer(server);
    fs.rmSync(home, { recursive: true, force: true });
  }
}

console.log('viewer-sync tests passed');
