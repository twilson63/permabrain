/**
 * Viewer Backup panel tests.
 *
 * Verifies that the web viewer includes a Backup panel wired to
 * GET /api/v1/backups and POST /api/v1/backups, supports deep-link state
 * (?view=backup), and exposes the expected window functions.
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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-viewer-backup-'));
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

// --- viewer/index.html contains backup panel wiring ---
{
  const html = fs.readFileSync(viewerPath, 'utf8');
  assert.ok(html.includes('id="backupBtn"'), 'viewer should have backup button');
  assert.ok(html.includes('window.showBackup'), 'viewer should expose showBackup');
  assert.ok(html.includes('window.refreshBackup'), 'viewer should expose refreshBackup');
  assert.ok(html.includes('window.fetchBackups'), 'viewer should expose fetchBackups');
  assert.ok(html.includes('window.renderBackup'), 'viewer should expose renderBackup');
  assert.ok(html.includes('window.runBackupCreate'), 'viewer should expose runBackupCreate');
  assert.ok(html.includes('window.runBackupRestore'), 'viewer should expose runBackupRestore');
  assert.ok(html.includes('window.runBackupPrune'), 'viewer should expose runBackupPrune');
  assert.ok(html.includes("viewMode === 'backup'"), 'backup panel render guard');
  assert.ok(html.includes("'backup'"), 'viewer should reference backup view in state handling');
  assert.ok(html.includes('/api/v1/backups'), 'viewer should call backups endpoint');
  assert.ok(html.includes('backupState'), 'viewer should have backupState');
  assert.ok(html.includes('backupShowJson'), 'viewer should encode backup showJson in URL state');
  assert.ok(html.includes('isLocalListMode') && html.includes("viewMode !== 'backup'"), 'backup should be excluded from local list mode');
}

// --- local API backup lifecycle round-trip works ---
{
  const home = makeTempHome();
  await resetApi(home);

  const apiKey = generateApiKey();
  const { server, port } = await startServer({ port: 0, home, apiKey });
  try {
    // Empty list
    const listEmpty = await request(port, '/api/v1/backups', 'GET', null, { authorization: `Bearer ${apiKey}` });
    assert.equal(listEmpty.status, 200, 'list backups should return 200');
    assert.deepEqual(listEmpty.json.backups, [], 'no backups initially');
    assert.equal(listEmpty.json.count, 0, 'count is 0');

    // Create backup
    const create = await request(port, '/api/v1/backups', 'POST', {
      action: 'create',
      passphrase: 'test-passphrase-123'
    }, { authorization: `Bearer ${apiKey}` });
    assert.equal(create.status, 201, 'create backup should return 201');
    assert.ok(create.json.name, 'created backup has a name');
    assert.ok(create.json.name.endsWith('.json'), 'created backup name ends in .json');
    assert.ok(create.json.meta, 'created backup has meta');
    assert.equal(typeof create.json.meta.entries, 'number', 'meta has entries count');

    // List after create
    const listAfter = await request(port, '/api/v1/backups', 'GET', null, { authorization: `Bearer ${apiKey}` });
    assert.equal(listAfter.status, 200, 'list backups after create should return 200');
    assert.equal(listAfter.json.count, 1, 'one backup now');
    assert.equal(listAfter.json.backups[0].name, create.json.name, 'listed backup name matches');
    assert.equal(listAfter.json.backups[0].hasPassphrase, true, 'backup has passphrase');

    // Restore backup by name (dry-run)
    const restore = await request(port, '/api/v1/backups', 'POST', {
      action: 'restore',
      backup: create.json.name,
      passphrase: 'test-passphrase-123',
      dryRun: true
    }, { authorization: `Bearer ${apiKey}` });
    assert.equal(restore.status, 200, 'restore backup should return 200');
    assert.equal(restore.json.backup, create.json.name, 'restore reports backup name');
    assert.equal(restore.json.dryRun, true, 'restore is dry-run');
    assert.equal(typeof restore.json.entriesRestored, 'number', 'restore reports entries restored');

    // Prune backups keeping 0 should remove the created backup
    const prune = await request(port, '/api/v1/backups', 'POST', {
      action: 'prune',
      keep: 0
    }, { authorization: `Bearer ${apiKey}` });
    assert.equal(prune.status, 200, 'prune backups should return 200');
    assert.equal(prune.json.removed.length, 1, 'prune removed one backup');
    assert.equal(prune.json.kept.length, 0, 'prune kept zero backups');

    const listFinal = await request(port, '/api/v1/backups', 'GET', null, { authorization: `Bearer ${apiKey}` });
    assert.equal(listFinal.json.count, 0, 'no backups after prune');

    // Auth enforcement
    const listNoAuth = await request(port, '/api/v1/backups', 'GET');
    assert.equal(listNoAuth.status, 401, 'list backups requires auth');

    const createNoAuth = await request(port, '/api/v1/backups', 'POST', {
      action: 'create',
      passphrase: 'x'
    });
    assert.equal(createNoAuth.status, 401, 'create backup requires auth');
  } finally {
    await stopServer(server);
    fs.rmSync(home, { recursive: true, force: true });
  }
}

console.log('viewer-backup tests passed');
