/**
 * Test: sources-catalog.mjs
 *
 * Verifies the Sources catalog aggregates article source metadata from the
 * local cache index, supports sort/limit/filters, and renders Markdown.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { listSources, sourcesToMarkdown } = await import('../src/sources-catalog.mjs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-sources-test-'));
const home = path.join(tmp, 'pb');
fs.mkdirSync(home, { recursive: true });
fs.mkdirSync(path.join(home, 'cache'), { recursive: true });

function writeIndex(articles = {}) {
  fs.writeFileSync(
    path.join(home, 'cache', 'index.json'),
    JSON.stringify({ articles, attestations: {}, updatedAt: new Date().toISOString() }, null, 2)
  );
}

function articleSummary(key, opts = {}) {
  return {
    id: opts.id || `id-${key}`,
    key,
    kind: opts.kind || 'subject',
    title: opts.title || key,
    slug: opts.slug || key,
    topic: opts.topic || 'ai',
    language: opts.language || 'en',
    version: opts.version || 1,
    previousId: null,
    rootId: null,
    sourceName: opts.sourceName || 'unknown',
    sourceUrl: opts.sourceUrl || null,
    contentHash: opts.contentHash || 'hash',
    updatedAt: opts.updatedAt || new Date().toISOString(),
    authorAgentId: opts.authorAgentId || 'agent-a',
    visibility: 'public'
  };
}

console.log('1. Empty catalog');
writeIndex({});
const empty = listSources({ home });
assert.equal(empty.sources.length, 0, 'empty catalog has no sources');
assert.equal(empty.totals.sources, 0);
assert.equal(empty.totals.articles, 0);
console.log('   ✓ Empty catalog');

console.log('2. Aggregates sources by name+url');
writeIndex({
  'a/1': articleSummary('a/1', { sourceName: 'Wikipedia', sourceUrl: 'https://en.wikipedia.org/wiki/A', kind: 'subject', topic: 'science', authorAgentId: 'agent-a' }),
  'a/2': articleSummary('a/2', { sourceName: 'Wikipedia', sourceUrl: 'https://en.wikipedia.org/wiki/A', kind: 'subject', topic: 'science', authorAgentId: 'agent-a' }),
  'b/1': articleSummary('b/1', { sourceName: 'GitHub', sourceUrl: 'https://github.com/b', kind: 'note', topic: 'dev', authorAgentId: 'agent-b', language: 'es' })
});
const agg = listSources({ home });
assert.equal(agg.sources.length, 2, 'two unique sources');
assert.equal(agg.totals.articles, 3);
const wiki = agg.sources.find((s) => s.name === 'Wikipedia');
assert.ok(wiki, 'wikipedia source exists');
assert.equal(wiki.count, 2);
assert.equal(wiki.uniqueKeys, 2);
assert.equal(wiki.url, 'https://en.wikipedia.org/wiki/A');
const github = agg.sources.find((s) => s.name === 'GitHub');
assert.equal(github.count, 1);
assert.equal(github.uniqueKeys, 1);
assert.equal(github.byTopic.dev, 1);
assert.equal(github.byLanguage.es, 1);
console.log('   ✓ Aggregation');

console.log('3. Sort options');
const byCount = listSources({ home, sort: 'count' });
assert.equal(byCount.sources[0].name, 'Wikipedia');
const byName = listSources({ home, sort: 'name' });
assert.equal(byName.sources[0].name, 'GitHub');
const byLatest = listSources({ home, sort: 'latest' });
assert.ok(byLatest.sources.length > 0);
console.log('   ✓ Sort');

console.log('4. Limit');
const limited = listSources({ home, limit: 1 });
assert.equal(limited.sources.length, 1);
console.log('   ✓ Limit');

console.log('5. Filters');
const byKind = listSources({ home, kind: 'note' });
assert.equal(byKind.sources.length, 1);
assert.equal(byKind.sources[0].name, 'GitHub');
const byTopic = listSources({ home, topic: 'science' });
assert.equal(byTopic.sources.length, 1);
assert.equal(byTopic.sources[0].name, 'Wikipedia');
const byNameF = listSources({ home, name: 'git' });
assert.equal(byNameF.sources.length, 1);
assert.equal(byNameF.sources[0].name, 'GitHub');
const byUrl = listSources({ home, url: 'wikipedia' });
assert.equal(byUrl.sources.length, 1);
assert.equal(byUrl.sources[0].name, 'Wikipedia');
const byAgent = listSources({ home, agentId: 'agent-b' });
assert.equal(byAgent.sources.length, 1);
assert.equal(byAgent.sources[0].name, 'GitHub');
console.log('   ✓ Filters');

console.log('6. Markdown rendering');
const md = sourcesToMarkdown(agg);
assert.ok(md.includes('# PermaBrain Sources'));
assert.ok(md.includes('Wikipedia'));
assert.ok(md.includes('https://en.wikipedia.org/wiki/A'));
assert.ok(md.includes('| Source |'));
console.log('   ✓ Markdown');

console.log('7. Unknown/null source names');
writeIndex({
  'x/1': articleSummary('x/1', { sourceName: null, sourceUrl: null }),
  'x/2': articleSummary('x/2', { sourceName: null, sourceUrl: null })
});
const unknown = listSources({ home });
assert.equal(unknown.sources.length, 1);
assert.equal(unknown.sources[0].name, 'unknown');
assert.equal(unknown.sources[0].count, 2);
console.log('   ✓ Unknown handling');

console.log('All sources-catalog tests passed.');
