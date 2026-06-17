/**
 * Test: Threshold / multi-sig attestations
 *
 * Verifies envelope creation, co-signer signature verification, threshold
 * finalization, HTTP API routes, CLI command wiring, and consensus scoring.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

process.env.PERMABRAIN_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-threshold-'));
process.env.PERMABRAIN_KEY_TYPE = 'ed25519';
process.env.PERMABRAIN_TRANSPORT = 'local';

const { api } = await import('../src/agent-api.mjs');
const threshold = await import('../src/threshold-attestation.mjs');
const { startServer, stopServer } = await import('../src/serve.mjs');
const { createClient } = await import('../src/client.mjs');
const { consensusForArticle } = await import('../src/consensus.mjs');

await api.init({ keyType: 'ed25519', transport: 'local' });

function makeArticle() {
  const id = `article-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    content: `# Test article ${id}\n\nThreshold target.`,
    kind: 'subject',
    topic: 'threshold-test',
    sourceUrl: `https://example.com/${id}`,
    title: `Test ${id}`,
    key: `subject/threshold-${id}`
  };
}

console.log('1. Create threshold envelope via API');
const article = makeArticle();
const published = await api.publish(article);
assert.ok(published.summary.id, 'article published');

const envelope = await api.createThresholdAttestation({
  key: article.key,
  opinion: 'valid',
  confidence: 0.95,
  reason: 'Cross-checked by peers',
  sourceUrl: 'https://example.com/reason',
  policy: { threshold: 2, coSignerAgentIds: ['ed25519:co1', 'ed25519:co2'] }
});
assert.ok(envelope.envelopeId, 'envelopeId set');
assert.equal(envelope.targetKey, article.key, 'targetKey matches');
assert.equal(envelope.policy.threshold, 2, 'threshold 2');
assert.equal(envelope.signers.length, 1, 'primary signature included');
console.log('   ✓ Envelope created');

console.log('2. Sign threshold digest with co-signer identities');
const co1 = await api.provisionAgent('co1');
const co2 = await api.provisionAgent('co2');
const digest = Buffer.from(envelope.digest, 'base64url');
const sig1 = await threshold.signThresholdDigest(co1, digest);
const sig2 = await threshold.signThresholdDigest(co2, digest);
assert.equal(sig1.signatureType, 'ed25519', 'co1 signature type');
assert.equal(sig1.agentId, co1.agentId, 'co1 agentId');
assert.ok(sig1.signature, 'co1 signature present');
console.log('   ✓ Co-signer signatures produced');

console.log('3. Verify co-signer signatures');
const verify1 = await threshold.verifyThresholdSignature(digest, { ...sig1, publicKey: co1.publicKey });
const verify2 = await threshold.verifyThresholdSignature(digest, { ...sig2, publicKey: co2.publicKey });
assert.equal(verify1, true, 'sig1 valid');
assert.equal(verify2, true, 'sig2 valid');
console.log('   ✓ Co-signer signatures verified');

console.log('4. Add co-signers to envelope');
const added1 = await api.addThresholdSigner(envelope.envelopeId, { ...sig1, publicKey: co1.publicKey });
const updated = await api.addThresholdSigner(envelope.envelopeId, { ...sig2, publicKey: co2.publicKey });
assert.equal(updated.signers.length, 3, 'primary + 2 co-signers');
console.log('   ✓ Co-signers added');

console.log('5. Verify threshold envelope');
const verified = await api.verifyThresholdEnvelope(updated);
assert.equal(verified.ok, true, 'threshold met');
assert.equal(verified.valid >= envelope.policy.threshold, true, 'at least threshold signatures valid');
assert.equal(verified.required, 2, 'required 2');
console.log('   ✓ Threshold verified');

console.log('6. Finalize threshold attestation');
const finalized = await api.finalizeThresholdAttestation(envelope.envelopeId);
assert.ok(finalized.item.id, 'attestation DataItem id');
assert.equal(finalized.summary.targetKey, article.key, 'summary targetKey');
assert.equal(finalized.summary.opinion, 'valid', 'summary opinion');
assert.equal(finalized.summary.threshold, 2, 'summary threshold tag');
assert.equal(finalized.summary.coSignerCount, 3, 'summary coSignerCount');
assert.equal(finalized.summary.multiSig, true, 'summary multiSig');
console.log('   ✓ Threshold attestation finalized');

console.log('7. Consensus scoring picks up multi-sig bonus');
const consensus = await consensusForArticle(article.key);
assert.ok(consensus.score > 0, 'consensus has positive score');
const component = consensus.scoreComponents.find((c) => c.agentId === finalized.summary.agentId);
assert.ok(component, 'multi-sig component present');
assert.equal(component.multiSigBonus, 0.25, 'multiSigBonus applied');
console.log('   ✓ Multi-sig bonus applied in consensus');

console.log('8. HTTP API threshold routes');
const server = await startServer({ port: 0 });
const baseUrl = `http://localhost:${server.port}`;
const client = createClient({ baseUrl });

const article2 = makeArticle();
const pub2 = await client.publish(article2);
assert.ok(pub2.summary.id, 'article 2 published via client');

const env2 = await client.post('/api/v1/threshold-attest', {
  key: article2.key,
  opinion: 'valid',
  confidence: 0.9,
  reason: 'HTTP test',
  policy: { threshold: 1, coSignerAgentIds: [co1.agentId] }
});
assert.ok(env2.envelopeId, 'HTTP envelope created');
assert.equal(env2.signers.length, 1, 'HTTP envelope has primary sig');

const coSig = await threshold.signThresholdDigest(co1, Buffer.from(env2.digest, 'base64url'));
await client.post('/api/v1/threshold-attest/sign', {
  envelopeId: env2.envelopeId,
  signer: { ...coSig, publicKey: co1.publicKey }
});

const httpFinal = await client.post('/api/v1/threshold-attest/finalize', { envelopeId: env2.envelopeId });
assert.ok(httpFinal.item.id, 'HTTP finalize produced DataItem');

const httpVerify = await client.post('/api/v1/threshold-attest/verify', { envelope: { ...env2, signers: [{ ...coSig, publicKey: co1.publicKey }] } });
assert.equal(httpVerify.ok, true, 'HTTP verify ok');

await stopServer(server.server);
console.log('   ✓ HTTP threshold routes work');

console.log('9. CLI threshold-attest command wiring');
const { runCommand } = await import('../src/commands.mjs');
const cliEnvPath = path.join(process.env.PERMABRAIN_HOME, 'cli-envelope.json');
const cliArticle = makeArticle();
const cliPub = await api.publish(cliArticle);
assert.ok(cliPub.summary.id, 'CLI article published');

const created = await runCommand('threshold-attest', {
  _: ['create', cliArticle.key],
  valid: true,
  confidence: 0.88,
  reason: 'CLI test',
  threshold: 1,
  'co-signers': 'ed25519:cli-co',
  output: cliEnvPath,
  json: true
});
assert.ok(created.envelopeId, 'CLI created envelope');
assert.equal(fs.existsSync(cliEnvPath), true, 'CLI envelope file written');

const imported = await runCommand('threshold-attest', {
  _: ['import', cliEnvPath],
  json: true
});
assert.equal(imported.envelopeId, created.envelopeId, 'CLI import returns same envelope');

const cliCoSig = await threshold.signThresholdDigest(co1, Buffer.from(created.digest, 'base64url'));
const added = await runCommand('threshold-attest', {
  _: ['add-sig', cliEnvPath],
  'agent-id': co1.agentId,
  'signature-type': 'ed25519',
  signature: cliCoSig.signature,
  'public-key': co1.publicKey,
  json: true
});
assert.equal(added.signers.length, 2, 'CLI add-sig adds co-signer');

const cliVerified = await runCommand('threshold-attest', {
  _: ['verify', cliEnvPath],
  json: true
});
assert.equal(cliVerified.ok, true, 'CLI verify ok');

const cliFinalized = await runCommand('threshold-attest', {
  _: ['finalize', cliEnvPath],
  json: true
});
assert.ok(cliFinalized.itemId || cliFinalized.summary?.id, 'CLI finalize itemId or summary.id');
assert.equal(fs.existsSync(cliEnvPath), false, 'CLI envelope file removed after finalize');
console.log('   ✓ CLI threshold-attest subcommands work');

console.log('10. Import/export shared envelope round-trip');
const sharedEnv = await api.createThresholdAttestation({
  key: article.key,
  opinion: 'partially-valid',
  confidence: 0.6,
  reason: 'Shared round-trip',
  policy: { threshold: 1, coSignerAgentIds: ['ed25519:shared'] }
});
const exported = await api.exportThresholdEnvelope(sharedEnv.envelopeId);
assert.deepEqual(exported.envelopeId, sharedEnv.envelopeId, 'export returns envelope');
const reimported = await api.importThresholdEnvelope(exported);
assert.equal(reimported.envelopeId, sharedEnv.envelopeId, 'import returns same envelope');
console.log('   ✓ Import/export round-trip works');

console.log('10a. HTTP envelope sharing route round-trip');
const server2 = await startServer({ port: 0 });
const baseUrl2 = `http://localhost:${server2.port}`;
const client2 = createClient({ baseUrl: baseUrl2 });

const sharedEnv2 = await api.createThresholdAttestation({
  key: article.key,
  opinion: 'partially-valid',
  confidence: 0.6,
  reason: 'HTTP envelope sharing',
  policy: { threshold: 1, coSignerAgentIds: ['ed25519:shared2'] }
});
const httpExported = await client2.getThresholdEnvelope(sharedEnv2.envelopeId);
assert.equal(httpExported.envelopeId, sharedEnv2.envelopeId, 'GET /api/v1/threshold/envelope/:id returns envelope');

const httpImported = await client2.shareThresholdEnvelope({ envelope: httpExported });
assert.equal(httpImported.envelopeId, sharedEnv2.envelopeId, 'POST /api/v1/threshold/envelope imports envelope');

await stopServer(server2.server);
console.log('   ✓ HTTP envelope sharing route round-trip works');

console.log('10b. CLI envelope import/export subcommands');
const cliExportPath = path.join(process.env.PERMABRAIN_HOME, 'cli-exported-envelope.json');
const cliExported = await runCommand('threshold-attest', {
  _: ['export-envelope', sharedEnv.envelopeId],
  output: cliExportPath,
  json: true
});
assert.equal(cliExported.envelopeId, sharedEnv.envelopeId, 'CLI export-envelope returns same envelope');
assert.equal(fs.existsSync(cliExportPath), true, 'CLI export-envelope wrote file');

const cliImported = await runCommand('threshold-attest', {
  _: ['import-envelope', cliExportPath],
  json: true
});
assert.equal(cliImported.envelopeId, sharedEnv.envelopeId, 'CLI import-envelope returns same envelope');
console.log('   ✓ CLI envelope import/export subcommands work');

console.log('11. normalizeThresholdPolicy validation');
assert.throws(() => threshold.normalizeThresholdPolicy({ threshold: 0, coSignerAgentIds: ['a'] }), /threshold must be a positive integer/);
assert.throws(() => threshold.normalizeThresholdPolicy({ threshold: 2, coSignerAgentIds: ['a'] }), /threshold 2 exceeds co-signer count 1/);
const normalized = threshold.normalizeThresholdPolicy({ threshold: 2, coSignerAgentIds: ['b', 'a'] });
assert.deepEqual(normalized, { threshold: 2, coSignerAgentIds: ['b', 'a'] }, 'policy normalized');
console.log('   ✓ Policy validation works');

console.log('\nOK All threshold attestation tests passed');

