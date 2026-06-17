/**
 * PermaBrain Import History
 *
 * Imports a history bundle produced by exportHistory() into the local store,
 * preserving version ordering and merging/updating the local index.  Each entry
 * is a raw ANS-104 DataItem so the same verification logic used by importBundle()
 * applies.
 *
 * Responsibilities:
 *   - Verify each DataItem signature when opts.verify !== false.
 *   - Replay articles in version order (using Article-Version tag) so the
 *     version chain and root/previous links are coherent in the local store.
 *   - Replay attestations after articles so their target IDs resolve.
 *   - Update the local cache index with articles and attestations.
 *   - Skip duplicates already present in the local store.
 *   - Return a structured report: counts, per-entry results, and meta match.
 */

import { parseAns104, verifyDataItem } from './dataitem.mjs';
import { tagsToObject } from './tags.mjs';
import { getTransport } from './transport.mjs';
import { getHome, loadConfig } from './config.mjs';
import { summarizeArticle, summarizeAttestation, updateArticleInCache, updateAttestationInCache } from './cache.mjs';

export async function importHistory(bundle, opts = {}) {
  if (!bundle || typeof bundle !== 'object') throw new Error('importHistory requires a bundle object');
  if (!Array.isArray(bundle.entries) || bundle.entries.length === 0) {
    throw new Error('History bundle has no entries');
  }

  const home = opts.home || getHome();
  const config = opts.config || loadConfig(home);
  const transport = opts.transport || getTransport(config, home, { useHyperbeam: opts.useHyperbeam });
  const verify = opts.verify !== false;
  const skipDuplicates = opts.skipDuplicates !== false;

  // Validate determinism markers if present.
  if (bundle.type && bundle.type !== 'history') {
    throw new Error(`Expected history bundle, got type '${bundle.type}'`);
  }
  if (bundle.deterministic && bundle.entryOrder !== 'articles-by-version-then-attestations-by-id') {
    throw new Error(`Unexpected history bundle entryOrder: ${bundle.entryOrder}`);
  }

  const results = [];
  const articleEntries = [];
  const attestationEntries = [];

  // Parse and classify entries, normalizing base64 data to raw buffers.
  for (const entry of bundle.entries) {
    const raw = Buffer.from(entry.data, 'base64');
    const parsed = parseAns104(raw);
    const tags = tagsToObject(parsed.tags || []);
    const type = tags['PermaBrain-Type'] || entry.type;
    if (type === 'article') {
      articleEntries.push({ raw, parsed, tags, version: Number(tags['Article-Version'] || 1) });
    } else if (type === 'attestation') {
      attestationEntries.push({ raw, parsed, tags });
    } else {
      results.push({ type, ok: false, error: `Unknown PermaBrain-Type: ${type}` });
    }
  }

  // Sort articles by version ascending to preserve chain order on replay.
  articleEntries.sort((a, b) => a.version - b.version);

  // Import articles first.
  for (const { raw, parsed, tags } of articleEntries) {
    const result = await importOne(raw, parsed, tags, 'article', { transport, home, verify, skipDuplicates });
    results.push(result);
  }

  // Import attestations after articles.
  for (const { raw, parsed, tags } of attestationEntries) {
    const result = await importOne(raw, parsed, tags, 'attestation', { transport, home, verify, skipDuplicates });
    results.push(result);
  }

  const importedArticles = results.filter((r) => r.type === 'article' && r.imported).length;
  const importedAttestations = results.filter((r) => r.type === 'attestation' && r.imported).length;
  const skippedArticles = results.filter((r) => r.type === 'article' && r.ok && !r.imported).length;
  const skippedAttestations = results.filter((r) => r.type === 'attestation' && r.ok && !r.imported).length;
  const failed = results.filter((r) => !r.ok).length;

  // Record a local audit event for the import-history action.
  try {
    const { logAction } = await import('./log.mjs');
    logAction({ home, action: 'import', status: failed === 0 ? 'ok' : 'error', message: `Imported history bundle: ${importedArticles} articles, ${importedAttestations} attestations`, details: { importedArticles, importedAttestations, skippedArticles, skippedAttestations, failed } });
  } catch {
    // Audit logging is best-effort.
  }

  return {
    ok: failed === 0,
    meta: bundle.meta || null,
    importedArticles,
    importedAttestations,
    skippedArticles,
    skippedAttestations,
    failed,
    results
  };
}

async function importOne(raw, parsed, tags, type, { transport, home, verify, skipDuplicates }) {
  const id = parsed.id;
  try {
    if (verify) {
      const ok = await verifyDataItem(raw);
      if (!ok) return { type, id, ok: false, error: 'Signature verification failed' };
    }

    const existing = await transport.getItem(id).catch(() => null);
    if (skipDuplicates && existing) {
      return { type, id, ok: true, imported: false, note: 'already present' };
    }

    await transport.submit(raw);

    if (type === 'article') {
      const item = buildStoredItem(raw, parsed, tags);
      updateArticleInCache(home, item);
      const summary = summarizeArticle(item);
      return { type, id, key: summary.key, ok: true, imported: true, version: summary.version };
    }

    if (type === 'attestation') {
      const item = buildStoredItem(raw, parsed, tags);
      updateAttestationInCache(home, item);
      const summary = summarizeAttestation(item);
      return { type, id, targetKey: summary.targetKey, targetId: summary.targetId, ok: true, imported: true };
    }

    return { type, id, ok: false, error: 'Unknown entry type' };
  } catch (err) {
    return { type, id, ok: false, error: err.message };
  }
}

function buildStoredItem(raw, parsed, tags) {
  return {
    format: 'ans104@1.0',
    id: parsed.id,
    owner: parsed.owner,
    timestamp: tags['Article-Updated-At'] || tags['Attestation-Created-At'] || new Date().toISOString(),
    tags: parsed.tags,
    payloadBase64: parsed.rawData.toString('base64url'),
    ans104Base64: raw.toString('base64url'),
    signature: parsed.signature,
    publicKey: parsed.owner
  };
}
