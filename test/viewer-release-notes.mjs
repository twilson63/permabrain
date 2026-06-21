/**
 * Viewer Release Notes panel tests.
 *
 * Verifies that the web viewer includes a Release Notes panel wired to
 * GET /api/v1/release-notes, supports JSON + markdown formats, deep-link
 * URL state (?view=release-notes[&version=...][&unreleased=true]), and
 * exposes the expected window functions.
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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-viewer-release-notes-'));
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

// --- viewer/index.html contains release notes panel wiring ---
{
  const html = fs.readFileSync(viewerPath, 'utf8');
  assert.ok(html.includes('id="releaseNotesBtn"'), 'viewer should have release notes button');
  assert.ok(html.includes('window.showReleaseNotes'), 'viewer should expose showReleaseNotes');
  assert.ok(html.includes('window.refreshReleaseNotes'), 'viewer should expose refreshReleaseNotes');
  assert.ok(html.includes('window.fetchReleaseNotes'), 'viewer should expose fetchReleaseNotes');
  assert.ok(html.includes('window.renderReleaseNotes'), 'viewer should expose renderReleaseNotes');
  assert.ok(html.includes('window.setReleaseNotesVersion'), 'viewer should expose setReleaseNotesVersion');
  assert.ok(html.includes('window.setReleaseNotesUnreleased'), 'viewer should expose setReleaseNotesUnreleased');
  assert.ok(html.includes('window.setReleaseNotesMarkdown'), 'viewer should expose setReleaseNotesMarkdown');
  assert.ok(html.includes('releaseNotesState'), 'viewer should track releaseNotesState');
  assert.ok(html.includes("viewMode === 'release-notes'"), 'release notes panel render guard');
  assert.ok(html.includes('/api/v1/release-notes'), 'viewer should call release notes endpoint');
}

// --- URL state encodes/decodes release-notes view and options ---
{
  const html = fs.readFileSync(viewerPath, 'utf8');
  assert.ok(html.includes("params.set('releaseNotesVersion'"), 'buildUrlState should encode version');
  assert.ok(html.includes("params.set('releaseNotesUnreleased'"), 'buildUrlState should encode unreleased flag');
  assert.ok(html.includes("params.set('releaseNotesMarkdown'"), 'buildUrlState should encode markdown flag');
  assert.ok(html.includes("releaseNotesVersion: params.get('releaseNotesVersion')"), 'readUrlState should decode version');
  assert.ok(html.includes("releaseNotesUnreleased: params.get('releaseNotesUnreleased')"), 'readUrlState should decode unreleased flag');
  assert.ok(html.includes("releaseNotesMarkdown: params.get('releaseNotesMarkdown')"), 'readUrlState should decode markdown flag');
  assert.ok(html.includes("state.view === 'release-notes'"), 'applyUrlState should handle release notes view');
  assert.ok(html.includes("bootState.view === 'release-notes'"), 'boot dispatch should include release notes view');
  assert.ok(html.includes("else if (viewMode === 'release-notes') window.showReleaseNotes()"), 'pre-render should handle release notes mode');
  assert.ok(html.includes("'release-notes'"), 'applyUrlState view whitelist should include release-notes');
}

// --- /api/v1/release-notes endpoint returns JSON and markdown ---
{
  const home = makeTempHome();
  await resetApi(home);

  const apiKey = generateApiKey();
  const { server, port } = await startServer({ port: 0, home, apiKey });
  try {
    const json = await request(port, '/api/v1/release-notes', 'GET', null, { authorization: `Bearer ${apiKey}` });
    assert.equal(json.status, 200, 'release notes endpoint should return 200');
    assert.ok(json.json.markdown, 'release notes JSON should include markdown');
    assert.ok(json.json.json, 'release notes JSON should include parsed json');
    assert.ok(json.json.release, 'release notes JSON should include release version');

    const md = await request(port, '/api/v1/release-notes', 'GET', null, {
      authorization: `Bearer ${apiKey}`,
      accept: 'text/markdown'
    });
    assert.equal(md.status, 200, 'markdown release notes should return 200');
    assert.ok(md.headers['content-type']?.includes('text/markdown'), 'markdown response content-type should be text/markdown');
    assert.ok(md.body.includes('## [Unreleased]') || md.body.includes('## [0.2.0]') || md.body.includes('# Changelog'), 'markdown body should include changelog headings');

    const versioned = await request(port, '/api/v1/release-notes?version=0.2.0', 'GET', null, { authorization: `Bearer ${apiKey}` });
    assert.equal(versioned.status, 200, 'versioned release notes should return 200');
    assert.equal(versioned.json.json.version, '0.2.0', 'version query should select 0.2.0 release');
  } finally {
    await stopServer(server);
    fs.rmSync(home, { recursive: true, force: true });
  }
}

console.log('viewer-release-notes tests passed');
