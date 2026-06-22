/**
 * PermaBrain Grep
 *
 * Search article bodies in the local page cache for plain-text matches.
 * Useful for finding content that may not be indexed in the transport-level
 * search index (e.g. cached local drafts, decrypted articles, or imported
 * bundles that were written to disk but not yet published).
 *
 * Searches are performed against the markdown files stored under
 * `pages/` in the PermaBrain home directory. Metadata (key, title, kind,
 * topic, language) is enriched from the local article index when available.
 */

import fs from 'node:fs';
import path from 'node:path';
import { getHome, statePaths } from './config.mjs';
import { loadIndex } from './cache.mjs';

const DEFAULT_LIMIT = 50;
const DEFAULT_CONTEXT = 80;
const MAX_CONTEXT = 400;

export async function grepArticles(query, opts = {}) {
  if (!query || typeof query !== 'string') {
    throw new Error('grep query is required');
  }

  const home = opts.home || getHome();
  const { pagesDir } = statePaths(home);
  const index = loadIndex(home);
  const byKey = new Map();
  for (const summary of Object.values(index.articles || {})) {
    if (summary?.key) byKey.set(summary.key, summary);
  }

  const flags = (opts.ignoreCase || opts.i) ? 'i' : '';
  const useRegex = opts.regex || opts.regexp;
  let pattern;
  try {
    pattern = useRegex ? new RegExp(query, flags) : new RegExp(escapeRegExp(query), flags);
  } catch (e) {
    throw new Error(`Invalid grep pattern: ${e.message}`);
  }

  const limit = Math.max(1, Math.min(opts.limit || DEFAULT_LIMIT, 1000));
  const context = Math.max(0, Math.min(opts.context ?? DEFAULT_CONTEXT, MAX_CONTEXT));
  const matches = [];

  if (!fs.existsSync(pagesDir)) {
    return { query, regex: useRegex, ignoreCase: !!flags, total: 0, matches: [] };
  }

  const files = fs.readdirSync(pagesDir).filter((f) => f.endsWith('.md'));
  for (const file of files) {
    if (matches.length >= limit) break;
    const key = file.replace(/\.md$/, '').replace(/__/g, '/');
    const summary = byKey.get(key) || {};

    if (opts.kind && summary.kind !== opts.kind) continue;
    if (opts.topic && summary.topic !== opts.topic) continue;
    if (opts.language && summary.language !== opts.language) continue;
    if (opts.key && summary.key !== opts.key) continue;

    const filePath = path.join(pagesDir, file);
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    const fileMatches = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!pattern.test(line)) continue;
      const snippet = buildSnippet(line, pattern, context, flags);
      fileMatches.push({ line: i + 1, text: line, snippet });
      if (matches.length + fileMatches.length > limit) break;
    }

    if (fileMatches.length > 0) {
      matches.push({
        key,
        title: summary.title || key,
        kind: summary.kind || null,
        topic: summary.topic || null,
        language: summary.language || null,
        count: fileMatches.length,
        matches: fileMatches.slice(0, limit - matches.length)
      });
    }
  }

  return {
    query,
    regex: !!useRegex,
    ignoreCase: !!flags,
    filters: {
      kind: opts.kind || null,
      topic: opts.topic || null,
      language: opts.language || null,
      key: opts.key || null
    },
    total: matches.reduce((sum, m) => sum + m.matches.length, 0),
    matches
  };
}

export function grepToMarkdown(report) {
  const lines = [
    `# PermaBrain grep`,
    '',
    `- **query**: ${report.query}`,
    `- **regex**: ${report.regex ? 'yes' : 'no'}`,
    `- **ignore case**: ${report.ignoreCase ? 'yes' : 'no'}`,
    `- **total matches**: ${report.total}`,
    ''
  ];

  if (report.filters) {
    const filters = Object.entries(report.filters).filter(([, v]) => v != null);
    if (filters.length > 0) {
      lines.push('## Filters', '');
      for (const [k, v] of filters) lines.push(`- **${k}**: ${v}`);
      lines.push('');
    }
  }

  if (!report.matches || report.matches.length === 0) {
    lines.push('No matches found.', '');
    return lines.join('\n');
  }

  lines.push('## Matches', '');
  for (const file of report.matches) {
    lines.push(`### ${file.title || file.key}`);
    lines.push(`- **key**: ${file.key}`);
    if (file.kind) lines.push(`- **kind**: ${file.kind}`);
    if (file.topic) lines.push(`- **topic**: ${file.topic}`);
    if (file.language) lines.push(`- **language**: ${file.language}`);
    lines.push(`- **count**: ${file.count}`);
    lines.push('');
    for (const m of file.matches) {
      lines.push(`Line ${m.line}: ${m.snippet}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildSnippet(line, pattern, context, flags) {
  const matchInfo = findFirstMatch(line, pattern, flags);
  if (!matchInfo) return line;
  const { index, length } = matchInfo;
  const half = Math.floor(context / 2);
  let start = Math.max(0, index - half);
  let end = Math.min(line.length, index + length + half);
  if (start > 0) start = line.lastIndexOf(' ', start) + 1 || start;
  if (end < line.length) {
    const nextSpace = line.indexOf(' ', end);
    if (nextSpace !== -1) end = nextSpace;
  }
  let snippet = line.slice(start, end).trim();
  if (start > 0) snippet = '…' + snippet;
  if (end < line.length) snippet += '…';
  return snippet;
}

function findFirstMatch(line, pattern, flags) {
  // Use a fresh RegExp with global flag reset to find the first match reliably.
  const re = new RegExp(pattern.source, flags.replace('g', ''));
  const match = re.exec(line);
  if (!match) return null;
  return { index: match.index, length: match[0].length };
}
