import fs from 'node:fs';
import path from 'node:path';
import yaml from 'yaml';
import { deriveKey, validateKind, tagsToObject } from './tags.mjs';
import * as pbcrypto from './crypto.mjs';
import { publishArticle } from './article.mjs';
import { loadConfig, getHome } from './config.mjs';
import { loadIdentity } from './keys.mjs';
import { logAction } from './log.mjs';

const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)([\s\S]*)$/;

export function deriveTitleFromContent(content) {
  if (!content || typeof content !== 'string') return null;
  const headingMatch = content.match(/^#{1,2}\s+(.+)/m);
  if (headingMatch) return headingMatch[1].trim();
  const firstLine = content.split('\n').find(l => l.trim());
  if (firstLine && firstLine.length < 120) return firstLine.trim();
  return null;
}

export function parseFrontmatter(raw) {
  const match = String(raw).match(FRONTMATTER_RE);
  if (!match) return { frontmatter: {}, body: raw };
  const frontSource = match[1].trim();
  const body = match[2];
  if (!frontSource) return { frontmatter: {}, body };
  const frontmatter = yaml.parse(frontSource) || {};
  return { frontmatter, body };
}

export function serializeFrontmatter(frontmatter, body) {
  if (!frontmatter || Object.keys(frontmatter).length === 0) return body;
  const y = yaml.stringify(frontmatter, { lineWidth: 0 }).trim();
  return `---\n${y}\n---\n${body}`;
}

export function renderTemplate(templateSource, variables = {}) {
  if (typeof templateSource !== 'string') throw new Error('Template source must be a string');
  const { frontmatter, body } = parseFrontmatter(templateSource);
  const mergedVars = { ...frontmatter, ...variables };
  let rendered = body.replace(/\{\{\s*([a-zA-Z0-9_\-.]+)\s*\}\}/g, (match, key) => {
    const val = key.split('.').reduce((obj, k) => (obj && k in obj ? obj[k] : undefined), mergedVars);
    return val === undefined ? match : String(val);
  });
  if (frontmatter && Object.keys(frontmatter).length) {
    rendered = serializeFrontmatter(frontmatter, rendered);
  }
  return { frontmatter, body, rendered, variables: mergedVars };
}

export function readTemplateFile(filePath) {
  const resolved = path.resolve(filePath);
  const source = fs.readFileSync(resolved, 'utf8');
  return { path: resolved, source };
}

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

export function buildArticleTags(frontmatter, options = {}) {
  const topic = options.topic || frontmatter.topic || 'general';
  const kind = validateKind(options.kind || frontmatter.kind || 'subject');
  const title = options.title || frontmatter.title || `${kind}/${topic}`;
  const tags = {
    App: frontmatter.app || options.app || 'PermaBrain',
    Topic: topic,
    Kind: kind,
    Title: title,
    ...(options.author ? { Author: options.author } : {}),
    ...(frontmatter.tags ? tagsToObject(frontmatter.tags) : {}),
    ...(options.extraTags ? tagsToObject(options.extraTags) : {}),
  };
  return tags;
}

export async function createArticleFromTemplate(sourceOrPath, options = {}) {
  const home = options.home || getHome();
  const config = options.config || loadConfig(home);
  const identity = options.identity || loadIdentity(home);
  const { variables = {}, title, topic, kind, tags: extraTags, encrypt, recipients, publishOptions = {}, source: sourceOption } = options;
  const source = sourceOption || readTemplateFile(sourceOrPath).source;
  const { rendered, frontmatter } = renderTemplate(source, variables);
  const articleKind = validateKind(kind || frontmatter.kind || 'subject');
  const articleTopic = topic || frontmatter.topic || 'general';
  const publishTitle = options.title || frontmatter.title || deriveTitleFromContent(rendered) || `${articleKind}/${articleTopic}`;
  const articleTags = buildArticleTags(frontmatter, { topic: articleTopic, kind: articleKind, title: publishTitle, extraTags, app: options.app });
  const canonicalKey = options.key || deriveKey({ key: undefined, kind: articleTags.Kind, title: publishTitle });

  let finalBody = rendered;
  let finalTags = articleTags;
  let encryptedEnvelope = null;
  if (encrypt) {
    const authorKeypair = await deriveAuthorEncryptionKeypair(identity);
    const recipientKeys = [...new Set([...(recipients || []), authorKeypair.publicKey])];
    const { encryptedPayload, envelope } = await pbcrypto.encrypt(rendered, recipientKeys);
    finalBody = encryptedPayload;
    encryptedEnvelope = envelope;
    finalTags.EncryptionRecipients = JSON.stringify(envelope.recipients.map(r => r.publicKeyFingerprint));
    finalTags.EncryptionEphemeralPublicKey = envelope.ephemeralPublicKey;
    finalTags.Visibility = 'encrypted';
  }

  const extraTagsArray = Object.entries(finalTags).map(([name, value]) => ({ name, value: String(value) }));

  const publishResult = await publishArticle({
    content: finalBody,
    tags: extraTagsArray,
    key: canonicalKey,
    topic: articleTopic,
    kind: articleKind,
    title: publishTitle,
    sourceUrl: options.sourceUrl || 'template://local',
    sourceName: 'Template',
    useHyperbeam: config.hyperbeam?.enabled || false,
    useHyperbeamReference: config.hyperbeam?.references || false,
    visibility: encrypt ? 'encrypted' : 'public',
    ...publishOptions,
  });

  await logAction({
    action: 'template-publish',
    status: 'ok',
    home: config.home,
    key: canonicalKey,
    message: `Published article from template${encrypt ? ' (encrypted)' : ''}`,
    details: { encrypted: !!encrypt, topic, kind, sourcePath: sourceOption ? null : sourceOrPath },
  });

  const result = {
    key: canonicalKey,
    tags: finalTags,
    encrypted: !!encrypt,
    ...publishResult,
  };

  if (encrypt) {
    const authorKeypair = await deriveAuthorEncryptionKeypair(identity);
    if (!recipients || recipients.length === 0) {
      result.recipients = [authorKeypair.publicKey];
    } else {
      result.recipients = recipients.slice();
    }
    result.envelope = encryptedEnvelope;
  }

  return result;
}

export async function template(sourceOrPath, options = {}) {
  return createArticleFromTemplate(sourceOrPath, options);
}
