/**
 * PermaBrain Status
 *
 * Build a working-state overview of a PermaBrain node: local articles,
 * remote latest, pending sync divergences, fork heads, merge/conflict status,
 * and a quick transport health summary.
 */

import { getHome, loadConfig } from './config.mjs';
import { getTransport, getCircuitBreakerStatus, getTransportMetrics } from './transport.mjs';
import { loadIndex, latestByArticleKey } from './cache.mjs';
import { buildVersionChain } from './history.mjs';
import { listForks } from './fork.mjs';
import { tagsToObject } from './tags.mjs';

export async function status(opts = {}) {
  const home = opts.home || getHome();
  const config = opts.config || loadConfig(home);
  const transport = opts.transport || getTransport(config, home, { useHyperbeam: opts.useHyperbeam });

  const localIndex = loadIndex(home);
  const localArticles = Object.values(localIndex.articles || {});
  const localAttestations = localIndex.attestations || {};

  // Remote latest articles
  const remoteItems = await transport.queryByTags({
    'App-Name': 'PermaBrain',
    'PermaBrain-Type': 'article'
  }).catch((err) => {
    return { error: err.message, items: [] };
  });
  const remoteArray = Array.isArray(remoteItems) ? remoteItems : remoteItems.items || [];
  const remoteError = remoteItems.error || null;

  const remoteLatestMap = latestByArticleKey(remoteArray);

  // Per-key status
  const keys = new Set([
    ...localArticles.map((a) => a.key),
    ...[...remoteLatestMap.values()].map((item) => {
      const tags = tagsToObject(item.tags || []);
      return tags['Article-Key'];
    }).filter(Boolean)
  ]);

  const articles = [];
  const divergences = [];
  const forkHeads = [];
  const mergeStatus = [];

  for (const key of [...keys].sort()) {
    const local = localIndex.articles?.[key] || null;
    const remoteItem = remoteLatestMap.get(key);
    const remote = remoteItem ? summarizeRemote(remoteItem) : null;

    let syncStatus = local ? (remote ? 'in-sync' : 'local-only') : 'remote-only';
    let divergence = null;
    if (local && remote && local.id !== remote.id) {
      syncStatus = 'divergent';
      divergence = await describeDivergence(key, local, remote, { transport, home });
      divergences.push(divergence);
    }

    // Forks for this key
    const forks = await listForks(key, { transport, home, useHyperbeam: opts.useHyperbeam }).catch(() => []);
    for (const fork of forks) {
      forkHeads.push({ ...fork, sourceKey: key });
    }

    // Merge/conflict detection via sync merge preview (dry-run)
    let mergePreview = null;
    if (divergence && divergence.mergeable && !divergence.encrypted) {
      mergePreview = await previewMerge(key, local, remote, { transport, home });
      if (mergePreview.hasConflicts) {
        mergeStatus.push({ key, status: 'conflict', conflictCount: mergePreview.conflictCount, mergePreview });
      } else {
        mergeStatus.push({ key, status: 'mergeable', mergePreview });
      }
    }

    articles.push({
      key,
      local: local ? { id: local.id, version: local.version, updatedAt: local.updatedAt } : null,
      remote,
      status: syncStatus,
      forkCount: forks.length,
      pendingMerge: mergePreview ? { status: mergePreview.hasConflicts ? 'conflict' : 'mergeable', conflictCount: mergePreview.conflictCount } : null
    });
  }

  // Transport health summary
  const transportHealth = {
    transport: config.transport || 'arweave',
    ok: true,
    checks: []
  };
  try {
    if (typeof transport.probe === 'function') {
      const probe = await transport.probe();
      transportHealth.ok = probe.ok;
      transportHealth.checks = probe.checks || [];
    } else {
      transportHealth.checks.push({ name: 'transport', ok: true, note: 'no probe method' });
    }
  } catch (err) {
    transportHealth.ok = false;
    transportHealth.checks.push({ name: 'transport-probe', ok: false, error: err.message });
  }

  const circuitBreakers = getCircuitBreakerStatus();
  const metrics = getTransportMetrics();

  const result = {
    home,
    transport: transportHealth.transport,
    transportOk: transportHealth.ok,
    summary: {
      localArticles: localArticles.length,
      remoteArticles: remoteLatestMap.size,
      divergenceCount: divergences.length,
      forkCount: forkHeads.length,
      conflictCount: mergeStatus.filter((m) => m.status === 'conflict').length,
      mergeableCount: mergeStatus.filter((m) => m.status === 'mergeable').length,
      attestationTargets: Object.keys(localAttestations).length,
      totalAttestations: Object.values(localAttestations).reduce((n, xs) => n + xs.length, 0)
    },
    articles,
    divergences,
    forkHeads,
    mergeStatus,
    transportHealth,
    circuitBreakers,
    metrics,
    remoteError,
    updatedAt: new Date().toISOString()
  };

  return result;
}

function summarizeRemote(item) {
  const tags = tagsToObject(item.tags || []);
  return {
    id: item.id,
    version: Number(tags['Article-Version'] || 1),
    title: tags['Article-Title'] || null,
    kind: tags['Article-Kind'] || null,
    topic: tags['Article-Topic'] || null,
    updatedAt: tags['Article-Updated-At'] || item.timestamp || null,
    authorAgentId: tags['Author-Agent-Id'] || item.owner || null
  };
}

async function describeDivergence(key, local, remote, { transport, home }) {
  let mergeable = false;
  let encrypted = false;
  let reason = '';
  try {
    const localItem = await transport.fetchDataItem(local.id);
    const remoteItem = await transport.fetchDataItem(remote.id);
    const localTags = tagsToObject(localItem.tags || []);
    const remoteTags = tagsToObject(remoteItem.tags || []);
    if (localTags.Visibility === 'encrypted' || localTags.Visibility === 'private' || remoteTags.Visibility === 'encrypted' || remoteTags.Visibility === 'private') {
      encrypted = true;
      reason = 'encrypted/private divergence';
    } else {
      const chain = await buildVersionChain(key, { transport, home });
      const commonAncestor = chain.find((item) => item.id === remote.id) || chain.find((item) => item.id === localTags['Article-Previous-Id']) || chain.find((item) => item.id === remoteTags['Article-Previous-Id']) || chain.find((item) => item.id === localTags['Article-Root-Id']) || chain.find((item) => item.id === remoteTags['Article-Root-Id']);
      if (commonAncestor) {
        mergeable = true;
        reason = 'common ancestor found';
      } else {
        reason = 'no common ancestor';
      }
    }
  } catch (err) {
    reason = `analysis failed: ${err.message}`;
  }
  return { key, localId: local.id, remoteId: remote.id, mergeable, encrypted, reason };
}

async function previewMerge(key, local, remote, { transport, home }) {
  const { threeWayMerge } = await import('./merge.mjs');
  try {
    const localItem = await transport.fetchDataItem(local.id);
    const remoteItem = await transport.fetchDataItem(remote.id);
    const chain = await buildVersionChain(key, { transport, home });
    const ancestorItem = chain.find((item) => item.id === remote.id) || chain.find((item) => item.id === localTagsPreviousId(localItem)) || chain.find((item) => item.id === localTagsPreviousId(remoteItem)) || chain.find((item) => item.id === localTagsRootId(localItem)) || chain.find((item) => item.id === localTagsRootId(remoteItem));
    if (!ancestorItem) return { hasConflicts: false, conflictCount: 0, reason: 'no common ancestor' };
    const { payloadText } = await import('./dataitem.mjs');
    const ancestorContent = payloadText(ancestorItem);
    const localContent = payloadText(localItem);
    const remoteContent = payloadText(remoteItem);
    const merged = threeWayMerge(ancestorContent, localContent, remoteContent);
    const hasConflicts = merged.includes('<<<<<<< ');
    return { hasConflicts, conflictCount: countConflictMarkers(merged), reason: hasConflicts ? 'conflicts predicted' : 'clean merge predicted' };
  } catch (err) {
    return { hasConflicts: false, conflictCount: 0, reason: `preview failed: ${err.message}` };
  }
}

function localTagsPreviousId(item) {
  return tagsToObject(item.tags || [])['Article-Previous-Id'];
}

function localTagsRootId(item) {
  return tagsToObject(item.tags || [])['Article-Root-Id'];
}

function countConflictMarkers(text) {
  let count = 0;
  for (const line of String(text || '').split('\n')) {
    if (line.startsWith('<<<<<<< ')) count++;
  }
  return count;
}
