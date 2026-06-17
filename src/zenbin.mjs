/**
 * ZenBin publishing client
 *
 * Publishes HTML/markdown pages to ZenBin via Ed25519-signed POST requests.
 * Uses the CAP Protocol v0.2.1 conventions for directed content.
 *
 * Reference: skills/zenbin/SKILL.md
 */

import crypto from 'node:crypto';

export const ZENBIN_BASE_URL = 'https://zenbin.org';
export const ZENBIN_PUBLISH_PATH = '/v1/pages';

/**
 * Compute SHA-256 fingerprint of an Ed25519 public key.
 *
 * @param {Object|string} publicJwkOrKey - Public JWK with `x` field, or base64url public key bytes
 * @returns {string} 43-character base64url fingerprint
 */
export function computeFingerprint(publicJwkOrKey) {
  const publicKeyB64url = typeof publicJwkOrKey === 'string'
    ? publicJwkOrKey
    : publicJwkOrKey?.x;
  if (!publicKeyB64url) throw new Error('publicKey or publicJwk is required');
  const publicKeyBuffer = Buffer.from(publicKeyB64url, 'base64url');
  return crypto.createHash('sha256').update(publicKeyBuffer).digest('base64url');
}

/**
 * Build a base64url Content-Digest header for a request body.
 *
 * @param {string|Buffer} body
 * @returns {string} `sha-256=:<base64>:`
 */
export function contentDigest(body) {
  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
  const digest = crypto.createHash('sha256').update(buffer).digest('base64url');
  return `sha-256=:${digest}:`;
}

/**
 * Sign a ZenBin request canonical string with an Ed25519 private JWK.
 *
 * Canonical string for publish (POST with page id):
 *   METHOD\nPATH\nTIMESTAMP\nNONCE\nCONTENT-DIGEST
 *
 * @param {Object} privateJwk - Ed25519 private JWK with `d` and `x`
 * @param {string} method - HTTP method
 * @param {string} path - Request path (including page id for POST)
 * @param {string} timestamp - ISO-8601 timestamp
 * @param {string} nonce - Unique nonce
 * @param {string} digest - Content-Digest header value
 * @returns {string} base64url signature, with `:` wrappers for header
 */
export function signRequest(privateJwk, method, path, timestamp, nonce, digest) {
  if (!privateJwk?.d) throw new Error('privateJwk with d is required');
  const canonical = `${method.toUpperCase()}\n${path}\n${timestamp}\n${nonce}\n${digest}`;
  const privateKey = crypto.createPrivateKey({ key: privateJwk, format: 'jwk' });
  const signature = crypto.sign(null, Buffer.from(canonical, 'utf8'), privateKey);
  return `:${signature.toString('base64url')}:`;
}

/**
 * Publish a page to ZenBin.
 *
 * @param {Object} opts
 * @param {string} opts.keyId - Registered ZenBin key id
 * @param {Object} opts.privateJwk - Ed25519 private JWK
 * @param {string} [opts.baseUrl='https://zenbin.org'] - ZenBin base URL
 * @param {string} [opts.pageId] - Page id; if omitted, ZenBin assigns one
 * @param {string} [opts.html] - HTML content
 * @param {string} [opts.markdown] - Markdown content
 * @param {string} [opts.title] - Page title
 * @param {string} [opts.recipientKeyId] - Optional CAP recipient fingerprint
 * @param {string} [opts.subdomain] - Optional claimed subdomain
 * @returns {Promise<{ok, pageId, url, response}>}
 */
export async function publishPage(opts = {}) {
  const keyId = opts.keyId;
  const privateJwk = opts.privateJwk;
  if (!keyId) throw new Error('keyId is required');
  if (!privateJwk) throw new Error('privateJwk is required');

  const bodyFields = {};
  if (opts.html !== undefined) bodyFields.html = opts.html;
  if (opts.markdown !== undefined) bodyFields.markdown = opts.markdown;
  if (opts.title !== undefined) bodyFields.title = opts.title;
  if (opts.recipientKeyId !== undefined) bodyFields.recipientKeyId = opts.recipientKeyId;

  const hasContent = Object.keys(bodyFields).some((k) => k !== 'title' && k !== 'recipientKeyId');
  if (!hasContent) throw new Error('html or markdown content is required');

  const body = JSON.stringify(bodyFields);
  const timestamp = new Date().toISOString();
  const nonce = crypto.randomUUID();
  const digest = contentDigest(body);
  const path = opts.pageId ? `${ZENBIN_PUBLISH_PATH}/${opts.pageId}` : ZENBIN_PUBLISH_PATH;
  const signature = signRequest(privateJwk, 'POST', path, timestamp, nonce, digest);

  const baseUrl = opts.baseUrl || ZENBIN_BASE_URL;
  const url = `${baseUrl}${path}`;

  const headers = {
    'content-type': 'application/json',
    'x-zenbin-key-id': keyId,
    'x-zenbin-timestamp': timestamp,
    'x-zenbin-nonce': nonce,
    'content-digest': digest,
    'x-zenbin-signature': signature
  };
  if (opts.subdomain) headers['x-subdomain'] = opts.subdomain;
  if (opts.recipientKeyId) headers['cap-recipient-key-id'] = opts.recipientKeyId;

  const response = await fetch(url, { method: 'POST', headers, body });
  let responseBody;
  const responseText = await response.text();
  try { responseBody = JSON.parse(responseText); } catch { responseBody = responseText; }

  if (!response.ok) {
    throw new Error(`ZenBin publish failed: ${response.status} ${response.statusText} ${JSON.stringify(responseBody)}`);
  }

  const returnedPageId = responseBody?.id || opts.pageId;
  const pageUrl = returnedPageId ? `${baseUrl}/p/${returnedPageId}` : url;

  return {
    ok: true,
    pageId: returnedPageId,
    url: pageUrl,
    response: responseBody
  };
}

/**
 * Derive a page id for a dashboard snapshot from agent id and timestamp.
 *
 * @param {string} agentId
 * @param {string} [timestamp] - ISO timestamp
 * @returns {string}
 */
export function dashboardPageId(agentId, timestamp) {
  const safeAgent = String(agentId).replace(/[^a-zA-Z0-9:-]/g, '-').toLowerCase();
  const ts = timestamp || new Date().toISOString();
  const safeTs = ts.replace(/[:.]/g, '-');
  return `permabrain-dashboard-${safeAgent}-${safeTs}`;
}
