/**
 * Tests for src/fork.mjs
 *
 * Covers:
 *   - deriveForkKey generates a valid fork key
 *   - forkArticle copies source metadata and publishes a new DataItem
 *   - Fork lineage tags are present on the published item
 *   - Fork begins its own version chain at v1
 *   - Source article is unchanged after fork
 *   - listForks discovers forks by Article-Fork-Of tag
 *   - CLI fork + list-forks commands are registered and documented
 *   - Agent API exposes fork and listForks
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';

import { api } from '../src/agent-api.mjs';
import { initState, defaultConfig } from '../src/config.mjs';
import { forkArticle, listForks, deriveForkKey } from '../src/fork.mjs';
import { tagsToObject } from '../src/tags.mjs';
import { buildVersionChain } from '../src/history.mjs';

function makeTempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-fork-'));
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

// --- 1. deriveForkKey ---
{
  const key = deriveForkKey('subject/original', 'alt');
  assert.equal(key, 'subject/original-alt');

  const defaultFork = deriveForkKey('subject/original');
  assert.equal(defaultFork, 'subject/original-fork');
  console.log('1. deriveForkKey');
}

// --- 2. forkArticle copies source and applies edits ---
{
  const home = makeTempHome();
  resetApi(home);
  setupLocalHome(home);
  await api.init({ keyType: 'ed25519', transport: 'local' });

  const sourceKey = 'subject/fork-source';
  const source = await api.publish({
    content: '# Original\n\nOriginal body.',
    kind: 'subject',
    topic: 'fork-test',
    sourceUrl: 'https://example.com/original',
    title: 'Original',
    key: sourceKey
  });

  const fork = await forkArticle(sourceKey, {
    title: 'Forked Version',
    content: '# Fork\n\nForked body.',
    topic: 'fork-test-evolved'
  }, { home });

  assert.notEqual(fork.fork.key, sourceKey, 'fork key differs from source');
  assert.equal(fork.fork.title, 'Forked Version');
  assert.equal(fork.fork.topic, 'fork-test-evolved');
  assert.equal(fork.fork.kind, 'subject');
  assert.equal(fork.fork.version, 1, 'fork starts at v1');
  assert.equal(fork.source.id, source.summary.id);
  assert.equal(fork.source.version, 1);
  assert.deepEqual(fork.editsApplied.sort(), ['content', 'title', 'topic']);

  const forkTags = tagsToObject(fork.item.tags || []);
  assert.equal(forkTags['Article-Fork-Of'], sourceKey);
  assert.equal(forkTags['Article-Fork-Source-Id'], source.summary.id);
  assert.equal(forkTags['Article-Fork-Source-Version'], '1');

  fs.rmSync(home, { recursive: true, force: true });
  console.log('2. forkArticle copies source and applies edits');
}

// --- 3. Source article unchanged after fork ---
{
  const home = makeTempHome();
  resetApi(home);
  setupLocalHome(home);
  await api.init({ keyType: 'ed25519', transport: 'local' });

  const sourceKey = 'subject/source-stable';
  const source = await api.publish({
    content: '# Stable\n\nBody.',
    kind: 'subject',
    topic: 'fork-test',
    sourceUrl: 'https://example.com/stable',
    title: 'Stable',
    key: sourceKey
  });

  await forkArticle(sourceKey, { title: 'Different' }, { home });
  const after = await api.get(sourceKey);
  assert.equal(after.content, '# Stable\n\nBody.');
  assert.equal(after.version, 1);
  assert.equal(after.id, source.summary.id);

  fs.rmSync(home, { recursive: true, force: true });
  console.log('3. Source article unchanged after fork');
}

// --- 4. Fork begins independent version chain ---
{
  const home = makeTempHome();
  resetApi(home);
  setupLocalHome(home);
  await api.init({ keyType: 'ed25519', transport: 'local' });

  const sourceKey = 'subject/independent-chain';
  await api.publish({
    content: '# Independent\n\nBody.',
    kind: 'subject',
    topic: 'fork-test',
    sourceUrl: 'https://example.com/independent',
    title: 'Independent',
    key: sourceKey
  });

  const fork = await forkArticle(sourceKey, { content: '# Fork\n\nBody.' }, { home });
  await api.publish({
    content: '# Fork v2\n\nUpdated body.',
    kind: 'subject',
    topic: 'fork-test',
    sourceUrl: 'https://example.com/independent',
    title: 'Independent',
    key: fork.fork.key
  });

  const chain = await buildVersionChain(fork.fork.key, { home });
  assert.equal(chain.length, 2, 'fork has its own two-version chain');
  assert.equal(tagsToObject(chain[0].tags || [])['Article-Version'], '1');
  assert.equal(tagsToObject(chain[1].tags || [])['Article-Version'], '2');

  const sourceChain = await buildVersionChain(sourceKey, { home });
  assert.equal(sourceChain.length, 1, 'source still has one version');

  fs.rmSync(home, { recursive: true, force: true });
  console.log('4. Fork begins independent version chain');
}

// --- 5. listForks discovers forks ---
{
  const home = makeTempHome();
  resetApi(home);
  setupLocalHome(home);
  await api.init({ keyType: 'ed25519', transport: 'local' });

  const sourceKey = 'subject/list-forks-source';
  const source = await api.publish({
    content: '# Source\n\nBody.',
    kind: 'subject',
    topic: 'fork-test',
    sourceUrl: 'https://example.com/source',
    title: 'List Forks Source',
    key: sourceKey
  });

  const f1 = await forkArticle(sourceKey, { slug: 'alpha', title: 'Alpha' }, { home });
  const f2 = await forkArticle(sourceKey, { slug: 'beta', title: 'Beta' }, { home });

  const forks = await listForks(sourceKey, { home });
  assert.equal(forks.length, 2);
  const keys = forks.map((f) => f.key).sort();
  assert.deepEqual(keys, [f1.fork.key, f2.fork.key].sort());
  assert.ok(forks.every((f) => f.forkedAt === source.summary.id));

  fs.rmSync(home, { recursive: true, force: true });
  console.log('5. listForks discovers forks');
}

// --- 6. CLI fork command help ---
{
  const cliPath = path.resolve(import.meta.dirname, '../scripts/cli.mjs');
  const out = execSync(`node ${cliPath} fork --help`, { encoding: 'utf8' });
  assert.match(out, /fork/);
  assert.match(out, /--key/);
  assert.match(out, /Article-Fork-Of/);
  console.log('6. CLI fork command help');
}

// --- 7. CLI list-forks command registered ---
{
  const cliPath = path.resolve(import.meta.dirname, '../scripts/cli.mjs');
  const out = execSync(`node ${cliPath} list-forks --help`, { encoding: 'utf8' });
  assert.match(out, /list-forks/);
  assert.match(out, /Article-Fork-Of/);
  console.log('7. CLI list-forks command registered');
}

// --- 8. Agent API exposes fork and listForks ---
{
  const home = makeTempHome();
  resetApi(home);
  setupLocalHome(home);
  await api.init({ keyType: 'ed25519', transport: 'local' });

  const sourceKey = 'subject/api-fork-source';
  await api.publish({
    content: '# API Fork Source\n\nBody.',
    kind: 'subject',
    topic: 'fork-test',
    sourceUrl: 'https://example.com/api-fork',
    title: 'API Fork Source',
    key: sourceKey
  });

  const forkResult = await api.fork(sourceKey, { slug: 'api', title: 'API Fork' });
  assert.equal(forkResult.fork.key, 'subject/api');
  assert.equal(forkResult.source.key, sourceKey);

  const listed = await api.listForks(sourceKey);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].key, forkResult.fork.key);

  fs.rmSync(home, { recursive: true, force: true });
  console.log('8. Agent API exposes fork and listForks');
}

console.log('\n✅ All fork tests passed');
