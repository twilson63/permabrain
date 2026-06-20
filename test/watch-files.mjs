/**
 * Test: file-system watch auto-publisher (src/watch-files.mjs)
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { api } from '../src/agent-api.mjs';
import { watchFiles, publishFilesOnce, watchFilesToMarkdown } from '../src/watch-files.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

function tmpHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-watch-files-'));
  process.env.PERMABRAIN_HOME = dir;
  return dir;
}

function cleanupHome(home) {
  try { fs.rmSync(home, { recursive: true, force: true }); } catch {}
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

console.log('1. publishFilesOnce dry-run');
{
  const home = tmpHome();
  await api.init({ keyType: 'ed25519', transport: 'local', home });
  const watchDir = path.join(home, 'notes');
  fs.mkdirSync(watchDir, { recursive: true });
  fs.writeFileSync(path.join(watchDir, 'hello.md'), '# Hello\n\nWorld.\n');

  const results = await publishFilesOnce({ dir: watchDir, dryRun: true, recursive: true, topic: 'test', kind: 'subject' });
  assert.equal(results.length, 1, 'one dry-run result');
  assert.equal(results[0].status, 'dry-run', 'dry-run status');
  assert.equal(results[0].key, 'subject/hello', 'key derived from filename');
  cleanupHome(home);
}
console.log('   ✓ dry-run works');

console.log('2. publishFilesOnce publishes existing files');
{
  const home = tmpHome();
  await api.init({ keyType: 'ed25519', transport: 'local', home });
  const watchDir = path.join(home, 'notes');
  fs.mkdirSync(path.join(watchDir, 'ai'), { recursive: true });
  fs.writeFileSync(path.join(watchDir, 'ai', 'intro.md'), '# Intro\n\nTo AI.\n');

  const results = await publishFilesOnce({ dir: watchDir, recursive: true, topic: 'test', kind: 'subject' });
  assert.equal(results.length, 1, 'one published file');
  assert.equal(results[0].status, 'published', 'published status');
  assert.equal(results[0].key, 'subject/intro', 'key derived from subdir/filename');
  assert.ok(results[0].id, 'has DataItem id');
  assert.equal(results[0].version, 1, 'first version');

  const markdown = watchFilesToMarkdown(results);
  assert.match(markdown, /# Auto-published files/);
  assert.match(markdown, /subject\/intro/);
  cleanupHome(home);
}
console.log('   ✓ one-shot publish works');

console.log('3. watchFiles detects a new file and publishes after debounce');
{
  const home = tmpHome();
  await api.init({ keyType: 'ed25519', transport: 'local', home });
  const watchDir = path.join(home, 'watch');
  fs.mkdirSync(watchDir, { recursive: true });

  const events = [];
  const { cancel, watched } = await watchFiles({
    dir: watchDir,
    recursive: false,
    topic: 'test',
    kind: 'subject',
    debounceMs: 100,
    onEvent: e => events.push(e)
  });

  assert.ok(Array.isArray(watched), 'returns watched paths');
  assert.ok(watched.includes(watchDir), 'watches the root dir');

  const ready = events.find(e => e.type === 'ready');
  assert.ok(ready, 'emits ready event');

  const file = path.join(watchDir, 'live.md');
  fs.writeFileSync(file, '# Live\n\nUpdated content.\n');

  let published;
  for (let i = 0; i < 30; i++) {
    published = events.find(e => e.type === 'publish' && e.file === file);
    if (published) break;
    await wait(200);
  }

  assert.ok(published, 'emits publish event for new file');
  assert.equal(published.key, 'subject/live', 'correct derived key');
  assert.ok(published.id, 'published id present');

  cancel();
  cleanupHome(home);
}
console.log('   ✓ live watch publishes new files');

console.log('4. watchFiles detects file modifications');
{
  const home = tmpHome();
  await api.init({ keyType: 'ed25519', transport: 'local', home });
  const watchDir = path.join(home, 'modify');
  fs.mkdirSync(watchDir, { recursive: true });
  const file = path.join(watchDir, 'draft.md');
  fs.writeFileSync(file, '# Draft\n\nFirst.\n');

  // Pre-publish so the watcher sees a version bump on modification.
  await api.watchFilesOnce({ dir: watchDir, recursive: false, topic: 'test', kind: 'subject' });

  const events = [];
  const { cancel } = await watchFiles({
    dir: watchDir,
    recursive: false,
    topic: 'test',
    kind: 'subject',
    debounceMs: 100,
    onEvent: e => events.push(e)
  });

  await wait(400);
  fs.writeFileSync(file, '# Draft\n\nSecond revision.\n');

  let found;
  for (let i = 0; i < 30; i++) {
    found = events.find(e => e.type === 'publish' && e.file === file && e.version === 2);
    if (found) break;
    await wait(200);
  }

  assert.ok(found, 'publishes second version after modification');
  assert.equal(found.version, 2, 'version bumped to 2');

  cancel();
  cleanupHome(home);
}
console.log('   ✓ modification triggers republication');

console.log('5. CLI help includes watch-files');
{
  const out = execSync('node scripts/cli.mjs watch-files --help', { cwd: repoRoot, encoding: 'utf8' });
  assert.match(out, /watch-files/);
  assert.match(out, /--dry-run/);
  assert.match(out, /--initial-publish/);
}
console.log('   ✓ CLI help present');

console.log('6. api.watchFilesOnce wrapper');
{
  const home = tmpHome();
  await api.init({ keyType: 'ed25519', transport: 'local', home });
  const watchDir = path.join(home, 'api-once');
  fs.mkdirSync(watchDir, { recursive: true });
  fs.writeFileSync(path.join(watchDir, 'api.md'), '# API\n\nWrapper test.\n');

  const results = await api.watchFilesOnce({ dir: watchDir, recursive: false, topic: 'test', kind: 'subject' });
  assert.equal(results.length, 1);
  assert.equal(results[0].status, 'published');
  cleanupHome(home);
}
console.log('   ✓ api.watchFilesOnce works');

console.log('\nAll watch-files tests passed.');
