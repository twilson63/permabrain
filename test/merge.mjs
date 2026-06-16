/**
 * Tests for src/merge.mjs
 *
 * Covers:
 *   - threeWayMerge auto-merges non-conflicting changes
 *   - threeWayMerge marks conflicting changes
 *   - mergeArticles resolves ancestor via fork lineage
 *   - mergeArticles publishes new target version with merge tags
 *   - mergeArticles carries forward source attestations by default
 *   - mergeArticles rejects encrypted articles
 *   - CLI merge command registered and documented
 *   - Agent API exposes merge
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';

import { api } from '../src/agent-api.mjs';
import { initState, defaultConfig } from '../src/config.mjs';
import { mergeArticles, threeWayMerge } from '../src/merge.mjs';
import { tagsToObject } from '../src/tags.mjs';
import { buildVersionChain } from '../src/history.mjs';

function makeTempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-merge-'));
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

// --- 1. threeWayMerge auto-merges non-conflicting changes ---
{
  const ancestor = 'Line 1\nLine 2\nLine 3';
  const target = 'Line 1\nLine 2 edited\nLine 3';
  const source = 'Line 1\nLine 2\nLine 3 added';
  const merged = threeWayMerge(ancestor, target, source);
  assert.equal(merged, 'Line 1\nLine 2 edited\nLine 3 added');
  console.log('1. threeWayMerge auto-merges non-conflicting changes');
}

// --- 2. threeWayMerge marks conflicts ---
{
  const ancestor = 'Line 1\nLine 2\nLine 3';
  const target = 'Line 1\nTarget edit\nLine 3';
  const source = 'Line 1\nSource edit\nLine 3';
  const merged = threeWayMerge(ancestor, target, source);
  assert.ok(merged.includes('<<<<<<< target'));
  assert.ok(merged.includes('======='));
  assert.ok(merged.includes('>>>>>>> source'));
  assert.ok(merged.includes('Target edit'));
  assert.ok(merged.includes('Source edit'));
  console.log('2. threeWayMerge marks conflicts');
}

// --- 3. mergeArticles integrates a fork back into target ---
{
  const home = makeTempHome();
  resetApi(home);
  setupLocalHome(home);
  await api.init({ keyType: 'ed25519', transport: 'local' });

  const sourceKey = 'subject/merge-target';
  await api.publish({
    content: '# Original\n\nCommon paragraph.',
    kind: 'subject',
    topic: 'merge-test',
    sourceUrl: 'https://example.com/target',
    title: 'Merge Target',
    key: sourceKey
  });

  const fork = await api.fork(sourceKey, {
    slug: 'branch',
    content: '# Original\n\nCommon paragraph.\n\nSource only line.'
  });

  // Evolve target after the fork so both branches have distinct additions.
  await api.publish({
    content: '# Original\n\nCommon paragraph.\n\nTarget only line.',
    kind: 'subject',
    topic: 'merge-test',
    sourceUrl: 'https://example.com/target',
    title: 'Merge Target',
    key: sourceKey
  });

  const result = await mergeArticles(sourceKey, fork.fork.key, { home });
  assert.equal(result.target.key, sourceKey);
  assert.equal(result.source.key, fork.fork.key);
  assert.equal(result.merged.key, sourceKey);
  assert.equal(result.merged.version, 3);
  assert.equal(result.hasConflicts, false);
  assert.ok(result.mergedContent.includes('Target only line'));
  assert.ok(result.mergedContent.includes('Source only line'));

  const chain = await buildVersionChain(sourceKey, { home });
  assert.equal(chain.length, 3);
  const latestTags = tagsToObject(chain[chain.length - 1].tags || []);
  assert.equal(latestTags['Article-Merge-Source-Key'], fork.fork.key);
  assert.equal(latestTags['Article-Merge-Fork-Integrated'], 'true');
  assert.equal(latestTags['Article-Merge-Has-Conflicts'], 'false');

  fs.rmSync(home, { recursive: true, force: true });
  console.log('3. mergeArticles integrates a fork back into target');
}

// --- 4. mergeArticles carries forward source attestations ---
{
  const home = makeTempHome();
  resetApi(home);
  setupLocalHome(home);
  await api.init({ keyType: 'ed25519', transport: 'local' });

  const targetKey = 'subject/merge-attest-target';
  await api.publish({
    content: '# Base\n\nBody.',
    kind: 'subject',
    topic: 'merge-test',
    sourceUrl: 'https://example.com/base',
    title: 'Base',
    key: targetKey
  });

  const fork = await api.fork(targetKey, {
    slug: 'attested-branch',
    content: '# Base\n\nBody plus source addition.'
  });
  await api.attest(fork.fork.key, { opinion: 'valid', confidence: 0.9, reason: 'Source looks good' });

  const result = await mergeArticles(targetKey, fork.fork.key, { home });
  assert.equal(result.carriedAttestations.length, 1);
  assert.ok(result.carriedAttestations[0].id, 'attestation carried forward has an id');
  assert.equal(result.carriedAttestations[0].opinion, 'valid');

  const history = await api.history(targetKey);
  assert.equal(history.attestationCount, 1);
  assert.ok(history.attestations[0].reason.includes('[carried from'));

  fs.rmSync(home, { recursive: true, force: true });
  console.log('4. mergeArticles carries forward source attestations');
}

// --- 5. mergeArticles honors --no-carry-attestations ---
{
  const home = makeTempHome();
  resetApi(home);
  setupLocalHome(home);
  await api.init({ keyType: 'ed25519', transport: 'local' });

  const targetKey = 'subject/merge-no-carry';
  await api.publish({
    content: '# Base\n\nBody.',
    kind: 'subject',
    topic: 'merge-test',
    sourceUrl: 'https://example.com/base',
    title: 'Base',
    key: targetKey
  });

  const fork = await api.fork(targetKey, {
    slug: 'no-carry-branch',
    content: '# Base\n\nUpdated.'
  });
  await api.attest(fork.fork.key, { opinion: 'valid', confidence: 0.8, reason: 'Good' });

  const result = await mergeArticles(targetKey, fork.fork.key, { home, carryAttestations: false });
  assert.equal(result.carriedAttestations.length, 0);

  const history = await api.history(targetKey);
  assert.equal(history.attestationCount, 0);

  fs.rmSync(home, { recursive: true, force: true });
  console.log('5. mergeArticles honors --no-carry-attestations');
}

// --- 6. mergeArticles rejects same source/target key ---
{
  const home = makeTempHome();
  resetApi(home);
  setupLocalHome(home);
  await api.init({ keyType: 'ed25519', transport: 'local' });

  try {
    await mergeArticles('subject/same', 'subject/same', { home });
    assert.fail('should throw for identical keys');
  } catch (err) {
    assert.match(err.message, /must differ/);
  }

  fs.rmSync(home, { recursive: true, force: true });
  console.log('6. mergeArticles rejects same source/target key');
}

// --- 7. CLI merge command help ---
{
  const cliPath = path.resolve(import.meta.dirname, '../scripts/cli.mjs');
  const out = execSync(`node ${cliPath} merge --help`, { encoding: 'utf8' });
  assert.match(out, /merge/);
  assert.match(out, /target-key/);
  assert.match(out, /source-key/);
  assert.match(out, /no-carry-attestations/);
  console.log('7. CLI merge command help');
}

// --- 8. Agent API exposes merge ---
{
  const home = makeTempHome();
  resetApi(home);
  setupLocalHome(home);
  await api.init({ keyType: 'ed25519', transport: 'local' });

  const targetKey = 'subject/api-merge-target';
  await api.publish({
    content: '# API\n\nBase.',
    kind: 'subject',
    topic: 'merge-test',
    sourceUrl: 'https://example.com/api-base',
    title: 'API Base',
    key: targetKey
  });

  const fork = await api.fork(targetKey, {
    slug: 'api-branch',
    content: '# API\n\nBase plus branch addition.'
  });

  const result = await api.merge(targetKey, fork.fork.key);
  assert.equal(result.merged.key, targetKey);
  assert.equal(result.merged.version, 2);
  assert.equal(result.hasConflicts, false);

  fs.rmSync(home, { recursive: true, force: true });
  console.log('8. Agent API exposes merge');
}

// --- 9. mergeArticles detects conflicts from divergent edits ---
{
  const home = makeTempHome();
  resetApi(home);
  setupLocalHome(home);
  await api.init({ keyType: 'ed25519', transport: 'local' });

  const targetKey = 'subject/merge-conflict';
  await api.publish({
    content: '# Article\n\nShared line.',
    kind: 'subject',
    topic: 'merge-test',
    sourceUrl: 'https://example.com/conflict',
    title: 'Conflict',
    key: targetKey
  });

  const fork = await api.fork(targetKey, {
    slug: 'conflict-branch',
    content: '# Article\n\nBranch rewrite.'
  });

  await api.publish({
    content: '# Article\n\nTarget rewrite.',
    kind: 'subject',
    topic: 'merge-test',
    sourceUrl: 'https://example.com/conflict',
    title: 'Conflict',
    key: targetKey
  });

  const result = await mergeArticles(targetKey, fork.fork.key, { home });
  assert.equal(result.hasConflicts, true);
  assert.ok(result.conflictCount >= 1);
  assert.equal(result.merged.version, 3);

  const latestTags = tagsToObject(result.item.tags || []);
  assert.equal(latestTags['Article-Merge-Has-Conflicts'], 'true');

  fs.rmSync(home, { recursive: true, force: true });
  console.log('9. mergeArticles detects conflicts from divergent edits');
}

console.log('\n✅ All merge tests passed');
