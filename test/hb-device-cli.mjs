/**
 * Unit tests for HyperBEAM device CLI commands:
 * probe-devices, match, deploy-consensus, meta-info, whois.
 *
 * Mocks global fetch so no live HyperBEAM node is required.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runCommand } from '../src/commands.mjs';

const originalFetch = globalThis.fetch;
let callLog = [];
let mockFetchResponse = null;

function resetMocks() {
  callLog = [];
  mockFetchResponse = null;
}

function mockFetch(fn) {
  mockFetchResponse = fn;
  globalThis.fetch = async (...args) => {
    callLog.push(args);
    if (mockFetchResponse) {
      return mockFetchResponse(...args);
    }
    return new Response('not found', { status: 404 });
  };
}

function restoreFetch() {
  globalThis.fetch = originalFetch;
  mockFetchResponse = null;
}

function Response(body, opts = {}) {
  return {
    ok: opts.status >= 200 && opts.status < 300,
    status: opts.status || 200,
    headers: new Map(Object.entries(opts.headers || {})),
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
    arrayBuffer: async () => Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)).buffer,
  };
}

function makeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-hb-device-cli-'));
  process.env.PERMABRAIN_HOME = home;
  return home;
}

function defaultMockFetch(url, init) {
  if (url === 'http://localhost:10000') {
    return new Response('ok', { status: 200 });
  }
  if (url.includes('/~bundler@1.0/tx')) {
    return new Response(JSON.stringify({ id: 'module-id' }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (url.includes('/~query@1.0')) {
    return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (url.includes('/~match@1.0/')) {
    return new Response('match-id-1\nmatch-id-2', { status: 200 });
  }
  if (url.includes('/~meta@1.0/info')) {
    return new Response(JSON.stringify({ version: '1.0.0', network: 'test' }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (url.includes('/~whois@1.0/')) {
    return new Response(JSON.stringify({ agent: 'test-agent', address: 'test-address' }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (url === 'http://localhost:10000/graphql') {
    return new Response(JSON.stringify({ data: { transactions: { edges: [] } } }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return new Response('not found', { status: 404 });
}

async function runTests() {
  const home = makeHome();
  await runCommand('init', { 'key-type': 'ed25519' });

  // probe-devices
  resetMocks();
  mockFetch(defaultMockFetch);
  {
    const result = await runCommand('probe-devices', { url: 'http://localhost:10000' });
    assert.equal(result.url, 'http://localhost:10000');
    assert.ok(result.checks.length > 0, 'probe-devices returns checks');
    assert.ok(result.checks.some((c) => c.name === 'health' && c.ok), 'health check passes');
    assert.ok(result.checks.some((c) => c.name === 'meta-info' && c.ok), 'meta-info check passes');
  }


  // match
  resetMocks();
  mockFetch(defaultMockFetch);
  {
    const results = await runCommand('match', { key: 'App-Name', value: 'PermaBrain' });
    assert.ok(Array.isArray(results), 'match returns array');
    assert.deepEqual(results, ['match-id-1', 'match-id-2']);
  }

  // deploy-consensus
  resetMocks();
  mockFetch(defaultMockFetch);
  {
    const result = await runCommand('deploy-consensus', { url: 'http://localhost:10000' });
    assert.ok(result.consensusModuleId, 'deploy-consensus returns consensusModuleId');
    assert.ok(result.queryModuleId, 'deploy-consensus returns queryModuleId');
    const bundlerCalls = callLog.filter(([url, init]) => url.includes('/~bundler@1.0/tx') && init?.method === 'POST');
    assert.equal(bundlerCalls.length, 2, 'deploy-consensus uploads two modules');
  }

  // meta-info
  resetMocks();
  mockFetch(defaultMockFetch);
  {
    const result = await runCommand('meta-info', { url: 'http://localhost:10000' });
    assert.equal(result.version, '1.0.0');
    assert.equal(result.network, 'test');
  }

  // whois
  resetMocks();
  mockFetch(defaultMockFetch);
  {
    const result = await runCommand('whois', { _: ['test-address'] });
    assert.equal(result.agent, 'test-agent');
    assert.equal(result.address, 'test-address');
  }

  // JSON output flag
  resetMocks();
  mockFetch(defaultMockFetch);
  {
    const result = await runCommand('meta-info', { url: 'http://localhost:10000', json: true });
    assert.equal(result.version, '1.0.0');
  }
}

try {
  await runTests();
  console.log('hb-device-cli tests passed');
} finally {
  restoreFetch();
}
