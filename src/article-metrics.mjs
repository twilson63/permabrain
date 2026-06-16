/**
 * PermaBrain Article Metrics
 *
 * Aggregate, read-only metrics computed from the local cache index.
 * No network calls by default; safe to run frequently.
 */

import { loadIndex } from './cache.mjs';
import { getHome } from './config.mjs';

export function computeMetrics(opts = {}) {
  const home = opts.home || getHome();
  const index = loadIndex(home);
  let articles = Object.values(index.articles || {});
  const allAttestations = Object.values(index.attestations || {}).flat();

  // Apply filters
  if (opts.kind) articles = articles.filter((a) => a.kind === opts.kind);
  if (opts.topic) articles = articles.filter((a) => a.topic === opts.topic);
  if (opts.author) articles = articles.filter((a) => a.authorAgentId === opts.author);
  if (opts.after) {
    const afterIso = new Date(opts.after).toISOString();
    articles = articles.filter((a) => a.updatedAt && a.updatedAt >= afterIso);
  }
  if (opts.before) {
    const beforeIso = new Date(opts.before).toISOString();
    articles = articles.filter((a) => a.updatedAt && a.updatedAt <= beforeIso);
  }

  const articleKeys = new Set(articles.map((a) => a.key));
  const filteredAttestations = allAttestations.filter((att) => articleKeys.has(att.targetKey));

  const byKind = {};
  const byTopic = {};
  const byAuthor = {};
  const byLanguage = {};
  let encryptedCount = 0;

  for (const a of articles) {
    byKind[a.kind] = (byKind[a.kind] || 0) + 1;
    byTopic[a.topic] = (byTopic[a.topic] || 0) + 1;
    byAuthor[a.authorAgentId || 'unknown'] = (byAuthor[a.authorAgentId || 'unknown'] || 0) + 1;
    byLanguage[a.language || 'unknown'] = (byLanguage[a.language || 'unknown'] || 0) + 1;
    if (a.visibility === 'encrypted' || a.visibility === 'private') encryptedCount++;
  }

  const byOpinion = {};
  let totalConfidence = 0;
  for (const att of filteredAttestations) {
    byOpinion[att.opinion] = (byOpinion[att.opinion] || 0) + 1;
    totalConfidence += Number(att.confidence) || 0;
  }

  const attestedKeys = new Set(filteredAttestations.map((att) => att.targetKey));
  const perTarget = {};
  for (const att of filteredAttestations) {
    perTarget[att.targetKey] = (perTarget[att.targetKey] || 0) + 1;
  }
  const topAttested = Object.entries(perTarget)
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, opts.top || 10);

  const dates = [
    ...articles.map((a) => a.updatedAt).filter(Boolean),
    ...filteredAttestations.map((a) => a.createdAt).filter(Boolean)
  ].sort();
  const firstEvent = dates[0] || null;
  const lastEvent = dates[dates.length - 1] || null;

  const eventsByDay = {};
  for (const d of dates) {
    const day = d.slice(0, 10);
    eventsByDay[day] = (eventsByDay[day] || 0) + 1;
  }
  const peakDay = Object.entries(eventsByDay)
    .sort((a, b) => b[1] - a[1])[0]?.[0] || null;

  const totalVersions = articles.reduce((sum, a) => sum + (Number(a.version) || 1), 0);

  return {
    generatedAt: new Date().toISOString(),
    home,
    filters: {
      kind: opts.kind || null,
      topic: opts.topic || null,
      author: opts.author || null,
      after: opts.after || null,
      before: opts.before || null
    },
    totals: {
      articles: articles.length,
      attestations: filteredAttestations.length,
      attestedArticles: attestedKeys.size,
      unattestedArticles: articles.length - attestedKeys.size,
      encryptedArticles: encryptedCount,
      publicArticles: articles.length - encryptedCount,
      totalVersions,
      averageVersion: articles.length ? totalVersions / articles.length : 0
    },
    articles: {
      byKind,
      byTopic,
      byAuthor,
      byLanguage
    },
    attestations: {
      byOpinion,
      averageConfidence: filteredAttestations.length ? totalConfidence / filteredAttestations.length : 0,
      topAttested,
      perTarget
    },
    activity: {
      firstEvent,
      lastEvent,
      eventsByDay,
      peakDay
    }
  };
}

export function metricsToMarkdown(report) {
  const lines = [];
  lines.push('# PermaBrain Metrics');
  lines.push('');
  lines.push(`- Generated: ${report.generatedAt}`);
  lines.push(`- Home: ${report.home}`);
  if (report.filters.kind || report.filters.topic || report.filters.author || report.filters.after || report.filters.before) {
    lines.push(`- Filters: ${JSON.stringify(report.filters)}`);
  }
  lines.push('');

  const t = report.totals;
  lines.push('## Totals');
  lines.push(`- Articles: ${t.articles}`);
  lines.push(`- Attestations: ${t.attestations}`);
  lines.push(`- Attested articles: ${t.attestedArticles}`);
  lines.push(`- Unattested articles: ${t.unattestedArticles}`);
  lines.push(`- Encrypted articles: ${t.encryptedArticles}`);
  lines.push(`- Public articles: ${t.publicArticles}`);
  lines.push(`- Total versions: ${t.totalVersions}`);
  lines.push(`- Average version: ${t.averageVersion.toFixed(2)}`);
  lines.push('');

  lines.push('## Articles by kind');
  for (const [k, v] of Object.entries(report.articles.byKind).sort((a, b) => b[1] - a[1])) {
    lines.push(`- ${k}: ${v}`);
  }
  if (!Object.keys(report.articles.byKind).length) lines.push('(none)');
  lines.push('');

  lines.push('## Articles by topic');
  for (const [k, v] of Object.entries(report.articles.byTopic).sort((a, b) => b[1] - a[1])) {
    lines.push(`- ${k}: ${v}`);
  }
  if (!Object.keys(report.articles.byTopic).length) lines.push('(none)');
  lines.push('');

  lines.push('## Attestations');
  lines.push(`- Average confidence: ${report.attestations.averageConfidence.toFixed(3)}`);
  for (const [op, n] of Object.entries(report.attestations.byOpinion).sort((a, b) => b[1] - a[1])) {
    lines.push(`- ${op}: ${n}`);
  }
  if (!Object.keys(report.attestations.byOpinion).length) lines.push('(none)');
  lines.push('');

  lines.push('## Top attested articles');
  for (const { key, count } of report.attestations.topAttested) {
    lines.push(`- ${key}: ${count}`);
  }
  if (!report.attestations.topAttested.length) lines.push('(none)');
  lines.push('');

  lines.push('## Activity');
  lines.push(`- First event: ${report.activity.firstEvent || 'n/a'}`);
  lines.push(`- Last event: ${report.activity.lastEvent || 'n/a'}`);
  lines.push(`- Peak day: ${report.activity.peakDay || 'n/a'}`);
  lines.push('');

  return lines.join('\n') + '\n';
}
