/**
 * Tests for src/verify.mjs
 *
 * Covers:
 *   - verifyDataItemById with valid article
 *   - verifyByKey with local transport
 *   - invalid signature detection (tampered payload)
 *   - missing required tags
 *   - attestation verification with valid target
 *   - attestation verification with target key mismatch
 *   - CLI command registration
 *   - agent API verify wrapper
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

process.chdir(__dirname);

const { initState } = await import('../src/config.mjs');
const { ensureIdentity, loadIdentity } = await import('../src/keys.mjs');
const { publishArticle } = await import('../src/article.mjs');
const { attestArticle } = await import('../src/attestation.mjs');
const { verifyDataItemById, verifyByKey } = await import('../src/verify.mjs');
const { verifyDataItem, createDataItem } = await import('../src/dataitem.mjs');
const { getTransport, LocalTransport } = await import('../src/transport.mjs');
const { buildArticleTags } = await import('../src/tags.mjs');
const { defaultConfig } = await import('../src/config.mjs');

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function setupLocalHome(home) {
  fs.mkdirSync(path.join(home, 'cache', 'objects'), { recursive: true });
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ ...defaultConfig(), transport: 'local', gateway: { type: 'local' }, bundler: { type: 'local' } }, null, 2) + '\n');
}

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERT FAIL: ${message}`);
}

async function run() {
  let passed = 0;
  let failed = 0;

  const cases = [];

  // 1. Verify a published article by ID
  cases.push(async () => {
    const home = tmpDir('permabrain-verify-article-');
    process.env.PERMABRAIN_HOME = home;
    initState();
    setupLocalHome(home);
    const { identity } = await ensureIdentity(home, { keyType: 'ed25519' });
    const content = '# Test Article\n\nThis is the body.';
    const published = await publishArticle({
      content,
      kind: 'subject',
      topic: 'verify-test',
      key: 'subject/verify-test-article',
      title: 'Verify Test Article',
      sourceUrl: 'https://example.com/verify-test',
      sourceName: 'example.com'
    });
    const result = await verifyDataItemById(published.summary.id, { home });
    assert(result.valid, 'published article should verify');
    assert(result.type === 'article', 'type should be article');
    assert(result.article.key === 'subject/verify-test-article', 'key matches');
    assert(result.checks.some(c => c.name === 'dataitem-signature' && c.ok), 'signature check passes');
    assert(result.checks.some(c => c.name === 'article-content-hash' && c.ok), 'content hash check passes');
    assert(result.checks.some(c => c.name === 'article-canonical-key' && c.ok), 'canonical key check passes');
    fs.rmSync(home, { recursive: true, force: true });
  });

  // 2. Verify by canonical key via local transport
  cases.push(async () => {
    const home = tmpDir('permabrain-verify-key-');
    process.env.PERMABRAIN_HOME = home;
    initState();
    setupLocalHome(home);
    await ensureIdentity(home, { keyType: 'ed25519' });
    const content = 'Key lookup test content';
    const published = await publishArticle({
      content,
      kind: 'subject',
      topic: 'verify-test',
      key: 'subject/verify-by-key',
      title: 'Verify By Key',
      sourceUrl: 'https://example.com/key'
    });
    const result = await verifyByKey('subject/verify-by-key', { home });
    if (!result) throw new Error('verifyByKey returned undefined');
    assert(result.valid, 'verifyByKey should be valid');
    assert(result.article.id === published.summary.id, 'resolved latest article');
    fs.rmSync(home, { recursive: true, force: true });
  });

  // 3. Detect tampered payload (signature invalid)
  cases.push(async () => {
    const home = tmpDir('permabrain-verify-tamper-');
    process.env.PERMABRAIN_HOME = home;
    initState();
    setupLocalHome(home);
    const { identity } = await ensureIdentity(home, { keyType: 'ed25519' });
    const tags = buildArticleTags({
      key: 'subject/tampered',
      kind: 'subject',
      title: 'Tampered',
      topic: 'verify-test',
      content: 'original',
      agentId: identity.agentId,
      sourceUrl: 'https://example.com/tampered'
    });
    const item = await createDataItem({ payload: 'original', tags, identity });
    const tampered = JSON.parse(JSON.stringify(item));
    tampered.payloadBase64 = Buffer.from('tampered').toString('base64url');
    // Re-serialize tampered payload into ans104 bytes would break id; just test verifyItem directly
    // Instead corrupt ans104 bytes so signature becomes invalid
    const bytes = Buffer.from(item.ans104Base64, 'base64url');
    bytes[bytes.length - 1] ^= 0xff; // flip last data byte
    const corruptItem = {
      ...item,
      ans104Base64: bytes.toString('base64url'),
      payloadBase64: Buffer.from('tampered').toString('base64url')
    };
    const { verifyItem } = await import('../src/verify.mjs');
    const result = await verifyItem(corruptItem, { home, verifyChain: false });
    assert(!result.valid, 'tampered item should be invalid');
    assert(result.checks.some(c => c.name === 'dataitem-signature' && !c.ok), 'signature check fails');
    fs.rmSync(home, { recursive: true, force: true });
  });

  // 4. Missing required article tags
  cases.push(async () => {
    const home = tmpDir('permabrain-verify-missing-');
    process.env.PERMABRAIN_HOME = home;
    initState();
    setupLocalHome(home);
    const { identity } = await ensureIdentity(home, { keyType: 'ed25519' });
    const tags = [
      { name: 'App-Name', value: 'PermaBrain' },
      { name: 'PermaBrain-Type', value: 'article' },
      { name: 'Article-Key', value: 'subject/bad' }
    ];
    const item = await createDataItem({ payload: 'bad', tags, identity });
    const { verifyItem } = await import('../src/verify.mjs');
    const result = await verifyItem(item, { home, verifyChain: false });
    assert(!result.valid, 'missing tags should fail');
    assert(result.checks.some(c => c.name === 'article-required-tags' && !c.ok), 'required tags check fails');
    fs.rmSync(home, { recursive: true, force: true });
  });

  // 5. Valid attestation verification
  cases.push(async () => {
    const home = tmpDir('permabrain-verify-att-');
    process.env.PERMABRAIN_HOME = home;
    initState();
    setupLocalHome(home);
    await ensureIdentity(home, { keyType: 'ed25519' });
    const article = await publishArticle({
      content: 'Article to attest',
      kind: 'subject',
      topic: 'verify-test',
      key: 'subject/verify-attestation-target',
      title: 'Attestation Target',
      sourceUrl: 'https://example.com/att-target'
    });
    const attestation = await attestArticle({
      key: 'subject/verify-attestation-target',
      opinion: 'valid',
      confidence: 0.9,
      reason: 'Looks good',
      targetId: article.summary.id
    });
    const { verifyItem } = await import('../src/verify.mjs');
    const result = await verifyItem(attestation.item, { home });
    assert(result.valid, 'valid attestation should verify');
    assert(result.type === 'attestation', 'type is attestation');
    assert(result.attestation.targetId === article.summary.id, 'target id matches');
    assert(result.checks.some(c => c.name === 'attestation-target' && c.ok), 'target check passes');
    fs.rmSync(home, { recursive: true, force: true });
  });

  // 6. Attestation with target key mismatch
  cases.push(async () => {
    const home = tmpDir('permabrain-verify-att-mismatch-');
    process.env.PERMABRAIN_HOME = home;
    initState();
    setupLocalHome(home);
    const { identity } = await ensureIdentity(home, { keyType: 'ed25519' });
    const article = await publishArticle({
      content: 'Article A',
      kind: 'subject',
      topic: 'verify-test',
      key: 'subject/article-a',
      title: 'Article A',
      sourceUrl: 'https://example.com/a'
    });
    const tags = [
      { name: 'App-Name', value: 'PermaBrain' },
      { name: 'PermaBrain-Type', value: 'attestation' },
      { name: 'Attestation-Target-Id', value: article.summary.id },
      { name: 'Attestation-Target-Key', value: 'subject/article-b' },
      { name: 'Attestation-Opinion', value: 'valid' },
      { name: 'Attestation-Confidence', value: '0.9' },
      { name: 'Attestation-Reason', value: 'Mismatch test' },
      { name: 'Attestation-Agent-Id', value: identity.agentId }
    ];
    const payload = JSON.stringify({ targetId: article.summary.id, targetKey: 'subject/article-b', opinion: 'valid', confidence: 0.9, reason: 'Mismatch test' });
    const item = await createDataItem({ payload, tags, identity });
    const { verifyItem } = await import('../src/verify.mjs');
    const result = await verifyItem(item, { home });
    assert(!result.valid, 'mismatched target key should fail');
    assert(result.checks.some(c => c.name === 'attestation-target' && !c.ok), 'target check fails');
    fs.rmSync(home, { recursive: true, force: true });
  });

  // 7. CLI command registered
  cases.push(async () => {
    const { execSync } = await import('node:child_process');
    const cliPath = path.resolve(__dirname, '../scripts/cli.mjs');
    const out = execSync(`node ${cliPath} verify --help`, { encoding: 'utf8' });
    assert(out.includes('verify'), 'verify help includes command');
    assert(out.includes('--attestations'), 'verify help includes --attestations');
  });

  // 8. Agent API exposes verify
  cases.push(async () => {
    const home = tmpDir('permabrain-verify-api-');
    process.env.PERMABRAIN_HOME = home;
    const { api } = await import('../src/agent-api.mjs');
    await api.init({ keyType: 'ed25519', transport: 'local' });
    const published = await api.publish({
      content: 'API verify test',
      kind: 'subject',
      topic: 'verify-test',
      key: 'subject/api-verify',
      title: 'API Verify',
      sourceUrl: 'https://example.com/api'
    });
    const byId = await api.verify(published.summary.id);
    if (!byId) throw new Error('api.verify(id) returned undefined');
    assert(byId.valid, 'api.verify(id) valid');
    const byKey = await api.verify('subject/api-verify');
    if (!byKey) throw new Error('api.verify(key) returned undefined');
    assert(byKey.valid, 'api.verify(key) valid');
    fs.rmSync(home, { recursive: true, force: true });
  });

  for (const [i, fn] of cases.entries()) {
    try {
      await fn();
      passed++;
      console.log(`  test ${i + 1}: ok`);
    } catch (err) {
      failed++;
      console.error(`  test ${i + 1}: FAIL — ${err.message}`);
    }
  }

  console.log(`\nverify tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
