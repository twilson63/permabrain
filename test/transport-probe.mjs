/**
 * Transport probe tests for LocalTransport, ArweaveTransport, HyperbeamTransport,
 * probeTransport helper, agent-api `api.probe()`, and CLI `permabrain probe`.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import {
  ArweaveTransport,
  HyperbeamTransport,
  LocalTransport,
  probeTransport,
} from '../src/transport.mjs';
import { api } from '../src/agent-api.mjs';
import { initState } from '../src/config.mjs';

const originalFetch = globalThis.fetch;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.join(__dirname, '..', 'scripts', 'cli.mjs');

function mockResponse(body, opts = {}) {
  const status = opts.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
  };
}

function withMockFetch(handler) {
  return async (...args) => handler(...args);
}

function makeTempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-probe-'));
}

// --- LocalTransport probe ---
{
  const home = makeTempHome();
  const transport = new LocalTransport(home);
  const result = await transport.probe();
  assert.equal(result.transport, 'local');
  assert.equal(result.ok, true);
  assert.ok(Array.isArray(result.checks));
  assert.equal(result.checks.length, 1);
  assert.equal(result.checks[0].name, 'local-state');
  assert.equal(result.checks[0].ok, true);
  fs.rmSync(home, { recursive: true, force: true });
}

// --- ArweaveTransport probe success ---
{
  globalThis.fetch = withMockFetch((url) => {
    if (url === 'https://arweave.net') return mockResponse('ok');
    if (url === 'https://arweave.net/graphql') return mockResponse({ data: { transactions: { edges: [] } } });
    return mockResponse('not found', { status: 404 });
  });
  const transport = new ArweaveTransport({
    gateway: { dataUrl: 'https://arweave.net', graphqlUrl: 'https://arweave.net/graphql' },
    bundler: { uploadUrl: 'https://up.arweave.net/tx' },
  });
  const result = await transport.probe();
  assert.equal(result.transport, 'arweave');
  assert.equal(result.ok, true);
  const names = result.checks.map((c) => c.name);
  assert.ok(names.includes('gateway'));
  assert.ok(names.includes('graphql'));
  globalThis.fetch = originalFetch;
}

// --- ArweaveTransport probe failure ---
{
  globalThis.fetch = withMockFetch(() => { throw new Error('network down'); });
  const transport = new ArweaveTransport({
    gateway: { dataUrl: 'https://arweave.net', graphqlUrl: 'https://arweave.net/graphql' },
    bundler: { uploadUrl: 'https://up.arweave.net/tx' },
  });
  const result = await transport.probe();
  assert.equal(result.transport, 'arweave');
  assert.equal(result.ok, false);
  assert.ok(result.checks.every((c) => c.ok === false));
  globalThis.fetch = originalFetch;
}

// --- HyperbeamTransport probe success ---
{
  globalThis.fetch = withMockFetch((url) => {
    if (url === 'http://localhost:10000') return mockResponse('ok');
    if (url === 'http://localhost:10000/~bundler@1.0/tx?codec-device=ans104@1.0') return mockResponse({}, { status: 204 });
    if (url.includes('/~query@1.0')) return mockResponse({ results: [] });
    if (url.includes('/~match@1.0')) return mockResponse([]);
    if (url.includes('/~meta@1.0/info')) return mockResponse({ version: '1.0.0' });
    if (url === 'http://localhost:10000/graphql') return mockResponse({ data: { transactions: { edges: [] } } });
    return mockResponse('not found', { status: 404 });
  });
  const transport = new HyperbeamTransport({
    gateway: { dataUrl: 'http://localhost:10000', type: 'hyperbeam' },
    bundler: { uploadUrl: 'http://localhost:10000/~bundler@1.0/tx?codec-device=ans104@1.0' },
  });
  const result = await transport.probe();
  assert.equal(result.transport, 'hyperbeam');
  assert.equal(result.ok, true);
  const names = result.checks.map((c) => c.name);
  assert.ok(names.includes('health'));
  assert.ok(names.includes('bundler-upload'));
  assert.ok(names.includes('query-device'));
  assert.ok(names.includes('match-device'));
  assert.ok(names.includes('meta-info'));
  assert.ok(names.includes('graphql'));
  globalThis.fetch = originalFetch;
}

// --- probeTransport selects transport by config ---
{
  const home = makeTempHome();
  const result = await probeTransport({ transport: 'local' }, home);
  assert.equal(result.transport, 'local');
  assert.equal(result.ok, true);
  fs.rmSync(home, { recursive: true, force: true });
}

// --- probeTransport respects useHyperbeam override ---
{
  globalThis.fetch = withMockFetch((url) => {
    if (url === 'http://localhost:10000') return mockResponse('ok');
    if (url === 'http://localhost:10000/~bundler@1.0/tx?codec-device=ans104@1.0') return mockResponse({}, { status: 204 });
    if (url.includes('/~query@1.0')) return mockResponse({ results: [] });
    if (url.includes('/~match@1.0')) return mockResponse([]);
    if (url.includes('/~meta@1.0/info')) return mockResponse({ version: '1.0.0' });
    if (url === 'http://localhost:10000/graphql') return mockResponse({ data: { transactions: { edges: [] } } });
    return mockResponse('not found', { status: 404 });
  });
  const result = await probeTransport(
    { transport: 'arweave', gateway: { dataUrl: 'http://localhost:10000' }, bundler: { uploadUrl: 'http://localhost:10000/~bundler@1.0/tx?codec-device=ans104@1.0' } },
    makeTempHome(),
    { useHyperbeam: true }
  );
  assert.equal(result.transport, 'hyperbeam');
  assert.equal(result.ok, true);
  globalThis.fetch = originalFetch;
}

// --- agent API probe() without prior init ---
{
  const home = makeTempHome();
  api._home = null;
  api._identity = null;
  api._config = null;
  process.env.PERMABRAIN_HOME = home;
  initState({ env: { ...process.env, PERMABRAIN_HOME: home, PERMABRAIN_TRANSPORT: 'local' } });
  const result = await api.probe();
  assert.equal(result.transport, 'local');
  assert.equal(result.ok, true);
  fs.rmSync(home, { recursive: true, force: true });
}

// --- agent API probe() with explicit useHyperbeam override against mocked node ---
{
  const home = makeTempHome();
  api._home = null;
  api._identity = null;
  api._config = null;
  process.env.PERMABRAIN_HOME = home;
  process.env.PERMABRAIN_TRANSPORT = 'arweave';
  initState({ env: { ...process.env, PERMABRAIN_HOME: home, PERMABRAIN_TRANSPORT: 'arweave' } });

  globalThis.fetch = withMockFetch((url) => {
    if (url === 'http://localhost:10000') return mockResponse('ok');
    if (url === 'http://localhost:10000/~bundler@1.0/tx?codec-device=ans104@1.0') return mockResponse({}, { status: 204 });
    if (url.includes('/~query@1.0')) return mockResponse({ results: [] });
    if (url.includes('/~match@1.0')) return mockResponse([]);
    if (url.includes('/~meta@1.0/info')) return mockResponse({ version: '1.0.0' });
    if (url === 'http://localhost:10000/graphql') return mockResponse({ data: { transactions: { edges: [] } } });
    return mockResponse('not found', { status: 404 });
  });
  const result = await api.probe({ useHyperbeam: true, url: 'http://localhost:10000' });
  assert.equal(result.transport, 'hyperbeam');
  assert.equal(result.ok, true);
  globalThis.fetch = originalFetch;
  fs.rmSync(home, { recursive: true, force: true });
}

// --- CLI probe command with --use-hyperbeam (no running node, expect failure report) ---
{
  const home = makeTempHome();
  const env = { ...process.env, PERMABRAIN_HOME: home, PERMABRAIN_TRANSPORT: 'arweave' };
  const { stdout, stderr, code } = await new Promise((resolve, reject) => {
    let out = '';
    let err = '';
    const child = spawn('node', [cliPath, 'probe', '--use-hyperbeam', '--json'], { cwd: path.dirname(cliPath), env });
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', reject);
    child.on('close', (c) => { resolve({ code: c, stdout: out, stderr: err }); });
  });
  // CLI prints OK JSON even when HyperBEAM is down; exit code is 0 because probe reports failure, not throws.
  assert.equal(code, 0, `CLI probe failed: ${stderr}`);
  const parsed = JSON.parse(stdout.trim());
  // When PERMABRAIN_HYPERBEAM_URL points at arweave gateway (no HB node), health passes but match-device fails. Since some checks pass, ok is true.
  assert.equal(parsed.transport, 'hyperbeam');
  assert.equal(parsed.ok, true);
  assert.ok(parsed.checks.some((c) => c.name === 'match-device' && !c.ok));
  fs.rmSync(home, { recursive: true, force: true });
}

console.log('transport-probe tests passed');
