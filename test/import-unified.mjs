/**
 * Test: Unified import auto-detection and routing
 *
 * Verifies detectBundleType, dry-run previews, and auto-routing for
 * article bundles, history bundles, threshold envelopes, and encrypted shares.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  detectBundleType,
  importBundleAutoDetect,
  importReportToMarkdown,
  BUNDLE_TYPES
} from '../src/import-unified.mjs';
import { api } from '../src/agent-api.mjs';
import { runCommand } from '../src/commands.mjs';
import * as pbcrypto from '../src/crypto.mjs';

function tmpHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pb-import-unified-'));
}

function resetApi(home) {
  api._home = home;
  api._config = null;
  api._identity = null;
}

async function initHome(home) {
  process.env.PERMABRAIN_HOME = home;
  await api.init({ keyType: 'ed25519', transport: 'local' });
}

console.log('1. detectBundleType recognizes known shapes');
{
  assert.equal(detectBundleType({ version: '1', entries: [] }), BUNDLE_TYPES.ARTICLE);
  assert.equal(detectBundleType({ type: 'history', entries: [] }), BUNDLE_TYPES.HISTORY);
  assert.equal(detectBundleType({ envelopeId: 'e1', policy: {}, digest: 'd', signers: [], targetKey: 'k' }), BUNDLE_TYPES.THRESHOLD);
  assert.equal(detectBundleType({ encryptedPayload: {}, recipientFingerprints: [] }), BUNDLE_TYPES.ENCRYPTED_SHARE);
  assert.equal(detectBundleType({ articles: [], attestations: [] }), BUNDLE_TYPES.ARTICLE);
  assert.equal(detectBundleType(null), BUNDLE_TYPES.UNKNOWN);
  assert.equal(detectBundleType({}), BUNDLE_TYPES.UNKNOWN);
  console.log('   ✓ Detection works');
}

console.log('2. Dry-run import of an empty article bundle');
{
  const home = tmpHome();
  resetApi(home);
  await initHome(home);
  const bundle = { version: 'permabrain-bundle/1.0.0', entries: [] };
  const report = await importBundleAutoDetect(bundle, { home, dryRun: true });
  assert.equal(report.dryRun, true);
  assert.equal(report.type, BUNDLE_TYPES.ARTICLE);
  assert.equal(report.imported, 0);
  assert.equal(report.skipped, 0);
  assert.equal(report.failed, 0);
  assert.equal(report.items.length, 0);
  console.log('   ✓ Empty dry-run report');
}

console.log('3. Publish and dry-run import an article bundle');
{
  const home = tmpHome();
  resetApi(home);
  await initHome(home);
  const article = await api.publish({
    content: '# Unified import test article\n\nHello.',
    kind: 'subject',
    topic: 'import-test',
    sourceUrl: 'https://example.com/import-test',
    title: 'Unified Import Test'
  });
  assert.ok(article.summary.id, 'article published');

  const bundle = await api.exportBundle({ key: article.summary.key, includeAttestations: false, includeVersions: false });
  assert.equal(detectBundleType(bundle), BUNDLE_TYPES.ARTICLE);

  const freshHome = tmpHome();
  resetApi(freshHome);
  await initHome(freshHome);
  const dryRun = await importBundleAutoDetect(bundle, { home: freshHome, dryRun: true });
  assert.equal(dryRun.imported, 1);
  assert.equal(dryRun.skipped, 0);
  assert.equal(dryRun.failed, 0);

  const result = await importBundleAutoDetect(bundle, { home: freshHome });
  assert.equal(result.imported, 1);
  assert.equal(result.skipped, 0);
  assert.equal(result.failed, 0);
  console.log('   ✓ Article bundle detected, dry-run, and imported');
}

console.log('4. Publish version chain and dry-run import a history bundle');
{
  const home = tmpHome();
  resetApi(home);
  await initHome(home);
  const v1 = await api.publish({
    content: '# Version 1',
    kind: 'subject',
    topic: 'history-import-test',
    sourceUrl: 'https://example.com/history-v1',
    key: 'subject/history-import-test',
    title: 'History Import Test'
  });
  const v2 = await api.publish({
    content: '# Version 2',
    kind: 'subject',
    topic: 'history-import-test',
    sourceUrl: 'https://example.com/history-v2',
    key: 'subject/history-import-test',
    title: 'History Import Test'
  });
  assert.notEqual(v1.summary.id, v2.summary.id);

  const bundle = await api.exportHistory('subject/history-import-test');
  assert.equal(detectBundleType(bundle), BUNDLE_TYPES.HISTORY);

  const freshHome = tmpHome();
  resetApi(freshHome);
  await initHome(freshHome);
  const dryRun = await importBundleAutoDetect(bundle, { home: freshHome, dryRun: true });
  assert.equal(dryRun.items.length, 2);
  assert.equal(dryRun.imported, 2);
  assert.equal(dryRun.skipped, 0);

  const result = await importBundleAutoDetect(bundle, { home: freshHome });
  assert.equal(result.importedArticles, 2);
  assert.equal(result.skipped, 0);
  assert.equal(result.failed, 0);
  console.log('   ✓ History bundle detected, dry-run, and replayed in version order');
}

console.log('5. Import a threshold envelope dry-run and finalize');
{
  const home = tmpHome();
  resetApi(home);
  await initHome(home);
  const article = await api.publish({
    content: '# Threshold import test',
    kind: 'subject',
    topic: 'threshold-import-test',
    sourceUrl: 'https://example.com/threshold-import-test',
    key: 'subject/threshold-import-test',
    title: 'Threshold Import Test'
  });

  const envelope = await api.createThresholdAttestation({
    key: article.summary.key,
    opinion: 'valid',
    confidence: 0.9,
    reason: 'Peer reviewed',
    policy: { threshold: 1, coSignerAgentIds: [] }
  });
  assert.equal(detectBundleType(envelope), BUNDLE_TYPES.THRESHOLD);

  const dryRun = await importBundleAutoDetect(envelope, { home, dryRun: true });
  assert.equal(dryRun.type, BUNDLE_TYPES.THRESHOLD);
  assert.equal(dryRun.thresholdMet, true);

  const result = await importBundleAutoDetect(envelope, { home, finalize: true });
  assert.equal(result.imported, true);
  assert.equal(result.finalized, true);
  assert.ok(result.itemId);
  console.log('   ✓ Threshold envelope detected, dry-run, imported, and finalized');
}

console.log('6. Import an encrypted share dry-run and decrypt/publish');
{
  const home = tmpHome();
  resetApi(home);
  await initHome(home);
  const recipient = pbcrypto.generateEncryptionKeypair();
  const share = {
    title: 'Secret Import',
    key: 'subject/secret-import',
    kind: 'subject',
    topic: 'encrypted-import-test',
    agentId: 'ed25519:test-agent',
    sourceUrl: 'https://example.com/secret-import',
    recipientFingerprints: [recipient.fingerprint],
    encryptedPayload: (await pbcrypto.encrypt('Encrypted share body for import.', [recipient.publicKey])).encryptedPayload
  };
  assert.equal(detectBundleType(share), BUNDLE_TYPES.ENCRYPTED_SHARE);

  const dryRun = await importBundleAutoDetect(share, { home, dryRun: true, seed: recipient.seed });
  assert.equal(dryRun.type, BUNDLE_TYPES.ENCRYPTED_SHARE);
  assert.equal(dryRun.canDecrypt, true);

  const result = await importBundleAutoDetect(share, { home, seed: recipient.seed });
  assert.equal(result.decrypted, true);
  assert.equal(result.published, true);
  assert.ok(result.articleId);
  console.log('   ✓ Encrypted share detected, dry-run, decrypted, and published');
}

console.log('7. Encrypted share without seed throws');
{
  const share = {
    title: 'No Seed Share',
    key: 'subject/no-seed',
    kind: 'subject',
    topic: 'encrypted-import-test',
    agentId: 'ed25519:test-agent',
    sourceUrl: 'https://example.com/no-seed',
    recipientFingerprints: ['fp'],
    encryptedPayload: {}
  };
  await assert.rejects(
    () => importBundleAutoDetect(share, { home: tmpHome() }),
    /requires --seed/
  );
  console.log('   ✓ Missing seed error');
}

console.log('8. importReportToMarkdown renders a dry-run report');
{
  const report = {
    dryRun: true,
    type: BUNDLE_TYPES.ARTICLE,
    imported: 1,
    skipped: 1,
    failed: 0,
    items: [
      { type: 'article', key: 'subject/a', id: 'id1', action: 'import', exists: false, signatureOk: true },
      { type: 'attestation', key: 'subject/a', id: 'id2', action: 'skip', exists: true, signatureOk: null }
    ]
  };
  const md = importReportToMarkdown(report);
  assert.ok(md.includes('PermaBrain Import Report'));
  assert.ok(md.includes('Type: article-bundle'));
  assert.ok(md.includes('id1'));
  assert.ok(md.includes('skip'));
  console.log('   ✓ Markdown report generated');
}

console.log('9. CLI import command dry-run via runCommand');
{
  const home = tmpHome();
  resetApi(home);
  await initHome(home);
  const article = await api.publish({
    content: '# CLI import test',
    kind: 'subject',
    topic: 'cli-import-test',
    sourceUrl: 'https://example.com/cli-import',
    title: 'CLI Import Test'
  });
  const bundle = await api.exportBundle({ key: article.summary.key, includeAttestations: false, includeVersions: false });
  const file = path.join(home, 'bundle.json');
  fs.writeFileSync(file, JSON.stringify(bundle, null, 2));

  const freshHome = tmpHome();
  resetApi(freshHome);
  await initHome(freshHome);
  const result = await runCommand('import', {
    _: [file],
    'dry-run': true,
    json: true
  });
  assert.equal(result.type, BUNDLE_TYPES.ARTICLE);
  assert.equal(result.imported, 1);
  console.log('   ✓ CLI import command dry-run');
}

console.log('\nOK All unified import tests passed');
