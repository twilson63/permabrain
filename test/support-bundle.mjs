import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { buildSupportBundle, supportBundleToMarkdown, redactSecrets } from '../src/support-bundle.mjs';
import { initState } from '../src/config.mjs';
import { ensureIdentity } from '../src/keys.mjs';
import { publishArticle } from '../src/article.mjs';
import { attestArticle } from '../src/attestation.mjs';
import { logAction } from '../src/log.mjs';

function tmpHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-support-bundle-'));
  process.env.PERMABRAIN_HOME = dir;
  return dir;
}

{
  const home = tmpHome();
  try {
    initState();
    await ensureIdentity(home, { keyType: 'ed25519' });

    const bundle = await buildSupportBundle({ home });
    assert.ok(bundle.generatedAt, 'generatedAt');
    assert.equal(bundle.home, home, 'home');
    assert.equal(bundle.package.name, 'permabrain', 'package name');
    assert.ok(bundle.node, 'node version');
    assert.ok(bundle.config, 'config');
    assert.ok(bundle.identity, 'identity');
    assert.ok(bundle.identity.agentId, 'identity.agentId');
    assert.equal(bundle.identity.type, 'ed25519', 'identity.type');
    assert.ok(bundle.identity.publicKey, 'identity.publicKey');
    assert.ok(!bundle.identity.secretKey, 'secret key is not exposed');
    assert.ok(bundle.indexSummary, 'indexSummary');
    assert.equal(bundle.indexSummary.articleCount, 0, 'empty index article count');
    assert.deepStrictEqual(bundle.indexSummary.topics, [], 'no topics');
    assert.ok(bundle.auditLog, 'auditLog');
    assert.ok(bundle.accessLog, 'accessLog');
    assert.ok(bundle.metrics, 'metrics');
    assert.ok(Array.isArray(bundle.routes), 'routes array');
    assert.ok(bundle.routes.length > 0, 'routes non-empty');
    assert.ok(Array.isArray(bundle.environment), 'environment');
    assert.ok(bundle.transport, 'transport');
    console.log('✓ Local support bundle contains all expected sections');

    const markdown = supportBundleToMarkdown(bundle);
    assert.ok(markdown.includes('# PermaBrain Support Bundle'), 'markdown header');
    assert.ok(markdown.includes(bundle.identity.agentId), 'markdown agentId');
    assert.ok(markdown.includes('Registered routes'), 'markdown routes section');
    assert.ok(markdown.includes('Environment'), 'markdown environment section');
    console.log('✓ Markdown rendering works');

    const bundleWithData = await buildSupportBundle({ home });
    assert.equal(bundleWithData.indexSummary.articleCount, 0, 'still empty index');
    console.log('✓ Support bundle can be built for empty home repeatedly');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

{
  const home = tmpHome();
  try {
    initState();
    const { identity } = await ensureIdentity(home, { keyType: 'ed25519' });

    await publishArticle({
      file: null,
      content: 'Test article for support bundle.',
      kind: 'subject',
      topic: 'support-test',
      key: 'subject/support-bundle-article',
      title: 'Support Bundle Test Article',
      sourceUrl: 'https://example.com/test',
      sourceName: 'Example',
      sourceLicense: 'CC0',
      language: 'en'
    });

    await attestArticle({
      key: 'subject/support-bundle-article',
      opinion: 'valid',
      confidence: 0.9,
      reason: 'Testing support bundle attestation inclusion.'
    });

    logAction({ action: 'support-test', status: 'ok', message: 'support bundle test event', home });

    const bundle = await buildSupportBundle({ home, auditLogLimit: 10, accessLogLimit: 10 });
    assert.equal(bundle.indexSummary.articleCount, 1, 'one article');
    assert.equal(bundle.indexSummary.attestationCount, 1, 'one attestation');
    assert.deepStrictEqual(bundle.indexSummary.topics, ['support-test'], 'topic captured');
    assert.deepStrictEqual(bundle.indexSummary.kinds, ['subject'], 'kind captured');
    assert.equal(bundle.indexSummary.authors.length, 1, 'one author');
    assert.equal(bundle.auditLog.entries.length >= 1, true, 'audit entries');
    assert.ok(bundle.auditLog.entries.some((e) => e.action === 'support-test'), 'custom audit event present');
    console.log('✓ Support bundle reflects published articles, attestations, and audit events');

    const markdown = supportBundleToMarkdown(bundle);
    assert.ok(markdown.includes('Articles: 1'), 'markdown article count');
    assert.ok(markdown.includes('Attestations: 1'), 'markdown attestation count');
    console.log('✓ Markdown reflects populated index');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

{
  // Redaction tests
  const sensitive = {
    apiKey: 'super-secret',
    nested: { token: 'nested-token', public: 'ok-value' },
    list: [{ password: 'list-secret' }],
    safe: 'visible',
    encryptionSeed: 'seed-value',
    config: {
      bundler: {
        apiKey: 'bundler-key'
      }
    }
  };
  const redacted = redactSecrets(sensitive);
  assert.equal(redacted.apiKey, '[REDACTED]', 'top-level apiKey redacted');
  assert.equal(redacted.nested.token, '[REDACTED]', 'nested token redacted');
  assert.equal(redacted.nested.public, 'ok-value', 'non-sensitive preserved');
  assert.equal(redacted.list[0].password, '[REDACTED]', 'array item redacted');
  assert.equal(redacted.safe, 'visible', 'safe value preserved');
  assert.equal(redacted.encryptionSeed, '[REDACTED]', 'encryptionSeed redacted');
  assert.equal(redacted.config.bundler.apiKey, '[REDACTED]', 'deeply nested apiKey redacted');
  console.log('✓ Secret redaction recursively masks sensitive keys');
}

{
  const home = tmpHome();
  try {
    initState();
    await ensureIdentity(home, { keyType: 'ed25519' });
    process.env.PERMABRAIN_SUPPORT_BUNDLE_TEST = 'value';
    const bundle = await buildSupportBundle({ home });
    assert.ok(bundle.environment.includes('PERMABRAIN_SUPPORT_BUNDLE_TEST'), 'env name captured');
    assert.ok(!Object.values(bundle.environment).includes('value'), 'env value not exposed');
    delete process.env.PERMABRAIN_SUPPORT_BUNDLE_TEST;
    console.log('✓ Environment variable names are captured without values');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

console.log('\n✅ Support bundle tests passed');
