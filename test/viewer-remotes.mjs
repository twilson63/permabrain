/**
 * Viewer Remotes panel tests.
 *
 * Verifies that the web viewer includes a Remotes panel wired to
 * GET /api/v1/remotes and POST /api/v1/remotes, supports deep-link state
 * (?view=remotes), and exposes the expected window functions.
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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-viewer-remotes-'));
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

// --- viewer/index.html contains remotes panel wiring ---
{
  const html = fs.readFileSync(viewerPath, 'utf8');
  assert.ok(html.includes('id="remotesBtn"'), 'viewer should have remotes button');
  assert.ok(html.includes('window.showRemotes'), 'viewer should expose showRemotes');
  assert.ok(html.includes('window.refreshRemotes'), 'viewer should expose refreshRemotes');
  assert.ok(html.includes('window.fetchRemotes'), 'viewer should expose fetchRemotes');
  assert.ok(html.includes('window.renderRemotes'), 'viewer should expose renderRemotes');
  assert.ok(html.includes('window.setRemotesApiKey'), 'viewer should expose setRemotesApiKey');
  assert.ok(html.includes('window.setRemotesShowJson'), 'viewer should expose setRemotesShowJson');
  assert.ok(html.includes('window.runRemoteAction'), 'viewer should expose runRemoteAction');
  assert.ok(html.includes('window.addRemoteFromForm'), 'viewer should expose addRemoteFromForm');
  assert.ok(html.includes('window.removeRemoteByName'), 'viewer should expose removeRemoteByName');
  assert.ok(html.includes('window.setDefaultRemoteByName'), 'viewer should expose setDefaultRemoteByName');
  assert.ok(html.includes('window.probeRemoteByName'), 'viewer should expose probeRemoteByName');
  assert.ok(html.includes("viewMode === 'remotes'"), 'remotes panel render guard');
  assert.ok(html.includes("'remotes'"), 'viewer should reference remotes view in state handling');
  assert.ok(html.includes('/api/v1/remotes'), 'viewer should call remotes endpoint');
  assert.ok(html.includes('remotesState'), 'viewer should have remotesState');
  assert.ok(html.includes('remotesApiKey'), 'viewer should encode remotes API key in URL state');
  assert.ok(html.includes('remotesShowJson'), 'viewer should encode remotes showJson in URL state');
}

// --- local API remotes lifecycle round-trip works ---
{
  const home = makeTempHome();
  await resetApi(home);

  const apiKey = generateApiKey();
  const { server, port } = await startServer({ port: 0, home, apiKey });
  try {
    // Empty list
    const listEmpty = await request(port, '/api/v1/remotes', 'GET', null, { authorization: `Bearer ${apiKey}` });
    assert.equal(listEmpty.status, 200, 'list remotes should return 200');
    assert.deepEqual(listEmpty.json.remotes, {}, 'no remotes initially');
    assert.equal(listEmpty.json.defaultRemote, null, 'default remote is null');

    // Add remote
    const add = await request(port, '/api/v1/remotes', 'POST', {
      action: 'add',
      params: { name: 'origin', url: 'http://localhost:10000', transport: 'hyperbeam', description: 'local hb' }
    }, { authorization: `Bearer ${apiKey}` });
    assert.equal(add.status, 200, 'add remote should return 200');
    assert.equal(add.json.added, true, 'add reports added');
    assert.equal(add.json.remote.name, 'origin', 'added remote name');
    assert.equal(add.json.defaultRemote, 'origin', 'first remote becomes default');

    // List after add
    const listAfter = await request(port, '/api/v1/remotes', 'GET', null, { authorization: `Bearer ${apiKey}` });
    assert.equal(listAfter.json.remotes.origin.url, 'http://localhost:10000', 'remote stored with url');
    assert.equal(listAfter.json.defaultRemote, 'origin', 'default remote persisted');

    // Set default requires existing remote (already default; add second and switch)
    const addSecond = await request(port, '/api/v1/remotes', 'POST', {
      action: 'add',
      params: { name: 'backup', url: 'https://arweave.net', transport: 'arweave' }
    }, { authorization: `Bearer ${apiKey}` });
    assert.equal(addSecond.status, 200, 'add second remote should return 200');
    assert.equal(addSecond.json.defaultRemote, 'origin', 'default remains origin after adding second');

    const setDefault = await request(port, '/api/v1/remotes', 'POST', {
      action: 'default',
      params: { name: 'backup' }
    }, { authorization: `Bearer ${apiKey}` });
    assert.equal(setDefault.status, 200, 'set default should return 200');
    assert.equal(setDefault.json.defaultRemote, 'backup', 'default switched to backup');

    const listDefault = await request(port, '/api/v1/remotes', 'GET', null, { authorization: `Bearer ${apiKey}` });
    assert.equal(listDefault.json.defaultRemote, 'backup', 'default persisted after switch');

    // Probe remote (transport 'local' falls back gracefully in test env)
    const probe = await request(port, '/api/v1/remotes', 'POST', {
      action: 'probe',
      params: { name: 'backup' }
    }, { authorization: `Bearer ${apiKey}` });
    assert.equal(probe.status, 200, 'probe remote should return 200');
    assert.equal(probe.json.name, 'backup', 'probe reports name');
    assert.equal(typeof probe.json.ok, 'boolean', 'probe reports ok boolean');

    // Remove remote
    const remove = await request(port, '/api/v1/remotes', 'POST', {
      action: 'remove',
      params: { name: 'origin' }
    }, { authorization: `Bearer ${apiKey}` });
    assert.equal(remove.status, 200, 'remove remote should return 200');
    assert.equal(remove.json.removed, true, 'remove reports removed');
    assert.equal(remove.json.defaultRemote, 'backup', 'default remains backup after removing origin');

    const listFinal = await request(port, '/api/v1/remotes', 'GET', null, { authorization: `Bearer ${apiKey}` });
    assert.equal(listFinal.json.remotes.origin, undefined, 'origin removed');
    assert.ok(listFinal.json.remotes.backup, 'backup still exists');

    // Auth enforcement
    const listNoAuth = await request(port, '/api/v1/remotes', 'GET');
    assert.equal(listNoAuth.status, 401, 'list remotes requires auth');

    const addNoAuth = await request(port, '/api/v1/remotes', 'POST', {
      action: 'add',
      params: { name: 'x', url: 'http://x' }
    });
    assert.equal(addNoAuth.status, 401, 'add remote requires auth');
  } finally {
    await stopServer(server);
    fs.rmSync(home, { recursive: true, force: true });
  }
}

console.log('viewer-remotes tests passed');
