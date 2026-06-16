/**
 * PermaBrain Search
 *
 * Full-text + tag search across local cache and remote transport, with
 * filters (kind, topic, author, date), relevance ranking, and encrypted-article
 * handling.
 *
 * Search strategy:
 *   1. Query the transport for article items matching hard tag filters
 *      (kind, topic, author/agent, key, date range).
 *   2. Index titles, topics, source names, and plaintext content where
 *      available (encrypted articles are included but their content is not
 *      searchable unless cached plaintext exists locally).
 *   3. Score matches using BM25-inspired term frequency with field weights:
 *      title > topic > key > source name > content.
 *   4. Merge remote results with the local cache, preferring the latest version
 *      per canonical key.
 *   5. Return ranked results with snippets and encrypted flags.
 */

import { getHome, loadConfig } from './config.mjs';
import { getTransport } from './transport.mjs';
import { latestByArticleKey, loadIndex, summarizeArticle } from './cache.mjs';
import { tagsToObject } from './tags.mjs';
import { isEncryptedEnvelope } from './crypto.mjs';

const DEFAULT_LIMIT = 20;
const MAX_CONTENT_PREVIEW = 240;

export async function searchArticles(query, opts = {}) {
  const home = opts.home || getHome();
  const config = opts.config || loadConfig(home);
  const transport = opts.transport || getTransport(config, home, { useHyperbeam: opts.useHyperbeam });

  const terms = tokenize(query);
  const hasExactFilters = !!(opts.kind || opts.topic || opts.author || opts.key);

  const filters = buildTagFilters(opts);
  const items = await transport.queryByTags(filters);
  const remoteLatest = [...latestByArticleKey(items).values()];

  const localIndex = loadIndex(home);
  const cachedArticles = Object.values(localIndex.articles || {});

  // Merge remote and cached by key, preferring the latest version of each.
  const byKey = new Map();
  for (const item of remoteLatest) {
    const summary = summarizeArticle(item);
    if (!summary.key) continue;
    byKey.set(summary.key, { item, summary });
  }

  // If an exact key filter was requested and the transport found nothing,
  // still surface a locally cached article matching that key.
  if (opts.key && !byKey.has(opts.key)) {
    const cached = cachedArticles.find((s) => s.key === opts.key);
    if (cached) byKey.set(opts.key, { item: null, summary: cached });
  }

  // Add remaining cached articles not already present from remote.
  for (const summary of cachedArticles) {
    if (!summary.key || byKey.has(summary.key)) continue;
    byKey.set(summary.key, { item: null, summary });
  }

  // If any hard tag filters were requested, keep only results that satisfy
  // them (whether from remote transport or from local cache).
  for (const [key, entry] of byKey.entries()) {
    if (!entry?.summary || matchesFiltersExactly(entry.summary, opts)) continue;
    byKey.delete(key);
  }

  // Fetch plaintext content for scoring and snippets. For encrypted articles,
  // try the local page cache for the author/decryptor before giving up.
  const candidates = [];
  for (const entry of byKey.values()) {
    if (!entry) continue;
    const { item, summary } = entry;
    let content = '';
    let encrypted = false;
    try {
      if (item?.data != null) {
        const raw = typeof item.data === 'string' ? Buffer.from(item.data, 'base64url').toString('utf8') : item.data.toString('utf8');
        encrypted = isEncryptedEnvelope(raw);
        content = encrypted ? await loadCachedPlaintext(home, summary.key) : raw;
      } else {
        content = await loadCachedPlaintext(home, summary.key);
      }
    } catch {
      content = '';
    }
    candidates.push({ summary, content, encrypted });
  }

  const scored = candidates
    .map((candidate) => scoreCandidate(candidate, terms, opts))
    .filter((result) => result.score > 0 || (hasExactFilters && matchesFiltersExactly(result.summary, opts)));

  // If an exact key filter was requested but no candidates scored, include
  // the cached article for that key when it is present locally.
  if (opts.key && scored.length === 0) {
    const cached = cachedArticles.find((s) => s.key === opts.key);
    if (cached) {
      scored.push(scoreCandidate({ summary: cached, content: '', encrypted: false }, terms, opts));
    }
  }

  scored.sort((a, b) => b.score - a.score);

  let results = scored;

  // Optional consensus boosting (if a consensus map is provided via opts.consensusByKey).
  if (opts.consensusByKey) {
    results = rankByConsensus(results, opts.consensusByKey);
  }

  const limit = Math.max(1, Number(opts.limit || DEFAULT_LIMIT));
  const offset = Math.max(0, Number(opts.offset || 0));
  const page = results.slice(offset, offset + limit);

  return {
    query,
    total: results.length,
    limit,
    offset,
    results: page,
    took: new Date().toISOString()
  };
}

function buildTagFilters(opts) {
  const filters = {
    'App-Name': 'PermaBrain',
    'PermaBrain-Type': 'article'
  };
  if (opts.kind) filters['Article-Kind'] = opts.kind;
  if (opts.topic) filters['Article-Topic'] = opts.topic;
  if (opts.author) filters['Author-Agent-Id'] = opts.author;
  if (opts.key) filters['Article-Key'] = opts.key;
  return filters;
}

function matchesFiltersExactly(summary, opts) {
  if (!summary) return false;
  if (opts.kind && summary.kind !== opts.kind) return false;
  if (opts.topic && summary.topic !== opts.topic) return false;
  if (opts.author && summary.authorAgentId !== opts.author) return false;
  if (opts.key && summary.key !== opts.key) return false;
  return true;
}

function candidateForFilters(summary) {
  return summary;
}

async function loadCachedPlaintext(home, key) {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const cachePath = path.join(home, 'cache', 'pages', `${key.replace(/\//g, '__')}.md`);
  if (fs.existsSync(cachePath)) return fs.readFileSync(cachePath, 'utf8');
  return '';
}

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

function countTermMatches(term, fieldTokens) {
  let count = 0;
  for (const token of fieldTokens) {
    if (token === term || token.startsWith(term) || term.startsWith(token)) count++;
  }
  return count;
}

function scoreCandidate(candidate, terms, opts) {
  const { summary, content, encrypted } = candidate;
  const fields = [
    { text: summary.title, weight: 8 },
    { text: summary.topic, weight: 6 },
    { text: summary.key, weight: 5 },
    { text: summary.sourceName, weight: 3 },
    { text: content, weight: 1 }
  ];

  let score = 0;
  const matchedTerms = new Set();
  const snippets = [];

  for (const { text, weight } of fields) {
    const fieldTokens = tokenize(text);
    for (const term of terms) {
      const count = countTermMatches(term, fieldTokens);
      if (count) {
        matchedTerms.add(term);
        score += (count * weight) / Math.sqrt(fieldTokens.length + 1);
        if (weight === 1 && snippets.length < 3) {
          snippets.push(extractSnippet(content, term));
        }
      }
    }
  }

  // Date filtering (by updatedAt or published date). Articles outside the
  // requested date range are dropped by setting score to 0 unless they match
  // exact tag filters that the user explicitly requested.
  if (opts.after && summary.updatedAt && summary.updatedAt < opts.after) {
    if (!opts.kind && !opts.topic && !opts.author && !opts.key) score = 0;
  }
  if (opts.before && summary.updatedAt && summary.updatedAt > opts.before) {
    if (!opts.kind && !opts.topic && !opts.author && !opts.key) score = 0;
  }

  // Encrypted articles that the caller cannot search content-wise still appear
  // when title/topic/key/source matches, but they are marked encrypted and get
  // no content snippet.
  const snippet = encrypted
    ? '(encrypted article — content not searchable)'
    : (snippets.filter(Boolean)[0] || makeGenericPreview(content));

  return {
    id: summary.id,
    key: summary.key,
    title: summary.title,
    kind: summary.kind,
    topic: summary.topic,
    version: summary.version,
    sourceName: summary.sourceName,
    sourceUrl: summary.sourceUrl,
    authorAgentId: summary.authorAgentId,
    updatedAt: summary.updatedAt,
    contentHash: summary.contentHash,
    encrypted,
    score: Math.round(score * 1000) / 1000,
    matchedTerms: [...matchedTerms],
    snippet
  };
}

function extractSnippet(content, term) {
  const text = String(content || '');
  const index = text.toLowerCase().indexOf(term.toLowerCase());
  if (index === -1) return null;
  const start = Math.max(0, index - 80);
  const end = Math.min(text.length, index + term.length + 80);
  let snippet = text.slice(start, end).replace(/\s+/g, ' ').trim();
  if (start > 0) snippet = '…' + snippet;
  if (end < text.length) snippet = snippet + '…';
  return snippet;
}

function makeGenericPreview(content) {
  const text = String(content || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > MAX_CONTENT_PREVIEW ? text.slice(0, MAX_CONTENT_PREVIEW) + '…' : text;
}

export function rankByConsensus(results, consensusByKey) {
  return results
    .map((result) => {
      const consensus = consensusByKey[result.key];
      if (!consensus) return result;
      return {
        ...result,
        consensusScore: consensus.score,
        consensusStatus: consensus.status,
        score: result.score + (consensus.score || 0)
      };
    })
    .sort((a, b) => b.score - a.score);
}
