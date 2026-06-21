/**
 * PermaBrain Tag Index Catalog
 *
 * Discover custom tags attached to local article DataItems.
 * Reserved PermaBrain metadata tags are excluded so only user-defined
 * tags surface in the catalog.
 */

import fs from 'node:fs';
import path from 'node:path';
import { statePaths } from './config.mjs';
import { tagsToObject } from './tags.mjs';

export const RESERVED_TAG_NAMES = new Set([
  'App-Name',
  'App-Version',
  'PermaBrain-Type',
  'Article-Key',
  'Article-Kind',
  'Article-Title',
  'Article-Slug',
  'Article-Topic',
  'Article-Language',
  'Article-Version',
  'Article-Previous-Id',
  'Article-Root-Id',
  'Article-Source-Name',
  'Article-Source-Url',
  'Article-Source-License',
  'Article-Content-Hash',
  'Article-Published-At',
  'Article-Updated-At',
  'Author-Agent-Id',
  'Visibility',
  'Attestation-Target-Id',
  'Attestation-Target-Key',
  'Attestation-Opinion',
  'Attestation-Confidence',
  'Attestation-Reason',
  'Attestation-Agent-Id',
  'Attestation-Source-Url',
  'Attestation-Created-At',
  'Attestation-Threshold',
  'Attestation-Co-Signer-Count',
  'Attestation-Co-Signer-Ids',
  'Attestation-Multi-Sig',
  'Threshold-Envelope-Id',
  'Threshold-Envelope-Status',
  'Threshold-Required-Signers',
  'Threshold-Co-Signer-Ids',
  'Content-Type',
  'Bundle-Format',
  'Bundle-Version'
]);

export function isCustomTag(name) {
  return name && !RESERVED_TAG_NAMES.has(name);
}

export function readArticleItems(home) {
  const { objectsDir } = statePaths(home);
  if (!fs.existsSync(objectsDir)) return [];
  return fs.readdirSync(objectsDir)
    .filter((name) => name.endsWith('.json'))
    .map((file) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(objectsDir, file), 'utf8'));
      } catch {
        return null;
      }
    })
    .filter((item) => {
      if (!item || !Array.isArray(item.tags)) return false;
      const obj = tagsToObject(item.tags);
      return obj['App-Name'] === 'PermaBrain' && obj['PermaBrain-Type'] === 'article';
    });
}

export function listTags(opts = {}) {
  const home = opts.home || process.env.PERMABRAIN_HOME;
  const items = readArticleItems(home);
  const byTag = new Map();

  for (const item of items) {
    const obj = tagsToObject(item.tags);
    const key = obj['Article-Key'];
    const kind = obj['Article-Kind'] || 'unknown';
    const updatedAt = obj['Article-Updated-At'] || item.timestamp || null;

    for (const tag of item.tags) {
      if (!tag || !isCustomTag(tag.name)) continue;
      const name = tag.name;
      const value = String(tag.value || '');

      let entry = byTag.get(name);
      if (!entry) {
        entry = {
          name,
          count: 0,
          uniqueKeys: new Set(),
          uniqueValues: new Set(),
          byKind: {},
          byValue: {},
          latestAt: null
        };
        byTag.set(name, entry);
      }

      entry.count += 1;
      if (key) entry.uniqueKeys.add(key);
      entry.uniqueValues.add(value);
      entry.byKind[kind] = (entry.byKind[kind] || 0) + 1;
      entry.byValue[value] = (entry.byValue[value] || 0) + 1;
      if (updatedAt && (!entry.latestAt || updatedAt > entry.latestAt)) entry.latestAt = updatedAt;
    }
  }

  let rows = [...byTag.values()].map((entry) => ({
    name: entry.name,
    count: entry.count,
    uniqueKeys: entry.uniqueKeys.size,
    uniqueValues: entry.uniqueValues.size,
    byKind: entry.byKind,
    byValue: Object.fromEntries(Object.entries(entry.byValue).slice(0, 20)),
    latestAt: entry.latestAt
  }));

  if (opts.prefix) {
    const prefix = String(opts.prefix).toLowerCase();
    rows = rows.filter((r) => r.name.toLowerCase().startsWith(prefix));
  }
  if (opts.name) {
    const name = String(opts.name).toLowerCase();
    rows = rows.filter((r) => r.name.toLowerCase() === name);
  }
  if (opts.kind) {
    rows = rows.filter((r) => r.byKind[opts.kind]);
  }
  if (opts.after) {
    const afterIso = new Date(opts.after).toISOString();
    rows = rows.filter((r) => r.latestAt && r.latestAt >= afterIso);
  }
  if (opts.before) {
    const beforeIso = new Date(opts.before).toISOString();
    rows = rows.filter((r) => r.latestAt && r.latestAt <= beforeIso);
  }

  const sort = opts.sort || 'count';
  rows.sort((a, b) => {
    if (sort === 'name') return a.name.localeCompare(b.name);
    if (sort === 'latest') return (b.latestAt || '').localeCompare(a.latestAt || '');
    if (sort === 'keys') return b.uniqueKeys - a.uniqueKeys;
    return b.count - a.count;
  });

  if (opts.limit) rows = rows.slice(0, Number(opts.limit));

  return {
    generatedAt: new Date().toISOString(),
    home,
    filters: {
      prefix: opts.prefix || null,
      name: opts.name || null,
      kind: opts.kind || null,
      after: opts.after || null,
      before: opts.before || null,
      sort,
      limit: opts.limit ? Number(opts.limit) : null
    },
    totals: {
      tags: rows.length,
      articles: new Set(items.map((i) => tagsToObject(i.tags)['Article-Key']).filter(Boolean)).size
    },
    tags: rows
  };
}

export function tagsToMarkdown(report) {
  const lines = [];
  lines.push('# PermaBrain Tags');
  lines.push('');
  lines.push(`- Generated: ${report.generatedAt}`);
  lines.push(`- Home: ${report.home || 'n/a'}`);
  if (Object.values(report.filters || {}).some((v) => v !== null && v !== undefined)) {
    lines.push(`- Filters: ${JSON.stringify(report.filters)}`);
  }
  lines.push(`- Tags: ${report.totals.tags}`);
  lines.push(`- Articles: ${report.totals.articles}`);
  lines.push('');

  if (!report.tags?.length) {
    lines.push('No custom tags found.');
    lines.push('');
    return lines.join('\n') + '\n';
  }

  lines.push('| Tag | Count | Unique keys | Unique values | Latest | Kinds | Top values |');
  lines.push('|-----|-------|-------------|---------------|--------|-------|------------|');
  for (const t of report.tags) {
    const kinds = Object.entries(t.byKind).map(([k, v]) => `${k}:${v}`).join(', ');
    const topValues = Object.entries(t.byValue).slice(0, 5).map(([k, v]) => `${k}=${v}`).join(', ');
    lines.push(`| ${t.name} | ${t.count} | ${t.uniqueKeys} | ${t.uniqueValues} | ${t.latestAt || 'n/a'} | ${kinds} | ${topValues} |`);
  }
  lines.push('');
  return lines.join('\n') + '\n';
}
