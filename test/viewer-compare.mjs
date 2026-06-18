/**
 * Viewer Compare tab tests.
 *
 * Verifies that the static viewer HTML includes a Compare tab for diff/merge
 * visualization, exposes helpers to pick base/head articles and render the
 * result, and that the local HTTP API diff/merge endpoints used by the tab
 * work as expected.
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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-viewer-compare-'));
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

// --- viewer/index.html contains Compare tab wiring ---
{
  const html = fs.readFileSync(viewerPath, 'utf8');
  assert.ok(html.includes('Compare'), 'viewer should mention Compare tab');
  assert.ok(html.includes('comparePanel'), 'viewer should have compare panel');
  assert.ok(html.includes('compareBaseSelect'), 'viewer should have compare base select');
  assert.ok(html.includes('compareHeadSelect'), 'viewer should have compare head select');
  assert.ok(html.includes('window.showCompare'), 'viewer should expose showCompare');
  assert.ok(html.includes('window.runCompare'), 'viewer should expose runCompare');
  assert.ok(html.includes('window.renderCompareResult'), 'viewer should expose renderCompareResult');
  assert.ok(html.includes('/api/v1/diff'), 'viewer should call /api/v1/diff');
  assert.ok(html.includes('/api/v1/merge'), 'viewer should call /api/v1/merge');
  assert.ok(html.includes("params.set('compare'"), 'viewer should support compare URL param');
  assert.ok(html.includes('diff-hunk'), 'viewer should have diff hunk class');
  assert.ok(html.includes('conflict-marker'), 'viewer should have conflict marker class');
}

// --- local API diff and merge endpoints work and return usable structures ---
{
  const home = makeTempHome();
  await resetApi(home);

  const base = await api.publish({
    content: '# Compare base\n\nLine one.\nLine two.',
    kind: 'subject',
    topic: 'viewer-compare',
    sourceUrl: 'https://example.com/base',
    title: 'Compare Base',
    key: 'subject/viewer-compare-base'
  });

  // Publish a fork from base then add a conflicting change to the fork.
  const fork = await api.fork('subject/viewer-compare-base', {
    content: '# Compare base\n\nLine one.\nLine two changed in fork.',
    key: 'subject/viewer-compare-fork'
  });
  const forkId = fork.fork.id;

  // Publish a separate change on base so target diverges too.
  await api.publish({
    content: '# Compare base\n\nLine one changed in base.\nLine two.',
    kind: 'subject',
    topic: 'viewer-compare',
    sourceUrl: 'https://example.com/base',
    title: 'Compare Base',
    key: 'subject/viewer-compare-base'
  });

  const { server, port } = await startServer({ port: 0, home });
  try {
    // Diff by canonical keys returns unified diff.
    const diffRes = await request(
      port,
      '/api/v1/diff?base=' + encodeURIComponent('subject/viewer-compare-base') +
      '&head=' + encodeURIComponent('subject/viewer-compare-fork')
    );
    assert.equal(diffRes.status, 200, 'diff endpoint should return 200');
    assert.ok(diffRes.json, 'diff endpoint should return JSON');
    assert.ok(diffRes.json.text, 'diff result should include unified text');
    assert.ok(typeof diffRes.json.changes === 'number', 'diff result should include changes count');
    assert.ok(Array.isArray(diffRes.json.hunks), 'diff result should include hunks');

    // Merge endpoint creates a new target version with conflict markers.
    const mergeRes = await request(port, '/api/v1/merge', 'POST', {
      targetKey: 'subject/viewer-compare-base',
      sourceKey: 'subject/viewer-compare-fork',
      noCarryAttestations: true
    });
    assert.equal(mergeRes.status, 201, 'merge endpoint should return 201');
    assert.ok(mergeRes.json, 'merge endpoint should return JSON');
    assert.equal(mergeRes.json.target.key, 'subject/viewer-compare-base');
    assert.equal(mergeRes.json.source.key, 'subject/viewer-compare-fork');
    assert.ok(typeof mergeRes.json.hasConflicts === 'boolean', 'merge result should include hasConflicts');
    assert.ok(typeof mergeRes.json.conflictCount === 'number', 'merge result should include conflictCount');

    // Diff by version IDs works too.
    const baseId = base.summary.id;
    const idDiffRes = await request(
      port,
      '/api/v1/diff?base=' + encodeURIComponent(baseId) + '&head=' + encodeURIComponent(forkId)
    );
    assert.equal(idDiffRes.status, 200, 'diff by ids should return 200');
    assert.ok(idDiffRes.json.text, 'diff by ids should include unified text');
  } finally {
    await stopServer(server);
  }

  fs.rmSync(home, { recursive: true, force: true });
}

console.log('viewer-compare tests passed');
