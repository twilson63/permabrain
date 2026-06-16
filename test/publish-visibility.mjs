/**
 * Publish visibility mode tests: public, encrypted (author-only), encrypted with recipients.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { api } from '../src/agent-api.mjs';
import { publishArticle, getArticle } from '../src/article.mjs';
import { initState } from '../src/config.mjs';
import { runCommand } from '../src/commands.mjs';
import * as pbcrypto from '../src/crypto.mjs';

function makeTempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-vis-'));
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

function authorSeed(home) {
  const identity = JSON.parse(fs.readFileSync(path.join(home, 'keys.json'), 'utf8'));
  const authorKeypair = pbcrypto.deriveEncryptionKeyFromEd25519(Buffer.from(identity.secretKey, 'base64url').subarray(0, 32));
  return Buffer.from(authorKeypair.seed, 'base64url');
}

// --- api.publish with visibility=public stays plaintext ---
{
  const home = makeTempHome();
  await resetApi(home);
  const result = await api.publish({
    content: '# Public\n\nHello world.',
    kind: 'subject',
    topic: 'test',
    sourceUrl: 'https://example.com/public',
    title: 'Public Article',
    visibility: 'public'
  });
  assert.equal(result.encrypted, false);
  const tags = Object.fromEntries(result.item.tags?.map(t => [t.name, t.value]) || []);
  assert.equal(tags.Visibility, 'public');

  const got = await api.get(result.summary.key);
  assert.equal(got.content, '# Public\n\nHello world.');
  assert.equal(got.encrypted, false);
  fs.rmSync(home, { recursive: true, force: true });
}

// --- api.publish with visibility=encrypted encrypts author-only when no recipients ---
{
  const home = makeTempHome();
  await resetApi(home);
  const result = await api.publish({
    content: '# Author Only\n\nSecret.',
    kind: 'subject',
    topic: 'test',
    sourceUrl: 'https://example.com/author-only',
    title: 'Author Only Article',
    visibility: 'encrypted'
  });
  assert.equal(result.encrypted, true);
  assert.ok(result.encryptionEnvelope);
  const tags = Object.fromEntries(result.item.tags?.map(t => [t.name, t.value]) || []);
  assert.equal(tags.Visibility, 'encrypted');

  const seed = authorSeed(home);
  const got = await api.getAndDecrypt(result.summary.key);
  assert.equal(got.content, '# Author Only\n\nSecret.');
  assert.equal(got.encrypted, true);
  fs.rmSync(home, { recursive: true, force: true });
}

// --- publishArticle with --publish encrypted (CLI alias) and explicit recipients ---
{
  const home = makeTempHome();
  await resetApi(home);
  const recipient = pbcrypto.generateEncryptionKeypair();
  const content = '# Shared\n\nFor recipient.';
  const file = path.join(home, 'article.md');
  fs.writeFileSync(file, content);

  const result = await runCommand('publish', {
    _: [file],
    kind: 'subject',
    topic: 'test',
    'source-url': 'https://example.com/shared',
    publish: 'encrypted',
    for: recipient.publicKey,
    json: true
  });
  assert.equal(result.encrypted, true);
  assert.ok(result.encryptionEnvelope.recipients.some(r => r.publicKeyFingerprint === recipient.fingerprint));

  const seed = authorSeed(home);
  const got = await getArticle(result.summary.key, { decryptSeed: seed });
  assert.equal(got.content, content);
  fs.rmSync(home, { recursive: true, force: true });
}

// --- publish rejects invalid visibility ---
{
  const home = makeTempHome();
  await resetApi(home);
  const file = path.join(home, 'article.md');
  fs.writeFileSync(file, '# Bad');
  await assert.rejects(
    () => runCommand('publish', { _: [file], kind: 'subject', topic: 'test', 'source-url': 'https://example.com/bad', visibility: 'secret' }),
    /visibility must be public, encrypted, or private/
  );
  fs.rmSync(home, { recursive: true, force: true });
}

// --- encryptedFor infers encrypted visibility in publishArticle ---
{
  const home = makeTempHome();
  await resetApi(home);
  const recipient = pbcrypto.generateEncryptionKeypair();
  const content = '# Inferred\n\nAuto encrypted.';
  const file = path.join(home, 'article.md');
  fs.writeFileSync(file, content);

  const result = await publishArticle({
    file,
    kind: 'subject',
    topic: 'test',
    sourceUrl: 'https://example.com/inferred',
    encryptedFor: [recipient.publicKey]
  });
  assert.equal(result.encrypted, true);
  const tags = Object.fromEntries(result.item.tags?.map(t => [t.name, t.value]) || []);
  assert.equal(tags.Visibility, 'encrypted');

  fs.rmSync(home, { recursive: true, force: true });
}

console.log('publish-visibility tests passed');
