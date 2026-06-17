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

const LOG_FILE = 'audit-log.jsonl';
const MAX_LOG_LINES = 10000;
const DEFAULT_LIMIT = 50;

export function logPath(home) {
  const { home: homeDir } = statePaths(home);
  return path.join(homeDir, LOG_FILE);
}

function ensureLogDir(home) {
  const { home: homeDir } = statePaths(home);
  fs.mkdirSync(homeDir, { recursive: true });
}

function readLines(home) {
  const file = logPath(home);
  if (!fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, 'utf8');
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
