/**
 * End-to-end mocked test for HyperBEAM reference-enabled publish/get/attest flow.
 *
 * Each test runs in a unique temp PERMABRAIN_HOME and uses unique article keys
 * with a test-run nonce, so DataItem IDs and version history are isolated across
 * runs. Mocks fetch and HyperbeamTransport reference methods per-test.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { publishArticle, getArticle, queryArticles } from '../src/article.mjs';
import { attestArticle, queryAttestationsForKey } from '../src/attestation.mjs';
import { consensusForArticle } from '../src/consensus.mjs';
import { HyperbeamTransport } from '../src/transport.mjs';
import { initState } from '../src/config.mjs';
import { ensureIdentity } from '../src/keys.mjs';
import { createDataItem } from '../src/dataitem.mjs';
import { buildArticleTags } from '../src/tags.mjs';

const transportProto = Object.getPrototypeOf(new HyperbeamTransport({ gateway: { dataUrl: 'http://localhost:10000' }, bundler: {} }));
const originalCreateArticleReference = transportProto.createArticleReference;
const originalUpdateArticleReference = transportProto.updateArticleReference;

const nonce = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

function makeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), `permabrain-hb-e2e-${nonce}-`));
  process.env.PERMABRAIN_HOME = home;
  process.env.PERMABRAIN_TRANSPORT = 'hyperbeam';
  initState({ env: { ...process.env, PERMABRAIN_HOME: home, PERMABRAIN_TRANSPORT: 'hyperbeam' } });
  return home;
}

function makeKey(base) {
  return `subject/${base}-${nonce}`;
}

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
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
    arrayBuffer: async () => Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)).buffer,
  };
}

let testRegistry = new Map(); // article-key -> { id, version, content, tags }
let testReferences = new Map(); // refId -> current article id

function resetRegistry() {
  testRegistry = new Map();
  testReferences = new Map();
}

async function buildItem(identity, content, key, version = 1) {
  const tags = buildArticleTags({
    key,
    kind: 'subject',
    title: key.split('/').at(-1).replace(/-/g, ' '),
    topic: 'e2e-test',
    sourceName: 'test',
    sourceUrl: `https://example.invalid/${key}`,
    sourceLicense: 'test',
    content,
    agentId: identity.agentId,
    version,
  });
  return createDataItem({ payload: content, tags, identity });
}

async function setupMockTransport(home) {
  const identity = await ensureIdentity(home, { keyType: 'ed25519' });

  transportProto.createArticleReference = async (articleKey, articleId) => {
    const refId = `ref-${articleKey.replace(/\//g, '--')}`;
    testReferences.set(refId, articleId);
    const cachePath = path.join(home, 'cache', 'article-references.json');
    const refs = fs.existsSync(cachePath) ? JSON.parse(fs.readFileSync(cachePath, 'utf8')) : {};
    refs[articleKey] = refId;
    fs.writeFileSync(cachePath, JSON.stringify(refs, null, 2) + '\n');
    return { referenceId: refId, value: { 'article-key': articleKey, 'current-version': articleId } };
  };

  transportProto.updateArticleReference = async (referenceId, newArticleId) => {
    testReferences.set(referenceId, newArticleId);
    return { referenceId, value: { 'current-version': newArticleId }, timestamp: Date.now() };
  };

  return identity;
}

function mockFetchFactory() {
  return async (url, init) => {
    if (url.includes('/~bundler@1.0/tx')) {
      const body = init?.body;
      if (body) {
        const arrayBuffer = await (body instanceof Blob ? body.arrayBuffer() : Buffer.from(body));
        const bytes = Buffer.from(arrayBuffer);
        // Parse the fake dataitem bytes to extract id and tags for the registry
        const b64 = bytes.toString('base64url');
        const idMatch = b64.match(/fake-dataitem-(dataitem-[\w-]+)/);
        const id = idMatch ? idMatch[1] : `uploaded-${Date.now()}`;
        // Build a minimal registry entry from the serialized fake data item
        const tagEntries = [...b64.matchAll(/article-key|attestation-target-key/g)];
        // The registry is instead populated by the publisher in this test.
      }
      return new Response('uploaded', { status: 200 });
    }
    if (url.includes('/~query@1.0')) {
      const qs = url.split('?')[1] || '';
      const params = Object.fromEntries(new URLSearchParams(qs));
      const type = params['permabrain-type'];
      const key = params['article-key'];
      if (type === 'article' && key && testRegistry.has(key)) {
        return new Response(JSON.stringify([testRegistry.get(key)]), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (type === 'reference' && key) {
        const refId = `ref-${key.replace(/\//g, '--')}`;
        if (testReferences.has(refId)) {
          return new Response(JSON.stringify([{ id: refId }]), { status: 200, headers: { 'content-type': 'application/json' } });
        }
      }
      if (type === 'attestation' && params['attestation-target-key']) {
        const matches = [...testRegistry.values()].filter((entry) => entry.targetKey === params['attestation-target-key']);
        return new Response(JSON.stringify(matches), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.includes('~reference@1.0/current-version')) {
      const parts = url.split('/');
      const refPart = parts.find((p) => p.includes('~reference@1.0'));
      const refId = refPart ? refPart.split('~')[0] : '';
      const resolved = testReferences.get(refId);
      if (!resolved) return new Response('not found', { status: 404 });
      return new Response(JSON.stringify(resolved), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    // Fetch data item by id
    const directId = decodeURIComponent(url.split('/').pop() || '');
    for (const entry of testRegistry.values()) {
      if (entry.id === directId) {
        return new Response(entry.content, {
          status: 200,
          headers: Object.fromEntries(entry.tags.map((t) => [t.name.toLowerCase(), t.value])),
        });
      }
    }
    if (url === 'http://localhost:10000/graphql') {
      return new Response(JSON.stringify({ data: { transactions: { edges: [], pageInfo: { hasNextPage: false } } } }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('not found', { status: 404 });
  };
}

async function runTests() {
  // Test: publish v1 and v2 of an article, reference follows latest
  {
    resetRegistry();
    const home = makeHome();
    const identity = await setupMockTransport(home);
    globalThis.fetch = mockFetchFactory();
    const key = makeKey('evolving');

    const v1 = await publishArticle({
      content: '# Evolving Article\n\nFirst version.',
      kind: 'subject',
      topic: 'e2e-test',
      key,
      title: 'Evolving Article',
      sourceUrl: 'https://example.invalid/' + key,
      useHyperbeamReference: true,
    });
    assert.equal(v1.summary.key, key);
    assert.equal(v1.reference.action, 'create');
    testRegistry.set(key, { id: v1.summary.id, version: 1, content: '# Evolving Article\n\nFirst version.', tags: v1.item.tags });

    const v2 = await publishArticle({
      content: '# Evolving Article\n\nSecond version.',
      kind: 'subject',
      topic: 'e2e-test',
      key,
      title: 'Evolving Article',
      sourceUrl: 'https://example.invalid/' + key,
      useHyperbeamReference: true,
    });
    assert.equal(v2.summary.key, key);
    assert.equal(v2.reference.action, 'update');
    assert.equal(v2.reference.referenceId, v1.reference.referenceId);
    assert.notEqual(v2.summary.id, v1.summary.id);
    testRegistry.set(key, { id: v2.summary.id, version: 2, content: '# Evolving Article\n\nSecond version.', tags: v2.item.tags });

    const got = await getArticle(key);
    assert.equal(got.viaReference, true);
    assert.equal(got.content, '# Evolving Article\n\nSecond version.');

    fs.rmSync(home, { recursive: true, force: true });
  }

  // Test: attest article via reference and compute consensus
  {
    resetRegistry();
    const home = makeHome();
    const identity = await setupMockTransport(home);
    globalThis.fetch = mockFetchFactory();
    const key = makeKey('attested');

    const published = await publishArticle({
      content: '# Attested Article\n\nContent.',
      kind: 'subject',
      topic: 'e2e-test',
      key,
      title: 'Attested Article',
      sourceUrl: 'https://example.invalid/' + key,
      useHyperbeamReference: true,
    });
    testRegistry.set(key, { id: published.summary.id, version: 1, content: '# Attested Article\n\nContent.', tags: published.item.tags });

    const attested = await attestArticle({
      key,
      opinion: 'valid',
      confidence: 0.95,
      reason: 'Accurate and well-sourced.',
      useHyperbeamReference: false,
    });
    assert.equal(attested.summary.targetKey, key);
    assert.equal(attested.summary.opinion, 'valid');
    testRegistry.set(`att-${key}`, {
      id: attested.summary.id,
      targetKey: key,
      targetId: published.summary.id,
      opinion: 'valid',
      confidence: 0.95,
      agentId: identity.agentId,
      createdAt: new Date().toISOString(),
    });

    const consensus = await consensusForArticle(key);
    assert.equal(consensus.status, 'attested');
    assert.equal(consensus.totalAttestations, 1);
    assert.equal(consensus.score, 0.95);
    assert.equal(consensus.opinionCounts.valid, 1);

    fs.rmSync(home, { recursive: true, force: true });
  }

  // Test: queryArticles returns HyperBEAM results without cross-test leakage
  {
    resetRegistry();
    const home = makeHome();
    await setupMockTransport(home);
    globalThis.fetch = mockFetchFactory();
    const key = makeKey('queryable');

    const published = await publishArticle({
      content: '# Queryable Article\n\nContent.',
      kind: 'subject',
      topic: 'e2e-test',
      key,
      title: 'Queryable Article',
      sourceUrl: 'https://example.invalid/' + key,
      useHyperbeamReference: true,
    });
    testRegistry.set(key, { id: published.summary.id, version: 1, content: '# Queryable Article\n\nContent.', tags: published.item.tags });

    const articles = await queryArticles({ topic: 'e2e-test' });
    assert.equal(articles.length, 1);
    assert.equal(articles[0].key, key);

    fs.rmSync(home, { recursive: true, force: true });
  }

  console.log('hb-e2e tests passed');
}

await runTests();
transportProto.createArticleReference = originalCreateArticleReference;
transportProto.updateArticleReference = originalUpdateArticleReference;
