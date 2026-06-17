import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, getHome } from './config.mjs';
import { loadIdentity } from './keys.mjs';
import { createDataItem, payloadText } from './dataitem.mjs';
import { getTransport } from './transport.mjs';
import { buildArticleTags, contentHash, deriveKey, deriveTitleFromFile, tagsToObject } from './tags.mjs';
import { latestByArticleKey, loadIndex, summarizeArticle, updateArticleInCache, writeIndex, writePageCache } from './cache.mjs';
import { HyperbeamTransport } from './transport.mjs';
import * as pbcrypto from './crypto.mjs';

export function sourceNameFromUrl(url) {
  if (!url) return 'Unknown';
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    if (host.includes('wikipedia.org')) return 'Wikipedia';
    return host;
  } catch {
    return 'Unknown';
  }
}

export async function publishArticle({ file, content, kind, topic, key, title, sourceUrl, sourceName, sourceLicense = '', language = 'en', useHyperbeamReference = null, useHyperbeam = false, encryptedFor = [], visibility = 'public', extraTags = [] }) {
  const home = getHome();
  const config = loadConfig(home);
  const identity = loadIdentity(home);
  const transport = getTransport(config, home, { useHyperbeam });
  if (!kind) throw new Error('--kind is required');
  if (!topic) throw new Error('--topic is required');
  if (!sourceUrl) throw new Error('--source-url is required');
  const finalContent = content ?? fs.readFileSync(file, 'utf8');
  const finalTitle = title || (file ? deriveTitleFromFile(file) : key?.split('/').at(-1));
  const finalKey = deriveKey({ key, kind, title: finalTitle, file });

  // Normalize visibility: --publish encrypted|private|public and --visibility take precedence
  const isEncrypted = visibility === 'encrypted' || visibility === 'private' || encryptedFor?.length > 0;
  const requestedEncryptedFor = encryptedFor?.length > 0 ? encryptedFor : (isEncrypted ? [] : []);

  // Encrypt if recipients specified (always include author so they can read/decrypt later)
  let plainContent = finalContent;
  let encryptedPayload = null;
  let encryptionEnvelope = null;
  if (isEncrypted) {
    const authorKeypair = await deriveAuthorEncryptionKeypair(identity);
    const recipientKeys = [...new Set([...requestedEncryptedFor, authorKeypair.publicKey])];
    const encryption = await pbcrypto.encrypt(finalContent, recipientKeys);
    encryptedPayload = encryption.encryptedPayload;
    encryptionEnvelope = encryption.envelope;
    plainContent = encryptedPayload;
  }
  const existing = await transport.queryByTags({ 'App-Name': 'PermaBrain', 'PermaBrain-Type': 'article', 'Article-Key': finalKey });
  const latest = latestByArticleKey(existing).get(finalKey);
  const latestTags = latest ? tagsToObject(latest.tags || []) : null;
  const version = latestTags ? Number(latestTags['Article-Version'] || 0) + 1 : 1;
  const previousId = latest?.id;
  const rootId = latestTags?.['Article-Root-Id'] || latest?.id;
  const tags = buildArticleTags({
    key: finalKey,
    kind,
    title: finalTitle,
    topic,
    language,
    version,
    previousId,
    rootId,
    sourceName: sourceName || sourceNameFromUrl(sourceUrl),
    sourceUrl,
    sourceLicense,
    content: plainContent,
    agentId: identity.agentId,
    visibility: isEncrypted ? 'encrypted' : 'public'
  });

  // Store encryption metadata as tags for discovery
  if (encryptionEnvelope) {
    tags.push({ name: 'Encryption-Recipients', value: JSON.stringify(encryptionEnvelope.recipients.map(r => r.publicKeyFingerprint)) });
    tags.push({ name: 'Encryption-Ephemeral-Public-Key', value: encryptionEnvelope.ephemeralPublicKey });
  }

  // Append caller-supplied extra tags (e.g., fork lineage) before signing.
  for (const t of extraTags) {
    if (t && t.name && !tags.some((existing) => existing.name === t.name)) {
      tags.push(t);
    }
  }

  const item = await createDataItem({ payload: plainContent, tags, identity });
  await transport.uploadDataItem(item);
  updateArticleInCache(home, item);
  writePageCache(home, finalKey, finalContent);

  // Record a local audit event for the publish action.
  try {
    const { logAction } = await import('./log.mjs');
    logAction({ home, action: 'publish', status: 'ok', key: finalKey, id: item.id, message: `Published ${isEncrypted ? 'encrypted ' : ''}${kind}/${topic} article`, details: { version, encrypted: isEncrypted, reference: reference?.id } });
  } catch {
    // Audit logging is best-effort.
  }

  // For encrypted articles, cache the plaintext locally only if this agent is a recipient or author
  if (encryptionEnvelope) {
    const authorKeypair = await deriveAuthorEncryptionKeypair(identity);
    const isRecipient = encryptionEnvelope.recipients.some(r => r.publicKeyFingerprint === authorKeypair.fingerprint);
    if (isRecipient) {
      try {
        const { content: decrypted } = await pbcrypto.decrypt(encryptedPayload, Buffer.from(authorKeypair.seed, 'base64url'));
        writePageCache(home, finalKey, decrypted);
      } catch (err) {
        // Non-fatal: plaintext not cacheable, but article is published
        console.warn(`Could not decrypt cached encrypted article ${finalKey}: ${err.message}`);
      }
    }
  }

  // HyperBEAM reference integration: maintain a mutable pointer from key → latest version
  let reference = null;
  const enableHyperbeamReference = useHyperbeamReference ?? config.hyperbeam?.references ?? false;
  if (enableHyperbeamReference && transport instanceof HyperbeamTransport) {
    reference = await updateOrCreateArticleReference(transport, home, finalKey, item.id, identity);
  }

  return { item, summary: summarizeArticle(item), reference, encrypted: isEncrypted, encryptionEnvelope };
}

function loadRefCache(refPath) {
  if (!fs.existsSync(refPath)) return {};
  try { return JSON.parse(fs.readFileSync(refPath, 'utf8')); } catch { return {}; }
}

function writeRefCache(refPath, refs) {
  fs.writeFileSync(refPath, JSON.stringify(refs, null, 2) + '\n');
}

async function updateOrCreateArticleReference(transport, home, articleKey, articleId, identity) {
  const refCachePath = path.join(home, 'cache', 'article-references.json');
  const refs = loadRefCache(refCachePath);
  const existingRefId = refs[articleKey];
  try {
    if (existingRefId) {
      const result = await transport.updateArticleReference(existingRefId, articleId, identity);
      return { referenceId: result.referenceId, action: 'update' };
    }
    const result = await transport.createArticleReference(articleKey, articleId, identity);
    refs[articleKey] = result.referenceId;
    writeRefCache(refCachePath, refs);
    return { referenceId: result.referenceId, action: 'create' };
  } catch (err) {
    console.warn(`HyperBEAM reference update/create failed for ${articleKey}: ${err.message}`);
    return { error: err.message };
  }
}

export async function resolveArticleReferenceId(transport, home, articleKey) {
  const refCachePath = path.join(home, 'cache', 'article-references.json');
  const refs = loadRefCache(refCachePath);
  if (refs[articleKey]) return refs[articleKey];
  try {
    // Try to discover the reference ID via query device: find a reference whose value contains this article-key
    const results = await transport.queryByTags({
      'App-Name': 'PermaBrain',
      'PermaBrain-Type': 'reference',
      'Article-Key': articleKey
    }, { useQueryDevice: true });
    if (Array.isArray(results) && results.length > 0) {
      const refId = results[0].id;
      refs[articleKey] = refId;
      writeRefCache(refCachePath, refs);
      return refId;
    }
  } catch (err) {
    console.warn(`Reference discovery query failed for ${articleKey}: ${err.message}`);
  }
  return null;
}

function articleIsNewer(candidate, current) {
  const candidateVersion = Number(candidate.version || 0);
  const currentVersion = Number(current.version || 0);
  if (candidateVersion !== currentVersion) return candidateVersion > currentVersion;
  return String(candidate.updatedAt || '') > String(current.updatedAt || '');
}

function mergeArticleSummaries(remote, cached) {
  const byKey = new Map();
  for (const article of cached) if (article?.key) byKey.set(article.key, article);
  for (const article of remote) {
    if (!article?.key) continue;
    const current = byKey.get(article.key);
    if (!current || articleIsNewer(article, current) || (!articleIsNewer(current, article) && article.id)) byKey.set(article.key, article);
  }
  return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export async function queryArticles(filters = {}, opts = {}) {
  const { useHyperbeam, ...restFilters } = filters;
  const home = getHome();
  const config = loadConfig(home);
  const transport = getTransport(config, home, { useHyperbeam: useHyperbeam ?? opts.useHyperbeam });
  const tagFilters = { 'App-Name': 'PermaBrain', 'PermaBrain-Type': 'article' };
  if (restFilters.topic) tagFilters['Article-Topic'] = restFilters.topic;
  if (restFilters.kind) tagFilters['Article-Kind'] = restFilters.kind;
  if (restFilters.key) tagFilters['Article-Key'] = restFilters.key;
  if (restFilters.sourceName) tagFilters['Article-Source-Name'] = restFilters.sourceName;
  if (restFilters.sourceUrl) tagFilters['Article-Source-Url'] = restFilters.sourceUrl;
  const items = await transport.queryByTags(tagFilters);
  const remote = [...latestByArticleKey(items).values()].map(summarizeArticle);
  const cached = Object.values(loadIndex(home).articles || {}).filter((article) => {
    if (restFilters.topic && article.topic !== restFilters.topic) return false;
    if (restFilters.kind && article.kind !== restFilters.kind) return false;
    if (restFilters.key && article.key !== restFilters.key) return false;
    if (restFilters.sourceName && article.sourceName !== restFilters.sourceName) return false;
    if (restFilters.sourceUrl && article.sourceUrl !== restFilters.sourceUrl) return false;
    return true;
  });
  return mergeArticleSummaries(remote, cached);
}

export async function resolveLatestArticle(key, opts = {}) {
  const home = getHome();
  const config = loadConfig(home);
  const transport = getTransport(config, home, { useHyperbeam: opts.useHyperbeam });

  // HyperBEAM reference integration: resolve the latest version via reference@1.0 if available
  if (!opts.skipHyperbeamReference && transport instanceof HyperbeamTransport) {
    const refId = await resolveArticleReferenceId(transport, home, key);
    if (refId) {
      try {
        const resolved = await transport.resolveReference(refId, 'current-version');
        if (resolved && typeof resolved === 'string') {
          return { item: { id: resolved }, summary: { id: resolved, key }, transport, home, viaReference: true };
        }
      } catch (err) {
        console.warn(`HyperBEAM reference resolution failed for ${key}: ${err.message}`);
      }
    }
  }

  const items = await transport.queryByTags({ 'App-Name': 'PermaBrain', 'PermaBrain-Type': 'article', 'Article-Key': key });
  const latest = latestByArticleKey(items).get(key);
  if (latest) return { item: latest, summary: summarizeArticle(latest), transport, home };
  const cached = loadIndex(home).articles?.[key];
  if (cached) return { item: { id: cached.id }, summary: cached, transport, home };
  throw new Error(`Article not found: ${key}`);
}

export async function getArticle(key, opts = {}) {
  const { item: indexItem, summary, transport, home, viaReference } = await resolveLatestArticle(key, opts);
  const item = await transport.fetchDataItem(indexItem.id);
  const rawContent = payloadText(item);

  // Handle encrypted articles
  const tags = tagsToObject(item.tags || []);
  if (tags.Visibility === 'private' || pbcrypto.isEncryptedEnvelope(rawContent)) {
    if (!opts.decryptSeed) throw new Error('Article is encrypted; provide decryptSeed or use get-encrypted command');
    const seedBuffer = Buffer.isBuffer(opts.decryptSeed) ? opts.decryptSeed : Buffer.from(opts.decryptSeed, 'base64url');
    const { content: decryptedContent } = await pbcrypto.decrypt(rawContent, seedBuffer);
    writePageCache(home, key, decryptedContent);
    return { item, summary, content: decryptedContent, viaReference, encrypted: true };
  }

  const content = rawContent;
  const actualHash = contentHash(content);
  if (actualHash !== summary.contentHash && !viaReference) throw new Error(`Content hash mismatch for ${key}`);
  writePageCache(home, key, content);
  return { item, summary, content, viaReference, encrypted: false };
}

/**
 * Derive an X25519 encryption keypair from an identity (Ed25519 seed or generated).
 */
async function deriveAuthorEncryptionKeypair(identity) {
  if (identity.type === 'ed25519') {
    const edSeed = Buffer.from(identity.secretKey, 'base64url').subarray(0, 32);
    return pbcrypto.deriveEncryptionKeyFromEd25519(edSeed);
  }
  if (identity.type === 'arweave-rsa4096' && identity.encryptionSeed) {
    return pbcrypto.deriveEncryptionKeyFromEd25519(Buffer.from(identity.encryptionSeed, 'base64url'));
  }
  return pbcrypto.generateEncryptionKeypair();
}

export async function syncArticlesAndAttestations(opts = {}) {
  const home = getHome();
  const config = loadConfig(home);
  const transport = getTransport(config, home, { useHyperbeam: opts.useHyperbeam });
  const articleItems = await transport.queryByTags({ 'App-Name': 'PermaBrain', 'PermaBrain-Type': 'article' });
  const attestationItems = await transport.queryByTags({ 'App-Name': 'PermaBrain', 'PermaBrain-Type': 'attestation' });
  const latestArticles = [...latestByArticleKey(articleItems).values()].map(summarizeArticle);
  const existing = loadIndex(home);
  const index = { articles: {}, attestations: {}, updatedAt: new Date().toISOString() };
  for (const article of (latestArticles.length ? latestArticles : Object.values(existing.articles || {}))) index.articles[article.key] = article;
  for (const item of attestationItems) {
    const tags = tagsToObject(item.tags || []);
    const targetKey = tags['Attestation-Target-Key'];
    if (!targetKey) continue;
    if (!index.attestations[targetKey]) index.attestations[targetKey] = [];
    index.attestations[targetKey].push({
      id: item.id,
      targetId: tags['Attestation-Target-Id'],
      targetKey,
      opinion: tags['Attestation-Opinion'],
      confidence: Number(tags['Attestation-Confidence'] || 0),
      reason: tags['Attestation-Reason'],
      agentId: tags['Attestation-Agent-Id'],
      sourceUrl: tags['Attestation-Source-Url'] || null,
      createdAt: tags['Attestation-Created-At'] || item.timestamp
    });
  }
  writeIndex(home, index);
  return index;
}
