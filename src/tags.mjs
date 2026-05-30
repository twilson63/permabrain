import crypto from 'node:crypto';
import path from 'node:path';
import { APP_VERSION } from './config.mjs';

export const ARTICLE_KINDS = new Set(['person', 'subject', 'event', 'organization', 'source', 'news']);
export const ATTESTATION_OPINIONS = new Set(['valid', 'invalid', 'partially-valid', 'outdated', 'disputed']);

export function slugify(input) {
  const slug = String(input || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  if (!slug) throw new Error('Cannot derive empty slug');
  return slug;
}

export function deriveTitleFromFile(file) {
  return path.basename(file, path.extname(file)).replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function deriveKey({ key, kind, slug, title, file }) {
  if (key) {
    validateArticleKey(key);
    return key;
  }
  const finalKind = validateKind(kind);
  const finalSlug = slug ? slugify(slug) : slugify(title || deriveTitleFromFile(file || 'article'));
  return `${finalKind}/${finalSlug}`;
}

export function validateKind(kind) {
  if (!ARTICLE_KINDS.has(kind)) throw new Error(`Invalid Article-Kind '${kind}'. Expected one of: ${[...ARTICLE_KINDS].join(', ')}`);
  return kind;
}

export function validateArticleKey(key) {
  if (!/^[a-z]+\/[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*)*$/.test(String(key || ''))) throw new Error(`Invalid Article-Key '${key}'`);
  const [kind] = key.split('/');
  validateKind(kind);
  return key;
}

export function validateOpinion(opinion) {
  if (!ATTESTATION_OPINIONS.has(opinion)) throw new Error(`Invalid Attestation-Opinion '${opinion}'. Expected one of: ${[...ATTESTATION_OPINIONS].join(', ')}`);
  return opinion;
}

export function validateConfidence(confidence) {
  const value = Number(confidence);
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`Invalid Attestation-Confidence '${confidence}'. Expected number from 0 to 1.`);
  return value;
}

export function sha256Hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

export function contentHash(data) {
  return `sha256:${sha256Hex(data)}`;
}

export function tagsToObject(tags) {
  return Object.fromEntries(tags.map((tag) => [tag.name, tag.value]));
}

export function objectToTags(obj) {
  return Object.entries(obj).filter(([, value]) => value !== undefined && value !== null && value !== '').map(([name, value]) => ({ name, value: String(value) }));
}

export function buildArticleTags({
  key,
  kind,
  title,
  topic,
  language = 'en',
  version = 1,
  previousId,
  rootId,
  sourceName = 'Unknown',
  sourceUrl = '',
  sourceLicense = '',
  content,
  agentId,
  now = new Date().toISOString()
}) {
  validateArticleKey(key);
  validateKind(kind);
  if (!title) throw new Error('Article-Title is required');
  if (!topic) throw new Error('Article-Topic is required');
  if (!agentId) throw new Error('Author-Agent-Id is required');
  const slug = key.split('/').at(-1);
  const numericVersion = Number(version);
  if (!Number.isInteger(numericVersion) || numericVersion < 1) throw new Error('Article-Version must be a positive integer');
  return objectToTags({
    'App-Name': 'PermaBrain',
    'App-Version': APP_VERSION,
    'PermaBrain-Type': 'article',
    'Article-Key': key,
    'Article-Kind': kind,
    'Article-Title': title,
    'Article-Slug': slug,
    'Article-Topic': topic,
    'Article-Language': language,
    'Article-Version': numericVersion,
    'Article-Previous-Id': previousId,
    'Article-Root-Id': rootId,
    'Article-Source-Name': sourceName,
    'Article-Source-Url': sourceUrl,
    'Article-Source-License': sourceLicense,
    'Article-Content-Hash': contentHash(content),
    'Article-Published-At': now,
    'Article-Updated-At': now,
    'Author-Agent-Id': agentId,
    Visibility: 'public'
  });
}

export function buildAttestationTags({
  targetId,
  targetKey,
  opinion,
  confidence,
  reason,
  agentId,
  sourceUrl = '',
  now = new Date().toISOString()
}) {
  if (!targetId) throw new Error('Attestation-Target-Id is required');
  validateArticleKey(targetKey);
  const normalizedOpinion = validateOpinion(opinion);
  const normalizedConfidence = validateConfidence(confidence);
  if (!reason) throw new Error('Attestation-Reason is required');
  if (!agentId) throw new Error('Attestation-Agent-Id is required');
  return objectToTags({
    'App-Name': 'PermaBrain',
    'App-Version': APP_VERSION,
    'PermaBrain-Type': 'attestation',
    'Attestation-Target-Id': targetId,
    'Attestation-Target-Key': targetKey,
    'Attestation-Opinion': normalizedOpinion,
    'Attestation-Confidence': normalizedConfidence,
    'Attestation-Reason': reason,
    'Attestation-Agent-Id': agentId,
    'Attestation-Source-Url': sourceUrl,
    'Attestation-Created-At': now
  });
}
