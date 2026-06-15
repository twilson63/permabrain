/**
 * HyperBEAM Reference Device Integration
 *
 * Implements ~reference@1.0 support for PermaBrain articles and attestations.
 *
 * A reference gives an immutable ID a mutable value — perfect for
 * PermaBrain articles where the canonical key (e.g., "subject/karpathy-llm-wiki")
 * should always point to the latest version.
 *
 * Reference resolution chains:
 *   GET /<set>~reference@1.0/alice/balance
 *   → set resolves alice → her ref → balance
 *
 * Each downstream reference is owned and updated independently.
 * This is how PermaBrain manages evolving articles: the article key
 * is a reference that always points to the current version.
 *
 * Also integrates with @permaweb/references for Arweave-layer
 * reference reads/writes when not on a HyperBEAM node.
 *
 * @see https://github.com/samcamwilliams/reference-1.0
 * @see https://github.com/permaweb/permaweb-references
 */

import { createDataItem } from './dataitem.mjs';
import { DEVICES, referenceUrl } from './hb-devices.mjs';

// Default DataItem builder; tests can override via setDataItemBuilder.
let buildDataItem = null;

export function setDataItemBuilder(fn) {
  buildDataItem = fn;
}

async function createReferenceDataItem({ payload, tags, identity }) {
  if (buildDataItem) return buildDataItem({ payload, tags, identity });
  const { createDataItem } = await import('./dataitem.mjs');
  return createDataItem({ payload, tags, identity });
}

/**
 * Manages ~reference@1.0 operations on a HyperBEAM node.
 *
 * Reference lifecycle:
 * 1. init — Create a reference with an initial value (signed by authority)
 * 2. set — Update the reference value (signed by authority, with timestamp)
 * 3. read — Resolve the current value via GET /{refId}~reference@1.0[/{path}]
 *
 * For PermaBrain:
 * - Article keys are references: "subject/karpathy-llm-wiki" → latest version ID
 * - Author identity references: author agent ID → latest attestation
 * - Topic directories: reference sets mapping topic names to article references
 */
export class HyperbeamReference {
  constructor(baseUrl, config = {}) {
    this.baseUrl = baseUrl;
    this.config = config;
  }

  /**
   * Create a new reference on the HyperBEAM node.
   *
   * Sends a signed init message that establishes the reference's permanent ID
   * and initial value. The signing address becomes the reference authority.
   *
   * @param {Object} value - The initial reference value (can be a directory mapping)
   * @param {Object} signer - DataItem signer for signing the init message
   * @param {Object} [opts] - Options
   * @param {string} [opts.authority] - Explicit authority (defaults to signer address)
   * @returns {Promise<{referenceId: string, value: Object}>}
   */
  async create(value, signer, opts = {}) {
    const tags = [
      { name: 'Data-Protocol', value: 'ao' },
      { name: 'Type', value: 'Message' },
      { name: 'Variant', value: 'ao.TN.1' },
      { name: 'device', value: DEVICES.reference },
      ...Object.entries(value).map(([k, v]) => ({
        name: `reference-value-${k}`,
        value: typeof v === 'string' ? v : JSON.stringify(v),
      })),
    ];
    if (opts.authority) {
      tags.push({ name: 'authority', value: opts.authority });
    }

    const item = await createReferenceDataItem({ payload: JSON.stringify(value), tags, identity: signer });
    const bytes = Buffer.from(item.ans104Base64, 'base64url');

    const res = await fetch(`${this.baseUrl}/${DEVICES.bundler}/tx?codec-device=ans104@1.0`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: new Blob([bytes], { type: 'application/octet-stream' }),
    });
    if (!res.ok) throw new Error(`Reference init upload failed: HTTP ${res.status}`);

    return { referenceId: item.id, value };
  }

  /**
   * Update a reference's value.
   *
   * Sends a signed set message with a newer timestamp.
   * Only the authority can update a reference.
   *
   * @param {string} referenceId - The permanent reference ID
   * @param {Object} value - The new value
   * @param {Object} signer - DataItem signer (must be the authority)
   * @param {Object} [opts] - Options
   * @param {number} [opts.timestamp] - Explicit timestamp (default: Date.now())
   * @returns {Promise<{referenceId: string, value: Object, timestamp: number}>}
   */
  async update(referenceId, value, signer, opts = {}) {
    const timestamp = opts.timestamp || Date.now();
    const tags = [
      { name: 'Data-Protocol', value: 'ao' },
      { name: 'Type', value: 'Message' },
      { name: 'Variant', value: 'ao.TN.1' },
      { name: 'device', value: DEVICES.reference },
      { name: 'reference-id', value: referenceId },
      { name: 'timestamp', value: String(timestamp) },
      ...Object.entries(value).map(([k, v]) => ({
        name: `reference-value-${k}`,
        value: typeof v === 'string' ? v : JSON.stringify(v),
      })),
    ];

    const item = await createReferenceDataItem({ payload: JSON.stringify(value), tags, identity: signer });
    const bytes = Buffer.from(item.ans104Base64, 'base64url');

    const res = await fetch(`${this.baseUrl}/${DEVICES.bundler}/tx?codec-device=ans104@1.0`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: new Blob([bytes], { type: 'application/octet-stream' }),
    });
    if (!res.ok) throw new Error(`Reference set upload failed: HTTP ${res.status}`);

    return { referenceId, value, timestamp };
  }

  /**
   * Resolve a reference's current value.
   *
   * GET /{refId}~reference@1.0[/{path}]
   *
   * Resolution chains through nested references:
   * If the value is a directory { alice: { device: "~reference@1.0", reference-id: "..." } },
   * resolving a path like /alice/balance follows each pointer.
   *
   * @param {string} referenceId - The reference's permanent ID
   * @param {string} [path] - Optional sub-path within the reference value
   * @returns {Promise<Object>} The resolved value
   */
  async resolve(referenceId, path = '') {
    const url = referenceUrl(this.baseUrl, referenceId, path);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Reference resolve failed: HTTP ${res.status} for ${url}`);
    const text = await res.text();
    try { return JSON.parse(text); } catch { return text; }
  }

  /**
   * Create a PermaBrain article reference.
   *
   * A reference that maps an article key (e.g., "subject/karpathy-llm-wiki")
   * to the latest version DataItem ID. When an article is updated, the reference
   * is updated to point to the new version.
   *
   * @param {string} articleKey - Canonical article key
   * @param {string} articleId - DataItem ID of the current article version
   * @param {Object} signer - DataItem signer
   * @returns {Promise<{referenceId: string, value: Object}>}
   */
  async createArticleReference(articleKey, articleId, signer) {
    return this.create(
      { 'article-key': articleKey, 'current-version': articleId },
      signer,
    );
  }

  /**
   * Update a PermaBrain article reference to point to a new version.
   *
   * @param {string} referenceId - The article key reference ID
   * @param {string} newArticleId - DataItem ID of the new version
   * @param {Object} signer - DataItem signer (must be the reference authority)
   * @returns {Promise<{referenceId: string, value: Object, timestamp: number}>}
   */
  async updateArticleReference(referenceId, newArticleId, signer) {
    return this.update(referenceId, { 'current-version': newArticleId }, signer);
  }

  /**
   * Create a reference set (directory of references).
   *
   * A reference set maps names to pointers at other references.
   * This is how PermaBrain can manage topic directories, author indices,
   * and other namespace structures.
   *
   * Example: a topic reference set:
   * {
   *   "ai": { device: "~reference@1.0", reference-id: "<ai-topic-ref>" },
   *   "crypto": { device: "~reference@1.0", reference-id: "<crypto-topic-ref>" }
   * }
   *
   * Resolution: GET /<set>~reference@1.0/ai → resolves to ai topic
   *
   * @param {Object<string, string>} directory - Name → reference ID mapping
   * @param {Object} signer - DataItem signer
   * @returns {Promise<{referenceId: string, value: Object}>}
   */
  async createSet(directory, signer) {
    const value = {};
    for (const [name, refId] of Object.entries(directory)) {
      value[name] = { device: DEVICES.reference.slice(1), 'reference-id': refId };
    }
    return this.create(value, signer);
  }
}

/**
 * PermaBrain reference naming conventions.
 *
 * Reference IDs are permanent; the value is mutable. PermaBrain uses
 * references to give stable, human-readable keys to evolving content:
 *
 * Article key → reference → latest version DataItem ID
 * Topic index → reference set → { "ai": ref_id, "crypto": ref_id, ... }
 * Author identity → reference → latest attestation ID
 *
 * The reference@1.0 device makes this pattern first-class on HyperBEAM:
 * - No extra indexing infrastructure (unlike match-only approach)
 * - Resolution chains compose naturally
 * - Each reference is independently owned and updated
 * - The node handles caching and freshness (max-age)
 */