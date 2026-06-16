/**
 * Test: Article metrics (`permabrain metrics` / `api.metrics`)
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { computeMetrics, metricsToMarkdown } from '../src/article-metrics.mjs';
import { writeIndex } from '../src/cache.mjs';
import { runCommand } from '../src/commands.mjs';
import { api } from '../src/index.mjs';

function makeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-metrics-'));
  fs.mkdirSync(path.join(home, 'cache'), { recursive: true });
  return home;
}

function seedIndex(home) {
  const articles = {
    'subject/ai': {
      id: 'art-ai-1',
      key: 'subject/ai',
      kind: 'subject',
      title: 'Artificial Intelligence',
      slug: 'ai',
      topic: 'ai',
      language: 'en',
      version: 1,
      previousId: null,
      rootId: null,
      sourceName: 'Wikipedia',
      sourceUrl: 'https://en.wikipedia.org/wiki/AI',
      contentHash: 'sha256:aa',
      updatedAt: '2026-06-15T10:00:00.000Z',
      authorAgentId: 'agent-one',
      visibility: 'public'
    },
    'person/ada-lovelace': {
      id: 'art-ada-1',
      key: 'person/ada-lovelace',
      kind: 'person',
      title: 'Ada Lovelace',
      slug: 'ada-lovelace',
      topic: 'computing',
      language: 'en',
      version: 2,
      previousId: 'art-ada-0',
      rootId: 'art-ada-0',
      sourceName: 'Wikipedia',
      sourceUrl: 'https://en.wikipedia.org/wiki/Ada_Lovelace',
      contentHash: 'sha256:bb',
      updatedAt: '2026-06-14T09:00:00.000Z',
      authorAgentId: 'agent-one',
      visibility: 'public'
    },
    'subject/internal': {
      id: 'art-int-1',
      key: 'subject/internal',
      kind: 'subject',
      title: 'Internal Notes',
      slug: 'internal',
      topic: 'internal',
      language: 'en',
      version: 1,
      previousId: null,
      rootId: null,
      sourceName: 'Local',
      sourceUrl: 'https://example.com/internal',
      contentHash: 'sha256:cc',
      updatedAt: '2026-06-16T08:00:00.000Z',
      authorAgentId: 'agent-two',
      visibility: 'encrypted'
    }
  };
  const attestations = {
    'subject/ai': [
      {
        id: 'att-ai-1',
        targetId: 'art-ai-1',
        targetKey: 'subject/ai',
        opinion: 'valid',
        confidence: 0.95,
        reason: 'Good',
        agentId: 'agent-two',
        sourceUrl: null,
        createdAt: '2026-06-15T11:00:00.000Z'
      },
      {
        id: 'att-ai-2',
        targetId: 'art-ai-1',
        targetKey: 'subject/ai',
        opinion: 'valid',
        confidence: 0.85,
        reason: 'Accurate',
        agentId: 'agent-three',
        sourceUrl: null,
        createdAt: '2026-06-15T12:00:00.000Z'
      }
    ],
    'person/ada-lovelace': [
      {
        id: 'att-ada-1',
        targetId: 'art-ada-1',
        targetKey: 'person/ada-lovelace',
        opinion: 'outdated',
        confidence: 0.6,
        reason: 'Needs refresh',
        agentId: 'agent-two',
        sourceUrl: null,
        createdAt: '2026-06-14T10:00:00.000Z'
      }
    ]
  };
  writeIndex(home, { articles, attestations, updatedAt: new Date().toISOString() });
}

// --- 1. Empty index returns zeroed report ---
console.log('1. Empty index metrics');
const emptyHome = makeHome();
const empty = computeMetrics({ home: emptyHome });
assert.equal(empty.totals.articles, 0, 'empty articles');
assert.equal(empty.totals.attestations, 0, 'empty attestations');
assert.equal(empty.totals.attestedArticles, 0, 'empty attested articles');
assert.equal(empty.totals.unattestedArticles, 0, 'empty unattested articles');
assert.equal(empty.totals.encryptedArticles, 0, 'empty encrypted');
assert.ok(metricsToMarkdown(empty).includes('Articles: 0'), 'markdown shows 0 articles');
console.log('   ✓ Empty metrics OK');

// --- 2. Full metrics aggregation ---
console.log('2. Full metrics aggregation');
const home = makeHome();
seedIndex(home);
const report = computeMetrics({ home });
assert.equal(report.totals.articles, 3, 'total articles');
assert.equal(report.totals.attestations, 3, 'total attestations');
assert.equal(report.totals.attestedArticles, 2, 'attested articles');
assert.equal(report.totals.unattestedArticles, 1, 'unattested articles');
assert.equal(report.totals.encryptedArticles, 1, 'encrypted articles');
assert.equal(report.totals.publicArticles, 2, 'public articles');
assert.equal(report.totals.totalVersions, 1 + 2 + 1, 'total versions');
assert.ok(report.totals.averageVersion > 1.3, 'average version');
assert.equal(report.articles.byKind.subject, 2, 'byKind subject');
assert.equal(report.articles.byKind.person, 1, 'byKind person');
assert.equal(report.articles.byTopic.ai, 1, 'byTopic ai');
assert.equal(report.articles.byTopic.computing, 1, 'byTopic computing');
assert.equal(report.articles.byAuthor['agent-one'], 2, 'byAuthor agent-one');
assert.equal(report.attestations.byOpinion.valid, 2, 'valid attestations');
assert.equal(report.attestations.byOpinion.outdated, 1, 'outdated attestations');
assert.ok(Math.abs(report.attestations.averageConfidence - (0.95 + 0.85 + 0.6) / 3) < 0.0001, 'average confidence');
assert.equal(report.attestations.topAttested[0].key, 'subject/ai', 'top attested key');
assert.equal(report.attestations.topAttested[0].count, 2, 'top attested count');
assert.equal(report.activity.firstEvent, '2026-06-14T09:00:00.000Z', 'first event');
assert.equal(report.activity.lastEvent, '2026-06-16T08:00:00.000Z', 'last event');
assert.equal(report.activity.peakDay, '2026-06-15', 'peak day');
assert.ok(metricsToMarkdown(report).includes('subject/ai: 2'), 'markdown top attested');
console.log('   ✓ Full aggregation OK');

// --- 3. Filters ---
console.log('3. Filters');
const kindFilter = computeMetrics({ home, kind: 'person' });
assert.equal(kindFilter.totals.articles, 1, 'kind filter');
assert.equal(kindFilter.totals.attestations, 1, 'kind filter attestations');

const topicFilter = computeMetrics({ home, topic: 'ai' });
assert.equal(topicFilter.totals.articles, 1, 'topic filter');
assert.equal(topicFilter.attestations.topAttested[0].key, 'subject/ai', 'topic filter top attested');

const authorFilter = computeMetrics({ home, author: 'agent-two' });
assert.equal(authorFilter.totals.articles, 1, 'author filter');
assert.equal(authorFilter.totals.encryptedArticles, 1, 'author filter encrypted');

const afterFilter = computeMetrics({ home, after: '2026-06-15' });
assert.equal(afterFilter.totals.articles, 2, 'after filter');

const beforeFilter = computeMetrics({ home, before: '2026-06-15' });
assert.equal(beforeFilter.totals.articles, 1, 'before filter');
console.log('   ✓ Filters OK');

// --- 4. CLI command ---
console.log('4. CLI metrics command');
const cliHome = makeHome();
seedIndex(cliHome);
process.env.PERMABRAIN_HOME = cliHome;
const cliResult = await runCommand('metrics', { json: true });
assert.equal(cliResult.totals.articles, 3, 'CLI total articles');
assert.equal(cliResult.totals.attestations, 3, 'CLI total attestations');
console.log('   ✓ CLI command OK');

// --- 5. Agent API method ---
console.log('5. Agent API metrics');
const apiHome = makeHome();
seedIndex(apiHome);
process.env.PERMABRAIN_HOME = apiHome;
const apiReport = await api.metrics({ topic: 'ai' });
assert.equal(apiReport.totals.articles, 1, 'api metrics topic filter');
assert.equal(apiReport.totals.attestations, 2, 'api metrics attestations');
assert.equal(typeof api.metrics, 'function', 'api.metrics is a function');
console.log('   ✓ Agent API OK');

// --- 6. Module exports ---
console.log('6. Module exports');
import { computeMetrics as barrelCompute, metricsToMarkdown as barrelMarkdown } from '../src/index.mjs';
assert.equal(typeof barrelCompute, 'function', 'barrel computeMetrics');
assert.equal(typeof barrelMarkdown, 'function', 'barrel metricsToMarkdown');
console.log('   ✓ Module exports OK');

console.log('\n✅ All metrics tests passed');
