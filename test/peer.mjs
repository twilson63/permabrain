/**
 * Test: peer sync (gossip-style article exchange)
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { api } from '../src/agent-api.mjs';
import { createClient } from '../src/client.mjs';
import { startServer, stopServer } from '../src/serve.mjs';
import {
  peerInfo,
  diffPeerKeys,
  buildPeerPullBundle,
  pullFromPeerClient,
  peerStatus,
  peerInfoToMarkdown,
  peerStatusToMarkdown
} from '../src/peer.mjs';
import { loadIndex } from '../src/cache.mjs';

const tmpHomeA = fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-peer-a-'));
const tmpHomeB = fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-peer-b-'));

async function setupPeer(home, port) {
  process.env.PERMABRAIN_HOME = home;
  process.env.PERMABRAIN_TRANSPORT = 'local';
  fs.mkdirSync(home, { recursive: true });
  const { initState } = await import('../src/config.mjs');
  const { ensureIdentity, loadIdentity } = await import('../src/keys.mjs');
  const { api: localApi } = await import('../src/agent-api.mjs');
  initState();
  await ensureIdentity(home, { keyType: 'ed25519' });
  const identity = loadIdentity(home);
  // Seed the server-side api state for this peer before starting server
  localApi._home = home;
  localApi._config = null;
  localApi._identity = null;
  await localApi.ensureInit();
  const started = await startServer({ home, port });
  const client = createClient({ baseUrl: `http://localhost:${started.port}` });
  const pub = await client.publish({
    title: `Peer Test ${path.basename(home)}`,
    content: `Hello from ${path.basename(home)}.`,
    kind: 'subject',
    topic: 'peer-sync',
    sourceUrl: 'http://example.com/peer',
    sourceName: 'peer-test',
    language: 'en',
    key: `subject/${path.basename(home).replace(/[^a-z0-9]/g, '')}`
  });
  return { ...started, client, key: pub.summary.key, identity, api: localApi };
}

const peerA = await setupPeer(tmpHomeA, 0);
const peerB = await setupPeer(tmpHomeB, 0);

console.log('1. peerInfo returns public metadata');
const infoA = peerInfo(tmpHomeA);
assert.equal(infoA.agentId, peerA.identity.agentId, 'peerInfo agentId matches local identity');
assert.equal(infoA.transport, 'local', 'peerInfo transport local');
assert.equal(infoA.peerProtocol, 'permabrain-peer/1.0', 'peerInfo protocol version');
assert.ok(Object.keys(infoA.articles).length >= 1, 'peerInfo has articles');
console.log('   ✓ peerInfo works locally');

console.log('2. client.peerInfo returns peer A info over HTTP');
const remoteInfoA = await peerA.client.peerInfo();
console.log('   remoteInfoA', JSON.stringify(remoteInfoA, null, 2));
assert.equal(remoteInfoA.agentId, peerA.identity.agentId, 'remote peerInfo agentId matches peer A');
assert.ok(remoteInfoA.articles[peerA.key], 'remote peerInfo lists peer A key');
console.log('   ✓ client.peerInfo over HTTP');

const peerBInfo = peerInfo(tmpHomeB);
assert.notEqual(peerA.identity.agentId, peerBInfo.agentId, 'peers have distinct identities');

console.log('3. diffPeerKeys detects missing keys');
const indexB = loadIndex(tmpHomeB);
const diffFromBToA = diffPeerKeys(indexB, remoteInfoA);
assert.ok(diffFromBToA.missing.length >= 1, 'diff finds missing keys');
assert.ok(diffFromBToA.pulled.length >= 1, 'diff marks missing as pullable');
assert.ok(diffFromBToA.unchanged >= 0, 'diff counts unchanged keys');
console.log('   ✓ diffPeerKeys across peers');

console.log('4. buildPeerPullBundle packages requested article');
const requests = diffFromBToA.pulled.map((p) => ({ key: p.key, sinceVersion: 0 }));
const bundle = await buildPeerPullBundle(requests, tmpHomeA, { includeAttestations: false, includeVersions: false });
assert.ok(Array.isArray(bundle.entries), 'bundle has entries array');
assert.ok(bundle.entries.some((e) => e.type === 'article'), 'bundle contains an article entry');
assert.equal(bundle.meta.pulled, requests.length, 'bundle meta pulled count');
console.log('   ✓ buildPeerPullBundle');

console.log('5. POST /api/v1/peer/pull returns bundle via client.peerPull');
const remoteBundle = await peerA.client.peerPull(requests, { includeAttestations: false });
assert.ok(Array.isArray(remoteBundle.entries), 'peerPull returns entries array');
assert.ok(remoteBundle.entries.some((e) => e.type === 'article'), 'peerPull returns at least one article entry');
console.log('   ✓ client.peerPull');

console.log('6. pullFromPeerClient imports missing article into peer B');
const pullResult = await pullFromPeerClient(peerA.client, {
  home: tmpHomeB,
  includeAttestations: false,
  verify: true,
  skipDuplicates: true
});
console.log('   pullResult', JSON.stringify({ imported: pullResult.imported, skipped: pullResult.skipped, failed: pullResult.failed, diff: pullResult.diff, results: pullResult.results }, null, 2));
assert.equal(pullResult.peer.agentId, peerA.identity.agentId, 'pull result identifies peer A');
assert.ok(pullResult.imported >= 1, 'pull imported at least one article');
assert.equal(pullResult.failed, 0, 'pull had no failures');
const indexBAfter = loadIndex(tmpHomeB);
console.log('   indexBAfter keys', Object.keys(indexBAfter.articles || {}).join(', '));
assert.ok(indexBAfter.articles[peerA.key] || indexBAfter.articles[Object.keys(remoteInfoA.articles || {})[0]], 'peer B now has a peer A key');
console.log('   ✓ pullFromPeerClient');

console.log('7. second pull is idempotent (nothing new to pull)');
const pullAgain = await pullFromPeerClient(peerA.client, {
  home: tmpHomeB,
  includeAttestations: false
});
assert.equal(pullAgain.imported, 0, 'second pull imports nothing');
assert.equal(pullAgain.skipped >= 0, true, 'second pull skips or finds nothing');
console.log('   ✓ idempotent pull');

console.log('8. peerStatus summarizes across peers');
const status = peerStatus([remoteInfoA, peerInfo(tmpHomeB)], { home: tmpHomeB });
assert.equal(status.uniquePeers, 2, 'status uniquePeers');
assert.ok(status.totalPullable >= 0, 'status totalPullable');
assert.ok(status.peers.length === 2, 'status peers list');
console.log('   ✓ peerStatus');

console.log('9. markdown formatters render without crashing');
assert.ok(peerInfoToMarkdown(remoteInfoA).includes(remoteInfoA.agentId), 'peerInfoToMarkdown');
assert.ok(peerStatusToMarkdown(status).includes('Total pullable'), 'peerStatusToMarkdown');
console.log('   ✓ markdown helpers');

console.log('10. api.peer() surface');
process.env.PERMABRAIN_HOME = tmpHomeA;
api._home = tmpHomeA;
api._config = undefined;
api._identity = undefined;
await api.ensureInit();
const apiInfo = api.peerInfo();
assert.equal(apiInfo.agentId, peerA.agentId, 'api.peerInfo agentId');
assert.ok(apiInfo.articles[peerA.key], 'api.peerInfo has article');
console.log('   ✓ api.peerInfo');

await stopServer(peerA.server);
api._home = undefined;
api._identity = undefined;
api._config = undefined;
await stopServer(peerB.server);

fs.rmSync(tmpHomeA, { recursive: true, force: true });
fs.rmSync(tmpHomeB, { recursive: true, force: true });

console.log('\n✅ All peer sync tests passed');
