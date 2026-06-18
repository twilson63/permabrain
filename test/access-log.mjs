import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { requestLogger, accessLogResultToMarkdown } from '../src/request-log.mjs';
import { runCommand } from '../src/commands.mjs';
import { startServer, stopServer } from '../src/serve.mjs';
import { api } from '../src/agent-api.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.resolve(__dirname, '../scripts/cli.mjs');

function tmpHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pb-access-log-'));
}

function makeReq(overrides = {}) {
  return {
    method: 'GET',
    url: '/api/v1/health',
    headers: {},
    httpVersion: '1.1',
    socket: { remoteAddress: '127.0.0.1' },
    ...overrides
  };
}

function makeRes(overrides = {}) {
  const headers = {};
  return {
    statusCode: 200,
    getHeader: (key) => headers[key.toLowerCase()] || null,
    setHeader: (key, value) => { headers[key.toLowerCase()] = value; },
    getHeaders: () => ({ ...headers }),
    end: () => {},
    ...overrides
  };
}

function runMiddleware(logger, req, res) {
  const next = () => {};
  logger.middleware()(req, res, next);
  res.end();
}

function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get(url, { headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8')
      }));
    }).on('error', reject);
  });
}

{
  const home = tmpHome();
  const logger = requestLogger({ format: 'short', home });
  runMiddleware(logger, makeReq({ method: 'GET', url: '/health' }), makeRes({ statusCode: 200 }));
  runMiddleware(logger, makeReq({ method: 'POST', url: '/api/v1/articles', headers: { 'content-type': 'application/json' } }), makeRes({ statusCode: 201 }));
  runMiddleware(logger, makeReq({ method: 'GET', url: '/not-found' }), makeRes({ statusCode: 404 }));

  const disk = await logger.queryDisk({ limit: 10 });
  assert.strictEqual(disk.total, 3);
  assert.strictEqual(disk.entries[0].path, '/not-found');
  assert.strictEqual(disk.entries[1].path, '/api/v1/articles');
  assert.strictEqual(disk.entries[2].path, '/health');

  const get200 = await logger.queryDisk({ method: 'GET', status: 200, limit: 10 });
  assert.strictEqual(get200.total, 1);
  assert.strictEqual(get200.entries[0].path, '/health');

  const post = await logger.queryDisk({ method: 'POST', limit: 10 });
  assert.strictEqual(post.total, 1);
  assert.strictEqual(post.entries[0].statusCode, 201);

  const pathFilter = await logger.queryDisk({ path: '/api', limit: 10 });
  assert.strictEqual(pathFilter.total, 1);

  fs.rmSync(home, { recursive: true, force: true });
  console.log('✓ disk query and filters');
}

{
  const home = tmpHome();
  const logger = requestLogger({ format: 'short', home });
  for (let i = 0; i < 5; i++) {
    runMiddleware(logger, makeReq({ url: `/page/${i}` }), makeRes({ statusCode: 200 }));
  }
  const tail = await logger.queryDisk({ limit: 3, offset: 0 });
  assert.strictEqual(tail.total, 5);
  assert.strictEqual(tail.entries.length, 3);

  const offset = await logger.queryDisk({ limit: 2, offset: 2 });
  assert.strictEqual(offset.total, 5);
  assert.strictEqual(offset.entries[0].path, '/page/2');
  assert.strictEqual(offset.entries[1].path, '/page/1');

  fs.rmSync(home, { recursive: true, force: true });
  console.log('✓ disk query pagination');
}

{
  const entries = [
    { timestamp: new Date().toISOString(), requestId: 'req-1', method: 'GET', path: '/health', statusCode: 200, durationMs: 12 },
    { timestamp: new Date().toISOString(), requestId: 'req-2', method: 'POST', path: '/api/v1/articles', statusCode: 201, durationMs: 34 }
  ];
  const md = accessLogResultToMarkdown({ total: 2, entries });
  assert.ok(md.includes('Recent PermaBrain HTTP requests'));
  assert.ok(md.includes('| Request ID |'));
  assert.ok(md.includes('req-1'));
  assert.ok(md.includes('/api/v1/articles'));
  console.log('✓ markdown rendering helper');
}

{
  const home = tmpHome();
  const logger = requestLogger({ format: 'short', home });
  runMiddleware(logger, makeReq({ url: '/stream-test' }), makeRes({ statusCode: 200 }));
  const controller = new AbortController();
  const collected = [];
  const streamPromise = (async () => {
    for await (const entry of logger.tailStream(controller.signal)) {
      collected.push(entry);
    }
  })();
  // Give the generator a moment to start waiting, then record a new entry.
  await new Promise(r => setTimeout(r, 50));
  runMiddleware(logger, makeReq({ url: '/next' }), makeRes({ statusCode: 200 }));
  // Wait for delivery and then abort.
  await new Promise(r => setTimeout(r, 150));
  controller.abort();
  await streamPromise;
  assert.ok(collected.length >= 1, 'tail stream collected at least one new entry');
  assert.ok(collected.some(e => e.path === '/next'), 'stream includes the newly recorded entry');
  fs.rmSync(home, { recursive: true, force: true });
  console.log('✓ tailStream async generator');
}

{
  const home = tmpHome();
  const logger = requestLogger({ format: 'short', home });
  runMiddleware(logger, makeReq({ url: '/alpha' }), makeRes({ statusCode: 200 }));
  runMiddleware(logger, makeReq({ method: 'POST', url: '/beta' }), makeRes({ statusCode: 201 }));

  await api.ensureInit({ keyType: 'ed25519' });
  const originalHome = api._home;
  api._home = home;
  try {
    const result = await api.accessLog({ limit: 10 });
    assert.strictEqual(result.total, 2);
    assert.ok(result.entries.some(e => e.path === '/alpha'));
    assert.ok(result.entries.some(e => e.path === '/beta'));

    const filtered = await api.accessLog({ method: 'POST', limit: 10 });
    assert.strictEqual(filtered.total, 1);
    assert.strictEqual(filtered.entries[0].path, '/beta');

    const md = api.accessLogToMarkdown(result);
    assert.ok(md.includes('Total matching: 2'));
  } finally {
    api._home = originalHome;
  }
  fs.rmSync(home, { recursive: true, force: true });
  console.log('✓ agent API accessLog wrappers');
}

{
  const home = tmpHome();
  const result = await startServer({ home, port: 0, accessLog: 'short' });
  const base = `http://localhost:${result.port}`;

  try {
    await httpGet(`${base}/health`);
    await httpGet(`${base}/api/v1/log/requests`);

    // Query remote via command
    const remote = await runCommand('access-log', { url: base, limit: 10, _: [] });
    assert.strictEqual(remote.total, 2);
    assert.ok(remote.entries.some(e => e.path === '/health'));
    assert.ok(remote.entries.some(e => e.path === '/api/v1/log/requests'));

    const remoteMd = await runCommand('access-log', { url: base, limit: 10, markdown: true, _: [] });
    assert.ok(typeof remoteMd === 'string' && remoteMd.includes('Recent PermaBrain HTTP requests'));

    const remoteJson = await runCommand('access-log', { url: base, limit: 10, json: true, _: [] });
    assert.ok(Array.isArray(remoteJson.entries));
  } finally {
    await stopServer(result.server);
    fs.rmSync(home, { recursive: true, force: true });
  }
  console.log('✓ access-log command remote query + markdown/json');
}

{
  const home = tmpHome();
  const result = await startServer({ home, port: 0, accessLog: 'short' });
  const base = `http://localhost:${result.port}`;

  try {
    const controller = new AbortController();
    const followPromise = runCommand('access-log', { url: base, follow: true, count: 1, _: [] });
    await new Promise(r => setTimeout(r, 100));
    await httpGet(`${base}/health`);
    const followResult = await followPromise;
    assert.strictEqual(followResult.count, 1);
  } finally {
    await stopServer(result.server);
    fs.rmSync(home, { recursive: true, force: true });
  }
  console.log('✓ access-log --follow streams from server');
}

{
  const home = tmpHome();
  const logger = requestLogger({ format: 'short', home });
  runMiddleware(logger, makeReq({ url: '/local' }), makeRes({ statusCode: 200 }));

  const disk = await runCommand('access-log', { home, limit: 10, _: [] });
  assert.strictEqual(disk.total, 1);
  assert.strictEqual(disk.entries[0].path, '/local');

  const tail = await runCommand('access-log', { home, tail: 1, _: [] });
  assert.strictEqual(tail.total, 1);
  assert.strictEqual(tail.entries[0].path, '/local');
  fs.rmSync(home, { recursive: true, force: true });
  console.log('✓ access-log local disk mode');
}

{
  const proc = spawn(process.execPath, [cliPath, 'access-log', '--help'], { stdio: 'pipe' });
  let stdout = '';
  proc.stdout.on('data', (d) => stdout += d.toString());
  await new Promise((resolve) => proc.on('close', resolve));
  assert.ok(stdout.includes('Usage: permabrain access-log'), 'help mentions access-log');
  assert.ok(stdout.includes('--follow'), 'help mentions --follow');
  console.log('✓ CLI help for access-log');
}

console.log('All access-log tests passed');
