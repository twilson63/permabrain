/**
 * Unit tests for HyperbeamReference (reference@1.0)
 *
 * Uses mocked fetch and mocked dataitem signer so no HyperBEAM node is needed.
 */

import assert from 'node:assert/strict';
import { HyperbeamReference } from '../src/hb-reference.mjs';
import { DEVICES } from '../src/hb-devices.mjs';

const originalFetch = globalThis.fetch;
const originalCreateDataItem = (await import('../src/dataitem.mjs')).createDataItem;

let callLog = [];
let mockFetchResponse = null;

function resetMocks() {
  callLog = [];
  mockFetchResponse = null;
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

function mockDataItem(id) {
  return {
    id,
    ans104Base64: Buffer.from(`fake-dataitem-${id}`).toString('base64url'),
  };
}

async function mockCreateDataItem({ payload, tags, identity }) {
  const id = `dataitem-${payload ? payload.length : 0}-${tags.length}`;
  return mockDataItem(id);
}

const signer = { address: 'test-address' };

async function runTests() {
  // Override createDataItem import inside hb-reference via module mock not trivial,
  // so we patch the dynamic import by injecting a helper: HyperbeamReference uses
  // await import('./dataitem.mjs').createDataItem. We can't easily intercept ESM
  // dynamic imports, so we test resolve() first (no dataitem dependency), then
  // test create/update by patching the module namespace via import reflection.

  // Test resolve()
  resetMocks();
  mockFetch((url) => {
    assert.match(url, /\/ref-123~reference@1\.0/);
    return new Response(JSON.stringify({ current: 'value' }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  const ref = new HyperbeamReference('http://localhost:10000');
  const resolved = await ref.resolve('ref-123');
  assert.deepEqual(resolved, { current: 'value' });
  assert.equal(callLog.length, 1);
  assert.equal(callLog[0].url, 'http://localhost:10000/ref-123~reference@1.0');

  // Test resolve() with path
  resetMocks();
  mockFetch((url) => new Response(JSON.stringify({ balance: 42 }), { status: 200, headers: { 'content-type': 'application/json' } }));
  const resolvedPath = await ref.resolve('ref-123', 'alice/balance');
  assert.deepEqual(resolvedPath, { balance: 42 });
  assert.equal(callLog[0].url, 'http://localhost:10000/ref-123~reference@1.0/alice/balance');

  // Test resolve() throws on HTTP error
  resetMocks();
  mockFetch(() => new Response('not found', { status: 404 }));
  await assert.rejects(ref.resolve('missing'), /Reference resolve failed: HTTP 404/);

  // Test createArticleReference and updateArticleReference shape using stubbed create/update
  const stubRef = new HyperbeamReference('http://localhost:10000');
  stubRef.create = async (value, s) => {
    callLog.push({ type: 'create', value, signer: s });
    return { referenceId: 'ref-article-1', value };
  };
  stubRef.update = async (referenceId, value, s) => {
    callLog.push({ type: 'update', referenceId, value, signer: s });
    return { referenceId, value, timestamp: 12345 };
  };

  resetMocks();
  const created = await stubRef.createArticleReference('subject/test', 'article-id-1', signer);
  assert.equal(created.referenceId, 'ref-article-1');
  assert.deepEqual(created.value, { 'article-key': 'subject/test', 'current-version': 'article-id-1' });

  const updated = await stubRef.updateArticleReference('ref-article-1', 'article-id-2', signer);
  assert.equal(updated.referenceId, 'ref-article-1');
  assert.deepEqual(updated.value, { 'current-version': 'article-id-2' });

  // Test createSet shapes directory correctly
  resetMocks();
  stubRef.create = async (value, s) => {
    callLog.push({ type: 'createSet', value, signer: s });
    return { referenceId: 'ref-set-1', value };
  };
  const setResult = await stubRef.createSet({ ai: 'ref-ai', crypto: 'ref-crypto' }, signer);
  assert.equal(setResult.referenceId, 'ref-set-1');
  assert.deepEqual(setResult.value, {
    ai: { device: 'reference@1.0', 'reference-id': 'ref-ai' },
    crypto: { device: 'reference@1.0', 'reference-id': 'ref-crypto' },
  });

  console.log('hb-reference unit tests passed');
}

runTests().finally(() => {
  globalThis.fetch = originalFetch;
});
