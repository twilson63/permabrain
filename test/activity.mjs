/**
 * Test: activity feed
 *
 * Covers activityFeed with mocked local transport and cached entries.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { activityFeed, activityToMarkdown } from '../src/activity.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-activity-'));
const home = tmp;

function makeArticle({ id, key, title = 'Untitled', kind = 'subject', topic = 'ai', version = 1, agentId = 'agent-1', updatedAt, sourceUrl = null, sourceName = null, extraTags = [] }) {
  const updated = updatedAt || new Date().toISOString();
  return {
    id,
    owner: agentId,
    timestamp: updated,
    tags: [
      { name: 'App-Name', value: 'PermaBrain' },
      { name: 'PermaBrain-Type', value: 'article' },
      { name: 'Article-Key', value: key },
      { name: 'Article-Title', value: title },
      { name: 'Article-Kind', value: kind },
      { name: 'Article-Topic', value: topic },
      { name: 'Article-Language', value: 'en' },
      { name: 'Article-Version', value: String(version) },
      { name: 'Article-Updated-At', value: updated },
      { name: 'Article-Content-Hash', value: 'sha256:abc' },
      { name: 'Author-Agent-Id', value: agentId },
      ...(sourceUrl ? [{ name: 'Article-Source-Url', value: sourceUrl }] : []),
      ...(sourceName ? [{ name: 'Article-Source-Name', value: sourceName }] : []),
      ...extraTags
    ],
    data: Buffer.from('hello world', 'utf8').toString('base64url')
  };
}

function makeAttestation({ id, targetId, targetKey, opinion = 'valid', confidence = 0.9, reason = 'Good', agentId = 'agent-1', createdAt }) {
  const ts = createdAt || new Date().toISOString();
  return {
    id,
    owner: agentId,
    timestamp: ts,
    tags: [
      { name: 'App-Name', value: 'PermaBrain' },
      { name: 'PermaBrain-Type', value: 'attestation' },
      { name: 'Attestation-Target-Id', value: targetId },
      { name: 'Attestation-Target-Key', value: targetKey },
      { name: 'Attestation-Opinion', value: opinion },
      { name: 'Attestation-Confidence', value: String(confidence) },
      { name: 'Attestation-Reason', value: reason },
      { name: 'Attestation-Agent-Id', value: agentId },
      { name: 'Attestation-Created-At', value: ts }
    ],
    data: Buffer.from('{}', 'utf8').toString('base64url')
  };
}

function makeTransport(items = []) {
  return {
    async queryByTags(filters) {
      return items.filter((item) => {
        const obj = Object.fromEntries(item.tags.map((t) => [t.name, t.value]));
        return Object.entries(filters).every(([k, v]) => obj[k] === String(v));
      });
    }
  };
}

function writeIndex(index) {
  fs.mkdirSync(path.join(home, 'cache'), { recursive: true });
  fs.writeFileSync(path.join(home, 'cache', 'index.json'), JSON.stringify(index, null, 2));
}

// Test 1: basic activity feed returns publish + attest events
{
  console.log('1. Basic activity feed');
  const transport = makeTransport([
    makeArticle({ id: 'a1', key: 'ai/first', title: 'First', updatedAt: '2026-06-15T10:00:00.000Z' }),
    makeArticle({ id: 'a2', key: 'ai/second', title: 'Second', updatedAt: '2026-06-15T11:00:00.000Z' }),
    makeAttestation({ id: 'att1', targetId: 'a1', targetKey: 'ai/first', createdAt: '2026-06-15T12:00:00.000Z', agentId: 'agent-2' })
  ]);
  const result = await activityFeed({ home, transport });
  assert.equal(result.total, 3);
  assert.equal(result.events.length, 3);
  assert.equal(result.events[0].kind, 'attest');
  assert.equal(result.events[0].targetKey, 'ai/first');
  assert.equal(result.events[1].kind, 'publish');
  assert.equal(result.events[1].key, 'ai/second');
  assert.equal(result.events[2].key, 'ai/first');
  console.log('   ✓ Basic activity feed works');
}

// Test 2: topic filter
{
  console.log('2. Topic filter');
  const transport = makeTransport([
    makeArticle({ id: 'x1', key: 'ai/x', topic: 'ai', updatedAt: '2026-06-15T10:00:00.000Z' }),
    makeArticle({ id: 'c1', key: 'crypto/btc', topic: 'crypto', updatedAt: '2026-06-15T11:00:00.000Z' })
  ]);
  const result = await activityFeed({ home, transport, topic: 'ai' });
  assert.equal(result.total, 1);
  assert.equal(result.events[0].key, 'ai/x');
  console.log('   ✓ Topic filter works');
}

// Test 3: event kind filter
{
  console.log('3. Event kind filter');
  const transport = makeTransport([
    makeArticle({ id: 'a3', key: 'ai/third', updatedAt: '2026-06-15T10:00:00.000Z' }),
    makeAttestation({ id: 'att2', targetId: 'a3', targetKey: 'ai/third', createdAt: '2026-06-15T11:00:00.000Z' })
  ]);
  const result = await activityFeed({ home, transport, eventKind: 'attest' });
  assert.equal(result.total, 1);
  assert.equal(result.events[0].kind, 'attest');
  console.log('   ✓ Event kind filter works');
}

// Test 4: agent filter
{
  console.log('4. Agent filter');
  const transport = makeTransport([
    makeArticle({ id: 'a4', key: 'ai/four', agentId: 'alice', updatedAt: '2026-06-15T10:00:00.000Z' }),
    makeArticle({ id: 'a5', key: 'ai/five', agentId: 'bob', updatedAt: '2026-06-15T11:00:00.000Z' }),
    makeAttestation({ id: 'att3', targetId: 'a4', targetKey: 'ai/four', agentId: 'alice', createdAt: '2026-06-15T12:00:00.000Z' })
  ]);
  const result = await activityFeed({ home, transport, agent: 'alice' });
  assert.equal(result.total, 2);
  assert.ok(result.events.every((e) => e.agentId === 'alice'));
  console.log('   ✓ Agent filter works');
}

// Test 5: author filter only applies to publish events
{
  console.log('5. Author filter');
  const transport = makeTransport([
    makeArticle({ id: 'a6', key: 'ai/six', agentId: 'alice', updatedAt: '2026-06-15T10:00:00.000Z' }),
    makeAttestation({ id: 'att4', targetId: 'a6', targetKey: 'ai/six', agentId: 'bob', createdAt: '2026-06-15T11:00:00.000Z' })
  ]);
  const result = await activityFeed({ home, transport, author: 'alice' });
  assert.equal(result.total, 1);
  assert.equal(result.events[0].kind, 'publish');
  console.log('   ✓ Author filter works');
}

// Test 6: fork event detection
{
  console.log('6. Fork event detection');
  const transport = makeTransport([
    makeArticle({ id: 'src', key: 'ai/source', title: 'Source', updatedAt: '2026-06-15T10:00:00.000Z' }),
    makeArticle({
      id: 'fork1',
      key: 'ai/source-fork',
      title: 'Fork',
      updatedAt: '2026-06-15T11:00:00.000Z',
      extraTags: [
        { name: 'Article-Fork-Of', value: 'ai/source' },
        { name: 'Article-Fork-Source-Id', value: 'src' },
        { name: 'Article-Fork-Source-Version', value: '1' }
      ]
    })
  ]);
  const result = await activityFeed({ home, transport, eventKind: 'fork' });
  assert.equal(result.total, 1);
  assert.equal(result.events[0].kind, 'fork');
  assert.equal(result.events[0].sourceKey, 'ai/source');
  console.log('   ✓ Fork event detection works');
}

// Test 7: merge event detection
{
  console.log('7. Merge event detection');
  const transport = makeTransport([
    makeArticle({ id: 'tgt', key: 'ai/target', title: 'Target', updatedAt: '2026-06-15T10:00:00.000Z' }),
    makeArticle({
      id: 'merge1',
      key: 'ai/target',
      title: 'Merged',
      version: 2,
      updatedAt: '2026-06-15T12:00:00.000Z',
      extraTags: [
        { name: 'Article-Merge-Source-Key', value: 'ai/source-fork' },
        { name: 'Article-Merge-Source-Id', value: 'fork1' },
        { name: 'Article-Merge-Source-Version', value: '1' },
        { name: 'Article-Merge-Target-Version', value: '1' },
        { name: 'Article-Merge-Has-Conflicts', value: 'false' }
      ]
    })
  ]);
  const result = await activityFeed({ home, transport, eventKind: 'merge' });
  assert.equal(result.total, 1);
  assert.equal(result.events[0].kind, 'merge');
  assert.equal(result.events[0].sourceKey, 'ai/source-fork');
  assert.equal(result.events[0].hasConflicts, false);
  console.log('   ✓ Merge event detection works');
}

// Test 8: local cache merge
{
  console.log('8. Local cache merge');
  writeIndex({
    articles: {
      'local/only': {
        id: 'local-1',
        key: 'local/only',
        kind: 'subject',
        topic: 'local',
        title: 'Local Only',
        version: 1,
        contentHash: 'sha256:local',
        updatedAt: '2026-06-15T09:00:00.000Z',
        authorAgentId: 'local-agent'
      }
    },
    attestations: {},
    updatedAt: '2026-06-15T09:00:00.000Z'
  });
  const transport = makeTransport([]);
  const result = await activityFeed({ home, transport });
  assert.ok(result.events.some((e) => e.id === 'local-1'));
  const localEvent = result.events.find((e) => e.id === 'local-1');
  assert.equal(localEvent.localOnly, true);
  console.log('   ✓ Local cache merge works');
}

// Test 9: pagination and order
{
  console.log('9. Pagination and order');
  writeIndex({
    articles: {},
    attestations: {},
    updatedAt: '2026-06-15T09:00:00.000Z'
  });
  const transport = makeTransport([
    makeArticle({ id: 'p1', key: 'ai/p1', updatedAt: '2026-06-15T10:00:00.000Z' }),
    makeArticle({ id: 'p2', key: 'ai/p2', updatedAt: '2026-06-15T11:00:00.000Z' }),
    makeArticle({ id: 'p3', key: 'ai/p3', updatedAt: '2026-06-15T12:00:00.000Z' })
  ]);
  const desc = await activityFeed({ home, transport, limit: 2, offset: 0 });
  assert.equal(desc.events.length, 2);
  assert.equal(desc.events[0].id, 'p3');
  assert.equal(desc.events[1].id, 'p2');

  const asc = await activityFeed({ home, transport, order: 'asc', limit: 2, offset: 0 });
  assert.equal(asc.events[0].id, 'p1');
  assert.equal(asc.events[1].id, 'p2');
  console.log('   ✓ Pagination and order work');
}

// Test 10: markdown output
{
  console.log('10. Markdown output');
  writeIndex({
    articles: {},
    attestations: {},
    updatedAt: '2026-06-15T09:00:00.000Z'
  });
  const transport = makeTransport([
    makeArticle({ id: 'md1', key: 'ai/md', title: 'Markdown Test', updatedAt: '2026-06-15T10:00:00.000Z', sourceUrl: 'https://example.com' }),
    makeAttestation({ id: 'att-md', targetId: 'md1', targetKey: 'ai/md', opinion: 'valid', confidence: 0.9, reason: 'Solid', createdAt: '2026-06-15T11:00:00.000Z' })
  ]);
  const feed = await activityFeed({ home, transport });
  const md = activityToMarkdown(feed);
  assert.match(md, /# PermaBrain Activity Feed/);
  assert.match(md, /\[publish\]/);
  assert.match(md, /\[attest\]/);
  assert.match(md, /Markdown Test/);
  assert.match(md, /Solid/);
  console.log('   ✓ Markdown output works');
}

// Test 11: key filter on attestations
{
  console.log('11. Key filter');
  writeIndex({
    articles: {},
    attestations: {},
    updatedAt: '2026-06-15T09:00:00.000Z'
  });
  const transport = makeTransport([
    makeArticle({ id: 'k1', key: 'ai/one', updatedAt: '2026-06-15T10:00:00.000Z' }),
    makeArticle({ id: 'k2', key: 'ai/two', updatedAt: '2026-06-15T11:00:00.000Z' }),
    makeAttestation({ id: 'att-k1', targetId: 'k1', targetKey: 'ai/one', createdAt: '2026-06-15T12:00:00.000Z' })
  ]);
  const result = await activityFeed({ home, transport, key: 'ai/one' });
  assert.equal(result.total, 2);
  assert.ok(result.events.every((e) => e.key === 'ai/one' || e.targetKey === 'ai/one'));
  console.log('   ✓ Key filter works');
}

fs.rmSync(tmp, { recursive: true, force: true });

console.log('\n✅ All activity feed tests passed');
