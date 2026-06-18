/**
 * Test: peer push (gossip-style push to peer)
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { api } from '../src/agent-api.mjs';
import { createClient } from '../src/client.mjs';
import { startServer, stopServer } from '../src/serve.mjs';
import {
  diffKeysForPush,
  buildPeerPushBundle,
  pushToPeerClient,
  pushToPeer
} from '../src/peer.mjs';
import { loadIndex } from '../src/cache.mjs';

const tmpHomeA = fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-push-a-'));
const tmpHomeB = fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-push-b-'));

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
  localApi._home = home;
  localApi._config = null;
  localApi._identity = null;
  await localApi.ensureInit();
  const started = await startServer({ home, port });
  const client = createClient({ baseUrl: `http://localhost:${started.port}` });
  const pub = await client.publish({
    title: `Peer Push Test ${path.basename(home)}`,
    content: `Local content from ${path.basename(home)}.`,
    kind: 'subject',
    topic: 'peer-push',
    sourceUrl: 'http://example.com/peer-push',
    sourceName: 'peer-push-test',
    language: 'en',
    key: `subject/${path.basename(home).replace(/[^a-z0-9]/g, '')}`
  });
  return { ...started, client, key: pub.summary.key, identity, api: localApi };
}

const peerA = await setupPeer(tmpHomeA, 0);
const peerB = await setupPeer(tmpHomeB, 0);

console.log('1. diffKeysForPush detects local keys missing on remote');
const indexA = loadIndex(tmpHomeA);
const remoteInfoB = await peerB.client.peerInfo();
const pushDiff = diffKeysForPush(indexA, remoteInfoB);
assert.ok(pushDiff.missing.length >= 1, 'push diff finds missing keys');
assert.ok(pushDiff.pushed.length >= 1, 'push diff marks missing as pushable');
assert.equal(pushDiff.divergent.length, 0, 'no divergent keys yet');
console.log('   ✓ diffKeysForPush');

console.log('2. buildPeerPushBundle packages local articles');
const pushKeys = pushDiff.pushed.map((p) => p.key);
const bundle = await buildPeerPushBundle(pushKeys, tmpHomeA, { includeAttestations: false, includeVersions: false });
assert.ok(Array.isArray(bundle.entries), 'push bundle has entries array');
assert.ok(bundle.entries.some((e) => e.type === 'article'), 'push bundle contains an article entry');
assert.equal(bundle.meta.pushed, pushKeys.length, 'push bundle meta count');
console.log('   ✓ buildPeerPushBundle');

console.log('3. POST /api/v1/peer/push imports bundle via client.peerPush');
const importSummary = await peerB.client.peerPush(bundle);
assert.ok(Array.isArray(importSummary.results), 'peerPush returns results array');
assert.ok(importSummary.imported >= 1, 'peerPush imported at least one article');
assert.equal(importSummary.failed, 0, 'peerPush had no failures');
console.log('   ✓ client.peerPush');

console.log('4. pushToPeerClient pushes local articles to remote');
// Use a fresh remote target so there is still something to push.
const tmpHomeC = fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-push-c-'));
const peerC = await setupPeer(tmpHomeC, 0);
process.env.PERMABRAIN_HOME = tmpHomeA;
const pushResult = await pushToPeerClient(peerC.client, {
  home: tmpHomeA,
  includeAttestations: false,
  includeVersions: false,
  verify: true
});
console.log('   pushResult', JSON.stringify({ accepted: pushResult.accepted, rejected: pushResult.rejected, failed: pushResult.failed, diff: pushResult.diff }, null, 2));
assert.ok(pushResult.peer.agentId, 'push result identifies remote peer');
assert.ok(pushResult.accepted >= 1, 'push accepted at least one article');
assert.equal(pushResult.failed, 0, 'push had no failures');
const indexCAfter = loadIndex(tmpHomeC);
assert.ok(indexCAfter.articles[peerA.key], 'peer C now has peer A key after push');
console.log('   ✓ pushToPeerClient');

console.log('5. pushToPeer convenience by base URL');
const pushAgain = await pushToPeer(`http://localhost:${peerC.serverPort || peerC.port}`, {
  home: tmpHomeA,
  includeAttestations: false,
  includeVersions: false
});
assert.equal(pushAgain.accepted, 0, 'second push accepts nothing (already present)');
assert.equal(pushAgain.failed, 0, 'second push has no failures');
console.log('   ✓ pushToPeer idempotency');

console.log('6. api.pushToPeer wrapper');
process.env.PERMABRAIN_HOME = tmpHomeA;
api._home = tmpHomeA;
api._config = undefined;
api._identity = undefined;
await api.ensureInit();
const apiPush = await api.pushToPeer(`http://localhost:${peerC.serverPort || peerC.port}`, {
  includeAttestations: false,
  includeVersions: false
});
assert.ok(apiPush.peer.agentId, 'api.pushToPeer identifies remote peer');
assert.equal(apiPush.failed, 0, 'api.pushToPeer has no failures');
console.log('   ✓ api.pushToPeer');

await stopServer(peerA.server);
api._home = undefined;
api._identity = undefined;
api._config = undefined;
await stopServer(peerB.server);
await stopServer(peerC.server);

fs.rmSync(tmpHomeA, { recursive: true, force: true });
fs.rmSync(tmpHomeB, { recursive: true, force: true });
fs.rmSync(tmpHomeC, { recursive: true, force: true });

console.log('\n✅ All peer push tests passed');
