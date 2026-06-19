/**
 * Viewer import/export panel tests.
 *
 * Verifies that the web viewer includes a unified Import/Export panel wired to
 * /api/v1/bundles, /api/v1/export-all, /api/v1/history-export, /api/v1/raw/:id,
 * /api/v1/history-import, and /api/v1/bundles (import). Supports deep-link state
 * (?view=import-export, ?importTab=, ?exportKey=, ?exportMode=), metadata summary
 * before import, dry-run/preview toggle, and inline import report.
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

function request(port, reqPath, method = 'GET', body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      method,
      path: reqPath,
      headers: body ? { 'content-type': 'application/json', ...headers } : headers
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

// --- viewer/index.html contains unified import-export wiring ---
{
  const html = fs.readFileSync(viewerPath, 'utf8');
  assert.ok(html.includes('id="importExportBtn"'), 'viewer should have unified import/export button');
  assert.ok(html.includes('onclick="window.showImportExport()"'), 'import/export button should open the panel');
  assert.ok(html.includes('window.showImportExport'), 'viewer should expose showImportExport');
  assert.ok(html.includes('window.renderImportExport'), 'viewer should expose renderImportExport');
  assert.ok(html.includes('window.performImport'), 'viewer should expose performImport');
  assert.ok(html.includes('window.performExport'), 'viewer should expose performExport');
  assert.ok(html.includes('window.performExportAll'), 'viewer should expose performExportAll');
  assert.ok(html.includes('window.performExportRaw'), 'viewer should expose performExportRaw');
  assert.ok(html.includes('window.pickImportFile'), 'viewer should expose pickImportFile');
  assert.ok(html.includes('window.onImportFileSelected'), 'viewer should expose onImportFileSelected');
  assert.ok(html.includes('window.exportCurrentArticle'), 'viewer should expose exportCurrentArticle');
  assert.ok(html.includes('window.exportCurrentHistory'), 'viewer should expose exportCurrentHistory');
  assert.ok(html.includes('id="importFileInput"'), 'viewer should have hidden file input');
  assert.ok(html.includes('id="exportKeySelect"'), 'viewer should have export key select');
  assert.ok(html.includes('id="exportModeSelect"'), 'viewer should have export mode select');
  assert.ok(html.includes('id="allExportModeSelect"'), 'viewer should have all-export mode select');
  assert.ok(html.includes('id="rawIdInput"'), 'viewer should have raw id input');
  assert.ok(html.includes('id="importDryRun"'), 'viewer should have dry-run toggle');
  assert.ok(html.includes('window.setImportDryRun'), 'viewer should expose setImportDryRun');
  assert.ok(html.includes('window.setImportExportTab'), 'viewer should expose setImportExportTab');
  assert.ok(html.includes('Metadata summary'), 'viewer should show metadata summary before import');
  assert.ok(html.includes('Import report'), 'viewer should render inline import report');
  assert.ok(html.includes("params.set('view', viewMode)"), 'buildUrlState should encode view');
  assert.ok(html.includes("viewMode === 'import-export'"), 'buildUrlState should handle import-export view');
  assert.ok(html.includes("params.set('importTab'"), 'buildUrlState should encode importTab');
  assert.ok(html.includes("params.set('exportKey'"), 'buildUrlState should encode exportKey');
  assert.ok(html.includes("params.set('exportMode'"), 'buildUrlState should encode exportMode');
  assert.ok(html.includes("'import-export'"), 'applyUrlState should allow import-export view');
  assert.ok(html.includes("bootState.view === 'import-export'"), 'boot should restore import-export view');
}

// --- local API bundle, history, export-all, and raw endpoints round-trip ---
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
  // Publish a second article so export-all contains multiple keys.
  const second = await api.publish({
    content: '# Second article',
    kind: 'subject',
    topic: 'viewer-import-export',
    sourceUrl: 'https://example.com/second',
    title: 'Second Article',
    key: 'subject/viewer-import-export-second'
  });

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

    // Export all
    const exportAllRes = await request(port, '/api/v1/export-all');
    assert.equal(exportAllRes.status, 200, 'export-all should return 200');
    assert.ok(Array.isArray(exportAllRes.json.articles), 'export-all should have articles array');
    assert.ok(exportAllRes.json.articles.length >= 1, 'export-all should contain at least one article');
    assert.ok(Array.isArray(exportAllRes.json.meta.keys), 'export-all should list keys');

    // Raw DataItem export
    const rawId = second.summary && second.summary.id;
    assert.ok(rawId, 'second article should have an id');
    const rawRes = await request(port, '/api/v1/raw/' + encodeURIComponent(rawId));
    assert.equal(rawRes.status, 200, 'raw DataItem export should return 200');
    assert.ok(rawRes.body.length > 0, 'raw export should have bytes');

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
