/**
 * Kinds catalog unit tests.
 *
 * Verifies listKinds and kindsToMarkdown aggregation, filtering,
 * sorting, and markdown rendering.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listKinds, kindsToMarkdown } from '../src/kinds-catalog.mjs';
import { writeIndex } from '../src/cache.mjs';

function makeTempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-kinds-catalog-'));
}

function buildIndex(articles) {
  return {
    articles: Object.fromEntries(articles.map((a) => [a.key, a])),
    attestations: {}
  };
}

// --- listKinds aggregates by kind ---
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

    const report = listKinds({ home });
    assert.equal(report.totals.kinds, 2, 'two unique kinds');
    assert.equal(report.totals.articles, 4, 'four articles total');
    assert.ok(report.kinds.some((k) => k.name === 'subject' && k.count === 3 && k.uniqueKeys === 3), 'subject kind aggregated');
    assert.ok(report.kinds.some((k) => k.name === 'note' && k.count === 1 && k.uniqueKeys === 1), 'note kind aggregated');

    const subject = report.kinds.find((k) => k.name === 'subject');
    assert.equal(subject.byTopic.ai, 2, 'subject topic breakdown');
    assert.equal(subject.byTopic.math, 1, 'subject topic breakdown');
    assert.equal(subject.byLanguage.en, 2, 'subject language breakdown');
    assert.equal(subject.byLanguage.fr, 1, 'subject language breakdown');
    assert.equal(subject.bySource['src-a'], 2, 'subject source breakdown');
    assert.equal(subject.bySource['src-c'], 1, 'subject source breakdown');
    assert.equal(subject.byAgent['agent-1'], 2, 'subject agent breakdown');
    assert.equal(subject.byAgent['agent-2'], 1, 'subject agent breakdown');
    assert.equal(subject.latestAt, '2026-01-04T00:00:00.000Z', 'latest date retained');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

// --- sort and limit ---
{
  const home = makeTempHome();
  try {
    const index = buildIndex([
      { key: 'kind-a/1', kind: 'alpha', updatedAt: '2026-01-01T00:00:00.000Z' },
      { key: 'kind-b/1', kind: 'beta', updatedAt: '2026-01-02T00:00:00.000Z' },
      { key: 'kind-b/2', kind: 'beta', updatedAt: '2026-01-03T00:00:00.000Z' },
      { key: 'kind-c/1', kind: 'gamma', updatedAt: '2026-01-04T00:00:00.000Z' }
    ]);
    writeIndex(home, index);

    const byName = listKinds({ home, sort: 'name' });
    assert.deepEqual(byName.kinds.map((k) => k.name), ['alpha', 'beta', 'gamma'], 'name sort ascending');

    const byLatest = listKinds({ home, sort: 'latest' });
    assert.equal(byLatest.kinds[0].name, 'gamma', 'latest sort descending');

    const limited = listKinds({ home, limit: 2 });
    assert.equal(limited.kinds.length, 2, 'limit respected');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

// --- kindsToMarkdown output ---
{
  const report = listKinds({ home: makeTempHome() });
  const md = kindsToMarkdown(report);
  assert.ok(md.startsWith('# PermaBrain Kinds'), 'markdown header');
  assert.ok(md.includes('No kinds found.'), 'empty catalog message');

  const home = makeTempHome();
  try {
    const index = buildIndex([
      { key: 'subject/x', kind: 'subject', topic: 'ai', language: 'en', sourceName: 'src', authorAgentId: 'agent', updatedAt: '2026-01-01T00:00:00.000Z' }
    ]);
    writeIndex(home, index);
    const r = listKinds({ home });
    const md2 = kindsToMarkdown(r);
    assert.ok(md2.includes('| Kind | Articles | Unique keys | Latest | Topics | Languages | Sources | Agents |'), 'markdown table header');
    assert.ok(md2.includes('| subject | 1 | 1 |'), 'markdown kind row');
    assert.ok(md2.includes('ai:1'), 'markdown topic breakdown');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

console.log('kinds-catalog tests passed');
