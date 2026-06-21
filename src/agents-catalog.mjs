/**
 * PermaBrain Agents Catalog
 *
 * Discover unique publishing and attesting agents from the local cache index.
 * Aggregates article counts, attestation counts, topics, kinds, latest activity,
 * and an aggregate trust score derived from consensus contributions.
 */

import { loadIndex } from './cache.mjs';
import { getHome } from './config.mjs';
import { consensusScore } from './consensus.mjs';

export function listAgents(opts = {}) {
  const home = opts.home || getHome();
  const index = loadIndex(home);
  const articles = Object.values(index.articles || {});
  const attestationMap = index.attestations || {};
  const allAttestations = Object.values(attestationMap).flat();

  const agents = new Map();

  function ensureAgent(id) {
    if (!id) return null;
    let entry = agents.get(id);
    if (!entry) {
      entry = {
        agentId: id,
        articles: 0,
        uniqueKeys: new Set(),
        attestationsGiven: 0,
        attestationsReceived: 0,
        byKind: {},
        byTopic: {},
        byOpinion: {},
        latestAt: null,
        trustScore: null
      };
      agents.set(id, entry);
    }
    return entry;
  }

  for (const article of articles) {
    const agent = ensureAgent(article.authorAgentId);
    if (!agent) continue;
    agent.articles += 1;
    if (article.key) agent.uniqueKeys.add(article.key);
    const kind = article.kind || 'unknown';
    agent.byKind[kind] = (agent.byKind[kind] || 0) + 1;
    const topic = article.topic || 'unknown';
    agent.byTopic[topic] = (agent.byTopic[topic] || 0) + 1;
    const updatedAt = article.updatedAt || null;
    if (updatedAt && (!agent.latestAt || updatedAt > agent.latestAt)) agent.latestAt = updatedAt;
  }

  for (const attestation of allAttestations) {
    const agent = ensureAgent(attestation.agentId);
    if (!agent) continue;
    agent.attestationsGiven += 1;
    const opinion = attestation.opinion || 'unknown';
    agent.byOpinion[opinion] = (agent.byOpinion[opinion] || 0) + 1;
    const createdAt = attestation.createdAt || null;
    if (createdAt && (!agent.latestAt || createdAt > agent.latestAt)) agent.latestAt = createdAt;

    const targetKey = attestation.targetKey;
    if (targetKey && attestationMap[targetKey]) {
      for (const other of attestationMap[targetKey]) {
        if (other.agentId === targetKey) continue; // not an agent id path; just safety
      }
    }
  }

  // Count attestations received on articles authored by each agent.
  for (const article of articles) {
    if (!article.authorAgentId || !article.key) continue;
    const targetAttestations = attestationMap[article.key] || [];
    const agent = ensureAgent(article.authorAgentId);
    agent.attestationsReceived += targetAttestations.length;
  }

  // Compute per-agent trust score by averaging consensus scores of articles
  // the agent has attested, weighted by confidence. If an agent only publishes,
  // the score reflects the average consensus score of their authored articles.
  for (const agent of agents.values()) {
    const contributedKeys = new Set();
    const scores = [];

    // Authoring score: average consensus on articles this agent wrote.
    for (const article of articles) {
      if (article.authorAgentId !== agent.agentId || !article.key) continue;
      contributedKeys.add(article.key);
      const atts = attestationMap[article.key] || [];
      const { score } = consensusScore(atts);
      scores.push(score);
    }

    // Attesting score: consensus scores on targets this agent attested.
    for (const attestation of allAttestations) {
      if (attestation.agentId !== agent.agentId || !attestation.targetKey) continue;
      contributedKeys.add(attestation.targetKey);
      const atts = attestationMap[attestation.targetKey] || [];
      const { score } = consensusScore(atts);
      scores.push(score);
    }

    if (scores.length) {
      const sum = scores.reduce((a, b) => a + b, 0);
      agent.trustScore = Number((sum / scores.length).toFixed(4));
    }

    agent.uniqueKeys = agent.uniqueKeys.size;
    agent.contributedKeys = contributedKeys.size;
  }

  let rows = [...agents.values()].map((entry) => ({
    agentId: entry.agentId,
    articles: entry.articles,
    uniqueKeys: entry.uniqueKeys,
    contributedKeys: entry.contributedKeys,
    attestationsGiven: entry.attestationsGiven,
    attestationsReceived: entry.attestationsReceived,
    byKind: entry.byKind,
    byTopic: entry.byTopic,
    byOpinion: entry.byOpinion,
    latestAt: entry.latestAt,
    trustScore: entry.trustScore
  }));

  if (opts.kind) {
    rows = rows.filter((r) => r.byKind[opts.kind]);
  }
  if (opts.topic) {
    rows = rows.filter((r) => r.byTopic[opts.topic]);
  }
  if (opts.after) {
    const afterIso = new Date(opts.after).toISOString();
    rows = rows.filter((r) => r.latestAt && r.latestAt >= afterIso);
  }
  if (opts.before) {
    const beforeIso = new Date(opts.before).toISOString();
    rows = rows.filter((r) => r.latestAt && r.latestAt <= beforeIso);
  }
  if (opts.minArticles) {
    const min = Number(opts.minArticles);
    if (!Number.isNaN(min) && min > 0) {
      rows = rows.filter((r) => r.articles >= min);
    }
  }
  if (opts.minAttestations) {
    const min = Number(opts.minAttestations);
    if (!Number.isNaN(min) && min > 0) {
      rows = rows.filter((r) => r.attestationsGiven >= min);
    }
  }
  if (opts.agentId) {
    const needle = String(opts.agentId).toLowerCase();
    rows = rows.filter((r) => r.agentId.toLowerCase().includes(needle));
  }

  const sort = opts.sort || 'articles';
  rows.sort((a, b) => {
    if (sort === 'name') return a.agentId.localeCompare(b.agentId);
    if (sort === 'latest') return (b.latestAt || '').localeCompare(a.latestAt || '');
    if (sort === 'attestations') return b.attestationsGiven - a.attestationsGiven;
    if (sort === 'trust') return (b.trustScore ?? -1) - (a.trustScore ?? -1);
    if (sort === 'keys') return b.uniqueKeys - a.uniqueKeys;
    return b.articles - a.articles;
  });

  if (opts.limit) rows = rows.slice(0, Number(opts.limit));

  return {
    generatedAt: new Date().toISOString(),
    home,
    filters: {
      kind: opts.kind || null,
      topic: opts.topic || null,
      after: opts.after || null,
      before: opts.before || null,
      minArticles: opts.minArticles ? Number(opts.minArticles) : null,
      minAttestations: opts.minAttestations ? Number(opts.minAttestations) : null,
      agentId: opts.agentId || null,
      sort,
      limit: opts.limit ? Number(opts.limit) : null
    },
    totals: {
      agents: rows.length,
      articles: articles.length,
      attestations: allAttestations.length
    },
    agents: rows
  };
}

export function agentsToMarkdown(report) {
  const lines = [];
  lines.push('# PermaBrain Agents');
  lines.push('');
  lines.push(`- Generated: ${report.generatedAt}`);
  lines.push(`- Home: ${report.home || 'n/a'}`);
  if (Object.values(report.filters || {}).some((v) => v !== null && v !== undefined)) {
    lines.push(`- Filters: ${JSON.stringify(report.filters)}`);
  }
  lines.push(`- Agents: ${report.totals.agents}`);
  lines.push(`- Articles: ${report.totals.articles}`);
  lines.push(`- Attestations: ${report.totals.attestations}`);
  lines.push('');

  if (!report.agents?.length) {
    lines.push('No agents found.');
    lines.push('');
    return lines.join('\n') + '\n';
  }

  lines.push('| Agent | Articles | Unique keys | Attestations given | Attestations received | Trust score | Latest | Topics | Kinds |');
  lines.push('|-------|----------|-------------|--------------------|-----------------------|-------------|--------|--------|-------|');
  for (const a of report.agents) {
    const topics = Object.entries(a.byTopic || {}).map(([k, v]) => `${k}:${v}`).join(', ');
    const kinds = Object.entries(a.byKind || {}).map(([k, v]) => `${k}:${v}`).join(', ');
    const trust = a.trustScore !== null && a.trustScore !== undefined ? a.trustScore.toFixed(4) : '—';
    lines.push(`| ${a.agentId} | ${a.articles} | ${a.uniqueKeys} | ${a.attestationsGiven} | ${a.attestationsReceived} | ${trust} | ${a.latestAt ? new Date(a.latestAt).toISOString() : '—'} | ${topics || '—'} | ${kinds || '—'} |`);
  }
  lines.push('');
  return lines.join('\n') + '\n';
}
