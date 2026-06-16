/**
 * Tests for src/history.mjs
 *
 * Covers:
 *   - buildVersionChain with multiple local versions
 *   - summarizeVersion extracts expected fields
 *   - historyForKey interleaves versions and attestations
 *   - version chain follows Article-Previous-Id links
 *   - CLI command registration and help
 *   - agent API history wrapper
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';

import { api } from '../src/agent-api.mjs';
import { initState, defaultConfig } from '../src/config.mjs';
import { historyForKey, buildVersionChain, summarizeVersion } from '../src/history.mjs';
import { LocalTransport } from '../src/transport.mjs';

function makeTempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-history-'));
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

// --- 1. buildVersionChain finds all versions of an article key ---
{
  const home = makeTempHome();
  resetApi(home);
  setupLocalHome(home);
  await api.init({ keyType: 'ed25519', transport: 'local' });

  const baseKey = 'subject/history-versions';
  const v1 = await api.publish({
    content: '# Version 1\n\nFirst.',
    kind: 'subject',
    topic: 'history-test',
    sourceUrl: 'https://example.com/v1',
    title: 'Version 1',
    key: baseKey
  });
  const v2 = await api.publish({
    content: '# Version 2\n\nSecond.',
    kind: 'subject',
    topic: 'history-test',
    sourceUrl: 'https://example.com/v2',
    title: 'Version 2',
    key: baseKey
  });

  const chain = await buildVersionChain(baseKey, { home });
  assert.equal(chain.length, 2, 'two versions in chain');
  assert.equal(summarizeVersion(chain[0]).version, 1);
  assert.equal(summarizeVersion(chain[1]).version, 2);
  assert.equal(summarizeVersion(chain[1]).previousId, v1.summary.id);

  fs.rmSync(home, { recursive: true, force: true });
}

// --- 2. historyForKey includes attestations in timeline ---
{
  const home = makeTempHome();
  resetApi(home);
  setupLocalHome(home);
  await api.init({ keyType: 'ed25519', transport: 'local' });

  const baseKey = 'subject/history-attestations';
  await api.publish({
    content: '# Article\n\nBody.',
    kind: 'subject',
    topic: 'history-test',
    sourceUrl: 'https://example.com/article',
    title: 'Article',
    key: baseKey
  });
  await api.attest(baseKey, { opinion: 'valid', confidence: 0.9, reason: 'Good' });
  await api.attest(baseKey, { opinion: 'valid', confidence: 0.75, reason: 'Agreed' });

  const result = await historyForKey(baseKey, { home });
  assert.equal(result.key, baseKey);
  assert.equal(result.versionCount, 1);
  assert.equal(result.attestationCount, 2);
  assert.equal(result.timeline.length, 3);
  assert.ok(result.versions[0].version === 1);
  assert.equal(result.attestations[0].targetKey, baseKey);
  assert.equal(result.attestations[0].targetVersion, 1);
  assert.ok(result.consensus);
  assert.equal(result.consensus.status, 'attested');

  fs.rmSync(home, { recursive: true, force: true });
}

// --- 3. timeline interleaves versions and attestations ---
{
  const home = makeTempHome();
  resetApi(home);
  setupLocalHome(home);
  await api.init({ keyType: 'ed25519', transport: 'local' });

  const baseKey = 'subject/history-sort';
  await api.publish({
    content: '# Sort Test\n\nBody.',
    kind: 'subject',
    topic: 'history-test',
    sourceUrl: 'https://example.com/sort',
    title: 'Sort Test',
    key: baseKey
  });
  await api.attest(baseKey, { opinion: 'valid', confidence: 0.8, reason: 'Sorted' });

  const result = await historyForKey(baseKey, { home });
  assert.equal(result.timeline.length, 2);
  assert.equal(result.timeline[0].type, 'version');
  assert.equal(result.timeline[1].type, 'attestation');

  fs.rmSync(home, { recursive: true, force: true });
}

// --- 4. CLI history command registered and help mentions --json ---
{
  const cliPath = path.resolve(import.meta.dirname, '../scripts/cli.mjs');
  const out = execSync(`node ${cliPath} history --help`, { encoding: 'utf8' });
  assert.match(out, /history/);
  assert.match(out, /--json/);
}

// --- 5. Agent API exposes history ---
{
  const home = makeTempHome();
  resetApi(home);
  setupLocalHome(home);
  await api.init({ keyType: 'ed25519', transport: 'local' });

  const baseKey = 'subject/api-history';
  await api.publish({
    content: '# API History\n\nBody.',
    kind: 'subject',
    topic: 'history-test',
    sourceUrl: 'https://example.com/api',
    title: 'API History',
    key: baseKey
  });

  const result = await api.history(baseKey);
  assert.equal(result.key, baseKey);
  assert.equal(result.versionCount, 1);
  assert.ok(Array.isArray(result.timeline));

  fs.rmSync(home, { recursive: true, force: true });
}

// --- 6. summarizeVersion handles encrypted flag ---
{
  const fakeItem = {
    id: 'abc123',
    owner: 'agent-1',
    timestamp: '2026-01-01T00:00:00.000Z',
    tags: [
      { name: 'App-Name', value: 'PermaBrain' },
      { name: 'PermaBrain-Type', value: 'article' },
      { name: 'Article-Key', value: 'subject/encrypted-article' },
      { name: 'Article-Version', value: '1' },
      { name: 'Article-Title', value: 'Encrypted' },
      { name: 'Article-Content-Hash', value: 'hash123' },
      { name: 'Visibility', value: 'encrypted' }
    ]
  };
  const summary = summarizeVersion(fakeItem);
  assert.equal(summary.version, 1);
  assert.equal(summary.title, 'Encrypted');
  assert.equal(summary.encrypted, true);
}

console.log('history tests passed');
