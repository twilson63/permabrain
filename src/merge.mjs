/**
 * PermaBrain Merge
 *
 * Merge a source article fork into a target article's version branch.
 *
 * Performs a three-way merge:
 *   - common ancestor: resolved from fork lineage tags or rootId/version chain
 *   - target changes: latest target content vs ancestor
 *   - source changes: latest source content vs ancestor
 *
 * Non-conflicting line-level changes are applied automatically. Conflicting
 * lines are kept as standard conflict markers so a human (or downstream agent)
 * can resolve them. The merge is then published as a new version of the
 * target article, with merge provenance tags.
 *
 * Attestation carry-forward: attestations cast against the source article's
 * latest version can optionally be re-cast against the new merged target
 * version (with `Attestation-Merge-Carried-From` metadata).
 */

import { getHome, loadConfig } from './config.mjs';
import { getTransport } from './transport.mjs';
import { getArticle, publishArticle } from './article.mjs';
import { buildVersionChain } from './history.mjs';
import { attestArticle, queryAttestationsForKey } from './attestation.mjs';
import { tagsToObject, validateArticleKey } from './tags.mjs';

export async function mergeArticles(targetKey, sourceKey, opts = {}) {
  validateArticleKey(targetKey);
  validateArticleKey(sourceKey);
  if (targetKey === sourceKey) throw new Error('merge source and target must differ');

  const home = opts.home || getHome();
  const config = opts.config || loadConfig(home);
  const transport = opts.transport || getTransport(config, home, { useHyperbeam: opts.useHyperbeam });

  // Resolve latest versions and plaintext content.
  const target = await resolveArticleWithContent(targetKey, { ...opts, transport, home });
  const source = await resolveArticleWithContent(sourceKey, { ...opts, transport, home });

  if (target.summary.encrypted || source.summary.encrypted) {
    throw new Error('Cannot merge encrypted articles without decrypted source content');
  }

  // Find common ancestor.
  const ancestor = await findCommonAncestor(target, source, { transport, home });
  const ancestorContent = ancestor?.content ?? '';

  // Three-way line merge.
  const mergedContent = threeWayMerge(ancestorContent, target.content, source.content);
  const hasConflicts = mergedContent.includes('<<<<<<< ');

  // Build metadata union. Target wins by default; source fills missing fields.
  const targetTags = tagsToObject(target.item.tags || []);
  const sourceTags = tagsToObject(source.item.tags || []);
  const finalTitle = opts.title || target.summary.title || source.summary.title || targetKey.split('/').at(-1);
  const finalTopic = opts.topic || target.summary.topic || source.summary.topic;
  const finalKind = opts.kind || target.summary.kind || source.summary.kind;
  const finalLanguage = opts.language || targetTags['Article-Language'] || sourceTags['Article-Language'] || 'en';
  const finalSourceUrl = opts.sourceUrl || target.summary.sourceUrl || source.summary.sourceUrl;
  const finalSourceName = opts.sourceName || targetTags['Article-Source-Name'] || sourceTags['Article-Source-Name'] || sourceNameFromUrl(finalSourceUrl);
  const finalSourceLicense = opts.sourceLicense ?? targetTags['Article-Source-License'] ?? sourceTags['Article-Source-License'] ?? '';

  const extraTags = [
    { name: 'Article-Merge-Source-Key', value: sourceKey },
    { name: 'Article-Merge-Source-Id', value: source.summary.id },
    { name: 'Article-Merge-Source-Version', value: String(source.summary.version || 1) },
    { name: 'Article-Merge-Target-Version', value: String(target.summary.version || 1) },
    { name: 'Article-Merge-Has-Conflicts', value: String(hasConflicts) }
  ];
  if (ancestor?.summary?.id) {
    extraTags.push({ name: 'Article-Merge-Ancestor-Id', value: ancestor.summary.id });
  }
  if (sourceTags['Article-Fork-Of'] === targetKey) {
    extraTags.push({ name: 'Article-Merge-Fork-Integrated', value: 'true' });
  }

  const publishResult = await publishArticle({
    content: mergedContent,
    kind: finalKind,
    topic: finalTopic,
    key: targetKey,
    title: finalTitle,
    sourceUrl: finalSourceUrl,
    sourceName: finalSourceName,
    sourceLicense: finalSourceLicense,
    language: finalLanguage,
    useHyperbeam: opts.useHyperbeam ?? false,
    useHyperbeamReference: opts.useHyperbeamReference ?? config.hyperbeam?.references ?? false,
    visibility: targetTags.Visibility || sourceTags.Visibility || 'public',
    extraTags
  });

  // Optionally carry-forward source attestations.
  let carriedAttestations = [];
  if (opts.carryAttestations !== false) {
    carriedAttestations = await carryForwardAttestations(sourceKey, source.summary.id, targetKey, publishResult.summary.id, { useHyperbeam: opts.useHyperbeam, home });
  }

  // Record a local audit event for the merge action.
  try {
    const { logAction } = await import('./log.mjs');
    logAction({ home, action: 'merge', status: 'ok', key: targetKey, id: publishResult.item.id, message: `Merged ${sourceKey} → ${targetKey}`, details: { sourceKey, sourceId: source.summary.id, hasConflicts, carriedAttestations: carriedAttestations.length } });
  } catch {
    // Audit logging is best-effort.
  }

  return {
    target: target.summary,
    source: source.summary,
    ancestor: ancestor?.summary || null,
    merged: publishResult.summary,
    mergedContent,
    hasConflicts,
    conflictCount: countConflictMarkers(mergedContent),
    editsApplied: deriveMergeEdits(target, source, opts),
    carriedAttestations,
    item: publishResult.item,
    reference: publishResult.reference
  };
}

async function resolveArticleWithContent(key, opts) {
  const resolved = await getArticle(key, { ...opts });
  return {
    item: resolved.item,
    summary: resolved.summary,
    content: resolved.content,
    encrypted: resolved.encrypted
  };
}

async function findCommonAncestor(target, source, { transport, home }) {
  // Direct fork lineage: source declares it forked from target.
  const sourceTags = tagsToObject(source.item.tags || []);
  const targetTags = tagsToObject(target.item.tags || []);
  if (sourceTags['Article-Fork-Of'] === target.summary.key && sourceTags['Article-Fork-Source-Id']) {
    try {
      const ancestorItem = await transport.fetchDataItem(sourceTags['Article-Fork-Source-Id']);
      const ancestorContent = await getContentFromItem(ancestorItem, target.summary.key);
      return { item: ancestorItem, summary: summarizeArticleItem(ancestorItem), content: ancestorContent };
    } catch {
      // fall through to chain search
    }
  }

  // Walk target version chain looking for a version ID that also appears in source chain.
  const targetChain = await buildVersionChain(target.summary.key, { transport, home });
  const sourceChain = await buildVersionChain(source.summary.key, { transport, home });
  const sourceIds = new Set(sourceChain.map((i) => i.id));
  for (let i = targetChain.length - 1; i >= 0; i--) {
    if (sourceIds.has(targetChain[i].id)) {
      const ancestorItem = targetChain[i];
      const ancestorContent = await getContentFromItem(ancestorItem, target.summary.key);
      return { item: ancestorItem, summary: summarizeArticleItem(ancestorItem), content: ancestorContent };
    }
  }

  // If source is a fork of target, but the exact fork source version is missing, walk
  // back from target until we find the fork point or reach a shared root.
  if (sourceTags['Article-Fork-Of'] === target.summary.key) {
    for (let i = targetChain.length - 1; i >= 0; i--) {
      const candidateId = targetChain[i].id;
      if (sourceTags['Article-Root-Id'] === candidateId || targetTags['Article-Root-Id'] === candidateId) {
        const ancestorItem = targetChain[i];
        const ancestorContent = await getContentFromItem(ancestorItem, target.summary.key);
        return { item: ancestorItem, summary: summarizeArticleItem(ancestorItem), content: ancestorContent };
      }
    }
  }

  // Fallback: use target rootId as ancestor if source rootId matches.
  if (targetTags['Article-Root-Id'] && targetTags['Article-Root-Id'] === sourceTags['Article-Root-Id']) {
    try {
      const rootItem = await transport.fetchDataItem(targetTags['Article-Root-Id']);
      const rootContent = await getContentFromItem(rootItem, target.summary.key);
      return { item: rootItem, summary: summarizeArticleItem(rootItem), content: rootContent };
    } catch {
      // fall through
    }
  }

  // Last resort: treat target itself as the common base (fast-forward-ish merge).
  return { item: target.item, summary: target.summary, content: target.content };
}

async function getContentFromItem(item, key) {
  const { payloadText } = await import('./dataitem.mjs');
  const { isEncryptedEnvelope, decrypt } = await import('./crypto.mjs');
  const raw = payloadText(item);
  if (isEncryptedEnvelope(raw)) {
    throw new Error(`Cannot use encrypted article ${key} as merge ancestor`);
  }
  return raw;
}

function summarizeArticleItem(item) {
  const tags = tagsToObject(item.tags || []);
  return {
    id: item.id,
    key: tags['Article-Key'],
    version: Number(tags['Article-Version'] || 1),
    title: tags['Article-Title'] || null,
    kind: tags['Article-Kind'] || null,
    topic: tags['Article-Topic'] || null,
    sourceUrl: tags['Article-Source-Url'] || null,
    sourceName: tags['Article-Source-Name'] || null,
    contentHash: tags['Article-Content-Hash'] || null,
    encrypted: tags.Visibility === 'encrypted' || tags.Visibility === 'private'
  };
}

function normalizeLines(text) {
  return String(text || '').split('\n');
}

function lcs(a, b) {
  // Classic DP longest common subsequence returning array of { aIndex, bIndex } pairs.
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (a[i] === b[j]) dp[i][j] = dp[i + 1][j + 1] + 1;
      else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const pairs = [];
  let i = 0, j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      pairs.push({ aIndex: i, bIndex: j });
      i++; j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return pairs;
}

function diffAgainst(ancestor, branch) {
  // Returns edit operations from ancestor -> branch as { op, value } list.
  // aIndex is the ancestor line position the operation relates to:
  // - equal/delete/replace: the ancestor line itself
  // - insert: the ancestor line *before* which the value is inserted;
  //   aIndex === ancestor.length means append at end.
  const pairs = lcs(ancestor, branch);
  const rawOps = [];
  let ai = 0, bi = 0;
  for (const pair of pairs) {
    const insertPos = ai; // position between previous match and this match
    while (ai < pair.aIndex) {
      rawOps.push({ op: 'delete', value: ancestor[ai], aIndex: ai });
      ai++;
    }
    while (bi < pair.bIndex) {
      rawOps.push({ op: 'insert', value: branch[bi], aIndex: insertPos });
      bi++;
    }
    rawOps.push({ op: 'equal', value: ancestor[ai], aIndex: ai, bIndex: bi });
    ai++; bi++;
  }
  const trailingInsertPos = ai;
  while (ai < ancestor.length) {
    rawOps.push({ op: 'delete', value: ancestor[ai], aIndex: ai });
    ai++;
  }
  while (bi < branch.length) {
    rawOps.push({ op: 'insert', value: branch[bi], aIndex: trailingInsertPos });
    bi++;
  }

  // Collapse [delete(aIndex=i), insert(aIndex=i)] into a single replace(aIndex=i)
  // so that "edit a line" is not treated as a delete plus an unrelated insert.
  const ops = [];
  for (let i = 0; i < rawOps.length; i++) {
    const op = rawOps[i];
    const next = rawOps[i + 1];
    if (
      op.op === 'delete' &&
      next &&
      next.op === 'insert' &&
      next.aIndex === op.aIndex
    ) {
      ops.push({ op: 'replace', value: next.value, aIndex: op.aIndex, oldValue: op.value });
      i++;
    } else {
      ops.push(op);
    }
  }
  return ops;
}

function position(op) {
  return op.aIndex;
}

/**
 * Line-level three-way merge based on LCS diffs.
 *
 * Walks the ancestor -> target and ancestor -> source diff scripts,
 * auto-merging non-conflicting changes and marking conflicts where both
 * branches edit the same ancestor region differently.
 */
export function threeWayMerge(ancestor, target, source) {
  const aLines = normalizeLines(ancestor);
  const tOps = diffAgainst(aLines, normalizeLines(target));
  const sOps = diffAgainst(aLines, normalizeLines(source));

  const result = [];
  let ti = 0, si = 0;
  while (ti < tOps.length || si < sOps.length) {
    const tOp = tOps[ti];
    const sOp = sOps[si];

    if (!tOp) {
      for (let k = si; k < sOps.length; k++) {
        if (sOps[k].op !== 'delete') result.push(sOps[k].value);
      }
      break;
    }
    if (!sOp) {
      for (let k = ti; k < tOps.length; k++) {
        if (tOps[k].op !== 'delete') result.push(tOps[k].value);
      }
      break;
    }

    const tPos = position(tOp);
    const sPos = position(sOp);

    // Both at the same ancestor line and both kept it unchanged.
    if (tOp.op === 'equal' && sOp.op === 'equal' && tOp.aIndex === sOp.aIndex) {
      result.push(tOp.value);
      ti++; si++;
      continue;
    }

    // Process the operation that is earlier in the ancestor. When positions are
    // equal, prefer inserts over other ops so "insert before line X" is ordered
    // consistently. Replaces and deletes are processed only when aligned.
    if (tPos < sPos || (tPos === sPos && tOp.op === 'insert' && sOp.op !== 'insert')) {
      if (tOp.op === 'insert') result.push(tOp.value);
      ti++;
      continue;
    }

    if (sPos < tPos || (sPos === tPos && sOp.op === 'insert' && tOp.op !== 'insert')) {
      if (sOp.op === 'insert') result.push(sOp.value);
      si++;
      continue;
    }

    // Same position, both operations touch the same ancestor line.

    if (tOp.op === 'insert' && sOp.op === 'insert') {
      if (tOp.value === sOp.value) {
        result.push(tOp.value);
      } else {
        // Both added content at the same relative position. Include both
        // sequentially rather than marking a conflict, since the additions
        // do not overlap an existing line.
        result.push(tOp.value);
        result.push(sOp.value);
      }
      ti++; si++;
      continue;
    }

    // Replace vs equal: the edit wins (non-conflicting change).
    if ((tOp.op === 'replace' && sOp.op === 'equal') || (tOp.op === 'equal' && sOp.op === 'replace')) {
      result.push(tOp.op === 'replace' ? tOp.value : sOp.value);
      ti++; si++;
      continue;
    }

    // Replace vs replace with same result.
    if (tOp.op === 'replace' && sOp.op === 'replace' && tOp.value === sOp.value) {
      result.push(tOp.value);
      ti++; si++;
      continue;
    }

    // Both delete -> delete.
    if (tOp.op === 'delete' && sOp.op === 'delete') {
      ti++; si++;
      continue;
    }

    // One keeps, one deletes -> keep the line (do not silently delete content).
    if ((tOp.op === 'equal' && sOp.op === 'delete') || (tOp.op === 'delete' && sOp.op === 'equal')) {
      result.push(tOp.op === 'equal' ? tOp.value : sOp.value);
      ti++; si++;
      continue;
    }

    // One inserts, the other keeps the same line. Include both (insert before).
    if (tOp.op === 'equal' && sOp.op === 'insert') {
      result.push(tOp.value);
      result.push(sOp.value);
      ti++; si++;
      continue;
    }
    if (tOp.op === 'insert' && sOp.op === 'equal') {
      result.push(tOp.value);
      result.push(sOp.value);
      ti++; si++;
      continue;
    }

    // Remaining divergent edits -> conflict block.
    const conflictTarget = [];
    const conflictSource = [];
    let tj = ti, sj = si;
    while (
      tj < tOps.length &&
      sj < sOps.length &&
      !(tOps[tj]?.op === 'equal' && sOps[sj]?.op === 'equal' && tOps[tj].aIndex === sOps[sj].aIndex)
    ) {
      if (tOps[tj]?.op !== 'delete') conflictTarget.push(tOps[tj].value);
      tj++;
      if (sOps[sj]?.op !== 'delete') conflictSource.push(sOps[sj].value);
      sj++;
      // Avoid infinite loop if neither op advances us.
      if (tj === ti && sj === si) break;
    }
    result.push(`<<<<<<< target`);
    result.push(...conflictTarget);
    result.push('=======');
    result.push(...conflictSource);
    result.push('>>>>>>> source');
    ti = tj;
    si = sj;
  }

  return result.join('\n');
}

function countConflictMarkers(text) {
  let count = 0;
  for (const line of normalizeLines(text)) {
    if (line.startsWith('<<<<<<< ')) count++;
  }
  return count;
}

function deriveMergeEdits(target, source, opts) {
  const edits = [];
  if (opts.title && opts.title !== target.summary.title) edits.push('title');
  if (opts.topic && opts.topic !== target.summary.topic) edits.push('topic');
  if (opts.kind && opts.kind !== target.summary.kind) edits.push('kind');
  if (source.content !== target.content) edits.push('content');
  if (opts.sourceUrl && opts.sourceUrl !== target.summary.sourceUrl) edits.push('sourceUrl');
  if (opts.sourceName && opts.sourceName !== target.summary.sourceName) edits.push('sourceName');
  if (opts.sourceLicense !== undefined) edits.push('sourceLicense');
  if (opts.language && opts.language !== target.summary.language) edits.push('language');
  if (edits.length === 0) edits.push('content');
  return [...new Set(edits)];
}

async function carryForwardAttestations(sourceKey, sourceId, targetKey, targetId, { useHyperbeam, home }) {
  const items = await queryAttestationsForKey(sourceKey, { useHyperbeam, home });
  const carried = [];
  for (const item of items) {
    const tags = tagsToObject(item.tags || []);
    if (tags['Attestation-Target-Id'] !== sourceId) continue;
    if (tags['Attestation-Merge-Carried-From']) continue; // avoid double-carry
    try {
      const result = await attestArticle({
        key: targetKey,
        opinion: tags['Attestation-Opinion'],
        confidence: Number(tags['Attestation-Confidence'] || 0),
        reason: `[carried from ${sourceKey}] ${tags['Attestation-Reason']}`,
        sourceUrl: tags['Attestation-Source-Url'] || '',
        targetId,
        useHyperbeam
      });
      carried.push({ id: result.summary.id, agentId: result.summary.agentId, opinion: result.summary.opinion, confidence: result.summary.confidence });
    } catch (err) {
      carried.push({ sourceAttestationId: item.id, error: err.message });
    }
  }
  return carried;
}

function sourceNameFromUrl(url) {
  if (!url) return 'Unknown';
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return host;
  } catch {
    return 'Unknown';
  }
}
