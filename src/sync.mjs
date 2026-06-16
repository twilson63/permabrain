/**
 * PermaBrain Sync with Conflict-Resolution Merge
 *
 * Extends the base transport sync to detect divergent article versions and
 * automatically integrate them using the three-way merge from merge.mjs.
 *
 * Behavior:
 *   - Pulls all remote articles and attestations via the configured transport.
 *   - Compares each local article's latest version ID with the remote latest.
 *   - If they differ, inspects fork lineage / rootId / previousId chains to
 *     decide whether the remote version is related to the local one.
 *   - When `autoMerge` is enabled and a common ancestor can be resolved,
 *     performs a merge of remote changes into the local key, publishes a new
 *     local version, and records the merge in the sync report.
 *   - Conflicts or encrypted/private divergences are reported for manual
 *     resolution instead of being auto-merged.
 *   - Attestations are synced independently; merge-carried attestations are
 *     disabled during auto-merge to avoid duplicate attestation entries.
 */

import { getHome, loadConfig } from './config.mjs';
import { getTransport } from './transport.mjs';
import { mergeArticles, threeWayMerge } from './merge.mjs';
import { buildVersionChain } from './history.mjs';
import { latestByArticleKey, loadIndex, summarizeArticle, summarizeAttestation, writeIndex } from './cache.mjs';
import { tagsToObject } from './tags.mjs';

export async function syncWithMerge(opts = {}) {
  const home = opts.home || getHome();
  const config = opts.config || loadConfig(home);
  const transport = opts.transport || getTransport(config, home, { useHyperbeam: opts.useHyperbeam });

  // Pull remote state.
  const articleItems = await transport.queryByTags({
    'App-Name': 'PermaBrain',
    'PermaBrain-Type': 'article'
  });
  const attestationItems = await transport.queryByTags({
    'App-Name': 'PermaBrain',
    'PermaBrain-Type': 'attestation'
  });

  const remoteLatestByKey = [...latestByArticleKey(articleItems).values()].map(summarizeArticle);
  const remoteLatestMap = new Map(remoteLatestByKey.map((a) => [a.key, a]));

  const localIndex = loadIndex(home);
  const mergedIndex = {
    articles: { ...(localIndex.articles || {}) },
    attestations: { ...(localIndex.attestations || {}) },
    updatedAt: new Date().toISOString()
  };

  const report = {
    autoMerge: opts.autoMerge !== false,
    dryRun: opts.dryRun === true,
    articlesSynced: 0,
    articlesUnchanged: 0,
    merges: [],
    divergences: [],
    errors: []
  };

  // Merge remote article summaries into the local index first.
  for (const article of remoteLatestByKey) {
    const current = mergedIndex.articles[article.key];
    if (!current || articleIsNewer(article, current)) {
      mergedIndex.articles[article.key] = article;
      report.articlesSynced++;
    }
  }

  // Detect divergences between local keys and their remote counterparts.
  const localKeys = new Set([
    ...Object.keys(localIndex.articles || {}),
    ...remoteLatestByKey.map((a) => a.key)
  ]);

  for (const key of localKeys) {
    const local = localIndex.articles?.[key];
    const remote = remoteLatestMap.get(key);
    if (!local || !remote) continue;
    if (local.id === remote.id) {
      report.articlesUnchanged++;
      continue;
    }

    // Divergence detected.
    const divergence = await analyzeDivergence(key, local, remote, { transport, home });
    if (divergence.encrypted || divergence.blocked) {
      report.divergences.push({
        key,
        localId: local.id,
        remoteId: remote.id,
        status: divergence.blocked ? 'blocked' : 'encrypted',
        reason: divergence.reason
      });
      continue;
    }

    if (report.autoMerge && divergence.mergeable && divergence.commonAncestor) {
      if (report.dryRun) {
        report.merges.push({
          key,
          localId: local.id,
          remoteId: remote.id,
          status: 'dry-run',
          hasConflicts: divergence.predictedConflicts,
          conflictCount: divergence.predictedConflictCount
        });
      } else {
        try {
          const mergeResult = await mergeDivergentVersions(key, local.id, remote.id, {
            home,
            config,
            transport,
            useHyperbeam: opts.useHyperbeam ?? false,
            useHyperbeamReference: opts.useHyperbeamReference ?? config.hyperbeam?.references ?? false
          });
          mergedIndex.articles[key] = mergeResult.merged;
          report.merges.push({
            key,
            localId: local.id,
            remoteId: remote.id,
            status: mergeResult.hasConflicts ? 'merged-with-conflicts' : 'merged',
            mergedId: mergeResult.merged.id,
            hasConflicts: mergeResult.hasConflicts,
            conflictCount: mergeResult.conflictCount,
            ancestorId: mergeResult.ancestor?.id || null
          });
        } catch (err) {
          report.errors.push({ key, phase: 'merge', error: err.message });
          report.divergences.push({
            key,
            localId: local.id,
            remoteId: remote.id,
            status: 'merge-failed',
            reason: err.message
          });
        }
      }
    } else {
      report.divergences.push({
        key,
        localId: local.id,
        remoteId: remote.id,
        status: 'divergent',
        reason: divergence.reason || 'Remote version differs; no mergeable common ancestor'
      });
    }
  }

  // Sync attestations.
  for (const item of attestationItems) {
    const tags = tagsToObject(item.tags || []);
    const targetKey = tags['Attestation-Target-Key'];
    if (!targetKey) continue;
    if (!mergedIndex.attestations[targetKey]) mergedIndex.attestations[targetKey] = [];
    const summary = summarizeAttestation(item);
    const existing = mergedIndex.attestations[targetKey].find((a) => a.id === summary.id);
    if (!existing) mergedIndex.attestations[targetKey].push(summary);
  }

  if (!report.dryRun) {
    writeIndex(home, mergedIndex);
  }

  return {
    ...mergedIndex,
    report,
    articleCount: Object.keys(mergedIndex.articles).length,
    attestationCount: Object.values(mergedIndex.attestations).reduce((n, xs) => n + xs.length, 0)
  };
}

function articleIsNewer(candidate, current) {
  const candidateVersion = Number(candidate.version || 0);
  const currentVersion = Number(current.version || 0);
  if (candidateVersion !== currentVersion) return candidateVersion > currentVersion;
  return String(candidate.updatedAt || '') > String(current.updatedAt || '');
}

async function analyzeDivergence(key, local, remote, { transport, home }) {
  const result = { mergeable: false, encrypted: false, blocked: false, reason: '', commonAncestor: null, predictedConflicts: false, predictedConflictCount: 0 };

  try {
    const localItem = await transport.fetchDataItem(local.id);
    const remoteItem = await transport.fetchDataItem(remote.id);
    const localTags = tagsToObject(localItem.tags || []);
    const remoteTags = tagsToObject(remoteItem.tags || []);

    if (localTags.Visibility === 'encrypted' || localTags.Visibility === 'private' || remoteTags.Visibility === 'encrypted' || remoteTags.Visibility === 'private') {
      result.encrypted = true;
      result.reason = 'Cannot auto-merge encrypted/private articles';
      return result;
    }

    // Same key divergence: find a shared ancestor in the version chain.
    const chain = await buildVersionChain(key, { transport, home });
    const localIds = new Set(chain.map((i) => i.id));
    const common = chain.find((item) => item.id === remote.id) || chain.find((item) => item.id === local.id);
    if (common && (common.id === remote.id || localIds.has(remote.id))) {
      // Fast-forward: remote is already in the local chain (or vice versa).
      result.mergeable = true;
      result.commonAncestor = common.id === remote.id ? summarizeArticle(remoteItem) : summarizeArticle(localItem);
      result.reason = 'Fast-forward along shared version chain';
      return result;
    }

    const commonAncestor = chain.find((item) => item.id === remoteTags['Article-Previous-Id'])
      || chain.find((item) => item.id === remoteTags['Article-Root-Id'])
      || chain.find((item) => item.id === localTags['Article-Previous-Id'])
      || chain.find((item) => item.id === localTags['Article-Root-Id']);

    if (commonAncestor) {
      result.mergeable = true;
      result.commonAncestor = summarizeArticle(commonAncestor);
      const ancestorContent = await fetchContent(commonAncestor, key);
      const localContent = await fetchContent(localItem, key);
      const remoteContent = await fetchContent(remoteItem, key);
      const preview = threeWayMerge(ancestorContent, localContent, remoteContent);
      result.predictedConflicts = preview.includes('<<<<<<< ');
      result.predictedConflictCount = countConflictMarkers(preview);
    } else if (localTags['Article-Root-Id'] && localTags['Article-Root-Id'] === remoteTags['Article-Root-Id']) {
      result.mergeable = true;
      result.commonAncestor = { id: localTags['Article-Root-Id'], key };
      result.reason = 'Shared rootId only; ancestor content will be fetched during merge';
    } else {
      result.blocked = true;
      result.reason = 'No common ancestor between local and remote versions';
    }
  } catch (err) {
    result.blocked = true;
    result.reason = `Failed to analyze divergence: ${err.message}`;
  }

  return result;
}

/**
 * Merge two divergent versions of the same canonical key.
 *
 * Uses three-way merge against the closest shared ancestor, then publishes the
 * result as a new version of `key`. This avoids the source/target key
 * restriction in mergeArticles, which is designed for cross-key fork merges.
 */
async function mergeDivergentVersions(key, localId, remoteId, opts = {}) {
  const { home, config, transport } = opts;
  const chain = await buildVersionChain(key, { transport, home });
  const localItem = await transport.fetchDataItem(localId);
  const remoteItem = await transport.fetchDataItem(remoteId);
  const localTags = tagsToObject(localItem.tags || []);
  const remoteTags = tagsToObject(remoteItem.tags || []);

  // Resolve the common ancestor. Prefer direct shared chain, then previous/root links.
  const localIds = new Set(chain.map((i) => i.id));
  let ancestorItem = chain.find((item) => item.id === remoteTags['Article-Previous-Id'])
    || chain.find((item) => item.id === remoteTags['Article-Root-Id'])
    || chain.find((item) => item.id === localTags['Article-Previous-Id'])
    || chain.find((item) => item.id === localTags['Article-Root-Id'])
    || (localIds.has(remoteId) ? remoteItem : null)
    || (chain.find((item) => item.id === localId) ? localItem : null);

  if (!ancestorItem) {
    throw new Error('No common ancestor found for divergent versions');
  }

  const ancestorContent = await fetchContent(ancestorItem, key);
  const localContent = await fetchContent(localItem, key);
  const remoteContent = await fetchContent(remoteItem, key);
  const mergedContent = threeWayMerge(ancestorContent, localContent, remoteContent);
  const hasConflicts = mergedContent.includes('<<<<<<< ');

  const { publishArticle } = await import('./article.mjs');
  const publishResult = await publishArticle({
    content: mergedContent,
    kind: localTags['Article-Kind'] || remoteTags['Article-Kind'],
    topic: localTags['Article-Topic'] || remoteTags['Article-Topic'],
    key,
    title: localTags['Article-Title'] || remoteTags['Article-Title'] || key.split('/').at(-1),
    sourceUrl: localTags['Article-Source-Url'] || remoteTags['Article-Source-Url'],
    sourceName: localTags['Article-Source-Name'] || remoteTags['Article-Source-Name'],
    sourceLicense: localTags['Article-Source-License'] || remoteTags['Article-Source-License'] || '',
    language: localTags['Article-Language'] || remoteTags['Article-Language'] || 'en',
    useHyperbeam: opts.useHyperbeam ?? false,
    useHyperbeamReference: opts.useHyperbeamReference ?? config.hyperbeam?.references ?? false,
    visibility: localTags.Visibility || remoteTags.Visibility || 'public',
    extraTags: [
      { name: 'Article-Sync-Merged-From', value: remoteId },
      { name: 'Article-Sync-Merged-Local', value: localId },
      { name: 'Article-Sync-Ancestor', value: ancestorItem.id },
      { name: 'Article-Sync-Has-Conflicts', value: String(hasConflicts) }
    ]
  });

  return {
    target: summarizeArticle(localItem),
    source: summarizeArticle(remoteItem),
    ancestor: summarizeArticle(ancestorItem),
    merged: publishResult.summary,
    mergedContent,
    hasConflicts,
    conflictCount: countConflictMarkers(mergedContent),
    item: publishResult.item,
    reference: publishResult.reference
  };
}

async function fetchContent(item, key) {
  const { payloadText } = await import('./dataitem.mjs');
  const { isEncryptedEnvelope } = await import('./crypto.mjs');
  const raw = payloadText(item);
  if (isEncryptedEnvelope(raw)) {
    throw new Error(`Cannot use encrypted article ${key} as merge base`);
  }
  return raw;
}

function countConflictMarkers(text) {
  let count = 0;
  for (const line of String(text || '').split('\n')) {
    if (line.startsWith('<<<<<<< ')) count++;
  }
  return count;
}

/**
 * Backwards-compatible base sync (no auto-merge).
 * Keeps the original syncArticlesAndAttestations semantics.
 */
export async function syncArticlesAndAttestationsBase(opts = {}) {
  const { syncArticlesAndAttestations } = await import('./article.mjs');
  return syncArticlesAndAttestations(opts);
}
