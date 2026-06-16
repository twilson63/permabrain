/**
 * PermaBrain Diff
 *
 * Compare two article versions (or local vs remote) and emit unified/JSON
 * diff with optional conflict preview.
 *
 * Supports:
 *   - diff by two version IDs (base -> head)
 *   - diff by two canonical keys (latest versions)
 *   - diff local article against latest remote version
 *   - structured JSON output with hunks and conflict preview
 *   - standard unified-diff-ish text output
 */

import { getHome, loadConfig } from './config.mjs';
import { getTransport } from './transport.mjs';
import { buildVersionChain } from './history.mjs';
import { getArticle } from './article.mjs';
import { tagsToObject, validateArticleKey } from './tags.mjs';

const DEFAULT_CONTEXT = 3;

export async function diffArticles(base, head, opts = {}) {
  if (!base || !head) throw new Error('diff requires both base and head identifiers');

  const home = opts.home || getHome();
  const config = opts.config || loadConfig(home);
  const transport = opts.transport || getTransport(config, home, { useHyperbeam: opts.useHyperbeam });

  // Resolve base and head. They may be DataItem IDs or canonical keys.
  const baseItem = await resolveVersion(base, { transport, home });
  const headItem = await resolveVersion(head, { transport, home });

  const baseContent = await fetchContent(baseItem.item, base);
  const headContent = await fetchContent(headItem.item, head);

  const baseSummary = summarize(baseItem.item, baseItem.label);
  const headSummary = summarize(headItem.item, headItem.label);

  // Find common ancestor for conflict preview and merge-like context.
  let ancestorContent = '';
  let ancestorSummary = null;
  try {
    if (baseSummary.key === headSummary.key) {
      const chain = await buildVersionChain(baseSummary.key, { transport, home });
      ancestorSummary = findCommonAncestorInChain(chain, baseItem.item.id, headItem.item.id);
      if (ancestorSummary) {
        ancestorContent = await fetchContent(ancestorSummary._item, baseSummary.key);
        ancestorSummary = summarize(ancestorSummary._item, `ancestor:${ancestorSummary._item.id}`);
      }
    }
  } catch {
    // ancestor preview is optional
  }

  // Compute line diff.
  const diff = diffLines(baseContent, headContent, { context: opts.context ?? DEFAULT_CONTEXT });

  // Optional conflict preview using the three-way merge logic.
  let conflictPreview = null;
  if (ancestorContent && opts.preview !== false) {
    const { threeWayMerge } = await import('./merge.mjs');
    const previewContent = threeWayMerge(ancestorContent, baseContent, headContent);
    if (previewContent.includes('<<<<<<< ')) {
      conflictPreview = {
        hasConflicts: true,
        conflictCount: countConflictMarkers(previewContent),
        preview: previewContent
      };
    } else {
      conflictPreview = { hasConflicts: false, conflictCount: 0, preview: previewContent };
    }
  }

  const result = {
    base: baseSummary,
    head: headSummary,
    ancestor: ancestorSummary,
    format: opts.format || 'unified',
    changes: diff.changes,
    additions: diff.additions,
    deletions: diff.deletions,
    hunks: diff.hunks,
    conflictPreview
  };

  if (opts.format === 'json') {
    result.text = diff.unified;
  } else {
    result.text = diff.unified;
  }

  return result;
}

export async function diffLocalVsRemote(key, opts = {}) {
  validateArticleKey(key);
  const home = opts.home || getHome();
  const config = opts.config || loadConfig(home);
  const transport = opts.transport || getTransport(config, home, { useHyperbeam: opts.useHyperbeam });

  // Fetch remote latest.
  const { item: remoteItem, summary: remoteSummary } = await getArticle(key, { transport, home, useHyperbeam: opts.useHyperbeam });
  const remoteContent = await fetchContent(remoteItem, key);

  // Fetch local cached plaintext if available.
  const { loadIndex } = await import('./cache.mjs');
  const index = loadIndex(home);
  const cachedSummary = index.articles?.[key];
  let localContent = '';
  let localLabel = `local:${key}`;
  if (cachedSummary?.id && cachedSummary.id !== remoteSummary.id) {
    const cachedItem = await transport.fetchDataItem(cachedSummary.id).catch(() => null);
    if (cachedItem) {
      localContent = await fetchContent(cachedItem, key);
      localLabel = `local:${cachedSummary.id}`;
    }
  }
  if (!localContent && cachedSummary) {
    // Fall back to cached content file if it exists.
    const cachePath = path.join(home, 'cache', 'pages', `${key.replace(/\//g, '-')}.md`);
    if (fs.existsSync(cachePath)) {
      localContent = fs.readFileSync(cachePath, 'utf8');
    }
  }

  const remoteLabel = `remote:${remoteSummary.id}`;
  const diff = diffLines(localContent, remoteContent, { context: opts.context ?? DEFAULT_CONTEXT });

  const result = {
    key,
    base: { ...remoteSummary, label: remoteLabel },
    head: { id: cachedSummary?.id || null, key, label: localLabel, version: cachedSummary?.version || null },
    format: opts.format || 'unified',
    changes: diff.changes,
    additions: diff.additions,
    deletions: diff.deletions,
    hunks: diff.hunks,
    text: diff.unified,
    conflictPreview: null
  };

  return result;
}

async function resolveVersion(identifier, { transport, home }) {
  // Treat slash-containing identifiers as keys.
  if (identifier.includes('/')) {
    const { item, summary } = await getArticle(identifier, { transport, home });
    return { item, label: `key:${identifier}`, key: identifier };
  }

  // Otherwise treat as a DataItem ID.
  const item = await transport.fetchDataItem(identifier).catch((err) => {
    throw new Error(`Could not resolve '${identifier}': ${err.message}`);
  });
  if (!item) throw new Error(`Could not resolve '${identifier}'`);
  const tags = tagsToObject(item.tags || []);
  const key = tags['Article-Key'];
  return { item, label: `id:${identifier}`, key };
}

async function fetchContent(item, identifier) {
  const { payloadText } = await import('./dataitem.mjs');
  const { isEncryptedEnvelope } = await import('./crypto.mjs');
  const raw = payloadText(item);
  if (isEncryptedEnvelope(raw)) {
    throw new Error(`Cannot diff encrypted content for '${identifier}'`);
  }
  return raw;
}

function summarize(item, label) {
  const tags = tagsToObject(item.tags || []);
  return {
    label,
    id: item.id,
    key: tags['Article-Key'] || null,
    version: Number(tags['Article-Version'] || 1),
    title: tags['Article-Title'] || null,
    kind: tags['Article-Kind'] || null,
    topic: tags['Article-Topic'] || null,
    language: tags['Article-Language'] || null,
    sourceName: tags['Article-Source-Name'] || null,
    sourceUrl: tags['Article-Source-Url'] || null,
    contentHash: tags['Article-Content-Hash'] || null,
    updatedAt: tags['Article-Updated-At'] || item.timestamp || null,
    encrypted: tags.Visibility === 'encrypted' || tags.Visibility === 'private'
  };
}

function findCommonAncestorInChain(chain, baseId, headId) {
  const byId = new Map(chain.map((item) => [item.id, item]));

  function ancestors(id) {
    const set = new Set();
    let walkId = id;
    let depth = 0;
    while (walkId && depth < 100) {
      const item = byId.get(walkId);
      if (!item) break;
      const tags = tagsToObject(item.tags || []);
      const next = tags['Article-Previous-Id'];
      if (!next || next === walkId) break;
      set.add(next);
      walkId = next;
      depth++;
    }
    return set;
  }

  if (baseId === headId) return null;
  const baseAncestors = ancestors(baseId);
  const headAncestors = ancestors(headId);

  // Find the closest common ancestor (lower depth = later in chain). Since both
  // sets are built by walking backwards, the first common id encountered by
  // walking forward through the chain is the closest.
  for (const item of chain) {
    if (baseAncestors.has(item.id) && headAncestors.has(item.id)) {
      item._item = item;
      return item;
    }
  }
  return null;
}

function diffLines(base, head, { context = 3 } = {}) {
  const a = String(base || '').split('\n');
  const b = String(head || '').split('\n');
  const matrix = lcsMatrix(a, b);
  const edits = backtrackEdits(a, b, matrix);

  const hunks = [];
  let currentHunk = null;
  let additions = 0;
  let deletions = 0;
  let aLine = 1;
  let bLine = 1;

  const flushHunk = () => {
    if (currentHunk) hunks.push(currentHunk);
    currentHunk = null;
  };

  const ensureHunk = () => {
    if (!currentHunk) {
      currentHunk = {
        oldStart: aLine,
        newStart: bLine,
        oldLines: 0,
        newLines: 0,
        lines: []
      };
    }
  };

  for (const edit of edits) {
    if (edit.op === 'equal') {
      if (currentHunk && currentHunk.lines.length >= context * 2 + 1) {
        flushHunk();
      }
      if (currentHunk) {
        currentHunk.lines.push({ op: 'context', text: edit.value, oldLine: aLine, newLine: bLine });
        currentHunk.oldLines++;
        currentHunk.newLines++;
      }
      aLine++;
      bLine++;
      continue;
    }

    ensureHunk();
    if (edit.op === 'delete') {
      currentHunk.lines.push({ op: 'delete', text: edit.value, oldLine: aLine, newLine: null });
      currentHunk.oldLines++;
      deletions++;
      aLine++;
    } else if (edit.op === 'insert') {
      currentHunk.lines.push({ op: 'insert', text: edit.value, oldLine: null, newLine: bLine });
      currentHunk.newLines++;
      additions++;
      bLine++;
    } else if (edit.op === 'replace') {
      currentHunk.lines.push({ op: 'delete', text: edit.oldValue, oldLine: aLine, newLine: null });
      currentHunk.lines.push({ op: 'insert', text: edit.value, oldLine: null, newLine: bLine });
      currentHunk.oldLines++;
      currentHunk.newLines++;
      deletions++;
      additions++;
      aLine++;
      bLine++;
    }
  }
  flushHunk();

  // Trim leading/trailing context lines in each hunk to exactly `context`.
  for (const hunk of hunks) {
    while (hunk.lines.length > context * 2 + 1 && hunk.lines[context].op !== 'context') {
      // leading context is larger than needed; trim from start if next line after context is a change
      if (hunk.lines[0].op === 'context') {
        hunk.lines.shift();
        hunk.oldStart++;
        hunk.newStart++;
        hunk.oldLines--;
        hunk.newLines--;
      } else break;
    }
  }

  const unified = formatUnified(hunks, a, b);

  return {
    changes: additions + deletions,
    additions,
    deletions,
    hunks: hunks.map((h) => ({
      oldStart: h.oldStart,
      newStart: h.newStart,
      oldLines: h.oldLines,
      newLines: h.newLines,
      lines: h.lines
    })),
    unified
  };
}

function lcsMatrix(a, b) {
  const m = a.length;
  const n = b.length;
  const c = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) c[i][j] = c[i - 1][j - 1] + 1;
      else c[i][j] = Math.max(c[i - 1][j], c[i][j - 1]);
    }
  }
  return c;
}

function backtrackEdits(a, b, c) {
  const edits = [];
  let i = a.length;
  let j = b.length;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      edits.unshift({ op: 'equal', value: a[i - 1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || c[i][j - 1] >= c[i - 1][j])) {
      edits.unshift({ op: 'insert', value: b[j - 1] });
      j--;
    } else if (i > 0 && (j === 0 || c[i][j - 1] < c[i - 1][j])) {
      edits.unshift({ op: 'delete', value: a[i - 1] });
      i--;
    } else {
      break;
    }
  }

  // Collapse adjacent delete/insert pairs into a single replace when they
  // represent an edit on the same conceptual line.
  const collapsed = [];
  for (let k = 0; k < edits.length; k++) {
    const cur = edits[k];
    const next = edits[k + 1];
    if (cur.op === 'delete' && next && next.op === 'insert') {
      collapsed.push({ op: 'replace', value: next.value, oldValue: cur.value });
      k++;
    } else {
      collapsed.push(cur);
    }
  }
  return collapsed;
}

function formatUnified(hunks) {
  const lines = [];
  for (const hunk of hunks) {
    lines.push(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`);
    for (const line of hunk.lines) {
      if (line.op === 'context') lines.push(` ${line.text}`);
      else if (line.op === 'delete') lines.push(`-${line.text}`);
      else if (line.op === 'insert') lines.push(`+${line.text}`);
    }
  }
  return lines.join('\n');
}

function countConflictMarkers(text) {
  let count = 0;
  for (const line of String(text || '').split('\n')) {
    if (line.startsWith('<<<<<<< ')) count++;
  }
  return count;
}

// Local fs/path imports required for diffLocalVsRemote
import fs from 'node:fs';
import path from 'node:path';
