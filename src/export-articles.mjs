/**
 * PermaBrain Export Articles Command
 *
 * Export a filtered, sorted article directory to JSON or markdown.
 * Reuses listArticles() for filtering, sorting, pagination, counts, and
 * transport merge, then formats the page as either a structured JSON object
 * or a markdown list.
 */

import { listArticles, listToMarkdown } from './list.mjs';

const SUPPORTED_FORMATS = new Set(['json', 'markdown', 'md']);

export async function exportArticles(opts = {}) {
  const format = normalizeFormat(opts.format || 'json');
  const list = await listArticles(opts);

  if (format === 'json') {
    return {
      format: 'json',
      ...list
    };
  }

  return {
    format: 'markdown',
    markdown: listToMarkdown(list),
    total: list.total,
    limit: list.limit,
    offset: list.offset,
    sort: list.sort,
    filters: list.filters,
    took: list.took
  };
}

function normalizeFormat(format) {
  const f = String(format).toLowerCase().trim();
  if (SUPPORTED_FORMATS.has(f)) return f === 'md' ? 'markdown' : f;
  throw new Error(`Unsupported export format: ${format}. Use json or markdown.`);
}

export function exportArticlesToMarkdown(list) {
  return listToMarkdown(list);
}
