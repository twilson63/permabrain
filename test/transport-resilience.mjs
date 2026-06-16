/**
 * Transport resilience tests: retry, backoff, and circuit breaker behavior.
 */

import assert from 'node:assert/strict';
import {
  CircuitBreaker,
  CircuitBreakerRegistry,
  isRetryableError,
  resilientCall,
  withRetry,
} from '../src/resilience.mjs';
import { getCircuitBreakerStatus } from '../src/transport.mjs';

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function runTests() {
  // isRetryableError classification
  {
    const e1 = new Error('fetch failed: socket hang up');
    assert.equal(isRetryableError(e1), true);

    const e2 = new Error('bad request');
    assert.equal(isRetryableError(e2), false);

    const e3 = new Error('rate limit');
    e3.status = 429;
    assert.equal(isRetryableError(e3), true);

    const e4 = new Error('server error');
    e4.status = 503;
    assert.equal(isRetryableError(e4), true);

    const e5 = new Error('not found');
    e5.status = 404;
    assert.equal(isRetryableError(e5), false);
  }

  // withRetry succeeds on first attempt
  {
    let calls = 0;
    const result = await withRetry(async () => {
      calls++;
      return 'ok';
    }, { maxAttempts: 3, label: 'first-ok' });
    assert.equal(result, 'ok');
    assert.equal(calls, 1);
  }

  // withRetry recovers after transient errors
  {
    let calls = 0;
    const result = await withRetry(async () => {
      calls++;
      if (calls < 3) {
        const err = new Error('socket hang up');
        err.code = 'ECONNRESET';
        throw err;
      }
      return 'recovered';
    }, { maxAttempts: 5, baseDelayMs: 10, label: 'recover' });
    assert.equal(result, 'recovered');
    assert.equal(calls, 3);
  }

  // withRetry gives up after max attempts on retryable errors
  {
    let calls = 0;
    await assert.rejects(
      withRetry(async () => {
        calls++;
        const err = new Error('timeout');
        err.code = 'ETIMEDOUT';
        throw err;
      }, { maxAttempts: 3, baseDelayMs: 5, label: 'give-up' }),
      /timeout/
    );
    assert.equal(calls, 3);
  }

  // withRetry does not retry non-retryable errors
  {
    let calls = 0;
    await assert.rejects(
      withRetry(async () => {
        calls++;
        const err = new Error('not found');
        err.status = 404;
        throw err;
      }, { maxAttempts: 5, baseDelayMs: 5, label: 'no-retry' }),
      /not found/
    );
    assert.equal(calls, 1);
  }

  // CircuitBreaker gives up after threshold failures and stays open until recovery timeout
  {
    const breaker = new CircuitBreaker('test', { failureThreshold: 3, recoveryTimeoutMs: 120 });
    let calls = 0;
    const failingFn = async () => {
      calls++;
      throw new Error('boom');
    };

    await assert.rejects(breaker.execute(failingFn), /boom/);
    await assert.rejects(breaker.execute(failingFn), /boom/);
    await assert.rejects(breaker.execute(failingFn), /boom/);
    assert.equal(calls, 3);
    assert.equal(breaker.state, 'open');

    // Fourth call immediately should be rejected by breaker
    await assert.rejects(breaker.execute(failingFn), /OPEN/);
    assert.equal(calls, 3);

    // Wait for half-open and then trip again
    await sleep(140);
    // In half-open state one failure returns to open
    await assert.rejects(breaker.execute(failingFn), /boom/);
    assert.equal(calls, 4);
    assert.equal(breaker.state, 'open');

    // Subsequent call while open should be rejected
    await assert.rejects(breaker.execute(failingFn), /OPEN/);
    assert.equal(calls, 4);
  }

  // CircuitBreaker closes after half-open successes
  {
    const breaker = new CircuitBreaker('recover-test', { failureThreshold: 2, recoveryTimeoutMs: 120, halfOpenMaxAttempts: 2 });
    let calls = 0;
    let successes = 0;
    const flakyFn = async () => {
      calls++;
      if (calls <= 2) throw new Error('boom');
      successes++;
      return 'ok';
    };

    await assert.rejects(breaker.execute(flakyFn), /boom/);
    await assert.rejects(breaker.execute(flakyFn), /boom/);
    assert.equal(breaker.state, 'open');

    await sleep(140);
    const v1 = await breaker.execute(flakyFn);
    assert.equal(v1, 'ok');
    assert.equal(breaker.state, 'half-open');
    const v2 = await breaker.execute(flakyFn);
    assert.equal(v2, 'ok');
    assert.equal(breaker.state, 'closed');
    assert.equal(successes, 2);
  }

  // resilientCall combines breaker + retry
  {
    const registry = new CircuitBreakerRegistry({ failureThreshold: 3, recoveryTimeoutMs: 50 });
    const breaker = registry.get('resilient');
    let calls = 0;
    const fn = async () => {
      calls++;
      if (calls < 2) {
        const err = new Error('socket hang up');
        err.code = 'ECONNRESET';
        throw err;
      }
      return 'done';
    };
    const result = await resilientCall(fn, { breaker, label: 'resilient', retryOptions: { maxAttempts: 3, baseDelayMs: 5 } });
    assert.equal(result, 'done');
    assert.equal(calls, 2);
  }

  // getCircuitBreakerStatus returns registered breakers (empty initially if none used)
  {
    const status = getCircuitBreakerStatus();
    assert.equal(typeof status, 'object');
  }

  console.log('transport-resilience tests passed');
}

await runTests();
