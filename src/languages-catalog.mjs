/**
 * PermaBrain Languages Catalog
 *
 * Discover unique article languages from the local cache index with counts,
 * topic/kind/source/agent breakdowns, and recent activity. Read-only and
 * local-first.
 */

import { loadIndex } from './cache.mjs';
import { getHome } from './config.mjs';

export function listLanguages(opts = {}) {
  const home = opts.home || getHome();
  const index = loadIndex(home);
  let summaries = Object.values(index.articles || {});

  if (opts.topic) summaries = summaries.filter((s) => s.topic === opts.topic);
  if (opts.kind) summaries = summaries.filter((s) => s.kind === opts.kind);
  if (opts.source) {
    const needle = String(opts.source).toLowerCase();
    summaries = summaries.filter((s) => (s.sourceName || '').toLowerCase().includes(needle));
  }
  if (opts.agent) {
    const needle = String(opts.agent).toLowerCase();
    summaries = summaries.filter((s) => (s.authorAgentId || '').toLowerCase().includes(needle));
  }
  if (opts.after) {
    const afterIso = new Date(opts.after).toISOString();
    summaries = summaries.filter((s) => s.updatedAt && s.updatedAt >= afterIso);
  }
  if (opts.before) {
    const beforeIso = new Date(opts.before).toISOString();
    summaries = summaries.filter((s) => s.updatedAt && s.updatedAt <= beforeIso);
  }

  const languages = new Map();

  for (const s of summaries) {
    const name = s.language || 'unknown';
    let entry = languages.get(name);
    if (!entry) {
      entry = {
        name,
        count: 0,
        uniqueKeys: new Set(),
        byTopic: {},
        byKind: {},
        bySource: {},
        byAgent: {},
        latestAt: null
      };
      languages.set(name, entry);
    }
    entry.count += 1;
    if (s.key) entry.uniqueKeys.add(s.key);
    const topic = s.topic || 'unknown';
    entry.byTopic[topic] = (entry.byTopic[topic] || 0) + 1;
    const kind = s.kind || 'unknown';
    entry.byKind[kind] = (entry.byKind[kind] || 0) + 1;
    const sourceName = s.sourceName || 'unknown';
    entry.bySource[sourceName] = (entry.bySource[sourceName] || 0) + 1;
    const agentId = s.authorAgentId || 'unknown';
    entry.byAgent[agentId] = (entry.byAgent[agentId] || 0) + 1;
    if (s.updatedAt && (!entry.latestAt || s.updatedAt > entry.latestAt)) entry.latestAt = s.updatedAt;
  }

  let rows = [...languages.values()].map((entry) => ({
    name: entry.name,
    count: entry.count,
    uniqueKeys: entry.uniqueKeys.size,
    byTopic: entry.byTopic,
    byKind: entry.byKind,
    bySource: entry.bySource,
    byAgent: entry.byAgent,
    latestAt: entry.latestAt
  }));

  const sort = opts.sort || 'count';
  rows.sort((a, b) => {
    if (sort === 'name') return a.name.localeCompare(b.name);
    if (sort === 'latest') return (b.latestAt || '').localeCompare(a.latestAt || '');
    if (sort === 'keys') return b.uniqueKeys - a.uniqueKeys;
    return b.count - a.count;
  });

  if (opts.limit) rows = rows.slice(0, Number(opts.limit));

  return {
    generatedAt: new Date().toISOString(),
    home,
    filters: {
      topic: opts.topic || null,
      kind: opts.kind || null,
      source: opts.source || null,
      agent: opts.agent || null,
      after: opts.after || null,
      before: opts.before || null,
      sort,
      limit: opts.limit ? Number(opts.limit) : null
    },
    totals: {
      languages: rows.length,
      articles: summaries.length
    },
    languages: rows
  };
}

export function languagesToMarkdown(report) {
  const lines = [];
  lines.push('# PermaBrain Languages');
  lines.push('');
  lines.push(`- Generated: ${report.generatedAt}`);
  lines.push(`- Home: ${report.home || 'n/a'}`);
  if (Object.values(report.filters || {}).some((v) => v !== null && v !== undefined)) {
    lines.push(`- Filters: ${JSON.stringify(report.filters)}`);
  }
  lines.push(`- Languages: ${report.totals.languages}`);
  lines.push(`- Articles: ${report.totals.articles}`);
  lines.push('');

  if (!report.languages?.length) {
    lines.push('No languages found.');
    lines.push('');
    return lines.join('\n') + '\n';
  }

  lines.push('| Language | Articles | Unique keys | Latest | Topics | Kinds | Sources | Agents |');
  lines.push('|----------|----------|-------------|--------|--------|-------|---------|--------|');
  for (const l of report.languages) {
    const topics = Object.entries(l.byTopic).map(([t, v]) => `${t}:${v}`).join(', ');
    const kinds = Object.entries(l.byKind).map(([k, v]) => `${k}:${v}`).join(', ');
    const sources = Object.entries(l.bySource).map(([s, v]) => `${s}:${v}`).join(', ');
    const agents = Object.entries(l.byAgent).map(([a, v]) => `${a}:${v}`).join(', ');
    lines.push(`| ${l.name} | ${l.count} | ${l.uniqueKeys} | ${l.latestAt || 'n/a'} | ${topics} | ${kinds} | ${sources} | ${agents} |`);
  }
  lines.push('');
  return lines.join('\n') + '\n';
}
