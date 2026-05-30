import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, getHome } from './config.mjs';
import { loadIdentity } from './keys.mjs';
import { createDataItem, payloadText } from './dataitem.mjs';
import { getTransport } from './transport.mjs';
import { buildArticleTags, contentHash, deriveKey, deriveTitleFromFile, tagsToObject } from './tags.mjs';
import { latestByArticleKey, loadIndex, summarizeArticle, updateArticleInCache, writeIndex, writePageCache } from './cache.mjs';

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

export async function publishArticle({ file, content, kind, topic, key, title, sourceUrl, sourceName, sourceLicense = '', language = 'en' }) {
  const home = getHome();
  const config = loadConfig(home);
  const identity = loadIdentity(home);
  const transport = getTransport(config, home);
  if (!kind) throw new Error('--kind is required');
  if (!topic) throw new Error('--topic is required');
  if (!sourceUrl) throw new Error('--source-url is required');
  const finalContent = content ?? fs.readFileSync(file, 'utf8');
  const finalTitle = title || (file ? deriveTitleFromFile(file) : key?.split('/').at(-1));
  const finalKey = deriveKey({ key, kind, title: finalTitle, file });
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
    content: finalContent,
    agentId: identity.agentId
  });
  const item = await createDataItem({ payload: finalContent, tags, identity });
  await transport.uploadDataItem(item);
  updateArticleInCache(home, item);
  writePageCache(home, finalKey, finalContent);
  return { item, summary: summarizeArticle(item) };
}

export async function queryArticles(filters = {}) {
  const home = getHome();
  const config = loadConfig(home);
  const transport = getTransport(config, home);
  const tagFilters = { 'App-Name': 'PermaBrain', 'PermaBrain-Type': 'article' };
  if (filters.topic) tagFilters['Article-Topic'] = filters.topic;
  if (filters.kind) tagFilters['Article-Kind'] = filters.kind;
  if (filters.key) tagFilters['Article-Key'] = filters.key;
  if (filters.sourceName) tagFilters['Article-Source-Name'] = filters.sourceName;
  if (filters.sourceUrl) tagFilters['Article-Source-Url'] = filters.sourceUrl;
  const items = await transport.queryByTags(tagFilters);
  const remote = [...latestByArticleKey(items).values()].map(summarizeArticle).sort((a, b) => a.key.localeCompare(b.key));
  if (remote.length) return remote;
  const cached = Object.values(loadIndex(home).articles || {}).filter((article) => {
    if (filters.topic && article.topic !== filters.topic) return false;
    if (filters.kind && article.kind !== filters.kind) return false;
    if (filters.key && article.key !== filters.key) return false;
    if (filters.sourceName && article.sourceName !== filters.sourceName) return false;
    if (filters.sourceUrl && article.sourceUrl !== filters.sourceUrl) return false;
    return true;
  });
  return cached.sort((a, b) => a.key.localeCompare(b.key));
}

export async function resolveLatestArticle(key) {
  const home = getHome();
  const config = loadConfig(home);
  const transport = getTransport(config, home);
  const items = await transport.queryByTags({ 'App-Name': 'PermaBrain', 'PermaBrain-Type': 'article', 'Article-Key': key });
  const latest = latestByArticleKey(items).get(key);
  if (latest) return { item: latest, summary: summarizeArticle(latest), transport, home };
  const cached = loadIndex(home).articles?.[key];
  if (cached) return { item: { id: cached.id }, summary: cached, transport, home };
  throw new Error(`Article not found: ${key}`);
}

export async function getArticle(key) {
  const { item: indexItem, summary, transport, home } = await resolveLatestArticle(key);
  const item = await transport.fetchDataItem(indexItem.id);
  const content = payloadText(item);
  const actualHash = contentHash(content);
  if (actualHash !== summary.contentHash) throw new Error(`Content hash mismatch for ${key}`);
  writePageCache(home, key, content);
  return { item, summary, content };
}

export async function syncArticlesAndAttestations() {
  const home = getHome();
  const config = loadConfig(home);
  const transport = getTransport(config, home);
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
