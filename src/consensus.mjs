import { resolveLatestArticle } from './article.mjs';
import { getHome } from './config.mjs';
import { loadIndex } from './cache.mjs';
import { queryAttestationsForKey, summarizeAttestationItem } from './attestation.mjs';

const OPINION_WEIGHT = { valid: 1, 'partially-valid': 0.5, invalid: -1, disputed: -0.75, outdated: -0.5 };
const MULTI_SIG_BONUS = 0.25;

function isMultiSigAttestation(attestation) {
  return attestation.multiSig === true || Number(attestation.threshold) > 0;
}

function effectiveAgentKey(attestation) {
  // For multi-sig attestations, use a stable key combining the primary agent and co-signers
  if (isMultiSigAttestation(attestation) && attestation.coSignerIds?.length) {
    const ids = [attestation.agentId || attestation.id, ...attestation.coSignerIds].sort();
    return ids.join(',');
  }
  return `${attestation.agentId || attestation.id}:${attestation.targetId || attestation.targetKey || ''}`;
}

function latestAttestationsByAgentAndTarget(attestations) {
  const latest = new Map();
  for (const attestation of attestations) {
    const key = effectiveAgentKey(attestation);
    const current = latest.get(key);
    if (!current || String(attestation.createdAt || '') >= String(current.createdAt || '')) latest.set(key, attestation);
  }
  return [...latest.values()];
}

function freshnessWeight(createdAt, now = new Date()) {
  const created = Date.parse(createdAt || '');
  if (!Number.isFinite(created)) return 1;
  const ageDays = Math.max(0, (now.getTime() - created) / 86400000);
  if (ageDays <= 90) return 1;
  if (ageDays >= 365) return 0.5;
  return 1 - ((ageDays - 90) / 275) * 0.5;
}

export function consensusScore(attestations, { latestArticleId = null, now = new Date() } = {}) {
  if (!attestations.length) return { score: 0, status: 'unattested', consideredAttestations: [], components: [] };
  const consideredAttestations = latestAttestationsByAgentAndTarget(attestations);
  let weightedSum = 0;
  let totalWeight = 0;
  const components = [];
  for (const attestation of consideredAttestations) {
    const confidence = Number(attestation.confidence || 0);
    const opinionWeight = OPINION_WEIGHT[attestation.opinion] ?? 0;
    const targetVersionWeight = latestArticleId && attestation.targetId && attestation.targetId !== latestArticleId ? 0.5 : 1;
    const recencyWeight = freshnessWeight(attestation.createdAt, now instanceof Date ? now : new Date(now));
    const multiSigBonus = isMultiSigAttestation(attestation) ? MULTI_SIG_BONUS : 0;
    const weight = targetVersionWeight * recencyWeight * (1 + multiSigBonus);
    const contribution = opinionWeight * confidence * weight;
    weightedSum += contribution;
    totalWeight += weight;
    components.push({
      id: attestation.id,
      agentId: attestation.agentId,
      targetId: attestation.targetId,
      opinion: attestation.opinion,
      confidence,
      opinionWeight,
      targetVersionWeight,
      freshnessWeight: Number(recencyWeight.toFixed(6)),
      multiSigBonus,
      contribution: Number(contribution.toFixed(6))
    });
  }
  return {
    score: totalWeight ? weightedSum / totalWeight : 0,
    status: 'attested',
    consideredAttestations,
    components
  };
}

export async function consensusForArticle(key, opts = {}) {
  let latestArticle;
  try {
    latestArticle = (await resolveLatestArticle(key, { useHyperbeam: opts.useHyperbeam })).summary;
  } catch (err) {
    if (opts.useHyperbeam) {
      // Fall back to local index/cache when HyperBEAM resolution fails
      latestArticle = loadIndex(getHome()).articles?.[key] || null;
    } else {
      throw err;
    }
  }
  let items;
  try {
    items = await queryAttestationsForKey(key, { useHyperbeam: opts.useHyperbeam });
  } catch (err) {
    if (!opts.useHyperbeam) throw err;
    items = [];
  }
  const rawAttestations = items.length ? items.map(summarizeAttestationItem) : (loadIndex(getHome()).attestations?.[key] || []);
  // For proxy attestations, the effective agent is the requester, not the proxy signer
  const attestations = rawAttestations.map((a) => {
    if (a.proxy) return { ...a, agentId: a.requesterId || a.agentId };
    return a;
  });
  const scored = consensusScore(attestations, { latestArticleId: latestArticle?.id || null });
  const consideredAttestations = scored.consideredAttestations || attestations;
  const opinionCounts = { valid: 0, invalid: 0, 'partially-valid': 0, outdated: 0, disputed: 0 };
  for (const attestation of consideredAttestations) {
    if (Object.hasOwn(opinionCounts, attestation.opinion)) opinionCounts[attestation.opinion]++;
  }
  return {
    key,
    latestArticleId: latestArticle?.id || null,
    latestVersion: latestArticle?.version || null,
    status: scored.status,
    totalAttestations: consideredAttestations.length,
    rawAttestations: attestations.length,
    opinionCounts,
    score: Number(scored.score.toFixed(6)),
    scoreComponents: scored.components || [],
    topReasons: consideredAttestations.slice(0, 5).map((a) => ({ opinion: a.opinion, confidence: a.confidence, reason: a.reason, agentId: a.agentId })),
    attestations: consideredAttestations
  };
}
