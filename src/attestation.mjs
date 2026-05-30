import { getHome, loadConfig } from './config.mjs';
import { loadIdentity } from './keys.mjs';
import { createDataItem } from './dataitem.mjs';
import { getTransport } from './transport.mjs';
import { buildAttestationTags, tagsToObject } from './tags.mjs';
import { summarizeAttestation, updateAttestationInCache } from './cache.mjs';
import { resolveLatestArticle } from './article.mjs';

export function opinionFromArgs(args) {
  const opinions = [
    ['valid', args.valid],
    ['invalid', args.invalid],
    ['partially-valid', args['partially-valid']],
    ['outdated', args.outdated],
    ['disputed', args.disputed]
  ].filter(([, enabled]) => enabled);
  if (opinions.length !== 1) throw new Error('attest requires exactly one opinion flag: --valid, --invalid, --partially-valid, --outdated, or --disputed');
  return opinions[0][0];
}

export async function attestArticle({ key, opinion, confidence, reason, sourceUrl = '', targetId }) {
  const home = getHome();
  const config = loadConfig(home);
  const identity = loadIdentity(home);
  const transport = getTransport(config, home);
  const resolved = targetId ? { summary: { id: targetId, key } } : await resolveLatestArticle(key);
  const tags = buildAttestationTags({
    targetId: targetId || resolved.summary.id,
    targetKey: key,
    opinion,
    confidence,
    reason,
    sourceUrl,
    agentId: identity.agentId
  });
  const payload = JSON.stringify({ targetKey: key, targetId: targetId || resolved.summary.id, opinion, confidence: Number(confidence), reason, sourceUrl }, null, 2);
  const item = await createDataItem({ payload, tags, identity });
  await transport.uploadDataItem(item);
  updateAttestationInCache(home, item);
  return { item, summary: summarizeAttestation(item) };
}

export async function queryAttestationsForKey(key) {
  const home = getHome();
  const config = loadConfig(home);
  const transport = getTransport(config, home);
  return transport.queryByTags({ 'App-Name': 'PermaBrain', 'PermaBrain-Type': 'attestation', 'Attestation-Target-Key': key });
}

export function summarizeAttestationItem(item) {
  const tags = tagsToObject(item.tags || []);
  return {
    id: item.id,
    targetId: tags['Attestation-Target-Id'],
    targetKey: tags['Attestation-Target-Key'],
    opinion: tags['Attestation-Opinion'],
    confidence: Number(tags['Attestation-Confidence'] || 0),
    reason: tags['Attestation-Reason'],
    agentId: tags['Attestation-Agent-Id'],
    sourceUrl: tags['Attestation-Source-Url'] || null,
    createdAt: tags['Attestation-Created-At'] || item.timestamp
  };
}
