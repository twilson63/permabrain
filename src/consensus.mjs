import { resolveLatestArticle } from './article.mjs';
import { getHome } from './config.mjs';
import { loadIndex } from './cache.mjs';
import { queryAttestationsForKey, summarizeAttestationItem } from './attestation.mjs';

export function consensusScore(attestations) {
  if (!attestations.length) return { score: 0, status: 'unattested' };
  let sum = 0;
  for (const attestation of attestations) {
    const confidence = Number(attestation.confidence || 0);
    if (attestation.opinion === 'valid') sum += confidence;
    else if (attestation.opinion === 'partially-valid') sum += confidence * 0.5;
    else if (attestation.opinion === 'invalid') sum -= confidence;
    else if (attestation.opinion === 'disputed') sum -= confidence * 0.75;
    else if (attestation.opinion === 'outdated') sum -= confidence * 0.5;
  }
  return { score: sum / attestations.length, status: 'attested' };
}

export async function consensusForArticle(key) {
  const latestArticle = (await resolveLatestArticle(key)).summary;
  const items = await queryAttestationsForKey(key);
  const attestations = items.length ? items.map(summarizeAttestationItem) : (loadIndex(getHome()).attestations?.[key] || []);
  const opinionCounts = { valid: 0, invalid: 0, 'partially-valid': 0, outdated: 0, disputed: 0 };
  for (const attestation of attestations) {
    if (Object.hasOwn(opinionCounts, attestation.opinion)) opinionCounts[attestation.opinion]++;
  }
  const scored = consensusScore(attestations);
  return {
    key,
    latestArticleId: latestArticle?.id || null,
    latestVersion: latestArticle?.version || null,
    status: scored.status,
    totalAttestations: attestations.length,
    opinionCounts,
    score: Number(scored.score.toFixed(6)),
    topReasons: attestations.slice(0, 5).map((a) => ({ opinion: a.opinion, confidence: a.confidence, reason: a.reason, agentId: a.agentId })),
    attestations
  };
}
