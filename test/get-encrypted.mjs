/**
 * Encrypted article read-path tests: api.getAndDecrypt + CLI get-encrypted.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { api } from '../src/agent-api.mjs';
import { publishArticle, getArticle } from '../src/article.mjs';
import { initState } from '../src/config.mjs';
import * as pbcrypto from '../src/crypto.mjs';

function makeTempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-get-enc-'));
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

function cli(args, env = {}) {
  const result = spawnSync(
    process.execPath,
    ['scripts/cli.mjs', ...args],
    {
      cwd: '/home/node/.openclaw/workspace/permabrain',
      encoding: 'utf8',
      env: { ...process.env, ...env }
    }
  );
  return { stdout: result.stdout, stderr: result.stderr, status: result.status };
}

// --- api.getAndDecrypt auto-derives author seed and decrypts ---
{
  const home = makeTempHome();
  await resetApi(home);
  const content = '# Auto-decrypt\n\nHidden by default.';
  const file = path.join(home, 'article.md');
  fs.writeFileSync(file, content);

  const { summary } = await publishArticle({
    file,
    kind: 'subject',
    topic: 'secrets',
    sourceUrl: 'https://example.com/auto',
    encryptedFor: [pbcrypto.generateEncryptionKeypair().publicKey]
  });

  const got = await api.getAndDecrypt(summary.key);
  assert.equal(got.content, content);
  assert.equal(got.encrypted, true);
  assert.equal(got.key, summary.key);

  fs.rmSync(home, { recursive: true, force: true });
}

// --- api.getAndDecrypt accepts an explicit recipient seed ---
{
  const home = makeTempHome();
  await resetApi(home);
  const recipient = pbcrypto.generateEncryptionKeypair();
  const content = '# Explicit seed\n\nFor a recipient.';
  const file = path.join(home, 'article.md');
  fs.writeFileSync(file, content);

  const { summary } = await publishArticle({
    file,
    kind: 'subject',
    topic: 'secrets',
    sourceUrl: 'https://example.com/explicit',
    encryptedFor: [recipient.publicKey]
  });

  const got = await api.getAndDecrypt(summary.key, {
    decryptSeed: Buffer.from(recipient.seed, 'base64url')
  });
  assert.equal(got.content, content);
  assert.equal(got.encrypted, true);

  fs.rmSync(home, { recursive: true, force: true });
}

// --- api.getAndDecrypt throws when current identity is not a recipient ---
{
  const authorHome = makeTempHome();
  const readerHome = makeTempHome();
  const outsider = pbcrypto.generateEncryptionKeypair();
  const content = '# Outsider\n\nNot for this agent.';

  await resetApi(authorHome);
  const file = path.join(authorHome, 'article.md');
  fs.writeFileSync(file, content);
  const { summary } = await publishArticle({
    file,
    kind: 'subject',
    topic: 'secrets',
    sourceUrl: 'https://example.com/outsider',
    encryptedFor: [outsider.publicKey]
  });

  // Copy published object + index to reader home so local transport can find it
  fs.mkdirSync(path.join(readerHome, 'cache', 'objects'), { recursive: true });
  fs.cpSync(path.join(authorHome, 'cache', 'objects'), path.join(readerHome, 'cache', 'objects'), { recursive: true });
  fs.cpSync(path.join(authorHome, 'cache', 'index.json'), path.join(readerHome, 'cache', 'index.json'));

  await resetApi(readerHome);
  await assert.rejects(
    () => api.getAndDecrypt(summary.key),
    /not found in envelope|Recipient/
  );

  fs.rmSync(authorHome, { recursive: true, force: true });
  fs.rmSync(readerHome, { recursive: true, force: true });
}

// --- CLI get-encrypted auto-derives author seed ---
{
  const home = makeTempHome();
  await resetApi(home);
  const content = '# CLI secret\n\nReadable by author.';
  const file = path.join(home, 'article.md');
  fs.writeFileSync(file, content);

  const pub = cli([
    'publish-encrypted', file,
    '--kind', 'subject',
    '--topic', 'secrets',
    '--source-url', 'https://example.com/cli',
    '--key', 'subject/cli-secret',
    '--for', pbcrypto.generateEncryptionKeypair().publicKey
  ], { PERMABRAIN_HOME: home, PERMABRAIN_TRANSPORT: 'local' });

  assert.equal(pub.status, 0, `publish-encrypted failed: ${pub.stderr}`);

  const key = 'subject/cli-secret';
  const get = cli(['get-encrypted', key], { PERMABRAIN_HOME: home, PERMABRAIN_TRANSPORT: 'local' });
  assert.equal(get.status, 0, `get-encrypted failed: ${get.stderr}`);
  assert.equal(get.stdout.trim(), content);

  fs.rmSync(home, { recursive: true, force: true });
}

// --- CLI get-encrypted accepts --seed-file ---
{
  const home = makeTempHome();
  await resetApi(home);
  const recipient = pbcrypto.generateEncryptionKeypair();
  const content = '# Seed file\n\nRecipient via file.';
  const file = path.join(home, 'article.md');
  fs.writeFileSync(file, content);

  const { summary } = await publishArticle({
    file,
    kind: 'subject',
    topic: 'secrets',
    sourceUrl: 'https://example.com/seedfile',
    encryptedFor: [recipient.publicKey]
  });

  const seedFile = path.join(home, 'seed.txt');
  fs.writeFileSync(seedFile, recipient.seed);

  const get = cli(
    ['get-encrypted', summary.key, '--seed-file', seedFile, '--json'],
    { PERMABRAIN_HOME: home, PERMABRAIN_TRANSPORT: 'local' }
  );
  assert.equal(get.status, 0, `get-encrypted --seed-file failed: ${get.stderr}`);
  const json = JSON.parse(get.stdout);
  assert.equal(json.content, content);
  assert.equal(json.encrypted, true);

  fs.rmSync(home, { recursive: true, force: true });
}

// --- CLI get-encrypted fails gracefully when reader identity is not a recipient ---
{
  const authorHome = makeTempHome();
  const readerHome = makeTempHome();
  const outsider = pbcrypto.generateEncryptionKeypair();
  const content = '# No seed\n\nNo access.';

  await resetApi(authorHome);
  const file = path.join(authorHome, 'article.md');
  fs.writeFileSync(file, content);
  const { summary } = await publishArticle({
    file,
    kind: 'subject',
    topic: 'secrets',
    sourceUrl: 'https://example.com/noseed',
    encryptedFor: [outsider.publicKey]
  });

  // Copy published object + index to reader home so local transport can find it
  fs.mkdirSync(path.join(readerHome, 'cache', 'objects'), { recursive: true });
  fs.cpSync(path.join(authorHome, 'cache', 'objects'), path.join(readerHome, 'cache', 'objects'), { recursive: true });
  fs.cpSync(path.join(authorHome, 'cache', 'index.json'), path.join(readerHome, 'cache', 'index.json'));

  const get = cli(['get-encrypted', summary.key], { PERMABRAIN_HOME: readerHome, PERMABRAIN_TRANSPORT: 'local' });
  assert.notEqual(get.status, 0, 'get-encrypted should fail when not a recipient');
  assert.ok(/not found in envelope|Recipient|decrypt/i.test(get.stderr), `expected decryption error, got: ${get.stderr}`);

  fs.rmSync(authorHome, { recursive: true, force: true });
  fs.rmSync(readerHome, { recursive: true, force: true });
}

console.log('get-encrypted tests passed');
