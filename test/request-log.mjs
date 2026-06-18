import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { requestLogger, getRecentRequests, requestsToMarkdown, defaultLogPath } from '../src/request-log.mjs';

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

{
  const logger = requestLogger({ format: 'short', maxEntries: 10 });
  const req = makeReq({ headers: { 'x-request-id': 'existing-123' } });
  const res = makeRes();
  runMiddleware(logger, req, res);

  assert.strictEqual(req.requestId, 'existing-123', 'reuses incoming X-Request-ID');
  assert.strictEqual(res.getHeader('X-Request-ID'), 'existing-123', 'reflects request id');

  const recent = getRecentRequests(logger);
  assert.strictEqual(recent.total, 1);
  assert.strictEqual(recent.entries[0].requestId, 'existing-123');
  assert.strictEqual(recent.entries[0].method, 'GET');
  assert.strictEqual(recent.entries[0].path, '/api/v1/health');
  assert.strictEqual(recent.entries[0].statusCode, 200);
  assert.strictEqual(typeof recent.entries[0].durationMs, 'number');
  console.log('✓ request id propagation and basic recording');
}

{
  const logger = requestLogger({ format: 'short', maxEntries: 2 });
  runMiddleware(logger, makeReq({ url: '/first' }), makeRes({ statusCode: 200 }));
  runMiddleware(logger, makeReq({ url: '/second' }), makeRes({ statusCode: 201 }));
  runMiddleware(logger, makeReq({ url: '/third' }), makeRes({ statusCode: 204 }));

  const recent = getRecentRequests(logger);
  assert.strictEqual(recent.total, 2, 'maxEntries bounds the ring buffer');
  assert.strictEqual(recent.entries[0].path, '/second');
  assert.strictEqual(recent.entries[1].path, '/third');
  console.log('✓ ring buffer eviction');
}

{
  const logger = requestLogger({ format: 'none' });
  runMiddleware(logger, makeReq({ url: '/silent' }), makeRes({ statusCode: 200 }));
  const recent = getRecentRequests(logger);
  assert.strictEqual(recent.total, 0, 'format none does not record');
  console.log('✓ format none disables recording');
}

{
  const logger = requestLogger({ format: 'json' });
  const req = makeReq({
    url: '/api/v1/articles?key=secret',
    headers: {
      authorization: 'Bearer secret-token',
      'x-api-key': 'secret-key',
      cookie: 'session=abc',
      'user-agent': 'test',
      'content-type': 'application/json'
    }
  });
  const res = makeRes({ statusCode: 200 });
  runMiddleware(logger, req, res);

  const entry = getRecentRequests(logger).entries[0];
  assert.strictEqual(entry.path, '/api/v1/articles?key=<redacted>', 'redacts key query param');
  assert.strictEqual(entry.requestHeaders.authorization, '<redacted>', 'redacts authorization header');
  assert.strictEqual(entry.requestHeaders['x-api-key'], '<redacted>', 'redacts api key header');
  assert.strictEqual(entry.requestHeaders.cookie, '<redacted>', 'redacts cookie header');
  assert.strictEqual(entry.requestHeaders['content-type'], 'application/json', 'keeps safe headers');
  console.log('✓ sensitive header and query param redaction');
}

{
  const logger = requestLogger({ format: 'short', maxEntries: 10, trustProxy: true });
  const req = makeReq({
    url: '/proxy',
    headers: { 'x-forwarded-for': '203.0.113.1, 10.0.0.1' },
    socket: { remoteAddress: '10.0.0.2' }
  });
  runMiddleware(logger, req, makeRes({ statusCode: 200 }));

  const entry = getRecentRequests(logger).entries[0];
  assert.strictEqual(entry.clientIp, '203.0.113.1', 'trustProxy extracts first forwarded-for');
  console.log('✓ trust proxy client IP extraction');
}

{
  const logger = requestLogger({ format: 'short', maxEntries: 10 });
  runMiddleware(logger, makeReq({ method: 'GET', url: '/a' }), makeRes({ statusCode: 200 }));
  runMiddleware(logger, makeReq({ method: 'POST', url: '/b' }), makeRes({ statusCode: 201 }));
  runMiddleware(logger, makeReq({ method: 'GET', url: '/c' }), makeRes({ statusCode: 500 }));

  assert.strictEqual(getRecentRequests(logger, { method: 'GET' }).total, 2);
  assert.strictEqual(getRecentRequests(logger, { status: 201 }).total, 1);
  assert.strictEqual(getRecentRequests(logger, { path: '/c' }).total, 1);
  assert.strictEqual(getRecentRequests(logger, { method: 'POST', status: 201 }).total, 1);
  console.log('✓ filtering by method, status, and path');
}

{
  const logger = requestLogger({ format: 'short', maxEntries: 10 });
  for (let i = 0; i < 5; i++) {
    runMiddleware(logger, makeReq({ url: `/page/${i}` }), makeRes({ statusCode: 200 }));
  }
  const page = getRecentRequests(logger, { limit: 2, offset: 1 });
  assert.strictEqual(page.total, 5);
  assert.strictEqual(page.entries.length, 2);
  assert.strictEqual(page.entries[0].path, '/page/1');
  assert.strictEqual(page.entries[1].path, '/page/2');
  console.log('✓ limit and offset pagination');
}

{
  const logger = requestLogger({ format: 'short', maxEntries: 3 });
  runMiddleware(logger, makeReq({ url: '/one' }), makeRes({ statusCode: 200 }));
  const md = requestsToMarkdown(logger);
  assert(md.includes('Recent PermaBrain HTTP requests'));
  assert(md.includes('| Request ID |'));
  assert(md.includes('/one'));
  console.log('✓ markdown rendering');
}

{
  const result = getRecentRequests(null);
  assert.deepStrictEqual(result, { total: 0, offset: 0, limit: 0, entries: [] });
  assert.strictEqual(requestsToMarkdown(null), 'No request log available.');
  console.log('✓ null logger safe fallbacks');
}

{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-reqlog-disk-'));
  try {
    const logger = requestLogger({ format: 'short', maxEntries: 10, logDir: tmp });
    runMiddleware(logger, makeReq({ url: '/disk-test' }), makeRes({ statusCode: 200 }));
    assert.strictEqual(logger.diskEnabled, true);
    assert.ok(fs.existsSync(path.join(tmp, 'access-log.jsonl')), 'writes access-log.jsonl');
    const content = fs.readFileSync(path.join(tmp, 'access-log.jsonl'), 'utf8').trim();
    const parsed = JSON.parse(content);
    assert.strictEqual(parsed.path, '/disk-test');
    assert.strictEqual(parsed.statusCode, 200);
    console.log('✓ disk persistence writes JSONL entry');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-reqlog-rotate-'));
  try {
    const logger = requestLogger({ format: 'short', maxEntries: 10, logDir: tmp, maxSize: 300, maxFiles: 5 });
    // Each entry is a JSON line; write enough to exceed maxSize multiple times.
    for (let i = 0; i < 20; i++) {
      runMiddleware(logger, makeReq({ url: `/rotate/${i}` }), makeRes({ statusCode: 200 }));
    }
    const files = fs.readdirSync(tmp).filter(n => n.endsWith('.jsonl')).sort();
    assert.ok(files.length > 1, 'rotation created multiple files');
    assert.ok(files.length <= 5, 'maxFiles bounds rotated copies');
    const disk = await logger.queryDisk({ limit: 100 });
    assert.ok(disk.total >= 10, 'disk query returns retained entries after rotation');
    console.log('✓ rotation and maxFiles pruning');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-reqlog-retention-'));
  try {
    const logger = requestLogger({ format: 'short', maxEntries: 10, logDir: tmp, retentionDays: 7 });
    runMiddleware(logger, makeReq({ url: '/fresh' }), makeRes({ statusCode: 200 }));
    const disk = await logger.queryDisk({ limit: 10 });
    assert.strictEqual(disk.total, 1);
    assert.strictEqual(disk.entries[0].path, '/fresh');
    console.log('✓ disk query with retention window');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-reqlog-filter-'));
  try {
    const logger = requestLogger({ format: 'short', maxEntries: 10, logDir: tmp });
    runMiddleware(logger, makeReq({ method: 'GET', url: '/alpha' }), makeRes({ statusCode: 200 }));
    runMiddleware(logger, makeReq({ method: 'POST', url: '/beta' }), makeRes({ statusCode: 201 }));
    runMiddleware(logger, makeReq({ method: 'GET', url: '/gamma' }), makeRes({ statusCode: 500 }));
    const get200 = await logger.queryDisk({ method: 'GET', status: 200, limit: 10 });
    assert.strictEqual(get200.total, 1);
    assert.strictEqual(get200.entries[0].path, '/alpha');
    const post = await logger.queryDisk({ method: 'POST', limit: 10 });
    assert.strictEqual(post.total, 1);
    assert.strictEqual(post.entries[0].statusCode, 201);
    const pathFilter = await logger.queryDisk({ path: '/gamma', limit: 10 });
    assert.strictEqual(pathFilter.total, 1);
    assert.strictEqual(pathFilter.entries[0].statusCode, 500);
    console.log('✓ disk query filtering');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

{
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-reqlog-path-'));
  try {
    const expected = path.join(home, 'logs', 'access-log.jsonl');
    assert.strictEqual(defaultLogPath(home), expected);
    console.log('✓ default log path resolves under home/logs');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

console.log('All request-log tests passed');
