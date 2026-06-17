import { getHome, loadConfig } from './config.mjs';
import { loadIdentity } from './keys.mjs';
import { createDataItem } from './dataitem.mjs';
import { getTransport } from './transport.mjs';
import { buildAttestationTags, tagsToObject } from './tags.mjs';
import { summarizeAttestation, updateAttestationInCache } from './cache.mjs';
import { resolveLatestArticle } from './article.mjs';
import { HyperbeamTransport } from './transport.mjs';
import fs from 'node:fs';
import path from 'node:path';

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

export async function attestArticle({ key, opinion, confidence, reason, sourceUrl = '', targetId, useHyperbeamReference = null, useHyperbeam = false }) {
  const home = getHome();
  const config = loadConfig(home);
  const identity = loadIdentity(home);
  const transport = getTransport(config, home, { useHyperbeam });
  const resolved = targetId ? { summary: { id: targetId, key } } : await resolveLatestArticle(key, { useHyperbeam });
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

  // HyperBEAM reference integration: maintain a mutable pointer from key → latest attestation
  let reference = null;
  const enableHyperbeamReference = useHyperbeamReference ?? config.hyperbeam?.references ?? false;
  if (enableHyperbeamReference && transport instanceof HyperbeamTransport) {
    reference = await updateOrCreateAttestationReference(transport, home, key, item.id, identity);
  }

  // Record a local audit event for the attestation action.
  try {
    const { logAction } = await import('./log.mjs');
    logAction({ home, action: 'attest', status: 'ok', key, id: item.id, message: `Attested ${opinion} to ${key}`, details: { confidence, reference: reference?.referenceId } });
  } catch {
    // Audit logging is best-effort.
  }

  return { item, summary: summarizeAttestation(item), reference };
}

async function updateOrCreateAttestationReference(transport, home, targetKey, attestationId, identity) {
  const refCachePath = path.join(home, 'cache', 'attestation-references.json');
  const refs = loadRefCache(refCachePath);
  const existingRefId = refs[targetKey];
  try {
    if (existingRefId) {
      const result = await transport.updateReference(existingRefId, { 'attestation-target-key': targetKey, 'current-attestation': attestationId }, identity, { authority: identity.agentId });
      return { referenceId: result.referenceId, action: 'update' };
    }
    const result = await transport.createReference(
      { 'attestation-target-key': targetKey, 'current-attestation': attestationId },
      identity,
      { authority: identity.agentId }
    );
    refs[targetKey] = result.referenceId;
    writeRefCache(refCachePath, refs);
    return { referenceId: result.referenceId, action: 'create' };
  } catch (err) {
    console.warn(`HyperBEAM attestation reference update/create failed for ${targetKey}: ${err.message}`);
    return { error: err.message };
  }
}

function loadRefCache(refPath) {
  if (!fs.existsSync(refPath)) return {};
  try { return JSON.parse(fs.readFileSync(refPath, 'utf8')); } catch { return {}; }
}

function writeRefCache(refPath, refs) {
  fs.writeFileSync(refPath, JSON.stringify(refs, null, 2) + '\n');
}

export async function queryAttestationsForKey(key, opts = {}) {
  const home = getHome();
  const config = loadConfig(home);
  const transport = getTransport(config, home, { useHyperbeam: opts.useHyperbeam });
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
    createdAt: tags['Attestation-Created-At'] || item.timestamp,
    proxy: tags['Attestation-Proxy'] === 'true',
    requesterId: tags['Attestation-Requester-Id'] || null,
    requesterFingerprint: tags['Attestation-Requester-Fingerprint'] || null
  };
}
