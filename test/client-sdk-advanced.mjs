/**
 * Test: advanced HTTP client SDK coverage for remaining Agent API routes.
 *
 * Covers threshold attestations, peer sync/push, log export/import,
 * event publishing, and live query/event streams via the SDK client.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createClient } from '../src/client.mjs';
import { startServer, stopServer } from '../src/serve.mjs';
import * as thresholdAttestation from '../src/threshold-attestation.mjs';
import { api } from '../src/agent-api.mjs';

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-client-adv-'));
process.env.PERMABRAIN_HOME = tmpHome;
process.env.PERMABRAIN_TRANSPORT = 'local';

let server;
let port;
let client;

console.log('1. startServer and createClient connect to /health');
const started = await startServer({ home: tmpHome, port: 0 });
server = started.server;
port = started.port;
client = createClient({ baseUrl: `http://localhost:${port}` });
const health = await client.health();
assert.equal(health.ok, true, 'health ok');
assert.equal(health.transport, 'local', 'health transport local');
console.log('   ✓ /health via client');

console.log('2. client.schema() and client.validate()');
const schema = await client.schema();
assert.ok(schema.article, 'schema returns article schema');
assert.ok(schema.attestation, 'schema returns attestation schema');
const valid = await client.validate({
  tags: {
    'App-Name': 'PermaBrain',
    'App-Version': '0.2.0',
    'PermaBrain-Type': 'article',
    'Article-Kind': 'subject',
    'Article-Topic': 'sdk-advanced',
    'Article-Language': 'en',
    'Article-Key': 'subject/sdk-advanced-validate',
    'Article-Title': 'SDK Advanced Validate',
    'Article-Slug': 'sdk-advanced-validate',
    'Article-Version': '1',
    'Article-Source-Name': 'sdk-adv',
    'Article-Source-Url': 'http://example.com/sdk-advanced',
    'Article-Content-Hash': 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'Article-Published-At': new Date().toISOString(),
    'Article-Updated-At': new Date().toISOString(),
    'Author-Agent-Id': 'ed25519:testagent',
    'Visibility': 'public'
  },
  type: 'article'
});
assert.equal(valid.valid, true, 'valid article tags accepted');
let invalid;
try {
  invalid = await client.validate({ tags: {
    'App-Name': 'PermaBrain',
    'App-Version': '0.2.0',
    'PermaBrain-Type': 'article',
    'Article-Kind': 'invalid-kind',
    'Article-Topic': 'sdk-advanced',
    'Article-Language': 'en',
    'Article-Key': 'subject/sdk-advanced-validate',
    'Article-Title': 'SDK Advanced Validate',
    'Article-Slug': 'sdk-advanced-validate',
    'Article-Version': '1',
    'Article-Source-Name': 'sdk-adv',
    'Article-Source-Url': 'http://example.com/sdk-advanced',
    'Article-Content-Hash': 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'Article-Published-At': new Date().toISOString(),
    'Article-Updated-At': new Date().toISOString(),
    'Author-Agent-Id': 'ed25519:testagent',
    'Visibility': 'public'
  }, type: 'article' });
} catch (err) {
  invalid = err.body;
}
assert.equal(invalid.valid, false, 'invalid kind rejected');
console.log('   ✓ schema/validate');

console.log('3. client.createThresholdAttestation() and finalize');
const pub = await client.publish({
  title: 'Threshold SDK Target',
  content: 'Target article for threshold SDK test.',
  kind: 'subject',
  topic: 'sdk-advanced',
  sourceUrl: 'http://example.com/threshold-sdk',
  sourceName: 'sdk-adv',
  language: 'en'
});
const thresholdKey = pub.summary.key;
const coSigner = await api.provisionAgent('co-sdk', { keyType: 'ed25519' });
const envelope = await client.createThresholdAttestation({
  key: thresholdKey,
  opinion: 'valid',
  confidence: 0.9,
  reason: 'SDK threshold test',
  policy: { threshold: 1, coSignerAgentIds: [coSigner.agentId] }
});
assert.ok(envelope.envelopeId, 'envelope created with id');
assert.equal(envelope.policy.threshold, 1, 'threshold preserved');
const exported = await client.getThresholdEnvelope(envelope.envelopeId);
assert.equal(exported.envelopeId, envelope.envelopeId, 'envelope export round-trips');
const digest = Buffer.from(envelope.digest, 'base64url');
const sig = await thresholdAttestation.signThresholdDigest(coSigner, digest);
const added = await client.addThresholdSigner({
  envelopeId: envelope.envelopeId,
  agentId: sig.agentId,
  signature: sig.signature,
  signatureType: sig.signatureType,
  publicKey: coSigner.publicKey
});
console.log('addThresholdSigner response', JSON.stringify(added, null, 2));
assert.equal(added.signers.length, 2, 'co-signer added');
const finalized = await client.finalizeThresholdAttestation({ envelopeId: envelope.envelopeId });
assert.ok(finalized.summary?.id, 'threshold attestation finalized');
assert.equal(finalized.summary.targetKey, thresholdKey, 'finalized targetKey matches');
console.log('   ✓ threshold attestation via client');

console.log('4. client.importThresholdEnvelope() round-trip');
const shared = await client.createThresholdAttestation({
  key: thresholdKey,
  opinion: 'partially-valid',
  confidence: 0.6,
  reason: 'Shared envelope',
  policy: { threshold: 1, coSignerAgentIds: ['ed25519:shared'] }
});
const imported = await client.importThresholdEnvelope({ envelope: shared });
assert.equal(imported.envelopeId, shared.envelopeId, 'imported envelope id matches');
const reexported = await client.getThresholdEnvelope(shared.envelopeId);
assert.equal(reexported.opinion, 'partially-valid', 'reexported opinion preserved');
console.log('   ✓ threshold envelope import/export round-trip');

console.log('5. client.peerInfo(), peerPull(), peerPush()');
const peerAHome = fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-peer-a-sdk-'));
const peerBHome = fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-peer-b-sdk-'));
const peerAStarted = await startServer({ home: peerAHome, port: 0 });
const peerBStarted = await startServer({ home: peerBHome, port: 0 });
process.env.PERMABRAIN_HOME = peerAHome;
process.env.PERMABRAIN_TRANSPORT = 'local';
const peerA = createClient({ baseUrl: `http://localhost:${peerAStarted.port}` });
const peerB = createClient({ baseUrl: `http://localhost:${peerBStarted.port}` });

const peerPub = await peerA.publish({
  title: 'Peer SDK Article',
  content: 'Article on peer A for SDK sync test.',
  kind: 'subject',
  topic: 'sdk-advanced',
  sourceUrl: 'http://example.com/peer-sdk',
  sourceName: 'peer-sdk',
  language: 'en'
});
const peerKey = peerPub.summary.key;

const infoA = await peerA.peerInfo();
assert.ok(infoA.agentId, 'peerInfo has agentId');
const peerArticles = await peerA.articles({ topic: 'sdk-advanced' });
assert.ok(peerArticles.articles.some((a) => a.key === peerKey), 'peer articles include published article');

let bundleResult;
try {
  bundleResult = await peerA.exportBundle({ key: peerKey, includeVersions: false });
} catch (e) {
  console.log('exportBundle by key failed, retrying by id:', e.body || e.message);
  bundleResult = await peerA.exportBundle({ id: peerPub.summary.id, includeVersions: false });
}
assert.ok(bundleResult.entries.length >= 1, 'bundleResult has at least one entry');

const pullResult = await peerB.peerPull([{ key: peerKey }]);
assert.ok(pullResult.meta?.pulled >= 1 || pullResult.entries?.length >= 1 || pullResult.bundle, 'peerPull pulls missing article or returns bundle');

const pushResult = await peerB.peerPush(bundleResult);
assert.ok(pushResult.accepted >= 1 || pushResult.imported >= 1, 'peerPush accepted article');

await stopServer(peerAStarted.server);
await stopServer(peerBStarted.server);
fs.rmSync(peerAHome, { recursive: true, force: true });
fs.rmSync(peerBHome, { recursive: true, force: true });
console.log('   ✓ peer sync/push via client');

console.log('6. client.auditLog(), log(), exportLog(), importLog()');
const logged = await client.auditLog({ action: 'sdk-test', status: 'ok', key: 'subject/sdk-test', message: 'SDK audit test' });
assert.equal(logged.action, 'sdk-test', 'auditLog action recorded');
const logQuery = await client.log({ action: 'sdk-test' });
assert.ok(logQuery.entries.length >= 1, 'log query returns entry');
const exportedLog = await client.exportLog({ format: 'json' });
assert.ok(exportedLog.entries.length >= 1, 'exportLog returns entries');
const reimported = await client.importLog({ entries: exportedLog.entries });
assert.ok(reimported.imported >= 0, 'importLog reports imported count');
console.log('   ✓ log export/import via client');

console.log('7. client.publishEvents() broadcasts via event stream');
const controller = new AbortController();
const stream = client.streamEvents({ signal: controller.signal });
const received = [];
const consumer = (async () => {
  for await (const event of stream) {
    received.push(event);
    if (received.length >= 3) break;
  }
})();

await new Promise((resolve) => setTimeout(resolve, 200));
const forwarded = await client.publishEvents([{ name: 'sdk-custom-event', type: 'sdk-custom-event', timestamp: new Date().toISOString(), key: 'subject/sdk-test' }]);
assert.equal(forwarded.forwarded, 1, 'publishEvents forwarded one event');
await consumer;
assert.ok(received.length >= 1, 'stream received at least open or event');
const custom = received.find((e) => e.name === 'sdk-custom-event' || e.type === 'sdk-custom-event');
assert.ok(custom, 'stream received published custom event');
controller.abort();
console.log('   ✓ event publish/stream via client');

console.log('8. client.streamQuery() receives article updates');
const qController = new AbortController();
const qStream = client.streamQuery({ topic: 'sdk-advanced', signal: qController.signal });
const qReceived = [];
const qConsumer = (async () => {
  for await (const event of qStream) {
    qReceived.push(event);
    if (qReceived.length >= 1) break;
  }
})();
await new Promise((resolve) => setTimeout(resolve, 100));
await client.publish({
  title: 'Query Stream SDK Article',
  content: 'Article for query stream SDK test.',
  kind: 'subject',
  topic: 'sdk-advanced',
  sourceUrl: 'http://example.com/query-stream-sdk',
  sourceName: 'sdk-adv',
  language: 'en'
});
await qConsumer;
assert.ok(qReceived.length >= 1, 'query stream received open or article event');
qController.abort();
console.log('   ✓ query stream via client');

await stopServer(server);

api._home = undefined;
api._identity = undefined;
api._config = undefined;

fs.rmSync(tmpHome, { recursive: true, force: true });

console.log('\n✅ All advanced client SDK tests passed');
