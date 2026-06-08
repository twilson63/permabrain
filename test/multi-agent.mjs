import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initState } from '../src/config.mjs';
import { ensureIdentity } from '../src/keys.mjs';
import { createDataItem } from '../src/dataitem.mjs';
import { tagsToObject } from '../src/tags.mjs';
import { buildArticleTags, contentHash } from '../src/tags.mjs';
import { loadIndex, updateAttestationInCache, updateArticleInCache, summarizeArticle } from '../src/cache.mjs';
import { LocalTransport } from '../src/transport.mjs';
import {
  attestForAgent,
  provisionAgentIdentity,
  parseAttestationRequest,
  processProxyAttestation,
  buildAttestationRequestBody,
  listKnownAgents,
  getKnownAgent
} from '../src/multi-agent.mjs';

// ─── Setup temp PermaBrain home ──────────────────────────────────────

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-multi-agent-'));
process.env.PERMABRAIN_HOME = tempHome;
process.env.PERMABRAIN_TRANSPORT = 'local';

const { home } = initState({ env: { ...process.env, PERMABRAIN_HOME: tempHome, PERMABRAIN_TRANSPORT: 'local' } });
const { identity: mainIdentity } = await ensureIdentity(home);

// Publish a test article in the local transport
const articleTags = buildArticleTags({
  key: 'subject/ai',
  kind: 'subject',
  title: 'Artificial Intelligence',
  topic: 'ai',
  sourceName: 'Wikipedia',
  sourceUrl: 'https://en.wikipedia.org/wiki/Artificial_intelligence',
  sourceLicense: 'CC BY-SA',
  content: 'AI content',
  agentId: mainIdentity.agentId,
  now: '2026-01-01T00:00:00.000Z'
});
const articleItem = await createDataItem({ payload: 'AI content', tags: articleTags, identity: mainIdentity });
const transport = new LocalTransport(home);
await transport.uploadDataItem(articleItem);
updateArticleInCache(home, articleItem);

// ─── Known Agent Registry ────────────────────────────────────────────

console.log('Testing known agent registry...');
const agents = listKnownAgents();
assert.equal(agents.length, 2);
assert.equal(agents[0].name, 'Sage');
assert.equal(agents[1].name, 'Relay');
assert.ok(agents[0].publicKeyFingerprint);
assert.ok(agents[1].publicKeyFingerprint);

const sage = getKnownAgent('sage');
assert.ok(sage);
assert.equal(sage.name, 'Sage');
assert.equal(getKnownAgent('unknown'), null);
console.log('  Known agent registry: OK');

// ─── Provision Agent Identity ────────────────────────────────────────

console.log('Testing provision agent identity...');
const sageIdentity = await provisionAgentIdentity('sage', { keyType: 'ed25519' });
assert.equal(sageIdentity.type, 'ed25519');
assert.match(sageIdentity.agentId, /^ed25519:/);
assert.ok(sageIdentity.publicKey);
assert.ok(sageIdentity.secretKey);
assert.equal(sageIdentity.label, 'sage');
console.log(`  Sage identity: ${sageIdentity.agentId}`);

const relayIdentity = await provisionAgentIdentity('relay', { keyType: 'ed25519' });
assert.equal(relayIdentity.type, 'ed25519');
assert.match(relayIdentity.agentId, /^ed25519:/);
assert.equal(relayIdentity.label, 'relay');
console.log(`  Relay identity: ${relayIdentity.agentId}`);
console.log('  Provision agent identity: OK');

// ─── Direct Attestation (agent signs with own key) ───────────────────

console.log('Testing direct attestation for agent...');
const sageResult = await attestForAgent({
  agentIdentity: sageIdentity,
  key: 'subject/ai',
  opinion: 'valid',
  confidence: 0.9,
  reason: 'Well-sourced AI overview'
});

assert.ok(sageResult.id);
assert.equal(sageResult.targetKey, 'subject/ai');
assert.equal(sageResult.opinion, 'valid');
assert.equal(sageResult.confidence, 0.9);
assert.equal(sageResult.reason, 'Well-sourced AI overview');
assert.equal(sageResult.agentId, sageIdentity.agentId);
console.log(`  Sage attestation: ${sageResult.id}`);

const relayResult = await attestForAgent({
  agentIdentity: relayIdentity,
  key: 'subject/ai',
  opinion: 'partially-valid',
  confidence: 0.7,
  reason: 'Good summary, missing recent developments'
});

assert.ok(relayResult.id);
assert.equal(relayResult.targetKey, 'subject/ai');
assert.equal(relayResult.opinion, 'partially-valid');
assert.equal(relayResult.agentId, relayIdentity.agentId);
console.log(`  Relay attestation: ${relayResult.id}`);

// Verify attestations are in local cache
const index = loadIndex(home);
const aiAttestations = index.attestations['subject/ai'] || [];
assert.equal(aiAttestations.length, 2);
console.log('  Direct attestation for agent: OK');

// ─── Direct Attestation Validation ───────────────────────────────────

console.log('Testing direct attestation input validation...');

await assert.rejects(
  () => attestForAgent({ key: 'subject/ai', opinion: 'valid', confidence: 0.9, reason: 'test' }),
  /agentIdentity is required/
);
await assert.rejects(
  () => attestForAgent({ agentIdentity: sageIdentity, opinion: 'valid', confidence: 0.9, reason: 'test' }),
  /key is required/
);
await assert.rejects(
  () => attestForAgent({ agentIdentity: { type: 'unknown', agentId: 'x' }, key: 'subject/ai', opinion: 'valid', confidence: 0.9, reason: 'test' }),
  /Unsupported agent identity type/
);
await assert.rejects(
  () => attestForAgent({ agentIdentity: { type: 'ed25519', agentId: 'x' }, key: 'subject/ai', opinion: 'valid', confidence: 0.9, reason: 'test' }),
  /ed25519 identity requires publicKey and secretKey/
);

console.log('  Input validation: OK');

// ─── CAP Request Parsing ─────────────────────────────────────────────

console.log('Testing CAP attestation request parsing...');
const validBody = {
  type: 'permabrain-attest',
  agentId: sageIdentity.agentId,
  key: 'subject/ai',
  opinion: 'valid',
  confidence: 0.85,
  reason: 'Cross-validated from Sage'
};
const request = parseAttestationRequest(validBody, 'wp4kJYmcDa-AfAuVOS0vMW_zZqTxQGtFgHQEAZEaW3k');
assert.equal(request.type, 'permabrain-attest');
assert.equal(request.agentId, sageIdentity.agentId);
assert.equal(request.key, 'subject/ai');
assert.equal(request.opinion, 'valid');
assert.equal(request.confidence, 0.85);
assert.equal(request.senderFingerprint, 'wp4kJYmcDa-AfAuVOS0vMW_zZqTxQGtFgHQEAZEaW3k');
console.log('  CAP request parsing: OK');

// Invalid request bodies
assert.throws(() => parseAttestationRequest({}), /type/);
assert.throws(() => parseAttestationRequest({ type: 'wrong' }), /Invalid request type/);
assert.throws(() => parseAttestationRequest({ type: 'permabrain-attest' }), /agentId is required/);
assert.throws(() => parseAttestationRequest({ type: 'permabrain-attest', agentId: 'x' }), /key is required/);
// Opinion validated after required field checks
assert.throws(() => parseAttestationRequest({ type: 'permabrain-attest', agentId: 'x', key: 'y', opinion: 'valid', confidence: 2, reason: 'test' }), /Invalid confidence/);
assert.throws(() => parseAttestationRequest({ type: 'permabrain-attest', agentId: 'x', key: 'y', opinion: 'maybe', confidence: 0.5, reason: 'test' }), /Invalid opinion/);
console.log('  CAP request validation: OK');

// ─── Proxy Attestation (CAP flow) ────────────────────────────────────

console.log('Testing proxy attestation...');
const proxyRequest = parseAttestationRequest({
  type: 'permabrain-attest',
  agentId: sageIdentity.agentId,
  key: 'subject/ai',
  opinion: 'valid',
  confidence: 0.88,
  reason: 'CAP proxy: Sage endorses this article',
  sourceUrl: 'https://example.com/source'
}, 'wp4kJYmcDa-AfAuVOS0vMW_zZqTxQGtFgHQEAZEaW3k');

const proxyResult = await processProxyAttestation(proxyRequest);
assert.ok(proxyResult.id);
assert.equal(proxyResult.targetKey, 'subject/ai');
assert.equal(proxyResult.opinion, 'valid');
assert.equal(proxyResult.confidence, 0.88);
assert.equal(proxyResult.agentId, mainIdentity.agentId); // Signed by Dev1
assert.equal(proxyResult.requesterId, sageIdentity.agentId); // But on behalf of Sage
assert.equal(proxyResult.requesterFingerprint, 'wp4kJYmcDa-AfAuVOS0vMW_zZqTxQGtFgHQEAZEaW3k');
console.log(`  Proxy attestation: ${proxyResult.id}`);
console.log(`  Signed by: ${proxyResult.agentId}`);
console.log(`  On behalf of: ${proxyResult.requesterId}`);

// Verify proxy tags in the uploaded data item
const proxyItem = await transport.fetchDataItem(proxyResult.id);
const proxyTags = tagsToObject(proxyItem.tags || []);
assert.equal(proxyTags['Attestation-Proxy'], 'true');
assert.equal(proxyTags['Attestation-Requester-Id'], sageIdentity.agentId);
assert.equal(proxyTags['Attestation-Requester-Fingerprint'], 'wp4kJYmcDa-AfAuVOS0vMW_zZqTxQGtFgHQEAZEaW3k');
console.log('  Proxy tags verified: OK');

// Verify attestation count increased
const updatedIndex = loadIndex(home);
const updatedAttestations = updatedIndex.attestations['subject/ai'] || [];
assert.equal(updatedAttestations.length, 3); // 2 direct + 1 proxy
console.log('  Proxy attestation: OK');

// ─── CAP Request Builder ────────────────────────────────────────────

console.log('Testing CAP request builder...');
const requestBody = buildAttestationRequestBody({
  key: 'subject/ai',
  opinion: 'valid',
  confidence: 0.75,
  reason: 'Test request',
  agentId: mainIdentity.agentId,
  sourceUrl: 'https://example.com'
});
assert.equal(requestBody.type, 'permabrain-attest');
assert.equal(requestBody.key, 'subject/ai');
assert.equal(requestBody.agentId, mainIdentity.agentId);
assert.ok(requestBody.requestedAt);

// Validation
assert.throws(() => buildAttestationRequestBody({}), /key is required/);
assert.throws(() => buildAttestationRequestBody({ key: 'x' }), /opinion is required/);
console.log('  CAP request builder: OK');

// ─── Agent API Integration ──────────────────────────────────────────

console.log('Testing agent-api multi-agent integration...');
const { api } = await import('../src/agent-api.mjs');
await api.init({ keyType: 'ed25519', transport: 'local' });

const apiAgents = api.listKnownAgents();
assert.equal(apiAgents.length, 2);

const apiSage = api.getKnownAgent('sage');
assert.ok(apiSage);
assert.equal(apiSage.name, 'Sage');

const parsedRequest = api.parseAttestationRequest({
  type: 'permabrain-attest',
  agentId: 'ed25519:test',
  key: 'subject/ai',
  opinion: 'valid',
  confidence: 0.5,
  reason: 'API test'
});
assert.equal(parsedRequest.key, 'subject/ai');

const builtRequest = api.buildAttestationRequest({
  key: 'subject/test',
  opinion: 'invalid',
  confidence: 0.3,
  reason: 'Bad info',
  agentId: 'test:agent'
});
assert.equal(builtRequest.type, 'permabrain-attest');

console.log('  Agent API integration: OK');

// ─── Cleanup ────────────────────────────────────────────────────────

fs.rmSync(tempHome, { recursive: true, force: true });

console.log('multi-agent tests passed');