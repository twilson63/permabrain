/**
 * Viewer crypto tests: verify browser-side decryption produces the same plaintext
 * as the server-side Node crypto module.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { api } from '../src/agent-api.mjs';
import { publishArticle } from '../src/article.mjs';
import { initState } from '../src/config.mjs';
import * as pbcrypto from '../src/crypto.mjs';

function makeTempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-viewer-crypto-'));
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

// --- viewer crypto module loads and exports expected functions ---
{
  const modPath = path.resolve('/home/node/.openclaw/workspace/permabrain/viewer/crypto.mjs');
  const mod = await import('file://' + modPath);
  assert.equal(typeof mod.viewerDecrypt, 'function');
  assert.equal(typeof mod.isEncryptedEnvelope, 'function');
  assert.equal(typeof mod.deriveX25519SeedFromEd25519, 'function');
  assert.equal(typeof mod.x25519Fingerprint, 'function');
}

// --- encrypted envelope detection works ---
{
  const { encryptedPayload } = await pbcrypto.encrypt('plain', [pbcrypto.generateEncryptionKeypair().publicKey]);
  const modPath = path.resolve('/home/node/.openclaw/workspace/permabrain/viewer/crypto.mjs');
  const mod = await import('file://' + modPath);
  assert.equal(mod.isEncryptedEnvelope(encryptedPayload), true);
  assert.equal(mod.isEncryptedEnvelope('plain text'), false);
  assert.equal(mod.isEncryptedEnvelope('# markdown'), false);
}

// --- viewerDecrypt matches Node decrypt for an author-derived key ---
{
  const home = makeTempHome();
  await resetApi(home);
  const content = '# Browser secret\n\nOnly for us.';
  const file = path.join(home, 'article.md');
  fs.writeFileSync(file, content);

  const { summary } = await publishArticle({
    file,
    kind: 'subject',
    topic: 'secrets',
    sourceUrl: 'https://example.com/browser',
    key: 'subject/browser-secret',
    encryptedFor: [pbcrypto.generateEncryptionKeypair().publicKey]
  });

  // Read the stored payload from local cache
  const item = JSON.parse(fs.readFileSync(path.join(home, 'cache', 'objects', summary.id + '.json'), 'utf8'));
  const payload = Buffer.from(item.payloadBase64, 'base64url').toString('utf8');
  const identity = JSON.parse(fs.readFileSync(path.join(home, 'keys.json'), 'utf8'));
  const authorKeypair = pbcrypto.deriveEncryptionKeyFromEd25519(Buffer.from(identity.secretKey, 'base64url').subarray(0, 32));
  const seed = authorKeypair.seed;

  // Node-side reference decrypt
  const nodeDecrypted = await pbcrypto.decrypt(payload, Buffer.from(seed, 'base64url'));
  assert.equal(nodeDecrypted.content, content);

  // Browser-side decrypt via Web Crypto helper
  const modPath = path.resolve('/home/node/.openclaw/workspace/permabrain/viewer/crypto.mjs');
  const mod = await import('file://' + modPath);
  const browserDecrypted = await mod.viewerDecrypt(payload, seed);
  assert.equal(browserDecrypted, content);

  fs.rmSync(home, { recursive: true, force: true });
}

// --- viewerDecrypt fails with wrong seed ---
{
  const { encryptedPayload } = await pbcrypto.encrypt('secret', [pbcrypto.generateEncryptionKeypair().publicKey]);
  const wrong = pbcrypto.generateEncryptionKeypair().seed;
  const modPath = path.resolve('/home/node/.openclaw/workspace/permabrain/viewer/crypto.mjs');
  const mod = await import('file://' + modPath);
  await assert.rejects(
    () => mod.viewerDecrypt(encryptedPayload, wrong),
    /Recipient not found in envelope/
  );
}

console.log('viewer-crypto tests passed');
