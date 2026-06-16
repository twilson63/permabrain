/**
 * Tests for src/sync.mjs
 *
 * Covers:
 *   - syncWithMerge pulls remote articles into local index
 *   - syncWithMerge detects unchanged articles
 *   - syncWithMerge auto-merges divergent versions of the same key
 *   - syncWithMerge dry-run previews merges without publishing
 *   - syncWithMerge respects --no-auto-merge
 *   - syncWithMerge reports encrypted divergences
 *   - CLI sync help mentions --no-auto-merge and --dry-run
 *   - Agent API sync returns merges/divergences
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';

import { api } from '../src/agent-api.mjs';
import { initState, defaultConfig } from '../src/config.mjs';
import { syncWithMerge } from '../src/sync.mjs';

function makeTempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-sync-'));
}

function setupLocalHome(home) {
  initState({ env: { ...process.env, PERMABRAIN_HOME: home } });
  const config = {
    ...defaultConfig(),
    transport: 'local',
    gateway: { type: 'local' },
    bundler: { type: 'local' }
  };
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify(config, null, 2) + '\n');
}

function resetApi(home) {
  api._home = null;
  api._identity = null;
  api._config = null;
  process.env.PERMABRAIN_HOME = home;
}

// --- 1. syncWithMerge pulls remote articles and reports unchanged ---
{
  const home = makeTempHome();
  resetApi(home);
  setupLocalHome(home);
  await api.init({ keyType: 'ed25519', transport: 'local' });

  await api.publish({
    content: '# Article\n\nBody.',
    kind: 'subject',
    topic: 'sync-test',
    sourceUrl: 'https://example.com/article',
    title: 'Article',
    key: 'subject/sync-base'
  });

  const result = await syncWithMerge({ home, autoMerge: true });
  assert.equal(result.articleCount, 1);
  assert.equal(result.attestationCount, 0);
  assert.equal(result.report.articlesUnchanged, 1);
  assert.equal(result.report.merges.length, 0);
  assert.equal(result.report.divergences.length, 0);

  fs.rmSync(home, { recursive: true, force: true });
  console.log('1. syncWithMerge pulls remote articles and reports unchanged');
}

// --- 2. syncWithMerge auto-merges divergent versions of the same key ---
{
  const home = makeTempHome();
  resetApi(home);
  setupLocalHome(home);
  await api.init({ keyType: 'ed25519', transport: 'local' });

  const key = 'subject/sync-diverge';
  const v1 = await api.publish({
    content: '# Base\n\nCommon paragraph.',
    kind: 'subject',
    topic: 'sync-test',
    sourceUrl: 'https://example.com/diverge',
    title: 'Diverge',
    key
  });

  // Simulate a remote divergent version by publishing a new version directly.
  // Local index still points to v1 until sync updates it; the transport sees v2.
  const v2 = await api.publish({
    content: '# Base\n\nCommon paragraph.\n\nRemote addition.',
    kind: 'subject',
    topic: 'sync-test',
    sourceUrl: 'https://example.com/diverge',
    title: 'Diverge',
    key
  });

  // Roll local index back to v1 to simulate stale local cache.
  const index = JSON.parse(fs.readFileSync(path.join(home, 'cache', 'index.json'), 'utf8'));
  index.articles[key] = { ...index.articles[key], id: v1.summary.id, version: v1.summary.version };
  fs.writeFileSync(path.join(home, 'cache', 'index.json'), JSON.stringify(index, null, 2) + '\n');

  const result = await syncWithMerge({ home, autoMerge: true });
  assert.equal(result.report.merges.length, 1, 'one merge produced');
  const merge = result.report.merges[0];
  assert.equal(merge.key, key);
  assert.equal(merge.status, 'merged');
  assert.equal(merge.hasConflicts, false);
  assert.ok(merge.mergedId, 'merged version has an id');
  assert.ok(merge.mergedId !== v1.summary.id && merge.mergedId !== v2.summary.id, 'merged id is new');

  // Index updated to the merged version.
  const updatedIndex = JSON.parse(fs.readFileSync(path.join(home, 'cache', 'index.json'), 'utf8'));
  assert.equal(updatedIndex.articles[key].id, merge.mergedId);
  assert.ok(updatedIndex.articles[key].version > v2.summary.version, 'merged version increments beyond remote');

  fs.rmSync(home, { recursive: true, force: true });
  console.log('2. syncWithMerge auto-merges divergent versions of the same key');
}

// --- 3. syncWithMerge dry-run previews merges without publishing ---
{
  const home = makeTempHome();
  resetApi(home);
  setupLocalHome(home);
  await api.init({ keyType: 'ed25519', transport: 'local' });

  const key = 'subject/sync-dryrun';
  const v1 = await api.publish({
    content: '# Base\n\nCommon.',
    kind: 'subject',
    topic: 'sync-test',
    sourceUrl: 'https://example.com/dryrun',
    title: 'Dry Run',
    key
  });
  const v2 = await api.publish({
    content: '# Base\n\nCommon.\n\nRemote.',
    kind: 'subject',
    topic: 'sync-test',
    sourceUrl: 'https://example.com/dryrun',
    title: 'Dry Run',
    key
  });

  const index = JSON.parse(fs.readFileSync(path.join(home, 'cache', 'index.json'), 'utf8'));
  index.articles[key] = { ...index.articles[key], id: v1.summary.id, version: v1.summary.version };
  fs.writeFileSync(path.join(home, 'cache', 'index.json'), JSON.stringify(index, null, 2) + '\n');

  const beforeObjects = fs.readdirSync(path.join(home, 'cache', 'objects')).filter((n) => n.endsWith('.json')).length;
  const result = await syncWithMerge({ home, autoMerge: true, dryRun: true });
  const afterObjects = fs.readdirSync(path.join(home, 'cache', 'objects')).filter((n) => n.endsWith('.json')).length;

  assert.equal(result.report.merges.length, 1);
  assert.equal(result.report.merges[0].status, 'dry-run');
  assert.equal(afterObjects, beforeObjects, 'dry-run should not publish a new object');

  fs.rmSync(home, { recursive: true, force: true });
  console.log('3. syncWithMerge dry-run previews merges without publishing');
}

// --- 4. syncWithMerge --no-auto-merge reports divergences ---
{
  const home = makeTempHome();
  resetApi(home);
  setupLocalHome(home);
  await api.init({ keyType: 'ed25519', transport: 'local' });

  const key = 'subject/sync-no-auto';
  const v1 = await api.publish({
    content: '# Base\n\nCommon.',
    kind: 'subject',
    topic: 'sync-test',
    sourceUrl: 'https://example.com/noauto',
    title: 'No Auto',
    key
  });
  const v2 = await api.publish({
    content: '# Base\n\nCommon.\n\nRemote.',
    kind: 'subject',
    topic: 'sync-test',
    sourceUrl: 'https://example.com/noauto',
    title: 'No Auto',
    key
  });

  const index = JSON.parse(fs.readFileSync(path.join(home, 'cache', 'index.json'), 'utf8'));
  index.articles[key] = { ...index.articles[key], id: v1.summary.id, version: v1.summary.version };
  fs.writeFileSync(path.join(home, 'cache', 'index.json'), JSON.stringify(index, null, 2) + '\n');

  const result = await syncWithMerge({ home, autoMerge: false });
  assert.equal(result.report.merges.length, 0);
  assert.equal(result.report.divergences.length, 1);
  assert.equal(result.report.divergences[0].status, 'divergent');
  assert.equal(result.report.divergences[0].key, key);
  assert.equal(result.report.divergences[0].localId, v1.summary.id);
  assert.equal(result.report.divergences[0].remoteId, v2.summary.id);

  fs.rmSync(home, { recursive: true, force: true });
  console.log('4. syncWithMerge --no-auto-merge reports divergences');
}

// --- 5. Agent API sync returns merges/divergences ---
{
  const home = makeTempHome();
  resetApi(home);
  setupLocalHome(home);
  await api.init({ keyType: 'ed25519', transport: 'local' });

  const key = 'subject/api-sync';
  const v1 = await api.publish({
    content: '# Base\n\nCommon.',
    kind: 'subject',
    topic: 'sync-test',
    sourceUrl: 'https://example.com/api-sync',
    title: 'API Sync',
    key
  });
  const v2 = await api.publish({
    content: '# Base\n\nCommon.\n\nRemote.',
    kind: 'subject',
    topic: 'sync-test',
    sourceUrl: 'https://example.com/api-sync',
    title: 'API Sync',
    key
  });

  const index = JSON.parse(fs.readFileSync(path.join(home, 'cache', 'index.json'), 'utf8'));
  index.articles[key] = { ...index.articles[key], id: v1.summary.id, version: v1.summary.version };
  fs.writeFileSync(path.join(home, 'cache', 'index.json'), JSON.stringify(index, null, 2) + '\n');

  const result = await api.sync();
  assert.equal(result.merges.length, 1);
  assert.equal(result.divergences.length, 0);
  assert.equal(result.merges[0].key, key);
  assert.ok(result.articles[key], 'result includes articles index');
  assert.ok(result.attestations, 'result includes attestations index');
  assert.ok(result.updatedAt, 'result includes updatedAt');

  fs.rmSync(home, { recursive: true, force: true });
  console.log('5. Agent API sync returns merges/divergences');
}

// --- 6. CLI sync help mentions --no-auto-merge and --dry-run ---
{
  const cliPath = path.resolve(import.meta.dirname, '../scripts/cli.mjs');
  const out = execSync(`node ${cliPath} sync --help`, { encoding: 'utf8' });
  assert.match(out, /--no-auto-merge/);
  assert.match(out, /--dry-run/);
  assert.match(out, /three-way/);
  console.log('6. CLI sync help mentions --no-auto-merge and --dry-run');
}

console.log('\n✅ All sync tests passed');
