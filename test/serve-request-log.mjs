import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import os from 'node:os';
import { startServer, stopServer } from '../src/serve.mjs';

function tmpHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pb-serve-request-log-'));
}

function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get(url, { headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode, headers: res.headers, body });
      });
    }).on('error', reject);
  });
}

function httpPost(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = http.request(
      { hostname: parsed.hostname, port: parsed.port, path: parsed.pathname + parsed.search, method: 'POST', headers: { 'content-type': 'application/json', ...headers } },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
      }
    );
    req.on('error', reject);
    req.end(JSON.stringify(body));
  });
}

async function readLog(base, headers = {}) {
  const res = await httpGet(`${base}/api/v1/log/requests`, headers);
  assert.strictEqual(res.status, 200);
  return JSON.parse(res.body);
}

{
  const home = tmpHome();
  const result = await startServer({ home, port: 0, accessLog: 'short', requestLogMaxEntries: 50 });
  const base = `http://localhost:${result.port}`;

  try {
    const health = await httpGet(`${base}/health`);
    assert.strictEqual(health.status, 200);
    assert.ok(health.headers['x-request-id'], 'response has X-Request-ID');

    // Query once to capture the health entry, then again to also see the query itself.
    let json = await readLog(base);
    assert.strictEqual(json.total, 1);
    assert.strictEqual(json.entries[0].method, 'GET');
    assert.strictEqual(json.entries[0].path, '/health');
    assert.ok(json.entries[0].requestId, 'entry has request id');
    assert.strictEqual(typeof json.entries[0].durationMs, 'number');

    json = await readLog(base);
    assert.strictEqual(json.total, 2);
    assert.strictEqual(json.entries[1].method, 'GET');
    assert.strictEqual(json.entries[1].path, '/api/v1/log/requests');

    console.log('✓ health and request-log endpoint recorded');
  } finally {
    await stopServer(result.server);
    fs.rmSync(home, { recursive: true, force: true });
  }
}

{
  const home = tmpHome();
  const result = await startServer({ home, port: 0, accessLog: 'none' });
  const base = `http://localhost:${result.port}`;

  try {
    await httpGet(`${base}/health`);
    let json = await readLog(base);
    assert.strictEqual(json.total, 0, 'format none does not record requests');
    // The /log/requests call itself is not recorded either (format none).
    json = await readLog(base);
    assert.strictEqual(json.total, 0);
    console.log('✓ access-log format none suppresses recording');
  } finally {
    await stopServer(result.server);
    fs.rmSync(home, { recursive: true, force: true });
  }
}

{
  const home = tmpHome();
  const result = await startServer({ home, port: 0, accessLog: 'json' });
  const base = `http://localhost:${result.port}`;

  try {
    await httpGet(`${base}/health`, { 'x-request-id': 'trace-abc' });
    const json = await readLog(base);
    assert.strictEqual(json.total, 1);
    const healthEntry = json.entries.find(e => e.path === '/health');
    assert.ok(healthEntry, 'health entry exists');
    assert.strictEqual(healthEntry.requestId, 'trace-abc', 'propagated request id');
    assert.ok(healthEntry.requestHeaders, 'json format includes request headers');
    assert.ok(healthEntry.responseHeaders, 'json format includes response headers');

    // Filtering should still match persisted entries.
    const filtered = await httpGet(`${base}/api/v1/log/requests?method=GET&status=200`);
    const filteredJson = JSON.parse(filtered.body);
    assert.ok(filteredJson.entries.some(e => e.path === '/health'));

    console.log('✓ JSON format includes headers and filter works');
  } finally {
    await stopServer(result.server);
    fs.rmSync(home, { recursive: true, force: true });
  }
}

{
  const home = tmpHome();
  const result = await startServer({ home, port: 0, accessLog: 'short' });
  const base = `http://localhost:${result.port}`;

  try {
    await httpGet(`${base}/health`);
    const md = await httpGet(`${base}/api/v1/log/requests?limit=1`, { accept: 'text/markdown' });
    assert.strictEqual(md.status, 200);
    assert.strictEqual(md.headers['content-type'], 'text/markdown');
    assert.ok(md.body.includes('Recent PermaBrain HTTP requests'));
    assert.ok(md.body.includes('| Request ID |'));

    console.log('✓ markdown rendering via Accept header');
  } finally {
    await stopServer(result.server);
    fs.rmSync(home, { recursive: true, force: true });
  }
}

{
  const home = tmpHome();
  const apiKey = 'test-key-123';
  const result = await startServer({ home, port: 0, accessLog: 'short', apiKey });
  const base = `http://localhost:${result.port}`;

  try {
    const noAuth = await httpGet(`${base}/api/v1/log/requests`);
    assert.strictEqual(noAuth.status, 401);

    const withAuth = await httpGet(`${base}/api/v1/log/requests`, { 'x-api-key': apiKey });
    assert.strictEqual(withAuth.status, 200);
    let json = JSON.parse(withAuth.body);
    assert.strictEqual(json.total, 1);
    assert.strictEqual(json.entries[0].path, '/api/v1/log/requests');

    json = await readLog(base, { 'x-api-key': apiKey });
    assert.strictEqual(json.total, 2);
    assert.ok(json.entries.some(e => e.statusCode === 401));

    console.log('✓ request-log endpoint respects API-key auth');
  } finally {
    await stopServer(result.server);
    fs.rmSync(home, { recursive: true, force: true });
  }
}

{
  const home = tmpHome();
  const result = await startServer({ home, port: 0, accessLog: 'short' });
  const base = `http://localhost:${result.port}`;

  try {
    await httpPost(`${base}/api/v1/completion`, { shell: 'bash' });
    const json = await readLog(base);
    assert.strictEqual(json.total, 1);
    const completionEntry = json.entries.find(e => e.path === '/api/v1/completion');
    assert.ok(completionEntry, 'POST completion recorded');
    assert.strictEqual(completionEntry.method, 'POST');

    console.log('✓ POST routes recorded in request log');
  } finally {
    await stopServer(result.server);
    fs.rmSync(home, { recursive: true, force: true });
  }
}

{
  const home = tmpHome();
  const result = await startServer({ home, port: 0, accessLog: 'short', trustProxy: true });
  const base = `http://localhost:${result.port}`;

  try {
    await httpGet(`${base}/health`, { 'x-forwarded-for': '198.51.100.1, 10.0.0.1' });
    const json = await readLog(base);
    const healthEntry = json.entries.find(e => e.path === '/health');
    assert.strictEqual(healthEntry.clientIp, '198.51.100.1', 'trustProxy records first forwarded-for');

    console.log('✓ trust proxy records original client IP');
  } finally {
    await stopServer(result.server);
    fs.rmSync(home, { recursive: true, force: true });
  }
}

console.log('All serve-request-log tests passed');
