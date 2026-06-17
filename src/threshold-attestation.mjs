/**
 * PermaBrain Threshold / Multi-Sig Attestation Support
 *
 * Implements collective attestations that require M-of-N co-signers to be
 * considered valid. Each co-signer contributes a signature over the same
 * attestation payload. Once the threshold is met, the aggregated attestation
 * is published as a single ANS-104 DataItem signed by the local identity.
 *
 * Tags encode the threshold policy and co-signer identities so consensus and
 * verification can treat the attestation as a multi-sig object.
 *
 * Two flows:
 *   1. **Local aggregation**: collect signatures via `addCoSigner`, publish
 *      via `publishThresholdAttestation`.
 *   2. **External rounds**: create a partially-signed envelope, share it with
 *      co-signers, and finalize with `finalizeThresholdEnvelope`.
 */

import { getHome, loadConfig } from './config.mjs';
import { loadIdentity } from './keys.mjs';
import { createDataItem, verifyDataItem } from './dataitem.mjs';
import { getTransport } from './transport.mjs';
import { buildAttestationTags, tagsToObject } from './tags.mjs';
import { updateAttestationInCache, summarizeAttestation } from './cache.mjs';
import { resolveLatestArticle } from './article.mjs';
import crypto from 'node:crypto';

// In-memory pending envelopes per process. Not persisted.
const pendingEnvelopes = new Map();

/**
 * Validate and normalize a threshold policy.
 * @param {Object} policy
 * @param {number} policy.threshold - Required number of distinct signatures
 * @param {string[]} policy.coSignerAgentIds - Allowed co-signer agent ids
 * @returns {{threshold:number, coSignerAgentIds:string[]}}
 */
export function normalizeThresholdPolicy(policy = {}) {
  if (!policy || typeof policy !== 'object') throw new Error('threshold policy is required');
  const threshold = Number(policy.threshold);
  if (!Number.isInteger(threshold) || threshold < 1) throw new Error('threshold must be a positive integer');
  const coSignerAgentIds = Array.isArray(policy.coSignerAgentIds) ? policy.coSignerAgentIds.filter(Boolean) : [];
  if (threshold > Math.max(1, coSignerAgentIds.length)) {
    throw new Error(`threshold ${threshold} exceeds co-signer count ${coSignerAgentIds.length}`);
  }
  return { threshold, coSignerAgentIds };
}

/**
 * Build a canonical digest for threshold co-signing.
 * The digest binds the attestation payload fields and the threshold policy
 * so co-signers cannot be replayed across different attestations or policies.
 *
 * @param {Object} params
 * @returns {Buffer}
 */
export function thresholdAttestationDigest({ targetId, targetKey, opinion, confidence, reason, sourceUrl = '', threshold, coSignerAgentIds, now }) {
  const canonical = JSON.stringify({
    targetId,
    targetKey,
    opinion,
    confidence: Number(confidence),
    reason,
    sourceUrl,
    threshold,
    coSignerAgentIds: [...coSignerAgentIds].sort(),
    now
  });
  return crypto.createHash('sha256').update(canonical).digest();
}

/**
 * Sign the threshold attestation digest with an identity.
 *
 * @param {Object} identity - Ed25519 or Arweave identity
 * @param {Buffer} digest
 * @returns {{agentId:string, signatureType:string, signature:string}}
 */
export async function signThresholdDigest(identity, digest) {
  if (!identity || typeof identity !== 'object') throw new Error('identity is required');

  let signature;
  let signatureType;

  if (identity.type === 'ed25519') {
    const secretKey = Buffer.from(identity.secretKey, 'base64url');
    const publicKey = Buffer.from(identity.publicKey, 'base64url');
    const ed25519 = await import('@noble/ed25519');
    const crypto = await import('node:crypto');
    ed25519.hashes.sha512 = (message) => crypto.createHash('sha512').update(message).digest();
    signature = Buffer.from(await ed25519.sign(digest, secretKey)).toString('base64url');
    signatureType = 'ed25519';
  } else if (identity.type === 'arweave-rsa4096' && identity.jwk) {
    const crypto = await import('node:crypto');
    const privateKey = crypto.createPrivateKey({ key: identity.jwk, format: 'jwk' });
    signature = crypto.sign('sha256', digest, { key: privateKey, padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 }).toString('base64url');
    signatureType = 'arweave-rsa4096';
  } else {
    throw new Error(`Unsupported identity type '${identity.type}' for threshold signing`);
  }

  return {
    agentId: identity.agentId,
    signatureType,
    signature
  };
}

/**
 * Verify a threshold co-signer signature.
 *
 * @param {Buffer} digest
 * @param {{agentId:string, signatureType:string, signature:string, publicKey?:string}} signer
 * @returns {boolean}
 */
export async function verifyThresholdSignature(digest, signer) {
  if (!signer?.signature || !signer?.signatureType || !signer?.agentId) return false;
  if (signer.signatureType === 'ed25519') {
    if (!signer.publicKey) return false;
    try {
      const publicKey = Buffer.from(signer.publicKey, 'base64url');
      const sig = Buffer.from(signer.signature, 'base64url');
      const ed25519 = await import('@noble/ed25519');
      const crypto = await import('node:crypto');
      ed25519.hashes.sha512 = (message) => crypto.createHash('sha512').update(message).digest();
      return ed25519.verify(sig, digest, publicKey);
    } catch {
      return false;
    }
  }
  if (signer.signatureType === 'arweave-rsa4096') {
    if (!signer.publicKey) return false;
    try {
      const crypto = await import('node:crypto');
      const publicKey = crypto.createPublicKey({ key: { kty: 'RSA', n: signer.publicKey, e: 'AQAB' }, format: 'jwk' });
      const sig = Buffer.from(signer.signature, 'base64url');
      return crypto.verify('sha256', digest, { key: publicKey, padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 }, sig);
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Create a threshold attestation envelope.
 *
 * @param {Object} params
 * @param {string} params.key - Target article canonical key
 * @param {string} params.opinion
 * @param {number} params.confidence
 * @param {string} params.reason
 * @param {Object} params.policy - { threshold, coSignerAgentIds }
 * @param {string} [params.sourceUrl]
 * @param {string} [params.targetId]
 * @param {string} [params.now]
 * @returns {{targetId:string, targetKey:string, opinion:string, confidence:number, reason:string, sourceUrl:string, policy:{threshold:number, coSignerAgentIds:string[]}, digest:string, signers:Object[], createdAt:string, envelopeId:string}}
 */
export async function createThresholdEnvelope(params) {
  if (!params.key) throw new Error('key is required');
  if (!params.opinion) throw new Error('opinion is required');
  if (params.confidence === undefined) throw new Error('confidence is required');
  if (!params.reason) throw new Error('reason is required');

  const home = getHome();
  const identity = loadIdentity(home);
  const resolved = params.targetId
    ? { summary: { id: params.targetId, key: params.key } }
    : await resolveLatestArticle(params.key);

  const policy = normalizeThresholdPolicy(params.policy);
  const now = params.now || new Date().toISOString();
  const targetId = params.targetId || resolved.summary.id;

  const digest = thresholdAttestationDigest({
    targetId,
    targetKey: params.key,
    opinion: params.opinion,
    confidence: params.confidence,
    reason: params.reason,
    sourceUrl: params.sourceUrl || '',
    threshold: policy.threshold,
    coSignerAgentIds: policy.coSignerAgentIds,
    now
  });

  // Local identity always signs as the primary attestor.
  const primarySig = await signThresholdDigest(identity, digest);

  const envelope = {
    targetId,
    targetKey: params.key,
    opinion: params.opinion,
    confidence: Number(params.confidence),
    reason: params.reason,
    sourceUrl: params.sourceUrl || '',
    policy,
    digest: digest.toString('base64url'),
    signers: [primarySig],
    createdAt: now,
    envelopeId: crypto.randomUUID()
  };

  pendingEnvelopes.set(envelope.envelopeId, envelope);
  return envelope;
}

/**
 * Add a co-signer signature to an envelope.
 *
 * @param {string} envelopeId
 * @param {{agentId:string, signatureType:string, signature:string, publicKey?:string}} signer
 * @returns {Object} Updated envelope
 */
export function addCoSigner(envelopeId, signer) {
  const envelope = pendingEnvelopes.get(envelopeId);
  if (!envelope) throw new Error(`Envelope not found: ${envelopeId}`);
  if (!signer?.agentId || !signer?.signature) throw new Error('signer must include agentId and signature');
  if (envelope.signers.some((s) => s.agentId === signer.agentId)) {
    envelope.signers = envelope.signers.filter((s) => s.agentId !== signer.agentId);
  }
  envelope.signers.push(signer);
  return envelope;
}

/**
 * Verify all co-signer signatures in an envelope.
 *
 * @param {Object} envelope
 * @returns {{ok:boolean, valid:number, required:number, invalid:string[]}}
 */
export async function verifyThresholdEnvelope(envelope) {
  const digest = Buffer.from(envelope.digest, 'base64url');
  const required = envelope.policy.threshold;
  const invalid = [];
  let valid = 0;
  for (const signer of envelope.signers) {
    const ok = await verifyThresholdSignature(digest, signer);
    if (ok) valid++;
    else invalid.push(signer.agentId);
  }
  return { ok: valid >= required, valid, required, invalid };
}

/**
 * Finalize and publish a threshold attestation.
 *
 * Publishes a single DataItem signed by the local identity. The DataItem
 * tags encode the threshold policy and list all co-signer agent ids and
 * signatures. Co-signer signatures are stored in the JSON payload so they are
 * part of the signed data and can be verified later.
 *
 * @param {string} envelopeId
 * @param {Object} [opts]
 * @param {boolean} [opts.useHyperbeam]
 * @returns {Promise<{item:Object, summary:Object, envelope:Object, reference?:Object}>}
 */
export async function finalizeThresholdAttestation(envelopeId, opts = {}) {
  const envelope = pendingEnvelopes.get(envelopeId);
  if (!envelope) throw new Error(`Envelope not found: ${envelopeId}`);

  const { ok, valid, required } = await verifyThresholdEnvelope(envelope);
  if (!ok) throw new Error(`Threshold not met: ${valid} of ${required} signatures`);

  const home = getHome();
  const config = loadConfig(home);
  const identity = loadIdentity(home);
  const transport = getTransport(config, home, { useHyperbeam: opts.useHyperbeam ?? false });

  const tags = buildAttestationTags({
    targetId: envelope.targetId,
    targetKey: envelope.targetKey,
    opinion: envelope.opinion,
    confidence: envelope.confidence,
    reason: envelope.reason,
    sourceUrl: envelope.sourceUrl,
    agentId: identity.agentId
  });

  // Add threshold/multi-sig tags
  tags.push(
    { name: 'Attestation-Threshold', value: String(envelope.policy.threshold) },
    { name: 'Attestation-Co-Signer-Count', value: String(envelope.signers.length) },
    { name: 'Attestation-Co-Signer-Ids', value: envelope.signers.map((s) => s.agentId).join(',') },
    { name: 'Attestation-Multi-Sig', value: 'true' }
  );

  const payload = JSON.stringify({
    targetKey: envelope.targetKey,
    targetId: envelope.targetId,
    opinion: envelope.opinion,
    confidence: envelope.confidence,
    reason: envelope.reason,
    sourceUrl: envelope.sourceUrl,
    threshold: envelope.policy.threshold,
    coSignerAgentIds: envelope.policy.coSignerAgentIds,
    coSignerSignatures: envelope.signers.map((s) => ({
      agentId: s.agentId,
      signatureType: s.signatureType,
      signature: s.signature
    })),
    thresholdDigest: envelope.digest
  }, null, 2);

  const item = await createDataItem({ payload, tags, identity });
  await transport.uploadDataItem(item);
  updateAttestationInCache(home, item);

  // Best-effort audit log
  try {
    const { logAction } = await import('./log.mjs');
    logAction({ home, action: 'attest', status: 'ok', key: envelope.targetKey, id: item.id, message: `Threshold attestation ${envelope.opinion} to ${envelope.targetKey}`, details: { threshold: envelope.policy.threshold, coSigners: envelope.signers.map((s) => s.agentId) } });
  } catch {
    // ignore
  }

  return { item, summary: summarizeThresholdAttestation(item), envelope };
}

/**
 * Import a shared threshold envelope (e.g. received from another co-signer).
 * Stores it in the pending map so co-signer signatures can be added.
 *
 * @param {Object} envelope
 * @returns {Object} Stored envelope
 */
export function importThresholdEnvelope(envelope) {
  if (!envelope?.envelopeId) throw new Error('envelopeId is required');
  normalizeThresholdPolicy(envelope.policy);
  pendingEnvelopes.set(envelope.envelopeId, envelope);
  return envelope;
}

/**
 * Export a pending envelope for sharing with co-signers.
 *
 * @param {string} envelopeId
 * @returns {Object}
 */
export function exportThresholdEnvelope(envelopeId) {
  const envelope = pendingEnvelopes.get(envelopeId);
  if (!envelope) throw new Error(`Envelope not found: ${envelopeId}`);
  return envelope;
}

/**
 * Summarize a multi-sig attestation DataItem, including threshold metadata.
 *
 * @param {Object} item
 * @returns {Object}
 */
export function summarizeThresholdAttestation(item) {
  const base = summarizeAttestation(item);
  const tags = tagsToObject(item.tags || []);
  return {
    ...base,
    threshold: Number(tags['Attestation-Threshold'] || 0),
    coSignerCount: Number(tags['Attestation-Co-Signer-Count'] || 0),
    coSignerIds: (tags['Attestation-Co-Signer-Ids'] || '').split(',').filter(Boolean),
    multiSig: tags['Attestation-Multi-Sig'] === 'true'
  };
}

/** Re-export cache summarize for internal use. */
export { summarizeAttestation };
