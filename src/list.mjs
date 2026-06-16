/**
 * PermaBrain List Command
 *
 * Read-only paginated directory of articles in the local cache (and, for
 * transport-aware listings, the remote transport). Supports filters,
 * sorting by date/title/consensus/attestations, JSON/markdown output, and
 * attestation/activity counts per article.
 */

import { getHome, loadConfig } from './config.mjs';
import { getTransport } from './transport.mjs';
import { latestByArticleKey, loadIndex, summarizeArticle } from './cache.mjs';
import { tagsToObject } from './tags.mjs';
import { consensusScore } from './consensus.mjs';
import { isEncryptedEnvelope } from './crypto.mjs';

const DEFAULT_LIMIT = 50;

export async function listArticles(opts = {}) {
  const home = opts.home || getHome();
  let config;
  try {
    config = opts.config || loadConfig(home);
  } catch {
    config = {};
  }
  const transport = opts.transport || getTransport(config, home, { useHyperbeam: opts.useHyperbeam });

  // Gather article summaries from transport and local cache.
  const filters = {
    'App-Name': 'PermaBrain',
    'PermaBrain-Type': 'article'
  };
  if (opts.kind) filters['Article-Kind'] = opts.kind;
  if (opts.topic) filters['Article-Topic'] = opts.topic;
  if (opts.author) filters['Author-Agent-Id'] = opts.author;

  const remoteItems = await transport.queryByTags(filters).catch(() => []);
  const remoteArray = Array.isArray(remoteItems) ? remoteItems : (remoteItems.items || []);

  const byKey = new Map();
  for (const item of remoteArray) {
    const summary = summarizeArticle(item);
    if (!summary.key) continue;
    byKey.set(summary.key, { summary, item });
  }

  const localIndex = loadIndex(home);
  for (const summary of Object.values(localIndex.articles || {})) {
    if (!summary.key || byKey.has(summary.key)) continue;
    if (!matchesFilters(summary, opts)) continue;
    byKey.set(summary.key, { summary, item: null });
  }

  let entries = [...byKey.values()];

  // Attestation counts and consensus from transport + local cache.
  const attestationItems = await transport.queryByTags({
    'App-Name': 'PermaBrain',
    'PermaBrain-Type': 'attestation'
  }).catch(() => []);
  const attArray = Array.isArray(attestationItems) ? attestationItems : (attestationItems.items || []);

  const attestationsByKey = {};
  for (const item of attArray) {
    const tags = tagsToObject(item.tags || []);
    const targetKey = tags['Attestation-Target-Key'];
    if (!targetKey) continue;
    if (!attestationsByKey[targetKey]) attestationsByKey[targetKey] = [];
    attestationsByKey[targetKey].push(item);
  }
  for (const [targetKey, atts] of Object.entries(localIndex.attestations || {})) {
    const existing = attestationsByKey[targetKey] || [];
    const seen = new Set(existing.map((i) => i.id || JSON.stringify(i)));
    for (const att of atts) {
      if (!seen.has(att.id)) {
        existing.push(att); // use full summary object
        seen.add(att.id);
      }
    }
    attestationsByKey[targetKey] = existing;
  }

  // Activity counts: publish/attest/fork/merge events are all keyed by article.
  const activityCountsByKey = {};
  for (const item of attArray) {
    const tags = tagsToObject(item.tags || []);
    const key = tags['Attestation-Target-Key'];
    if (!key) continue;
    if (!activityCountsByKey[key]) activityCountsByKey[key] = { publish: 0, attest: 0, fork: 0, merge: 0 };
    activityCountsByKey[key].attest++;
  }

  // Remote article items already scanned: count publish/fork/merge events.
  for (const item of remoteArray) {
    const tags = tagsToObject(item.tags || []);
    const key = tags['Article-Key'];
    if (!key) continue;
    if (!activityCountsByKey[key]) activityCountsByKey[key] = { publish: 0, attest: 0, fork: 0, merge: 0 };
    activityCountsByKey[key].publish++;
    if (tags['Article-Fork-Of']) activityCountsByKey[key].fork++;
    if (tags['Article-Merge-Source-Key']) activityCountsByKey[key].merge++;
  }

  // Build rows with counts.
  let rows = entries.map((entry) => {
    const { summary, item } = entry;
    const atts = attestationsByKey[summary.key] || [];
    const localAtts = localIndex.attestations?.[summary.key] || [];
    const mergedAtts = mergeAttestationLists(atts, localAtts);
    const scored = mergedAtts.length ? consensusScore(mergedAtts, { latestArticleId: summary.id }) : { score: 0, status: 'no-attestations' };
    const activity = activityCountsByKey[summary.key] || { publish: 0, attest: 0, fork: 0, merge: 0 };

    let encrypted = false;
    if (item?.data != null) {
      const raw = typeof item.data === 'string'
        ? Buffer.from(item.data, 'base64url').toString('utf8')
        : item.data.toString('utf8');
      encrypted = isEncryptedEnvelope(raw);
    } else if (item?.payloadBase64) {
      const raw = Buffer.from(item.payloadBase64, 'base64url').toString('utf8');
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
      attestationCount: mergedAtts.length,
      consensus: {
        score: Number(scored.score.toFixed(6)),
        status: scored.status
      },
      activity: {
        publish: activity.publish,
        attest: activity.attest,
        fork: activity.fork,
        merge: activity.merge
      }
    };
  });

  // Apply date range filters.
  if (opts.after) {
    rows = rows.filter((r) => r.updatedAt && String(r.updatedAt) >= String(opts.after));
  }
  if (opts.before) {
    rows = rows.filter((r) => r.updatedAt && String(r.updatedAt) <= String(opts.before));
  }

  // Sorting.
  const sort = opts.sort || 'date';
  if (sort === 'date' || sort === 'updated') {
    rows.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  } else if (sort === 'title') {
    rows.sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')));
  } else if (sort === 'consensus') {
    rows.sort((a, b) => {
      const d = (b.consensus?.score || 0) - (a.consensus?.score || 0);
      if (d !== 0) return d;
      return String(a.key || '').localeCompare(String(b.key || ''));
    });
  } else if (sort === 'attestations') {
    rows.sort((a, b) => {
      const d = (b.attestationCount || 0) - (a.attestationCount || 0);
      if (d !== 0) return d;
      return String(a.key || '').localeCompare(String(b.key || ''));
    });
  } else if (sort === 'key') {
    rows.sort((a, b) => String(a.key || '').localeCompare(String(b.key || '')));
  }

  const limit = Math.max(1, Number(opts.limit || DEFAULT_LIMIT));
  const offset = Math.max(0, Number(opts.offset || 0));
  const page = rows.slice(offset, offset + limit);

  return {
    total: rows.length,
    limit,
    offset,
    sort,
    filters: buildFilterSummary(opts),
    articles: page,
    took: new Date().toISOString()
  };
}

function mergeAttestationLists(remoteAtts, localAtts) {
  const seen = new Set();
  const merged = [];
  for (const att of remoteAtts) {
    const id = att.id || JSON.stringify(att);
    if (seen.has(id)) continue;
    seen.add(id);
    merged.push(att);
  }
  for (const att of localAtts) {
    const id = att.id || JSON.stringify(att);
    if (seen.has(id)) continue;
    seen.add(id);
    merged.push(att);
  }
  return merged;
}

function matchesFilters(summary, opts) {
  if (opts.kind && summary.kind !== opts.kind) return false;
  if (opts.topic && summary.topic !== opts.topic) return false;
  if (opts.author && summary.authorAgentId !== opts.author) return false;
  if (opts.after && summary.updatedAt && String(summary.updatedAt) < String(opts.after)) return false;
  if (opts.before && summary.updatedAt && String(summary.updatedAt) > String(opts.before)) return false;
  return true;
}

function buildFilterSummary(opts) {
  return {
    kind: opts.kind || null,
    topic: opts.topic || null,
    author: opts.author || null,
    after: opts.after || null,
    before: opts.before || null
  };
}

export function listToMarkdown(list) {
  const lines = [];
  lines.push('# PermaBrain Article Directory');
  lines.push('');
  const filters = [
    list.filters.kind && `kind: ${list.filters.kind}`,
    list.filters.topic && `topic: ${list.filters.topic}`,
    list.filters.author && `author: ${list.filters.author}`,
    list.filters.after && `after: ${list.filters.after}`,
    list.filters.before && `before: ${list.filters.before}`
  ].filter(Boolean);
  if (filters.length) {
    lines.push(`Filters: ${filters.join(', ')}`);
    lines.push('');
  }
  lines.push(`Sort: ${list.sort} · ${list.total} article(s) · showing ${list.articles.length}`);
  lines.push('');
  for (const article of list.articles) {
    const title = article.title || '(untitled)';
    const encryptedFlag = article.encrypted ? ' 🔒' : '';
    const meta = [
      `v${article.version}`,
      article.kind,
      article.topic,
      article.sourceName,
      article.updatedAt ? new Date(article.updatedAt).toISOString().slice(0, 10) : ''
    ].filter(Boolean).join(' · ');
    lines.push(`- [${title}](${article.sourceUrl || '#'})${encryptedFlag}`);
    lines.push(`  - Key: \`${article.key}\` · ${meta}`);
    lines.push(`  - Attestations: ${article.attestationCount} · Consensus: ${article.consensus.status} score=${article.consensus.score}`);
  }
  return lines.join('\n') + '\n';
}
