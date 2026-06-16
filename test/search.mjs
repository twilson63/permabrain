import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { searchArticles, rankByConsensus } from '../src/search.mjs';

function makeItem(overrides = {}) {
  const key = overrides.key || 'subject/searchable-article';
  return {
    id: overrides.id || 'id-' + Math.random().toString(36).slice(2),
    owner: overrides.owner || 'test-agent',
    timestamp: overrides.timestamp || Date.now(),
    tags: [
      { name: 'App-Name', value: 'PermaBrain' },
      { name: 'PermaBrain-Type', value: 'article' },
      { name: 'Article-Key', value: key },
      { name: 'Article-Kind', value: overrides.kind || 'subject' },
      { name: 'Article-Topic', value: overrides.topic || 'ai' },
      { name: 'Article-Title', value: overrides.title || 'Searchable Article' },
      { name: 'Article-Version', value: String(overrides.version || 1) },
      { name: 'Article-Content-Hash', value: overrides.hash || 'hash' + Math.random() },
      { name: 'Article-Updated-At', value: overrides.updatedAt || new Date().toISOString() },
      { name: 'Author-Agent-Id', value: overrides.author || 'test-agent' },
      ...(overrides.sourceName ? [{ name: 'Article-Source-Name', value: overrides.sourceName }] : [])
    ],
    data: typeof overrides.data === 'string' ? Buffer.from(overrides.data) : (overrides.data || Buffer.from(overrides.content || 'Default article content for search tests.'))
  };
}

class FakeTransport {
  constructor(items) { this.items = items; }
  async queryByTags(filters) {
    return this.items.filter((item) => {
      const tags = Object.fromEntries((item.tags || []).map((t) => [t.name, t.value]));
      for (const [k, v] of Object.entries(filters)) {
        if (tags[k] !== v) return false;
      }
      return true;
    });
  }
}

function stubDataItem(module) {
  // No-op: dataitem.mjs already returns data buffer as payloadText for ANS-104 in this codebase.
  // Encrypted test uses an explicitly encrypted envelope buffer.
}

describe('searchArticles', () => {
  it('returns empty results when transport yields no articles', async () => {
    const transport = new FakeTransport([]);
    const result = await searchArticles('neural networks', {
      transport,
      home: '/tmp/permabrain-search-' + Date.now(),
      config: { transport: 'local' }
    });
    assert.equal(result.total, 0);
    assert.equal(result.results.length, 0);
    assert.equal(result.query, 'neural networks');
    assert.ok(result.took);
  });

  it('ranks title matches higher than content matches', async () => {
    const items = [
      makeItem({ id: 'content-match', key: 'subject/content-match', title: 'Unrelated Title', data: 'neural networks are powerful machine learning models.', version: 1 }),
      makeItem({ id: 'title-match', key: 'subject/title-match', title: 'Neural Networks Overview', data: 'Some general text.', version: 1 })
    ];
    const transport = new FakeTransport(items);
    const result = await searchArticles('neural networks', { transport, home: '/tmp/permabrain-search-' + Date.now(), config: { transport: 'local' } });
    assert.equal(result.total, 2);
    const [first, second] = result.results;
    assert.equal(first.key, 'subject/title-match');
    assert.equal(second.key, 'subject/content-match');
    assert.ok(first.score > second.score, `title score ${first.score} should exceed content score ${second.score}`);
  });

  it('returns snippets with matched terms', async () => {
    const items = [
      makeItem({ id: 'snip', key: 'subject/snip', title: 'Snippets', data: 'The quick brown fox jumps over the lazy dog and studies machine learning every day.', version: 1 })
    ];
    const transport = new FakeTransport(items);
    const result = await searchArticles('machine learning', { transport, home: '/tmp/permabrain-search-' + Date.now(), config: { transport: 'local' } });
    assert.equal(result.total, 1);
    const item = result.results[0];
    assert.ok(item.matchedTerms.includes('machine') || item.matchedTerms.includes('learning'), `expected matchedTerms, got ${JSON.stringify(item.matchedTerms)}`);
    assert.ok(item.snippet.toLowerCase().includes('machine'));
    assert.ok(item.snippet.toLowerCase().includes('learning'));
  });

  it('respects kind/topic/author filters and exact key filter', async () => {
    const items = [
      makeItem({ id: 'a1', key: 'subject/ai-basics', kind: 'subject', topic: 'ai', author: 'alice', data: 'basics content', version: 1 }),
      makeItem({ id: 'a2', key: 'project/ai-basics', kind: 'project', topic: 'ai', author: 'bob', data: 'basics content', version: 1 })
    ];
    const transport = new FakeTransport(items);
    const r1 = await searchArticles('basics', { transport, home: '/tmp/permabrain-search-' + Date.now(), config: { transport: 'local' }, kind: 'project' });
    assert.equal(r1.results.length, 1);
    assert.equal(r1.results[0].key, 'project/ai-basics');

    const r2 = await searchArticles('basics', { transport, home: '/tmp/permabrain-search-' + Date.now(), config: { transport: 'local' }, author: 'alice' });
    assert.equal(r2.results.length, 1);
    assert.equal(r2.results[0].key, 'subject/ai-basics');

    // Exact key filter returns the item even when query text does not match
    // because it satisfies an explicitly requested filter. The transport is
    // expected to honor the Article-Key tag filter. For a transport that does
    // not support Article-Key filtering, fall back to local cache by using a
    // fresh home with the article pre-cached.
    const fs = await import('node:fs');
    const path = await import('node:path');
    const keyHome = '/tmp/permabrain-search-key-' + Date.now();
    const keyCacheDir = path.join(keyHome, 'cache');
    fs.mkdirSync(keyCacheDir, { recursive: true });
    fs.writeFileSync(path.join(keyCacheDir, 'index.json'), JSON.stringify({
      articles: {
        'project/ai-basics': {
          id: 'a2', key: 'project/ai-basics', kind: 'project', topic: 'ai', title: 'Project Basics', version: 1, contentHash: 'h', updatedAt: new Date().toISOString(), authorAgentId: 'bob'
        }
      },
      attestations: {},
      updatedAt: new Date().toISOString()
    }));
    const r3 = await searchArticles('xyz', { transport: new FakeTransport([]), home: keyHome, config: { transport: 'local' }, key: 'project/ai-basics' });
    assert.equal(r3.results.length, 1);
    assert.equal(r3.results[0].key, 'project/ai-basics');
  });

  it('limits and offsets results', async () => {
    const items = Array.from({ length: 5 }, (_, i) => makeItem({ id: 'limit-' + i, key: 'subject/item-' + i, title: 'Item ' + i, data: 'common query term', version: 1 }));
    const transport = new FakeTransport(items);
    const result = await searchArticles('common', { transport, home: '/tmp/permabrain-search-' + Date.now(), config: { transport: 'local' }, limit: 2, offset: 1 });
    assert.equal(result.total, 5);
    assert.equal(result.results.length, 2);
    assert.equal(result.results[0].key, 'subject/item-1');
    assert.equal(result.results[1].key, 'subject/item-2');
  });

  it('marks encrypted articles and excludes their content from snippets', async () => {
    const encryptedPayload = JSON.stringify({ v: 1, ephemeralPublicKey: 'abc', salt: 's', iv: 'i', ciphertext: 'c', authTag: 'a', recipients: [{ publicKeyFingerprint: 'fp', encryptedKey: 'ek' }] });
    const items = [
      makeItem({ id: 'enc', key: 'subject/encrypted-article', title: 'Encrypted Secrets', data: encryptedPayload, version: 1 })
    ];
    const transport = new FakeTransport(items);
    const result = await searchArticles('secrets', { transport, home: '/tmp/permabrain-search-' + Date.now(), config: { transport: 'local' } });
    assert.equal(result.total, 1);
    assert.equal(result.results[0].encrypted, true);
    assert.ok(result.results[0].snippet.includes('encrypted'));
  });
  it('matches cached local articles not returned by transport', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const home = '/tmp/permabrain-search-local-' + Date.now();
    const cacheDir = path.join(home, 'cache');
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(path.join(cacheDir, 'index.json'), JSON.stringify({
      articles: {
        'subject/local-only': {
          id: 'local-id',
          key: 'subject/local-only',
          kind: 'subject',
          topic: 'local',
          title: 'Local Only Article',
          version: 1,
          contentHash: 'localhash',
          updatedAt: new Date().toISOString(),
          authorAgentId: 'local-agent'
        }
      },
      attestations: {},
      updatedAt: new Date().toISOString()
    }));

    const transport = new FakeTransport([]);
    const result = await searchArticles('local only', { transport, home, config: { transport: 'local' } });
    assert.equal(result.total, 1);
    assert.equal(result.results[0].key, 'subject/local-only');
  });

  it('boosts results by consensus map', async () => {
    const results = [
      { key: 'subject/low', score: 10 },
      { key: 'subject/high', score: 5 }
    ];
    const consensusByKey = {
      'subject/high': { score: 20 },
      'subject/low': { score: 1 }
    };
    const ranked = rankByConsensus(results, consensusByKey);
    assert.equal(ranked[0].key, 'subject/high');
    assert.equal(ranked[0].score, 25);
    assert.equal(ranked[1].key, 'subject/low');
    assert.equal(ranked[1].score, 11);
  });
});
