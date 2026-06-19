/**
 * PermaBrain Support Bundle
 *
 * Collects a portable diagnostics snapshot for a local PermaBrain home or a
 * running `permabrain serve` instance. Useful for troubleshooting, support
 * requests, and cross-node comparisons.
 *
 * The bundle includes:
 *   - package version and node version
 *   - local config (with secrets redacted)
 *   - public identity metadata (agentId, key type, public key fingerprint)
 *   - local index summary (article/attestation counts, topics, kinds)
 *   - recent audit-log tail
 *   - recent HTTP access-log entries
 *   - runtime metrics snapshot (when available)
 *   - registered HTTP route catalog
 *   - transport circuit breaker and transport metrics status
 *   - environment variable names (values are redacted for security)
 *
 * All sensitive fields (keys, seeds, tokens, API keys) are recursively
 * redacted by default. Pass `redact: false` only when you control the
 * destination and understand the risk.
 */

import fs from 'node:fs';
import path from 'node:path';
import { getHome, loadConfig, statePaths } from './config.mjs';
import { loadIdentity, publicIdentity } from './keys.mjs';
import { loadIndex } from './cache.mjs';
import { tailLog } from './log.mjs';
import { requestLogger } from './request-log.mjs';
import { buildMetricsReport, runtimeMetrics } from './metrics-runtime.mjs';
import { listRoutes } from './route-registry.mjs';
import { getCircuitBreakerStatus, getTransportMetrics } from './transport.mjs';

const DEFAULT_AUDIT_LIMIT = 50;
const DEFAULT_ACCESS_LIMIT = 50;
const SENSITIVE_KEYS = new Set([
  'apiKey', 'apikey', 'api-key', 'api_key', 'x-api-key',
  'privateKey', 'private_key', 'private-key', 'secretKey', 'secret_key', 'secret-key',
  'seed', 'encryptionSeed', 'encryption_seed', 'encryptionSeed', 'decryptSeed',
  'token', 'accessToken', 'access_token', 'authToken', 'auth_token',
  'password', 'passphrase', 'secret', 'jwk', 'privateJwk'
]);

function isSensitiveKey(key) {
  if (typeof key !== 'string') return false;
  const lower = key.toLowerCase();
  if (SENSITIVE_KEYS.has(key) || SENSITIVE_KEYS.has(lower)) return true;
  for (const sensitive of SENSITIVE_KEYS) {
    if (lower.includes(sensitive.toLowerCase())) return true;
  }
  return false;
}

export function redactSecrets(value, key = '') {
  if (key && isSensitiveKey(key)) {
    if (value === undefined || value === null) return value;
    if (typeof value === 'string') return value.length > 0 ? '[REDACTED]' : '';
    if (Array.isArray(value)) return value.length > 0 ? ['[REDACTED]'] : [];
    return '[REDACTED]';
  }

  if (Array.isArray(value)) {
    return value.map((v, i) => redactSecrets(v, String(i)));
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = redactSecrets(v, k);
    }
    return out;
  }
  return value;
}

function redactConfig(config) {
  return redactSecrets(config);
}

function redactIdentity(identity) {
  if (!identity) return null;
  const publicId = publicIdentity(identity);
  return {
    agentId: publicId.agentId,
    type: publicId.type,
    publicKey: identity.publicKey || publicId.publicKey || null,
    createdAt: publicId.createdAt || null
  };
}

function getPackageInfo() {
  try {
    const pkgPath = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    return { name: pkg.name, version: pkg.version, description: pkg.description };
  } catch {
    return { name: 'permabrain', version: 'unknown' };
  }
}

function getEnvironmentNames() {
  return Object.keys(process.env)
    .filter((k) => k.toUpperCase().startsWith('PERMABRAIN'))
    .sort();
}

function summarizeIndex(index) {
  if (!index) return null;
  const articles = Object.values(index.articles || {});
  const attestations = Object.values(index.attestations || {});
  const topics = new Set();
  const kinds = new Set();
  const authors = new Set();
  for (const a of articles) {
    if (a.topic) topics.add(a.topic);
    if (a.kind) kinds.add(a.kind);
    if (a.authorAgentId) authors.add(a.authorAgentId);
  }
  return {
    articleCount: articles.length,
    attestationCount: attestations.length,
    topics: Array.from(topics).sort(),
    kinds: Array.from(kinds).sort(),
    authors: Array.from(authors).sort(),
    updatedAt: index.updatedAt || null
  };
}

/**
 * Build a diagnostics support bundle.
 *
 * @param {Object} [opts]
 * @param {string} [opts.home] - PermaBrain home directory
 * @param {Object} [opts.config] - Optional preloaded config
 * @param {Object} [opts.identity] - Optional preloaded identity
 * @param {Object} [opts.runtimeMetrics] - Optional runtime metrics collector
 * @param {number} [opts.auditLogLimit=50]
 * @param {number} [opts.accessLogLimit=50]
 * @param {boolean} [opts.redact=true] - Redact secret fields
 * @returns {Promise<Object>}
 */
export async function buildSupportBundle(opts = {}) {
  const home = opts.home || getHome();
  let config;
  try { config = opts.config || loadConfig(home); } catch { config = {}; }
  let identity;
  try { identity = opts.identity || loadIdentity(home); } catch { identity = null; }

  let indexSummary = null;
  try {
    const index = await loadIndex(home);
    indexSummary = summarizeIndex(index);
  } catch {
    // ignore
  }

  const auditLog = tailLog({ home, limit: opts.auditLogLimit ?? DEFAULT_AUDIT_LIMIT });
  const logger = requestLogger({ format: 'none', home });
  const accessLog = logger.diskEnabled
    ? await logger.queryDisk({ limit: opts.accessLogLimit ?? DEFAULT_ACCESS_LIMIT, offset: 0 })
    : logger.getRecentRequests({ limit: opts.accessLogLimit ?? DEFAULT_ACCESS_LIMIT, offset: 0 });

  const metrics = await buildMetricsReport({
    runtime: opts.runtimeMetrics || runtimeMetrics(),
    home,
    filters: opts.metricsFilters || {}
  });

  const bundle = {
    generatedAt: new Date().toISOString(),
    package: getPackageInfo(),
    node: process.version,
    home,
    config: redactConfig(config),
    identity: redactIdentity(identity),
    indexSummary,
    auditLog,
    accessLog,
    metrics,
    routes: listRoutes(),
    transport: {
      circuitBreakers: getCircuitBreakerStatus(),
      transportMetrics: getTransportMetrics()
    },
    environment: getEnvironmentNames()
  };

  if (opts.redact === false) {
    bundle._redactionDisabled = true;
    bundle.config = config;
    bundle.identity = identity ? publicIdentity(identity) : null;
  }

  return bundle;
}

export function supportBundleToMarkdown(bundle) {
  const lines = [];
  lines.push('# PermaBrain Support Bundle');
  lines.push('');
  lines.push(`- Generated: ${bundle.generatedAt}`);
  lines.push(`- Package: ${bundle.package.name} ${bundle.package.version}`);
  lines.push(`- Node: ${bundle.node}`);
  lines.push(`- Home: ${bundle.home}`);
  lines.push(`- Agent: ${bundle.identity?.agentId || 'unknown'} (${bundle.identity?.type || 'unknown'})`);
  lines.push(`- Transport: ${bundle.config?.transport || 'unknown'}`);
  if (bundle._redactionDisabled) lines.push('- ⚠️ Redaction disabled — secrets may be present');
  lines.push('');

  lines.push('## Local index summary');
  if (bundle.indexSummary) {
    lines.push(`- Articles: ${bundle.indexSummary.articleCount}`);
    lines.push(`- Attestations: ${bundle.indexSummary.attestationCount}`);
    lines.push(`- Topics: ${bundle.indexSummary.topics.join(', ') || '—'}`);
    lines.push(`- Kinds: ${bundle.indexSummary.kinds.join(', ') || '—'}`);
    lines.push(`- Authors: ${bundle.indexSummary.authors.length}`);
  } else {
    lines.push('_Unable to load local index._');
  }
  lines.push('');

  lines.push('## Runtime metrics');
  const r = bundle.metrics?.runtime;
  if (r) {
    lines.push(`- Uptime: ${r.uptime}`);
    lines.push(`- Requests: ${r.requests?.total ?? 0}`);
    lines.push(`- Errors: ${r.requests?.errors ?? 0}`);
    lines.push(`- Rate-limited: ${r.requests?.rateLimited ?? 0}`);
    lines.push(`- Active SSE streams: ${r.activeStreams?.sse ?? 0}`);
    lines.push(`- Active WebSocket streams: ${r.activeStreams?.websocket ?? 0}`);
  } else {
    lines.push('_No runtime metrics available._');
  }
  lines.push('');

  lines.push(`## Audit log tail (${bundle.auditLog?.total ?? 0})`);
  const auditEntries = bundle.auditLog?.entries || [];
  if (!auditEntries.length) {
    lines.push('_No audit events._');
  } else {
    for (const e of auditEntries) {
      const icon = e.status === 'ok' ? '✅' : e.status === 'error' ? '❌' : '⏳';
      lines.push(`- ${icon} ${e.createdAt} [${e.status}] ${e.action}${e.key ? ` \`${e.key}\`` : ''}${e.message ? ` — ${e.message}` : ''}`);
    }
  }
  lines.push('');

  lines.push(`## HTTP access log tail (${bundle.accessLog?.total ?? 0})`);
  const accessEntries = bundle.accessLog?.entries || [];
  if (!accessEntries.length) {
    lines.push('_No HTTP requests recorded._');
  } else {
    lines.push('| Time | Request ID | Method | Path | Status | Duration |');
    lines.push('|---|---|---|---|---|---|');
    for (const e of accessEntries) {
      lines.push(`| ${e.timestamp || '—'} | ${e.requestId || '—'} | ${e.method || '—'} | ${e.path || '—'} | ${e.statusCode || 0} | ${e.durationMs || 0}ms |`);
    }
  }
  lines.push('');

  lines.push('## Registered routes');
  lines.push(`Total: ${bundle.routes?.length ?? 0}`);
  for (const route of bundle.routes || []) {
    lines.push(`- ${route.method} ${route.route}${route.public ? ' (public)' : ''}`);
  }
  lines.push('');

  lines.push('## Environment');
  if (!bundle.environment?.length) {
    lines.push('_No PERMABRAIN_* variables set._');
  } else {
    for (const name of bundle.environment) {
      lines.push(`- ${name}=[REDACTED]`);
    }
  }
  lines.push('');

  return lines.join('\n') + '\n';
}
