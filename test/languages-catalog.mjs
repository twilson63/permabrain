/**
 * Languages catalog unit tests.
 *
 * Verifies listLanguages and languagesToMarkdown aggregation, filtering,
 * sorting, and markdown rendering.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listLanguages, languagesToMarkdown } from '../src/languages-catalog.mjs';
import { writeIndex } from '../src/cache.mjs';

function makeTempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-languages-catalog-'));
}

function buildIndex(articles) {
  return {
    articles: Object.fromEntries(articles.map((a) => [a.key, a])),
    attestations: {}
  };
}

// --- listLanguages aggregates by language ---
{
  const home = makeTempHome();
  try {
    const index = buildIndex([
      { key: 'subject/a', kind: 'subject', topic: 'ai', language: 'en', sourceName: 'src-a', authorAgentId: 'agent-1', updatedAt: '2026-01-01T00:00:00.000Z' },
      { key: 'subject/b', kind: 'subject', topic: 'ai', language: 'en', sourceName: 'src-a', authorAgentId: 'agent-1', updatedAt: '2026-01-02T00:00:00.000Z' },
      { key: 'note/c', kind: 'note', topic: 'log', language: 'en', sourceName: 'src-b', authorAgentId: 'agent-2', updatedAt: '2026-01-03T00:00:00.000Z' },
      { key: 'subject/d', kind: 'subject', topic: 'math', language: 'fr', sourceName: 'src-c', authorAgentId: 'agent-2', updatedAt: '2026-01-04T00:00:00.000Z' }
    ]);
    writeIndex(home, index);

    const report = listLanguages({ home });
    assert.equal(report.totals.languages, 2, 'two unique languages');
    assert.equal(report.totals.articles, 4, 'four articles total');
    assert.ok(report.languages.some((l) => l.name === 'en' && l.count === 3 && l.uniqueKeys === 3), 'en language aggregated');
    assert.ok(report.languages.some((l) => l.name === 'fr' && l.count === 1 && l.uniqueKeys === 1), 'fr language aggregated');

    const en = report.languages.find((l) => l.name === 'en');
    assert.equal(en.byTopic.ai, 2, 'en topic breakdown');
    assert.equal(en.byTopic.log, 1, 'en topic breakdown');
    assert.equal(en.byKind.subject, 2, 'en kind breakdown');
    assert.equal(en.byKind.note, 1, 'en kind breakdown');
    assert.equal(en.bySource['src-a'], 2, 'en source breakdown');
    assert.equal(en.bySource['src-b'], 1, 'en source breakdown');
    assert.equal(en.byAgent['agent-1'], 2, 'en agent breakdown');
    assert.equal(en.byAgent['agent-2'], 1, 'en agent breakdown');
    assert.equal(en.latestAt, '2026-01-03T00:00:00.000Z', 'latest date retained');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

// --- filters ---
{
  const home = makeTempHome();
  try {
    const index = buildIndex([
      { key: 'subject/a', kind: 'subject', topic: 'ai', language: 'en', sourceName: 'src-a', authorAgentId: 'agent-1', updatedAt: '2026-01-01T00:00:00.000Z' },
      { key: 'subject/b', kind: 'subject', topic: 'math', language: 'fr', sourceName: 'src-b', authorAgentId: 'agent-2', updatedAt: '2026-01-02T00:00:00.000Z' }
    ]);
    writeIndex(home, index);

    const byTopic = listLanguages({ home, topic: 'ai' });
    assert.equal(byTopic.totals.languages, 1, 'topic filter leaves one language');
    assert.equal(byTopic.languages[0].name, 'en', 'topic filter yields en');

    const byKind = listLanguages({ home, kind: 'subject' });
    assert.equal(byKind.totals.languages, 2, 'kind subject across both languages');

    const bySource = listLanguages({ home, source: 'src-a' });
    assert.equal(bySource.totals.languages, 1, 'source filter leaves one language');

    const byAgent = listLanguages({ home, agent: 'agent-2' });
    assert.equal(byAgent.totals.languages, 1, 'agent filter leaves one language');

    const byAfter = listLanguages({ home, after: '2026-01-01T12:00:00.000Z' });
    assert.equal(byAfter.totals.languages, 1, 'after filter leaves one language');
    assert.equal(byAfter.totals.articles, 1, 'after filter leaves one article');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

// --- sort and limit ---
{
  const home = makeTempHome();
  try {
    const index = buildIndex([
      { key: 'alpha/1', kind: 'note', topic: 't', language: 'alpha', sourceName: 's', authorAgentId: 'a', updatedAt: '2026-01-01T00:00:00.000Z' },
      { key: 'beta/1', kind: 'note', topic: 't', language: 'beta', sourceName: 's', authorAgentId: 'a', updatedAt: '2026-01-02T00:00:00.000Z' },
      { key: 'beta/2', kind: 'note', topic: 't', language: 'beta', sourceName: 's', authorAgentId: 'a', updatedAt: '2026-01-03T00:00:00.000Z' },
      { key: 'gamma/1', kind: 'note', topic: 't', language: 'gamma', sourceName: 's', authorAgentId: 'a', updatedAt: '2026-01-04T00:00:00.000Z' }
    ]);
    writeIndex(home, index);

    const byName = listLanguages({ home, sort: 'name' });
    assert.deepEqual(byName.languages.map((l) => l.name), ['alpha', 'beta', 'gamma'], 'name sort ascending');

    const byLatest = listLanguages({ home, sort: 'latest' });
    assert.equal(byLatest.languages[0].name, 'gamma', 'latest sort descending');

    const limited = listLanguages({ home, limit: 2 });
    assert.equal(limited.languages.length, 2, 'limit respected');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

// --- languagesToMarkdown output ---
{
  const report = listLanguages({ home: makeTempHome() });
  const md = languagesToMarkdown(report);
  assert.ok(md.startsWith('# PermaBrain Languages'), 'markdown header');
  assert.ok(md.includes('No languages found.'), 'empty catalog message');

  const home = makeTempHome();
  try {
    const index = buildIndex([
      { key: 'subject/x', kind: 'subject', topic: 'ai', language: 'en', sourceName: 'src', authorAgentId: 'agent', updatedAt: '2026-01-01T00:00:00.000Z' }
    ]);
    writeIndex(home, index);
    const r = listLanguages({ home });
    const md2 = languagesToMarkdown(r);
    assert.ok(md2.includes('| Language | Articles | Unique keys | Latest | Topics | Kinds | Sources | Agents |'), 'markdown table header');
    assert.ok(md2.includes('| en | 1 | 1 |'), 'markdown language row');
    assert.ok(md2.includes('ai:1'), 'markdown topic breakdown');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

console.log('languages-catalog tests passed');
