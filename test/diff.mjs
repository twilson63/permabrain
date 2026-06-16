/**
 * Tests for src/diff.mjs
 *
 * Covers:
 *   - diffArticles by two version IDs
 *   - diffArticles by two canonical keys (latest versions)
 *   - diffArticles JSON output
 *   - diffArticles conflict preview when common ancestor exists
 *   - diffLocalVsRemote for single-key local-vs-remote
 *   - CLI diff command registered and documented
 *   - Agent API exposes diff
 *   - Module exports expose diff functions
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';

import { api } from '../src/agent-api.mjs';
import { initState, defaultConfig } from '../src/config.mjs';
import { diffArticles, diffLocalVsRemote } from '../src/diff.mjs';
import { diffArticles as diffArticlesBarrel, diffLocalVsRemote as diffLocalVsRemoteBarrel } from '../src/index.mjs';

function makeTempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-diff-'));
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

// --- 1. diffArticles by two version IDs ---
{
  const home = makeTempHome();
  resetApi(home);
  setupLocalHome(home);
  await api.init({ keyType: 'ed25519', transport: 'local' });

  const key = 'subject/diff-by-id';
  const v1 = await api.publish({
    content: '# Article\n\nFirst line.',
    kind: 'subject',
    topic: 'diff-test',
    sourceUrl: 'https://example.com/diff',
    title: 'Diff By ID',
    key
  });
  const v2 = await api.publish({
    content: '# Article\n\nFirst line.\n\nSecond line.',
    kind: 'subject',
    topic: 'diff-test',
    sourceUrl: 'https://example.com/diff',
    title: 'Diff By ID',
    key
  });

  const result = await diffArticles(v1.summary.id, v2.summary.id, { home });
  assert.equal(result.base.id, v1.summary.id);
  assert.equal(result.head.id, v2.summary.id);
  assert.ok(result.text.includes('+Second line.'));
  assert.equal(result.additions, 2);
  assert.equal(result.deletions, 0);
  assert.equal(result.changes, 2);
  assert.equal(result.hunks.length, 1);
  // Straight-line versions share no ancestor other than base itself, so no
  // conflict preview is expected.
  assert.equal(result.conflictPreview, null);

  fs.rmSync(home, { recursive: true, force: true });
  console.log('1. diffArticles by two version IDs');
}

// --- 2. diffArticles by two canonical keys ---
{
  const home = makeTempHome();
  resetApi(home);
  setupLocalHome(home);
  await api.init({ keyType: 'ed25519', transport: 'local' });

  const baseKey = 'subject/diff-base';
  const headKey = 'subject/diff-head';
  await api.publish({
    content: '# Base\n\nShared.',
    kind: 'subject',
    topic: 'diff-test',
    sourceUrl: 'https://example.com/base',
    title: 'Base',
    key: baseKey
  });
  await api.publish({
    content: '# Head\n\nShared.\n\nExtra.',
    kind: 'subject',
    topic: 'diff-test',
    sourceUrl: 'https://example.com/head',
    title: 'Head',
    key: headKey
  });

  const result = await diffArticles(baseKey, headKey, { home });
  assert.equal(result.base.key, baseKey);
  assert.equal(result.head.key, headKey);
  assert.ok(result.text.includes('+Extra.'));
  assert.ok(result.text.includes('-# Base'));
  assert.ok(result.text.includes('+# Head'));

  fs.rmSync(home, { recursive: true, force: true });
  console.log('2. diffArticles by two canonical keys');
}

// --- 3. diffArticles JSON output ---
{
  const home = makeTempHome();
  resetApi(home);
  setupLocalHome(home);
  await api.init({ keyType: 'ed25519', transport: 'local' });

  const key = 'subject/diff-json';
  const v1 = await api.publish({ content: '# A\n\nOne.', kind: 'subject', topic: 'diff-test', sourceUrl: 'https://example.com', title: 'JSON', key });
  const v2 = await api.publish({ content: '# A\n\nOne.\n\nTwo.', kind: 'subject', topic: 'diff-test', sourceUrl: 'https://example.com', title: 'JSON', key });

  const result = await diffArticles(v1.summary.id, v2.summary.id, { home, format: 'json' });
  assert.equal(result.format, 'json');
  assert.ok(Array.isArray(result.hunks));
  assert.equal(typeof result.text, 'string');

  fs.rmSync(home, { recursive: true, force: true });
  console.log('3. diffArticles JSON output');
}

// --- 4. conflict preview for divergent edits ---
{
  const home = makeTempHome();
  resetApi(home);
  setupLocalHome(home);
  await api.init({ keyType: 'ed25519', transport: 'local' });

  const key = 'subject/diff-conflict';
  const v1 = await api.publish({ content: '# Article\n\nShared line.', kind: 'subject', topic: 'diff-test', sourceUrl: 'https://example.com/c', title: 'Conflict', key });
  const v2 = await api.publish({ content: '# Article\n\nTarget rewrite.', kind: 'subject', topic: 'diff-test', sourceUrl: 'https://example.com/c', title: 'Conflict', key });
  const v3 = await api.publish({ content: '# Article\n\nSource rewrite.', kind: 'subject', topic: 'diff-test', sourceUrl: 'https://example.com/c', title: 'Conflict', key });

  const result = await diffArticles(v2.summary.id, v3.summary.id, { home });
  assert.ok(result.conflictPreview, 'conflict preview present');
  assert.equal(result.conflictPreview.hasConflicts, true);
  assert.ok(result.conflictPreview.conflictCount >= 1);
  assert.ok(result.conflictPreview.preview.includes('<<<<<<< target'));
  assert.ok(result.conflictPreview.preview.includes('>>>>>>> source'));

  fs.rmSync(home, { recursive: true, force: true });
  console.log('4. conflict preview for divergent edits');
}

// --- 5. diffLocalVsRemote single key ---
{
  const home = makeTempHome();
  resetApi(home);
  setupLocalHome(home);
  await api.init({ keyType: 'ed25519', transport: 'local' });

  const key = 'subject/diff-local-remote';
  await api.publish({ content: '# Remote\n\nRemote only.', kind: 'subject', topic: 'diff-test', sourceUrl: 'https://example.com/r', title: 'Local Remote', key });

  // Write a fake local cache file with older content.
  const cachePath = path.join(home, 'cache', 'pages', `${key.replace(/\//g, '-')}.md`);
  fs.writeFileSync(cachePath, '# Local\n\nLocal only.');

  const result = await diffLocalVsRemote(key, { home });
  assert.equal(result.key, key);
  assert.equal(typeof result.text, 'string');
  assert.ok(result.text.includes('+Remote only.') || result.text.includes('-Local only.'));

  fs.rmSync(home, { recursive: true, force: true });
  console.log('5. diffLocalVsRemote single key');
}

// --- 6. CLI diff command help ---
{
  const cliPath = path.resolve(import.meta.dirname, '../scripts/cli.mjs');
  const out = execSync(`node ${cliPath} diff --help`, { encoding: 'utf8' });
  assert.match(out, /diff/);
  assert.match(out, /--json/);
  assert.match(out, /--local/);
  assert.match(out, /--context/);
  console.log('6. CLI diff command help');
}

// --- 7. Agent API exposes diff ---
{
  const home = makeTempHome();
  resetApi(home);
  setupLocalHome(home);
  await api.init({ keyType: 'ed25519', transport: 'local' });

  const key = 'subject/api-diff';
  const v1 = await api.publish({ content: '# API\n\nBase.', kind: 'subject', topic: 'diff-test', sourceUrl: 'https://example.com/api', title: 'API Diff', key });
  const v2 = await api.publish({ content: '# API\n\nBase.\n\nMore.', kind: 'subject', topic: 'diff-test', sourceUrl: 'https://example.com/api', title: 'API Diff', key });

  const result = await api.diff(v1.summary.id, v2.summary.id);
  assert.equal(result.base.id, v1.summary.id);
  assert.equal(result.head.id, v2.summary.id);
  assert.ok(result.text.includes('+More.'));

  fs.rmSync(home, { recursive: true, force: true });
  console.log('7. Agent API exposes diff');
}

// --- 8. Module exports expose diff functions ---
{
  assert.equal(typeof diffArticlesBarrel, 'function');
  assert.equal(typeof diffLocalVsRemoteBarrel, 'function');
  console.log('8. Module exports expose diff functions');
}

console.log('\n✅ All diff tests passed');
