/**
 * Unit tests for article publish/get HyperBEAM reference integration.
 *
 * Uses mocked HyperbeamTransport so no HyperBEAM node is needed.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { publishArticle, getArticle, queryArticles } from '../src/article.mjs';
import { HyperbeamTransport } from '../src/transport.mjs';
import { initState } from '../src/config.mjs';
import { ensureIdentity } from '../src/keys.mjs';
import { buildArticleTags } from '../src/tags.mjs';
import { createDataItem, rawDataItemBytes } from '../src/dataitem.mjs';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-article-ref-'));
process.env.PERMABRAIN_HOME = home;
process.env.PERMABRAIN_TRANSPORT = 'hyperbeam';
initState({ env: { ...process.env, PERMABRAIN_HOME: home, PERMABRAIN_TRANSPORT: 'hyperbeam' } });
await ensureIdentity(home, { keyType: 'ed25519' });

function Response(body, opts = {}) {
  const status = opts.status || 200;
  const headers = opts.headers || {};
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (k) => headers[k] || null,
      entries: () => Object.entries(headers),
    },
    text: async () => typeof body === 'string' ? body : JSON.stringify(body),
    json: async () => typeof body === 'string' ? JSON.parse(body) : body,
    arrayBuffer: async () => Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)).buffer,
  };
}

const transportProto = Object.getPrototypeOf(new HyperbeamTransport({ gateway: { dataUrl: 'http://localhost:10000' }, bundler: {} }));
const originalCreateArticleReference = transportProto.createArticleReference;
const originalUpdateArticleReference = transportProto.updateArticleReference;
let createdRefId = null;
transportProto.createArticleReference = async (articleKey, articleId, signer) => {
  createdRefId = 'ref-' + Math.random().toString(36).slice(2);
  return { referenceId: createdRefId, value: { 'article-key': articleKey, 'current-version': articleId } };
};
transportProto.updateArticleReference = async (referenceId, newArticleId, signer) => {
  return { referenceId, value: { 'current-version': newArticleId }, timestamp: Date.now() };
};

async function buildItem(identity, content, key) {
  const tags = buildArticleTags({
    key,
    kind: 'subject',
    title: key.split('/').at(-1).replace(/-/g, ' '),
    topic: 'test',
    sourceName: 'test',
    sourceUrl: 'https://example.invalid/' + key,
    sourceLicense: 'test',
    content,
    agentId: identity.agentId,
  });
  return createDataItem({ payload: content, tags, identity });
}

function mockResponse(url, body, opts = {}) {
  return new Response(body, { status: 200, headers: { 'content-type': 'application/json' }, ...opts });
}

async function runTests() {
  // Test 1: publishing a new article on HyperBEAM creates a reference
  globalThis.fetch = async (url, init) => {
    if (url.includes('/~bundler@1.0/tx')) return new Response('uploaded', { status: 200 });
    if (url.includes('/~query@1.0')) return mockResponse(url, JSON.stringify([]));
    if (url === 'http://localhost:10000/graphql') return mockResponse(url, JSON.stringify({ data: { transactions: { edges: [], pageInfo: { hasNextPage: false } } } }));
    return new Response('not found', { status: 404 });
  };

  const result1 = await publishArticle({
    content: '# Test Article\n\nFirst version.',
    kind: 'subject',
    topic: 'test',
    title: 'Test Article',
    sourceUrl: 'https://example.invalid/test',
    useHyperbeamReference: true,
  });
  assert.ok(result1.summary.id);
  assert.ok(result1.reference);
  assert.equal(result1.reference.action, 'create');
  assert.ok(result1.reference.referenceId);

  // Test 2: updating the article updates the reference
  globalThis.fetch = async (url, init) => {
    if (url.includes('/~bundler@1.0/tx')) return new Response('uploaded', { status: 200 });
    if (url.includes('/~query@1.0')) return mockResponse(url, JSON.stringify([]));
    if (url === 'http://localhost:10000/graphql') return mockResponse(url, JSON.stringify({ data: { transactions: { edges: [], pageInfo: { hasNextPage: false } } } }));
    return new Response('not found', { status: 404 });
  };

  // Seed the local reference cache so the update path is taken
  const refCachePath = path.join(home, 'cache', 'article-references.json');
  fs.writeFileSync(refCachePath, JSON.stringify({ 'subject/test-article': result1.reference.referenceId }, null, 2) + '\n');

  const result2 = await publishArticle({
    content: '# Test Article\n\nSecond version.',
    kind: 'subject',
    topic: 'test',
    title: 'Test Article',
    sourceUrl: 'https://example.invalid/test',
    useHyperbeamReference: true,
  });
  assert.equal(result2.reference.action, 'update');
  assert.equal(result2.reference.referenceId, result1.reference.referenceId);

  // Test 3: get() resolves article via reference pointer
  const { identity } = await ensureIdentity(home, { keyType: 'ed25519' });
  const itemV2 = await buildItem(identity, '# Test Article\n\nSecond version.', 'subject/test-article');
  globalThis.fetch = async (url) => {
    if (url.includes('~reference@1.0/current-version')) return mockResponse(url, JSON.stringify(itemV2.id));
    if (url === `http://localhost:10000/${encodeURIComponent(itemV2.id)}`) {
      return new Response('# Test Article\n\nSecond version.', {
        status: 200,
        headers: {
          'content-type': 'text/plain',
          'article-key': 'subject/test-article',
          'article-kind': 'subject',
          'article-topic': 'test',
          'app-name': 'PermaBrain',
          'permabrain-type': 'article',
        },
      });
    }
    if (url.includes('/~query@1.0')) return mockResponse(url, JSON.stringify([]));
    if (url === 'http://localhost:10000/graphql') return mockResponse(url, JSON.stringify({ data: { transactions: { edges: [], pageInfo: { hasNextPage: false } } } }));
    return new Response('not found', { status: 404 });
  };

  const got = await getArticle('subject/test-article');
  assert.equal(got.viaReference, true);
  assert.equal(got.content, '# Test Article\n\nSecond version.');

  // Test 4: reference resolution is skipped when transport is not HyperbeamTransport
  // (already covered by default Arweave transport in test/test.mjs)

  // Test 5: queryArticles still works with HyperbeamTransport
  globalThis.fetch = async (url) => {
    if (url.includes('/~query@1.0')) return mockResponse(url, JSON.stringify([{ id: itemV2.id, tags: itemV2.tags }]));
    if (url === 'http://localhost:10000/graphql') return mockResponse(url, JSON.stringify({ data: { transactions: { edges: [], pageInfo: { hasNextPage: false } } } }));
    return new Response('not found', { status: 404 });
  };

  const articles = await queryArticles({ topic: 'test' });
  assert.equal(articles.length, 1);
  assert.equal(articles[0].key, 'subject/test-article');

  console.log('article-hb-reference tests passed');
}

await runTests();
transportProto.createArticleReference = originalCreateArticleReference;
transportProto.updateArticleReference = originalUpdateArticleReference;
fs.rmSync(home, { recursive: true, force: true });
