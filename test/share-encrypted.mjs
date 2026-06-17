/**
 * Test: Encrypted article sharing via ZenBin CAP pages
 *
 * Verifies encryption, HTML share page generation, page id derivation,
 * CLI wiring, agent API wrapper, and barrel exports. ZenBin publish calls
 * are mocked to avoid network dependency.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  shareEncryptedArticle,
  publishEncryptedShare,
  buildEncryptedSharePage,
  sharePageId,
  deriveAuthorEncryptionKeypair
} from '../src/share-encrypted.mjs';
import { api } from '../src/agent-api.mjs';
import { runCommand } from '../src/commands.mjs';
import * as pbcrypto from '../src/crypto.mjs';
import { computeFingerprint } from '../src/zenbin.mjs';

function tmpHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pb-share-'));
}

function resetApi(home) {
  api._home = home;
  api._config = null;
  api._identity = null;
}

async function initHome(home) {
  process.env.PERMABRAIN_HOME = home;
  await api.init({ keyType: 'ed25519' });
}

const SAMPLE_PRIVATE_JWK = {
  crv: 'Ed25519',
  d: 'uG4rsZfaMrp6OTQaWY9SyimcBLaUfi3R-FBcovTNuIQ',
  x: 'VNwCdReytqk_dtPgMOOTQn_wUaejDMTYjtC0ymPEhSg',
  kty: 'OKP'
};
const SAMPLE_KEY_ID = 'dev1-key';

console.log('1. buildEncryptedSharePage returns self-contained HTML with embedded envelope');
{
  const share = {
    title: 'Secret Notes',
    key: 'subject/secret-notes',
    kind: 'subject',
    topic: 'ai',
    agentId: 'ed25519:abc123',
    publishedAt: '2026-06-17T22:00:00Z',
    encryptedPayload: JSON.stringify({ v: 1, ephemeralPublicKey: 'abc', salt: 'def', iv: 'ghi', ciphertext: 'jkl', authTag: 'mno', recipients: [{ publicKeyFingerprint: 'fp1', encryptedKey: 'ek1' }] }),
    recipientFingerprints: ['fp1'],
    sourceUrl: 'https://example.com/source',
    recipientKeyId: 'recipient-fp'
  };
  const html = buildEncryptedSharePage(share);
  assert.ok(html.startsWith('<!DOCTYPE html>'));
  assert.ok(html.includes('Encrypted PermaBrain Share'));
  assert.ok(html.includes('subject/secret-notes'));
  assert.ok(html.includes('ed25519:abc123'));
  assert.ok(html.includes('fp1'));
  assert.ok(html.includes('recipient-fp'));
  assert.ok(html.includes('const DATA ='));
  assert.ok(html.includes('Decrypt in browser'));
  console.log('   ✓ Encrypted share page HTML generated');
}

console.log('2. sharePageId derives a stable slug from key, agent, and timestamp');
{
  const id = sharePageId('subject/secret-notes', 'ed25519:abc123', '2026-06-17T22:00:00.000Z');
  assert.ok(id.startsWith('pb-share-'));
  assert.ok(id.includes('subject-secret-notes'));
  assert.ok(id.includes('ed25519-abc123'));
  assert.ok(!id.includes(':'));
  assert.ok(!id.includes('.'));
  console.log('   ✓ sharePageId stable');
}

console.log('3. shareEncryptedArticle encrypts content and returns share metadata');
{
  const home = tmpHome();
  resetApi(home);
  await initHome(home);
  const recipient = pbcrypto.generateEncryptionKeypair();
  const content = 'This is a secret article for a specific recipient.';
  const result = await shareEncryptedArticle({
    home,
    content,
    kind: 'subject',
    topic: 'ai',
    key: 'subject/share-test',
    title: 'Share Test',
    sourceUrl: 'https://example.com/share-test',
    sourceName: 'Example',
    encryptedFor: [recipient.publicKey]
  });
  assert.ok(result.share.html.length > 1000);
  assert.equal(result.share.key, 'subject/share-test');
  assert.equal(result.share.title, 'Share Test');
  assert.equal(result.share.kind, 'subject');
  assert.equal(result.share.topic, 'ai');
  assert.ok(result.share.agentId.startsWith('ed25519:'));
  assert.equal(result.share.recipientFingerprints.length, 2); // recipient + author
  assert.ok(result.share.recipientFingerprints.includes(pbcrypto.x25519Fingerprint(pbcrypto.x25519PublicKeyFromBase64url(recipient.publicKey))));
  assert.equal(result.article, null);
  console.log('   ✓ Encrypted share prepared');
}

console.log('4. Decrypt the embedded payload with the recipient seed');
{
  const home = tmpHome();
  resetApi(home);
  await initHome(home);
  const recipient = pbcrypto.generateEncryptionKeypair();
  const content = 'Round-trip secret content.';
  const result = await shareEncryptedArticle({
    home,
    content,
    kind: 'subject',
    topic: 'ai',
    key: 'subject/round-trip',
    sourceUrl: 'https://example.com/round-trip',
    encryptedFor: [recipient.publicKey]
  });
  const seed = Buffer.from(recipient.seed, 'base64url');
  const { content: decrypted } = await pbcrypto.decrypt(result.share.encryptedPayload, seed);
  assert.equal(decrypted, content);
  console.log('   ✓ Recipient can decrypt share payload');
}

console.log('5. shareEncryptedArticle with alsoPublish creates an article DataItem');
{
  const home = tmpHome();
  resetApi(home);
  await initHome(home);
  const recipient = pbcrypto.generateEncryptionKeypair();
  const content = 'Shared and also published.';
  const result = await shareEncryptedArticle({
    home,
    content,
    kind: 'subject',
    topic: 'ai',
    key: 'subject/published-share',
    sourceUrl: 'https://example.com/published-share',
    encryptedFor: [recipient.publicKey],
    alsoPublish: true
  });
  assert.ok(result.article);
  assert.ok(result.article.id);
  assert.equal(result.article.key, 'subject/published-share');
  console.log('   ✓ Share with alsoPublish created article DataItem');
}

console.log('6. publishEncryptedShare calls ZenBin publishPage with CAP recipient');
{
  let called = null;
  const originalPublishPage = (await import('../src/zenbin.mjs')).publishPage;
  // Mock by replacing the module binding inside the share module via dynamic import would be invasive;
  // instead we test the higher-level api.shareEncrypted with a monkey-patched global fetch.
  const home = tmpHome();
  resetApi(home);
  await initHome(home);
  const recipient = pbcrypto.generateEncryptionKeypair();
  const content = 'ZenBin bound secret.';

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    called = { url, init };
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => JSON.stringify({ id: 'zenbin-page-123' })
    };
  };

  try {
    const result = await api.shareEncrypted({
      home,
      content,
      kind: 'subject',
      topic: 'ai',
      key: 'subject/zenbin-share',
      sourceUrl: 'https://example.com/zenbin-share',
      encryptedFor: [recipient.publicKey],
      recipientKeyId: pbcrypto.x25519Fingerprint(pbcrypto.x25519PublicKeyFromBase64url(recipient.publicKey)),
      keyId: SAMPLE_KEY_ID,
      privateJwk: SAMPLE_PRIVATE_JWK
    });
    assert.ok(called, 'ZenBin fetch was called');
    assert.ok(called.url.includes('zenbin.org'), 'called ZenBin URL');
    assert.equal(called.init.method, 'POST');
    assert.ok(called.init.headers['cap-recipient-key-id'], 'CAP recipient header set');
    assert.ok(result.zenbin);
    assert.equal(result.zenbin.pageId, 'zenbin-page-123');
    assert.ok(result.zenbin.url.includes('zenbin.org'));
  } finally {
    globalThis.fetch = originalFetch;
  }
  console.log('   ✓ ZenBin publish called with CAP recipient');
}

console.log('7. CLI share-encrypted command writes output file without ZenBin publish');
{
  const home = tmpHome();
  resetApi(home);
  await initHome(home);
  const recipient = pbcrypto.generateEncryptionKeypair();
  const file = path.join(home, 'article.md');
  fs.writeFileSync(file, 'CLI shared secret.', 'utf8');
  const output = path.join(home, 'share.html');
  const result = await runCommand('share-encrypted', {
    _: [file],
    kind: 'subject',
    topic: 'ai',
    'source-url': 'https://example.com/cli-share',
    for: recipient.publicKey,
    output,
    json: true
  });
  assert.ok(fs.existsSync(output));
  const html = fs.readFileSync(output, 'utf8');
  assert.ok(html.includes('Encrypted PermaBrain Share'));
  assert.ok(result);
  console.log('   ✓ CLI share-encrypted writes local HTML');
}

console.log('8. deriveAuthorEncryptionKeypair derives the same key for ed25519 identity');
{
  const home = tmpHome();
  resetApi(home);
  await initHome(home);
  const identity = (await import('../src/keys.mjs')).loadIdentity(home);
  const kp1 = await deriveAuthorEncryptionKeypair(identity);
  const kp2 = await deriveAuthorEncryptionKeypair(identity);
  assert.equal(kp1.publicKey, kp2.publicKey);
  assert.equal(kp1.seed, kp2.seed);
  assert.ok(kp1.fingerprint);
  console.log('   ✓ Author encryption keypair is deterministic');
}

console.log('\nOK All encrypted-share tests passed');
