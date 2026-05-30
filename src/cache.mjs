import fs from 'node:fs';
import path from 'node:path';
import { statePaths } from './config.mjs';
import { tagsToObject } from './tags.mjs';

export function latestByArticleKey(items) {
  const latest = new Map();
  for (const item of items) {
    const tags = tagsToObject(item.tags || []);
    const key = tags['Article-Key'];
    if (!key) continue;
    const version = Number(tags['Article-Version'] || 0);
    const prev = latest.get(key);
    const prevVersion = prev ? Number(tagsToObject(prev.tags || [])['Article-Version'] || 0) : -1;
    if (!prev || version > prevVersion || (version === prevVersion && String(item.timestamp) > String(prev.timestamp))) latest.set(key, item);
  }
  return latest;
}

export function summarizeArticle(item) {
  const tags = tagsToObject(item.tags || []);
  return {
    id: item.id,
    key: tags['Article-Key'],
    kind: tags['Article-Kind'],
    title: tags['Article-Title'],
    slug: tags['Article-Slug'],
    topic: tags['Article-Topic'],
    language: tags['Article-Language'],
    version: Number(tags['Article-Version'] || 0),
    previousId: tags['Article-Previous-Id'] || null,
    rootId: tags['Article-Root-Id'] || null,
    sourceName: tags['Article-Source-Name'] || null,
    sourceUrl: tags['Article-Source-Url'] || null,
    contentHash: tags['Article-Content-Hash'],
    updatedAt: tags['Article-Updated-At'] || item.timestamp,
    authorAgentId: tags['Author-Agent-Id'] || item.owner
  };
}

export function summarizeAttestation(item) {
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

export function loadIndex(home) {
  const { indexPath } = statePaths(home);
  if (!fs.existsSync(indexPath)) return { articles: {}, attestations: {}, updatedAt: null };
  return JSON.parse(fs.readFileSync(indexPath, 'utf8'));
}

export function writeIndex(home, index) {
  const { indexPath, cacheDir } = statePaths(home);
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2) + '\n');
  return index;
}

export function updateArticleInCache(home, item) {
  const index = loadIndex(home);
  const summary = summarizeArticle(item);
  index.articles[summary.key] = summary;
  index.updatedAt = new Date().toISOString();
  return writeIndex(home, index);
}

export function updateAttestationInCache(home, item) {
  const index = loadIndex(home);
  const summary = summarizeAttestation(item);
  if (!index.attestations[summary.targetKey]) index.attestations[summary.targetKey] = [];
  index.attestations[summary.targetKey] = index.attestations[summary.targetKey].filter((a) => a.id !== summary.id).concat(summary);
  index.updatedAt = new Date().toISOString();
  return writeIndex(home, index);
}

export function writePageCache(home, key, content) {
  const { pagesDir } = statePaths(home);
  fs.mkdirSync(pagesDir, { recursive: true });
  const file = path.join(pagesDir, key.replace(/\//g, '__') + '.md');
  fs.writeFileSync(file, content);
  return file;
}
