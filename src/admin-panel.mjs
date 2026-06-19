/**
 * PermaBrain Admin / Monitoring Panel
 *
 * Consolidated, read-only admin snapshot for `permabrain serve`.
 * Aggregates:
 *   - runtime metrics (JSON or Prometheus)
 *   - recent HTTP access-log entries (memory or disk)
 *   - recent audit-log entries
 *   - identity / transport / stream metadata
 *
 * Provides a JSON endpoint helper, a self-contained HTML renderer, and a
 * markdown renderer. All data is assembled by reusing existing APIs and
 * logging utilities; this module does not mutate state or introduce separate
 * logging.
 */

import { loadIdentity, publicIdentity } from './keys.mjs';
import { getHome, loadConfig } from './config.mjs';
import { tailLog } from './log.mjs';
import { requestLogger } from './request-log.mjs';
import { buildMetricsReport, formatPrometheus, runtimeMetrics } from './metrics-runtime.mjs';

const DEFAULT_METRICS_LIMIT = 10;
const DEFAULT_ACCESS_LOG_LIMIT = 25;
const DEFAULT_AUDIT_LOG_LIMIT = 25;

export async function buildAdminPanel(opts = {}) {
  const home = opts.home || getHome();
  let config;
  try { config = opts.config || loadConfig(home); } catch { config = {}; }
  let identity;
  try { identity = loadIdentity(home); } catch { identity = null; }

  const metrics = await buildMetricsReport({
    runtime: opts.runtimeMetrics || runtimeMetrics(),
    home,
    filters: opts.metricsFilters || {}
  });

  const accessLogLimit = opts.accessLogLimit ?? DEFAULT_ACCESS_LOG_LIMIT;
  const logger = requestLogger({ format: 'none', home });
  const accessLog = logger.diskEnabled
    ? await logger.queryDisk({ limit: accessLogLimit, offset: 0 })
    : logger.getRecentRequests({ limit: accessLogLimit, offset: 0 });

  const auditLog = tailLog({ home, limit: opts.auditLogLimit ?? DEFAULT_AUDIT_LOG_LIMIT });

  const generatedAt = new Date().toISOString();
  const publicId = identity ? publicIdentity(identity) : null;

  return {
    generatedAt,
    home,
    agentId: publicId?.agentId || 'unknown',
    keyType: publicId?.type || 'unknown',
    transport: config.transport || 'local',
    streams: {
      websocket: '/api/v1/events/ws',
      sse: '/api/v1/events/stream',
      articles: '/api/v1/articles/stream',
      requests: '/api/v1/log/requests/stream'
    },
    metrics,
    accessLog,
    auditLog,
    links: {
      dashboard: '/api/v1/dashboard.html',
      metrics: '/api/v1/metrics',
      stats: '/api/v1/stats',
      requests: '/api/v1/log/requests',
      audit: '/api/v1/log',
      health: '/health',
      routes: '/api/v1/routes'
    }
  };
}

export function adminPanelToHtml(data, opts = {}) {
  const title = escapeHtml(opts.title || `PermaBrain Admin — ${data.agentId}`);
  const jsonData = JSON.stringify(data).replace(/</g, '\\u003c');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    :root {
      --bg: #0d1117;
      --panel: #161b22;
      --panel-2: #1c2128;
      --border: #30363d;
      --text: #c9d1d9;
      --muted: #8b949e;
      --accent: #58a6ff;
      --accent-2: #238636;
      --warn: #d29922;
      --danger: #f85149;
      --radius: 8px;
      --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
      line-height: 1.5;
    }
    header {
      background: var(--panel);
      border-bottom: 1px solid var(--border);
      padding: 1.25rem 1.5rem;
      position: sticky;
      top: 0;
      z-index: 10;
    }
    header h1 { margin: 0 0 .25rem; font-size: 1.4rem; }
    header .meta { color: var(--muted); font-size: .875rem; }
    .wrap { max-width: 1200px; margin: 0 auto; padding: 1.5rem; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; }
    .card {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 1rem;
    }
    .card h3 { margin: 0 0 .75rem; font-size: .75rem; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); }
    .metric { font-size: 1.8rem; font-weight: 700; }
    .metric small { display: block; font-size: .75rem; color: var(--muted); font-weight: 400; margin-top: .25rem; }
    .section {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 1rem;
      margin: 1rem 0;
    }
    .section h2 { margin: 0 0 .75rem; font-size: 1.1rem; border-bottom: 1px solid var(--border); padding-bottom: .5rem; }
    table { width: 100%; border-collapse: collapse; font-size: .875rem; }
    th, td { padding: .6rem .5rem; border-bottom: 1px solid var(--border); text-align: left; }
    th { color: var(--muted); font-weight: 600; font-size: .75rem; text-transform: uppercase; letter-spacing: .05em; }
    tr:hover td { background: rgba(255,255,255,.03); }
    .pill {
      display: inline-block; padding: .15rem .4rem; border-radius: 999px; font-size: .7rem;
      background: var(--panel-2); border: 1px solid var(--border);
    }
    .pill.ok { color: var(--accent-2); border-color: var(--accent-2); }
    .pill.error { color: var(--danger); border-color: var(--danger); }
    .muted { color: var(--muted); }
    .empty { color: var(--muted); font-style: italic; padding: 1rem 0; }
    .mono { font-family: var(--mono); }
    .links { display: flex; flex-wrap: wrap; gap: .5rem; margin-top: .5rem; }
    .links a { color: var(--accent); text-decoration: none; font-size: .85rem; }
    .links a:hover { text-decoration: underline; }
    pre {
      background: var(--panel-2);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 1rem;
      overflow: auto;
      font-size: .8rem;
      max-height: 360px;
    }
    .status-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: .75rem; }
    .footer { color: var(--muted); font-size: .75rem; margin-top: 2rem; padding-top: 1rem; border-top: 1px solid var(--border); }
    .live-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--accent-2); margin-right: .35rem; }
  </style>
</head>
<body>
  <header>
    <h1>🛡️ PermaBrain Admin</h1>
    <div class="meta">
      <span id="agent">${escapeHtml(data.agentId)}</span> ·
      <span id="transport">${escapeHtml(data.transport)}</span> ·
      generated <span id="generated">${escapeHtml(data.generatedAt)}</span>
    </div>
  </header>
  <main class="wrap">
    <div class="grid" id="status-grid"></div>

    <div class="section">
      <h2>Live metrics</h2>
      <div class="grid" id="metrics-grid"></div>
      <p class="muted">Uptime: <span id="uptime"></span> · Requests served: <span id="requests-total"></span> · Errors: <span id="errors"></span></p>
    </div>

    <div class="section">
      <h2>Recent HTTP access log</h2>
      <p class="muted">Last ${data.accessLog.entries.length} entries (disk-persisted, sensitive headers redacted)</p>
      <div id="access-log-table"></div>
    </div>

    <div class="section">
      <h2>Audit log tail</h2>
      <p class="muted">Last ${data.auditLog.entries.length} local audit events</p>
      <div id="audit-log-list"></div>
    </div>

    <div class="section">
      <h2>JSON snapshot</h2>
      <pre id="json-snapshot"></pre>
    </div>

    <div class="footer">
      Read-only panel for <code>${escapeHtml(data.home)}</code>. No state mutation through this view.
    </div>
  </main>

  <script>
    const DATA = ${jsonData};
    const $ = (s) => document.querySelector(s);

    function fmtDate(ts) {
      if (!ts) return '—';
      try { return new Date(ts).toLocaleString(); } catch { return ts; }
    }

    function renderStatus() {
      const rows = [
        ['Agent', DATA.agentId],
        ['Transport', DATA.transport],
        ['Key type', DATA.keyType],
        ['Generated', fmtDate(DATA.generatedAt)]
      ];
      $('#status-grid').innerHTML = rows.map(function(row) {
        return '<div class="card"><h3>' + row[0] + '</h3><div class="metric mono">' + escapeHtml(String(row[1])) + '</div></div>';
      }).join('');
    }

    function renderMetrics() {
      const r = DATA.metrics.runtime;
      const d = DATA.metrics.data.totals;
      const rows = [
        ['Uptime', r.uptime],
        ['Requests', r.requests.total],
        ['Errors', r.requests.errors],
        ['Rate-limited', r.requests.rateLimited],
        ['SSE clients', r.activeStreams.sse],
        ['WS clients', r.activeStreams.websocket],
        ['Articles', d.articles],
        ['Attestations', d.attestations]
      ];
      $('#metrics-grid').innerHTML = rows.map(function(row) {
        return '<div class="card"><h3>' + row[0] + '</h3><div class="metric">' + row[1] + '</div></div>';
      }).join('');
      $('#uptime').textContent = r.uptime;
      $('#requests-total').textContent = r.requests.total;
      $('#errors').textContent = r.requests.errors;
    }

    function renderAccessLog() {
      const entries = DATA.accessLog.entries;
      if (!entries.length) {
        $('#access-log-table').innerHTML = '<p class="empty">No requests recorded.</p>';
        return;
      }
      const rows = entries.map(function(e) {
        return '<tr>' +
          '<td class="mono">' + (e.timestamp || '—') + '</td>' +
          '<td class="mono">' + (e.requestId || '—') + '</td>' +
          '<td>' + (e.method || '—') + '</td>' +
          '<td class="mono">' + escapeHtml(e.path || '—') + '</td>' +
          '<td>' + (e.statusCode || 0) + '</td>' +
          '<td>' + (e.durationMs || 0) + 'ms</td>' +
          '</tr>';
      }).join('');
      $('#access-log-table').innerHTML = '<table><thead><tr><th>Time</th><th>Request ID</th><th>Method</th><th>Path</th><th>Status</th><th>Duration</th></tr></thead><tbody>' + rows + '</tbody></table>';
    }

    function renderAuditLog() {
      const entries = DATA.auditLog.entries;
      if (!entries.length) {
        $('#audit-log-list').innerHTML = '<p class="empty">No audit events.</p>';
        return;
      }
      $('#audit-log-list').innerHTML = entries.map(function(e) {
        const icon = e.status === 'ok' ? '✅' : e.status === 'error' ? '❌' : '⏳';
        return '<div class="activity-row">' +
          '<span class="mono muted">' + fmtDate(e.createdAt) + '</span>' +
          '<span class="pill ' + (e.status === 'ok' ? 'ok' : e.status === 'error' ? 'error' : '') + '">' + e.status + '</span>' +
          '<span><strong>' + e.action + '</strong>' + (e.key ? ' <code>' + escapeHtml(e.key) + '</code>' : '') + (e.message ? ' — ' + escapeHtml(e.message) : '') + '</span>' +
          '</div>';
      }).join('');
    }

    function escapeHtml(str) {
      if (str === undefined || str === null) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    $('#json-snapshot').textContent = JSON.stringify(DATA, null, 2);
    renderStatus();
    renderMetrics();
    renderAccessLog();
    renderAuditLog();
  </script>
</body>
</html>`;
}

export function adminPanelToMarkdown(data, opts = {}) {
  const lines = [];
  lines.push('# PermaBrain Admin / Monitoring');
  lines.push('');
  lines.push(`- Agent: ${data.agentId}`);
  lines.push(`- Transport: ${data.transport}`);
  lines.push(`- Generated: ${data.generatedAt}`);
  lines.push(`- Home: ${data.home}`);
  lines.push('');

  const r = data.metrics.runtime;
  lines.push('## Runtime metrics');
  lines.push(`- Uptime: ${r.uptime}`);
  lines.push(`- Requests served: ${r.requests.total}`);
  lines.push(`- Errors: ${r.requests.errors}`);
  lines.push(`- Rate-limited: ${r.requests.rateLimited}`);
  lines.push(`- Active SSE streams: ${r.activeStreams.sse}`);
  lines.push(`- Active WebSocket streams: ${r.activeStreams.websocket}`);
  lines.push('');

  const total = data.metrics.data.totals;
  lines.push('## Data totals');
  lines.push(`- Articles: ${total.articles}`);
  lines.push(`- Attestations: ${total.attestations}`);
  lines.push(`- Encrypted articles: ${total.encryptedArticles}`);
  lines.push(`- Public articles: ${total.publicArticles}`);
  lines.push('');

  lines.push(`## Recent HTTP access log (${data.accessLog.total})`);
  if (!data.accessLog.entries.length) {
    lines.push('_No requests recorded._');
  } else {
    lines.push('| Time | Request ID | Method | Path | Status | Duration |');
    lines.push('|---|---|---|---|---|---|');
    for (const e of data.accessLog.entries) {
      lines.push(`| ${e.timestamp || '—'} | ${e.requestId || '—'} | ${e.method || '—'} | ${e.path || '—'} | ${e.statusCode || 0} | ${e.durationMs || 0}ms |`);
    }
  }
  lines.push('');

  lines.push(`## Audit log tail (${data.auditLog.total})`);
  if (!data.auditLog.entries.length) {
    lines.push('_No audit events._');
  } else {
    for (const e of data.auditLog.entries) {
      const icon = e.status === 'ok' ? '✅' : e.status === 'error' ? '❌' : '⏳';
      lines.push(`- ${icon} ${e.createdAt} [${e.status}] ${e.action}${e.key ? ` \`${e.key}\`` : ''}${e.message ? ` — ${e.message}` : ''}`);
    }
  }
  lines.push('');
  return lines.join('\n') + '\n';
}

function escapeHtml(str) {
  if (str === undefined || str === null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
