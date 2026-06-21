/**
 * Viewer Archive panel tests.
 *
 * Verifies that the web viewer includes an Archive panel wired to
 * POST /api/v1/archive and POST /api/v1/restore, supports deep-link state
 * (?view=archive), and exposes the expected window functions.
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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-viewer-archive-'));
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

// --- viewer/index.html contains archive panel wiring ---
{
  const html = fs.readFileSync(viewerPath, 'utf8');
  assert.ok(html.includes('id="archiveBtn"'), 'viewer should have archive button');
  assert.ok(html.includes('window.showArchive'), 'viewer should expose showArchive');
  assert.ok(html.includes('window.refreshArchive'), 'viewer should expose refreshArchive');
  assert.ok(html.includes('window.renderArchive'), 'viewer should expose renderArchive');
  assert.ok(html.includes('window.runArchiveCreate'), 'viewer should expose runArchiveCreate');
  assert.ok(html.includes('window.runArchiveRestore'), 'viewer should expose runArchiveRestore');
  assert.ok(html.includes('window.setArchivePassphrase'), 'viewer should expose setArchivePassphrase');
  assert.ok(html.includes('window.setArchiveRecipients'), 'viewer should expose setArchiveRecipients');
  assert.ok(html.includes("viewMode === 'archive'"), 'archive panel render guard');
  assert.ok(html.includes("'archive'"), 'viewer should reference archive view in state handling');
  assert.ok(html.includes('/api/v1/archive'), 'viewer should call archive endpoint');
  assert.ok(html.includes('/api/v1/restore'), 'viewer should call restore endpoint');
  assert.ok(html.includes('archiveState'), 'viewer should have archiveState');
  assert.ok(html.includes('archivePassphrase'), 'viewer should encode archive passphrase in URL state');
  assert.ok(html.includes('isLocalListMode') && html.includes("viewMode !== 'archive'"), 'archive should be excluded from local list mode');
}

// --- local API archive create/restore lifecycle round-trip works ---
{
  const home = makeTempHome();
  await resetApi(home);

  const apiKey = generateApiKey();
  const { server, port } = await startServer({ port: 0, home, apiKey });
  try {
    // Create archive
    const create = await request(port, '/api/v1/archive', 'POST', {
      passphrase: 'archive-passphrase-456'
    }, { authorization: `Bearer ${apiKey}` });
    assert.equal(create.status, 201, 'create archive should return 201');
    assert.ok(create.json.agentId, 'archive has agentId');
    assert.ok(Array.isArray(create.json.entries), 'archive has entries array');
    assert.equal(create.json.encryption.hasPassphrase, true, 'archive is passphrase encrypted');

    // Restore archive dry-run
    const restore = await request(port, '/api/v1/restore', 'POST', {
      archive: create.json,
      options: { passphrase: 'archive-passphrase-456', dryRun: true }
    }, { authorization: `Bearer ${apiKey}` });
    assert.equal(restore.status, 200, 'restore archive should return 200');
    assert.equal(restore.json.dryRun, true, 'restore is dry-run');
    assert.equal(typeof restore.json.entriesRestored, 'number', 'restore reports entries restored');

    // Restore with bad passphrase returns error
    const restoreBad = await request(port, '/api/v1/restore', 'POST', {
      archive: create.json,
      options: { passphrase: 'wrong-passphrase', dryRun: true }
    }, { authorization: `Bearer ${apiKey}` });
    assert.ok(restoreBad.status >= 400, 'restore with bad passphrase should error');

    // Auth enforcement
    const createNoAuth = await request(port, '/api/v1/archive', 'POST', { passphrase: 'x' });
    assert.equal(createNoAuth.status, 401, 'create archive requires auth');

    const restoreNoAuth = await request(port, '/api/v1/restore', 'POST', {
      archive: create.json,
      options: { passphrase: 'x', dryRun: true }
    });
    assert.equal(restoreNoAuth.status, 401, 'restore archive requires auth');
  } finally {
    await stopServer(server);
    fs.rmSync(home, { recursive: true, force: true });
  }
}

console.log('viewer-archive tests passed');
