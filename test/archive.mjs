import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';

import { api } from '../src/agent-api.mjs';
import { archive, restore, createArchive } from '../src/archive.mjs';
import { initState, statePaths, defaultConfig } from '../src/config.mjs';
import { ensureIdentity } from '../src/keys.mjs';
import { publishArticle } from '../src/article.mjs';

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function setupLocalHome(home) {
  fs.mkdirSync(path.join(home, 'cache', 'objects'), { recursive: true });
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ ...defaultConfig(), transport: 'local', gateway: { type: 'local' }, bundler: { type: 'local' } }, null, 2) + '\n');
}

function resetApi(home) {
  api._home = null;
  api._identity = null;
  api._config = null;
  process.env.PERMABRAIN_HOME = home;
}

// --- 1. createArchive returns the expected structure ---
{
  const home = tmpDir('permabrain-archive-');
  resetApi(home);
  setupLocalHome(home);
  const { identity } = await ensureIdentity(home, { keyType: 'ed25519' });

  await publishArticle({
    content: 'Archive test article',
    kind: 'subject',
    topic: 'archive-test',
    key: 'subject/archive-test',
    title: 'Archive Test',
    sourceUrl: 'https://example.com/archive'
  });

  const passphrase = 'correct horse battery staple';
  const ar = await createArchive({ home, passphrase });
  assert.equal(ar.version, 'permabrain-archive/1.0.0', 'archive version');
  assert.equal(ar.agentId, identity.agentId, 'archive agentId');
  assert.equal(ar.encryption.hasPassphrase, true, 'archive hasPassphrase');
  assert.equal(ar.encryption.recipientCount, 1, 'one recipient');
  assert.ok(ar.entries.some((e) => e.path === 'keys.json'), 'archive includes keys.json');
  assert.ok(ar.entries.some((e) => e.path === 'identity-init.json'), 'archive includes identity-init.json');
  assert.ok(ar.entries.some((e) => e.path === 'config.json'), 'archive includes config.json');
  assert.ok(ar.entries.some((e) => e.path === 'cache/index.json'), 'archive includes cache/index.json');
  assert.ok(ar.entries.some((e) => e.path.startsWith('cache/objects/')), 'archive includes object files');
  assert.ok(!ar.entries.some((e) => e.path.startsWith('cache/pages/')), 'archive excludes plaintext pages');

  fs.rmSync(home, { recursive: true, force: true });
  console.log('1. createArchive structure');
}

// --- 2. restore decrypts and writes files into a fresh home ---
{
  const home = tmpDir('permabrain-archive-');
  resetApi(home);
  setupLocalHome(home);
  const { identity } = await ensureIdentity(home, { keyType: 'ed25519' });

  await publishArticle({
    content: 'Archive test article',
    kind: 'subject',
    topic: 'archive-test',
    key: 'subject/archive-test',
    title: 'Archive Test',
    sourceUrl: 'https://example.com/archive'
  });

  const passphrase = 'correct horse battery staple';
  const ar = await archive({ home, passphrase });

  const target = tmpDir('permabrain-restore-');
  const result = await restore(ar, { home: target, passphrase });
  assert.equal(result.dryRun, false, 'restore dryRun false');
  assert.ok(result.entriesRestored > 0, 'entries restored');
  assert.ok(fs.existsSync(path.join(target, 'keys.json')), 'keys.json restored');
  assert.ok(fs.existsSync(path.join(target, 'identity-init.json')), 'identity-init.json restored');
  assert.ok(fs.existsSync(path.join(target, 'config.json')), 'config.json restored');
  assert.ok(fs.existsSync(path.join(target, 'cache', 'index.json')), 'cache/index.json restored');

  const restoredKeys = JSON.parse(fs.readFileSync(path.join(target, 'keys.json'), 'utf8'));
  assert.equal(restoredKeys.agentId, identity.agentId, 'restored identity matches');

  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(target, { recursive: true, force: true });
  console.log('2. restore into fresh home');
}

// --- 3. restore dryRun validates without writing files ---
{
  const home = tmpDir('permabrain-archive-dryrun-');
  resetApi(home);
  setupLocalHome(home);
  await ensureIdentity(home, { keyType: 'ed25519' });

  const passphrase = 'dryrun secret';
  const ar = await createArchive({ home, passphrase });

  const target = tmpDir('permabrain-restore-dryrun-');
  const result = await restore(ar, { home: target, passphrase, dryRun: true });
  assert.equal(result.dryRun, true, 'dryRun true');
  assert.equal(result.entriesRestored, ar.entries.length, 'dryRun reports all entries');
  assert.ok(!fs.existsSync(path.join(target, 'keys.json')), 'dryRun did not write files');

  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(target, { recursive: true, force: true });
  console.log('3. restore dry-run');
}

// --- 4. api.archive() and api.restore() wrappers work ---
{
  const home = tmpDir('permabrain-archive-api-');
  resetApi(home);
  setupLocalHome(home);
  await api.init({ keyType: 'ed25519', transport: 'local' });

  await api.publish({
    content: '# API Archive\n\nBody.',
    kind: 'subject',
    topic: 'archive-api-test',
    sourceUrl: 'https://example.com/api-archive',
    title: 'API Archive',
    key: 'subject/api-archive'
  });

  const passphrase = 'api archive passphrase';
  const ar = await api.archive({ passphrase });
  assert.equal(ar.version, 'permabrain-archive/1.0.0');
  assert.equal(ar.encryption.hasPassphrase, true);

  const target = tmpDir('permabrain-restore-api-');
  const result = await api.restore(ar, { home: target, passphrase });
  assert.equal(result.dryRun, false);
  assert.ok(result.entriesRestored > 0);
  assert.ok(fs.existsSync(path.join(target, 'keys.json')));

  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(target, { recursive: true, force: true });
  console.log('4. api.archive() / api.restore() wrappers');
}

// --- 5. Archive includes optional remotes and watch state when present ---
{
  const home = tmpDir('permabrain-archive-extras-');
  resetApi(home);
  setupLocalHome(home);
  await ensureIdentity(home, { keyType: 'ed25519' });

  fs.writeFileSync(path.join(home, 'remotes.json'), JSON.stringify({ remotes: {}, defaultRemote: null }) + '\n');
  fs.writeFileSync(path.join(home, 'cache', 'watch-state.json'), JSON.stringify({ seen: {} }) + '\n');

  const passphrase = 'extras passphrase';
  const ar = await archive({ home, passphrase });
  assert.ok(ar.entries.some((e) => e.path === 'remotes.json'), 'archive includes remotes.json');
  assert.ok(ar.entries.some((e) => e.path === 'cache/watch-state.json'), 'archive includes watch-state.json');

  fs.rmSync(home, { recursive: true, force: true });
  console.log('5. archive optional files');
}

// --- 6. restore with current identity fallback (no passphrase) ---
{
  const home = tmpDir('permabrain-archive-author-');
  resetApi(home);
  setupLocalHome(home);
  const { identity } = await ensureIdentity(home, { keyType: 'ed25519' });

  const passphrase = 'author fallback passphrase';
  const ar = await archive({ home, passphrase });

  // Move to fresh home carrying only the same identity keys.json
  const target = tmpDir('permabrain-restore-author-');
  fs.mkdirSync(path.join(target, 'cache', 'objects'), { recursive: true });
  fs.writeFileSync(path.join(target, 'keys.json'), JSON.stringify(identity, null, 2) + '\n');

  const result = await restore(ar, { home: target });
  assert.equal(result.dryRun, false);
  assert.ok(result.entriesRestored > 0);
  assert.ok(fs.existsSync(path.join(target, 'config.json')), 'config restored via author key');

  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(target, { recursive: true, force: true });
  console.log('6. restore with author identity fallback');
}

// --- 7. CLI archive and restore commands are registered and documented ---
{
  const cliPath = path.resolve(import.meta.dirname, '../scripts/cli.mjs');
  const archiveHelp = execSync(`node ${cliPath} archive --help`, { encoding: 'utf8' });
  assert.match(archiveHelp, /archive/);
  assert.match(archiveHelp, /passphrase/);

  const restoreHelp = execSync(`node ${cliPath} restore --help`, { encoding: 'utf8' });
  assert.match(restoreHelp, /restore/);
  assert.match(restoreHelp, /file/);
  console.log('7. CLI archive/restore help');
}

// --- 8. barrel exports archive and restore ---
{
  const { archive: barrelArchive, restore: barrelRestore } = await import('../src/index.mjs');
  assert.equal(typeof barrelArchive, 'function');
  assert.equal(typeof barrelRestore, 'function');
  console.log('8. index.mjs exports archive and restore');
}

// --- 9. archive requires a passphrase or recipient ---
{
  const home = tmpDir('permabrain-archive-nokey-');
  resetApi(home);
  setupLocalHome(home);
  await ensureIdentity(home, { keyType: 'ed25519' });

  try {
    await archive({ home });
    assert.fail('should throw when no passphrase/recipient');
  } catch (err) {
    assert.match(err.message, /passphrase|recipient/i);
  }

  fs.rmSync(home, { recursive: true, force: true });
  console.log('9. archive requires key');
}

console.log('\n✅ All archive tests passed');
