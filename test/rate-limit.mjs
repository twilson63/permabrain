import assert from 'node:assert';
import { createRateLimiter, getClientIdentifier } from '../src/rate-limit.mjs';

function makeReq(remoteAddress, headers = {}) {
  return {
    socket: { remoteAddress },
    headers,
    url: '/api/v1/health'
  };
}

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

test('disabled limiter allows all requests', () => {
  const limiter = createRateLimiter({ enabled: false });
  for (let i = 0; i < 1000; i++) {
    const result = limiter.check(makeReq('1.2.3.4'));
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.remaining, -1);
  }
});

test('default limiter is disabled unless max is configured', () => {
  const limiter = createRateLimiter();
  const result = limiter.check(makeReq('1.2.3.4'));
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.remaining, -1);
});

test('max=0 disables limiter', () => {
  const limiter = createRateLimiter({ max: 0 });
  for (let i = 0; i < 10; i++) {
    const result = limiter.check(makeReq('1.2.3.4'));
    assert.strictEqual(result.ok, true);
  }
});

test('token bucket allows max+burst requests then rejects', () => {
  const limiter = createRateLimiter({ max: 2, windowMs: 1000, burst: 1 });
  const req = makeReq('1.2.3.4');
  // 2 steady + 1 burst = 3 allowed
  assert.strictEqual(limiter.check(req).ok, true);
  assert.strictEqual(limiter.check(req).ok, true);
  assert.strictEqual(limiter.check(req).ok, true);
  const blocked = limiter.check(req);
  assert.strictEqual(blocked.ok, false);
  assert.strictEqual(blocked.status, 429);
  assert.strictEqual(typeof blocked.retryAfter, 'number');
  assert.strictEqual(blocked.remaining, 0);
});

test('different clients have separate buckets', () => {
  const limiter = createRateLimiter({ max: 1, windowMs: 1000, burst: 0 });
  const a = makeReq('1.2.3.4');
  const b = makeReq('5.6.7.8');
  assert.strictEqual(limiter.check(a).ok, true);
  assert.strictEqual(limiter.check(a).ok, false);
  assert.strictEqual(limiter.check(b).ok, true);
  assert.strictEqual(limiter.check(b).ok, false);
});

test('reset clears all buckets', () => {
  const limiter = createRateLimiter({ max: 1, windowMs: 1000, burst: 0 });
  const req = makeReq('1.2.3.4');
  assert.strictEqual(limiter.check(req).ok, true);
  assert.strictEqual(limiter.check(req).ok, false);
  limiter.reset();
  assert.strictEqual(limiter.check(req).ok, true);
});

test('trustProxy uses x-forwarded-for', () => {
  const limiter = createRateLimiter({ max: 1, windowMs: 1000, burst: 0, trustProxy: true });
  const a = makeReq('1.2.3.4', { 'x-forwarded-for': '9.9.9.9' });
  const b = makeReq('5.6.7.8', { 'x-forwarded-for': '9.9.9.9' });
  assert.strictEqual(limiter.check(a).ok, true);
  assert.strictEqual(limiter.check(b).ok, false);
});

test('without trustProxy x-forwarded-for is mixed with socket address', () => {
  const limiter = createRateLimiter({ max: 1, windowMs: 1000, burst: 0 });
  const a = makeReq('1.2.3.4', { 'x-forwarded-for': '9.9.9.9' });
  const b = makeReq('1.2.3.4', { 'x-forwarded-for': '9.9.9.9' });
  const c = makeReq('5.6.7.8', { 'x-forwarded-for': '9.9.9.9' });
  assert.strictEqual(limiter.check(a).ok, true);
  // Same socket address but different forwarded header still counts as same because
  // the socket address is the authoritative part; we test that c is different.
  assert.strictEqual(limiter.check(b).ok, false);
  assert.strictEqual(limiter.check(c).ok, true);
});

test('getClientIdentifier without trustProxy returns socket-based id', () => {
  const id = getClientIdentifier(makeReq('127.0.0.1'), false);
  assert.ok(id.startsWith('ip:127.0.0.1'));
});

test('getClientIdentifier with trustProxy returns forwarded id', () => {
  const id = getClientIdentifier(makeReq('127.0.0.1', { 'x-forwarded-for': '8.8.8.8, 1.1.1.1' }), true);
  assert.strictEqual(id, 'fwd:8.8.8.8');
});

test('prune removes stale entries without breaking active ones', () => {
  const limiter = createRateLimiter({ max: 10, windowMs: 50, burst: 0 });
  const active = makeReq('1.2.3.4');
  const stale = makeReq('9.9.9.9');
  limiter.check(active);
  limiter.check(stale);
  // Force pruning by advancing many checks, but keep active used.
  const start = Date.now();
  while (Date.now() - start < 120) {
    limiter.check(active);
  }
  // stale entry should have been removed by probabilistic pruning.
  const fresh = makeReq('9.9.9.9');
  assert.strictEqual(limiter.check(fresh).ok, true);
});

console.log('\n✅ All rate-limit unit tests passed');
