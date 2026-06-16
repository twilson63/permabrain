/**
 * PermaBrain Verify
 *
 * Validates DataItem signatures, canonical article keys, content hashes,
 * and attestation chains. Returns a structured report that callers can
 * render as CLI output or JSON.
 */

import { parseAns104, payloadText, rawDataItemBytes, verifyDataItem } from './dataitem.mjs';
import { tagsToObject, contentHash, validateArticleKey, deriveKey } from './tags.mjs';
import { resolveLatestArticle, getArticle } from './article.mjs';
import { queryAttestationsForKey, summarizeAttestationItem } from './attestation.mjs';
import { consensusScore } from './consensus.mjs';
import { getTransport } from './transport.mjs';
import { loadConfig, getHome } from './config.mjs';

export async function verifyDataItemById(id, opts = {}) {
  const home = opts.home || getHome();
  const config = opts.config || loadConfig(home);
  const transport = opts.transport || getTransport(config, home, { useHyperbeam: opts.useHyperbeam });
  const item = await transport.fetchDataItem(id);
  return verifyItem(item, opts);
}

export async function verifyItem(item, opts = {}) {
  const result = {
    id: item.id,
    valid: true,
    checks: []
  };

  // 1. Verify ANS-104 DataItem signature
  let signatureValid = false;
  let signatureError = null;
  try {
    signatureValid = await verifyDataItem(item);
  } catch (err) {
    signatureError = err.message;
  }
  result.checks.push({
    name: 'dataitem-signature',
    ok: signatureValid,
    error: signatureError || (!signatureValid ? 'Signature verification failed' : null)
  });
  if (!signatureValid) result.valid = false;

  // 2. Parse tags and payload
  let tags;
  let content;
  let type;
  try {
    tags = tagsToObject(item.tags || []);
    content = payloadText(item);
    type = tags['PermaBrain-Type'];
  } catch (err) {
    result.checks.push({ name: 'parse', ok: false, error: err.message });
    result.valid = false;
    return result;
  }
  result.type = type;

  // 3. Common PermaBrain type checks
  if (type === 'article') {
    const articleResult = await verifyArticle({ item, tags, content }, opts);
    result.checks.push(...articleResult.checks);
    if (!articleResult.valid) result.valid = false;
    result.article = articleResult.article;
  } else if (type === 'attestation') {
    const attestationResult = await verifyAttestation({ item, tags, content }, opts);
    result.checks.push(...attestationResult.checks);
    if (!attestationResult.valid) result.valid = false;
    result.attestation = attestationResult.attestation;
  } else {
    result.checks.push({ name: 'permabrain-type', ok: false, error: `Unknown PermaBrain-Type: ${type}` });
    result.valid = false;
  }

  return result;
}

async function verifyArticle({ item, tags, content }, opts) {
  const result = { valid: true, checks: [], article: null };

  const key = tags['Article-Key'];
  const kind = tags['Article-Kind'];
  const title = tags['Article-Title'];
  const topic = tags['Article-Topic'];
  const version = Number(tags['Article-Version'] || 0);
  const declaredHash = tags['Article-Content-Hash'];
  const authorAgentId = tags['Author-Agent-Id'];
  const owner = item.owner || tags['Author-Agent-Id'];

  result.article = {
    id: item.id,
    key,
    kind,
    title,
    topic,
    version,
    authorAgentId,
    owner,
    contentHash: declaredHash,
    encrypted: tags.Visibility === 'encrypted' || tags.Visibility === 'private'
  };

  // Required article tags
  for (const required of ['Article-Key', 'Article-Kind', 'Article-Title', 'Article-Topic', 'Article-Version', 'Article-Content-Hash', 'Author-Agent-Id']) {
    if (!tags[required]) {
      result.checks.push({ name: 'article-required-tags', ok: false, error: `Missing tag ${required}` });
      result.valid = false;
    }
  }
  if (result.checks.some(c => c.name === 'article-required-tags' && !c.ok)) {
    return result;
  }
  result.checks.push({ name: 'article-required-tags', ok: true });

  // Canonical key validation
  let keyValid = false;
  let keyError = null;
  try {
    validateArticleKey(key);
    keyValid = true;
  } catch (err) {
    keyError = err.message;
  }
  result.checks.push({ name: 'article-canonical-key', ok: keyValid, error: keyError });
  if (!keyValid) result.valid = false;

  // Derived key consistency
  let derivedKey;
  let derivedKeyValid = false;
  try {
    derivedKey = deriveKey({ key: undefined, kind, title });
    derivedKeyValid = derivedKey === key;
  } catch (err) {
    derivedKeyValid = false;
  }
  result.checks.push({ name: 'article-derived-key', ok: derivedKeyValid, expected: derivedKey, actual: key });
  if (!derivedKeyValid) result.valid = false;

  // Content hash validation (skip for encrypted/private — cannot verify without seed)
  if (result.article.encrypted) {
    result.checks.push({ name: 'article-content-hash', ok: true, note: 'encrypted payload; hash not independently verifiable' });
  } else {
    const actualHash = contentHash(content);
    const hashOk = actualHash === declaredHash;
    result.checks.push({ name: 'article-content-hash', ok: hashOk, expected: declaredHash, actual: actualHash });
    if (!hashOk) result.valid = false;
  }

  // Author/owner alignment
  const ownerOk = !owner || owner === authorAgentId;
  result.checks.push({ name: 'article-author-owner', ok: ownerOk, owner, authorAgentId });
  if (!ownerOk) result.valid = false;

  // Version chain validation (if previousId present and opts allows network fetch)
  const previousId = tags['Article-Previous-Id'];
  if (previousId && opts.verifyChain !== false) {
    try {
      const prev = await verifyDataItemById(previousId, opts);
      const prevKey = prev.article?.key;
      const prevVersion = prev.article?.version;
      const chainOk = prevKey === key && prevVersion === version - 1;
      result.checks.push({
        name: 'article-version-chain',
        ok: chainOk,
        previousId,
        previousKey: prevKey,
        previousVersion: prevVersion
      });
      if (!chainOk) result.valid = false;
    } catch (err) {
      result.checks.push({ name: 'article-version-chain', ok: false, previousId, error: err.message });
      result.valid = false;
    }
  }

  // Attestation chain summary (optional)
  if (opts.includeAttestations) {
    try {
      const attestations = await queryAttestationsForKey(key, { useHyperbeam: opts.useHyperbeam });
      const scored = consensusScore(attestations.map(summarizeAttestationItem), { latestArticleId: item.id });
      result.checks.push({
        name: 'article-attestations',
        ok: true,
        count: attestations.length,
        score: Number(scored.score.toFixed(6)),
        status: scored.status
      });
      result.attestations = scored.consideredAttestations;
      result.consensus = {
        score: Number(scored.score.toFixed(6)),
        status: scored.status,
        components: scored.components
      };
    } catch (err) {
      result.checks.push({ name: 'article-attestations', ok: false, error: err.message });
    }
  }

  return result;
}

async function verifyAttestation({ item, tags, content }, opts) {
  const result = { valid: true, checks: [], attestation: null };

  const targetId = tags['Attestation-Target-Id'];
  const targetKey = tags['Attestation-Target-Key'];
  const opinion = tags['Attestation-Opinion'];
  const confidence = Number(tags['Attestation-Confidence'] || 0);
  const reason = tags['Attestation-Reason'];
  const agentId = tags['Attestation-Agent-Id'];
  const owner = item.owner;

  result.attestation = {
    id: item.id,
    targetId,
    targetKey,
    opinion,
    confidence,
    reason,
    agentId,
    owner
  };

  // Required attestation tags
  for (const required of ['Attestation-Target-Id', 'Attestation-Target-Key', 'Attestation-Opinion', 'Attestation-Confidence', 'Attestation-Reason', 'Attestation-Agent-Id']) {
    if (!tags[required]) {
      result.checks.push({ name: 'attestation-required-tags', ok: false, error: `Missing tag ${required}` });
      result.valid = false;
    }
  }
  if (result.checks.some(c => c.name === 'attestation-required-tags' && !c.ok)) {
    return result;
  }
  result.checks.push({ name: 'attestation-required-tags', ok: true });

  // Opinion and confidence validation
  const validOpinions = new Set(['valid', 'invalid', 'partially-valid', 'outdated', 'disputed']);
  const opinionOk = validOpinions.has(opinion);
  const confidenceOk = Number.isFinite(confidence) && confidence >= 0 && confidence <= 1;
  result.checks.push({ name: 'attestation-opinion', ok: opinionOk, value: opinion });
  result.checks.push({ name: 'attestation-confidence', ok: confidenceOk, value: confidence });
  if (!opinionOk || !confidenceOk) result.valid = false;

  // Author/owner alignment
  const ownerOk = !owner || owner === agentId;
  result.checks.push({ name: 'attestation-agent-owner', ok: ownerOk, owner, agentId });
  if (!ownerOk) result.valid = false;

  // Target article existence + key alignment (if network fetch allowed)
  if (targetId && opts.verifyTarget !== false) {
    try {
      const target = await verifyDataItemById(targetId, opts);
      const targetKeyOk = target.article?.key === targetKey;
      result.checks.push({
        name: 'attestation-target',
        ok: targetKeyOk,
        targetId,
        targetKey,
        resolvedKey: target.article?.key,
        targetValid: target.valid
      });
      if (!targetKeyOk) result.valid = false;
    } catch (err) {
      result.checks.push({ name: 'attestation-target', ok: false, targetId, targetKey, error: err.message });
      result.valid = false;
    }
  }

  // Payload consistency: JSON payload should mirror tags
  try {
    const payload = JSON.parse(content || '{}');
    const payloadOk = payload.targetId === targetId && payload.targetKey === targetKey && payload.opinion === opinion;
    result.checks.push({ name: 'attestation-payload', ok: payloadOk });
    if (!payloadOk) result.valid = false;
  } catch {
    result.checks.push({ name: 'attestation-payload', ok: false, error: 'Payload is not valid JSON' });
    result.valid = false;
  }

  return result;
}

export async function verifyByKey(key, opts = {}) {
  const home = opts.home || getHome();
  const config = opts.config || loadConfig(home);
  const transport = opts.transport || getTransport(config, home, { useHyperbeam: opts.useHyperbeam });
  const resolved = await resolveLatestArticle(key, { useHyperbeam: opts.useHyperbeam, transport });
  return verifyDataItemById(resolved.summary.id, { ...opts, transport });
}
