/**
 * Encrypted article publish/get tests using local transport.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { api } from '../src/agent-api.mjs';
import { publishArticle, getArticle } from '../src/article.mjs';
import { initState } from '../src/config.mjs';
import * as pbcrypto from '../src/crypto.mjs';

function makeTempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-enc-'));
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

// --- publish-encrypted stores ciphertext and is decryptable by recipient ---
{
  const home = makeTempHome();
  await resetApi(home);
  const recipient = pbcrypto.generateEncryptionKeypair();
  const content = '# Secret\n\nThis is private.';
  const file = path.join(home, 'article.md');
  fs.writeFileSync(file, content);

  const result = await publishArticle({
    file,
    kind: 'subject',
    topic: 'secrets',
    sourceUrl: 'https://example.com/secret',
    encryptedFor: [recipient.publicKey]
  });

  assert.equal(result.encrypted, true, 'result should indicate encrypted');
  assert.ok(result.encryptionEnvelope, 'encryption envelope should exist');
  assert.equal(result.summary.key, 'subject/article');

  // Stored payload should be encrypted JSON envelope
  const { item } = result;
  assert.ok(pbcrypto.isEncryptedEnvelope(Buffer.from(item.payloadBase64 || '', 'base64url').toString('utf8')), 'payload should be encrypted envelope');

  // Author should be able to decrypt via derived key
  const identity = JSON.parse(fs.readFileSync(path.join(home, 'keys.json'), 'utf8'));
  const authorKeypair = pbcrypto.deriveEncryptionKeyFromEd25519(Buffer.from(identity.secretKey, 'base64url').subarray(0, 32));
  const encryptedPayload = Buffer.from(item.payloadBase64 || '', 'base64url').toString('utf8');
  const { content: decrypted } = await pbcrypto.decrypt(encryptedPayload, Buffer.from(authorKeypair.seed, 'base64url'));
  assert.equal(decrypted, content);

  fs.rmSync(home, { recursive: true, force: true });
}

// --- getArticle decrypts encrypted article when decryptSeed provided ---
{
  const home = makeTempHome();
  await resetApi(home);
  const recipient = pbcrypto.generateEncryptionKeypair();
  const content = '# Another Secret\n\nHidden body.';
  const file = path.join(home, 'article.md');
  fs.writeFileSync(file, content);

  const { summary } = await publishArticle({
    file,
    kind: 'subject',
    topic: 'secrets',
    sourceUrl: 'https://example.com/secret2',
    encryptedFor: [recipient.publicKey]
  });

  const identity = JSON.parse(fs.readFileSync(path.join(home, 'keys.json'), 'utf8'));
  const authorKeypair = pbcrypto.deriveEncryptionKeyFromEd25519(Buffer.from(identity.secretKey, 'base64url').subarray(0, 32));

  const got = await getArticle(summary.key, { decryptSeed: Buffer.from(authorKeypair.seed, 'base64url') });
  assert.equal(got.content, content);
  assert.equal(got.encrypted, true);

  fs.rmSync(home, { recursive: true, force: true });
}

// --- getArticle without decryptSeed throws for encrypted article ---
{
  const home = makeTempHome();
  await resetApi(home);
  const recipient = pbcrypto.generateEncryptionKeypair();
  const content = '# Secret3';
  const file = path.join(home, 'article.md');
  fs.writeFileSync(file, content);

  const { summary } = await publishArticle({
    file,
    kind: 'subject',
    topic: 'secrets',
    sourceUrl: 'https://example.com/secret3',
    encryptedFor: [recipient.publicKey]
  });

  await assert.rejects(
    () => getArticle(summary.key),
    /encrypted/
  );

  fs.rmSync(home, { recursive: true, force: true });
}

console.log('publish-encrypted tests passed');
