/**
 * PermaBrain Fork
 *
 * Create a new version branch from an existing article, preserving canonical
 * lineage while allowing independent evolution.
 *
 * A fork:
 *   - Starts from a source article (latest version or explicit targetId)
 *   - Copies its content, kind, topic, source metadata, and language
 *   - Applies user edits (title, content, topic, kind, sourceUrl, sourceName)
 *   - Publishes a new DataItem with a NEW canonical key (the fork key)
 *   - Tags the fork with Article-Fork-Of = source key and
 *     Article-Fork-Source-Id = source DataItem ID
 *
 * The original article's version chain remains untouched. The fork begins its
 * own version chain at v1, but keeps a permanent pointer back to the source
 * article for provenance.
 */

import { getHome, loadConfig } from './config.mjs';
import { getTransport } from './transport.mjs';
import { getArticle, publishArticle } from './article.mjs';
import { tagsToObject, validateArticleKey } from './tags.mjs';

export function deriveForkKey(sourceKey, forkSlug) {
  validateArticleKey(sourceKey);
  const [kind, ...rest] = sourceKey.split('/');
  const baseSlug = rest.join('/');
  const suffix = forkSlug ? `-${forkSlug}` : '-fork';
  const candidate = `${kind}/${baseSlug}${suffix}`;
  validateArticleKey(candidate);
  return candidate;
}

export async function forkArticle(sourceKey, edits = {}, opts = {}) {
  const home = opts.home || getHome();
  const config = opts.config || loadConfig(home);
  const transport = opts.transport || getTransport(config, home, { useHyperbeam: opts.useHyperbeam });

  // Resolve source article (latest by default, or explicit targetId)
  let sourceItem;
  let sourceSummary;
  if (opts.targetId) {
    sourceItem = await transport.fetchDataItem(opts.targetId);
    const sourceTags = tagsToObject(sourceItem.tags || []);
    if (sourceTags['Article-Key'] !== sourceKey) {
      throw new Error(`targetId ${opts.targetId} does not match source key ${sourceKey}`);
    }
    sourceSummary = buildSourceSummary(sourceItem);
  } else {
    const resolved = await getArticle(sourceKey, { ...opts, transport, home });
    sourceItem = resolved.item;
    sourceSummary = resolved.summary;
  }

  const sourceTags = tagsToObject(sourceItem.tags || []);

  // Determine fork key
  let forkKey;
  if (edits.key) {
    forkKey = edits.key;
    validateArticleKey(forkKey);
    if (forkKey === sourceKey) throw new Error('fork key must differ from source key');
  } else {
    const kind = edits.kind || sourceSummary.kind;
    const slugBase = edits.title || sourceSummary.title;
    const forkSlug = edits.slug || generateForkSlug(slugBase, sourceSummary.version);
    forkKey = `${kind}/${forkSlug}`;
    validateArticleKey(forkKey);
  }

  // Apply edits on top of source metadata
  const finalContent = edits.content ?? resolvedContent(sourceItem, opts);
  const finalTitle = edits.title || sourceSummary.title || forkKey.split('/').at(-1);
  const finalTopic = edits.topic || sourceSummary.topic;
  const finalKind = edits.kind || sourceSummary.kind;
  const finalLanguage = edits.language || sourceSummary.language || 'en';
  const finalSourceUrl = edits.sourceUrl || sourceSummary.sourceUrl;
  const finalSourceName = edits.sourceName || sourceSummary.sourceName || sourceNameFromUrl(finalSourceUrl);
  const finalSourceLicense = edits.sourceLicense ?? sourceTags['Article-Source-License'] ?? '';

  // Fork lineage tags are part of the signed DataItem.
  const extraTags = [
    { name: 'Article-Fork-Of', value: sourceKey },
    { name: 'Article-Fork-Source-Id', value: sourceSummary.id },
    { name: 'Article-Fork-Source-Version', value: String(sourceSummary.version || 1) }
  ];
  if (sourceSummary.rootId) {
    extraTags.push({ name: 'Article-Fork-Root-Id', value: sourceSummary.rootId });
  }

  const publishResult = await publishArticle({
    content: finalContent,
    kind: finalKind,
    topic: finalTopic,
    key: forkKey,
    title: finalTitle,
    sourceUrl: finalSourceUrl,
    sourceName: finalSourceName,
    sourceLicense: finalSourceLicense,
    language: finalLanguage,
    useHyperbeam: opts.useHyperbeam ?? false,
    useHyperbeamReference: opts.useHyperbeamReference ?? config.hyperbeam?.references ?? false,
    visibility: edits.visibility || 'public',
    encryptedFor: edits.encryptedFor,
    extraTags
  });

  return {
    source: {
      key: sourceKey,
      id: sourceSummary.id,
      version: sourceSummary.version || 1
    },
    fork: publishResult.summary,
    forkKey,
    editsApplied: Object.keys(edits).filter((k) => !['key', 'slug', 'visibility', 'encryptedFor'].includes(k)),
    item: publishResult.item,
    reference: publishResult.reference,
    encrypted: publishResult.encrypted,
    encryptionEnvelope: publishResult.encryptionEnvelope
  };
}

function buildSourceSummary(item) {
  const tags = tagsToObject(item.tags || []);
  return {
    id: item.id,
    key: tags['Article-Key'],
    kind: tags['Article-Kind'],
    title: tags['Article-Title'],
    topic: tags['Article-Topic'],
    language: tags['Article-Language'] || 'en',
    sourceName: tags['Article-Source-Name'] || null,
    sourceUrl: tags['Article-Source-Url'] || null,
    sourceLicense: tags['Article-Source-License'] || '',
    contentHash: tags['Article-Content-Hash'],
    version: Number(tags['Article-Version'] || 1),
    rootId: tags['Article-Root-Id'] || null
  };
}

function resolvedContent(item, opts) {
  if (opts.sourceContent) return opts.sourceContent;
  const tags = tagsToObject(item.tags || []);
  if (tags.Visibility === 'encrypted' || tags.Visibility === 'private') {
    throw new Error('Cannot fork encrypted article without decrypted source content; provide edits.content or opts.sourceContent');
  }
  if (item.payloadBase64) {
    return Buffer.from(item.payloadBase64, 'base64').toString('utf8');
  }
  if (item.ans104Base64) {
    return Buffer.from(item.ans104Base64, 'base64').toString('utf8');
  }
  throw new Error('Source item has no readable payload');
}

function generateForkSlug(title, sourceVersion) {
  const base = String(title || 'fork')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${base}-v${sourceVersion || 1}-fork`;
}

function sourceNameFromUrl(url) {
  if (!url) return 'Unknown';
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return host;
  } catch {
    return 'Unknown';
  }
}

export async function listForks(sourceKey, opts = {}) {
  validateArticleKey(sourceKey);
  const home = opts.home || getHome();
  const config = opts.config || loadConfig(home);
  const transport = opts.transport || getTransport(config, home, { useHyperbeam: opts.useHyperbeam });
  const items = await transport.queryByTags({
    'App-Name': 'PermaBrain',
    'PermaBrain-Type': 'article',
    'Article-Fork-Of': sourceKey
  });
  return items.map((item) => {
    const tags = tagsToObject(item.tags || []);
    return {
      id: item.id,
      key: tags['Article-Key'],
      title: tags['Article-Title'],
      kind: tags['Article-Kind'],
      topic: tags['Article-Topic'],
      forkedAt: tags['Article-Fork-Source-Id'],
      sourceVersion: Number(tags['Article-Fork-Source-Version'] || 1),
      version: Number(tags['Article-Version'] || 1)
    };
  });
}
