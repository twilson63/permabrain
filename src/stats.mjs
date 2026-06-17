/**
 * PermaBrain Stats Dashboard
 *
 * Aggregate metrics and dashboard-style overview of the local PermaBrain.
 * Builds on article-metrics.mjs and adds cross-dimensional summaries:
 * unique agents, topics, kinds, consensus score distribution, activity
 * timeline, and attestation/active-window counts.
 *
 * No network calls; safe to run frequently against the local cache.
 */

import { computeMetrics } from './article-metrics.mjs';
import { consensusScore } from './consensus.mjs';
import { loadIndex } from './cache.mjs';
import { getHome } from './config.mjs';

const SCORE_BUCKETS = [
  { label: '0.0-0.2', min: -1, max: 0.2 },
  { label: '0.2-0.4', min: 0.2, max: 0.4 },
  { label: '0.4-0.6', min: 0.4, max: 0.6 },
  { label: '0.6-0.8', min: 0.6, max: 0.8 },
  { label: '0.8-1.0', min: 0.8, max: 1.01 }
];

function bucketForScore(score) {
  for (const bucket of SCORE_BUCKETS) {
    if (score < bucket.max && score >= bucket.min) return bucket.label;
  }
  return SCORE_BUCKETS[SCORE_BUCKETS.length - 1].label;
}

function dateDaysAgo(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

export function computeStats(opts = {}) {
  const home = opts.home || getHome();
  const base = computeMetrics(opts);
  const index = loadIndex(home);
  let articles = Object.values(index.articles || {});
  let allAttestations = Object.values(index.attestations || {}).flat();

  // Apply the same filters as computeMetrics to keep agent/topic counts consistent.
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
  allAttestations = allAttestations.filter((att) => articleKeys.has(att.targetKey));

  // Unique agents and topics
  const agents = new Set();
  for (const a of articles) {
    if (a.authorAgentId) agents.add(a.authorAgentId);
  }
  for (const att of allAttestations) {
    if (att.agentId) agents.add(att.agentId);
  }
  const uniqueAgents = [...agents].sort();

  const topics = [...new Set(articles.map((a) => a.topic).filter(Boolean))].sort();
  const kinds = [...new Set(articles.map((a) => a.kind).filter(Boolean))].sort();

  // Consensus score distribution and averages per article
  const distribution = {};
  for (const bucket of SCORE_BUCKETS) distribution[bucket.label] = 0;
  const attestedArticleScores = [];
  const attestedArticleConsensus = [];

  for (const article of articles) {
    const atts = index.attestations?.[article.key] || [];
    if (!atts.length) {
      distribution[bucketForScore(0)]++;
      continue;
    }
    const scored = consensusScore(atts, { latestArticleId: article.id });
    const score = scored.score;
    distribution[bucketForScore(score)]++;
    attestedArticleScores.push(score);
    attestedArticleConsensus.push({ key: article.key, score: Number(score.toFixed(6)), status: scored.status });
  }

  const sortedScores = attestedArticleScores.slice().sort((a, b) => a - b);
  const averageConsensus = sortedScores.length
    ? sortedScores.reduce((a, b) => a + b, 0) / sortedScores.length
    : 0;
  const medianConsensus = sortedScores.length
    ? sortedScores[Math.floor(sortedScores.length / 2)]
    : 0;

  // Agent contribution counts
  const agentsByArticles = {};
  const agentsByAttestations = {};
  for (const a of articles) {
    if (a.authorAgentId) agentsByArticles[a.authorAgentId] = (agentsByArticles[a.authorAgentId] || 0) + 1;
  }
  for (const att of allAttestations) {
    if (att.agentId) agentsByAttestations[att.agentId] = (agentsByAttestations[att.agentId] || 0) + 1;
  }
  const topAgents = uniqueAgents
    .map((agentId) => ({
      agentId,
      articles: agentsByArticles[agentId] || 0,
      attestations: agentsByAttestations[agentId] || 0,
      total: (agentsByArticles[agentId] || 0) + (agentsByAttestations[agentId] || 0)
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, opts.top || 10);

  // Activity timeline: sorted day array with running totals and per-event-kind counts.
  const eventsByDay = base.activity.eventsByDay || {};
  const timeline = Object.entries(eventsByDay)
    .map(([day, count]) => ({
      day,
      count,
      articles: articles.filter((a) => a.updatedAt?.slice(0, 10) === day).length,
      attestations: allAttestations.filter((a) => a.createdAt?.slice(0, 10) === day).length
    }))
    .sort((a, b) => a.day.localeCompare(b.day));

  let runningTotal = 0;
  for (const day of timeline) {
    runningTotal += day.count;
    day.cumulative = runningTotal;
  }

  // Active windows
  const now = new Date().toISOString();
  const active7d = articles.filter((a) => a.updatedAt && a.updatedAt >= dateDaysAgo(7)).length;
  const active30d = articles.filter((a) => a.updatedAt && a.updatedAt >= dateDaysAgo(30)).length;
  const active90d = articles.filter((a) => a.updatedAt && a.updatedAt >= dateDaysAgo(90)).length;

  const latestArticle = articles.length
    ? articles.slice().sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))[0]
    : null;
  const latestAttestation = allAttestations.length
    ? allAttestations.slice().sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))[0]
    : null;

  return {
    generatedAt: base.generatedAt,
    home: base.home,
    filters: base.filters,
    totals: {
      ...base.totals,
      agentCount: uniqueAgents.length,
      topicCount: topics.length,
      kindCount: kinds.length,
      uniqueAgents,
      topics,
      kinds
    },
    consensus: {
      distribution,
      averageConsensus: Number(averageConsensus.toFixed(6)),
      medianConsensus: Number(medianConsensus.toFixed(6)),
      attestedArticles: attestedArticleConsensus.length,
      unattestedArticles: base.totals.articles - attestedArticleConsensus.length,
      byArticle: attestedArticleConsensus.slice().sort((a, b) => b.score - a.score).slice(0, opts.top || 10)
    },
    agents: {
      total: uniqueAgents.length,
      topAgents,
      byArticles: agentsByArticles,
      byAttestations: agentsByAttestations
    },
    activity: {
      ...base.activity,
      timeline,
      active7d,
      active30d,
      active90d,
      latestArticle: latestArticle
        ? { key: latestArticle.key, title: latestArticle.title, updatedAt: latestArticle.updatedAt }
        : null,
      latestAttestation: latestAttestation
        ? { targetKey: latestAttestation.targetKey, opinion: latestAttestation.opinion, createdAt: latestAttestation.createdAt }
        : null
    },
    articles: base.articles,
    attestations: base.attestations
  };
}

export function statsToMarkdown(report) {
  const lines = [];
  lines.push('# PermaBrain Stats Dashboard');
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
  lines.push(`- Agents: ${t.agentCount}`);
  lines.push(`- Topics: ${t.topicCount}`);
  lines.push(`- Kinds: ${t.kindCount}`);
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

  lines.push('## Agents');
  lines.push(`- Unique agents: ${report.agents.total}`);
  if (report.agents.topAgents.length) {
    lines.push('### Top agents');
    for (const a of report.agents.topAgents) {
      lines.push(`- ${a.agentId}: ${a.articles} articles, ${a.attestations} attestations`);
    }
  }
  lines.push('');

  lines.push('## Consensus');
  lines.push(`- Average consensus score: ${report.consensus.averageConsensus}`);
  lines.push(`- Median consensus score: ${report.consensus.medianConsensus}`);
  lines.push(`- Attested articles: ${report.consensus.attestedArticles}`);
  lines.push('### Score distribution');
  for (const bucket of SCORE_BUCKETS) {
    lines.push(`- ${bucket.label}: ${report.consensus.distribution[bucket.label] || 0}`);
  }
  if (report.consensus.byArticle.length) {
    lines.push('### Top consensus articles');
    for (const a of report.consensus.byArticle) {
      lines.push(`- ${a.key}: score=${a.score}`);
    }
  }
  lines.push('');

  lines.push('## Attestations');
  lines.push(`- Average confidence: ${report.attestations.averageConfidence.toFixed(3)}`);
  for (const [op, n] of Object.entries(report.attestations.byOpinion).sort((a, b) => b[1] - a[1])) {
    lines.push(`- ${op}: ${n}`);
  }
  if (!Object.keys(report.attestations.byOpinion).length) lines.push('(none)');
  lines.push('');

  lines.push('## Activity');
  lines.push(`- First event: ${report.activity.firstEvent || 'n/a'}`);
  lines.push(`- Last event: ${report.activity.lastEvent || 'n/a'}`);
  lines.push(`- Peak day: ${report.activity.peakDay || 'n/a'}`);
  lines.push(`- Active articles: ${report.activity.active7d} (7d), ${report.activity.active30d} (30d), ${report.activity.active90d} (90d)`);
  if (report.activity.latestArticle) {
    lines.push(`- Latest article: ${report.activity.latestArticle.key} at ${report.activity.latestArticle.updatedAt}`);
  }
  if (report.activity.latestAttestation) {
    lines.push(`- Latest attestation: ${report.activity.latestAttestation.opinion} on ${report.activity.latestAttestation.targetKey} at ${report.activity.latestAttestation.createdAt}`);
  }
  if (report.activity.timeline.length) {
    lines.push('### Timeline');
    for (const day of report.activity.timeline.slice(-10)) {
      lines.push(`- ${day.day}: ${day.count} events (${day.articles} articles, ${day.attestations} attestations, cumulative ${day.cumulative})`);
    }
  }
  lines.push('');

  return lines.join('\n') + '\n';
}
