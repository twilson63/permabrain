import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';

import { api } from '../src/agent-api.mjs';
import { createBackup, listBackups, restoreBackup, pruneBackups, backupsToMarkdown } from '../src/backup.mjs';
import { archive, restore } from '../src/archive.mjs';
import { initState, defaultConfig } from '../src/config.mjs';
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

// --- 1. createBackup stores an archive in PERMABRAIN_HOME/backups ---
{
  const home = tmpDir('permabrain-backup-');
  resetApi(home);
  setupLocalHome(home);
  const { identity } = await ensureIdentity(home, { keyType: 'ed25519' });

  await publishArticle({
    content: 'Backup test article',
    kind: 'subject',
    topic: 'backup-test',
    key: 'subject/backup-test',
    title: 'Backup Test',
    sourceUrl: 'https://example.com/backup'
  });

  const passphrase = 'correct horse battery staple';
  const result = await createBackup(home, { passphrase });
  assert.equal(result.home, home);
  assert.ok(result.name.endsWith('.json'));
  assert.equal(result.meta.agentId, identity.agentId);
  assert.ok(fs.existsSync(result.path), 'backup file created');
  assert.ok(fs.existsSync(path.join(home, 'backups')), 'backups dir created');

  fs.rmSync(home, { recursive: true, force: true });
  console.log('1. createBackup stores archive');
}

// --- 2. listBackups returns metadata newest-first ---
{
  const home = tmpDir('permabrain-backup-list-');
  resetApi(home);
  setupLocalHome(home);
  await ensureIdentity(home, { keyType: 'ed25519' });

  const a = await createBackup(home, { passphrase: 'p1', name: 'a.json' });
  // Force different timestamp for ordering
  await new Promise((r) => setTimeout(r, 50));
  const b = await createBackup(home, { passphrase: 'p2', name: 'b.json' });

  const list = listBackups(home);
  assert.equal(list.length, 2);
  assert.equal(list[0].name, 'b.json');
  assert.equal(list[1].name, 'a.json');
  assert.equal(list[0].entries, b.meta.entries);

  fs.rmSync(home, { recursive: true, force: true });
  console.log('2. listBackups newest-first');
}

// --- 3. restoreBackup restores from stored backup by name ---
{
  const home = tmpDir('permabrain-backup-restore-');
  resetApi(home);
  setupLocalHome(home);
  const { identity } = await ensureIdentity(home, { keyType: 'ed25519' });

  await publishArticle({
    content: 'Restore me',
    kind: 'subject',
    topic: 'backup-restore',
    key: 'subject/restore-me',
    title: 'Restore Me',
    sourceUrl: 'https://example.com/restore'
  });

  const passphrase = 'restore passphrase';
  const result = await createBackup(home, { passphrase, name: 'restore.json' });

  // Wipe home and restore
  for (const f of fs.readdirSync(home)) {
    if (f === 'backups') continue;
    const p = path.join(home, f);
    fs.rmSync(p, { recursive: true, force: true });
  }
  assert.ok(!fs.existsSync(path.join(home, 'keys.json')), 'keys removed before restore');

  const restoreResult = await restoreBackup(home, { backup: 'restore.json', passphrase });
  assert.equal(restoreResult.dryRun, false);
  assert.ok(restoreResult.entriesRestored > 0);
  assert.ok(fs.existsSync(path.join(home, 'keys.json')), 'keys restored');
  const restoredKeys = JSON.parse(fs.readFileSync(path.join(home, 'keys.json'), 'utf8'));
  assert.equal(restoredKeys.agentId, identity.agentId);

  fs.rmSync(home, { recursive: true, force: true });
  console.log('3. restoreBackup by name');
}

// --- 4. restoreBackup by 1-based index ---
{
  const home = tmpDir('permabrain-backup-idx-');
  resetApi(home);
  setupLocalHome(home);
  await ensureIdentity(home, { keyType: 'ed25519' });

  await createBackup(home, { passphrase: 'idx', name: 'old.json' });
  await new Promise((r) => setTimeout(r, 50));
  await createBackup(home, { passphrase: 'idx', name: 'new.json' });

  const result = await restoreBackup(home, { backup: '1', passphrase: 'idx' });
  assert.equal(result.backup, 'new.json');

  fs.rmSync(home, { recursive: true, force: true });
  console.log('4. restoreBackup by index');
}

// --- 5. pruneBackups keeps newest N ---
{
  const home = tmpDir('permabrain-backup-prune-');
  resetApi(home);
  setupLocalHome(home);
  await ensureIdentity(home, { keyType: 'ed25519' });

  for (let i = 0; i < 5; i++) {
    await createBackup(home, { passphrase: `p${i}`, name: `${i}.json` });
    await new Promise((r) => setTimeout(r, 30));
  }

  const result = pruneBackups(home, { keep: 3 });
  assert.equal(result.kept.length, 3);
  assert.equal(result.removed.length, 2);
  assert.ok(!fs.existsSync(path.join(home, 'backups', '0.json')));
  assert.ok(!fs.existsSync(path.join(home, 'backups', '1.json')));
  assert.ok(fs.existsSync(path.join(home, 'backups', '4.json')));

  fs.rmSync(home, { recursive: true, force: true });
  console.log('5. pruneBackups keep N');
}

// --- 6. pruneBackups dryRun does not delete ---
{
  const home = tmpDir('permabrain-backup-prune-dry-');
  resetApi(home);
  setupLocalHome(home);
  await ensureIdentity(home, { keyType: 'ed25519' });

  await createBackup(home, { passphrase: 'dry', name: 'only.json' });
  const result = pruneBackups(home, { keep: 0, dryRun: true });
  assert.equal(result.removed.length, 1);
  assert.ok(fs.existsSync(path.join(home, 'backups', 'only.json')), 'dry-run preserves file');

  fs.rmSync(home, { recursive: true, force: true });
  console.log('6. pruneBackups dry-run');
}

// --- 7. pruneBackups maxAgeDays ---
{
  const home = tmpDir('permabrain-backup-age-');
  resetApi(home);
  setupLocalHome(home);
  await ensureIdentity(home, { keyType: 'ed25519' });

  await createBackup(home, { passphrase: 'age', name: 'fresh.json' });
  const stale = path.join(home, 'backups', 'stale.json');
  fs.writeFileSync(stale, JSON.stringify({ version: 'permabrain-archive/1.0.0', createdAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(), agentId: 'x', encryption: { hasPassphrase: false, recipientCount: 0 }, entries: [] }));

  const result = pruneBackups(home, { keep: 10, maxAgeDays: 30 });
  assert.ok(result.removed.some((b) => b.name === 'stale.json'));
  assert.ok(!fs.existsSync(stale));

  fs.rmSync(home, { recursive: true, force: true });
  console.log('7. pruneBackups maxAgeDays');
}

// --- 8. api.backup() wrapper ---
{
  const home = tmpDir('permabrain-backup-api-');
  resetApi(home);
  setupLocalHome(home);
  await api.init({ keyType: 'ed25519', transport: 'local' });

  const result = await api.backup({ passphrase: 'api backup', name: 'api.json' });
  assert.equal(result.name, 'api.json');
  assert.ok(fs.existsSync(result.path));

  const list = api.listBackups();
  assert.ok(list.some((b) => b.name === 'api.json'));

  fs.rmSync(home, { recursive: true, force: true });
  console.log('8. api.backup wrapper');
}

// --- 9. api.restoreBackup() wrapper ---
{
  const home = tmpDir('permabrain-backup-api-restore-');
  resetApi(home);
  setupLocalHome(home);
  await api.init({ keyType: 'ed25519', transport: 'local' });
  await publishArticle({
    content: 'API restore',
    kind: 'subject',
    topic: 'backup-api',
    key: 'subject/api-restore',
    title: 'API Restore',
    sourceUrl: 'https://example.com/api-restore'
  });

  await api.backup({ passphrase: 'restore', name: 'restore.json' });
  fs.rmSync(path.join(home, 'keys.json'), { force: true });

  const result = await api.restoreBackup({ backup: 'restore.json', passphrase: 'restore' });
  assert.equal(result.backup, 'restore.json');
  assert.ok(fs.existsSync(path.join(home, 'keys.json')));

  fs.rmSync(home, { recursive: true, force: true });
  console.log('9. api.restoreBackup wrapper');
}

// --- 10. barrel exports backup functions ---
{
  const { createBackup: cb, listBackups: lb, restoreBackup: rb, pruneBackups: pb, backupsToMarkdown: btm } = await import('../src/index.mjs');
  assert.equal(typeof cb, 'function');
  assert.equal(typeof lb, 'function');
  assert.equal(typeof rb, 'function');
  assert.equal(typeof pb, 'function');
  assert.equal(typeof btm, 'function');
  console.log('10. barrel exports backup functions');
}

// --- 11. CLI backup command help ---
{
  const cliPath = path.resolve(import.meta.dirname, '../scripts/cli.mjs');
  const help = execSync(`node ${cliPath} backup --help`, { encoding: 'utf8' });
  assert.match(help, /backup/);
  assert.match(help, /create/);
  assert.match(help, /list/);
  assert.match(help, /restore/);
  assert.match(help, /prune/);
  console.log('11. CLI backup help');
}

// --- 12. CLI backup create/list/restore/prune ---
{
  const home = tmpDir('permabrain-backup-cli-');
  resetApi(home);
  setupLocalHome(home);
  await ensureIdentity(home, { keyType: 'ed25519' });

  const cliPath = path.resolve(import.meta.dirname, '../scripts/cli.mjs');

  const createOut = execSync(`node ${cliPath} backup create --passphrase cli --name cli.json --json`, { encoding: 'utf8', env: { ...process.env, PERMABRAIN_HOME: home } });
  const createJson = JSON.parse(createOut);
  assert.equal(createJson.name, 'cli.json');

  const listOut = execSync(`node ${cliPath} backup list --json`, { encoding: 'utf8', env: { ...process.env, PERMABRAIN_HOME: home } });
  const listJson = JSON.parse(listOut);
  assert.equal(listJson.backups.length, 1);

  fs.rmSync(path.join(home, 'keys.json'), { force: true });
  const restoreOut = execSync(`node ${cliPath} backup restore 1 --passphrase cli --json`, { encoding: 'utf8', env: { ...process.env, PERMABRAIN_HOME: home } });
  const restoreJson = JSON.parse(restoreOut);
  assert.equal(restoreJson.backup, 'cli.json');
  assert.ok(fs.existsSync(path.join(home, 'keys.json')));

  const pruneOut = execSync(`node ${cliPath} backup prune --keep 0 --dry-run --json`, { encoding: 'utf8', env: { ...process.env, PERMABRAIN_HOME: home } });
  const pruneJson = JSON.parse(pruneOut);
  assert.equal(pruneJson.removed.length, 1);
  assert.ok(fs.existsSync(path.join(home, 'backups', 'cli.json')));

  fs.rmSync(home, { recursive: true, force: true });
  console.log('12. CLI backup create/list/restore/prune');
}

// --- 13. archive/restore aliases preserved ---
{
  const home = tmpDir('permabrain-backup-aliases-');
  resetApi(home);
  setupLocalHome(home);
  await ensureIdentity(home, { keyType: 'ed25519' });
  const ar = await archive({ home, passphrase: 'alias' });
  const result = await restore(ar, { home, passphrase: 'alias', dryRun: true });
  assert.equal(result.dryRun, true);
  assert.ok(result.entriesRestored > 0);
  fs.rmSync(home, { recursive: true, force: true });
  console.log('13. archive/restore aliases preserved');
}

// --- 14. backupsToMarkdown renders table ---
{
  const fake = [{
    name: 'backup-20260101-120000.json',
    createdAt: '2026-01-01T12:00:00.000Z',
    agentId: 'ed25519:abc',
    entries: 5,
    hasPassphrase: true,
    recipientCount: 1,
    size: 2048
  }];
  const md = backupsToMarkdown(fake, { home: '/tmp/x' });
  assert.match(md, /PermaBrain Backups/);
  assert.match(md, /backup-20260101-120000/);
  assert.match(md, /ed25519:abc/);
  console.log('14. backupsToMarkdown');
}

console.log('\n✅ All backup tests passed');
