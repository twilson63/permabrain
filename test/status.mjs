/**
 * Test: status command and api.status()
 *
 * Verifies working-state overview: local articles, remote latest,
 * divergences, forks, merge/conflict status, transport health.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { initState } from '../src/config.mjs';
import { ensureIdentity } from '../src/keys.mjs';
import { publishArticle } from '../src/article.mjs';
import { status } from '../src/status.mjs';
import { api } from '../src/agent-api.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-status-'));
process.env.PERMABRAIN_HOME = tmp;
process.env.PERMABRAIN_TRANSPORT = 'local';
process.env.PERMABRAIN_KEY_TYPE = 'ed25519';

initState();
await ensureIdentity(tmp, { keyType: 'ed25519' });

// Publish a couple articles
const art1 = await publishArticle({
  content: '# Alpha\n\nFirst article.',
  kind: 'subject',
  topic: 'ai',
  key: 'subject/alpha',
  title: 'Alpha',
  sourceUrl: 'https://example.com/alpha',
  sourceName: 'Example',
  language: 'en'
});

const art2 = await publishArticle({
  content: '# Beta\n\nSecond article.',
  kind: 'subject',
  topic: 'ai',
  key: 'subject/beta',
  title: 'Beta',
  sourceUrl: 'https://example.com/beta',
  sourceName: 'Example',
  language: 'en'
});

// Test 1: status function returns overview
console.log('1. status() returns working-state overview');
const s1 = await status({ home: tmp });
assert.equal(s1.home, tmp, 'status reports home');
assert.equal(s1.transport, 'local', 'transport is local');
assert.equal(s1.transportOk, true, 'local transport ok');
assert.equal(s1.summary.localArticles, 2, 'two local articles');
assert.equal(s1.summary.divergenceCount, 0, 'no divergences yet');
assert.equal(s1.summary.conflictCount, 0, 'no conflicts');
assert.equal(s1.summary.forkCount, 0, 'no forks yet');
assert.equal(s1.articles.length, 2, 'two per-key entries');
const alphaEntry = s1.articles.find((a) => a.key === 'subject/alpha');
assert.ok(alphaEntry, 'subject/alpha in articles');
assert.equal(alphaEntry.local.id, art1.summary.id, 'alpha local id matches');
assert.equal(alphaEntry.status, 'in-sync', 'alpha in sync with remote');
console.log('   ✓ status overview correct');

// Test 2: api.status() wrapper
console.log('2. api.status() wrapper');
api._home = tmp;
api._config = JSON.parse(fs.readFileSync(path.join(tmp, 'config.json'), 'utf8'));
const id = JSON.parse(fs.readFileSync(path.join(tmp, 'keys.json'), 'utf8'));
api._identity = id;
const s2 = await api.status();
assert.equal(s2.home, tmp, 'api.status reports home');
assert.equal(s2.summary.localArticles, 2, 'api.status sees two articles');
assert.equal(typeof s2.circuitBreakers, 'object', 'circuit breakers included');
assert.equal(typeof s2.metrics, 'object', 'metrics included');
console.log('   ✓ api.status() works');

// Test 3: status detects a fork
console.log('3. status detects forks');
const { forkArticle } = await import('../src/fork.mjs');
const fork = await forkArticle('subject/alpha', { content: '# Alpha Fork\n\nForked content.', topic: 'ai' });
const s3 = await status({ home: tmp });
assert.equal(s3.summary.forkCount, 1, 'one fork detected');
assert.equal(s3.forkHeads[0].sourceKey, 'subject/alpha', 'fork source recorded');
assert.equal(s3.forkHeads[0].key, fork.fork.key, 'fork key matches');
console.log('   ✓ fork detection works');

// Test 4: status includes attestation counts (none)
console.log('4. status attestation counts');
assert.equal(s3.summary.attestationTargets, 0, 'no attestation targets');
assert.equal(s3.summary.totalAttestations, 0, 'no attestations');
console.log('   ✓ attestation counts correct');

// Test 5: JSON CLI-like output structure
console.log('5. status JSON serializable');
const json = JSON.parse(JSON.stringify(s3));
assert.ok(json.summary, 'summary serializable');
assert.ok(Array.isArray(json.articles), 'articles array serializable');
console.log('   ✓ status JSON serializable');

console.log('\n✅ All status tests passed');
