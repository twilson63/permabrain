/**
 * PermaBrain Export History
 *
 * Build a deterministic, verifiable bundle of a single article's full version
 * chain plus all attestations targeting those versions. The output is an
 * extended bundle that can be imported by another PermaBrain node with
 * importBundle().
 *
 * Determinism:
 *   - Entries are sorted by type (articles first, attestations second), then
 *     by DataItem ID base64url lexicographically.
 *   - No timestamps, random fields, or local paths leak into bundle.meta beyond
 *     the explicit source key, root ID, and version range.
 *
 * Verifiability:
 *   - Each bundle entry is the raw ANS-104 DataItem bytes (base64-encoded).
 *   - Signatures are preserved; importBundle() can verify each entry.
 *
 * Extensibility:
 *   - version is permabrain-bundle/1.0.0 (same as generic bundle export).
 *   - type is history so importers can treat this as a full chain.
 */

import { getHome, loadConfig } from './config.mjs';
import { getTransport } from './transport.mjs';
import { buildVersionChain, summarizeVersion } from './history.mjs';
import { queryAttestationsForKey } from './attestation.mjs';
import { parseAns104, verifyDataItem } from './dataitem.mjs';
import { tagsToObject } from './tags.mjs';
import { buildBundle } from './bundle.mjs';

const HISTORY_BUNDLE_VERSION = 'permabrain-bundle/1.0.0';

export async function exportHistory(key, opts = {}) {
  if (!key) throw new Error('exportHistory requires a canonical article key');
  const home = opts.home || getHome();
  const config = opts.config || loadConfig(home);
  const transport = opts.transport || getTransport(config, home, { useHyperbeam: opts.useHyperbeam });

  // 1. Collect the full version chain in order.
  const versionItems = await buildVersionChain(key, { ...opts, transport, home });
  if (versionItems.length === 0) throw new Error(`No versions found for key: ${key}`);

  const versionSummaries = versionItems.map(summarizeVersion);
  const versionIds = new Set(versionSummaries.map((v) => v.id));
  const rootSummary = versionSummaries[0];
  const latestSummary = versionSummaries[versionSummaries.length - 1];

  // 2. Collect every attestation targeting this key, then filter to those whose
  //    Attestation-Target-Id matches a version in the chain. This is more
  //    reliable than per-version queries on transports that don't index targetId.
  const attestationItems = await queryAttestationsForKey(key, { ...opts, transport, home });
  const historyAttestations = attestationItems.filter((item) => {
    const tags = tagsToObject(item.tags || []);
    const targetId = tags['Attestation-Target-Id'];
    return targetId && versionIds.has(targetId);
  });

  // 3. Resolve raw DataItem bytes for every item.
  const articleRaws = [];
  for (const item of versionItems) {
    const raw = await resolveRaw(item, transport);
    if (!raw) throw new Error(`Could not resolve raw bytes for article version ${item.id}`);
    articleRaws.push(raw);
  }

  const attestationRaws = [];
  for (const item of historyAttestations) {
    const raw = await resolveRaw(item, transport);
    if (!raw) throw new Error(`Could not resolve raw bytes for attestation ${item.id}`);
    attestationRaws.push(raw);
  }

  // 4. Sort for determinism: articles by version asc, attestations by ID.
  const sortedArticles = versionRawsWithVersion(articleRaws, versionSummaries).sort((a, b) => a.version - b.version);
  const sortedAttestationRaws = attestationRaws.slice().sort((a, b) => {
    const idA = idFromRaw(a);
    const idB = idFromRaw(b);
    return String(idA).localeCompare(String(idB));
  });

  // 5. Verify each entry in this local node before exporting.
  if (opts.verify !== false) {
    for (const { raw } of sortedArticles) await verifyOrThrow(raw, 'article');
    for (const raw of sortedAttestationRaws) await verifyOrThrow(raw, 'attestation');
  }

  // 6. Build a deterministic meta block.
  const meta = {
    sourceKey: key,
    rootId: rootSummary.id,
    latestId: latestSummary.id,
    versionRange: { min: rootSummary.version, max: latestSummary.version },
    type: 'history',
    exportedBy: opts.includeExporter !== false ? config.identity?.agentId || null : null,
    entryCount: {
      articles: sortedArticles.length,
      attestations: sortedAttestationRaws.length
    }
  };

  const bundle = buildBundle({
    articles: sortedArticles.map((a) => a.raw),
    attestations: sortedAttestationRaws,
    meta
  });

  // Override bundle version with our history marker. buildBundle sets
  // permabrain-bundle/1.0.0 already; keep it compatible.
  bundle.version = HISTORY_BUNDLE_VERSION;
  bundle.type = 'history';
  bundle.exportedAt = new Date().toISOString();
  bundle.deterministic = true;
  bundle.entryOrder = 'articles-by-version-then-attestations-by-id';

  // Record a local audit event for the export-history action.
  try {
    const { logAction } = await import('./log.mjs');
    logAction({ home, action: 'export', status: 'ok', key, message: `Exported history for ${key}`, details: { versions: sortedArticles.length, attestations: sortedAttestationRaws.length, rootId: rootSummary.id } });
  } catch {
    // Audit logging is best-effort.
  }

  return bundle;
}

async function resolveRaw(item, transport) {
  if (Buffer.isBuffer(item)) return item;
  if (item.ans104Base64) return Buffer.from(item.ans104Base64, 'base64url');
  if (item.raw && Buffer.isBuffer(item.raw)) return item.raw;
  if (item.id) {
    const fetched = await transport.getItem(item.id).catch(() => null);
    if (fetched) return resolveRaw(fetched, transport);
  }
  return null;
}

function versionRawsWithVersion(raws, summaries) {
  const byId = new Map(summaries.map((s) => [s.id, s.version]));
  return raws.map((raw) => {
    const id = idFromRaw(raw);
    return { raw, version: byId.get(id) || 0, id };
  });
}

function idFromRaw(raw) {
  const parsed = parseAns104(raw);
  return parsed.id || tagsToObject(parsed.tags || [])['Bundle-Item-Id'] || null;
}

async function verifyOrThrow(raw, label) {
  const ok = await verifyDataItem(raw);
  if (!ok) {
    const parsed = parseAns104(raw);
    throw new Error(`${label} DataItem signature verification failed: ${parsed.id || '(unknown)'}`);
  }
}
