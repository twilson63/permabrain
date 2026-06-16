/**
 * Viewer crypto helpers for decrypting encrypted PermaBrain articles in the browser.
 *
 * Mirrors src/crypto.mjs logic using Web Crypto API for browser compatibility.
 * Scheme: X25519 ECDH + HKDF-SHA256 + AES-256-GCM.
 */

const ENVELOPE_VERSION = 1;
const HKDF_INFO = new TextEncoder().encode('permabrain-v1');
const X25519_PKCS8_PREFIX = hexToBytes('302e020100300506032b656e04220420');
const X25519_SPKI_PREFIX = hexToBytes('302a300506032b656e032100');

function b64url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function fromB64url(value) {
  if (typeof value !== 'string') return new Uint8Array(value);
  let str = value.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const binary = atob(str);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  return bytes;
}

function concat(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

async function sha256(buffer) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', buffer));
}

async function importX25519PrivateKey(seed) {
  if (seed.length !== 32) throw new Error('X25519 seed must be 32 bytes');
  const der = concat(X25519_PKCS8_PREFIX, seed);
  return crypto.subtle.importKey('pkcs8', der, { name: 'X25519' }, false, ['deriveBits']);
}

async function importX25519PublicKey(rawBytes) {
  if (rawBytes.length !== 32) throw new Error('X25519 public key must be 32 bytes');
  const der = concat(X25519_SPKI_PREFIX, rawBytes);
  return crypto.subtle.importKey('spki', der, { name: 'X25519' }, false, []);
}

async function ecdhSharedSecret(privateKey, publicKeyRaw) {
  const pub = await importX25519PublicKey(publicKeyRaw);
  const bits = await crypto.subtle.deriveBits({ name: 'X25519', public: pub }, privateKey, 256);
  return new Uint8Array(bits);
}

async function hkdfDeriveKey(sharedSecret, salt, length = 32) {
  const baseKey = await crypto.subtle.importKey('raw', sharedSecret, { name: 'HKDF' }, false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: HKDF_INFO },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    true,
    ['decrypt']
  );
}

async function aesGcmDecrypt(key, iv, ciphertext, authTag) {
  const full = concat(ciphertext, authTag);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, full);
  return new Uint8Array(decrypted);
}

function bytesToUtf8(bytes) {
  const decoder = new TextDecoder('utf-8');
  return decoder.decode(bytes);
}

/**
 * Decrypt an encrypted envelope using a Web Crypto X25519 private key seed.
 *
 * @param {string|object} encryptedPayload - JSON string or parsed envelope
 * @param {Uint8Array|string} recipientSeed - X25519 private key seed (raw bytes or base64url string)
 * @returns {Promise<string>} Decrypted plaintext (UTF-8)
 */
export async function viewerDecrypt(encryptedPayload, recipientSeed) {
  const envelope = typeof encryptedPayload === 'string' ? JSON.parse(encryptedPayload) : encryptedPayload;
  if (envelope.v !== ENVELOPE_VERSION) {
    throw new Error(`Unsupported encryption envelope version: ${envelope.v}`);
  }

  const seed = typeof recipientSeed === 'string' ? fromB64url(recipientSeed) : recipientSeed;
  if (seed.length !== 32) throw new Error('Recipient seed must be 32 bytes');

  const privateKey = await importX25519PrivateKey(seed);
  const ephemeralPubRaw = fromB64url(envelope.ephemeralPublicKey);
  const sharedSecret = await ecdhSharedSecret(privateKey, ephemeralPubRaw);

  const salt = fromB64url(envelope.salt);
  const kek = await hkdfDeriveKey(sharedSecret, salt);

  const encryptedKeyBytes = fromB64url(await findRecipientBlock(envelope, seed));
  const keyCiphertext = encryptedKeyBytes.slice(0, encryptedKeyBytes.length - 16);
  const keyAuthTag = encryptedKeyBytes.slice(encryptedKeyBytes.length - 16);
  const keyIv = new Uint8Array(12);
  const messageKeyRaw = await aesGcmDecrypt(kek, keyIv, keyCiphertext, keyAuthTag);
  const messageKey = await crypto.subtle.importKey('raw', messageKeyRaw, { name: 'AES-GCM' }, false, ['decrypt']);

  const iv = fromB64url(envelope.iv);
  const ciphertext = fromB64url(envelope.ciphertext);
  const authTag = fromB64url(envelope.authTag);
  const plaintext = await aesGcmDecrypt(messageKey, iv, ciphertext, authTag);

  return bytesToUtf8(plaintext);
}

async function x25519PublicKeyRawFromSeed(seed) {
  const privateKey = await importX25519PrivateKey(seed);
  const basePoint = hexToBytes('0900000000000000000000000000000000000000000000000000000000000000');
  const basePub = await importX25519PublicKey(basePoint);
  const pub = await crypto.subtle.deriveBits({ name: 'X25519', public: basePub }, privateKey, 256);
  return new Uint8Array(pub);
}

async function findRecipientBlock(envelope, seed) {
  const pubRaw = await x25519PublicKeyRawFromSeed(seed);
  const fingerprint = await x25519Fingerprint(pubRaw);
  for (const r of envelope.recipients || []) {
    if (r.publicKeyFingerprint === fingerprint && r.encryptedKey) return r.encryptedKey;
  }
  throw new Error('Recipient not found in envelope');
}

/**
 * Check if a payload string is an encrypted PermaBrain envelope.
 */
export function isEncryptedEnvelope(payload) {
  if (typeof payload !== 'string') return false;
  try {
    const obj = JSON.parse(payload);
    return !!(obj.v === ENVELOPE_VERSION && obj.ephemeralPublicKey && obj.ciphertext && obj.recipients);
  } catch {
    return false;
  }
}

/**
 * Derive an X25519 seed from an Ed25519 seed using SHA-512 first 32 bytes.
 */
export async function deriveX25519SeedFromEd25519(ed25519Seed) {
  const seed = ed25519Seed instanceof Uint8Array ? ed25519Seed : fromB64url(ed25519Seed);
  if (seed.length !== 32) throw new Error('Ed25519 seed must be 32 bytes');
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-512', seed));
  return hash.slice(0, 32);
}

/**
 * Compute the SHA-256 fingerprint of a raw X25519 public key.
 */
export async function x25519Fingerprint(rawPublicKey) {
  const bytes = rawPublicKey instanceof Uint8Array ? rawPublicKey : fromB64url(rawPublicKey);
  const hash = await sha256(bytes);
  return Array.from(hash).map(b => b.toString(16).padStart(2, '0')).join('');
}

if (typeof window !== 'undefined') {
  window.permabrainCrypto = { viewerDecrypt, isEncryptedEnvelope, deriveX25519SeedFromEd25519, x25519Fingerprint };
}
