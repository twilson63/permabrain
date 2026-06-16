/**
 * Tests for src/export-history.mjs
 *
 * Covers:
 *   - exportHistory builds a deterministic bundle for a single article version
 *   - exportHistory includes all versions in the version chain
 *   - exportHistory includes attestations against versions in the chain
 *   - articles are sorted by version ascending and attestations by ID
 *   - bundle entries are raw, signed DataItems that verify
 *   - bundle can be imported by another local PermaBrain node
 *   - CLI command registered and help mentions --no-verify / --no-exporter
 *   - Agent API exposes exportHistory
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';

import { api } from '../src/agent-api.mjs';
import { exportHistory } from '../src/export-history.mjs';
import { importBundle } from '../src/bundle.mjs';
import { initState, defaultConfig } from '../src/config.mjs';
import { tagsToObject } from '../src/tags.mjs';
import { parseAns104 } from '../src/dataitem.mjs';

function makeTempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-export-history-'));
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

function entryTypes(bundle) {
  return bundle.entries.map((e) => e.type);
}

function entryId(entry) {
  const parsed = parseAns104(Buffer.from(entry.data, 'base64'));
  return parsed.id;
}

// --- 1. exportHistory includes versions and attestations for one version ---
{
  const home = makeTempHome();
  resetApi(home);
  setupLocalHome(home);
  await api.init({ keyType: 'ed25519', transport: 'local' });

  const key = 'subject/export-history-one';
  await api.publish({
    content: '# One\n\nFirst body.',
    kind: 'subject',
    topic: 'export-history-test',
    sourceUrl: 'https://example.com/one',
    title: 'One',
    key
  });
  await api.attest(key, { opinion: 'valid', confidence: 0.9, reason: 'Good' });

  const bundle = await exportHistory(key, { home });
  assert.equal(bundle.version, 'permabrain-bundle/1.0.0');
  assert.equal(bundle.type, 'history');
  assert.equal(bundle.meta.sourceKey, key);
  assert.equal(bundle.meta.entryCount.articles, 1);
  assert.equal(bundle.meta.entryCount.attestations, 1);
  assert.equal(bundle.entries.length, 2);
  assert.deepEqual(entryTypes(bundle), ['article', 'attestation']);
  assert.ok(bundle.deterministic);

  fs.rmSync(home, { recursive: true, force: true });
  console.log('1. exportHistory one version + attestation');
}

// --- 2. exportHistory includes the full version chain ---
{
  const home = makeTempHome();
  resetApi(home);
  setupLocalHome(home);
  await api.init({ keyType: 'ed25519', transport: 'local' });

  const key = 'subject/export-history-chain';
  await api.publish({
    content: '# Chain\n\nV1.',
    kind: 'subject',
    topic: 'export-history-test',
    sourceUrl: 'https://example.com/chain',
    title: 'Chain',
    key
  });
  await api.publish({
    content: '# Chain\n\nV2.',
    kind: 'subject',
    topic: 'export-history-test',
    sourceUrl: 'https://example.com/chain',
    title: 'Chain',
    key
  });
  await api.publish({
    content: '# Chain\n\nV3.',
    kind: 'subject',
    topic: 'export-history-test',
    sourceUrl: 'https://example.com/chain',
    title: 'Chain',
    key
  });

  const bundle = await exportHistory(key, { home });
  assert.equal(bundle.meta.entryCount.articles, 3);
  assert.equal(bundle.entries.filter((e) => e.type === 'article').length, 3);

  const articleEntries = bundle.entries.filter((e) => e.type === 'article');
  const versions = articleEntries.map((e) => {
    const parsed = parseAns104(Buffer.from(e.data, 'base64'));
    return Number(tagsToObject(parsed.tags || [])['Article-Version']);
  });
  assert.deepEqual(versions, [1, 2, 3]);

  fs.rmSync(home, { recursive: true, force: true });
  console.log('2. exportHistory full version chain');
}

// --- 3. exportHistory filters attestations to versions in the chain ---
{
  const home = makeTempHome();
  resetApi(home);
  setupLocalHome(home);
  await api.init({ keyType: 'ed25519', transport: 'local' });

  const key = 'subject/export-history-filter';
  const v1 = await api.publish({
    content: '# Filter\n\nV1.',
    kind: 'subject',
    topic: 'export-history-test',
    sourceUrl: 'https://example.com/filter',
    title: 'Filter',
    key
  });
  await api.attest(key, { opinion: 'valid', confidence: 0.8, reason: 'V1 ok' });
  const v2 = await api.publish({
    content: '# Filter\n\nV2.',
    kind: 'subject',
    topic: 'export-history-test',
    sourceUrl: 'https://example.com/filter',
    title: 'Filter',
    key
  });
  await api.attest(key, { opinion: 'valid', confidence: 0.9, reason: 'V2 ok' });

  const bundle = await exportHistory(key, { home });
  assert.equal(bundle.meta.entryCount.articles, 2);
  assert.equal(bundle.meta.entryCount.attestations, 2);

  const attEntries = bundle.entries.filter((e) => e.type === 'attestation');
  const targetIds = attEntries.map((e) => {
    const parsed = parseAns104(Buffer.from(e.data, 'base64'));
    return tagsToObject(parsed.tags || [])['Attestation-Target-Id'];
  });
  assert.ok(targetIds.includes(v1.summary.id));
  assert.ok(targetIds.includes(v2.summary.id));

  fs.rmSync(home, { recursive: true, force: true });
  console.log('3. exportHistory filters attestations to chain versions');
}

// --- 4. attestations are sorted by DataItem ID ---
{
  const home = makeTempHome();
  resetApi(home);
  setupLocalHome(home);
  await api.init({ keyType: 'ed25519', transport: 'local' });

  const key = 'subject/export-history-sort';
  await api.publish({
    content: '# Sort\n\nBody.',
    kind: 'subject',
    topic: 'export-history-test',
    sourceUrl: 'https://example.com/sort',
    title: 'Sort',
    key
  });
  await api.attest(key, { opinion: 'valid', confidence: 0.5, reason: 'A' });
  await api.attest(key, { opinion: 'valid', confidence: 0.6, reason: 'B' });
  await api.attest(key, { opinion: 'valid', confidence: 0.7, reason: 'C' });

  const bundle = await exportHistory(key, { home });
  const attEntries = bundle.entries.filter((e) => e.type === 'attestation');
  const ids = attEntries.map(entryId);
  const sorted = [...ids].sort((a, b) => String(a).localeCompare(String(b)));
  assert.deepEqual(ids, sorted);

  fs.rmSync(home, { recursive: true, force: true });
  console.log('4. exportHistory attestations sorted by ID');
}

// --- 5. bundle entries verify and can be imported into a fresh node ---
{
  const home = makeTempHome();
  resetApi(home);
  setupLocalHome(home);
  await api.init({ keyType: 'ed25519', transport: 'local' });

  const key = 'subject/export-history-import';
  await api.publish({
    content: '# Import\n\nBody.',
    kind: 'subject',
    topic: 'export-history-test',
    sourceUrl: 'https://example.com/import',
    title: 'Import',
    key
  });
  await api.attest(key, { opinion: 'valid', confidence: 0.95, reason: 'Solid' });

  const bundle = await exportHistory(key, { home });

  const home2 = makeTempHome();
  resetApi(home2);
  setupLocalHome(home2);
  await api.init({ keyType: 'ed25519', transport: 'local' });

  const results = await importBundle(bundle, { home: home2, verify: true, skipDuplicates: true });
  const importedArticles = results.filter((r) => r.type === 'article' && r.imported);
  const importedAttestations = results.filter((r) => r.type === 'attestation' && r.imported);
  assert.equal(importedArticles.length, 1);
  assert.equal(importedAttestations.length, 1);

  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(home2, { recursive: true, force: true });
  console.log('5. exportHistory bundle imports into fresh node');
}

// --- 6. exportHistory via api.exportHistory ---
{
  const home = makeTempHome();
  resetApi(home);
  setupLocalHome(home);
  await api.init({ keyType: 'ed25519', transport: 'local' });

  const key = 'subject/api-export-history';
  await api.publish({
    content: '# API Export\n\nBody.',
    kind: 'subject',
    topic: 'export-history-test',
    sourceUrl: 'https://example.com/api',
    title: 'API Export',
    key
  });

  const bundle = await api.exportHistory(key);
  assert.equal(bundle.meta.sourceKey, key);
  assert.equal(bundle.meta.entryCount.articles, 1);
  assert.equal(bundle.entries.length, 1);

  fs.rmSync(home, { recursive: true, force: true });
  console.log('6. api.exportHistory works');
}

// --- 7. CLI export-history command registered and help ---
{
  const cliPath = path.resolve(import.meta.dirname, '../scripts/cli.mjs');
  const out = execSync(`node ${cliPath} export-history --help`, { encoding: 'utf8' });
  assert.match(out, /export-history/);
  assert.match(out, /canonical-key/);
  assert.match(out, /--no-verify/);
  assert.match(out, /--no-exporter/);
  console.log('7. CLI export-history command help');
}

// --- 8. exportHistory throws on unknown key ---
{
  const home = makeTempHome();
  resetApi(home);
  setupLocalHome(home);
  await api.init({ keyType: 'ed25519', transport: 'local' });

  try {
    await exportHistory('subject/does-not-exist', { home });
    assert.fail('should throw');
  } catch (err) {
    assert.match(err.message, /No versions found/);
  }

  fs.rmSync(home, { recursive: true, force: true });
  console.log('8. exportHistory throws on unknown key');
}

console.log('\n✅ All export-history tests passed');
