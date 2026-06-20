/**
 * PermaBrain Topics Catalog
 *
 * List unique article topics from the local cache index with counts,
 * kind breakdowns, and recent activity. Read-only and local-first.
 */

import { loadIndex, summarizeArticle } from './cache.mjs';
import { getHome } from './config.mjs';

export function listTopics(opts = {}) {
  const home = opts.home || getHome();
  const index = loadIndex(home);
  let summaries = Object.values(index.articles || {});

  if (opts.kind) summaries = summaries.filter((s) => s.kind === opts.kind);
  if (opts.after) {
    const afterIso = new Date(opts.after).toISOString();
    summaries = summaries.filter((s) => s.updatedAt && s.updatedAt >= afterIso);
  }
  if (opts.before) {
    const beforeIso = new Date(opts.before).toISOString();
    summaries = summaries.filter((s) => s.updatedAt && s.updatedAt <= beforeIso);
  }

  const topics = new Map();
  for (const s of summaries) {
    const name = s.topic || 'unknown';
    let entry = topics.get(name);
    if (!entry) {
      entry = {
        name,
        count: 0,
        byKind: {},
        byLanguage: {},
        latestAt: null,
        keys: new Set()
      };
      topics.set(name, entry);
    }
    entry.count += 1;
    entry.byKind[s.kind] = (entry.byKind[s.kind] || 0) + 1;
    entry.byLanguage[s.language || 'unknown'] = (entry.byLanguage[s.language || 'unknown'] || 0) + 1;
    if (s.updatedAt && (!entry.latestAt || s.updatedAt > entry.latestAt)) entry.latestAt = s.updatedAt;
    entry.keys.add(s.key);
  }

  let rows = [...topics.values()].map((entry) => ({
    name: entry.name,
    count: entry.count,
    uniqueKeys: entry.keys.size,
    byKind: entry.byKind,
    byLanguage: entry.byLanguage,
    latestAt: entry.latestAt
  }));

  const sort = opts.sort || 'count';
  rows.sort((a, b) => {
    if (sort === 'name') return a.name.localeCompare(b.name);
    if (sort === 'latest') return (b.latestAt || '').localeCompare(a.latestAt || '');
    return b.count - a.count;
  });

  if (opts.limit) rows = rows.slice(0, Number(opts.limit));

  return {
    generatedAt: new Date().toISOString(),
    home,
    filters: {
      kind: opts.kind || null,
      after: opts.after || null,
      before: opts.before || null,
      sort,
      limit: opts.limit ? Number(opts.limit) : null
    },
    totals: {
      topics: rows.length,
      articles: summaries.length
    },
    topics: rows
  };
}

export function topicsToMarkdown(report) {
  const lines = [];
  lines.push('# PermaBrain Topics');
  lines.push('');
  lines.push(`- Generated: ${report.generatedAt}`);
  lines.push(`- Home: ${report.home}`);
  if (report.filters.kind || report.filters.after || report.filters.before) {
    lines.push(`- Filters: ${JSON.stringify(report.filters)}`);
  }
  lines.push(`- Topics: ${report.totals.topics}`);
  lines.push(`- Articles: ${report.totals.articles}`);
  lines.push('');

  if (!report.topics.length) {
    lines.push('No topics found.');
    lines.push('');
    return lines.join('\n') + '\n';
  }

  lines.push('| Topic | Articles | Unique keys | Latest | Kinds | Languages |');
  lines.push('|-------|----------|-------------|--------|-------|-----------|');
  for (const t of report.topics) {
    const kinds = Object.entries(t.byKind).map(([k, v]) => `${k}:${v}`).join(', ');
    const languages = Object.entries(t.byLanguage).map(([l, v]) => `${l}:${v}`).join(', ');
    lines.push(`| ${t.name} | ${t.count} | ${t.uniqueKeys} | ${t.latestAt || 'n/a'} | ${kinds} | ${languages} |`);
  }
  lines.push('');
  return lines.join('\n') + '\n';
}
