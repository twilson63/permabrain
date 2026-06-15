/**
 * Unit tests for HyperbeamTransport with mocked bundler/query/match/consensus/reference devices.
 *
 * No HyperBEAM node needed. Mocks fetch and dataitem signing.
 */

import assert from 'node:assert/strict';
import { HyperbeamTransport } from '../src/transport.mjs';
import * as dataitemModule from '../src/dataitem.mjs';
import { buildArticleTags } from '../src/tags.mjs';
import { HyperbeamQuery } from '../src/hb-query.mjs';
import { HyperbeamConsensus } from '../src/hb-consensus.mjs';
import { HyperbeamReference } from '../src/hb-reference.mjs';

const originalFetch = globalThis.fetch;

let callLog = [];
let mockFetchResponse = null;
let mockDataItemId = 0;

function resetMocks() {
  callLog = [];
  mockFetchResponse = null;
  mockDataItemId = 0;
}

function mockFetch(response) {
  mockFetchResponse = response;
  globalThis.fetch = async (url, init) => {
    callLog.push({ url, init });
    if (mockFetchResponse) {
      return mockFetchResponse(url, init);
    }
    return new Response('not found', { status: 404 });
  };
}

function makeTransport(config = {}) {
  return new HyperbeamTransport({
    gateway: { dataUrl: 'http://localhost:10000', graphqlUrl: 'http://localhost:10000/graphql' },
    bundler: { uploadUrl: 'http://localhost:10000/~bundler@1.0/tx?codec-device=ans104@1.0' },
    ...config,
  });
}

const testIdentity = {
  type: 'ed25519',
  agentId: 'test-agent',
  publicKey: 'test-public-key',
  secretKey: 'test-secret-key',
};

async function mockCreateDataItem({ payload, tags, identity }) {
  mockDataItemId += 1;
  const id = `dataitem-${mockDataItemId}`;
  return {
    format: 'ans104@1.0',
    id,
    owner: identity?.agentId || 'unknown',
    timestamp: new Date().toISOString(),
    tags: tags || [],
    payloadBase64: Buffer.from(payload || '').toString('base64url'),
    ans104Base64: Buffer.from(`fake-dataitem-${id}-${Buffer.from(payload || '').toString('base64url')}`).toString('base64url'),
    signature: 'fake-signature',
    publicKey: identity?.publicKey || 'fake-public-key',
  };
}

// Patch HyperbeamReference DataItem builder for transport tests.
import { setDataItemBuilder as setReferenceDataItemBuilder } from '../src/hb-reference.mjs';
const originalReferenceDataItemBuilder = setReferenceDataItemBuilder;
setReferenceDataItemBuilder(mockCreateDataItem);

function Response(body, opts = {}) {
  return {
    ok: opts.status >= 200 && opts.status < 300,
    status: opts.status || 200,
    headers: new Map(Object.entries(opts.headers || {})),
    text: async () => typeof body === 'string' ? body : JSON.stringify(body),
    json: async () => typeof body === 'string' ? JSON.parse(body) : body,
    arrayBuffer: async () => Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)).buffer,
  };
}

async function runTests() {
  // Test probe()
  resetMocks();
  mockFetch((url, init) => {
    if (url === 'http://localhost:10000') return new Response('ok', { status: 200 });
    if (url.includes('/~bundler@1.0/tx')) return new Response('', { status: 200 });
    if (url.includes('/~query@1.0')) return new Response('true', { status: 200 });
    if (url.includes('/~match@1.0')) return new Response('', { status: 200 });
    if (url.includes('/~meta@1.0/info')) return new Response(JSON.stringify({ name: 'test' }), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url === 'http://localhost:10000/graphql') return new Response(JSON.stringify({ data: { transactions: { edges: [] } } }), { status: 200, headers: { 'content-type': 'application/json' } });
    return new Response('not found', { status: 404 });
  });
  const transport = makeTransport();
  const probe = await transport.probe();
  assert.ok(probe.ok, 'probe should be ok when health passes');
  assert.ok(probe.checks.some((c) => c.name === 'health' && c.ok));
  assert.equal(probe.checks.length, 7);

  // Test uploadDataItem()
  resetMocks();
  mockFetch((url, init) => {
    if (url.includes('/~bundler@1.0/tx')) {
      return new Response(JSON.stringify({ id: 'uploaded-id' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('not found', { status: 404 });
  });
  const content = '# Test Article\n';
  const tags = buildArticleTags({
    key: 'subject/hb-transport',
    kind: 'subject',
    title: 'HB Transport Test',
    topic: 'test',
    sourceName: 'PermaBrain',
    sourceUrl: 'https://example.invalid/',
    sourceLicense: 'test',
    content,
    agentId: testIdentity.agentId,
  });
  const item = await mockCreateDataItem({ payload: content, tags, identity: testIdentity });
  const upload = await transport.uploadDataItem(item);
  assert.equal(upload.id, item.id);
  assert.equal(upload.status, 'uploaded');
  assert.ok(callLog.some((c) => c.url.includes('/~bundler@1.0/tx') && c.init.method === 'POST'));

  // Test fetchDataItem() via HTTP-SIG headers
  resetMocks();
  mockFetch((url) => {
    if (url === `http://localhost:10000/${encodeURIComponent(item.id)}`) {
      return new Response('article body', {
        status: 200,
        headers: {
          'content-type': 'text/plain',
          'article-key': 'subject/hb-transport',
          'app-name': 'PermaBrain',
        },
      });
    }
    return new Response('not found', { status: 404 });
  });
  const fetched = await transport.fetchDataItem(item.id);
  assert.equal(fetched.format, 'httpsig@1.0');
  assert.equal(fetched.payload, 'article body');
  assert.ok(fetched.tags.some((t) => t.name === 'Article-Key' && t.value === 'subject/hb-transport'));

  // Test fetchData()
  resetMocks();
  mockFetch((url) => {
    if (url === `http://localhost:10000/${encodeURIComponent(item.id)}`) {
      return new Response('raw content', { status: 200, headers: { 'content-type': 'text/plain' } });
    }
    return new Response('not found', { status: 404 });
  });
  const data = await transport.fetchData(item.id);
  assert.equal(Buffer.from(data).toString('utf8'), 'raw content');

  // Test queryByTags() via query device
  resetMocks();
  mockFetch((url) => {
    if (url.includes('/~query@1.0')) {
      return new Response(JSON.stringify([{ id: 'id-1', tags: [] }, { id: 'id-2', tags: [] }]), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('not found', { status: 404 });
  });
  const results = await transport.queryByTags({ 'App-Name': 'PermaBrain' });
  assert.equal(results.length, 2);
  assert.ok(results.every((r) => typeof r.id === 'string'));

  // Test findAttestations()
  resetMocks();
  mockFetch((url) => {
    if (url.includes('/~match@1.0/Attestation-Target=')) {
      return new Response('att-1\natt-2\n', { status: 200 });
    }
    return new Response('not found', { status: 404 });
  });
  const attestations = await transport.findAttestations('article-1');
  assert.deepEqual(attestations, ['att-1', 'att-2']);

  // Test computeConsensus() fallback
  resetMocks();
  mockFetch((url) => {
    if (url.includes('/~match@1.0/Attestation-Target=')) {
      return new Response('att-1\n', { status: 200 });
    }
    if (url === `http://localhost:10000/att-1`) {
      return new Response('', {
        status: 200,
        headers: {
          'attestation-target': 'article-1',
          'attestation-valid': 'valid',
          'attestation-confidence': '0.9',
        },
      });
    }
    return new Response('not found', { status: 404 });
  });
  const consensus = await transport.computeConsensus('article-1');
  assert.equal(consensus.method, 'query-fallback');
  assert.equal(consensus.score, 0.9);
  assert.equal(consensus.count, 1);
  assert.equal(consensus.validCount, 1);

  // Test resolveProcess()
  resetMocks();
  mockFetch((url) => {
    if (url.includes('~process@1.0/now')) {
      return new Response(JSON.stringify({ now: 12345 }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('not found', { status: 404 });
  });
  const processState = await transport.resolveProcess('proc-1', 'now');
  assert.deepEqual(processState, { now: 12345 });

  // Test metaInfo()
  resetMocks();
  mockFetch((url) => {
    if (url.includes('/~meta@1.0/info')) {
      return new Response(JSON.stringify({ version: '1.0.0' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('not found', { status: 404 });
  });
  const meta = await transport.metaInfo();
  assert.equal(meta.version, '1.0.0');

  // Test pushMessage()
  resetMocks();
  mockFetch((url, init) => {
    if (url.includes('~push@1.0')) {
      return new Response(JSON.stringify({ pushed: true }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('not found', { status: 404 });
  });
  const push = await transport.pushMessage({
    scheduler: 'sched-1',
    data: Buffer.from('hello'),
    tags: [{ name: 'Action', value: 'Test' }],
    signer: testIdentity,
  });
  assert.deepEqual(push.response, { pushed: true });

  // Test reference operations through transport.reference
  resetMocks();
  const refTransport = makeTransport();
  refTransport.reference.create = async (value, signer) => {
    callLog.push({ type: 'reference-create', value, signer: signer?.agentId });
    return { referenceId: 'ref-article-1', value };
  };
  refTransport.reference.update = async (referenceId, value, signer) => {
    callLog.push({ type: 'reference-update', referenceId, value, signer: signer?.agentId });
    return { referenceId, value, timestamp: 12345 };
  };
  refTransport.reference.resolve = async (referenceId, path) => {
    callLog.push({ type: 'reference-resolve', referenceId, path });
    return { current: 'version-2' };
  };

  const createdRef = await refTransport.reference.createArticleReference('subject/hb-transport', 'article-v1', testIdentity);
  assert.equal(createdRef.referenceId, 'ref-article-1');
  assert.deepEqual(createdRef.value, { 'article-key': 'subject/hb-transport', 'current-version': 'article-v1' });

  const updatedRef = await refTransport.reference.updateArticleReference('ref-article-1', 'article-v2', testIdentity);
  assert.equal(updatedRef.timestamp, 12345);

  const resolvedRef = await refTransport.reference.resolve('ref-article-1');
  assert.deepEqual(resolvedRef, { current: 'version-2' });

  // Test whois()
  resetMocks();
  mockFetch((url) => {
    if (url.includes('/~whois@1.0/')) {
      return new Response(JSON.stringify({ agent: 'test-agent' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('not found', { status: 404 });
  });
  const whois = await transport.whois('test-agent');
  assert.deepEqual(whois, { agent: 'test-agent' });

  // Test GraphQL fallback when query device fails
  resetMocks();
  let callCount = 0;
  mockFetch((url) => {
    callCount += 1;
    if (url.includes('/~query@1.0')) {
      return new Response('error', { status: 500 });
    }
    if (url === 'http://localhost:10000/graphql') {
      return new Response(JSON.stringify({
        data: {
          transactions: {
            edges: [{ node: { id: 'gql-id-1', tags: [{ name: 'App-Name', value: 'PermaBrain' }] } }],
            pageInfo: { hasNextPage: false },
          },
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('not found', { status: 404 });
  });
  const fallbackResults = await transport.queryByTags({ 'App-Name': 'PermaBrain' });
  assert.equal(fallbackResults.length, 1);
  assert.equal(fallbackResults[0].id, 'gql-id-1');

  console.log('hb-transport unit tests passed');
}

runTests().finally(() => {
  globalThis.fetch = originalFetch;
  setReferenceDataItemBuilder(originalReferenceDataItemBuilder);
});
