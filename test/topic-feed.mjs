/**
 * Test: topic feed
 *
 * Covers topicFeed with a mocked local transport and cached articles.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { topicFeed, feedToMarkdown } from '../src/topic-feed.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-topic-feed-'));
const home = tmp;

function makeItem({ id, key, title = 'Untitled', kind = 'subject', topic = 'ai', version = 1, agentId = 'agent-1', updatedAt, content = 'hello world', encrypted = false, sourceUrl = null, sourceName = null }) {
  const updated = updatedAt || new Date().toISOString();
  const payload = encrypted
    ? JSON.stringify({ v: 1, ephemeralPublicKey: 'epk', salt: 'salt', iv: 'iv', ciphertext: content, authTag: 'tag', recipients: [] })
    : content;
  const tags = [
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
    { name: 'Author-Agent-Id', value: agentId }
  ];
  if (sourceUrl) tags.push({ name: 'Article-Source-Url', value: sourceUrl });
  if (sourceName) tags.push({ name: 'Article-Source-Name', value: sourceName });
  return {
    id,
    owner: agentId,
    timestamp: updated,
    tags,
    data: Buffer.from(payload, 'utf8').toString('base64url')
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

// Test 1: basic topic feed returns articles
{
  console.log('1. Basic topic feed');
  const transport = makeTransport([
    makeItem({ id: 'a1', key: 'ai/first', title: 'First AI Article', kind: 'subject', version: 1 }),
    makeItem({ id: 'a2', key: 'ai/second', title: 'Second AI Article', kind: 'subject', version: 1 }),
    makeItem({ id: 'a3', key: 'crypto/btc', title: 'Bitcoin', kind: 'subject', topic: 'crypto', version: 1 })
  ]);
  const result = await topicFeed('ai', { home, transport, includeAttestations: false });
  assert.equal(result.topic, 'ai');
  assert.equal(result.total, 2);
  assert.equal(result.articles.length, 2);
  assert.ok(result.articles.some((a) => a.key === 'ai/first'));
  assert.ok(result.articles.some((a) => a.key === 'ai/second'));
  assert.ok(!result.articles.some((a) => a.key === 'crypto/btc'));
  console.log('   ✓ Basic topic feed works');
}

// Test 2: sort by title and pagination
{
  console.log('2. Sort and pagination');
  const transport = makeTransport([
    makeItem({ id: 'z', key: 'ai/zebra', title: 'Zebra', version: 1 }),
    makeItem({ id: 'a', key: 'ai/apple', title: 'Apple', version: 1 }),
    makeItem({ id: 'm', key: 'ai/mango', title: 'Mango', version: 1 })
  ]);
  const result = await topicFeed('ai', { home, transport, sort: 'title', limit: 2, offset: 1, includeAttestations: false });
  assert.equal(result.articles.length, 2);
  assert.equal(result.articles[0].key, 'ai/mango');
  assert.equal(result.articles[1].key, 'ai/zebra');
  console.log('   ✓ Sort and pagination work');
}

// Test 3: kind filter
{
  console.log('3. Kind filter');
  const transport = makeTransport([
    makeItem({ id: 'p1', key: 'ai/person', title: 'Person', kind: 'person', version: 1 }),
    makeItem({ id: 's1', key: 'ai/subject', title: 'Subject', kind: 'subject', version: 1 })
  ]);
  const result = await topicFeed('ai', { home, transport, kind: 'person', includeAttestations: false });
  assert.equal(result.total, 1);
  assert.equal(result.articles[0].key, 'ai/person');
  console.log('   ✓ Kind filter works');
}

// Test 4: agent filter
{
  console.log('4. Agent filter');
  const transport = makeTransport([
    makeItem({ id: 'x1', key: 'ai/x', title: 'X', agentId: 'agent-a', version: 1 }),
    makeItem({ id: 'y1', key: 'ai/y', title: 'Y', agentId: 'agent-b', version: 1 })
  ]);
  const result = await topicFeed('ai', { home, transport, agent: 'agent-a', includeAttestations: false });
  assert.equal(result.total, 1);
  assert.equal(result.articles[0].key, 'ai/x');
  console.log('   ✓ Agent filter works');
}

// Test 5: attested-by agent filter
{
  console.log('5. Attested-by agent filter');
  const article = makeItem({ id: 'art1', key: 'ai/z', title: 'Z', agentId: 'agent-x', version: 1 });
  const attestation = {
    id: 'att1',
    owner: 'agent-y',
    timestamp: new Date().toISOString(),
    tags: [
      { name: 'App-Name', value: 'PermaBrain' },
      { name: 'PermaBrain-Type', value: 'attestation' },
      { name: 'Attestation-Target-Key', value: 'ai/z' },
      { name: 'Attestation-Target-Id', value: 'art1' },
      { name: 'Attestation-Opinion', value: 'valid' },
      { name: 'Attestation-Confidence', value: '0.9' },
      { name: 'Attestation-Reason', value: 'Good' },
      { name: 'Attestation-Agent-Id', value: 'agent-y' },
      { name: 'Attestation-Created-At', value: new Date().toISOString() }
    ],
    data: Buffer.from('{}', 'utf8').toString('base64url')
  };
  const transport = makeTransport([article, attestation]);
  const result = await topicFeed('ai', { home, transport, agent: 'attested-by:agent-y', includeAttestations: true });
  assert.equal(result.total, 1);
  assert.equal(result.articles[0].key, 'ai/z');
  console.log('   ✓ Attested-by filter works');
}

// Test 6: include attestations/consensus
{
  console.log('6. Consensus enrichment');
  const article = makeItem({ id: 'art2', key: 'ai/consensus', title: 'Consensus Test', version: 1 });
  const attestation = {
    id: 'att2',
    owner: 'agent-y',
    timestamp: new Date().toISOString(),
    tags: [
      { name: 'App-Name', value: 'PermaBrain' },
      { name: 'PermaBrain-Type', value: 'attestation' },
      { name: 'Attestation-Target-Key', value: 'ai/consensus' },
      { name: 'Attestation-Target-Id', value: 'art2' },
      { name: 'Attestation-Opinion', value: 'valid' },
      { name: 'Attestation-Confidence', value: '0.95' },
      { name: 'Attestation-Reason', value: 'Solid' },
      { name: 'Attestation-Agent-Id', value: 'agent-y' },
      { name: 'Attestation-Created-At', value: new Date().toISOString() }
    ],
    data: Buffer.from('{}', 'utf8').toString('base64url')
  };
  const transport = makeTransport([article, attestation]);
  const result = await topicFeed('ai', { home, transport });
  assert.equal(result.articles.length, 1);
  const consensus = result.articles[0].consensus;
  assert.ok(consensus, 'consensus present');
  assert.equal(consensus.totalAttestations, 1);
  assert.equal(consensus.status, 'attested');
  assert.ok(consensus.score > 0);
  console.log('   ✓ Consensus enrichment works');
}

// Test 7: --no-attestations skips consensus
{
  console.log('7. Skip attestations');
  const article = makeItem({ id: 'art3', key: 'ai/noattest', title: 'No Attest', version: 1 });
  const transport = makeTransport([article]);
  const result = await topicFeed('ai', { home, transport, includeAttestations: false });
  assert.equal(result.articles[0].consensus, undefined);
  console.log('   ✓ includeAttestations: false works');
}

// Test 8: encrypted article flag
{
  console.log('8. Encrypted article flag');
  const article = makeItem({ id: 'art4', key: 'ai/secret', title: 'Secret', encrypted: true });
  const transport = makeTransport([article]);
  const result = await topicFeed('ai', { home, transport, includeAttestations: false });
  assert.equal(result.articles[0].encrypted, true);
  console.log('   ✓ Encrypted flag detected');
}

// Test 9: markdown output
{
  console.log('9. Markdown output');
  const transport = makeTransport([
    makeItem({ id: 'md1', key: 'ai/markdown', title: 'Markdown Test', sourceUrl: 'https://example.com/ai', version: 1 })
  ]);
  const feed = await topicFeed('ai', { home, transport, includeAttestations: false });
  const md = feedToMarkdown(feed);
  assert.match(md, /# PermaBrain Topic Feed: ai/);
  assert.match(md, /\[Markdown Test\]\(https:\/\/example\.com\/ai\)/);
  assert.match(md, /Key: `ai\/markdown`/);
  console.log('   ✓ Markdown output works');
}

// Test 10: missing topic throws
{
  console.log('10. Missing topic validation');
  try {
    await topicFeed('', { home, transport: makeTransport([]) });
    assert.fail('should throw');
  } catch (err) {
    assert.match(err.message, /topic is required/);
  }
  console.log('   ✓ Missing topic validation works');
}

fs.rmSync(tmp, { recursive: true, force: true });

console.log('\n✅ All topic feed tests passed');
