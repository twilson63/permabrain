/**
 * Viewer peer sync panel tests.
 *
 * Verifies that the web viewer includes a Peer Sync panel wired to
 * /api/v1/peer/info, /api/v1/peer/diff, /api/v1/peer/pull, and /api/v1/peer/push,
 * supports deep-link state (?view=peer-sync), dry-run preview, direction and
 * include-options, and exposes the expected window functions.
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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-viewer-peer-sync-'));
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

// --- viewer/index.html contains peer sync panel wiring ---
{
  const html = fs.readFileSync(viewerPath, 'utf8');
  assert.ok(html.includes('id="peerSyncBtn"'), 'viewer should have peer sync button');
  assert.ok(html.includes('window.showPeerSync'), 'viewer should expose showPeerSync');
  assert.ok(html.includes('window.refreshPeerSync'), 'viewer should expose refreshPeerSync');
  assert.ok(html.includes('window.fetchPeerInfo'), 'viewer should expose fetchPeerInfo');
  assert.ok(html.includes('window.fetchPeerDiff'), 'viewer should expose fetchPeerDiff');
  assert.ok(html.includes('window.runPeerSyncAction'), 'viewer should expose runPeerSyncAction');
  assert.ok(html.includes('window.setPeerSyncRemoteUrl'), 'viewer should expose setPeerSyncRemoteUrl');
  assert.ok(html.includes('window.setPeerSyncRemoteApiKey'), 'viewer should expose setPeerSyncRemoteApiKey');
  assert.ok(html.includes('window.setPeerSyncDirection'), 'viewer should expose setPeerSyncDirection');
  assert.ok(html.includes('window.setPeerSyncDryRun'), 'viewer should expose setPeerSyncDryRun');
  assert.ok(html.includes('window.setPeerSyncIncludeAttestations'), 'viewer should expose setPeerSyncIncludeAttestations');
  assert.ok(html.includes('window.setPeerSyncIncludeVersions'), 'viewer should expose setPeerSyncIncludeVersions');
  assert.ok(html.includes('window.setPeerSyncApiKey'), 'viewer should expose setPeerSyncApiKey');
  assert.ok(html.includes('window.setPeerSyncFormat'), 'viewer should expose setPeerSyncFormat');
  assert.ok(html.includes('window.clearPeerSync'), 'viewer should expose clearPeerSync');
  assert.ok(html.includes('window.copyPeerSyncResult'), 'viewer should expose copyPeerSyncResult');
  assert.ok(html.includes('window.downloadPeerSyncResult'), 'viewer should expose downloadPeerSyncResult');
  assert.ok(html.includes('window.renderPeerSync'), 'viewer should expose renderPeerSync');
  assert.ok(html.includes("viewMode === 'peer-sync'"), 'peer sync panel render guard');
  assert.ok(html.includes("'peer-sync'"), 'viewer should reference peer-sync view in state handling');
  assert.ok(html.includes('/api/v1/peer/info'), 'viewer should call peer info endpoint');
  assert.ok(html.includes('/api/v1/peer/diff'), 'viewer should call peer diff endpoint');
  assert.ok(html.includes("'/api/v1/peer/' + direction"), 'viewer should call pull/push endpoint');
  assert.ok(html.includes('peerRemoteUrl'), 'viewer should encode peerRemoteUrl in URL state');
  assert.ok(html.includes('peerDirection'), 'viewer should encode peerDirection in URL state');
  assert.ok(html.includes('peerDryRun'), 'viewer should encode peerDryRun in URL state');
  assert.ok(html.includes('peerIncludeAttestations'), 'viewer should encode peerIncludeAttestations in URL state');
  assert.ok(html.includes('peerIncludeVersions'), 'viewer should encode peerIncludeVersions in URL state');
}

// --- local API peer sync lifecycle round-trip works ---
{
  const homeA = makeTempHome();
  const homeB = makeTempHome();
  await resetApi(homeA);

  const apiKeyA = generateApiKey();
  const serverA = await startServer({ port: 0, home: homeA, apiKey: apiKeyA });

  process.env.PERMABRAIN_HOME = homeB;
  api._home = null;
  api._identity = null;
  api._config = null;
  await resetApi(homeB);
  const apiKeyB = generateApiKey();
  const serverB = await startServer({ port: 0, home: homeB, apiKey: apiKeyB });

  try {
    // Publish on both peers
    const pubA = await request(serverA.port, '/api/v1/articles', 'POST', {
      content: '# Peer A article\n\nOnly on peer A.',
      kind: 'subject',
      topic: 'viewer-peer-sync',
      sourceUrl: 'https://example.com/peer-a',
      title: 'Peer A article',
      key: 'subject/peer-a-article'
    }, { authorization: `Bearer ${apiKeyA}` });
    assert.equal(pubA.status, 201, 'publish on peer A should succeed');

    const pubB = await request(serverB.port, '/api/v1/articles', 'POST', {
      content: '# Peer B article\n\nOnly on peer B.',
      kind: 'subject',
      topic: 'viewer-peer-sync',
      sourceUrl: 'https://example.com/peer-b',
      title: 'Peer B article',
      key: 'subject/peer-b-article'
    }, { authorization: `Bearer ${apiKeyB}` });
    assert.equal(pubB.status, 201, 'publish on peer B should succeed');

    // GET /api/v1/peer/info on A
    const infoA = await request(serverA.port, '/api/v1/peer/info', 'GET', null, { authorization: `Bearer ${apiKeyA}` });
    assert.equal(infoA.status, 200, 'peer info should return 200');
    assert.ok(infoA.json.agentId, 'peer info has agentId');
    assert.ok(infoA.json.articles['subject/peer-a-article'], 'peer info lists peer A article');

    // GET /api/v1/peer/diff?remote=A from B: pullable from A
    const diffPull = await request(serverB.port, `/api/v1/peer/diff?remote=${encodeURIComponent(`http://localhost:${serverA.port}`)}&direction=pull&remoteApiKey=${encodeURIComponent(apiKeyA)}`, 'GET', null, { authorization: `Bearer ${apiKeyB}` });
    assert.equal(diffPull.status, 200, 'peer diff pull should return 200');
    assert.ok(diffPull.json.pulled.some((p) => p.key === 'subject/peer-a-article'), 'diff pull finds peer A article as pullable');
    assert.ok(diffPull.json.peer.agentId, 'diff pull includes peer info');

    // GET /api/v1/peer/diff?remote=A from B: pushable to A
    const diffPush = await request(serverB.port, `/api/v1/peer/diff?remote=${encodeURIComponent(`http://localhost:${serverA.port}`)}&direction=push&remoteApiKey=${encodeURIComponent(apiKeyA)}`, 'GET', null, { authorization: `Bearer ${apiKeyB}` });
    assert.equal(diffPush.status, 200, 'peer diff push should return 200');
    assert.ok(diffPush.json.pushed.some((p) => p.key === 'subject/peer-b-article'), 'diff push finds peer B article as pushable');

    // POST /api/v1/peer/pull?dryRun=true from B
    const dryPull = await request(serverB.port, '/api/v1/peer/pull?dryRun=true', 'POST', {
      remoteUrl: `http://localhost:${serverA.port}`,
      remoteApiKey: apiKeyA
    }, { authorization: `Bearer ${apiKeyB}`, 'content-type': 'application/json' });
    console.log('dryPull debug', dryPull.status, dryPull.body);
    assert.equal(dryPull.status, 200, 'dry-run pull should return 200');
    assert.equal(dryPull.json.dryRun, true, 'dry-run pull reports dryRun');
    assert.ok(dryPull.json.pulled.some((p) => p.key === 'subject/peer-a-article'), 'dry-run pull lists peer A article');

    // POST /api/v1/peer/push?dryRun=true from B
    const dryPush = await request(serverB.port, '/api/v1/peer/push?dryRun=true', 'POST', {
      remoteUrl: `http://localhost:${serverA.port}`,
      remoteApiKey: apiKeyA
    }, { authorization: `Bearer ${apiKeyB}`, 'content-type': 'application/json' });
    assert.equal(dryPush.status, 200, 'dry-run push should return 200');
    assert.equal(dryPush.json.dryRun, true, 'dry-run push reports dryRun');
    assert.ok(dryPush.json.pushed.some((k) => k === 'subject/peer-b-article'), 'dry-run push lists peer B article');

    // Live pull: B pulls from A
    const livePull = await request(serverB.port, '/api/v1/peer/pull', 'POST', {
      remoteUrl: `http://localhost:${serverA.port}`,
      remoteApiKey: apiKeyA,
      includeAttestations: false,
      includeVersions: false
    }, { authorization: `Bearer ${apiKeyB}`, 'content-type': 'application/json' });
    assert.equal(livePull.status, 200, 'live pull should return 200');
    assert.ok(livePull.json.imported >= 1, 'live pull imported at least one article');
    assert.equal(livePull.json.failed, 0, 'live pull had no failures');

    // Live push: B pushes to A
    const livePush = await request(serverB.port, '/api/v1/peer/push', 'POST', {
      remoteUrl: `http://localhost:${serverA.port}`,
      remoteApiKey: apiKeyA,
      includeAttestations: false,
      includeVersions: false
    }, { authorization: `Bearer ${apiKeyB}`, 'content-type': 'application/json' });
    assert.equal(livePush.status, 200, 'live push should return 200');
    assert.ok(livePush.json.accepted >= 1, 'live push accepted at least one article');
    assert.equal(livePush.json.failed, 0, 'live push had no failures');

    // Verify articles now visible on remote sides
    const listA = await request(serverA.port, '/api/v1/list?limit=1000', 'GET', null, { authorization: `Bearer ${apiKeyA}` });
    assert.equal(listA.status, 200, 'list A should return 200');
    assert.ok(listA.json.articles.some((a) => a.key === 'subject/peer-b-article'), 'peer A has peer B article after push');

    const listB = await request(serverB.port, '/api/v1/list?limit=1000', 'GET', null, { authorization: `Bearer ${apiKeyB}` });
    assert.equal(listB.status, 200, 'list B should return 200');
    assert.ok(listB.json.articles.some((a) => a.key === 'subject/peer-a-article'), 'peer B has peer A article after pull');
  } finally {
    await stopServer(serverA.server);
    await stopServer(serverB.server);
    fs.rmSync(homeA, { recursive: true, force: true });
    fs.rmSync(homeB, { recursive: true, force: true });
  }
}

console.log('viewer-peer-sync tests passed');
