/**
 * PermaBrain request logging / access-log ring buffer + optional disk persistence.
 *
 * Keeps a bounded in-memory history of recent HTTP requests handled by
 * `permabrain serve` so operators can inspect traffic without configuring an
 * external reverse proxy. It also propagates `X-Request-ID` for tracing across
 * SDK, CLI and server logs.
 *
 * When `home` is provided, every request entry is also appended as JSON lines
 * to `logs/access-log.jsonl` inside the home directory. The file is rotated
 * when it reaches `--access-log-max-size` and older files are pruned to keep
 * `--access-log-max-files`. A retention window (`--access-log-retention-days`)
 * can also be applied at query time. The disk log enables live tail endpoints
 * and long-term audit pages in the web viewer.
 *
 * Usage:
 *   import { requestLogger, getRecentRequests, requestsToMarkdown } from './src/request-log.mjs';
 *   const log = requestLogger({ format: 'short', maxEntries: 1000, home: '/tmp/.permabrain' });
 *   const middleware = log.middleware();
 *   middleware(req, res, () => {});
 */

import fs from 'node:fs';
import path from 'node:path';
import { statePaths } from './config.mjs';

const DEFAULT_MAX_ENTRIES = 1000;
const DEFAULT_MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MiB
const DEFAULT_MAX_FILES = 5;
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

function resolveLogDir(home, logDir) {
  if (logDir) return path.resolve(logDir);
  if (home) return statePaths(home).logsDir;
  return null;
}

export class RequestLogger {
  constructor(options = {}) {
    this.format = options.format || 'short';
    this.maxEntries = Math.max(1, Number(options.maxEntries) || DEFAULT_MAX_ENTRIES);
    this.trustProxy = !!options.trustProxy;
    this.entries = [];
    this.home = options.home || null;
    this.logDir = resolveLogDir(this.home, options.logDir);
    this.maxSize = Math.max(1024, Number(options.maxSize) || DEFAULT_MAX_SIZE_BYTES);
    this.maxFiles = Math.max(1, Number(options.maxFiles) || DEFAULT_MAX_FILES);
    this.retentionDays = options.retentionDays !== undefined ? Number(options.retentionDays) : null;
    this.diskEnabled = this.logDir !== null;
    if (this.diskEnabled) {
      fs.mkdirSync(this.logDir, { recursive: true });
      this.currentLogPath = path.join(this.logDir, 'access-log.jsonl');
    }
    this._diskTailClients = new Set();
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

    if (this.diskEnabled) {
      this._appendToDisk(entry);
    }

    this._broadcastTail(entry);

    if (line) {
      console.log(line);
    }
  }

  _appendToDisk(entry) {
    try {
      const jsonl = JSON.stringify(entry) + '\n';
      fs.appendFileSync(this.currentLogPath, jsonl);
      this._maybeRotate();
    } catch (err) {
      // Do not crash the server if the log disk is full; keep in-memory buffer.
      console.error('PermaBrain access log write failed:', err.message);
    }
  }

  _maybeRotate() {
    try {
      const stats = fs.statSync(this.currentLogPath);
      if (stats.size < this.maxSize) return;
      // Rename existing rotated files up by one.
      for (let i = this.maxFiles - 1; i >= 1; i--) {
        const src = path.join(this.logDir, `access-log.${i}.jsonl`);
        const dst = path.join(this.logDir, `access-log.${i + 1}.jsonl`);
        if (fs.existsSync(src)) {
          fs.renameSync(src, dst);
        }
      }
      fs.renameSync(this.currentLogPath, path.join(this.logDir, 'access-log.1.jsonl'));
      this._pruneRotatedFiles();
    } catch (err) {
      console.error('PermaBrain access log rotation failed:', err.message);
    }
  }

  _pruneRotatedFiles() {
    try {
      const files = fs.readdirSync(this.logDir)
        .filter(name => name.startsWith('access-log') && name.endsWith('.jsonl'))
        .map(name => ({ name, path: path.join(this.logDir, name), stat: fs.statSync(path.join(this.logDir, name)) }))
        .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
      // Keep current + maxFiles - 1 rotated copies. Current file is recreated on next write.
      const keep = new Set(['access-log.jsonl']);
      for (let i = 1; i < this.maxFiles && i - 1 < files.length; i++) {
        const candidate = files.find(f => f.name === `access-log.${i}.jsonl`);
        if (candidate) keep.add(candidate.name);
      }
      for (const file of files) {
        if (!keep.has(file.name)) {
          fs.unlinkSync(file.path);
        }
      }
    } catch (err) {
      console.error('PermaBrain access log pruning failed:', err.message);
    }
  }

  _broadcastTail(entry) {
    if (this._onTail) {
      try { this._onTail(entry); } catch { /* ignore */ }
    }
    const text = `data: ${JSON.stringify(entry)}\n\n`;
    for (const res of this._diskTailClients) {
      try {
        if (!res.writableEnded) res.write(text);
      } catch {
        // ignore
      }
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

  /**
   * Return all log files (current + rotated) ordered newest first.
   */
  logFiles() {
    if (!this.diskEnabled) return [];
    try {
      const current = path.join(this.logDir, 'access-log.jsonl');
      const files = [];
      if (fs.existsSync(current)) files.push(current);
      for (let i = 1; ; i++) {
        const p = path.join(this.logDir, `access-log.${i}.jsonl`);
        if (!fs.existsSync(p)) break;
        files.push(p);
      }
      return files;
    } catch {
      return [];
    }
  }

  /**
   * Query persisted JSONL access logs with filters, pagination, and retention.
   * Results are returned newest-first (reverse chronological).
   */
  async queryDisk(options = {}) {
    if (!this.diskEnabled) return { total: 0, offset: 0, limit: 0, entries: [] };
    const files = this.logFiles();
    const limit = Math.max(0, Number(options.limit) || 100);
    const offset = Math.max(0, Number(options.offset) || 0);
    const method = options.method ? String(options.method).toUpperCase() : null;
    const status = options.status !== undefined ? Number(options.status) : null;
    const pathFilter = options.path ? String(options.path) : null;
    const after = options.after ? new Date(options.after).getTime() : null;
    const before = options.before ? new Date(options.before).getTime() : null;
    const retentionCutoff = this.retentionDays !== null && this.retentionDays > 0
      ? Date.now() - this.retentionDays * 24 * 60 * 60 * 1000
      : null;

    const matches = [];
    for (const file of files) {
      const text = await fs.promises.readFile(file, 'utf8');
      if (!text.trim()) continue;
      const lines = text.split('\n');
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim();
        if (!line) continue;
        let entry;
        try { entry = JSON.parse(line); } catch { continue; }
        const ts = new Date(entry.timestamp).getTime();
        if (Number.isNaN(ts)) continue;
        if (retentionCutoff !== null && ts < retentionCutoff) continue;
        if (after !== null && ts < after) continue;
        if (before !== null && ts > before) continue;
        if (method && entry.method !== method) continue;
        if (status !== null && !Number.isNaN(status) && entry.statusCode !== status) continue;
        if (pathFilter && !entry.path.includes(pathFilter)) continue;
        matches.push(entry);
      }
    }
    const total = matches.length;
    const slice = matches.slice(offset, offset + limit);
    return { total, offset, limit, entries: slice };
  }

  /**
   * Async generator that yields every new request entry as it is recorded.
   * Used by the live tail SSE endpoint.
   */
  async *tailStream(signal) {
    const queue = [];
    let pendingResolve = null;
    const listener = (entry) => {
      queue.push(entry);
      if (pendingResolve) {
        pendingResolve();
        pendingResolve = null;
      }
    };
    this._onTail = listener;
    try {
      while (!signal || !signal.aborted) {
        while (queue.length) {
          yield queue.shift();
        }
        if (signal?.aborted) break;
        await new Promise(resolve => {
          pendingResolve = resolve;
          const t = setTimeout(resolve, 100);
          const onAbort = () => {
            clearTimeout(t);
            pendingResolve = null;
            resolve();
          };
          if (signal) signal.addEventListener('abort', onAbort, { once: true });
        });
      }
    } finally {
      this._onTail = null;
    }
  }

  /**
   * Return disk query results as a markdown table.
   */
  diskToMarkdown(options = {}) {
    return accessLogResultToMarkdown(this.entries, options);
  }

  /**
   * Subscribe a Server-Sent Events response to live tail updates.
   */
  subscribeTail(res) {
    this._diskTailClients.add(res);
    res.on('close', () => this._diskTailClients.delete(res));
  }

  unsubscribeTail(res) {
    this._diskTailClients.delete(res);
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
  return accessLogResultToMarkdown(entries, { total });
}

export function accessLogResultToMarkdown(result, options = {}) {
  const total = options.total ?? (Array.isArray(result) ? result.length : result?.total ?? 0);
  const entries = Array.isArray(result) ? result : result?.entries ?? [];
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

export function defaultLogPath(home) {
  if (!home) return null;
  return path.join(statePaths(home).logsDir, 'access-log.jsonl');
}
