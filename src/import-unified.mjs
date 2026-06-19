/**
 * PermaBrain Unified Import
 *
 * Auto-detects the type of an imported bundle/envelope/share and routes it to
 * the correct importer. Supports dry-run previews, conflict detection, and
 * optional threshold-finalization / encrypted-share publication.
 *
 * Detected types:
 *   - article-bundle  -> importBundle()
 *   - history-bundle  -> importHistory()
 *   - threshold-envelope -> importThresholdEnvelope() (+ finalize if requested)
 *   - encrypted-share -> decrypt and optionally publish as article
 */

import fs from 'node:fs';
import { parseAns104, verifyDataItem } from './dataitem.mjs';
import { tagsToObject } from './tags.mjs';
import { getTransport } from './transport.mjs';
import { getHome, loadConfig } from './config.mjs';
import { importBundle } from './bundle.mjs';
import { importHistory } from './import-history.mjs';
import * as pbcrypto from './crypto.mjs';
import { publishArticle } from './article.mjs';

export const BUNDLE_TYPES = {
  ARTICLE: 'article-bundle',
  HISTORY: 'history-bundle',
  THRESHOLD: 'threshold-envelope',
  ENCRYPTED_SHARE: 'encrypted-share',
  UNKNOWN: 'unknown'
};

/**
 * Detect the type of an imported object.
 *
 * @param {Object} bundle
 * @returns {string} One of the BUNDLE_TYPES values.
 */
export function detectBundleType(bundle) {
  if (!bundle || typeof bundle !== 'object') return BUNDLE_TYPES.UNKNOWN;

  // Threshold envelope: has envelopeId, policy, digest, signers, targetKey.
  if (bundle.envelopeId && bundle.policy && bundle.digest && Array.isArray(bundle.signers) && bundle.targetKey) {
    return BUNDLE_TYPES.THRESHOLD;
  }

  // Encrypted share: has encryptedPayload and recipientFingerprints.
  if (bundle.encryptedPayload && Array.isArray(bundle.recipientFingerprints)) {
    return BUNDLE_TYPES.ENCRYPTED_SHARE;
  }

  // History bundle: explicit type === 'history'.
  if (bundle.type === 'history' || bundle.entryOrder === 'articles-by-version-then-attestations-by-id') {
    return BUNDLE_TYPES.HISTORY;
  }

  // Article bundle: version, entries array with article/attestation items.
  if (bundle.version && Array.isArray(bundle.entries)) {
    return BUNDLE_TYPES.ARTICLE;
  }

  // Legacy export-all shape: articles + attestations arrays.
  if (Array.isArray(bundle.articles) || Array.isArray(bundle.attestations)) {
    return BUNDLE_TYPES.ARTICLE;
  }

  return BUNDLE_TYPES.UNKNOWN;
}

function normalizeBundleInput(input) {
  if (typeof input === 'string') {
    return JSON.parse(fs.readFileSync(input, 'utf8'));
  }
  return input;
}

function parseBundleEntry(entry) {
  const raw = Buffer.from(entry.data || entry.base64 || entry.ans104Base64, 'base64');
  const parsed = parseAns104(raw);
  const tags = tagsToObject(parsed.tags || []);
  return { raw, parsed, tags, id: parsed.id };
}

async function checkLocalPresence(home, id) {
  try {
    const config = loadConfig(home);
    const t = getTransport(config, home, {});
    const existing = await t.getItem(id);
    return !!existing;
  } catch {
    return false;
  }
}

async function previewArticleBundle(bundle, home, verify) {
  const entries = bundle.entries || [
    ...(bundle.articles || []).map(a => ({ type: 'article', key: a.key, data: a.base64 })),
    ...(bundle.attestations || []).map(a => ({ type: 'attestation', key: a.key, data: a.base64 }))
  ];
  const items = [];
  for (const entry of entries) {
    try {
      const { raw, parsed, tags, id } = parseBundleEntry(entry);
      const type = tags['PermaBrain-Type'] || entry.type;
      const key = tags['Article-Key'] || tags['Attestation-Target-Key'] || entry.key || entry.target;
      const signatureOk = verify ? await verifyDataItem(raw) : null;
      const exists = await checkLocalPresence(home, id);
      items.push({
        type,
        key,
        id,
        action: exists ? 'skip' : 'import',
        exists,
        signatureOk,
        error: verify && !signatureOk ? 'Signature verification failed' : null
      });
    } catch (err) {
      items.push({ type: entry.type, key: entry.key, id: null, action: 'error', error: err.message });
    }
  }
  return items;
}

async function previewHistoryBundle(bundle, home, verify) {
  const items = [];
  for (const entry of bundle.entries || []) {
    try {
      const { raw, parsed, tags, id } = parseBundleEntry(entry);
      const type = tags['PermaBrain-Type'] || entry.type;
      const key = tags['Article-Key'] || tags['Attestation-Target-Key'] || entry.key;
      const signatureOk = verify ? await verifyDataItem(raw) : null;
      const exists = await checkLocalPresence(home, id);
      items.push({
        type,
        key,
        id,
        action: exists ? 'skip' : 'import',
        exists,
        signatureOk,
        error: verify && !signatureOk ? 'Signature verification failed' : null
      });
    } catch (err) {
      items.push({ type: entry.type, key: entry.key, id: null, action: 'error', error: err.message });
    }
  }
  return items;
}

async function previewThresholdEnvelope(envelope) {
  const { verifyThresholdEnvelope } = await import('./threshold-attestation.mjs');
  const verification = await verifyThresholdEnvelope(envelope);
  return {
    type: BUNDLE_TYPES.THRESHOLD,
    envelopeId: envelope.envelopeId,
    targetKey: envelope.targetKey,
    threshold: envelope.policy.threshold,
    signatures: envelope.signers.length,
    validSignatures: verification.valid,
    thresholdMet: verification.ok,
    action: verification.ok ? 'ready-to-finalize' : 'pending-signatures',
    invalidSignerIds: verification.invalid
  };
}

function previewEncryptedShare(bundle, seed) {
  return {
    type: BUNDLE_TYPES.ENCRYPTED_SHARE,
    key: bundle.key,
    title: bundle.title,
    kind: bundle.kind,
    topic: bundle.topic,
    agentId: bundle.agentId,
    recipientCount: bundle.recipientFingerprints?.length || 0,
    canDecrypt: !!seed,
    action: seed ? 'decrypt-and-publish' : 'needs-seed'
  };
}

function buildDryRunReport(type, items, extras = {}) {
  const imported = items.filter(i => i.action === 'import').length;
  const skipped = items.filter(i => i.action === 'skip').length;
  const failed = items.filter(i => i.action === 'error' || i.error).length;
  return {
    dryRun: true,
    type,
    imported,
    skipped,
    failed,
    items,
    ...extras
  };
}

/**
 * Import a bundle/envelope/share, auto-detecting its type.
 *
 * @param {Object|string} input - Bundle object or path to JSON file.
 * @param {Object} [opts]
 * @param {string} [opts.home] - PermaBrain home directory.
 * @param {boolean} [opts.dryRun=false] - Preview only; do not mutate state.
 * @param {boolean} [opts.verify=true] - Verify DataItem signatures on bundles.
 * @param {boolean} [opts.skipDuplicates=true] - Skip duplicate DataItems on bundles.
 * @param {boolean} [opts.finalize=false] - For threshold envelopes, finalize if threshold met.
 * @param {string|Uint8Array} [opts.seed] - For encrypted shares, X25519 recipient seed.
 * @param {boolean} [opts.publish=true] - For encrypted shares, publish decrypted article locally.
 * @param {boolean} [opts.useHyperbeam=false]
 * @returns {Promise<Object>} Import report.
 */
export async function importBundleAutoDetect(input, opts = {}) {
  const bundle = normalizeBundleInput(input);
  const type = detectBundleType(bundle);
  const home = opts.home || getHome();
  const verify = opts.verify !== false;
  const skipDuplicates = opts.skipDuplicates !== false;

  if (type === BUNDLE_TYPES.UNKNOWN) {
    throw new Error('Unable to detect import type: unrecognized bundle shape');
  }

  if (type === BUNDLE_TYPES.THRESHOLD) {
    const { importThresholdEnvelope, finalizeThresholdAttestation, verifyThresholdEnvelope } = await import('./threshold-attestation.mjs');
    const preview = await previewThresholdEnvelope(bundle);
    if (opts.dryRun) {
      return buildDryRunReport(type, [], preview);
    }
    const stored = importThresholdEnvelope(bundle);
    const result = {
      type,
      envelopeId: stored.envelopeId,
      targetKey: stored.targetKey,
      imported: true,
      finalized: false
    };
    if (opts.finalize) {
      const verification = await verifyThresholdEnvelope(stored);
      if (!verification.ok) {
        throw new Error(`Threshold not met: ${verification.valid}/${verification.required} signatures`);
      }
      const finalized = await finalizeThresholdAttestation(stored.envelopeId, { useHyperbeam: opts.useHyperbeam ?? false });
      result.finalized = true;
      result.itemId = finalized.item.id;
      result.summary = finalized.summary;
    }
    return result;
  }

  if (type === BUNDLE_TYPES.ENCRYPTED_SHARE) {
    const preview = previewEncryptedShare(bundle, opts.seed);
    if (opts.dryRun) {
      return buildDryRunReport(type, [], preview);
    }
    if (!opts.seed) {
      throw new Error('Encrypted share requires --seed (recipient X25519 seed) to import');
    }
    const seedBytes = typeof opts.seed === 'string' ? Buffer.from(opts.seed, 'base64url') : opts.seed;
    const decrypted = await pbcrypto.decrypt(bundle.encryptedPayload, seedBytes);
    const result = {
      type,
      key: bundle.key,
      title: bundle.title,
      kind: bundle.kind,
      topic: bundle.topic,
      agentId: bundle.agentId,
      decrypted: true,
      published: false
    };
    if (opts.publish !== false) {
      const published = await publishArticle({
        content: decrypted.content || decrypted,
        kind: bundle.kind,
        topic: bundle.topic,
        key: bundle.key,
        title: bundle.title,
        sourceUrl: bundle.sourceUrl,
        visibility: 'encrypted',
        home
      });
      result.published = true;
      result.articleId = published.summary.id;
      result.summary = published.summary;
    }
    return result;
  }

  if (type === BUNDLE_TYPES.HISTORY) {
    const items = await previewHistoryBundle(bundle, home, verify);
    if (opts.dryRun) {
      return buildDryRunReport(type, items);
    }
    const importOpts = { home, verify, skipDuplicates, useHyperbeam: opts.useHyperbeam ?? false };
    const historyResult = await importHistory(bundle, importOpts);
    return {
      type,
      importedArticles: historyResult.importedArticles,
      importedAttestations: historyResult.importedAttestations,
      skipped: historyResult.results?.filter(r => r.ok && !r.imported).length || 0,
      failed: historyResult.results?.filter(r => !r.ok).length || 0,
      results: historyResult.results
    };
  }

  if (type === BUNDLE_TYPES.ARTICLE) {
    const items = await previewArticleBundle(bundle, home, verify);
    if (opts.dryRun) {
      return buildDryRunReport(type, items);
    }
    const importOpts = { home, verify, skipDuplicates, useHyperbeam: opts.useHyperbeam ?? false };
    const bundleResult = await importBundle(bundle, importOpts);
    return {
      type,
      imported: bundleResult.filter(r => r.ok && r.imported).length,
      skipped: bundleResult.filter(r => r.ok && !r.imported).length,
      failed: bundleResult.filter(r => !r.ok).length,
      results: bundleResult
    };
  }

  throw new Error(`Unhandled import type: ${type}`);
}

/**
 * Render an import report as markdown.
 *
 * @param {Object} report
 * @returns {string}
 */
export function importReportToMarkdown(report) {
  const lines = [
    '# PermaBrain Import Report',
    '',
    `- Type: ${report.type}`,
    `- Dry run: ${report.dryRun ? 'yes' : 'no'}`,
  ];
  if (report.imported !== undefined) lines.push(`- Imported: ${report.imported}`);
  if (report.skipped !== undefined) lines.push(`- Skipped: ${report.skipped}`);
  if (report.failed !== undefined) lines.push(`- Failed: ${report.failed}`);
  if (report.importedArticles !== undefined) lines.push(`- Articles imported: ${report.importedArticles}`);
  if (report.importedAttestations !== undefined) lines.push(`- Attestations imported: ${report.importedAttestations}`);
  if (report.envelopeId) lines.push(`- Envelope: ${report.envelopeId}`);
  if (report.finalized !== undefined) lines.push(`- Finalized: ${report.finalized ? 'yes' : 'no'}`);
  if (report.itemId) lines.push(`- Item ID: ${report.itemId}`);
  if (report.key) lines.push(`- Key: ${report.key}`);
  if (report.decrypted !== undefined) lines.push(`- Decrypted: ${report.decrypted ? 'yes' : 'no'}`);
  if (report.published !== undefined) lines.push(`- Published: ${report.published ? 'yes' : 'no'}`);
  if (report.articleId) lines.push(`- Article ID: ${report.articleId}`);

  if (report.items && report.items.length) {
    lines.push('', '| Type | Key | Action | ID | Exists | Signature | Error |');
    lines.push('|------|-----|--------|----|--------|-----------|-------|');
    for (const item of report.items) {
      const sig = item.signatureOk === null ? 'n/a' : (item.signatureOk ? 'ok' : 'fail');
      lines.push(`| ${item.type || ''} | ${item.key || ''} | ${item.action || ''} | ${item.id || ''} | ${item.exists ? 'yes' : 'no'} | ${sig} | ${item.error || ''} |`);
    }
  }

  return lines.join('\n') + '\n';
}
