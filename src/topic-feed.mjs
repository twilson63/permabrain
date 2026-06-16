/**
 * PermaBrain Topic Feed
 *
 * Query articles and attestations for a topic, sort by date or consensus,
 * filter by agent/language, and output JSON or markdown list.
 *
 * Feed strategy:
 *   1. Query the transport for article items tagged with the topic.
 *   2. Merge with local cache to pick up any locally cached versions.
 *   3. Optionally fetch attestations for each article and include consensus.
 *   4. Sort by the requested criterion (date desc, consensus score, title).
 *   5. Return a structured feed with article summaries + attestation stats.
 */

import { getHome, loadConfig } from './config.mjs';
import { getTransport } from './transport.mjs';
import { latestByArticleKey, loadIndex, summarizeArticle, summarizeAttestation } from './cache.mjs';
import { tagsToObject } from './tags.mjs';
import { consensusScore } from './consensus.mjs';
import { isEncryptedEnvelope } from './crypto.mjs';

const DEFAULT_LIMIT = 50;

export async function topicFeed(topic, opts = {}) {
  if (!topic) throw new Error('topic is required');
  const home = opts.home || getHome();
  let config = opts.config;
  if (!config) {
    try {
      config = loadConfig(home);
    } catch {
      config = {};
    }
  }
  const transport = opts.transport || getTransport(config, home, { useHyperbeam: opts.useHyperbeam });

  const filters = {
    'App-Name': 'PermaBrain',
    'PermaBrain-Type': 'article',
    'Article-Topic': topic
  };
  if (opts.kind) filters['Article-Kind'] = opts.kind;
  if (opts.language) filters['Article-Language'] = opts.language;

  const items = await transport.queryByTags(filters);
  const remoteLatest = [...latestByArticleKey(items).values()];

  const localIndex = loadIndex(home);
  const byKey = new Map();
  for (const item of remoteLatest) {
    const summary = summarizeArticle(item);
    if (!summary.key) continue;
    byKey.set(summary.key, { summary, item });
  }
  for (const summary of Object.values(localIndex.articles || {})) {
    if (!summary.key || byKey.has(summary.key)) continue;
    if (summary.topic !== topic) continue;
    if (opts.kind && summary.kind !== opts.kind) continue;
    if (opts.language && summary.language !== opts.language) continue;
    byKey.set(summary.key, { summary, item: null });
  }

  let entries = [...byKey.values()];

  // Agent filter: keep only articles by this agent, or articles with
  // attestations by this agent when opts.agent === 'attested-by:<agentId>'.
  if (opts.agent) {
    if (opts.agent.startsWith('attested-by:')) {
      const agentId = opts.agent.slice('attested-by:'.length);
      const withAttestation = await filterAttestedBy(entries, agentId, transport, home);
      entries = withAttestation;
    } else {
      entries = entries.filter((e) => e.summary.authorAgentId === opts.agent);
    }
  }

  // Optionally enrich with attestations/consensus
  let consensusByKey = {};
  if (opts.includeAttestations !== false) {
    const attestationItems = await transport.queryByTags({
      'App-Name': 'PermaBrain',
      'PermaBrain-Type': 'attestation'
    });
    const attestationsByKey = {};
    for (const item of attestationItems) {
      const tags = tagsToObject(item.tags || []);
      const targetKey = tags['Attestation-Target-Key'];
      if (!targetKey) continue;
      if (!attestationsByKey[targetKey]) attestationsByKey[targetKey] = [];
      attestationsByKey[targetKey].push(summarizeAttestation(item));
    }

    for (const entry of entries) {
      const atts = (attestationsByKey[entry.summary.key] || localIndex.attestations?.[entry.summary.key] || []);
      const scored = consensusScore(atts, { latestArticleId: entry.summary.id });
      consensusByKey[entry.summary.key] = {
        score: Number(scored.score.toFixed(6)),
        status: scored.status,
        totalAttestations: atts.length,
        latestOpinion: atts[0]?.opinion || null,
        latestConfidence: atts[0]?.confidence || null
      };
    }
  }

  // Build feed rows
  let rows = entries.map((entry) => {
    const { summary, item } = entry;
    const consensus = consensusByKey[summary.key];
    let encrypted = false;
    if (item?.data != null) {
      const raw = typeof item.data === 'string' ? Buffer.from(item.data, 'base64url').toString('utf8') : item.data.toString('utf8');
      encrypted = isEncryptedEnvelope(raw);
    }
    return {
      id: summary.id,
      key: summary.key,
      title: summary.title,
      kind: summary.kind,
      topic: summary.topic,
      language: summary.language,
      version: summary.version,
      sourceName: summary.sourceName,
      sourceUrl: summary.sourceUrl,
      authorAgentId: summary.authorAgentId,
      updatedAt: summary.updatedAt,
      contentHash: summary.contentHash,
      encrypted,
      consensus
    };
  });

  // Sorting
  const sort = opts.sort || 'date';
  if (sort === 'date' || sort === 'updated') {
    rows.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  } else if (sort === 'consensus') {
    rows.sort((a, b) => (b.consensus?.score || 0) - (a.consensus?.score || 0));
  } else if (sort === 'title') {
    rows.sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')));
  } else if (sort === 'attestations') {
    rows.sort((a, b) => (b.consensus?.totalAttestations || 0) - (a.consensus?.totalAttestations || 0));
  }

  const limit = Math.max(1, Number(opts.limit || DEFAULT_LIMIT));
  const offset = Math.max(0, Number(opts.offset || 0));
  const page = rows.slice(offset, offset + limit);

  return {
    topic,
    sort,
    filters: {
      kind: opts.kind || null,
      language: opts.language || null,
      agent: opts.agent || null
    },
    total: rows.length,
    limit,
    offset,
    articles: page,
    took: new Date().toISOString()
  };
}

async function filterAttestedBy(entries, agentId, transport, home) {
  const attestationItems = await transport.queryByTags({
    'App-Name': 'PermaBrain',
    'PermaBrain-Type': 'attestation',
    'Attestation-Agent-Id': agentId
  });
  const attestedKeys = new Set();
  for (const item of attestationItems) {
    const tags = tagsToObject(item.tags || []);
    const targetKey = tags['Attestation-Target-Key'];
    if (targetKey) attestedKeys.add(targetKey);
  }
  // Also include locally cached attestations by this agent
  const localIndex = loadIndex(home);
  for (const [targetKey, atts] of Object.entries(localIndex.attestations || {})) {
    if (atts.some((a) => a.agentId === agentId)) attestedKeys.add(targetKey);
  }
  return entries.filter((e) => attestedKeys.has(e.summary.key));
}

export function feedToMarkdown(feed) {
  const lines = [];
  lines.push(`# PermaBrain Topic Feed: ${feed.topic}`);
  lines.push('');
  const filters = [
    feed.filters.kind && `kind: ${feed.filters.kind}`,
    feed.filters.language && `language: ${feed.filters.language}`,
    feed.filters.agent && `agent: ${feed.filters.agent}`
  ].filter(Boolean);
  if (filters.length) {
    lines.push(`Filters: ${filters.join(', ')}`);
    lines.push('');
  }
  lines.push(`Sort: ${feed.sort} · ${feed.total} article(s) · showing ${feed.articles.length}`);
  lines.push('');
  for (const article of feed.articles) {
    const title = article.title || '(untitled)';
    const meta = [
      `v${article.version}`,
      article.kind,
      article.language,
      article.sourceName,
      article.updatedAt ? new Date(article.updatedAt).toISOString().slice(0, 10) : ''
    ].filter(Boolean).join(' · ');
    const encryptedFlag = article.encrypted ? ' 🔒' : '';
    lines.push(`- [${title}](${article.sourceUrl || '#'})${encryptedFlag}`);
    lines.push(`  - Key: \`${article.key}\` · ${meta}`);
    if (article.consensus) {
      lines.push(`  - Consensus: ${article.consensus.status} score=${article.consensus.score} (${article.consensus.totalAttestations} attestation${article.consensus.totalAttestations === 1 ? '' : 's'})`);
    }
  }
  return lines.join('\n') + '\n';
}
