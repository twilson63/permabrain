/**
 * Tests for src/import-history.mjs
 *
 * Covers:
 *   - importHistory imports a history bundle into a fresh home
 *   - importHistory preserves version ordering
 *   - importHistory is idempotent (skips duplicates)
 *   - importHistory with verify=false skips signature checks
 *   - importHistory validates determinism markers / bundle type
 *   - importHistory updates the local cache index
 *   - Agent API exposes importHistory
 *   - CLI import-history command registered and help
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';

import { api } from '../src/agent-api.mjs';
import { exportHistory } from '../src/export-history.mjs';
import { importHistory } from '../src/import-history.mjs';
import { initState, defaultConfig } from '../src/config.mjs';
import { loadIndex } from '../src/cache.mjs';

function makeTempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-import-history-'));
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

// --- 1. importHistory into a fresh home ---
{
  const home = makeTempHome();
  resetApi(home);
  setupLocalHome(home);
  await api.init({ keyType: 'ed25519', transport: 'local' });

  const key = 'subject/import-history-fresh';
  await api.publish({
    content: '# Fresh\n\nV1.',
    kind: 'subject',
    topic: 'import-history-test',
    sourceUrl: 'https://example.com/fresh',
    title: 'Fresh',
    key
  });
  await api.attest(key, { opinion: 'valid', confidence: 0.9, reason: 'Looks good' });

  const bundle = await exportHistory(key, { home });

  const home2 = makeTempHome();
  resetApi(home2);
  setupLocalHome(home2);
  await api.init({ keyType: 'ed25519', transport: 'local' });

  const result = await importHistory(bundle, { home: home2 });
  assert.equal(result.ok, true);
  assert.equal(result.importedArticles, 1);
  assert.equal(result.importedAttestations, 1);
  assert.equal(result.failed, 0);

  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(home2, { recursive: true, force: true });
  console.log('1. importHistory into fresh home');
}

// --- 2. importHistory preserves version ordering ---
{
  const home = makeTempHome();
  resetApi(home);
  setupLocalHome(home);
  await api.init({ keyType: 'ed25519', transport: 'local' });

  const key = 'subject/import-history-versions';
  await api.publish({
    content: '# Versions\n\nV1.',
    kind: 'subject',
    topic: 'import-history-test',
    sourceUrl: 'https://example.com/versions',
    title: 'Versions',
    key
  });
  await api.publish({
    content: '# Versions\n\nV2.',
    kind: 'subject',
    topic: 'import-history-test',
    sourceUrl: 'https://example.com/versions',
    title: 'Versions',
    key
  });
  await api.publish({
    content: '# Versions\n\nV3.',
    kind: 'subject',
    topic: 'import-history-test',
    sourceUrl: 'https://example.com/versions',
    title: 'Versions',
    key
  });

  const bundle = await exportHistory(key, { home });

  const home2 = makeTempHome();
  resetApi(home2);
  setupLocalHome(home2);
  await api.init({ keyType: 'ed25519', transport: 'local' });

  const result = await importHistory(bundle, { home: home2 });
  assert.equal(result.importedArticles, 3);

  // Verify local index has latest version.
  const index = loadIndex(home2);
  assert.equal(index.articles[key].version, 3);

  // Verify transport contains all versions in order.
  const { buildVersionChain } = await import('../src/history.mjs');
  const chain = await buildVersionChain(key, { home: home2 });
  assert.equal(chain.length, 3);
  assert.deepEqual(
    chain.map((item) => Number(item.tags.find((t) => t.name === 'Article-Version')?.value || 0)),
    [1, 2, 3]
  );

  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(home2, { recursive: true, force: true });
  console.log('2. importHistory preserves version ordering');
}

// --- 3. importHistory is idempotent ---
{
  const home = makeTempHome();
  resetApi(home);
  setupLocalHome(home);
  await api.init({ keyType: 'ed25519', transport: 'local' });

  const key = 'subject/import-history-idempotent';
  await api.publish({
    content: '# Idempotent\n\nBody.',
    kind: 'subject',
    topic: 'import-history-test',
    sourceUrl: 'https://example.com/idempotent',
    title: 'Idempotent',
    key
  });
  await api.attest(key, { opinion: 'valid', confidence: 0.8, reason: 'OK' });

  const bundle = await exportHistory(key, { home });

  const home2 = makeTempHome();
  resetApi(home2);
  setupLocalHome(home2);
  await api.init({ keyType: 'ed25519', transport: 'local' });

  const first = await importHistory(bundle, { home: home2 });
  assert.equal(first.importedArticles, 1);
  assert.equal(first.importedAttestations, 1);

  const second = await importHistory(bundle, { home: home2 });
  assert.equal(second.skippedArticles, 1);
  assert.equal(second.skippedAttestations, 1);
  assert.equal(second.importedArticles, 0);
  assert.equal(second.importedAttestations, 0);
  assert.equal(second.failed, 0);

  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(home2, { recursive: true, force: true });
  console.log('3. importHistory idempotent');
}

// --- 4. importHistory with verify=false skips signature checks ---
{
  const home = makeTempHome();
  resetApi(home);
  setupLocalHome(home);
  await api.init({ keyType: 'ed25519', transport: 'local' });

  const key = 'subject/import-history-noverify';
  await api.publish({
    content: '# No Verify\n\nBody.',
    kind: 'subject',
    topic: 'import-history-test',
    sourceUrl: 'https://example.com/noverify',
    title: 'No Verify',
    key
  });

  const bundle = await exportHistory(key, { home });

  // Corrupt one article entry's payload without touching the signature.
  const corruptBundle = JSON.parse(JSON.stringify(bundle));
  const articleEntry = corruptBundle.entries.find((e) => e.type === 'article');
  const bytes = Buffer.from(articleEntry.data, 'base64');
  bytes[bytes.length - 1] ^= 0xff;
  articleEntry.data = bytes.toString('base64');

  const home2 = makeTempHome();
  resetApi(home2);
  setupLocalHome(home2);
  await api.init({ keyType: 'ed25519', transport: 'local' });

  const result = await importHistory(corruptBundle, { home: home2, verify: false });
  assert.equal(result.ok, true);
  assert.equal(result.importedArticles, 1);

  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(home2, { recursive: true, force: true });
  console.log('4. importHistory verify=false skips signature checks');
}

// --- 5. importHistory validates bundle type ---
{
  const badBundle = { type: 'snapshot', entries: [] };
  try {
    await importHistory(badBundle, {});
    assert.fail('should throw');
  } catch (err) {
    assert.match(err.message, /History bundle has no entries/);
  }
  console.log('5. importHistory validates bundle type/entries');
}

// --- 6. importHistory updates local cache index ---
{
  const home = makeTempHome();
  resetApi(home);
  setupLocalHome(home);
  await api.init({ keyType: 'ed25519', transport: 'local' });

  const key = 'subject/import-history-cache';
  const v1 = await api.publish({
    content: '# Cache\n\nV1.',
    kind: 'subject',
    topic: 'import-history-test',
    sourceUrl: 'https://example.com/cache',
    title: 'Cache',
    key
  });
  await api.attest(key, { opinion: 'valid', confidence: 0.85, reason: 'Cached' });

  const bundle = await exportHistory(key, { home });

  const home2 = makeTempHome();
  resetApi(home2);
  setupLocalHome(home2);
  await api.init({ keyType: 'ed25519', transport: 'local' });

  await importHistory(bundle, { home: home2 });
  const index = loadIndex(home2);
  assert.ok(index.articles[key], 'article in index');
  assert.equal(index.articles[key].id, v1.summary.id);
  assert.ok(index.attestations[key], 'attestations in index');
  assert.equal(index.attestations[key].length, 1);

  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(home2, { recursive: true, force: true });
  console.log('6. importHistory updates local cache index');
}

// --- 7. Agent API exposes importHistory ---
{
  const home = makeTempHome();
  resetApi(home);
  setupLocalHome(home);
  await api.init({ keyType: 'ed25519', transport: 'local' });

  const key = 'subject/import-history-api';
  await api.publish({
    content: '# API\n\nBody.',
    kind: 'subject',
    topic: 'import-history-test',
    sourceUrl: 'https://example.com/api',
    title: 'API',
    key
  });
  await api.attest(key, { opinion: 'valid', confidence: 0.9, reason: 'Via API' });

  const bundle = await api.exportHistory(key);

  const home2 = makeTempHome();
  resetApi(home2);
  setupLocalHome(home2);
  await api.init({ keyType: 'ed25519', transport: 'local' });

  const result = await api.importHistory(bundle);
  assert.equal(result.ok, true);
  assert.equal(result.importedArticles, 1);
  assert.equal(result.importedAttestations, 1);

  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(home2, { recursive: true, force: true });
  console.log('7. api.importHistory works');
}

// --- 8. CLI import-history command registered and help ---
{
  const cliPath = path.resolve(import.meta.dirname, '../scripts/cli.mjs');
  const out = execSync(`node ${cliPath} import-history --help`, { encoding: 'utf8' });
  assert.match(out, /import-history/);
  assert.match(out, /canonical-key|file|bundle/);
  console.log('8. CLI import-history command help');
}

console.log('\n✅ All import-history tests passed');
