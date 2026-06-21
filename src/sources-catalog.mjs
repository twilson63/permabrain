/**
 * PermaBrain Sources Catalog
 *
 * Discover unique article sources (source name + URL) from the local cache
 * index. Aggregates article counts, kind/topic/language breakdowns, and
 * latest activity. Read-only and local-first.
 */

import { loadIndex } from './cache.mjs';
import { getHome } from './config.mjs';

export function listSources(opts = {}) {
  const home = opts.home || getHome();
  const index = loadIndex(home);
  let summaries = Object.values(index.articles || {});

  if (opts.kind) summaries = summaries.filter((s) => s.kind === opts.kind);
  if (opts.topic) summaries = summaries.filter((s) => s.topic === opts.topic);
  if (opts.after) {
    const afterIso = new Date(opts.after).toISOString();
    summaries = summaries.filter((s) => s.updatedAt && s.updatedAt >= afterIso);
  }
  if (opts.before) {
    const beforeIso = new Date(opts.before).toISOString();
    summaries = summaries.filter((s) => s.updatedAt && s.updatedAt <= beforeIso);
  }

  const sources = new Map();

  for (const s of summaries) {
    const name = s.sourceName || 'unknown';
    const url = s.sourceUrl || null;
    const key = url || name;
    let entry = sources.get(key);
    if (!entry) {
      entry = {
        name,
        url,
        count: 0,
        uniqueKeys: new Set(),
        byKind: {},
        byTopic: {},
        byLanguage: {},
        byAgent: {},
        latestAt: null
      };
      sources.set(key, entry);
    }
    entry.count += 1;
    entry.byKind[s.kind] = (entry.byKind[s.kind] || 0) + 1;
    entry.byTopic[s.topic || 'unknown'] = (entry.byTopic[s.topic || 'unknown'] || 0) + 1;
    entry.byLanguage[s.language || 'unknown'] = (entry.byLanguage[s.language || 'unknown'] || 0) + 1;
    entry.byAgent[s.authorAgentId || 'unknown'] = (entry.byAgent[s.authorAgentId || 'unknown'] || 0) + 1;
    if (s.updatedAt && (!entry.latestAt || s.updatedAt > entry.latestAt)) entry.latestAt = s.updatedAt;
    if (s.key) entry.uniqueKeys.add(s.key);
  }

  let rows = [...sources.values()].map((entry) => ({
    name: entry.name,
    url: entry.url,
    count: entry.count,
    uniqueKeys: entry.uniqueKeys.size,
    byKind: entry.byKind,
    byTopic: entry.byTopic,
    byLanguage: entry.byLanguage,
    byAgent: entry.byAgent,
    latestAt: entry.latestAt
  }));

  if (opts.name) {
    const needle = String(opts.name).toLowerCase();
    rows = rows.filter((r) => r.name.toLowerCase().includes(needle));
  }
  if (opts.url) {
    const needle = String(opts.url).toLowerCase();
    rows = rows.filter((r) => (r.url || '').toLowerCase().includes(needle));
  }
  if (opts.agentId) {
    const needle = String(opts.agentId).toLowerCase();
    rows = rows.filter((r) => Object.keys(r.byAgent).some((a) => a.toLowerCase().includes(needle)));
  }

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
      kind: opts.kind || null,
      topic: opts.topic || null,
      name: opts.name || null,
      url: opts.url || null,
      agentId: opts.agentId || null,
      after: opts.after || null,
      before: opts.before || null,
      sort,
      limit: opts.limit ? Number(opts.limit) : null
    },
    totals: {
      sources: rows.length,
      articles: summaries.length
    },
    sources: rows
  };
}

export function sourcesToMarkdown(report) {
  const lines = [];
  lines.push('# PermaBrain Sources');
  lines.push('');
  lines.push(`- Generated: ${report.generatedAt}`);
  lines.push(`- Home: ${report.home || 'n/a'}`);
  if (Object.values(report.filters || {}).some((v) => v !== null && v !== undefined)) {
    lines.push(`- Filters: ${JSON.stringify(report.filters)}`);
  }
  lines.push(`- Sources: ${report.totals.sources}`);
  lines.push(`- Articles: ${report.totals.articles}`);
  lines.push('');

  if (!report.sources?.length) {
    lines.push('No sources found.');
    lines.push('');
    return lines.join('\n') + '\n';
  }

  lines.push('| Source | Articles | Unique keys | Latest | Kinds | Topics | Languages |');
  lines.push('|--------|----------|-------------|--------|-------|--------|-----------|');
  for (const s of report.sources) {
    const name = s.url ? `[${s.name}](${s.url})` : s.name;
    const kinds = Object.entries(s.byKind).map(([k, v]) => `${k}:${v}`).join(', ');
    const topics = Object.entries(s.byTopic).map(([k, v]) => `${k}:${v}`).join(', ');
    const languages = Object.entries(s.byLanguage).map(([k, v]) => `${k}:${v}`).join(', ');
    lines.push(`| ${name} | ${s.count} | ${s.uniqueKeys} | ${s.latestAt || 'n/a'} | ${kinds} | ${topics} | ${languages} |`);
  }
  lines.push('');
  return lines.join('\n') + '\n';
}
