/**
 * PermaBrain Transport Resilience
 *
 * Wraps async transport calls with:
 *  - Exponential backoff retries for transient failures
 *  - Circuit breaker that trips after repeated failures
 *  - Per-operation call tracking and status reporting
 *
 * Applied to HyperBEAM and Arweave uploads/queries.
 */

import { EventEmitter } from 'node:events';

import { withMetrics } from './metrics.mjs';

export class CircuitBreaker extends EventEmitter {
  constructor(name, opts = {}) {
    super();
    this.name = name;
    this.failureThreshold = opts.failureThreshold ?? 5;
    this.recoveryTimeoutMs = opts.recoveryTimeoutMs ?? 30000;
    this.halfOpenMaxAttempts = opts.halfOpenMaxAttempts ?? 3;
    this.state = 'closed'; // closed | open | half-open
    this.failures = 0;
    this.successes = 0;
    this.lastFailureAt = null;
    this.nextRetryAt = null;
    this.stats = { calls: 0, successes: 0, failures: 0, rejected: 0, retried: 0 };
  }

  get status() {
    return {
      name: this.name,
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      lastFailureAt: this.lastFailureAt,
      nextRetryAt: this.nextRetryAt,
      stats: { ...this.stats }
    };
  }

  _canExecute() {
    if (this.state === 'closed') return true;
    if (this.state === 'half-open' && this.successes < this.halfOpenMaxAttempts) return true;
    if (this.state === 'open') {
      if (this.nextRetryAt && Date.now() >= this.nextRetryAt) {
        this.state = 'half-open';
        this.successes = 0;
        this.nextRetryAt = null;
        this.emit('half-open', this.status);
        return true;
      }
      return false;
    }
    return false;
  }

  _onSuccess() {
    this.failures = 0;
    this.stats.successes++;
    if (this.state === 'half-open') {
      this.successes++;
      if (this.successes >= this.halfOpenMaxAttempts) {
        this.state = 'closed';
        this.successes = 0;
        this.nextRetryAt = null;
        this.emit('closed', this.status);
      }
    } else {
      this.successes = 0;
    }
  }

  _onFailure() {
    this.failures++;
    this.lastFailureAt = new Date().toISOString();
    this.stats.failures++;
    if (this.state === 'half-open') {
      this.state = 'open';
      this.nextRetryAt = Date.now() + this.recoveryTimeoutMs;
      this.emit('open', this.status);
      return;
    }
    if (this.failures >= this.failureThreshold) {
      this.state = 'open';
      this.nextRetryAt = Date.now() + this.recoveryTimeoutMs;
      this.emit('open', this.status);
    }
  }

  async execute(fn, ...args) {
    this.stats.calls++;
    if (!this._canExecute()) {
      this.stats.rejected++;
      const err = new Error(`Circuit breaker '${this.name}' is OPEN`);
      err.code = 'CIRCUIT_OPEN';
      throw err;
    }
    try {
      const result = await fn(...args);
      this._onSuccess();
      return result;
    } catch (err) {
      this._onFailure();
      throw err;
    }
  }
}

export function isRetryableError(err) {
  if (!err) return false;
  const message = String(err.message || err).toLowerCase();
  const retryablePhrases = [
    'timeout', 'timed out', 'econnrefused', 'enetunreach', 'econnreset',
    'socket hang up', 'fetch failed', 'network down', 'temporary',
    'too many requests', 'rate limit', '503', '502', '504'
  ];
  if (err.code && ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH', 'ERR_HTTP2_STREAM_CANCEL'].includes(err.code)) return true;
  if (err.status >= 500 || err.status === 429 || err.status === 408) return true;
  return retryablePhrases.some((phrase) => message.includes(phrase));
}

export async function withRetry(fn, opts = {}) {
  const maxAttempts = Math.max(1, Number(opts.maxAttempts ?? 3));
  const baseDelayMs = Number(opts.baseDelayMs ?? 250);
  const maxDelayMs = Number(opts.maxDelayMs ?? 10000);
  const backoffMultiplier = Number(opts.backoffMultiplier ?? 2);
  const onRetry = opts.onRetry;
  const label = opts.label || 'operation';
  let attempts = 0;
  let lastErr;
  while (attempts < maxAttempts) {
    attempts++;
    try {
      return await withMetrics(label, fn);
    } catch (err) {
      lastErr = err;
      if (attempts >= maxAttempts || !isRetryableError(err)) throw err;
      const delay = Math.min(baseDelayMs * backoffMultiplier ** (attempts - 1), maxDelayMs);
      if (onRetry) onRetry({ attempt: attempts, maxAttempts, delay, label, error: err });
      await sleep(delay);
    }
  }
  throw lastErr;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Resilient wrapper combining circuit breaker + retry for a single callable.
 */
export async function resilientCall(fn, { breaker, label, retryOptions = {} } = {}) {
  if (!breaker) {
    return withRetry(fn, { label, ...retryOptions });
  }
  return breaker.execute(async () => {
    return withRetry(fn, { label, ...retryOptions });
  });
}

/**
 * Factory for creating circuit breakers keyed by operation target.
 */
export class CircuitBreakerRegistry extends EventEmitter {
  constructor(defaultOpts = {}) {
    super();
    this.defaultOpts = defaultOpts;
    this.breakers = new Map();
  }

  get(name) {
    if (!this.breakers.has(name)) {
      const breaker = new CircuitBreaker(name, this.defaultOpts);
      this.breakers.set(name, breaker);
    }
    return this.breakers.get(name);
  }

  status() {
    const result = {};
    for (const [name, breaker] of this.breakers) {
      result[name] = breaker.status;
    }
    return result;
  }
}
