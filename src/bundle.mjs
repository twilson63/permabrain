import fs from 'node:fs';
import path from 'node:path';
import { parseAns104, verifyDataItem } from './dataitem.mjs';
import { tagsToObject } from './tags.mjs';
import { getTransport } from './transport.mjs';
import { getHome, loadConfig } from './config.mjs';
import { queryAttestationsForKey } from './attestation.mjs';

const BUNDLE_VERSION = 'permabrain-bundle/1.0.0';

export function buildBundle({ articles = [], attestations = [], meta = {} }) {
  const entries = [];
  const articleIds = new Set();

  for (const article of articles) {
    const raw = normalizeRaw(article);
    const parsed = parseAns104(raw);
    const id = parsed.id || tagsToObject(parsed.tags || [])['Bundle-Item-Id'];
    if (id) articleIds.add(id);
    entries.push({ type: 'article', id, data: raw.toString('base64') });
  }

  for (const attestation of attestations) {
    const raw = normalizeRaw(attestation);
    const parsed = parseAns104(raw);
    const tags = tagsToObject(parsed.tags || []);
    const target = tags['Attestation-Target'];
    entries.push({ type: 'attestation', target, data: raw.toString('base64') });
  }

  return {
    version: BUNDLE_VERSION,
    exportedAt: new Date().toISOString(),
    meta,
    entries
  };
}

function normalizeRaw(entry) {
  if (Buffer.isBuffer(entry)) return entry;
  if (entry && Buffer.isBuffer(entry.raw)) return entry.raw;
  throw new Error('Bundle entry must be a raw DataItem buffer or an object with raw');
}

export async function exportBundle({ key, id, includeAttestations = true, includeVersions = true, transport, home } = {}) {
  const h = home || getHome();
  const t = getTransport(loadConfig(h), h, { useHyperbeam: transport === true || transport === 'hyperbeam' });
  let dataItem;

  if (id) {
    dataItem = await t.getItem(id);
  } else if (key) {
    const resolved = await t.queryByKey(key);
    if (!resolved?.summary?.id) throw new Error(`No article found for key: ${key}`);
    dataItem = await t.getItem(resolved.summary.id);
  } else {
    throw new Error('exportBundle requires key or id');
  }

  if (!dataItem) throw new Error('Article not found');
  const raw = dataItem.ans104Base64 ? Buffer.from(dataItem.ans104Base64, 'base64url') : (Buffer.isBuffer(dataItem) ? dataItem : dataItem.raw);
  if (!raw) throw new Error('Could not retrieve raw DataItem');
  const parsed = parseAns104(raw);
  const tags = tagsToObject(parsed.tags || []);
  const articleKey = tags['Article-Key'];

  const articles = [raw];
  const attestations = [];

  if (includeVersions && articleKey) {
    const versionIds = await collectVersions(articleKey, parsed.id, t);
    for (const vid of versionIds) {
      if (vid === parsed.id) continue;
      const v = await t.getItem(vid);
      if (v) articles.push(v.ans104Base64 ? Buffer.from(v.ans104Base64, 'base64url') : (Buffer.isBuffer(v) ? v : v.raw));
    }
  }

  if (includeAttestations && articleKey) {
    const attestationItems = await queryAttestationsForKey(articleKey, { useHyperbeam: false, transport: h });
    const attRawItems = Array.isArray(attestationItems) ? attestationItems : attestationItems?.items || [];
    for (const a of attRawItems) {
      const attRaw = a.ans104Base64 ? Buffer.from(a.ans104Base64, 'base64url') : a.raw;
      if (attRaw) attestations.push(attRaw);
    }
  }

  return buildBundle({ articles, attestations, meta: { sourceKey: articleKey, rootId: parsed.id } });
}

export async function exportAllArticles({ includeAttestations = true, transport, home } = {}) {
  const h = home || getHome();
  const t = getTransport(loadConfig(h), h, { useHyperbeam: transport === true || transport === 'hyperbeam' });
  const articles = [];
  const attestations = [];
  const keys = new Set();

  const localArticles = await t.localIndex?.() || [];
  const articleKeys = [...new Set(localArticles.map(a => a.key).filter(Boolean))];

  for (const key of articleKeys) {
    try {
      const bundle = await exportBundle({ key, includeAttestations, includeVersions: true, transport });
      for (const e of bundle.entries) {
        if (e.type === 'article') {
          articles.push({ key, base64: e.data });
          keys.add(key);
        } else if (e.type === 'attestation') {
          attestations.push({ key, base64: e.data });
        }
      }
    } catch (err) {
      // skip missing/broken keys
    }
  }

  return {
    version: BUNDLE_VERSION,
    exportedAt: new Date().toISOString(),
    meta: { keys: Array.from(keys) },
    articles,
    attestations
  };
}

async function collectVersions(articleKey, rootId, transport) {
  const t = transport;
  const ids = new Set([rootId]);
  const tags = ['Article-Key', articleKey];
  let cursor;
  do {
    const page = await t.query({ tags, cursor, limit: 100 });
    if (!page?.items?.length) break;
    for (const item of page.items) {
      if (item.id) ids.add(item.id);
    }
    cursor = page.cursor;
  } while (cursor);
  return Array.from(ids);
}

export async function importBundle(bundle, { transport, home, verify = true, skipDuplicates = true } = {}) {
  const h = home || getHome();
  const t = getTransport(loadConfig(h), h, { useHyperbeam: transport === true || transport === 'hyperbeam' });
  const results = [];

  if (!bundle || typeof bundle !== 'object') throw new Error('importBundle requires a bundle object');

  const entries = bundle.entries || (bundle.articles && bundle.attestations
    ? [
        ...bundle.articles.map(a => ({ type: 'article', key: a.key, data: a.base64 })),
        ...bundle.attestations.map(a => ({ type: 'attestation', key: a.key, data: a.base64 }))
      ]
    : []);

  for (const entry of entries) {
    const raw = Buffer.from(entry.data, 'base64');
    if (verify) {
      const ok = await verifyDataItem(raw);
      if (!ok) {
        results.push({ type: entry.type, key: entry.key, ok: false, error: 'Signature verification failed' });
        continue;
      }
    }

    const parsed = parseAns104(raw);
    const tags = tagsToObject(parsed.tags || []);
    const id = parsed.id;

    if (entry.type === 'article') {
      const articleKey = tags['Article-Key'];
      const existing = await t.getItem(id).catch(() => null);
      if (skipDuplicates && existing) {
        results.push({ type: 'article', key: articleKey, id, ok: true, imported: false, note: 'already present' });
        continue;
      }
      const published = await t.submit(raw);
      results.push({ type: 'article', key: articleKey, id: published?.id || id, ok: true, imported: true });
    } else if (entry.type === 'attestation') {
      const target = tags['Attestation-Target'];
      const submitted = await t.submit(raw);
      results.push({ type: 'attestation', target, id: submitted?.id || id, ok: true, imported: true });
    } else {
      results.push({ type: entry.type, ok: false, error: 'Unknown bundle entry type' });
    }
  }

  return results;
}
