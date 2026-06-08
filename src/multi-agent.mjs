/**
 * PermaBrain Multi-Agent Attestation
 *
 * Enables external agents (e.g., Sage, Relay) to create attestations
 * using their own identities, without needing their own PermaBrain installation.
 *
 * Two flows:
 * 1. **Direct API**: Pass an agent identity object → creates & uploads the attestation
 * 2. **CAP Request**: Agents send signed requests via ZenBin CAP protocol → processed as proxy attestations
 *
 * Usage (direct):
 *   import { attestForAgent } from './src/multi-agent.mjs';
 *   const result = await attestForAgent({
 *     agentIdentity: { type: 'ed25519', agentId: 'ed25519:abc...', publicKey: '...', secretKey: '...' },
 *     key: 'subject/ai',
 *     opinion: 'valid',
 *     confidence: 0.9,
 *     reason: 'Well-sourced article'
 *   });
 *
 * Usage (CAP proxy):
 *   import { parseAttestationRequest, processProxyAttestation } from './src/multi-agent.mjs';
 *   const request = parseAttestationRequest(body, senderFingerprint);
 *   const result = await processProxyAttestation(request);
 */

import { getHome, loadConfig } from './config.mjs';
import { loadIdentity, createIdentity } from './keys.mjs';
import { createDataItem } from './dataitem.mjs';
import { getTransport } from './transport.mjs';
import { buildAttestationTags } from './tags.mjs';
import { updateAttestationInCache } from './cache.mjs';
import { resolveLatestArticle } from './article.mjs';

// ─── Agent Registry ─────────────────────────────────────────────────

const KNOWN_AGENTS = {
  sage: {
    name: 'Sage',
    keyId: 'sage-1778343176945',
    publicKeyFingerprint: 'wp4kJYmcDa-AfAuVOS0vMW_zZqTxQGtFgHQEAZEaW3k'
  },
  relay: {
    name: 'Relay',
    keyId: undefined,
    publicKeyFingerprint: 'VSiiK0rbxxk8lGCttfZhQsoRfXWjClc1yU2_J7xr_hg'
  }
};

export function getKnownAgent(name) {
  return KNOWN_AGENTS[name.toLowerCase()] || null;
}

export function listKnownAgents() {
  return Object.entries(KNOWN_AGENTS).map(([id, info]) => ({ id, ...info }));
}

// ─── Direct Attestation ──────────────────────────────────────────────

/**
 * Create and upload an attestation on behalf of an external agent.
 *
 * The agent identity must contain enough key material to sign an ANS-104 DataItem.
 * For ed25519: { type: 'ed25519', agentId, publicKey (b64url), secretKey (b64url) }
 * For arweave: { type: 'arweave-rsa4096', agentId, jwk }
 *
 * @param {Object} params
 * @param {Object} params.agentIdentity - Agent key identity (ed25519 or arweave)
 * @param {string} params.key - Target article canonical key
 * @param {string} params.opinion - One of: valid, invalid, partially-valid, outdated, disputed
 * @param {number} params.confidence - 0 to 1
 * @param {string} params.reason - Explanation
 * @param {string} [params.sourceUrl] - Supporting URL
 * @param {string} [params.targetId] - Specific article version ID (optional, resolves latest if omitted)
 * @returns {Promise<{id, targetKey, targetId, opinion, confidence, reason, agentId}>}
 */
export async function attestForAgent({ agentIdentity, key, opinion, confidence, reason, sourceUrl = '', targetId }) {
  if (!agentIdentity) throw new Error('agentIdentity is required');
  if (!key) throw new Error('key is required');
  if (!opinion) throw new Error('opinion is required');
  if (confidence === undefined) throw new Error('confidence is required');
  if (!reason) throw new Error('reason is required');

  // Validate identity has signing capability
  if (agentIdentity.type === 'ed25519') {
    if (!agentIdentity.publicKey || !agentIdentity.secretKey) {
      throw new Error('ed25519 identity requires publicKey and secretKey (base64url)');
    }
  } else if (agentIdentity.type === 'arweave-rsa4096') {
    if (!agentIdentity.jwk) {
      throw new Error('arweave-rsa4096 identity requires jwk');
    }
  } else {
    throw new Error(`Unsupported agent identity type '${agentIdentity.type}'. Use ed25519 or arweave-rsa4096.`);
  }

  const home = getHome();
  const config = loadConfig(home);
  const transport = getTransport(config, home);

  // Resolve target article
  const resolved = targetId ? { summary: { id: targetId, key } } : await resolveLatestArticle(key);

  const tags = buildAttestationTags({
    targetId: targetId || resolved.summary.id,
    targetKey: key,
    opinion,
    confidence,
    reason,
    sourceUrl,
    agentId: agentIdentity.agentId
  });

  const payload = JSON.stringify({
    targetKey: key,
    targetId: targetId || resolved.summary.id,
    opinion,
    confidence: Number(confidence),
    reason,
    sourceUrl
  }, null, 2);

  // Create & sign data item with the agent's own identity
  const item = await createDataItem({ payload, tags, identity: agentIdentity });

  // Upload via transport
  await transport.uploadDataItem(item);

  // Update local cache
  updateAttestationInCache(home, item);

  return {
    id: item.id,
    targetKey: key,
    targetId: targetId || resolved.summary.id,
    opinion,
    confidence: Number(confidence),
    reason,
    agentId: agentIdentity.agentId
  };
}

// ─── Provisional Agent Identity ──────────────────────────────────────

/**
 * Generate a provisional ed25519 identity for a known agent name.
 * The secret key is returned once — the caller must store it.
 * The agentId can be used to track attestations from this agent.
 *
 * @param {string} agentName - Known agent name (e.g., 'sage', 'relay') or any label
 * @param {Object} [options]
 * @param {string} [options.keyType='ed25519'] - Key type to generate
 * @returns {Promise<{agentId, type, publicKey, secretKey, createdAt, label}>}
 */
export async function provisionAgentIdentity(agentName, { keyType = 'ed25519' } = {}) {
  if (!agentName) throw new Error('agentName is required');
  const identity = await createIdentity(keyType);
  return {
    ...identity,
    label: agentName
  };
}

// ─── CAP Request Processing ──────────────────────────────────────────

/**
 * Parse a CAP-format attestation request body.
 *
 * Expected JSON body:
 * {
 *   "type": "permabrain-attest",
 *   "agentId": "ed25519:abc...",
 *   "key": "subject/ai",
 *   "opinion": "valid",
 *   "confidence": 0.9,
 *   "reason": "Well-sourced",
 *   "sourceUrl": "https://...",
 *   "targetId": "optional-specific-version-id"
 * }
 *
 * @param {Object} body - Parsed request body
 * @param {string} [senderFingerprint] - CAP sender fingerprint for verification
 * @returns {Object} Validated request object
 * @throws on invalid input
 */
export function parseAttestationRequest(body, senderFingerprint) {
  if (!body || typeof body !== 'object') throw new Error('Request body must be a JSON object');
  if (body.type !== 'permabrain-attest') throw new Error(`Invalid request type '${body.type}'. Expected 'permabrain-attest'.`);
  if (!body.agentId) throw new Error('agentId is required in attestation request');
  if (!body.key) throw new Error('key is required in attestation request');
  if (!body.opinion) throw new Error('opinion is required in attestation request');
  if (body.confidence === undefined) throw new Error('confidence is required in attestation request');
  if (!body.reason) throw new Error('reason is required in attestation request');

  // Validate opinion
  const validOpinions = ['valid', 'invalid', 'partially-valid', 'outdated', 'disputed'];
  if (!validOpinions.includes(body.opinion)) {
    throw new Error(`Invalid opinion '${body.opinion}'. Must be one of: ${validOpinions.join(', ')}`);
  }

  // Validate confidence
  const confidence = Number(body.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new Error(`Invalid confidence '${body.confidence}'. Must be 0-1.`);
  }

  return {
    type: body.type,
    agentId: body.agentId,
    key: body.key,
    opinion: body.opinion,
    confidence,
    reason: body.reason,
    sourceUrl: body.sourceUrl || '',
    targetId: body.targetId || null,
    senderFingerprint: senderFingerprint || null,
    requestedAt: body.requestedAt || new Date().toISOString()
  };
}

/**
 * Process a CAP attestation request as a proxy attestation.
 *
 * When an agent sends a CAP request, we don't have their signing key.
 * Instead, we create the attestation with our own identity but tag it
 * with the requesting agent's agentId and CAP fingerprint.
 *
 * This is the "vouch" model: Dev1 vouches that Sage/Relay requested this attestation.
 * The attestation includes Attestation-Proxy, Attestation-Requester-Id, and
 * Attestation-Requester-Fingerprint tags for traceability.
 *
 * @param {Object} request - Parsed attestation request from parseAttestationRequest
 * @returns {Promise<{id, targetKey, targetId, opinion, confidence, reason, agentId, requesterId, requesterFingerprint}>}
 */
export async function processProxyAttestation(request) {
  if (!request.agentId) throw new Error('agentId is required in request');

  const home = getHome();
  const config = loadConfig(home);
  const identity = loadIdentity(home);
  const transport = getTransport(config, home);

  const resolved = request.targetId
    ? { summary: { id: request.targetId, key: request.key } }
    : await resolveLatestArticle(request.key);

  // Build attestation tags with our identity as the signer
  const tags = buildAttestationTags({
    targetId: request.targetId || resolved.summary.id,
    targetKey: request.key,
    opinion: request.opinion,
    confidence: request.confidence,
    reason: request.reason,
    sourceUrl: request.sourceUrl || '',
    agentId: identity.agentId
  });

  // Add proxy metadata tags for traceability
  tags.push(
    { name: 'Attestation-Proxy', value: 'true' },
    { name: 'Attestation-Requester-Id', value: request.agentId },
    { name: 'Attestation-Requester-Fingerprint', value: request.senderFingerprint || '' }
  );

  const payload = JSON.stringify({
    targetKey: request.key,
    targetId: request.targetId || resolved.summary.id,
    opinion: request.opinion,
    confidence: request.confidence,
    reason: request.reason,
    sourceUrl: request.sourceUrl || '',
    proxyFor: request.agentId,
    proxyType: 'cap-request'
  }, null, 2);

  const item = await createDataItem({ payload, tags, identity });
  await transport.uploadDataItem(item);
  updateAttestationInCache(home, item);

  return {
    id: item.id,
    targetKey: request.key,
    targetId: request.targetId || resolved.summary.id,
    opinion: request.opinion,
    confidence: request.confidence,
    reason: request.reason,
    agentId: identity.agentId,
    requesterId: request.agentId,
    requesterFingerprint: request.senderFingerprint
  };
}

// ─── CAP Request Builder ─────────────────────────────────────────────

/**
 * Build a CAP-format attestation request body for sending to another PermaBrain agent.
 *
 * @param {Object} params
 * @param {string} params.key - Target article key
 * @param {string} params.opinion - Opinion value
 * @param {number} params.confidence - Confidence 0-1
 * @param {string} params.reason - Reason text
 * @param {string} params.agentId - This agent's ID
 * @param {string} [params.sourceUrl] - Supporting URL
 * @param {string} [params.targetId] - Specific version ID
 * @returns {Object} CAP request body ready to send via ZenBin
 */
export function buildAttestationRequestBody(params) {
  if (!params.key) throw new Error('key is required');
  if (!params.opinion) throw new Error('opinion is required');
  if (params.confidence === undefined) throw new Error('confidence is required');
  if (!params.reason) throw new Error('reason is required');
  if (!params.agentId) throw new Error('agentId is required');

  return {
    type: 'permabrain-attest',
    agentId: params.agentId,
    key: params.key,
    opinion: params.opinion,
    confidence: params.confidence,
    reason: params.reason,
    sourceUrl: params.sourceUrl || '',
    targetId: params.targetId || null,
    requestedAt: new Date().toISOString()
  };
}