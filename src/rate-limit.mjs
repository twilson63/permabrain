/**
 * PermaBrain HTTP API Rate Limiting
 *
 * Token-bucket style per-client rate limiter for `permabrain serve`.
 * Supports IP/socket identification, X-Forwarded-For trusting, burst budget,
 * and standard 429 responses with Retry-After.
 *
 * Usage:
 *   import { createRateLimiter } from './rate-limit.mjs';
 *   const limiter = createRateLimiter({ max: 60, windowMs: 60000, burst: 10 });
 *   const result = limiter.check(req);
 *   if (!result.ok) return sendError(res, 429, result.error, { 'Retry-After': String(result.retryAfter) });
 */

export const DEFAULT_RATE_LIMIT_MAX = 60;
export const DEFAULT_RATE_LIMIT_WINDOW_MS = 60000;
export const DEFAULT_RATE_LIMIT_BURST = 10;

function parseMs(value, fallback) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseCount(value, fallback) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'number') return Number.isInteger(value) && value >= 0 ? value : fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function parseBool(value) {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const lowered = value.toLowerCase();
    if (lowered === 'true' || lowered === '1') return true;
    if (lowered === 'false' || lowered === '0') return false;
  }
  return undefined;
}

export function getClientIdentifier(req, trustProxy) {
  const headers = req.headers || {};
  if (trustProxy && headers['x-forwarded-for']) {
    const first = String(headers['x-forwarded-for']).split(',')[0].trim();
    if (first) return `fwd:${first}`;
  }
  if (headers['x-forwarded-for'] && !trustProxy) {
    // Do not trust the header alone; append it to the socket address to make
    // spoofing harder. The socket address is authoritative for the connection.
    const socketAddr = req.socket?.remoteAddress || req.connection?.remoteAddress || 'unknown';
    const first = String(headers['x-forwarded-for']).split(',')[0].trim();
    return `mix:${socketAddr}:${first}`;
  }
  const socketAddr = req.socket?.remoteAddress || req.connection?.remoteAddress || 'unknown';
  return `ip:${socketAddr}`;
}

export function createRateLimiter(options = {}) {
  // Default state is disabled unless the caller explicitly requests rate
  // limiting by setting max or enabled=true. This lets servers safely create a
  // rate limiter with no config and remain permissive.
  const requestedMax = options.max;
  const enabled = options.enabled === true ||
    (options.enabled !== false && requestedMax !== undefined && requestedMax !== 'undefined' && requestedMax !== 0 && requestedMax !== '0');
  const windowMs = parseMs(options.windowMs, DEFAULT_RATE_LIMIT_WINDOW_MS);
  const max = parseCount(requestedMax, DEFAULT_RATE_LIMIT_MAX);
  const burst = parseCount(options.burst, DEFAULT_RATE_LIMIT_BURST);
  const trustProxy = parseBool(options.trustProxy) ?? false;

  // Each client gets a bucket with `max + burst` tokens. Tokens are refilled at
  // rate `max / windowMs` continuously. This gives a client `max` steady-state
  // requests per window plus a `burst` allowance.
  const clients = new Map();

  function now() {
    return Date.now();
  }

  function prune() {
    const cutoff = now() - windowMs * 2;
    for (const [key, entry] of clients) {
      if (entry.lastSeen < cutoff) clients.delete(key);
    }
  }

  function getBudget(key, t) {
    const entry = clients.get(key);
    if (!entry) {
      return { tokens: max + burst, lastSeen: t };
    }
    const elapsed = t - entry.lastSeen;
    const refill = (elapsed / windowMs) * max;
    const tokens = Math.min(max + burst, entry.tokens + refill);
    return { tokens, lastSeen: t };
  }

  function check(req) {
    if (!enabled) return { ok: true, limit: max + burst, remaining: -1, resetAt: 0 };

    const key = getClientIdentifier(req, trustProxy);
    const t = now();
    // Prune occasionally to avoid unbounded growth. Use simple probabilistic
    // pruning keyed off the least significant digit of the timestamp.
    if (t % 10 === 0) prune();

    const budget = getBudget(key, t);
    if (budget.tokens < 1) {
      const retryAfter = Math.max(1, Math.ceil(windowMs / max));
      return {
        ok: false,
        status: 429,
        error: `Rate limit exceeded. Try again in ${retryAfter}s.`,
        retryAfter,
        limit: max + burst,
        remaining: 0,
        resetAt: t + windowMs
      };
    }

    budget.tokens -= 1;
    clients.set(key, budget);

    return {
      ok: true,
      limit: max + burst,
      remaining: Math.floor(budget.tokens),
      resetAt: t + windowMs
    };
  }

  function reset() {
    clients.clear();
  }

  return { check, reset, getClientIdentifier, options: { windowMs, max, burst, trustProxy, enabled } };
}
