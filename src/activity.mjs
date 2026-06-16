/**
 * PermaBrain Activity Feed
 *
 * Build a chronological activity stream from articles, attestations, forks,
 * and merges across the configured transport and local cache. Supports
 * filtering by agent, topic, kind, key, event kind, and date range. Outputs
 * JSON or a markdown timeline.
 *
 * Event kinds:
 *   - publish: new article version published
 *   - attest: attestation cast against an article
 *   - fork: article forked into a new key
 *   - merge: fork merged back into a target key
 *
 * Strategy:
 *   1. Query PermaBrain items from the transport (articles + attestations).
 *   2. Merge with the local cache index to capture unpublished/local items.
 *   3. Build normalized activity events from tags.
 *   4. Apply filters (kind, agent, topic, key, etc.).
 *   5. Sort by timestamp descending (or ascending with opts.order = 'asc').
 *   6. Paginate and return.
 */

import { getHome, loadConfig } from './config.mjs';
import { getTransport } from './transport.mjs';
import { loadIndex, summarizeArticle, summarizeAttestation } from './cache.mjs';
import { tagsToObject } from './tags.mjs';

const DEFAULT_LIMIT = 100;

export async function activityFeed(opts = {}) {
  const home = opts.home || getHome();
  let config;
  try {
    config = opts.config || loadConfig(home);
  } catch {
    config = {};
  }
  const transport = opts.transport || getTransport(config, home, { useHyperbeam: opts.useHyperbeam });

  const events = [];

  // Articles (publish/fork/merge events)
  const articleFilters = {
    'App-Name': 'PermaBrain',
    'PermaBrain-Type': 'article'
  };
  if (opts.topic) articleFilters['Article-Topic'] = opts.topic;
  if (opts.kind) articleFilters['Article-Kind'] = opts.kind;
  if (opts.key) articleFilters['Article-Key'] = opts.key;

  const articleItems = await transport.queryByTags(articleFilters);
  for (const item of articleItems) {
    const event = articleEvent(item);
    if (event) events.push(event);
  }

  // Attestations
  const attestationFilters = {
    'App-Name': 'PermaBrain',
    'PermaBrain-Type': 'attestation'
  };
  if (opts.key) attestationFilters['Attestation-Target-Key'] = opts.key;

  const attestationItems = await transport.queryByTags(attestationFilters);
  for (const item of attestationItems) {
    const event = attestationEvent(item);
    if (event) events.push(event);
  }

  // Merge in local cache entries that transport may not know about.
  const localIndex = loadIndex(home);
  for (const summary of Object.values(localIndex.articles || {})) {
    if (opts.topic && summary.topic !== opts.topic) continue;
    if (opts.kind && summary.kind !== opts.kind) continue;
    if (opts.key && summary.key !== opts.key) continue;
    if (events.some((e) => e.id === summary.id)) continue;
    events.push(localArticleEvent(summary));
  }
  for (const [targetKey, atts] of Object.entries(localIndex.attestations || {})) {
    if (opts.key && targetKey !== opts.key) continue;
    for (const att of atts) {
      if (events.some((e) => e.id === att.id)) continue;
      events.push(localAttestationEvent(att));
    }
  }

  // Apply filters.
  let filtered = events;
  if (opts.kind === 'article') {
    // If the user passes kind=article as a metadata filter, don't confuse it with event kind.
    // opts.kind here is the article kind; event kind filter is opts.eventKind.
  }
  if (opts.eventKind) {
    const kinds = Array.isArray(opts.eventKind) ? opts.eventKind : [opts.eventKind];
    filtered = filtered.filter((e) => kinds.includes(e.kind));
  }
  if (opts.agent) {
    const agents = Array.isArray(opts.agent) ? opts.agent : [opts.agent];
    filtered = filtered.filter((e) => agents.includes(e.agentId));
  }
  if (opts.author) {
    const authors = Array.isArray(opts.author) ? opts.author : [opts.author];
    filtered = filtered.filter((e) => e.kind === 'publish' && authors.includes(e.agentId));
  }
  if (opts.attestedBy) {
    const agents = Array.isArray(opts.attestedBy) ? opts.attestedBy : [opts.attestedBy];
    filtered = filtered.filter((e) => (e.kind === 'attest' || e.kind === 'merge' || e.kind === 'fork') && agents.includes(e.agentId));
  }
  if (opts.after) {
    const after = String(opts.after);
    filtered = filtered.filter((e) => String(e.timestamp || e.createdAt) >= after);
  }
  if (opts.before) {
    const before = String(opts.before);
    filtered = filtered.filter((e) => String(e.timestamp || e.createdAt) <= before);
  }
  if (opts.key && !articleFilters['Article-Key'] && !attestationFilters['Attestation-Target-Key']) {
    filtered = filtered.filter((e) => e.key === opts.key || e.targetKey === opts.key);
  }
  if (opts.topic && !articleFilters['Article-Topic']) {
    filtered = filtered.filter((e) => e.topic === opts.topic);
  }

  // Sort.
  const order = opts.order === 'asc' ? 1 : -1;
  filtered.sort((a, b) => {
    const ta = String(a.timestamp || a.createdAt || '');
    const tb = String(b.timestamp || b.createdAt || '');
    if (ta !== tb) return ta.localeCompare(tb) * order;
    return String(a.id).localeCompare(String(b.id)) * order;
  });

  // Deduplicate by id (transport + cache may overlap).
  const seenIds = new Set();
  const deduped = [];
  for (const event of filtered) {
    if (seenIds.has(event.id)) continue;
    seenIds.add(event.id);
    deduped.push(event);
  }

  // Pagination.
  const limit = Math.max(1, Number(opts.limit || DEFAULT_LIMIT));
  const offset = Math.max(0, Number(opts.offset || 0));
  const page = deduped.slice(offset, offset + limit);

  return {
    total: deduped.length,
    limit,
    offset,
    order: opts.order === 'asc' ? 'asc' : 'desc',
    filters: buildFilterSummary(opts),
    events: page,
    took: new Date().toISOString()
  };
}

function articleEvent(item) {
  const tags = tagsToObject(item.tags || []);
  const summary = summarizeArticle(item);
  if (!summary.key) return null;

  const base = {
    id: summary.id,
    key: summary.key,
    kind: 'publish',
    agentId: summary.authorAgentId,
    timestamp: summary.updatedAt || item.timestamp,
    title: summary.title,
    topic: summary.topic,
    articleKind: summary.kind,
    version: summary.version,
    sourceName: summary.sourceName,
    sourceUrl: summary.sourceUrl,
    encrypted: tags.Visibility === 'encrypted' || tags.Visibility === 'private'
  };

  if (tags['Article-Fork-Of']) {
    return {
      ...base,
      kind: 'fork',
      sourceKey: tags['Article-Fork-Of'],
      sourceId: tags['Article-Fork-Source-Id'] || null,
      sourceVersion: Number(tags['Article-Fork-Source-Version'] || 1)
    };
  }

  if (tags['Article-Merge-Source-Key']) {
    return {
      ...base,
      kind: 'merge',
      sourceKey: tags['Article-Merge-Source-Key'],
      sourceId: tags['Article-Merge-Source-Id'] || null,
      sourceVersion: Number(tags['Article-Merge-Source-Version'] || 1),
      targetVersion: Number(tags['Article-Merge-Target-Version'] || 1),
      hasConflicts: tags['Article-Merge-Has-Conflicts'] === 'true',
      ancestorId: tags['Article-Merge-Ancestor-Id'] || null,
      forkIntegrated: tags['Article-Merge-Fork-Integrated'] === 'true'
    };
  }

  return base;
}

function attestationEvent(item) {
  const summary = summarizeAttestation(item);
  if (!summary.targetKey) return null;
  return {
    id: summary.id,
    kind: 'attest',
    agentId: summary.agentId,
    timestamp: summary.createdAt || item.timestamp,
    targetId: summary.targetId,
    targetKey: summary.targetKey,
    opinion: summary.opinion,
    confidence: summary.confidence,
    reason: summary.reason,
    sourceUrl: summary.sourceUrl
  };
}

function localArticleEvent(summary) {
  return {
    id: summary.id,
    key: summary.key,
    kind: 'publish',
    agentId: summary.authorAgentId,
    timestamp: summary.updatedAt,
    title: summary.title,
    topic: summary.topic,
    articleKind: summary.kind,
    version: summary.version,
    sourceName: summary.sourceName,
    sourceUrl: summary.sourceUrl,
    encrypted: false,
    localOnly: true
  };
}

function localAttestationEvent(att) {
  return {
    id: att.id,
    kind: 'attest',
    agentId: att.agentId,
    timestamp: att.createdAt,
    targetId: att.targetId,
    targetKey: att.targetKey,
    opinion: att.opinion,
    confidence: att.confidence,
    reason: att.reason,
    sourceUrl: att.sourceUrl,
    localOnly: true
  };
}

function buildFilterSummary(opts) {
  return {
    kind: opts.kind || null,
    topic: opts.topic || null,
    key: opts.key || null,
    agent: opts.agent || null,
    author: opts.author || null,
    attestedBy: opts.attestedBy || null,
    eventKind: opts.eventKind || null,
    after: opts.after || null,
    before: opts.before || null
  };
}

export function activityToMarkdown(feed) {
  const lines = [];
  lines.push('# PermaBrain Activity Feed');
  lines.push('');
  const filters = [];
  const f = feed.filters;
  if (f.topic) filters.push(`topic: ${f.topic}`);
  if (f.kind) filters.push(`kind: ${f.kind}`);
  if (f.key) filters.push(`key: ${f.key}`);
  if (f.agent) filters.push(`agent: ${f.agent}`);
  if (f.author) filters.push(`author: ${f.author}`);
  if (f.attestedBy) filters.push(`attestedBy: ${f.attestedBy}`);
  if (f.eventKind) filters.push(`eventKind: ${f.eventKind}`);
  if (f.after) filters.push(`after: ${f.after}`);
  if (f.before) filters.push(`before: ${f.before}`);
  if (filters.length) {
    lines.push(`Filters: ${filters.join(' · ')}`);
    lines.push('');
  }
  lines.push(`Order: ${feed.order} · ${feed.total} event(s) · showing ${feed.events.length}`);
  lines.push('');

  for (const event of feed.events) {
    const ts = event.timestamp || event.createdAt || '';
    const date = ts ? new Date(ts).toISOString().slice(0, 10) : 'unknown';
    const encryptedFlag = event.encrypted ? ' 🔒' : '';
    const localFlag = event.localOnly ? ' [local]' : '';

    if (event.kind === 'publish') {
      lines.push(`- **[publish]** ${event.key}${encryptedFlag}${localFlag}`);
      lines.push(`  ${event.title || '(untitled)'} v${event.version} by ${event.agentId} · ${date}`);
    } else if (event.kind === 'fork') {
      lines.push(`- **[fork]** ${event.sourceKey} → ${event.key}${localFlag}`);
      lines.push(`  ${event.title || '(untitled)'} v${event.version} by ${event.agentId} · forked from v${event.sourceVersion} · ${date}`);
    } else if (event.kind === 'merge') {
      lines.push(`- **[merge]** ${event.sourceKey} → ${event.key}${localFlag}`);
      const conflictNote = event.hasConflicts ? ' ⚠ conflicts' : '';
      lines.push(`  ${event.title || '(untitled)'} v${event.version} by ${event.agentId}${conflictNote} · ${date}`);
    } else if (event.kind === 'attest') {
      lines.push(`- **[attest]** ${event.targetKey}: ${event.opinion} (${event.confidence}) by ${event.agentId}${localFlag}`);
      if (event.reason) lines.push(`  ${event.reason} · ${date}`);
      else lines.push(`  ${date}`);
    }
  }

  return lines.join('\n') + '\n';
}
