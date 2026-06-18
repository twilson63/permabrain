/**
 * PermaBrain Runtime Metrics
 *
 * In-process counters and summaries for the `permabrain serve` HTTP API.
 * Tracks request volume, HTTP status distribution, publish/attest/peer
 * event counts, errors, and server uptime. Integrates with the existing
 * article/attestation metrics computed from the local cache index.
 *
 * Provides:
 *   - `createRuntimeMetrics()` returns a metrics collector with a singleton
 *     attached to `globalThis` so multiple server restarts in the same process
 *     keep a consistent view.
 *   - `buildMetricsReport()` merges runtime counters with `api.metrics()`.
 *   - `formatPrometheus()` emits a Prometheus-compatible exposition string.
 *
 * Usage:
 *   import { createRuntimeMetrics, buildMetricsReport, formatPrometheus } from './src/metrics-runtime.mjs';
 *   const metrics = createRuntimeMetrics();
 *   metrics.countRequest({ statusCode: 200, method: 'GET', route: '/api/v1/articles' });
 *   metrics.countEvent('publish');
 *   const report = await buildMetricsReport({ runtime: metrics, home });
 */

import { computeMetrics } from './article-metrics.mjs';
import { getEventBus } from './events.mjs';

const GLOBAL_METRICS = Symbol.for('permabrain.metrics.runtime');

function newMetrics() {
  return {
    startedAt: new Date().toISOString(),
    requests: {
      total: 0,
      byStatus: {},
      byMethod: {},
      byRoute: {},
      errors: 0,
      rateLimited: 0
    },
    events: {
      publish: 0,
      attest: 0,
      fork: 0,
      merge: 0,
      import: 0,
      export: 0,
      backup: 0,
      peerPush: 0,
      peerPull: 0,
      threshold: 0,
      other: 0
    },
    peerEvents: {
      pushReceived: 0,
      pullReceived: 0,
      infoRequested: 0
    },
    activeStreams: {
      sse: 0,
      websocket: 0
    }
  };
}

function ensureGlobalMetrics() {
  if (!globalThis[GLOBAL_METRICS]) {
    globalThis[GLOBAL_METRICS] = newMetrics();
  }
  return globalThis[GLOBAL_METRICS];
}

export class RuntimeMetrics {
  constructor(data = ensureGlobalMetrics()) {
    this.data = data;
  }

  countRequest({ statusCode = 0, method = 'GET', route = 'unknown', rateLimited = false, error = false } = {}) {
    const d = this.data;
    d.requests.total++;
    const statusBucket = Math.floor(statusCode / 100) * 100;
    d.requests.byStatus[statusBucket] = (d.requests.byStatus[statusBucket] || 0) + 1;
    d.requests.byMethod[method] = (d.requests.byMethod[method] || 0) + 1;
    d.requests.byRoute[route] = (d.requests.byRoute[route] || 0) + 1;
    if (error || statusCode >= 500) d.requests.errors++;
    if (rateLimited) d.requests.rateLimited++;
  }

  countEvent(name) {
    const d = this.data.events;
    if (name in d) d[name]++;
    else d.other++;
  }

  countPeerEvent(name) {
    const d = this.data.peerEvents;
    if (name in d) d[name]++;
  }

  setActiveStreams({ sse, websocket } = {}) {
    if (sse !== undefined) this.data.activeStreams.sse = sse;
    if (websocket !== undefined) this.data.activeStreams.websocket = websocket;
  }

  reset() {
    this.data = newMetrics();
    globalThis[GLOBAL_METRICS] = this.data;
  }

  snapshot() {
    return JSON.parse(JSON.stringify(this.data));
  }
}

export function createRuntimeMetrics() {
  const metrics = new RuntimeMetrics(ensureGlobalMetrics());
  // Auto-count relevant events from the shared event bus.
  const bus = getEventBus();
  const handler = (event) => {
    if (!event || typeof event !== 'object') return;
    const name = event.name || event.type;
    if (name) metrics.countEvent(name);
  };
  bus.on('event', handler);
  metrics._eventHandler = handler;
  metrics.reset();
  return metrics;
}

export function stopRuntimeMetrics(metrics) {
  if (metrics && metrics._eventHandler) {
    const bus = getEventBus();
    bus.off('event', metrics._eventHandler);
    metrics._eventHandler = null;
  }
}

function sanitizeName(name) {
  return String(name).replace(/[^a-zA-Z0-9_]/g, '_');
}

function prometheusMetric(name, value, labels = {}) {
  const labelStr = Object.entries(labels)
    .map(([k, v]) => `${sanitizeName(k)}="${String(v).replace(/"/g, '\\"')}"`)
    .join(',');
  const line = labelStr ? `${name}{${labelStr}} ${value}` : `${name} ${value}`;
  return line;
}

export function formatPrometheus(report) {
  const lines = [
    '# HELP permabrain_runtime_uptime_seconds Server uptime in seconds',
    '# TYPE permabrain_runtime_uptime_seconds gauge',
    prometheusMetric('permabrain_runtime_uptime_seconds', report.runtime.uptimeSeconds),
    '',
    '# HELP permabrain_runtime_requests_total Total HTTP requests served',
    '# TYPE permabrain_runtime_requests_total counter',
    prometheusMetric('permabrain_runtime_requests_total', report.runtime.requests.total),
    '',
    '# HELP permabrain_runtime_requests_by_status HTTP requests by status code bucket',
    '# TYPE permabrain_runtime_requests_by_status counter'
  ];
  for (const [bucket, count] of Object.entries(report.runtime.requests.byStatus)) {
    lines.push(prometheusMetric('permabrain_runtime_requests_by_status', count, { bucket }));
  }
  lines.push(
    '',
    '# HELP permabrain_runtime_requests_by_method HTTP requests by method',
    '# TYPE permabrain_runtime_requests_by_method counter'
  );
  for (const [method, count] of Object.entries(report.runtime.requests.byMethod)) {
    lines.push(prometheusMetric('permabrain_runtime_requests_by_method', count, { method }));
  }
  lines.push(
    '',
    '# HELP permabrain_runtime_request_errors_total Total server/errors and 5xx responses',
    '# TYPE permabrain_runtime_request_errors_total counter',
    prometheusMetric('permabrain_runtime_request_errors_total', report.runtime.requests.errors),
    '',
    '# HELP permabrain_runtime_rate_limited_total Total 429 rate-limited requests',
    '# TYPE permabrain_runtime_rate_limited_total counter',
    prometheusMetric('permabrain_runtime_rate_limited_total', report.runtime.requests.rateLimited),
    '',
    '# HELP permabrain_runtime_events_total Audit/events processed by type',
    '# TYPE permabrain_runtime_events_total counter'
  );
  for (const [kind, count] of Object.entries(report.runtime.events)) {
    lines.push(prometheusMetric('permabrain_runtime_events_total', count, { kind }));
  }
  lines.push(
    '',
    '# HELP permabrain_runtime_peer_events_total Peer HTTP events received',
    '# TYPE permabrain_runtime_peer_events_total counter'
  );
  for (const [kind, count] of Object.entries(report.runtime.peerEvents)) {
    lines.push(prometheusMetric('permabrain_runtime_peer_events_total', count, { kind }));
  }
  lines.push(
    '',
    '# HELP permabrain_runtime_active_streams Current live stream connections',
    '# TYPE permabrain_runtime_active_streams gauge'
  );
  lines.push(prometheusMetric('permabrain_runtime_active_streams', report.runtime.activeStreams.sse, { transport: 'sse' }));
  lines.push(prometheusMetric('permabrain_runtime_active_streams', report.runtime.activeStreams.websocket, { transport: 'websocket' }));
  lines.push(
    '',
    '# HELP permabrain_articles_total Total indexed articles',
    '# TYPE permabrain_articles_total gauge',
    prometheusMetric('permabrain_articles_total', report.data.totals.articles),
    '',
    '# HELP permabrain_attestations_total Total attestations',
    '# TYPE permabrain_attestations_total gauge',
    prometheusMetric('permabrain_attestations_total', report.data.totals.attestations),
    '',
    '# HELP permabrain_encrypted_articles_total Encrypted/private articles',
    '# TYPE permabrain_encrypted_articles_total gauge',
    prometheusMetric('permabrain_encrypted_articles_total', report.data.totals.encryptedArticles),
    '',
    '# HELP permabrain_public_articles_total Public articles',
    '# TYPE permabrain_public_articles_total gauge',
    prometheusMetric('permabrain_public_articles_total', report.data.totals.publicArticles),
    ''
  );
  return lines.join('\n');
}

export async function buildMetricsReport(options = {}) {
  const runtime = options.runtime ? options.runtime.snapshot() : ensureGlobalMetrics();
  const home = options.home || undefined;
  const data = computeMetrics({ ...(options.filters || {}), home });
  const start = new Date(runtime.startedAt).getTime();
  const now = Date.now();
  const uptimeSeconds = start && start > 0 ? Math.max(0, (now - start) / 1000) : 0;
  return {
    generatedAt: new Date().toISOString(),
    runtime: {
      ...runtime,
      uptimeSeconds,
      uptime: `${Math.floor(uptimeSeconds)}s`
    },
    data,
    format: 'json'
  };
}

export function metricsToMarkdown(report) {
  const lines = [
    '# PermaBrain Runtime Metrics',
    ``,
    `- Generated: ${report.generatedAt}`,
    `- Uptime: ${report.runtime.uptime}`,
    `- Requests served: ${report.runtime.requests.total}`,
    `- Errors: ${report.runtime.requests.errors}`,
    `- Rate-limited: ${report.runtime.requests.rateLimited}`,
    `- Active SSE streams: ${report.runtime.activeStreams.sse}`,
    `- Active WebSocket streams: ${report.runtime.activeStreams.websocket}`,
    ''
  ];
  lines.push('## Event counts');
  for (const [k, v] of Object.entries(report.runtime.events).sort((a, b) => b[1] - a[1])) {
    lines.push(`- ${k}: ${v}`);
  }
  lines.push('', '## Data totals');
  lines.push(`- Articles: ${report.data.totals.articles}`);
  lines.push(`- Attestations: ${report.data.totals.attestations}`);
  lines.push(`- Encrypted articles: ${report.data.totals.encryptedArticles}`);
  lines.push(`- Public articles: ${report.data.totals.publicArticles}`);
  lines.push('');
  return lines.join('\n') + '\n';
}

export function runtimeMetrics() {
  return new RuntimeMetrics(ensureGlobalMetrics());
}
