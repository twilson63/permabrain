/**
 * Test: Stats dashboard (`permabrain stats` / `api.stats`)
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { computeStats, statsToMarkdown } from '../src/stats.mjs';
import { writeIndex } from '../src/cache.mjs';
import { runCommand } from '../src/commands.mjs';
import { api } from '../src/index.mjs';

function makeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-stats-'));
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
console.log('1. Empty index stats');
const emptyHome = makeHome();
const empty = computeStats({ home: emptyHome });
assert.equal(empty.totals.articles, 0, 'empty articles');
assert.equal(empty.totals.attestations, 0, 'empty attestations');
assert.equal(empty.totals.agentCount, 0, 'empty agent count');
assert.equal(empty.totals.topicCount, 0, 'empty topic count');
assert.equal(empty.totals.kindCount, 0, 'empty kind count');
assert.deepEqual(empty.totals.uniqueAgents, [], 'empty agents list');
assert.deepEqual(empty.totals.topics, [], 'empty topics list');
assert.deepEqual(empty.totals.kinds, [], 'empty kinds list');
assert.equal(empty.consensus.attestedArticles, 0, 'empty attested articles');
assert.ok(statsToMarkdown(empty).includes('Articles: 0'), 'markdown shows 0 articles');
console.log('   ✓ Empty stats OK');

// --- 2. Full dashboard aggregation ---
console.log('2. Full stats dashboard');
const home = makeHome();
seedIndex(home);
const report = computeStats({ home });
assert.equal(report.totals.articles, 3, 'total articles');
assert.equal(report.totals.attestations, 3, 'total attestations');
assert.equal(report.totals.agentCount, 3, 'agent count');
assert.equal(report.totals.topicCount, 3, 'topic count');
assert.equal(report.totals.kindCount, 2, 'kind count');
assert.deepEqual(report.totals.uniqueAgents.sort(), ['agent-one', 'agent-three', 'agent-two'].sort(), 'agents list');
assert.deepEqual(report.totals.topics.sort(), ['ai', 'computing', 'internal'].sort(), 'topics list');
assert.deepEqual(report.totals.kinds.sort(), ['person', 'subject'].sort(), 'kinds list');
assert.equal(report.consensus.attestedArticles, 2, 'attested articles for consensus');
assert.equal(report.consensus.unattestedArticles, 1, 'unattested articles');
assert.ok(report.consensus.averageConsensus > 0, 'average consensus present');
assert.ok(report.consensus.medianConsensus <= report.consensus.averageConsensus + 1, 'median consensus present');
assert.equal(report.agents.total, 3, 'agents total');
assert.equal(report.agents.topAgents.length, 3, 'top agents count');
const topAgent = report.agents.topAgents[0];
assert.equal(topAgent.agentId, 'agent-two', 'top agent by total activity');
assert.equal(topAgent.articles, 1, 'agent-two articles');
assert.equal(topAgent.attestations, 2, 'agent-two attestations');
assert.equal(report.activity.timeline.length, 3, 'timeline days');
assert.ok(report.activity.active7d >= 0, 'active7d');
assert.ok(report.activity.active30d >= 0, 'active30d');
assert.ok(report.activity.latestArticle, 'latest article');
assert.ok(report.activity.latestAttestation, 'latest attestation');
console.log('   ✓ Full dashboard OK');

// --- 3. Markdown export includes dashboard sections ---
console.log('3. Markdown export');
const md = statsToMarkdown(report);
assert.ok(md.includes('PermaBrain Stats Dashboard'), 'title');
assert.ok(md.includes('Agents'), 'agents section');
assert.ok(md.includes('Consensus'), 'consensus section');
assert.ok(md.includes('Score distribution'), 'score distribution section');
assert.ok(md.includes('Timeline'), 'timeline section');
assert.ok(md.includes('Latest article'), 'latest article line');
assert.ok(md.includes('Latest attestation'), 'latest attestation line');
console.log('   ✓ Markdown export OK');

// --- 4. CLI command ---
console.log('4. CLI stats command');
const cliHome = makeHome();
seedIndex(cliHome);
process.env.PERMABRAIN_HOME = cliHome;
const cliResult = await runCommand('stats', { json: true });
assert.equal(cliResult.totals.articles, 3, 'CLI total articles');
assert.equal(cliResult.totals.agentCount, 3, 'CLI agent count');
assert.equal(cliResult.totals.topicCount, 3, 'CLI topic count');
assert.equal(cliResult.consensus.attestedArticles, 2, 'CLI attested articles');
console.log('   ✓ CLI command OK');

// --- 5. Agent API method ---
console.log('5. Agent API stats');
const apiHome = makeHome();
seedIndex(apiHome);
process.env.PERMABRAIN_HOME = apiHome;
const apiReport = await api.stats({ topic: 'ai' });
assert.equal(apiReport.totals.articles, 1, 'api stats topic filter');
assert.equal(apiReport.totals.agentCount, 3, 'api stats agents for topic ai');
assert.equal(typeof api.stats, 'function', 'api.stats is a function');
console.log('   ✓ Agent API OK');

// --- 6. Filters affect stats ---
console.log('6. Filters');
const kindFilter = computeStats({ home, kind: 'person' });
assert.equal(kindFilter.totals.articles, 1, 'kind filter');
assert.equal(kindFilter.totals.agentCount, 2, 'kind filter agents');
assert.equal(kindFilter.totals.topicCount, 1, 'kind filter topics');

const authorFilter = computeStats({ home, author: 'agent-two' });
assert.equal(authorFilter.totals.articles, 1, 'author filter');
assert.equal(authorFilter.totals.agentCount, 1, 'author filter agents');
assert.equal(authorFilter.totals.encryptedArticles, 1, 'author filter encrypted');
console.log('   ✓ Filters OK');

// --- 7. Module exports ---
console.log('7. Module exports');
import { computeStats as barrelCompute, statsToMarkdown as barrelMarkdown } from '../src/index.mjs';
assert.equal(typeof barrelCompute, 'function', 'barrel computeStats');
assert.equal(typeof barrelMarkdown, 'function', 'barrel statsToMarkdown');
console.log('   ✓ Module exports OK');

console.log('\n✅ All stats tests passed');
