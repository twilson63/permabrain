/**
 * PermaBrain Web Dashboard
 *
 * Generates a self-contained HTML snapshot of local PermaBrain state:
 *   - article directory with search/filter
 *   - stats / metrics overview
 *   - activity feed timeline
 *   - audit log tail
 *   - transport / identity status
 *
 * The HTML is a single file with no external dependencies (CSS and JS are
 * embedded inline). It can be opened in a browser, written to disk, or
 * published to ZenBin via the agent API.
 */

import fs from 'node:fs';
import path from 'node:path';
import { getHome, loadConfig } from './config.mjs';
import { loadIdentity, publicIdentity } from './keys.mjs';
import { computeStats } from './stats.mjs';
import { listArticles } from './list.mjs';
import { activityFeed } from './activity.mjs';
import { tailLog } from './log.mjs';

const DEFAULT_LIMIT = 50;
const DEFAULT_ACTIVITY_LIMIT = 50;
const DEFAULT_LOG_LIMIT = 25;

export async function buildDashboard(opts = {}) {
  const home = opts.home || getHome();
  let config;
  try { config = opts.config || loadConfig(home); } catch { config = {}; }
  let identity;
  try { identity = loadIdentity(home); } catch { identity = null; }

  const [stats, list, activity, log] = await Promise.all([
    computeStats({ ...opts, home }),
    listArticles({
      home,
      config,
      limit: opts.articleLimit ?? DEFAULT_LIMIT,
      sort: opts.sort || 'date',
      kind: opts.kind,
      topic: opts.topic,
      author: opts.author,
      after: opts.after,
      before: opts.before,
      useHyperbeam: opts.useHyperbeam ?? false
    }),
    activityFeed({
      home,
      config,
      limit: opts.activityLimit ?? DEFAULT_ACTIVITY_LIMIT,
      order: opts.order || 'desc',
      kind: opts.kind,
      topic: opts.topic,
      key: opts.key,
      agent: opts.agent,
      after: opts.after,
      before: opts.before,
      useHyperbeam: opts.useHyperbeam ?? false
    }),
    tailLog({ home, limit: opts.logLimit ?? DEFAULT_LOG_LIMIT })
  ]);

  const generatedAt = new Date().toISOString();
  const publicId = identity ? publicIdentity(identity) : null;

  return {
    generatedAt,
    home,
    agentId: publicId?.agentId || 'unknown',
    keyType: publicId?.type || 'unknown',
    transport: config.transport || 'local',
    stats,
    list,
    activity,
    log,
    filters: {
      kind: opts.kind || null,
      topic: opts.topic || null,
      author: opts.author || null,
      after: opts.after || null,
      before: opts.before || null,
      key: opts.key || null,
      agent: opts.agent || null,
      sort: opts.sort || 'date',
      order: opts.order || 'desc'
    }
  };
}

export function dashboardToHtml(data, opts = {}) {
  const title = opts.title || `PermaBrain Dashboard — ${data.agentId}`;
  const jsonData = JSON.stringify(data).replace(/</g, '\\u003c');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
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
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; }
    .card {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 1rem;
    }
    .card h3 { margin: 0 0 .75rem; font-size: .75rem; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); }
    .metric { font-size: 2rem; font-weight: 700; }
    .metric small { display: block; font-size: .75rem; color: var(--muted); font-weight: 400; margin-top: .25rem; }
    .filters {
      display: flex; flex-wrap: wrap; gap: .75rem; align-items: end;
      background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius);
      padding: 1rem; margin: 1rem 0;
    }
    .filters label { display: flex; flex-direction: column; gap: .25rem; font-size: .75rem; color: var(--muted); }
    .filters input, .filters select {
      background: var(--panel-2); color: var(--text); border: 1px solid var(--border);
      border-radius: 6px; padding: .4rem .5rem; font-size: .875rem;
    }
    .filters button {
      background: var(--accent); color: #fff; border: 0; border-radius: 6px;
      padding: .5rem .9rem; font-weight: 600; cursor: pointer;
    }
    .filters button:hover { opacity: .9; }
    table { width: 100%; border-collapse: collapse; font-size: .875rem; }
    th, td { padding: .6rem .5rem; border-bottom: 1px solid var(--border); text-align: left; }
    th { color: var(--muted); font-weight: 600; font-size: .75rem; text-transform: uppercase; letter-spacing: .05em; }
    tr:hover td { background: rgba(255,255,255,.03); }
    .pill {
      display: inline-block; padding: .15rem .4rem; border-radius: 999px; font-size: .7rem;
      background: var(--panel-2); border: 1px solid var(--border);
    }
    .pill.encrypted { color: var(--warn); border-color: var(--warn); }
    .pill.ok { color: var(--accent-2); border-color: var(--accent-2); }
    .timeline { list-style: none; padding: 0; margin: 0; }
    .timeline li { display: flex; gap: .75rem; padding: .6rem 0; border-bottom: 1px solid var(--border); }
    .timeline .ts { color: var(--muted); font-family: var(--mono); font-size: .8rem; white-space: nowrap; }
    .timeline .badge { font-size: .65rem; text-transform: uppercase; padding: .1rem .35rem; border-radius: 4px; background: var(--panel-2); }
    .empty { color: var(--muted); font-style: italic; padding: 1rem 0; }
    .muted { color: var(--muted); }
    .section-title { margin: 2rem 0 .75rem; font-size: 1.1rem; }
    .search { margin-bottom: .75rem; }
    .search input { width: 100%; max-width: 360px; }
    .tabbar { display: flex; gap: .25rem; margin-bottom: .75rem; }
    .tabbar button {
      background: var(--panel); border: 1px solid var(--border); color: var(--text);
      padding: .4rem .75rem; border-radius: 6px; cursor: pointer;
    }
    .tabbar button.active { background: var(--accent); color: #fff; border-color: var(--accent); }
    .hidden { display: none; }
    code, pre { font-family: var(--mono); }
    .footer { color: var(--muted); font-size: .75rem; margin-top: 2rem; padding-top: 1rem; border-top: 1px solid var(--border); }
  </style>
</head>
<body>
  <header>
    <h1>🧠 PermaBrain Dashboard</h1>
    <div class="meta">
      <span id="agent">${escapeHtml(data.agentId)}</span> ·
      <span id="transport">${escapeHtml(data.transport)}</span> ·
      generated <span id="generated">${escapeHtml(data.generatedAt)}</span>
    </div>
  </header>
  <main class="wrap">
    <div class="grid" id="stats-grid"></div>

    <div class="filters">
      <label>Search
        <input type="text" id="search" placeholder="key, title, topic...">
      </label>
      <label>Topic
        <input type="text" id="topic-filter" placeholder="any" value="${escapeHtml(data.filters.topic || '')}">
      </label>
      <label>Kind
        <select id="kind-filter"><option value="">any</option></select>
      </label>
      <label>Sort
        <select id="sort-select">
          <option value="date">date</option>
          <option value="title">title</option>
          <option value="consensus">consensus</option>
          <option value="attestations">attestations</option>
        </select>
      </label>
      <button id="refresh-btn">Refresh view</button>
    </div>

    <div class="tabbar">
      <button class="active" data-tab="articles">Articles (${data.list.total})</button>
      <button data-tab="activity">Activity (${data.activity.total})</button>
      <button data-tab="audit">Audit log (${data.log.total})</button>
      <button data-tab="stats">Stats JSON</button>
    </div>

    <section id="articles-tab">
      <h2 class="section-title">Articles</h2>
      <div class="search"><input type="text" id="article-search" placeholder="Filter articles by key, title, topic, author..."></div>
      <div id="articles-table"></div>
      <p class="muted">Showing <span id="showing">0</span> of ${data.list.total}</p>
    </section>

    <section id="activity-tab" class="hidden">
      <h2 class="section-title">Activity feed</h2>
      <ul class="timeline" id="activity-list"></ul>
    </section>

    <section id="audit-tab" class="hidden">
      <h2 class="section-title">Audit log</h2>
      <ul class="timeline" id="audit-list"></ul>
    </section>

    <section id="stats-tab" class="hidden">
      <h2 class="section-title">Stats JSON</h2>
      <pre id="stats-json" style="background:var(--panel);padding:1rem;border-radius:var(--radius);overflow:auto;"></pre>
    </section>

    <div class="footer">
      Snapshot of <code>${escapeHtml(data.home)}</code>. This page is static and reflects state at generation time.
    </div>
  </main>

  <script>
    const DATA = ${jsonData};
    const $ = (s) => document.querySelector(s);

    function fmtDate(ts) {
      if (!ts) return '—';
      try { return new Date(ts).toLocaleString(); } catch { return ts; }
    }

    function renderStats() {
      const t = DATA.stats.totals;
      const c = DATA.stats.consensus;
      const a = DATA.stats.activity;
      const rows = [
        ['Articles', t.articles, 'Total published'],
        ['Attestations', t.attestations, 'Across all targets'],
        ['Agents', t.agentCount, 'Unique authors + attestors'],
        ['Topics', t.topicCount, 'Distinct topics'],
        ['Avg consensus', c.averageConsensus.toFixed(3), 'Mean score'],
        ['Active 7d', a.active7d, 'Articles updated'],
        ['Active 30d', a.active30d, 'Articles updated'],
        ['Active 90d', a.active90d, 'Articles updated']
      ];
      $('#stats-grid').innerHTML = rows.map(function(row) {
        const k = row[0], v = row[1], sub = row[2];
        return '<div class="card"><h3>' + k + '</h3><div class="metric">' + v + '<small>' + sub + '</small></div></div>';
      }).join('');
    }

    function renderKinds() {
      const sel = $('#kind-filter');
      const kinds = [...new Set(DATA.list.articles.map(function(a){ return a.kind; }).filter(Boolean))].sort();
      sel.innerHTML = '<option value="">any</option>' + kinds.map(function(k){ return '<option value="' + k + '">' + k + '</option>'; }).join('');
    }

    function consensusClass(status) {
      if (!status || status === 'no-attestations') return '';
      if (status.indexOf('valid') !== -1) return 'ok';
      return 'warn';
    }

    function renderArticles(items) {
      if (!items.length) return $('#articles-table').innerHTML = '<p class="empty">No articles found.</p>';
      const rows = items.map(function(a) {
        const enc = a.encrypted ? '<span class="pill encrypted">encrypted</span>' : '';
        const statusPill = a.consensus && a.consensus.status ? '<span class="pill ' + consensusClass(a.consensus.status) + '">' + a.consensus.status + '</span>' : '';
        return '<tr>' +
          '<td><code>' + a.key + '</code> ' + enc + ' ' + statusPill + '</td>' +
          '<td>' + (a.title || '(untitled)') + '</td>' +
          '<td>' + (a.kind || '—') + '</td>' +
          '<td>' + (a.topic || '—') + '</td>' +
          '<td>' + (a.authorAgentId || '—') + '</td>' +
          '<td>' + fmtDate(a.updatedAt) + '</td>' +
          '<td>' + (a.attestationCount || 0) + '</td>' +
          '<td>' + (a.consensus && a.consensus.score != null ? a.consensus.score.toFixed(3) : '—') + '</td>' +
          '</tr>';
      }).join('');
      $('#articles-table').innerHTML = '<table><thead><tr><th>Key</th><th>Title</th><th>Kind</th><th>Topic</th><th>Author</th><th>Updated</th><th>Attests</th><th>Score</th></tr></thead><tbody>' + rows + '</tbody></table>';
      $('#showing').textContent = items.length;
    }

    function renderActivity() {
      const list = DATA.activity.events;
      if (!list.length) return $('#activity-list').innerHTML = '<li class="empty">No activity events.</li>';
      $('#activity-list').innerHTML = list.map(function(e) {
        let text = e.kind === 'publish' ? (e.key + ' v' + e.version + ' by ' + e.agentId) :
          e.kind === 'attest' ? (e.targetKey + ': ' + e.opinion + ' (' + e.confidence + ') by ' + e.agentId) :
          e.kind === 'fork' ? (e.sourceKey + ' → ' + e.key) :
          e.kind === 'merge' ? (e.sourceKey + ' → ' + e.key + (e.hasConflicts ? ' ⚠ conflicts' : '')) : (e.key || e.targetKey || '—');
        return '<li><span class="ts">' + fmtDate(e.timestamp || e.createdAt) + '</span><span class="badge">' + e.kind + '</span><span>' + text + '</span></li>';
      }).join('');
    }

    function renderAudit() {
      const list = DATA.log.entries;
      if (!list.length) return $('#audit-list').innerHTML = '<li class="empty">No audit events.</li>';
      $('#audit-list').innerHTML = list.map(function(e) {
        const icon = e.status === 'ok' ? '✅' : e.status === 'error' ? '❌' : '⏳';
        return '<li><span class="ts">' + fmtDate(e.createdAt) + '</span><span>' + icon + ' ' + e.action + (e.key ? ' <code>' + e.key + '</code>' : '') + (e.message ? ' — ' + e.message : '') + '</span></li>';
      }).join('');
    }

    function renderStatsJson() {
      $('#stats-json').textContent = JSON.stringify(DATA.stats, null, 2);
    }

    function filterArticles() {
      const q = ($('#article-search').value || '').toLowerCase();
      const topic = ($('#topic-filter').value || '').toLowerCase();
      const kind = $('#kind-filter').value;
      let items = DATA.list.articles.filter(function(a) {
        if (kind && a.kind !== kind) return false;
        if (topic && (a.topic || '').toLowerCase() !== topic) return false;
        if (!q) return true;
        const hay = [a.key, a.title, a.topic, a.authorAgentId, a.sourceName].join(' ').toLowerCase();
        return hay.indexOf(q) !== -1;
      });
      const sort = $('#sort-select').value;
      if (sort === 'title') items.sort(function(a, b){ return (a.title || '').localeCompare(b.title || ''); });
      if (sort === 'consensus') items.sort(function(a, b){ return (b.consensus && b.consensus.score || 0) - (a.consensus && a.consensus.score || 0); });
      if (sort === 'attestations') items.sort(function(a, b){ return (b.attestationCount || 0) - (a.attestationCount || 0); });
      if (sort === 'date') items.sort(function(a, b){ return String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')); });
      renderArticles(items);
    }

    function switchTab(tab) {
      document.querySelectorAll('.tabbar button').forEach(function(b){ b.classList.toggle('active', b.dataset.tab === tab); });
      ['articles','activity','audit','stats'].forEach(function(id){ $('#' + id + '-tab').classList.toggle('hidden', id !== tab); });
      if (tab === 'stats') renderStatsJson();
    }

    document.querySelectorAll('.tabbar button').forEach(function(b) {
      b.addEventListener('click', function(){ switchTab(b.dataset.tab); });
    });

    $('#refresh-btn').addEventListener('click', function() {
      const params = new URLSearchParams(window.location.search);
      params.set('topic', $('#topic-filter').value);
      params.set('kind', $('#kind-filter').value);
      params.set('sort', $('#sort-select').value);
      window.location.search = params.toString();
    });

    $('#article-search').addEventListener('input', filterArticles);
    $('#topic-filter').addEventListener('input', filterArticles);
    $('#kind-filter').addEventListener('change', filterArticles);
    $('#sort-select').addEventListener('change', filterArticles);
    $('#sort-select').value = DATA.filters.sort || 'date';

    renderStats();
    renderKinds();
    filterArticles();
    renderActivity();
    renderAudit();
    switchTab('articles');
  </script>
</body>
</html>`;
}

export async function writeDashboard(data, opts = {}) {
  const output = opts.output || opts.file;
  if (!output) throw new Error('output path is required');
  const html = dashboardToHtml(data, opts);
  fs.writeFileSync(output, html, 'utf8');
  return { path: path.resolve(output), bytes: Buffer.byteLength(html, 'utf8') };
}

export function dashboardToMarkdown(data, opts = {}) {
  const lines = [];
  lines.push('# PermaBrain Dashboard');
  lines.push('');
  lines.push(`- Agent: ${data.agentId}`);
  lines.push(`- Transport: ${data.transport}`);
  lines.push(`- Generated: ${data.generatedAt}`);
  lines.push(`- Home: ${data.home}`);
  if (Object.values(data.filters).some(Boolean)) {
    lines.push(`- Filters: ${JSON.stringify(data.filters)}`);
  }
  lines.push('');
  const t = data.stats.totals;
  lines.push('## Snapshot');
  lines.push(`- Articles: ${t.articles}`);
  lines.push(`- Attestations: ${t.attestations}`);
  lines.push(`- Agents: ${t.agentCount}`);
  lines.push(`- Topics: ${t.topicCount}`);
  lines.push(`- Avg consensus: ${data.stats.consensus.averageConsensus.toFixed(3)}`);
  lines.push(`- Active 7/30/90d: ${data.stats.activity.active7d} / ${data.stats.activity.active30d} / ${data.stats.activity.active90d}`);
  lines.push('');
  lines.push(`## Articles (${data.list.total})`);
  for (const a of data.list.articles) {
    const enc = a.encrypted ? ' 🔒' : '';
    lines.push(`- ${a.title || '(untitled)'}${enc}`);
    lines.push(`  - \`${a.key}\` · ${a.kind || '—'} · ${a.topic || '—'} · attestations ${a.attestationCount || 0} · score ${a.consensus?.score != null ? a.consensus.score.toFixed(3) : '—'}`);
  }
  lines.push('');
  lines.push(`## Activity (${data.activity.total})`);
  for (const e of data.activity.events.slice(0, 10)) {
    const ts = e.timestamp || e.createdAt;
    lines.push(`- ${e.kind}: ${e.key || e.targetKey || '—'} at ${ts || 'unknown'}`);
  }
  lines.push('');
  lines.push(`## Audit log (${data.log.total})`);
  for (const e of data.log.entries.slice(0, 10)) {
    lines.push(`- ${e.createdAt} [${e.status}] ${e.action}${e.key ? ` ${e.key}` : ''}`);
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
