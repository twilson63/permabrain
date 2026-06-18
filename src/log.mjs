/**
 * PermaBrain Local Audit Log
 *
 * Records local-only actions (publish, attest, fork, merge, import, export, init,
 * identity, etc.) in a small JSONL file under the PermaBrain home directory.
 *
 * This is intentionally separate from `activity.mjs`, which queries the
 * transport/cache for published items. The audit log tracks actions the local
 * node performs, whether or not they are published to a transport.
 */

import fs from 'node:fs';
import path from 'node:path';
import { getHome, statePaths } from './config.mjs';
import { loadIdentity } from './keys.mjs';
import { emitEvent } from './events.mjs';

const LOG_FILE = 'audit-log.jsonl';
const MAX_LOG_LINES = 10000;
const DEFAULT_LIMIT = 50;
const DEFAULT_TAIL = 10;
const DEFAULT_FOLLOW_INTERVAL_MS = 1000;

export function logDir(home) {
  const { logsDir } = statePaths(home);
  return logsDir;
}

export function logPath(home) {
  const { logsDir } = statePaths(home);
  return path.join(logsDir, LOG_FILE);
}

function ensureLogDir(home) {
  const { logsDir } = statePaths(home);
  fs.mkdirSync(logsDir, { recursive: true });
}

function readRawText(home) {
  const file = logPath(home);
  if (!fs.existsSync(file)) return '';
  return fs.readFileSync(file, 'utf8');
}

function readLines(home) {
  const text = readRawText(home);
  if (!text.trim()) return [];
  const lines = [];
  let index = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      entry._index = index++;
      lines.push(entry);
    } catch {
      // Skip corrupt lines silently; the log is append-only best-effort.
    }
  }
  return lines;
}

function appendLine(home, entry) {
  ensureLogDir(home);
  const file = logPath(home);
  fs.appendFileSync(file, JSON.stringify(entry) + '\n', 'utf8');
}

function entryFingerprint(entry) {
  if (!entry || typeof entry !== 'object') return '';
  return [
    entry.createdAt || '',
    entry.action || '',
    entry.status || '',
    entry.key || '',
    entry.agentId || '',
    entry.message || ''
  ].join('|');
}

function currentAgentId(home) {
  try {
    const identity = loadIdentity(home);
    return identity?.agentId || null;
  } catch {
    return null;
  }
}

/**
 * Record a local audit event.
 *
 * @param {object} opts
 * @param {string} opts.home - PermaBrain home directory.
 * @param {string} opts.action - Action name, e.g. 'publish', 'attest', 'fork'.
 * @param {string} [opts.status='ok'] - 'ok' | 'error' | 'pending'.
 * @param {string} [opts.key] - Article key the action relates to, if any.
 * @param {string} [opts.id] - DataItem/article/attestation id, if any.
 * @param {string} [opts.message] - Human-readable summary.
 * @param {object} [opts.details] - Additional structured metadata.
 * @param {string} [opts.agentId] - Override agent id; defaults to current identity.
 * @returns {object} The written log entry.
 */
export function logAction(opts = {}) {
  const home = opts.home || getHome();
  const action = opts.action;
  if (!action || typeof action !== 'string') {
    throw new Error('log action is required');
  }

  const entry = {
    type: 'audit',
    action,
    status: opts.status || 'ok',
    agentId: opts.agentId || currentAgentId(home) || 'unknown',
    home,
    key: opts.key || null,
    id: opts.id || null,
    message: opts.message || null,
    details: opts.details || null,
    createdAt: new Date().toISOString()
  };

  appendLine(home, entry);

  // Best-effort rotation: keep the log from growing unbounded.
  rotateLog(home);

  // Emit a real-time event for server streams (WebSocket / SSE).
  // Forward common article metadata from details so query-stream filters
  // (topic, kind, title) can match publish/attest/update events.
  const details = entry.details || {};
  emitEvent(action, {
    status: entry.status,
    agentId: entry.agentId,
    key: entry.key,
    id: entry.id,
    message: entry.message,
    details: entry.details,
    createdAt: entry.createdAt,
    topic: details.topic || null,
    kind: details.kind || null,
    title: details.title || null
  });

  return entry;
}

export function rotateLog(home) {
  try {
    const file = logPath(home);
    if (!fs.existsSync(file)) return;
    const stats = fs.statSync(file);
    if (stats.size < MAX_LOG_LINES * 120) return; // rough byte threshold
    const lines = readLines(home);
    if (lines.length <= MAX_LOG_LINES) return;
    const keep = lines.slice(-MAX_LOG_LINES);
    fs.writeFileSync(file, keep.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8');
  } catch {
    // Rotation is best-effort.
  }
}

function normalizeFilter(value) {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) return value;
  return String(value).split(',').map((s) => s.trim()).filter(Boolean);
}

function matchesFilter(value, allowed) {
  if (!allowed || allowed.length === 0) return true;
  if (value === undefined || value === null) return false;
  return allowed.includes(String(value));
}

function matchesDateRange(createdAt, after, before) {
  if (!createdAt) return true;
  if (after && createdAt < new Date(after).toISOString()) return false;
  if (before && createdAt > new Date(before).toISOString()) return false;
  return true;
}

/**
 * Query the audit log with filtering, sorting, and pagination.
 *
 * @param {object} opts
 * @param {string} opts.home
 * @param {string|string[]} [opts.action] - Action name(s).
 * @param {string|string[]} [opts.status] - Status value(s).
 * @param {string|string[]} [opts.key] - Article key(s).
 * @param {string|string[]} [opts.agentId] - Agent id(s).
 * @param {string} [opts.after] - ISO date lower bound.
 * @param {string} [opts.before] - ISO date upper bound.
 * @param {string} [opts.order='desc'] - 'asc' | 'desc'.
 * @param {number} [opts.limit=50]
 * @param {number} [opts.offset=0]
 * @param {string} [opts.search] - Substring search on action, key, message, and details.
 * @param {boolean} [opts.markdown=false] - Also return markdown rendering.
 * @returns {object} { entries, total, limit, offset, markdown? }
 */
export function queryLog(opts = {}) {
  const home = opts.home || getHome();
  const actions = normalizeFilter(opts.action);
  const statuses = normalizeFilter(opts.status);
  const keys = normalizeFilter(opts.key);
  const agentIds = normalizeFilter(opts.agentId);
  const after = opts.after ? new Date(opts.after).toISOString() : null;
  const before = opts.before ? new Date(opts.before).toISOString() : null;
  const search = opts.search ? String(opts.search).toLowerCase() : null;
  const order = opts.order === 'asc' ? 'asc' : 'desc';
  const limit = Number.isFinite(opts.limit) ? Math.max(1, opts.limit) : DEFAULT_LIMIT;
  const offset = Number.isFinite(opts.offset) ? Math.max(0, opts.offset) : 0;

  const all = readLines(home).filter((entry) => {
    if (!matchesFilter(entry.action, actions)) return false;
    if (!matchesFilter(entry.status, statuses)) return false;
    if (!matchesFilter(entry.key, keys)) return false;
    if (!matchesFilter(entry.agentId, agentIds)) return false;
    if (!matchesDateRange(entry.createdAt, after, before)) return false;
    if (search) {
      const haystack = [
        entry.action,
        entry.key,
        entry.message,
        JSON.stringify(entry.details)
      ].join(' ').toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });

  const sorted = order === 'asc'
    ? all.slice().sort((a, b) => {
        const da = new Date(a.createdAt);
        const db = new Date(b.createdAt);
        if (da - db !== 0) return da - db;
        return (a._index ?? 0) - (b._index ?? 0);
      })
    : all.slice().sort((a, b) => {
        const da = new Date(a.createdAt);
        const db = new Date(b.createdAt);
        if (db - da !== 0) return db - da;
        return (b._index ?? 0) - (a._index ?? 0);
      });

  const total = sorted.length;
  const entries = sorted.slice(offset, offset + limit);

  const result = { entries, total, limit, offset };
  if (opts.markdown) {
    result.markdown = logToMarkdown(result);
  }
  return result;
}

/**
 * Render log query results as markdown.
 *
 * @param {object} result - Result from `queryLog`.
 * @returns {string}
 */
export function logToMarkdown(result) {
  const lines = [
    '# PermaBrain Audit Log',
    '',
    `Showing ${result.entries.length} of ${result.total} events`,
    ''
  ];

  if (!result.entries.length) {
    lines.push('No audit events found. Actions performed by this node will appear here.');
    lines.push('');
    return lines.join('\n').trim() + '\n';
  }

  for (const entry of result.entries) {
    const ts = entry.createdAt ? new Date(entry.createdAt).toISOString() : 'unknown';
    const icon = entry.status === 'ok' ? '✅' : entry.status === 'error' ? '❌' : '⏳';
    lines.push(`## ${icon} ${entry.action} — ${ts}`);
    lines.push(`- **Agent:** ${entry.agentId || 'unknown'}`);
    if (entry.key) lines.push(`- **Key:** ${entry.key}`);
    if (entry.id) lines.push(`- **Id:** \`${entry.id}\``);
    if (entry.status) lines.push(`- **Status:** ${entry.status}`);
    if (entry.message) lines.push(`- **Message:** ${entry.message}`);
    if (entry.details) {
      lines.push('- **Details:**');
      lines.push('```json');
      lines.push(JSON.stringify(entry.details, null, 2));
      lines.push('```');
    }
    lines.push('');
  }

  return lines.join('\n').trim() + '\n';
}

/**
 * Return the most recent audit-log entries.
 *
 * Accepts the same filters as `queryLog` but defaults to the newest `limit`
 * entries (default 10). Useful for `permabrain log --tail`.
 *
 * @param {object} opts
 * @returns {object} { entries, total, limit, offset }
 */
export function tailLog(opts = {}) {
  const limit = Number.isFinite(opts.limit) ? Math.max(1, opts.limit) : DEFAULT_TAIL;
  return queryLog({ ...opts, limit, offset: 0, order: 'desc' });
}

/**
 * Watch the audit log for newly appended entries.
 *
 * Polls the log file at `interval` ms (default 1000) and yields any new lines
 * that parse as JSON. If the file shrinks (rotation/truncation), the watcher
 * resets and treats existing content as new. Optional `tail` yields the N
 * most recent entries before waiting for new ones.
 *
 * @param {object} opts
 * @param {string} opts.home
 * @param {number} [opts.interval=1000] - Polling interval in milliseconds.
 * @param {number} [opts.tail=0] - Yield this many recent entries first.
 * @returns {{[Symbol.asyncIterator]: function, cancel: function}}
 */
export function followLog(opts = {}) {
  const home = opts.home || getHome();
  const interval = Number.isFinite(opts.interval) ? Math.max(100, opts.interval) : DEFAULT_FOLLOW_INTERVAL_MS;
  const tail = Number.isFinite(opts.tail) ? Math.max(0, opts.tail) : 0;
  const file = logPath(home);
  let running = true;
  let lastSize = 0;

  function readNewEntries() {
    if (!fs.existsSync(file)) return [];
    const stats = fs.statSync(file);
    if (stats.size === lastSize) return [];
    if (stats.size < lastSize) {
      // Log rotated or truncated; reset and re-read from beginning.
      lastSize = 0;
    }
    const fd = fs.openSync(file, 'r');
    const buffer = Buffer.alloc(stats.size - lastSize);
    try {
      fs.readSync(fd, buffer, 0, buffer.length, lastSize);
    } finally {
      fs.closeSync(fd);
    }
    lastSize = stats.size;
    const text = buffer.toString('utf8');
    const entries = [];
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        entries.push(JSON.parse(line));
      } catch {
        // Skip corrupt trailing lines; they may be completed next poll.
      }
    }
    return entries;
  }

  async function* generator() {
    if (tail > 0) {
      const recent = tailLog({ ...opts, limit: tail });
      for (const entry of recent.entries) yield entry;
    }
    while (running) {
      const entries = readNewEntries();
      for (const entry of entries) yield entry;
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
  }

  return {
    [Symbol.asyncIterator]: generator,
    cancel() {
      running = false;
    }
  };
}

/**
 * Export the full local audit log as a migration bundle.
 *
 * @param {object} opts
 * @param {string} opts.home
 * @param {string} [opts.format='json'] - 'json' or 'jsonl'. JSONL includes a `raw` string.
 * @returns {object} Bundle object with type 'audit-log', meta, and entries.
 */
export function exportLog(opts = {}) {
  const home = opts.home || getHome();
  const entries = readLines(home);
  const bundle = {
    type: 'audit-log',
    version: '1.0',
    meta: {
      createdAt: new Date().toISOString(),
      sourceAgentId: currentAgentId(home),
      sourceHome: home,
      entryCount: entries.length
    },
    entries
  };

  if (opts.format === 'jsonl') {
    const raw = entries.map((e) => JSON.stringify(e)).join('\n') + (entries.length ? '\n' : '');
    return { ...bundle, format: 'jsonl', raw };
  }

  return bundle;
}

/**
 * Import an audit-log bundle into the local log.
 *
 * By default skips entries that already appear to be present, matching on a
 * fingerprint of createdAt/action/status/key/agentId/message. This keeps
 * cross-node migration idempotent.
 *
 * @param {object} bundle - Audit-log bundle (type 'audit-log') or a JSONL string/array.
 * @param {object} [opts]
 * @param {string} [opts.home]
 * @param {boolean} [opts.skipDuplicates=true]
 * @returns {object} { imported, skipped, failed, results, meta }
 */
export function importLog(bundle, opts = {}) {
  const home = opts.home || getHome();
  const skipDuplicates = opts.skipDuplicates !== false;
  const existing = skipDuplicates
    ? new Set(readLines(home).map((e) => entryFingerprint(e)))
    : new Set();

  let entries = [];
  if (bundle && typeof bundle === 'object') {
    if (Array.isArray(bundle.entries)) entries = bundle.entries;
    else if (Array.isArray(bundle)) entries = bundle;
    else if (typeof bundle.raw === 'string') {
      entries = bundle.raw.split('\n').filter(Boolean).map((line) => JSON.parse(line));
    }
  } else if (typeof bundle === 'string') {
    entries = bundle.split('\n').filter(Boolean).map((line) => JSON.parse(line));
  }

  ensureLogDir(home);
  const file = logPath(home);
  let imported = 0;
  let skipped = 0;
  let failed = 0;
  const results = [];

  for (const entry of entries) {
    try {
      if (!entry || typeof entry !== 'object') throw new Error('invalid entry');
      const fp = entryFingerprint(entry);
      if (skipDuplicates && existing.has(fp)) {
        skipped++;
        results.push({ ok: true, imported: false, action: entry.action, createdAt: entry.createdAt });
        continue;
      }
      fs.appendFileSync(file, JSON.stringify(entry) + '\n', 'utf8');
      existing.add(fp);
      imported++;
      results.push({ ok: true, imported: true, action: entry.action, createdAt: entry.createdAt });
    } catch (err) {
      failed++;
      results.push({ ok: false, imported: false, action: entry?.action, createdAt: entry?.createdAt, error: err.message });
    }
  }

  rotateLog(home);
  return {
    imported,
    skipped,
    failed,
    results,
    meta: {
      sourceAgentId: bundle?.meta?.sourceAgentId || null,
      entryCount: entries.length
    }
  };
}
