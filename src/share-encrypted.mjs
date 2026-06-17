/**
 * PermaBrain Encrypted Article Sharing
 *
 * Share encrypted articles via ZenBin pages with CAP (Content Addressed
 * Publication) recipients. The plaintext is encrypted for one or more X25519
 * recipients, wrapped in a self-contained HTML page, and published to ZenBin
 * with a recipient key id so only the intended recipient can access the page.
 *
 * The HTML page embeds the encrypted envelope and a small decryption helper so
 * the recipient can decrypt in-browser if they have their X25519 seed. The
 * page itself is directed to a CAP recipient on ZenBin.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getHome, loadConfig } from './config.mjs';
import { loadIdentity, publicIdentity } from './keys.mjs';
import * as pbcrypto from './crypto.mjs';
import { publishPage, computeFingerprint, ZENBIN_BASE_URL, ZENBIN_PUBLISH_PATH } from './zenbin.mjs';
import { deriveKey, buildArticleTags, contentHash, tagsToObject } from './tags.mjs';
import { createDataItem } from './dataitem.mjs';
import { getTransport } from './transport.mjs';
import { updateArticleInCache, writePageCache } from './cache.mjs';
import { validateArticleMetadata } from './schema.mjs';

/**
 * Derive the author's X25519 encryption keypair from the local identity.
 */
export async function deriveAuthorEncryptionKeypair(identity) {
  if (identity.type === 'ed25519') {
    const edSeed = Buffer.from(identity.secretKey, 'base64url').subarray(0, 32);
    return pbcrypto.deriveEncryptionKeyFromEd25519(edSeed);
  }
  if (identity.type === 'arweave-rsa4096' && identity.encryptionSeed) {
    return pbcrypto.deriveEncryptionKeyFromEd25519(Buffer.from(identity.encryptionSeed, 'base64url'));
  }
  return pbcrypto.generateEncryptionKeypair();
}

/**
 * Build a self-contained HTML page that embeds an encrypted envelope and
 * provides a decryption interface for X25519 recipients.
 *
 * @param {Object} data
 * @param {string} data.title
 * @param {string} data.key
 * @param {string} data.kind
 * @param {string} data.topic
 * @param {string} data.agentId
 * @param {string} data.publishedAt
 * @param {string} data.encryptedPayload - JSON string of the encryption envelope
 * @param {string[]} data.recipientFingerprints
 * @param {string} data.sourceUrl
 * @param {string} [data.recipientKeyId]
 * @param {string} [data.baseUrl]
 * @returns {string} HTML
 */
export function buildEncryptedSharePage(data, opts = {}) {
  const title = data.title || `Encrypted share — ${data.key}`;
  const jsonData = JSON.stringify({
    title,
    key: data.key,
    kind: data.kind,
    topic: data.topic,
    agentId: data.agentId,
    publishedAt: data.publishedAt,
    encryptedPayload: data.encryptedPayload,
    recipientFingerprints: data.recipientFingerprints,
    sourceUrl: data.sourceUrl,
    recipientKeyId: data.recipientKeyId || null,
    baseUrl: data.baseUrl || ZENBIN_BASE_URL
  }).replace(/</g, '\\u003c');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      --bg: #0d1117;
      --panel: #161b22;
      --panel-2: #1c2128;
      --border: #30363d;
      --text: #c9d1d9;
      --muted: #8b949e;
      --accent: #58a6ff;
      --accent-2: #238636;
      --warn: #d29922;
      --danger: #f85149;
      --radius: 8px;
      --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
      line-height: 1.6;
      padding: 1.5rem;
    }
    .wrap { max-width: 720px; margin: 0 auto; }
    .card {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 1.25rem;
      margin-bottom: 1rem;
    }
    h1 { margin: 0 0 .5rem; font-size: 1.5rem; }
    h2 { margin: 1.5rem 0 .5rem; font-size: 1.1rem; color: var(--muted); }
    .meta { color: var(--muted); font-size: .875rem; }
    .meta code { font-family: var(--mono); background: var(--panel-2); padding: .1rem .3rem; border-radius: 4px; }
    label { display: block; margin: .75rem 0 .25rem; font-size: .875rem; color: var(--muted); }
    textarea, input {
      width: 100%;
      background: var(--panel-2);
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: .6rem;
      font-family: var(--mono);
      font-size: .875rem;
    }
    textarea { min-height: 80px; resize: vertical; }
    button {
      background: var(--accent);
      color: #fff;
      border: 0;
      border-radius: 6px;
      padding: .6rem 1rem;
      font-weight: 600;
      cursor: pointer;
      margin-top: .75rem;
    }
    button:hover { opacity: .9; }
    .output {
      background: var(--panel-2);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 1rem;
      margin-top: 1rem;
      white-space: pre-wrap;
      font-family: var(--mono);
      font-size: .875rem;
      min-height: 60px;
    }
    .hidden { display: none; }
    .error { color: var(--danger); }
    .success { color: var(--accent-2); }
    .warn { color: var(--warn); }
    .muted { color: var(--muted); }
    .footer { margin-top: 2rem; color: var(--muted); font-size: .8rem; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <h1>🔒 Encrypted PermaBrain Share</h1>
      <div class="meta">
        <span id="key"></span> · <span id="kind"></span> · <span id="topic"></span><br>
        Shared by <code id="agentId"></code> at <span id="publishedAt"></span>
      </div>
    </div>

    <div class="card">
      <h2>Decrypt in browser</h2>
      <p class="muted">Paste your X25519 private seed (base64url) to decrypt the embedded content. Decryption happens locally in your browser.</p>
      <label for="seed-input">X25519 private seed (base64url)</label>
      <textarea id="seed-input" placeholder="Paste 32-byte X25519 seed here (base64url)"></textarea>
      <button id="decrypt-btn">Decrypt</button>
      <div id="status" class="output hidden"></div>
      <div id="plaintext" class="output hidden"></div>
    </div>

    <div class="card">
      <h2>Recipients</h2>
      <ul id="recipients" class="muted"></ul>
    </div>

    <div class="card hidden" id="source-card">
      <h2>Source</h2>
      <a id="source-link" href="#" target="_blank" rel="noopener"></a>
    </div>

    <div class="footer">
      PermaBrain encrypted share · Content is encrypted with X25519 + AES-256-GCM.
    </div>
  </div>

  <script>
    const DATA = ${jsonData};
    const $ = (id) => document.getElementById(id);

    $('key').textContent = DATA.key || '—';
    $('kind').textContent = DATA.kind || '—';
    $('topic').textContent = DATA.topic || '—';
    $('agentId').textContent = DATA.agentId || '—';
    $('publishedAt').textContent = DATA.publishedAt ? new Date(DATA.publishedAt).toLocaleString() : '—';

    if (DATA.recipientFingerprints && DATA.recipientFingerprints.length) {
      $('recipients').innerHTML = DATA.recipientFingerprints.map(function(fp) {
        return '<li><code>' + fp + '</code></li>';
      }).join('');
    } else {
      $('recipients').innerHTML = '<li class="muted">No recipient fingerprints recorded.</li>';
    }

    if (DATA.sourceUrl) {
      $('source-card').classList.remove('hidden');
      $('source-link').href = DATA.sourceUrl;
      $('source-link').textContent = DATA.sourceUrl;
    }

    async function sha256Hex(buffer) {
      const digest = await crypto.subtle.digest('SHA-256', buffer);
      return Array.from(new Uint8Array(digest)).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
    }

    function base64urlToBuffer(str) {
      str += new Array(5 - (str.length % 4)).join('=');
      str = str.replace(/\\-/g, '+').replace(/_/g, '/');
      const binary = atob(str);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return bytes;
    }

    function bufferToBase64url(buffer) {
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      return btoa(binary).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
    }

    async function hkdfSha256(sharedSecret, salt, info, length) {
      const key = await crypto.subtle.importKey('raw', sharedSecret, 'HKDF', false, ['deriveBits']);
      return crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: salt, info: info }, key, length * 8);
    }

    async function aesGcmDecrypt(key, iv, ciphertext, authTag) {
      const full = new Uint8Array(ciphertext.length + authTag.length);
      full.set(ciphertext, 0);
      full.set(authTag, ciphertext.length);
      const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'AES-GCM' }, false, ['decrypt']);
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, cryptoKey, full);
      return new Uint8Array(plain);
    }

    async function x25519ScalarMult(privateKeyBytes, publicKeyBytes) {
      // Use SubtleCurve25519 via WebCrypto extension if available; otherwise fall back.
      if (crypto.subtle.x25519) {
        const priv = await crypto.subtle.importKey('raw', privateKeyBytes, { name: 'X25519' }, false, ['deriveBits']);
        const pub = await crypto.subtle.importKey('raw', publicKeyBytes, { name: 'X25519' }, true, []);
        return crypto.subtle.deriveBits({ name: 'X25519', public: pub }, priv, 256);
      }
      throw new Error('Browser X25519 support is required for in-page decryption. Use permabrain get-encrypted with the --seed option instead.');
    }

    async function decryptEnvelope(seedBase64url) {
      const seed = base64urlToBuffer(seedBase64url);
      if (seed.length !== 32) throw new Error('X25519 seed must be 32 bytes');

      const envelope = typeof DATA.encryptedPayload === 'string' ? JSON.parse(DATA.encryptedPayload) : DATA.encryptedPayload;

      // Derive X25519 public key from seed using libsodium-style clamped scalar (approximate via WebCrypto not possible, so we rely on browser support for X25519 import)
      const privKey = await crypto.subtle.importKey('raw', seed, { name: 'X25519' }, false, ['deriveBits']);
      const pubBits = await crypto.subtle.deriveBits({ name: 'X25519', public: privKey }, privKey, 256).catch(function() {
        throw new Error('Unable to derive public key from seed. Ensure your browser supports X25519.');
      });
      const pubBytes = new Uint8Array(pubBits);
      const fingerprint = await sha256Hex(pubBytes);

      const recipient = envelope.recipients.find(function(r) { return r.publicKeyFingerprint === fingerprint; });
      if (!recipient) throw new Error('Your key is not in the recipient list for this share.');

      const ephemeralPub = base64urlToBuffer(envelope.ephemeralPublicKey);
      const sharedSecret = await x25519ScalarMult(seed, ephemeralPub);
      const salt = base64urlToBuffer(envelope.salt);
      const kek = await hkdfSha256(new Uint8Array(sharedSecret), salt, new TextEncoder().encode('permabrain-v1'), 32);

      const encryptedKeyBytes = base64urlToBuffer(recipient.encryptedKey);
      const keyCiphertext = encryptedKeyBytes.slice(0, encryptedKeyBytes.length - 16);
      const keyAuthTag = encryptedKeyBytes.slice(encryptedKeyBytes.length - 16);
      const keyIv = new Uint8Array(12);
      const messageKey = await aesGcmDecrypt(kek, keyIv, keyCiphertext, keyAuthTag);

      const iv = base64urlToBuffer(envelope.iv);
      const ciphertext = base64urlToBuffer(envelope.ciphertext);
      const authTag = base64urlToBuffer(envelope.authTag);
      const plaintext = await aesGcmDecrypt(messageKey, iv, ciphertext, authTag);
      return new TextDecoder().decode(plaintext);
    }

    $('decrypt-btn').addEventListener('click', async function() {
      const seed = $('seed-input').value.trim();
      const statusEl = $('status');
      const plainEl = $('plaintext');
      statusEl.classList.remove('hidden', 'error', 'success');
      plainEl.classList.add('hidden');
      try {
        const plain = await decryptEnvelope(seed);
        statusEl.textContent = '✓ Decrypted successfully';
        statusEl.classList.add('success');
        plainEl.textContent = plain;
        plainEl.classList.remove('hidden');
      } catch (err) {
        statusEl.textContent = '✗ ' + err.message;
        statusEl.classList.add('error');
      }
    });
  </script>
</body>
</html>`;
}

function escapeHtml(str) {
  if (str === undefined || str === null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Publish an encrypted share page to ZenBin.
 *
 * @param {Object} shareData
 * @param {string} shareData.html
 * @param {string} shareData.title
 * @param {string} shareData.key
 * @param {string} shareData.recipientKeyId
 * @param {Object} opts
 * @param {string} opts.keyId
 * @param {Object} opts.privateJwk
 * @param {string} [opts.pageId]
 * @param {string} [opts.subdomain]
 * @param {string} [opts.baseUrl]
 * @returns {Promise<{ok, pageId, url, bytes, recipientKeyId}>}
 */
export async function publishEncryptedShare(shareData, opts = {}) {
  const keyId = opts.keyId;
  const privateJwk = opts.privateJwk;
  if (!keyId) throw new Error('keyId is required to publish an encrypted share');
  if (!privateJwk) throw new Error('privateJwk is required to publish an encrypted share');

  const pageId = opts.pageId || sharePageId(shareData.key, shareData.agentId, new Date().toISOString());
  const recipientKeyId = shareData.recipientKeyId;

  const result = await publishPage({
    keyId,
    privateJwk,
    baseUrl: opts.baseUrl,
    pageId,
    html: shareData.html,
    title: shareData.title,
    recipientKeyId,
    subdomain: opts.subdomain
  });

  return {
    ...result,
    recipientKeyId,
    bytes: Buffer.byteLength(shareData.html, 'utf8'),
    key: shareData.key
  };
}

export function sharePageId(key, agentId, timestamp) {
  const safeKey = String(key).replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
  const safeAgent = String(agentId || 'unknown').replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
  const safeTs = String(timestamp || new Date().toISOString()).replace(/[:.]/g, '-');
  return `pb-share-${safeKey}-${safeAgent}-${safeTs}`;
}

/**
 * Share an encrypted article via ZenBin.
 *
 * Encrypts the content for the requested recipients (always including the
 * author), optionally publishes a PermaBrain DataItem to Arweave, and
 * publishes a self-contained encrypted share page to ZenBin.
 *
 * @param {Object} opts
 * @param {string} [opts.file] - Source file path
 * @param {string} [opts.content] - Source content (alternative to file)
 * @param {string} opts.kind
 * @param {string} opts.topic
 * @param {string} [opts.key]
 * @param {string} [opts.title]
 * @param {string} opts.sourceUrl
 * @param {string} [opts.sourceName]
 * @param {string} [opts.sourceLicense]
 * @param {string} [opts.language='en']
 * @param {string[]} opts.encryptedFor - X25519 public keys (base64url)
 * @param {string} [opts.recipientKeyId] - ZenBin CAP recipient fingerprint
 * @param {string|Object} [opts.recipient] - Recipient public JWK or fingerprint for CAP
 * @param {string} [opts.pageId]
 * @param {string} [opts.subdomain]
 * @param {string} [opts.baseUrl]
 * @param {boolean} [opts.alsoPublish=false] - Also publish to Arweave as PermaBrain article
 * @param {Object} [opts.keyId]
 * @param {Object} [opts.privateJwk]
 * @param {string} [opts.home]
 * @returns {Promise<{share: object, article?: object}>}
 */
export async function shareEncryptedArticle(opts = {}) {
  const home = opts.home || getHome();
  const config = loadConfig(home);
  const identity = loadIdentity(home);
  if (!opts.kind) throw new Error('--kind is required');
  if (!opts.topic) throw new Error('--topic is required');
  if (!opts.sourceUrl) throw new Error('--source-url is required');
  if (!opts.encryptedFor || opts.encryptedFor.length === 0) throw new Error('--for is required with at least one recipient public key');

  const finalContent = opts.content ?? (opts.file ? fs.readFileSync(opts.file, 'utf8') : null);
  if (finalContent === null) throw new Error('file or content is required');

  const finalTitle = opts.title || (opts.file ? path.basename(opts.file, path.extname(opts.file)) : opts.key?.split('/').at(-1));
  const finalKey = opts.key || deriveKey({ kind: opts.kind, title: finalTitle });

  const authorKeypair = await deriveAuthorEncryptionKeypair(identity);
  const recipientKeys = [...new Set([...opts.encryptedFor, authorKeypair.publicKey])];
  const encryption = await pbcrypto.encrypt(finalContent, recipientKeys);
  const encryptedPayload = encryption.encryptedPayload;
  const encryptionEnvelope = encryption.envelope;

  const publishedAt = new Date().toISOString();
  const publicId = publicIdentity(identity);

  const shareData = {
    title: finalTitle,
    key: finalKey,
    kind: opts.kind,
    topic: opts.topic,
    agentId: publicId.agentId,
    publishedAt,
    encryptedPayload,
    recipientFingerprints: encryptionEnvelope.recipients.map(r => r.publicKeyFingerprint),
    sourceUrl: opts.sourceUrl,
    recipientKeyId: opts.recipientKeyId || (opts.recipient ? computeFingerprint(opts.recipient) : undefined),
    baseUrl: opts.baseUrl
  };

  const html = buildEncryptedSharePage(shareData, opts);

  let articleResult = null;
  if (opts.alsoPublish) {
    const transport = getTransport(config, home, { useHyperbeam: opts.useHyperbeam ?? false });
    const existingTags = [];
    const tags = buildArticleTags({
      key: finalKey,
      kind: opts.kind,
      title: finalTitle,
      topic: opts.topic,
      language: opts.language || 'en',
      version: 1,
      previousId: null,
      rootId: null,
      sourceName: opts.sourceName || sourceNameFromUrl(opts.sourceUrl),
      sourceUrl: opts.sourceUrl,
      sourceLicense: opts.sourceLicense || '',
      content: encryptedPayload,
      agentId: publicId.agentId,
      visibility: 'encrypted'
    });
    tags.push({ name: 'Encryption-Recipients', value: JSON.stringify(encryptionEnvelope.recipients.map(r => r.publicKeyFingerprint)) });
    tags.push({ name: 'Encryption-Ephemeral-Public-Key', value: encryptionEnvelope.ephemeralPublicKey });
    if (opts.recipientKeyId || opts.recipient) {
      tags.push({ name: 'ZenBin-Share-Recipient', value: shareData.recipientKeyId });
    }

    const item = await createDataItem({ payload: encryptedPayload, tags, identity });
    const validation = validateArticleMetadata(tagsToObject(item.tags || []));
    if (!validation.valid) {
      const details = validation.errors.map(e => `${e.path}: ${e.message}`).join('; ');
      throw new Error(`Article metadata validation failed: ${details}`);
    }
    await transport.uploadDataItem(item);
    updateArticleInCache(home, item);
    writePageCache(home, finalKey, finalContent);
    articleResult = { item, id: item.id, key: finalKey, version: 1 };
  }

  return {
    share: {
      html,
      title: finalTitle,
      key: finalKey,
      kind: opts.kind,
      topic: opts.topic,
      agentId: publicId.agentId,
      publishedAt,
      encryptedPayload,
      recipientFingerprints: shareData.recipientFingerprints,
      recipientKeyId: shareData.recipientKeyId,
      sourceUrl: opts.sourceUrl
    },
    article: articleResult
  };
}

export function sourceNameFromUrl(url) {
  if (!url) return 'Unknown';
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return host;
  } catch {
    return 'Unknown';
  }
}
