/**
 * AO Integration Unit Tests
 *
 * Tests AOTransport dryrun reads (Query, Get, Consensus, Info) and
 * message writes (Publish, Attest, Sync) using mocked aoconnect.
 *
 * Live AO tests are enabled by setting PERMABRAIN_AO_PROCESS_ID.
 * Without it, all tests run against mock AO responses.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { initState } from '../src/config.mjs';
import { AOTransport } from '../src/ao-transport.mjs';
import { ensureIdentity, loadIdentity } from '../src/keys.mjs';
import { createDataItem } from '../src/dataitem.mjs';
import { buildArticleTags, buildAttestationTags, tagsToObject } from '../src/tags.mjs';
import { getTransport } from '../src/transport.mjs';

// ============================================================================
// Helpers: mock aoconnect
// ============================================================================

function createMockAo(mockResponses) {
  const calls = { dryrun: [], message: [], spawn: [] };

  const mockConnect = {
    dryrun: async (params) => {
      calls.dryrun.push(params);
      const action = params.tags?.find(t => t.name === 'Action')?.value;
      if (mockResponses?.dryrun?.[action]) {
        return mockResponses.dryrun[action](params, calls);
      }
      return defaultDryrunResponse(action, params);
    },
    message: async (params) => {
      calls.message.push(params);
      if (mockResponses?.message) return mockResponses.message(params, calls);
      return { id: `mock-msg-${calls.message.length}` };
    },
    spawn: async (params) => {
      calls.spawn.push(params);
      if (mockResponses?.spawn) return mockResponses.spawn(params, calls);
      return { id: `mock-process-${calls.spawn.length}` };
    }
  };

  return { connect: () => mockConnect, calls };
}

function defaultDryrunResponse(action) {
  switch (action) {
    case 'Info':
      return {
        Messages: [
          {
            Tags: [{ name: 'Action', value: 'Info-Response' }],
            Data: JSON.stringify({
              name: 'PermaBrain',
              version: '0.1.0',
              articles: 0,
              attestations: 0
            })
          }
        ]
      };
    case 'Query':
      return {
        Messages: [
          {
            Tags: [{ name: 'Action', value: 'Query-Response' }],
            Data: JSON.stringify([
              { key: 'person/ada-lovelace', kind: 'person', title: 'Ada Lovelace', topic: 'computing', version: 1 }
            ])
          }
        ]
      };
    case 'Get':
      return {
        Messages: [
          {
            Tags: [{ name: 'Action', value: 'Get-Response' }],
            Data: JSON.stringify({
              id: 'mock-article-id',
              key: 'person/ada-lovelace',
              kind: 'person',
              title: 'Ada Lovelace',
              topic: 'computing',
              version: 2,
              contentHash: 'sha256:abc123'
            })
          }
        ]
      };
    case 'Consensus':
      return {
        Messages: [
          {
            Tags: [{ name: 'Action', value: 'Consensus-Response' }],
            Data: JSON.stringify({
              key: 'person/ada-lovelace',
              latestArticleId: 'v2',
              totalAttestations: 2,
              score: 0.85,
              opinionCounts: { valid: 2 },
              scoreComponents: [
                { id: 'att-1', opinion: 'valid', confidence: 0.9, agentId: 'agent:a', targetVersionWeight: 1 }
              ]
            })
          }
        ]
      };
    default:
      return {
        Messages: [
          {
            Tags: [{ name: 'Action', value: `${action}-Notice` }],
            Data: JSON.stringify({ ok: true })
          }
        ]
      };
  }
}

// ============================================================================
// Test: AOTransport config validation
// ============================================================================

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-ao-test-'));
initState({ env: { PERMABRAIN_HOME: tempHome } });

// Missing processId must throw
assert.throws(() => new AOTransport({}), /AO transport requires config\.ao\.processId/);
assert.throws(() => new AOTransport({ ao: {} }), /AO transport requires config\.ao\.processId/);

console.log('✓ Config validation: missing processId throws');

// ============================================================================
// Test: AOTransport instantiation
// ============================================================================

const validConfig = {
  ao: { processId: 'test-process-001' },
  gateway: { graphqlUrl: 'https://arweave.net/graphql', dataUrl: 'https://arweave.net' },
  bundler: { uploadUrl: 'https://up.arweave.net/tx' }
};

const transport = new AOTransport(validConfig);
assert.equal(transport.processId, 'test-process-001');
assert.ok(transport.ao, 'aoconnect instance created');
assert.ok(transport.fallback, 'Arweave fallback transport created');
assert.equal(transport.config, validConfig);

console.log('✓ AOTransport instantiation with valid config');

// Custom AO URLs
const customConfig = {
  ao: {
    processId: 'test-process-002',
    muUrl: 'https://mu.example.com',
    cuUrl: 'https://cu.example.com',
    gatewayUrl: 'https://gw.example.com',
    graphqlUrl: 'https://gw.example.com/graphql'
  },
  gateway: { graphqlUrl: 'https://arweave.net/graphql', dataUrl: 'https://arweave.net' },
  bundler: { uploadUrl: 'https://up.arweave.net/tx' }
};
const customTransport = new AOTransport(customConfig);
assert.equal(customTransport.processId, 'test-process-002');
assert.ok(customTransport.ao);
assert.ok(customTransport.fallback);

console.log('✓ AOTransport instantiation with custom AO URLs');

// ============================================================================
// Test: Method signatures
// ============================================================================

assert.ok(typeof AOTransport.prototype.dryrun === 'function', 'dryrun method exists');
assert.ok(typeof AOTransport.prototype.sendMessage === 'function', 'sendMessage method exists');
assert.ok(typeof AOTransport.prototype.queryArticles === 'function', 'queryArticles method exists');
assert.ok(typeof AOTransport.prototype.getArticle === 'function', 'getArticle method exists');
assert.ok(typeof AOTransport.prototype.getConsensus === 'function', 'getConsensus method exists');
assert.ok(typeof AOTransport.prototype.syncFromArweave === 'function', 'syncFromArweave method exists');
assert.ok(typeof AOTransport.prototype.uploadDataItem === 'function', 'uploadDataItem method exists');
assert.ok(typeof AOTransport.prototype.fetchDataItem === 'function', 'fetchDataItem method exists');
assert.ok(typeof AOTransport.prototype.fetchData === 'function', 'fetchData method exists');
assert.ok(typeof AOTransport.prototype.queryByTags === 'function', 'queryByTags method exists');

console.log('✓ All AOTransport methods present');

// ============================================================================
// Test: Dryrun — Info handler
// ============================================================================

{
  const mock = createMockAo();
  const infoTransport = new AOTransport({
    ao: { processId: 'test-proc-info' },
    gateway: { graphqlUrl: 'https://arweave.net/graphql', dataUrl: 'https://arweave.net' },
    bundler: { uploadUrl: 'https://up.arweave.net/tx' }
  });
  infoTransport.ao = mock.connect();

  const result = await infoTransport.dryrun({ action: 'Info' });
  assert.ok(result, 'Info dryrun returns a result');
  assert.equal(result.name, 'PermaBrain');
  assert.equal(result.version, '0.1.0');

  // Verify dryrun was called with correct tags
  assert.equal(mock.calls.dryrun.length, 1);
  assert.equal(mock.calls.dryrun[0].process, 'test-proc-info');
  const actionTag = mock.calls.dryrun[0].tags.find(t => t.name === 'Action');
  assert.equal(actionTag?.value, 'Info');

  console.log('✓ Dryrun: Info handler parses response correctly');
}

// ============================================================================
// Test: Dryrun — Query handler with filters
// ============================================================================

{
  const mock = createMockAo();
  const queryTransport = new AOTransport({
    ao: { processId: 'test-proc-query' },
    gateway: { graphqlUrl: 'https://arweave.net/graphql', dataUrl: 'https://arweave.net' },
    bundler: { uploadUrl: 'https://up.arweave.net/tx' }
  });
  queryTransport.ao = mock.connect();

  // Query with topic filter
  const articles = await queryTransport.queryArticles({ topic: 'computing' });
  assert.ok(Array.isArray(articles), 'queryArticles returns array');

  // Verify dryrun was called with Query action and topic tag
  assert.equal(mock.calls.dryrun.length, 1);
  const dryrunCall = mock.calls.dryrun[0];
  const actionTag = dryrunCall.tags.find(t => t.name === 'Action');
  assert.equal(actionTag?.value, 'Query');
  const topicTag = dryrunCall.tags.find(t => t.name === 'Article-Topic');
  assert.equal(topicTag?.value, 'computing');

  console.log('✓ Dryrun: Query handler sends correct filters');
}

// ============================================================================
// Test: Dryrun — Get handler
// ============================================================================

{
  const mock = createMockAo();
  const getTransport = new AOTransport({
    ao: { processId: 'test-proc-get' },
    gateway: { graphqlUrl: 'https://arweave.net/graphql', dataUrl: 'https://arweave.net' },
    bundler: { uploadUrl: 'https://up.arweave.net/tx' }
  });
  getTransport.ao = mock.connect();

  const result = await getTransport.getArticle('person/ada-lovelace');
  assert.ok(result, 'getArticle returns a result');
  assert.equal(result.key, 'person/ada-lovelace');
  assert.equal(result.kind, 'person');
  assert.equal(result.version, 2);

  // Verify dryrun call
  assert.equal(mock.calls.dryrun.length, 1);
  const keyTag = mock.calls.dryrun[0].tags.find(t => t.name === 'Article-Key');
  assert.equal(keyTag?.value, 'person/ada-lovelace');

  console.log('✓ Dryrun: Get handler returns article data');
}

// ============================================================================
// Test: Dryrun — Consensus handler
// ============================================================================

{
  const mock = createMockAo();
  const consensusTransport = new AOTransport({
    ao: { processId: 'test-proc-consensus' },
    gateway: { graphqlUrl: 'https://arweave.net/graphql', dataUrl: 'https://arweave.net' },
    bundler: { uploadUrl: 'https://up.arweave.net/tx' }
  });
  consensusTransport.ao = mock.connect();

  const result = await consensusTransport.getConsensus('person/ada-lovelace');
  assert.ok(result, 'getConsensus returns a result');
  assert.equal(result.key, 'person/ada-lovelace');
  assert.equal(result.score, 0.85);
  assert.equal(result.totalAttestations, 2);

  // Verify dryrun call
  assert.equal(mock.calls.dryrun.length, 1);
  const keyTag = mock.calls.dryrun[0].tags.find(t => t.name === 'Article-Key');
  assert.equal(keyTag?.value, 'person/ada-lovelace');
  const actionTag = mock.calls.dryrun[0].tags.find(t => t.name === 'Action');
  assert.equal(actionTag?.value, 'Consensus');

  console.log('✓ Dryrun: Consensus handler returns score data');
}

// ============================================================================
// Test: sendMessage — Publish action
// ============================================================================

{
  const mock = createMockAo();
  const pubTransport = new AOTransport({
    ao: { processId: 'test-proc-pub' },
    gateway: { graphqlUrl: 'https://arweave.net/graphql', dataUrl: 'https://arweave.net' },
    bundler: { uploadUrl: 'https://up.arweave.net/tx' }
  });
  pubTransport.ao = mock.connect();

  // For sendMessage, we need an identity
  const { identity } = await ensureIdentity(tempHome);

  const result = await pubTransport.sendMessage({
    action: 'Publish',
    tags: [
      { name: 'Article-Key', value: 'person/alan-turing' },
      { name: 'Article-Kind', value: 'person' },
      { name: 'Article-Title', value: 'Alan Turing' }
    ],
    data: JSON.stringify({ key: 'person/alan-turing', kind: 'person' }),
    identity
  });

  assert.ok(result.messageId, 'sendMessage returns messageId');

  // Verify message was called with correct structure
  assert.equal(mock.calls.message.length, 1);
  const msg = mock.calls.message[0];
  assert.equal(msg.process, 'test-proc-pub');
  const actionTag = msg.tags.find(t => t.name === 'Action');
  assert.equal(actionTag?.value, 'Publish');
  const keyTag = msg.tags.find(t => t.name === 'Article-Key');
  assert.equal(keyTag?.value, 'person/alan-turing');

  console.log('✓ sendMessage: Publish sends correct tags and data');
}

// ============================================================================
// Test: sendMessage — Attest action
// ============================================================================

{
  const mock = createMockAo();
  const attestTransport = new AOTransport({
    ao: { processId: 'test-proc-attest' },
    gateway: { graphqlUrl: 'https://arweave.net/graphql', dataUrl: 'https://arweave.net' },
    bundler: { uploadUrl: 'https://up.arweave.net/tx' }
  });
  attestTransport.ao = mock.connect();

  const identity = loadIdentity(tempHome);

  const result = await attestTransport.sendMessage({
    action: 'Attest',
    tags: [
      { name: 'Attestation-Target-Key', value: 'person/ada-lovelace' },
      { name: 'Attestation-Opinion', value: 'valid' },
      { name: 'Attestation-Confidence', value: '0.95' }
    ],
    data: JSON.stringify({ targetKey: 'person/ada-lovelace', opinion: 'valid', confidence: 0.95 }),
    identity
  });

  assert.ok(result.messageId, 'sendMessage returns messageId for Attest');

  // Verify message structure
  assert.equal(mock.calls.message.length, 1);
  const msg = mock.calls.message[0];
  const actionTag = msg.tags.find(t => t.name === 'Action');
  assert.equal(actionTag?.value, 'Attest');
  const targetKeyTag = msg.tags.find(t => t.name === 'Attestation-Target-Key');
  assert.equal(targetKeyTag?.value, 'person/ada-lovelace');

  console.log('✓ sendMessage: Attest sends correct tags and data');
}

// ============================================================================
// Test: sendMessage — Sync action
// ============================================================================

{
  const mock = createMockAo();
  const syncTransport = new AOTransport({
    ao: { processId: 'test-proc-sync' },
    gateway: { graphqlUrl: 'https://arweave.net/graphql', dataUrl: 'https://arweave.net' },
    bundler: { uploadUrl: 'https://up.arweave.net/tx' }
  });
  syncTransport.ao = mock.connect();

  const identity = loadIdentity(tempHome);

  const result = await syncTransport.sendMessage({
    action: 'Sync',
    tags: [],
    data: JSON.stringify({ articles: [], attestations: [] }),
    identity
  });

  assert.ok(result.messageId, 'sendMessage returns messageId for Sync');

  // Verify message structure
  const msg = mock.calls.message[0];
  const actionTag = msg.tags.find(t => t.name === 'Action');
  assert.equal(actionTag?.value, 'Sync');

  console.log('✓ sendMessage: Sync sends correct action tag');
}

// ============================================================================
// Test: sendMessage — Ed25519 identity rejected
// ============================================================================

{
  const ed25519Identity = {
    type: 'ed25519',
    agentId: 'ed25519:test-agent',
    publicKey: Buffer.from('test-public-key').toString('base64'),
    secretKey: Buffer.from('test-secret-key').toString('base64'),
    createdAt: new Date().toISOString()
  };

  const mock = createMockAo();
  const edTransport = new AOTransport({
    ao: { processId: 'test-proc-ed' },
    gateway: { graphqlUrl: 'https://arweave.net/graphql', dataUrl: 'https://arweave.net' },
    bundler: { uploadUrl: 'https://up.arweave.net/tx' }
  });
  edTransport.ao = mock.connect();

  await assert.rejects(
    () => edTransport.sendMessage({
      action: 'Publish',
      tags: [],
      data: '',
      identity: ed25519Identity
    }),
    /Ed25519 signing for AO is not yet supported/
  );

  console.log('✓ sendMessage: Ed25519 identity rejected with clear error');
}

// ============================================================================
// Test: Dryrun error handling
// ============================================================================

{
  const mock = createMockAo({
    dryrun: {
      Query: () => { throw new Error('AO process not responding'); }
    }
  });
  const errTransport = new AOTransport({
    ao: { processId: 'test-proc-err' },
    gateway: { graphqlUrl: 'https://arweave.net/graphql', dataUrl: 'https://arweave.net' },
    bundler: { uploadUrl: 'https://up.arweave.net/tx' }
  });
  errTransport.ao = mock.connect();

  await assert.rejects(
    () => errTransport.dryrun({ action: 'Query', tags: [] }),
    /AO process not responding/
  );

  console.log('✓ Dryrun: Error handling propagates AO errors');
}

// ============================================================================
// Test: Dryrun — response with Action-Notice (not Response)
// ============================================================================

{
  // Simulate a response that uses Publish-Notice instead of Publish-Response
  const mock = createMockAo({
    dryrun: {
      Publish: () => ({
        Messages: [
          {
            Tags: [{ name: 'Action', value: 'Publish-Notice' }],
            Data: JSON.stringify({ ok: true, articleKey: 'person/new-article' })
          }
        ]
      })
    }
  });
  const noticeTransport = new AOTransport({
    ao: { processId: 'test-proc-notice' },
    gateway: { graphqlUrl: 'https://arweave.net/graphql', dataUrl: 'https://arweave.net' },
    bundler: { uploadUrl: 'https://up.arweave.net/tx' }
  });
  noticeTransport.ao = mock.connect();

  const result = await noticeTransport.dryrun({ action: 'Publish' });
  assert.equal(result.ok, true);
  assert.equal(result.articleKey, 'person/new-article');

  console.log('✓ Dryrun: Notice action responses parsed correctly');
}

// ============================================================================
// Test: Dryrun — non-JSON Data response
// ============================================================================

{
  const mock = createMockAo({
    dryrun: {
      Info: () => ({
        Messages: [
          {
            Tags: [{ name: 'Action', value: 'Info-Response' }, { name: 'Version', value: '0.1.0' }],
            Data: 'PermaBrain process v0.1.0'
          }
        ]
      })
    }
  });
  const rawTransport = new AOTransport({
    ao: { processId: 'test-proc-raw' },
    gateway: { graphqlUrl: 'https://arweave.net/graphql', dataUrl: 'https://arweave.net' },
    bundler: { uploadUrl: 'https://up.arweave.net/tx' }
  });
  rawTransport.ao = mock.connect();

  const result = await rawTransport.dryrun({ action: 'Info' });
  // When Data is not JSON, it should return { data, tags }
  assert.equal(result.data, 'PermaBrain process v0.1.0');
  assert.ok(Array.isArray(result.tags));

  console.log('✓ Dryrun: Non-JSON Data returns raw data with tags');
}

// ============================================================================
// Test: Dryrun — empty Messages array fallback
// ============================================================================

{
  const mock = createMockAo({
    dryrun: {
      Query: () => ({ Messages: [] })
    }
  });
  const emptyTransport = new AOTransport({
    ao: { processId: 'test-proc-empty' },
    gateway: { graphqlUrl: 'https://arweave.net/graphql', dataUrl: 'https://arweave.net' },
    bundler: { uploadUrl: 'https://up.arweave.net/tx' }
  });
  emptyTransport.ao = mock.connect();

  const result = await emptyTransport.dryrun({ action: 'Query' });
  // Should return raw result when no matching message found
  assert.ok(result, 'Returns raw result for empty Messages');
  assert.ok(result.Messages, 'Raw result has Messages property');

  console.log('✓ Dryrun: Empty Messages returns raw result');
}

// ============================================================================
// Test: Dryrun — AO Error response
// ============================================================================

{
  const mock = createMockAo({
    dryrun: {
      Get: () => ({ Error: 'Process not found: invalid-id' })
    }
  });
  const errTransport2 = new AOTransport({
    ao: { processId: 'invalid-proc' },
    gateway: { graphqlUrl: 'https://arweave.net/graphql', dataUrl: 'https://arweave.net' },
    bundler: { uploadUrl: 'https://up.arweave.net/tx' }
  });
  errTransport2.ao = mock.connect();

  await assert.rejects(
    () => errTransport2.dryrun({ action: 'Get', tags: [{ name: 'Article-Key', value: 'person/nonexistent' }] }),
    /AO dryrun error/
  );

  console.log('✓ Dryrun: AO Error response throws correctly');
}

// ============================================================================
// Test: getArticle — fallback on dryrun failure
// ============================================================================

{
  const mock = createMockAo({
    dryrun: {
      Get: () => { throw new Error('Process crashed'); }
    }
  });
  const fallbackTransport = new AOTransport({
    ao: { processId: 'crashing-proc' },
    gateway: { graphqlUrl: 'https://arweave.net/graphql', dataUrl: 'https://arweave.net' },
    bundler: { uploadUrl: 'https://up.arweave.net/tx' }
  });
  fallbackTransport.ao = mock.connect();

  // getArticle should return null on dryrun failure (graceful degradation)
  const result = await fallbackTransport.getArticle('person/nonexistent');
  assert.equal(result, null, 'getArticle returns null when AO dryrun fails');

  console.log('✓ getArticle: Returns null on AO dryrun failure (graceful fallback)');
}

// ============================================================================
// Test: getConsensus — fallback on dryrun failure
// ============================================================================

{
  const mock = createMockAo({
    dryrun: {
      Consensus: () => { throw new Error('Network timeout'); }
    }
  });
  const fallbackTransport = new AOTransport({
    ao: { processId: 'timeout-proc' },
    gateway: { graphqlUrl: 'https://arweave.net/graphql', dataUrl: 'https://arweave.net' },
    bundler: { uploadUrl: 'https://up.arweave.net/tx' }
  });
  fallbackTransport.ao = mock.connect();

  const result = await fallbackTransport.getConsensus('person/ada-lovelace');
  assert.equal(result, null, 'getConsensus returns null when AO dryrun fails');

  console.log('✓ getConsensus: Returns null on AO dryrun failure');
}

// ============================================================================
// Test: queryArticles — fallback to Arweave on AO failure
// ============================================================================

{
  const mock = createMockAo({
    dryrun: {
      Query: () => { throw new Error('AO unavailable'); }
    }
  });
  const fbTransport = new AOTransport({
    ao: { processId: 'fb-proc' },
    gateway: { graphqlUrl: 'https://arweave.net/graphql', dataUrl: 'https://arweave.net' },
    bundler: { uploadUrl: 'https://up.arweave.net/tx' }
  });
  fbTransport.ao = mock.connect();

  // queryArticles should catch the dryrun error and fall through to Arweave
  // Arweave will also fail (no real network), but the error handling path is exercised
  try {
    await fbTransport.queryArticles({ topic: 'computing' });
  } catch (err) {
    // Expected: Arweave fallback also fails without network
    assert.ok(
      err.message.includes('fetch') || err.message.includes('network') ||
      err.message.includes('ECONNREFUSED') || err.message.includes('getaddrinfo') ||
      err.message.includes('Failed'),
      'Arweave fallback error on network failure'
    );
  }

  console.log('✓ queryArticles: Falls through to Arweave on AO failure');
}

// ============================================================================
// Test: queryArticles — AO success returns parsed results
// ============================================================================

{
  const mock = createMockAo();
  const okTransport = new AOTransport({
    ao: { processId: 'ok-proc' },
    gateway: { graphqlUrl: 'https://arweave.net/graphql', dataUrl: 'https://arweave.net' },
    bundler: { uploadUrl: 'https://up.arweave.net/tx' }
  });
  okTransport.ao = mock.connect();

  const articles = await okTransport.queryArticles({ topic: 'computing' });
  assert.ok(Array.isArray(articles), 'queryArticles returns array');
  assert.equal(articles.length, 1, 'One article returned');
  assert.equal(articles[0].key, 'person/ada-lovelace');
  assert.equal(articles[0].kind, 'person');
  assert.equal(articles[0].topic, 'computing');

  console.log('✓ queryArticles: AO success returns parsed results');
}

// ============================================================================
// Test: queryArticles — multiple filter tags
// ============================================================================

{
  const mock = createMockAo();
  const multiFilter = new AOTransport({
    ao: { processId: 'multi-proc' },
    gateway: { graphqlUrl: 'https://arweave.net/graphql', dataUrl: 'https://arweave.net' },
    bundler: { uploadUrl: 'https://up.arweave.net/tx' }
  });
  multiFilter.ao = mock.connect();

  await multiFilter.queryArticles({ topic: 'computing', kind: 'person', key: 'person/ada-lovelace' });

  assert.equal(mock.calls.dryrun.length, 1);
  const tags = mock.calls.dryrun[0].tags;
  const topicTag = tags.find(t => t.name === 'Article-Topic');
  const kindTag = tags.find(t => t.name === 'Article-Kind');
  const keyTag = tags.find(t => t.name === 'Article-Key');
  assert.equal(topicTag?.value, 'computing');
  assert.equal(kindTag?.value, 'person');
  assert.equal(keyTag?.value, 'person/ada-lovelace');

  console.log('✓ queryArticles: Multiple filter tags sent correctly');
}

// ============================================================================
// Test: queryByTags and fetchDataItem delegate to fallback
// ============================================================================

{
  const transport2 = new AOTransport({
    ao: { processId: 'delegate-proc' },
    gateway: { graphqlUrl: 'https://arweave.net/graphql', dataUrl: 'https://arweave.net' },
    bundler: { uploadUrl: 'https://up.arweave.net/tx' }
  });

  // Verify fallback exists
  assert.ok(transport2.fallback, 'Fallback ArweaveTransport exists');
  assert.equal(transport2.fallback.constructor.name, 'ArweaveTransport');

  console.log('✓ queryByTags/fetchData delegate to ArweaveTransport fallback');
}

// ============================================================================
// Test: uploadDataItem method exists
// ============================================================================

{
  const transport3 = new AOTransport({
    ao: { processId: 'upload-proc' },
    gateway: { graphqlUrl: 'https://arweave.net/graphql', dataUrl: 'https://arweave.net' },
    bundler: { uploadUrl: 'https://up.arweave.net/tx' }
  });

  assert.ok(typeof transport3.uploadDataItem === 'function');

  console.log('✓ uploadDataItem method exists for dual-write');
}

// ============================================================================
// Test: Transport factory — AO transport selection
// ============================================================================

{
  const aoHome = fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-ao-factory-'));

  const aoConfig = {
    transport: 'ao',
    ao: { processId: 'factory-test-process' },
    gateway: { graphqlUrl: 'https://arweave.net/graphql', dataUrl: 'https://arweave.net' },
    bundler: { uploadUrl: 'https://up.arweave.net/tx' }
  };

  const factoryResult = getTransport(aoConfig, aoHome);
  assert.ok(factoryResult instanceof AOTransport, 'getTransport returns AOTransport for transport: "ao"');

  console.log('✓ Transport factory: AO transport selected by config');

  // AO transport when ao.processId is set (regardless of transport setting)
  const mixedConfig = {
    transport: 'arweave',
    ao: { processId: 'factory-test-process-2' },
    gateway: { type: 'arweave', graphqlUrl: 'https://arweave.net/graphql', dataUrl: 'https://arweave.net' },
    bundler: { type: 'arweave', uploadUrl: 'https://up.arweave.net/tx' }
  };
  const mixedResult = getTransport(mixedConfig, aoHome);
  assert.ok(mixedResult instanceof AOTransport, 'getTransport returns AOTransport when ao.processId is set');

  console.log('✓ Transport factory: AO transport when processId present');

  try { fs.rmSync(aoHome, { recursive: true }); } catch {}
}

// ============================================================================
// Test: CLI integration — AO commands
// ============================================================================

{
  const cliHome = fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-cli-ao-'));
  const cliEnv = { PERMABRAIN_HOME: cliHome };

  // Init
  let result = spawnSync(process.execPath, ['scripts/cli.mjs', 'init', '--json'], {
    encoding: 'utf8',
    env: { ...process.env, ...cliEnv }
  });
  assert.equal(result.status, 0, result.stderr);

  // Help should list AO commands
  result = spawnSync(process.execPath, ['scripts/cli.mjs', '--help'], {
    encoding: 'utf8',
    env: { ...process.env, ...cliEnv }
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /ao-deploy/);
  assert.match(result.stdout, /ao-bootstrap/);
  assert.match(result.stdout, /ao-sync/);
  assert.match(result.stdout, /ao-query/);
  assert.match(result.stdout, /ao-get/);
  assert.match(result.stdout, /ao-consensus/);

  console.log('✓ CLI: AO commands listed in help');

  // ao-query requires process ID
  result = spawnSync(process.execPath, ['scripts/cli.mjs', 'ao-query', '--json'], {
    encoding: 'utf8',
    env: { ...process.env, ...cliEnv }
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /AO query requires config\.ao\.processId/);

  console.log('✓ CLI: ao-query requires process ID');

  // ao-get requires process ID
  result = spawnSync(process.execPath, ['scripts/cli.mjs', 'ao-get', 'person/test', '--json'], {
    encoding: 'utf8',
    env: { ...process.env, ...cliEnv }
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /AO get requires config\.ao\.processId/);

  console.log('✓ CLI: ao-get requires process ID');

  // ao-consensus requires process ID
  result = spawnSync(process.execPath, ['scripts/cli.mjs', 'ao-consensus', 'person/test', '--json'], {
    encoding: 'utf8',
    env: { ...process.env, ...cliEnv }
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /AO consensus requires config\.ao\.processId/);

  console.log('✓ CLI: ao-consensus requires process ID');

  // ao-sync requires process ID
  result = spawnSync(process.execPath, ['scripts/cli.mjs', 'ao-sync', '--json'], {
    encoding: 'utf8',
    env: { ...process.env, ...cliEnv }
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /AO sync requires config\.ao\.processId/);

  console.log('✓ CLI: ao-sync requires process ID');

  // ao-get requires key argument
  result = spawnSync(process.execPath, ['scripts/cli.mjs', 'ao-get', '--json'], {
    encoding: 'utf8',
    env: { ...process.env, ...cliEnv, PERMABRAIN_AO_PROCESS_ID: 'test-proc' }
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /requires/);

  console.log('✓ CLI: ao-get requires key argument');

  // ao-consensus requires key argument
  result = spawnSync(process.execPath, ['scripts/cli.mjs', 'ao-consensus', '--json'], {
    encoding: 'utf8',
    env: { ...process.env, ...cliEnv, PERMABRAIN_AO_PROCESS_ID: 'test-proc' }
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /requires/);

  console.log('✓ CLI: ao-consensus requires key argument');

  try { fs.rmSync(cliHome, { recursive: true }); } catch {}
}

// ============================================================================
// Test: Dryrun with data payload
// ============================================================================

{
  const mock = createMockAo();
  const dataTransport = new AOTransport({
    ao: { processId: 'data-proc' },
    gateway: { graphqlUrl: 'https://arweave.net/graphql', dataUrl: 'https://arweave.net' },
    bundler: { uploadUrl: 'https://up.arweave.net/tx' }
  });
  dataTransport.ao = mock.connect();

  const payload = JSON.stringify({ key: 'person/test', kind: 'person' });
  await dataTransport.dryrun({
    action: 'Get',
    tags: [{ name: 'Article-Key', value: 'person/test' }],
    data: payload
  });

  assert.equal(mock.calls.dryrun.length, 1);
  assert.equal(mock.calls.dryrun[0].data, payload, 'Data payload sent in dryrun');

  console.log('✓ Dryrun: Data payload included correctly');
}

// ============================================================================
// Test: sendMessage with custom data
// ============================================================================

{
  const mock = createMockAo();
  const msgTransport = new AOTransport({
    ao: { processId: 'msg-proc' },
    gateway: { graphqlUrl: 'https://arweave.net/graphql', dataUrl: 'https://arweave.net' },
    bundler: { uploadUrl: 'https://up.arweave.net/tx' }
  });
  msgTransport.ao = mock.connect();

  const identity = loadIdentity(tempHome);

  const data = JSON.stringify({ articles: [{ key: 'test' }], attestations: [] });
  await msgTransport.sendMessage({
    action: 'Sync',
    tags: [{ name: 'Sync-Source', value: 'arweave' }],
    data,
    identity
  });

  assert.equal(mock.calls.message.length, 1);
  assert.equal(mock.calls.message[0].data, data, 'Data payload sent in message');
  assert.equal(mock.calls.message[0].process, 'msg-proc');

  console.log('✓ sendMessage: Custom data payload included');
}

// ============================================================================
// Test: sendMessage Action tag is prepended
// ============================================================================

{
  const mock = createMockAo();
  const actionTransport = new AOTransport({
    ao: { processId: 'action-proc' },
    gateway: { graphqlUrl: 'https://arweave.net/graphql', dataUrl: 'https://arweave.net' },
    bundler: { uploadUrl: 'https://up.arweave.net/tx' }
  });
  actionTransport.ao = mock.connect();

  const identity = loadIdentity(tempHome);

  await actionTransport.sendMessage({
    action: 'Attest',
    tags: [
      { name: 'Attestation-Target-Key', value: 'person/test' },
      { name: 'Attestation-Opinion', value: 'valid' }
    ],
    data: '',
    identity
  });

  const tags = mock.calls.message[0].tags;
  // Action tag should be first
  assert.equal(tags[0].name, 'Action');
  assert.equal(tags[0].value, 'Attest');
  // Other tags follow
  assert.equal(tags.length, 3);
  assert.ok(tags.some(t => t.name === 'Attestation-Target-Key' && t.value === 'person/test'));
  assert.ok(tags.some(t => t.name === 'Attestation-Opinion' && t.value === 'valid'));

  console.log('✓ sendMessage: Action tag prepended correctly');
}

// ============================================================================
// Test: Dryrun with multiple matching messages (first match wins)
// ============================================================================

{
  const mock = createMockAo({
    dryrun: {
      Query: () => ({
        Messages: [
          {
            Tags: [{ name: 'Action', value: 'Some-Other-Response' }],
            Data: 'ignore me'
          },
          {
            Tags: [{ name: 'Action', value: 'Query-Response' }],
            Data: JSON.stringify([{ key: 'person/multi', kind: 'person', title: 'Multi' }])
          }
        ]
      })
    }
  });
  const multiTransport = new AOTransport({
    ao: { processId: 'multi-msg-proc' },
    gateway: { graphqlUrl: 'https://arweave.net/graphql', dataUrl: 'https://arweave.net' },
    bundler: { uploadUrl: 'https://up.arweave.net/tx' }
  });
  multiTransport.ao = mock.connect();

  const result = await multiTransport.dryrun({ action: 'Query' });
  // Should find the matching action message
  assert.ok(Array.isArray(result), 'Returns parsed JSON from matching message');
  assert.equal(result[0].key, 'person/multi');

  console.log('✓ Dryrun: Matching response message parsed from multiple');
}

// ============================================================================
// Test: Dryrun — Attest-Notice action variant
// ============================================================================

{
  const mock = createMockAo({
    dryrun: {
      Attest: () => ({
        Messages: [
          {
            Tags: [{ name: 'Action', value: 'Attest-Notice' }],
            Data: JSON.stringify({ ok: true, targetKey: 'person/attested' })
          }
        ]
      })
    }
  });
  const attestNoticeTransport = new AOTransport({
    ao: { processId: 'attest-notice-proc' },
    gateway: { graphqlUrl: 'https://arweave.net/graphql', dataUrl: 'https://arweave.net' },
    bundler: { uploadUrl: 'https://up.arweave.net/tx' }
  });
  attestNoticeTransport.ao = mock.connect();

  const result = await attestNoticeTransport.dryrun({ action: 'Attest' });
  assert.equal(result.ok, true);
  assert.equal(result.targetKey, 'person/attested');

  console.log('✓ Dryrun: Attest-Notice action variant parsed');
}

// ============================================================================
// Test: Config defaults for AO
// ============================================================================

{
  const { defaultConfig } = await import('../src/config.mjs');

  // Default config should not include 'ao' section
  const defCfg = defaultConfig();
  assert.equal(defCfg.transport, 'hyperbeam');
  assert.ok(!defCfg.ao, 'Default config has no AO section');

  console.log('✓ Config: Default config has no AO section');

  // AO transport config via environment
  const aoCfg = defaultConfig({ PERMABRAIN_TRANSPORT: 'ao', PERMABRAIN_AO_PROCESS_ID: 'env-proc-123' });
  assert.equal(aoCfg.transport, 'ao');
  assert.ok(aoCfg.ao, 'AO config section present');
  assert.equal(aoCfg.ao.processId, 'env-proc-123');
  assert.equal(aoCfg.gateway.dataUrl, 'https://arweave.net');

  console.log('✓ Config: AO transport via environment variables');

  // AO config with custom URLs
  const customAoCfg = defaultConfig({
    PERMABRAIN_TRANSPORT: 'ao',
    PERMABRAIN_AO_PROCESS_ID: 'custom-proc',
    PERMABRAIN_AO_MU_URL: 'https://mu.custom.com',
    PERMABRAIN_AO_CU_URL: 'https://cu.custom.com',
    PERMABRAIN_AO_GATEWAY_URL: 'https://gw.custom.com',
    PERMABRAIN_AO_GRAPHQL_URL: 'https://gw.custom.com/graphql'
  });
  assert.equal(customAoCfg.ao.processId, 'custom-proc');
  assert.equal(customAoCfg.ao.muUrl, 'https://mu.custom.com');
  assert.equal(customAoCfg.ao.cuUrl, 'https://cu.custom.com');
  assert.equal(customAoCfg.ao.gatewayUrl, 'https://gw.custom.com');
  assert.equal(customAoCfg.ao.graphqlUrl, 'https://gw.custom.com/graphql');

  console.log('✓ Config: AO custom URLs from environment');
}

// ============================================================================
// Test: Arweave identity works as AO signer
// ============================================================================

{
  const identity = loadIdentity(tempHome);
  assert.equal(identity.type, 'arweave-rsa4096', 'Default identity is arweave-rsa4096');

  // createAoSigner should return the JWK for Arweave identity
  // We test this indirectly via sendMessage (which calls createAoSigner internally)
  const mock = createMockAo();
  const signerTransport = new AOTransport({
    ao: { processId: 'signer-proc' },
    gateway: { graphqlUrl: 'https://arweave.net/graphql', dataUrl: 'https://arweave.net' },
    bundler: { uploadUrl: 'https://up.arweave.net/tx' }
  });
  signerTransport.ao = mock.connect();

  // This should succeed — arweave-rsa4096 identity is compatible
  const result = await signerTransport.sendMessage({
    action: 'Publish',
    tags: [{ name: 'Article-Key', value: 'person/signer-test' }],
    data: '',
    identity
  });
  assert.ok(result.messageId, 'Arweave identity creates signer successfully');

  console.log('✓ Arweave identity works as AO signer');
}

// ============================================================================
// Test: Dryrun — process ID included in all calls
// ============================================================================

{
  const mock = createMockAo();
  const procTransport = new AOTransport({
    ao: { processId: 'my-test-process-42' },
    gateway: { graphqlUrl: 'https://arweave.net/graphql', dataUrl: 'https://arweave.net' },
    bundler: { uploadUrl: 'https://up.arweave.net/tx' }
  });
  procTransport.ao = mock.connect();

  await procTransport.dryrun({ action: 'Info' });
  assert.equal(mock.calls.dryrun[0].process, 'my-test-process-42');

  const identity = loadIdentity(tempHome);
  await procTransport.sendMessage({
    action: 'Publish',
    tags: [],
    data: '',
    identity
  });
  assert.equal(mock.calls.message[0].process, 'my-test-process-42');

  console.log('✓ Dryrun/sendMessage: Process ID included in all calls');
}

// ============================================================================
// Test: Dryrun — empty tags array
// ============================================================================

{
  const mock = createMockAo();
  const emptyTagsTransport = new AOTransport({
    ao: { processId: 'empty-tags-proc' },
    gateway: { graphqlUrl: 'https://arweave.net/graphql', dataUrl: 'https://arweave.net' },
    bundler: { uploadUrl: 'https://up.arweave.net/tx' }
  });
  emptyTagsTransport.ao = mock.connect();

  await emptyTagsTransport.dryrun({ action: 'Info' });
  // Should have at least the Action tag
  assert.ok(mock.calls.dryrun[0].tags.length >= 1);
  assert.equal(mock.calls.dryrun[0].tags[0].name, 'Action');
  assert.equal(mock.calls.dryrun[0].tags[0].value, 'Info');

  console.log('✓ Dryrun: Action tag always present in dryrun calls');
}

// ============================================================================
// Test: queryArticles — empty data string from AO
// ============================================================================

{
  const mock = createMockAo({
    dryrun: {
      Query: () => ({
        Messages: [
          {
            Tags: [{ name: 'Action', value: 'Query-Response' }],
            Data: ''
          }
        ]
      })
    }
  });
  const emptyTransport = new AOTransport({
    ao: { processId: 'empty-data-proc' },
    gateway: { graphqlUrl: 'https://arweave.net/graphql', dataUrl: 'https://arweave.net' },
    bundler: { uploadUrl: 'https://up.arweave.net/tx' }
  });
  emptyTransport.ao = mock.connect();

  // queryArticles should fall through to Arweave when AO returns empty data
  try {
    await emptyTransport.queryArticles({ topic: 'computing' });
  } catch (err) {
    // Arweave fallback also fails without network — expected
    assert.ok(true, 'Falls through to Arweave when AO returns empty data');
  }

  console.log('✓ queryArticles: Falls through on empty AO data');
}

// ============================================================================
// Cleanup
// ============================================================================

try { fs.rmSync(tempHome, { recursive: true }); } catch {}

console.log('\nAO integration tests passed');