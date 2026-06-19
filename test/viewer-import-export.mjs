/**
 * Viewer import/export panel tests.
 *
 * Verifies that the web viewer includes Import and Export panels wired to
 * /api/v1/bundles and /api/v1/history-export / history-import, supports deep-link
 * state (?view=import / ?view=export, ?exportKey=, ?exportMode=), and that the
 * underlying HTTP endpoints can round-trip a bundle through a new node.
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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-viewer-import-export-'));
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

function request(port, reqPath, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      method,
      path: reqPath,
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

// --- viewer/index.html contains import/export wiring ---
{
  const html = fs.readFileSync(viewerPath, 'utf8');
  assert.ok(html.includes('id="importBtn"'), 'viewer should have import button');
  assert.ok(html.includes('id="exportBtn"'), 'viewer should have export button');
  assert.ok(html.includes('window.showImport'), 'viewer should expose showImport');
  assert.ok(html.includes('window.showExport'), 'viewer should expose showExport');
  assert.ok(html.includes('window.performImport'), 'viewer should expose performImport');
  assert.ok(html.includes('window.performExport'), 'viewer should expose performExport');
  assert.ok(html.includes('window.pickImportFile'), 'viewer should expose pickImportFile');
  assert.ok(html.includes('window.onImportFileSelected'), 'viewer should expose onImportFileSelected');
  assert.ok(html.includes('window.exportCurrentArticle'), 'viewer should expose exportCurrentArticle');
  assert.ok(html.includes('window.exportCurrentHistory'), 'viewer should expose exportCurrentHistory');
  assert.ok(html.includes('id="importFileInput"'), 'viewer should have hidden file input');
  assert.ok(html.includes('id="exportKeySelect"'), 'viewer should have export key select');
  assert.ok(html.includes('id="exportModeSelect"'), 'viewer should have export mode select');
  assert.ok(html.includes("params.set('view', viewMode)"), 'buildUrlState should encode view');
  assert.ok(html.includes("viewMode === 'import'"), 'buildUrlState should handle import view');
  assert.ok(html.includes("viewMode === 'export'"), 'buildUrlState should handle export view');
  assert.ok(html.includes("params.set('exportKey'"), 'buildUrlState should encode exportKey');
  assert.ok(html.includes("params.set('exportMode'"), 'buildUrlState should encode exportMode');
  assert.ok(html.includes("'import','export'"), 'applyUrlState should allow import/export views');
  assert.ok(html.includes('bootState.view === \'import\''), 'boot should restore import view');
  assert.ok(html.includes('bootState.view === \'export\''), 'boot should restore export view');
}

// --- local API bundle and history endpoints work and round-trip ---
{
  const home = makeTempHome();
  await resetApi(home);

  await api.publish({
    content: '# Export article\n\nOriginal line.',
    kind: 'subject',
    topic: 'viewer-import-export',
    sourceUrl: 'https://example.com/export',
    title: 'Export Article',
    key: 'subject/viewer-import-export'
  });
  await api.publish({
    content: '# Export article\n\nUpdated line.',
    kind: 'subject',
    topic: 'viewer-import-export',
    sourceUrl: 'https://example.com/export',
    title: 'Export Article',
    key: 'subject/viewer-import-export'
  });
  await api.attest('subject/viewer-import-export', { opinion: 'valid', confidence: 0.9, reason: 'Looks good' });

  const { server, port } = await startServer({ port: 0, home });
  try {
    // Bundle export
    const bundleRes = await request(port, '/api/v1/bundles?key=' + encodeURIComponent('subject/viewer-import-export'));
    assert.equal(bundleRes.status, 200, 'bundle export should return 200');
    assert.ok(Array.isArray(bundleRes.json.entries), 'bundle should have entries');
    assert.ok(bundleRes.json.entries.some((e) => e.type === 'article'), 'bundle should contain an article');
    assert.ok(bundleRes.json.entries.some((e) => e.type === 'attestation'), 'bundle should contain attestations');

    // History export
    const historyRes = await request(port, '/api/v1/history-export?key=' + encodeURIComponent('subject/viewer-import-export'));
    assert.equal(historyRes.status, 200, 'history export should return 200');
    assert.equal(historyRes.json.type, 'history', 'history bundle should have type history');
    assert.equal(historyRes.json.meta.type, 'history', 'history bundle meta should have type history');
    assert.ok(Array.isArray(historyRes.json.entries), 'history bundle should have entries');
    const articleCount = historyRes.json.entries.filter((e) => e.type === 'article').length;
    assert.ok(articleCount >= 2, 'history bundle should contain at least two article versions');

    // Import bundle into a fresh node
    const importHome = makeTempHome();
    await resetApi(importHome);
    const importServer = await startServer({ port: 0, home: importHome });
    try {
      const importRes = await request(importServer.port, '/api/v1/bundles', 'POST', { bundle: bundleRes.json });
      assert.equal(importRes.status, 200, 'bundle import should return 200');
      assert.ok(importRes.json.imported >= 1, 'bundle import should import at least one entry');
      const fetched = await request(importServer.port, '/api/v1/articles/' + encodeURIComponent('subject/viewer-import-export'));
      assert.equal(fetched.status, 200, 'imported article should be fetchable');
      assert.equal(fetched.json.key, 'subject/viewer-import-export');
    } finally {
      await stopServer(importServer.server);
      fs.rmSync(importHome, { recursive: true, force: true });
    }

    // Import history bundle into another fresh node
    const historyImportHome = makeTempHome();
    await resetApi(historyImportHome);
    const historyImportServer = await startServer({ port: 0, home: historyImportHome });
    try {
      const importRes = await request(historyImportServer.port, '/api/v1/history-import', 'POST', { bundle: historyRes.json });
      assert.equal(importRes.status, 200, 'history import should return 200');
      assert.ok(importRes.json.importedArticles >= 2, 'history import should import at least two article versions');
      const historyFetch = await request(historyImportServer.port, '/api/v1/articles/' + encodeURIComponent('subject/viewer-import-export') + '/history');
      assert.equal(historyFetch.status, 200, 'imported history should be fetchable');
      assert.ok(historyFetch.json.timeline.length >= 2, 'imported history timeline should have versions');
    } finally {
      await stopServer(historyImportServer.server);
      fs.rmSync(historyImportHome, { recursive: true, force: true });
    }
  } finally {
    await stopServer(server);
    fs.rmSync(home, { recursive: true, force: true });
  }
}

console.log('viewer-import-export tests passed');
