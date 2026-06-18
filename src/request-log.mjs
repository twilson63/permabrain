/**
 * PermaBrain request logging / access-log ring buffer.
 *
 * Keeps a bounded in-memory history of recent HTTP requests handled by
 * `permabrain serve` so operators can inspect traffic without configuring an
 * external reverse proxy. It also propagates `X-Request-ID` for tracing across
 * SDK, CLI and server logs.
 *
 * Usage:
 *   import { requestLogger, getRecentRequests, requestsToMarkdown } from './src/request-log.mjs';
 *   const log = requestLogger({ format: 'short', maxEntries: 1000 });
 *   const middleware = log.middleware();
 *   middleware(req, res, () => {});
 */

const DEFAULT_MAX_ENTRIES = 1000;
const SENSITIVE_HEADERS = new Set([
  'authorization',
  'cookie',
  'x-api-key',
  'set-cookie'
]);

function sanitizeHeaders(headers) {
  const out = {};
  for (const [key, value] of Object.entries(headers || {})) {
    const lower = key.toLowerCase();
    if (SENSITIVE_HEADERS.has(lower)) {
      out[key] = '<redacted>';
    } else {
      out[key] = value;
    }
  }
  return out;
}

function redactQuery(url) {
  if (!url || typeof url !== 'string') return url;
  return url.replace(/([?&]key=)[^&]*/gi, '$1<redacted>');
}

function generateRequestId() {
  const now = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `req-${now}-${rand}`;
}

function formatCombinedLog(req, res, startTime, requestId) {
  const ms = Date.now() - startTime;
  const client = req.headers['x-forwarded-for']
    ? String(req.headers['x-forwarded-for']).split(',')[0].trim()
    : req.socket?.remoteAddress || '-';
  const method = req.method || '-';
  const path = redactQuery(req.url) || '-';
  const status = res.statusCode || 0;
  const length = res.getHeader('content-length') || '-';
  const referer = req.headers.referer || '-';
  const ua = req.headers['user-agent'] || '-';
  return `${client} - - [${new Date().toISOString()}] "${method} ${path} HTTP/${req.httpVersion}" ${status} ${length} "${referer}" "${ua}" ${requestId} ${ms}ms`;
}

function formatShortLog(req, res, startTime, requestId) {
  const ms = Date.now() - startTime;
  const method = req.method || '-';
  const path = redactQuery(req.url) || '-';
  return `[${requestId}] ${method} ${path} ${res.statusCode || 0} ${ms}ms`;
}

export class RequestLogger {
  constructor(options = {}) {
    this.format = options.format || 'short';
    this.maxEntries = Math.max(1, Number(options.maxEntries) || DEFAULT_MAX_ENTRIES);
    this.trustProxy = !!options.trustProxy;
    this.entries = [];
  }

  middleware() {
    return (req, res, next) => {
      const startTime = Date.now();
      const requestId = req.headers['x-request-id']
        ? String(req.headers['x-request-id'])
        : generateRequestId();
      req.requestId = requestId;
      res.setHeader('X-Request-ID', requestId);

      const originalEnd = res.end.bind(res);
      res.end = (...args) => {
        originalEnd(...args);
        this.record(req, res, startTime, requestId);
      };

      if (typeof next === 'function') next();
    };
  }

  record(req, res, startTime, requestId) {
    if (this.format === 'none') return;

    const durationMs = Date.now() - startTime;
    const entry = {
      requestId,
      timestamp: new Date().toISOString(),
      method: req.method || 'GET',
      path: redactQuery(req.url) || '/',
      statusCode: res.statusCode || 0,
      durationMs,
      clientIp: this.trustProxy && req.headers['x-forwarded-for']
        ? String(req.headers['x-forwarded-for']).split(',')[0].trim()
        : req.socket?.remoteAddress || null,
      userAgent: req.headers['user-agent'] || null,
      requestHeaders: this.format === 'json' ? sanitizeHeaders(req.headers) : undefined,
      responseHeaders: this.format === 'json' ? sanitizeHeaders(res.getHeaders()) : undefined
    };
    let line = null;

    if (this.format === 'combined' || this.format === 'short') {
      line = this.format === 'combined'
        ? formatCombinedLog(req, res, startTime, requestId)
        : formatShortLog(req, res, startTime, requestId);
      entry.message = line;
      if (this.format !== 'json') {
        delete entry.requestHeaders;
        delete entry.responseHeaders;
      }
    }

    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }

    if (line) {
      console.log(line);
    }
  }

  getRecentRequests(options = {}) {
    const limit = Math.max(0, Number(options.limit) || this.entries.length);
    const offset = Math.max(0, Number(options.offset) || 0);
    const method = options.method ? String(options.method).toUpperCase() : null;
    const status = options.status !== undefined ? Number(options.status) : null;
    const path = options.path ? String(options.path) : null;

    let filtered = this.entries;
    if (method) filtered = filtered.filter(e => e.method === method);
    if (status !== null && !Number.isNaN(status)) filtered = filtered.filter(e => e.statusCode === status);
    if (path) filtered = filtered.filter(e => e.path.includes(path));

    const total = filtered.length;
    const slice = filtered.slice(offset, offset + limit);
    return { total, offset, limit, entries: slice };
  }

  clear() {
    this.entries = [];
  }
}

export function requestLogger(options = {}) {
  return new RequestLogger(options);
}

export function getRecentRequests(logger, options = {}) {
  if (!logger) return { total: 0, offset: 0, limit: 0, entries: [] };
  return logger.getRecentRequests(options);
}

export function requestsToMarkdown(logger, options = {}) {
  if (!logger) return 'No request log available.';
  const { total, entries } = logger.getRecentRequests(options);
  const lines = [
    '# Recent PermaBrain HTTP requests',
    `Total matching: ${total}`,
    ''
  ];
  if (entries.length === 0) {
    lines.push('_No requests recorded._');
    return lines.join('\n');
  }
  lines.push('| Time | Request ID | Method | Path | Status | Duration |');
  lines.push('|---|---|---|---|---|---|');
  for (const e of entries) {
    lines.push(`| ${e.timestamp} | ${e.requestId} | ${e.method} | ${e.path} | ${e.statusCode} | ${e.durationMs}ms |`);
  }
  return lines.join('\n');
}

export function defaultRequestLogger() {
  return requestLogger();
}
