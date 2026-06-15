/**
 * Unit tests for agent API HyperBEAM transport wiring.
 *
 * Verifies that api.init({ transport: 'hyperbeam' }) writes a hyperbeam config
 * and that api.query/get/attest/consensus/sync/batchAttest/autoImport forward
 * useHyperbeam/useHyperbeamReference options to the underlying functions.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { api } from '../src/index.mjs';
import { getTransport, HyperbeamTransport } from '../src/transport.mjs';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-api-hb-'));
process.env.PERMABRAIN_HOME = home;

function resetApi() {
  api._home = null;
  api._config = null;
  api._identity = null;
}

function Response(body, opts = {}) {
  return {
    ok: opts.status >= 200 && opts.status < 300,
    status: opts.status || 200,
    headers: { get: (k) => opts.headers?.[k] || null, entries: () => Object.entries(opts.headers || {}) },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
    arrayBuffer: async () => Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)).buffer,
  };
}

async function initLocal() {
  resetApi();
  return api.init({ transport: 'local' });
}

function articleResponse(id, key = `subject/${id}`) {
  return new Response(JSON.stringify([{ id, tags: [
    { name: 'App-Name', value: 'PermaBrain' },
    { name: 'PermaBrain-Type', value: 'article' },
    { name: 'Article-Key', value: key },
    { name: 'Article-Version', value: '1' },
    { name: 'Article-Content-Hash', value: 'dummy' },
  ] }]), { status: 200, headers: { 'content-type': 'application/json' } });
}

function bundlerResponse() {
  return new Response('uploaded', { status: 200 });
}

function hbFetch({ articles = [], content = null }) {
  let idx = 0;
  return async (url, init) => {
    if (url.includes('/~bundler@1.0/tx')) return bundlerResponse();
    if (url.includes('~reference@1.0/current-version')) return new Response(JSON.stringify('dummy-ref-id'), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.includes('/~query@1.0') || url.endsWith('/graphql')) {
      const id = articles[idx++] || 'hb-test-id';
      return articleResponse(id, `subject/${id}`);
    }
    if (content && url.endsWith(content.idUrl)) return new Response(content.body, { status: 200, headers: content.headers || {} });
    return new Response('not found', { status: 404 });
  };
}

async function runTests() {
  // 1. init with transport='hyperbeam' writes correct config
  resetApi();
  const initResult = await api.init({ transport: 'hyperbeam', dataUrl: 'http://hb.local:10000' });
  assert.equal(initResult.config.transport, 'hyperbeam');
  assert.equal(initResult.config.gateway.type, 'hyperbeam');
  assert.equal(initResult.config.gateway.dataUrl, 'http://hb.local:10000');
  assert.equal(initResult.config.gateway.graphqlUrl, 'http://hb.local:10000/graphql');
  assert.equal(initResult.config.bundler.type, 'hyperbeam');
  assert.equal(initResult.config.bundler.uploadUrl, 'http://hb.local:10000/~bundler@1.0/tx?codec-device=ans104@1.0');

  // 2. getTransport with useHyperbeam returns HyperbeamTransport
  const localConfig = { transport: 'local' };
  const t = getTransport(localConfig, home, { useHyperbeam: true });
  assert.ok(t instanceof HyperbeamTransport, 'useHyperbeam forces HyperbeamTransport');

  // 3. publish forwards useHyperbeam and useHyperbeamReference
  await initLocal();
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ transport: 'local' }, null, 2) + '\n');
  globalThis.fetch = hbFetch({ articles: ['pub-existing'] });
  const pubResult = await api.publish({
    content: '# API HB Article\n\nBody.',
    kind: 'subject',
    topic: 'api-hb',
    sourceUrl: 'https://example.invalid/api-hb',
    title: 'API HB Article',
    useHyperbeam: true,
    useHyperbeamReference: true,
  });
  assert.ok(pubResult.summary.id, 'publish returned id');
  assert.ok(pubResult.summary.key, 'publish returned key');

  // 4. query forwards useHyperbeam
  await initLocal();
  globalThis.fetch = hbFetch({ articles: ['api-q-1'] });
  const qResult = await api.query({ topic: 'api-hb-query', useHyperbeam: true });
  assert.equal(qResult.length, 1);
  assert.equal(qResult[0].id, 'api-q-1');

  // 5. get forwards useHyperbeam and resolves via reference
  await initLocal();
  const refId = 'ref-subject--api-hb-get';
  fs.writeFileSync(path.join(home, 'cache', 'article-references.json'), JSON.stringify({ 'subject/api-hb-get': refId }, null, 2) + '\n');
  globalThis.fetch = async (url) => {
    if (url.includes('~reference@1.0/current-version')) return new Response(JSON.stringify('article-id-get'), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.endsWith('/article-id-get')) {
      return new Response('# API HB Get\n\nContent.', {
        status: 200,
        headers: {
          'content-type': 'text/plain',
          'article-key': 'subject/api-hb-get',
          'article-kind': 'subject',
          'article-topic': 'api-hb',
          'app-name': 'PermaBrain',
          'permabrain-type': 'article',
        },
      });
    }
    return new Response('not found', { status: 404 });
  };
  const got = await api.get('subject/api-hb-get', { useHyperbeam: true });
  assert.equal(got.content, '# API HB Get\n\nContent.');

  // 6. attest forwards useHyperbeam
  await initLocal();
  globalThis.fetch = hbFetch({ articles: [] });
  const target = await api.publish({
    content: '# Attest Target\n\nBody.',
    kind: 'subject',
    topic: 'api-hb',
    sourceUrl: 'https://example.invalid/attest-target',
    title: 'Attest Target',
    useHyperbeam: true,
  });
  assert.ok(target.summary?.key, 'target has key');
  const attResult = await api.attest(target.summary.key, {
    opinion: 'valid',
    confidence: 0.9,
    reason: 'Good.',
    useHyperbeam: true,
  });
  assert.equal(attResult.summary.targetKey, target.summary.key);
  assert.equal(attResult.summary.opinion, 'valid');

  // 7. consensus forwards useHyperbeam
  await initLocal();
  globalThis.fetch = async (url) => {
    if (url.includes('/~query@1.0') && url.includes('PermaBrain-Type=article')) {
      return articleResponse('article-id-consensus', 'subject/api-hb-consensus');
    }
    if (url.includes('/~query@1.0') && url.includes('PermaBrain-Type=attestation')) {
      return new Response(JSON.stringify([{
        id: 'att-1',
        tags: [
          { name: 'Attestation-Target-Id', value: 'article-id-consensus' },
          { name: 'Attestation-Target-Key', value: 'subject/api-hb-consensus' },
          { name: 'Attestation-Opinion', value: 'valid' },
          { name: 'Attestation-Confidence', value: '0.8' },
          { name: 'Attestation-Agent-Id', value: 'agent-1' },
          { name: 'Attestation-Created-At', value: new Date().toISOString() },
        ],
      }]), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.includes('/~query@1.0') || url.endsWith('/graphql')) return new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } });
    return new Response('not found', { status: 404 });
  };
  const conResult = await api.consensus('subject/api-hb-consensus', { useHyperbeam: true });
  assert.equal(conResult.status, 'attested');
  assert.equal(conResult.totalAttestations, 1);
  assert.equal(conResult.score, 0.8);

  // 8. batchAttest forwards useHyperbeam
  await initLocal();
  globalThis.fetch = hbFetch({ articles: [] });
  const batchResult = await api.batchAttest({
    useHyperbeam: true,
    attestations: [
      { key: target.summary.key, opinion: 'valid', confidence: 0.7, reason: 'Batch 1' },
    ],
  });
  assert.equal(batchResult.succeeded, 1);
  assert.equal(batchResult.failed, 0);

  // 9. autoImport forwards useHyperbeam and useHyperbeamReference per item and top-level
  await initLocal();
  globalThis.fetch = async (url, init) => {
    if (url === 'https://example.invalid/import-1') return new Response('<html><body><p>Import one.</p></body></html>', { status: 200, headers: { 'content-type': 'text/html' } });
    if (url.includes('/~bundler@1.0/tx')) return bundlerResponse();
    if (url.includes('/~query@1.0') || url.endsWith('/graphql')) return articleResponse('import-existing', 'subject/import-existing');
    return new Response('not found', { status: 404 });
  };
  const importResult = await api.autoImport({
    useHyperbeam: true,
    useHyperbeamReference: true,
    articles: [
      { url: 'https://example.invalid/import-1', kind: 'subject', topic: 'api-hb' },
    ],
  });
  assert.equal(importResult.succeeded, 1);
  assert.equal(importResult.failed, 0);

  fs.rmSync(home, { recursive: true, force: true });
  console.log('agent-api-hyperbeam tests passed');
}

await runTests();
