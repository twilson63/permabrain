/**
 * PermaBrain Kinds Catalog
 *
 * Discover unique article kinds from the local cache index with counts,
 * topic/language/source breakdowns, and recent activity. Read-only and
 * local-first.
 */

import { loadIndex } from './cache.mjs';
import { getHome } from './config.mjs';

export function listKinds(opts = {}) {
  const home = opts.home || getHome();
  const index = loadIndex(home);
  let summaries = Object.values(index.articles || {});

  if (opts.topic) summaries = summaries.filter((s) => s.topic === opts.topic);
  if (opts.after) {
    const afterIso = new Date(opts.after).toISOString();
    summaries = summaries.filter((s) => s.updatedAt && s.updatedAt >= afterIso);
  }
  if (opts.before) {
    const beforeIso = new Date(opts.before).toISOString();
    summaries = summaries.filter((s) => s.updatedAt && s.updatedAt <= beforeIso);
  }

  const kinds = new Map();

  for (const s of summaries) {
    const name = s.kind || 'unknown';
    let entry = kinds.get(name);
    if (!entry) {
      entry = {
        name,
        count: 0,
        uniqueKeys: new Set(),
        byTopic: {},
        byLanguage: {},
        bySource: {},
        byAgent: {},
        latestAt: null
      };
      kinds.set(name, entry);
    }
    entry.count += 1;
    if (s.key) entry.uniqueKeys.add(s.key);
    const topic = s.topic || 'unknown';
    entry.byTopic[topic] = (entry.byTopic[topic] || 0) + 1;
    const language = s.language || 'unknown';
    entry.byLanguage[language] = (entry.byLanguage[language] || 0) + 1;
    const sourceName = s.sourceName || 'unknown';
    entry.bySource[sourceName] = (entry.bySource[sourceName] || 0) + 1;
    const agentId = s.authorAgentId || 'unknown';
    entry.byAgent[agentId] = (entry.byAgent[agentId] || 0) + 1;
    if (s.updatedAt && (!entry.latestAt || s.updatedAt > entry.latestAt)) entry.latestAt = s.updatedAt;
  }

  let rows = [...kinds.values()].map((entry) => ({
    name: entry.name,
    count: entry.count,
    uniqueKeys: entry.uniqueKeys.size,
    byTopic: entry.byTopic,
    byLanguage: entry.byLanguage,
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
      after: opts.after || null,
      before: opts.before || null,
      sort,
      limit: opts.limit ? Number(opts.limit) : null
    },
    totals: {
      kinds: rows.length,
      articles: summaries.length
    },
    kinds: rows
  };
}

export function kindsToMarkdown(report) {
  const lines = [];
  lines.push('# PermaBrain Kinds');
  lines.push('');
  lines.push(`- Generated: ${report.generatedAt}`);
  lines.push(`- Home: ${report.home || 'n/a'}`);
  if (Object.values(report.filters || {}).some((v) => v !== null && v !== undefined)) {
    lines.push(`- Filters: ${JSON.stringify(report.filters)}`);
  }
  lines.push(`- Kinds: ${report.totals.kinds}`);
  lines.push(`- Articles: ${report.totals.articles}`);
  lines.push('');

  if (!report.kinds?.length) {
    lines.push('No kinds found.');
    lines.push('');
    return lines.join('\n') + '\n';
  }

  lines.push('| Kind | Articles | Unique keys | Latest | Topics | Languages | Sources | Agents |');
  lines.push('|------|----------|-------------|--------|--------|-----------|---------|--------|');
  for (const k of report.kinds) {
    const topics = Object.entries(k.byTopic).map(([t, v]) => `${t}:${v}`).join(', ');
    const languages = Object.entries(k.byLanguage).map(([l, v]) => `${l}:${v}`).join(', ');
    const sources = Object.entries(k.bySource).map(([s, v]) => `${s}:${v}`).join(', ');
    const agents = Object.entries(k.byAgent).map(([a, v]) => `${a}:${v}`).join(', ');
    lines.push(`| ${k.name} | ${k.count} | ${k.uniqueKeys} | ${k.latestAt || 'n/a'} | ${topics} | ${languages} | ${sources} | ${agents} |`);
  }
  lines.push('');
  return lines.join('\n') + '\n';
}
