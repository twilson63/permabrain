/**
 * PermaBrain History
 *
 * Build a version chain + attestation timeline for a canonical article key.
 *
 * The history walks the `Article-Previous-Id` links from the latest version
 * back to the root, then interleaves attestations targeting any version in the
 * chain by `Attestation-Target-Id`. The result is a stable timeline that shows:
 *
 *   - Every published version (version number, id, title, content hash,
 *     source, timestamp, author)
 *   - Every attestation cast against any version (opinion, confidence,
 *     reason, agent, target version/id, timestamp)
 *   - Optional consensus summary for the latest version
 *
 * Works across transports (local, Arweave, HyperBEAM).
 */

import { getHome, loadConfig } from './config.mjs';
import { getTransport } from './transport.mjs';
import { resolveLatestArticle } from './article.mjs';
import { queryAttestationsForKey, summarizeAttestationItem } from './attestation.mjs';
import { consensusScore } from './consensus.mjs';
import { tagsToObject } from './tags.mjs';

const MAX_CHAIN_DEPTH = 100;

export async function buildVersionChain(key, opts = {}) {
  const home = opts.home || getHome();
  const config = opts.config || loadConfig(home);
  const transport = opts.transport || getTransport(config, home, { useHyperbeam: opts.useHyperbeam });

  // Query every article version for this key.
  const items = await transport.queryByTags({
    'App-Name': 'PermaBrain',
    'PermaBrain-Type': 'article',
    'Article-Key': key
  });

  const versions = new Map();
  for (const item of items) {
    const tags = tagsToObject(item.tags || []);
    const version = Number(tags['Article-Version'] || 1);
    if (!versions.has(version) || String(item.timestamp) > String(versions.get(version).timestamp)) {
      versions.set(version, item);
    }
  }

  // Sort by version ascending.
  const sorted = [...versions.entries()].sort((a, b) => a[0] - b[0]).map(([, item]) => item);

  // Also support backward-chaining for cases where a version number is missing
  // from the query result (e.g., GraphQL pagination gaps). Start from the latest
  // resolved version and follow previousId links as far as possible, then merge.
  const byId = new Map(items.map((i) => [i.id, i]));
  const resolved = await resolveLatestArticle(key, { ...opts, transport, home });
  let walkId = resolved.summary?.id;
  const chained = [];
  let depth = 0;
  while (walkId && depth < MAX_CHAIN_DEPTH) {
    const item = byId.get(walkId) || await transport.fetchDataItem(walkId).catch(() => null);
    if (!item) break;
    const tags = tagsToObject(item.tags || []);
    const version = Number(tags['Article-Version'] || 1);
    if (!versions.has(version)) {
      chained.unshift(item);
    }
    const previousId = tags['Article-Previous-Id'];
    if (!previousId || previousId === walkId) break;
    walkId = previousId;
    depth++;
  }

  // Merge: chained items first, then sorted versions not already present.
  const merged = [...chained];
  const seenIds = new Set(merged.map((i) => i.id));
  for (const item of sorted) {
    if (!seenIds.has(item.id)) {
      merged.push(item);
      seenIds.add(item.id);
    }
  }

  return merged.sort((a, b) => {
    const va = Number(tagsToObject(a.tags || [])['Article-Version'] || 1);
    const vb = Number(tagsToObject(b.tags || [])['Article-Version'] || 1);
    return va - vb;
  });
}

export function summarizeVersion(item) {
  const tags = tagsToObject(item.tags || []);
  return {
    id: item.id,
    key: tags['Article-Key'],
    version: Number(tags['Article-Version'] || 1),
    title: tags['Article-Title'] || null,
    kind: tags['Article-Kind'] || null,
    topic: tags['Article-Topic'] || null,
    language: tags['Article-Language'] || null,
    contentHash: tags['Article-Content-Hash'] || null,
    previousId: tags['Article-Previous-Id'] || null,
    rootId: tags['Article-Root-Id'] || null,
    sourceName: tags['Article-Source-Name'] || null,
    sourceUrl: tags['Article-Source-Url'] || null,
    authorAgentId: tags['Author-Agent-Id'] || item.owner || null,
    updatedAt: tags['Article-Updated-At'] || item.timestamp || null,
    encrypted: tags.Visibility === 'encrypted' || tags.Visibility === 'private'
  };
}

export async function historyForKey(key, opts = {}) {
  const home = opts.home || getHome();
  const config = opts.config || loadConfig(home);
  const transport = opts.transport || getTransport(config, home, { useHyperbeam: opts.useHyperbeam });

  const versions = await buildVersionChain(key, { ...opts, transport, home });
  const versionSummaries = versions.map(summarizeVersion);

  // Build a map of version ID -> version number for timeline attribution.
  const versionById = new Map();
  for (const v of versionSummaries) versionById.set(v.id, v.version);

  // Fetch attestations targeting this key or any version in the chain.
  const attestationItems = await queryAttestationsForKey(key, { ...opts, transport, home });
  const attestations = attestationItems.map((item) => {
    const summary = summarizeAttestationItem(item);
    return {
      ...summary,
      targetVersion: versionById.get(summary.targetId) || null
    };
  });

  // Sort timeline by createdAt, then by version/attestation order.
  const timeline = [
    ...versionSummaries.map((v) => ({ type: 'version', ...v })),
    ...attestations.map((a) => ({ type: 'attestation', ...a }))
  ].sort((a, b) => {
    const ta = a.createdAt || a.updatedAt || '';
    const tb = b.createdAt || b.updatedAt || '';
    if (ta !== tb) return String(ta).localeCompare(String(tb));
    // For same timestamp, versions come before attestations.
    if (a.type === 'version' && b.type !== 'version') return -1;
    if (a.type !== 'version' && b.type === 'version') return 1;
    return 0;
  });

  // Optional consensus summary for the latest version.
  let consensus = null;
  const latest = versionSummaries[versionSummaries.length - 1];
  if (latest && opts.includeConsensus !== false) {
    const scored = consensusScore(attestations, { latestArticleId: latest.id });
    consensus = {
      latestArticleId: latest.id,
      latestVersion: latest.version,
      score: Number(scored.score.toFixed(6)),
      status: scored.status,
      totalAttestations: attestations.length,
      opinionCounts: scored.opinionCounts || {},
      topReasons: scored.topReasons || []
    };
  }

  return {
    key,
    versionCount: versionSummaries.length,
    versions: versionSummaries,
    attestationCount: attestations.length,
    attestations,
    timeline,
    consensus
  };
}
