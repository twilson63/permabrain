/**
 * PermaBrain Crypto — Private/encrypted articles
 *
 * Encryption scheme:
 *   - Per-recipient X25519 ECDH key exchange
 *   - HKDF-SHA256 to derive per-recipient AES-256-GCM key
 *   - Content encrypted with a random AES-256-GCM key (the "message key")
 *   - Message key encrypted per-recipient via ECDH + HKDF
 *   - Ephemeral X25519 keypair per encryption (forward secrecy)
 *   - Multi-recipient: each recipient gets their own encrypted message key block
 *
 * Wire format (base64url-encoded in payload):
 *   {
 *     "v": 1,
 *     "ephemeralPublicKey": "<base64url X25519 public key>",
 *     "salt": "<base64url 32 bytes>",
 *     "iv": "<base64url 12 bytes>",
 *     "ciphertext": "<base64url>",
 *     "authTag": "<base64url 16 bytes>",
 *     "recipients": [
 *       {
 *         "publicKeyFingerprint": "<sha256 hex of recipient X25519 public key>",
 *         "encryptedKey": "<base64url encrypted message key>"
 *       }
 *     ]
 *   }
 *
 * Recipients derive their decryption key via:
 *   1. ECDH(ephemeral_priv, recipient_pub) → sharedSecret
 *   2. HKDF-SHA256(sharedSecret, salt, "permabrain-v1", 32) → kek
 *   3. AES-256-GCM-Decrypt(kek, recipient.encryptedKey) → messageKey
 *   4. AES-256-GCM-Decrypt(messageKey, iv, ciphertext + authTag) → plaintext
 */

import crypto from 'node:crypto';

const X25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b656e04220420', 'hex');
const X25519_SPKI_PREFIX = Buffer.from('302a300506032b656e032100', 'hex');
const HKDF_INFO = Buffer.from('permabrain-v1');
const ENVELOPE_VERSION = 1;

function b64url(buffer) {
  return Buffer.from(buffer).toString('base64url');
}

function fromB64url(value) {
  return Buffer.from(value, 'base64url');
}

// --- Key utilities ---

export function generateX25519KeyPair() {
  const seed = crypto.randomBytes(32);
  const privateKey = x25519PrivateKeyFromSeed(seed);
  const publicKey = crypto.createPublicKey(privateKey);
  return { privateKey, publicKey, seed };
}

function x25519PrivateKeyFromSeed(seed) {
  if (seed.length !== 32) throw new Error('X25519 seed must be 32 bytes');
  const der = Buffer.concat([X25519_PKCS8_PREFIX, seed]);
  return crypto.createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
}

export function x25519PublicKeyFromRaw(rawBytes) {
  if (rawBytes.length !== 32) throw new Error('X25519 public key must be 32 bytes');
  const der = Buffer.concat([X25519_SPKI_PREFIX, Buffer.from(rawBytes)]);
  return crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
}

export function x25519PublicKeyToRaw(publicKey) {
  const der = publicKey.export({ type: 'spki', format: 'der' });
  return der.subarray(X25519_SPKI_PREFIX.length);
}

export function x25519PublicKeyToBase64url(publicKey) {
  return b64url(x25519PublicKeyToRaw(publicKey));
}

export function x25519PublicKeyFromBase64url(b64urlStr) {
  return x25519PublicKeyFromRaw(fromB64url(b64urlStr));
}

export function x25519Fingerprint(publicKey) {
  const raw = Buffer.isBuffer(publicKey) || publicKey instanceof Uint8Array
    ? Buffer.from(publicKey)
    : x25519PublicKeyToRaw(publicKey);
  return crypto.createHash('sha256').update(raw).digest('hex');
}

// --- ECDH + HKDF key derivation ---

function ecdhSharedSecret(ephemeralPrivateKey, recipientPublicKey) {
  return crypto.diffieHellman({ publicKey: recipientPublicKey, privateKey: ephemeralPrivateKey });
}

async function hkdfDeriveKey(sharedSecret, salt, length = 32) {
  return Buffer.from(await new Promise((resolve, reject) => {
    crypto.hkdf('sha256', sharedSecret, salt, HKDF_INFO, length, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  }));
}

// --- AES-256-GCM ---

function aesGcmEncrypt(key, plaintext, iv) {
  if (iv.length !== 12) throw new Error('AES-GCM IV must be 12 bytes');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return { ciphertext, authTag };
}

function aesGcmDecrypt(key, iv, ciphertext, authTag) {
  if (iv.length !== 12) throw new Error('AES-GCM IV must be 12 bytes');
  if (authTag.length !== 16) throw new Error('AES-GCM auth tag must be 16 bytes');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

// --- Public API ---

/**
 * Encrypt content for one or more recipients.
 *
 * @param {string|Buffer} content - Plaintext content to encrypt
 * @param {string[]} recipientPublicKeysB64url - Array of X25519 public keys (base64url)
 * @returns {Promise<{envelope: object, encryptedPayload: string}>}
 */
export async function encrypt(content, recipientPublicKeysB64url) {
  if (!recipientPublicKeysB64url || !recipientPublicKeysB64url.length) {
    throw new Error('At least one recipient public key is required');
  }

  const plaintext = Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8');

  // Generate ephemeral X25519 keypair
  const ephemeral = generateX25519KeyPair();
  const salt = crypto.randomBytes(32);

  // Generate random message key
  const messageKey = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);

  // Encrypt content with message key
  const { ciphertext, authTag } = aesGcmEncrypt(messageKey, plaintext, iv);

  // Encrypt message key for each recipient
  const recipients = [];
  for (const pubB64url of recipientPublicKeysB64url) {
    const recipientPub = x25519PublicKeyFromBase64url(pubB64url);
    const sharedSecret = ecdhSharedSecret(ephemeral.privateKey, recipientPub);
    const kek = await hkdfDeriveKey(sharedSecret, salt);

    // Encrypt the message key with the key-encryption-key
    // Use a fixed IV for key wrapping (all-zero 12 bytes — safe because KEK is unique per recipient)
    const keyIv = Buffer.alloc(12, 0);
    const { ciphertext: encryptedKey, authTag: keyAuthTag } = aesGcmEncrypt(kek, messageKey, keyIv);

    recipients.push({
      publicKeyFingerprint: x25519Fingerprint(recipientPub),
      encryptedKey: b64url(Buffer.concat([encryptedKey, keyAuthTag]))
    });
  }

  const envelope = {
    v: ENVELOPE_VERSION,
    ephemeralPublicKey: x25519PublicKeyToBase64url(ephemeral.publicKey),
    salt: b64url(salt),
    iv: b64url(iv),
    ciphertext: b64url(ciphertext),
    authTag: b64url(authTag),
    recipients
  };

  return { envelope, encryptedPayload: JSON.stringify(envelope) };
}

/**
 * Decrypt content for a specific recipient.
 *
 * @param {string|object} encryptedPayload - JSON string or parsed envelope
 * @param {Buffer} recipientSeed - X25519 private key seed (32 bytes)
 * @returns {Promise<{content: string, envelope: object}>}
 */
export async function decrypt(encryptedPayload, recipientSeed) {
  const envelope = typeof encryptedPayload === 'string'
    ? JSON.parse(encryptedPayload)
    : encryptedPayload;

  if (envelope.v !== ENVELOPE_VERSION) {
    throw new Error(`Unsupported encryption envelope version: ${envelope.v}`);
  }

  const recipientPriv = x25519PrivateKeyFromSeed(recipientSeed);
  const recipientPub = crypto.createPublicKey(recipientPriv);
  const recipientFp = x25519Fingerprint(recipientPub);

  // Find this recipient's entry
  const recipientEntry = envelope.recipients.find(r => r.publicKeyFingerprint === recipientFp);
  if (!recipientEntry) {
    throw new Error(`Recipient ${recipientFp.substring(0, 16)}... not found in envelope`);
  }

  // Reconstruct ECDH shared secret
  const ephemeralPub = x25519PublicKeyFromBase64url(envelope.ephemeralPublicKey);
  const sharedSecret = ecdhSharedSecret(recipientPriv, ephemeralPub);

  // Derive key-encryption-key
  const salt = fromB64url(envelope.salt);
  const kek = await hkdfDeriveKey(sharedSecret, salt);

  // Decrypt the message key
  const encryptedKeyBytes = fromB64url(recipientEntry.encryptedKey);
  const keyCiphertext = encryptedKeyBytes.subarray(0, encryptedKeyBytes.length - 16);
  const keyAuthTag = encryptedKeyBytes.subarray(encryptedKeyBytes.length - 16);
  const keyIv = Buffer.alloc(12, 0);
  const messageKey = aesGcmDecrypt(kek, keyIv, keyCiphertext, keyAuthTag);

  // Decrypt content with message key
  const iv = fromB64url(envelope.iv);
  const ciphertext = fromB64url(envelope.ciphertext);
  const authTag = fromB64url(envelope.authTag);
  const plaintext = aesGcmDecrypt(messageKey, iv, ciphertext, authTag);

  return { content: plaintext.toString('utf8'), envelope };
}

/**
 * Check if a payload is an encrypted envelope.
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
 * List recipient fingerprints from an encrypted envelope.
 */
export function listRecipients(encryptedPayload) {
  const envelope = typeof encryptedPayload === 'string'
    ? JSON.parse(encryptedPayload)
    : encryptedPayload;
  return envelope.recipients?.map(r => r.publicKeyFingerprint) || [];
}

/**
 * Generate an X25519 encryption keypair for storage alongside an identity.
 * Returns the seed (private) and public key in base64url.
 */
export function generateEncryptionKeypair() {
  const seed = crypto.randomBytes(32);
  const privateKey = x25519PrivateKeyFromSeed(seed);
  const publicKey = crypto.createPublicKey(privateKey);
  return {
    type: 'x25519',
    seed: b64url(seed),
    publicKey: x25519PublicKeyToBase64url(publicKey),
    fingerprint: x25519Fingerprint(publicKey)
  };
}

/**
 * Derive X25519 encryption keypair from an Ed25519 seed.
 * Uses SHA-512(ed_seed) first 32 bytes as X25519 seed.
 */
export function deriveEncryptionKeyFromEd25519(ed25519Seed) {
  const seed = Buffer.from(ed25519Seed);
  if (seed.length !== 32) throw new Error('Ed25519 seed must be 32 bytes');
  const hash = crypto.createHash('sha512').update(seed).digest();
  const x25519Seed = hash.subarray(0, 32);
  const privateKey = x25519PrivateKeyFromSeed(x25519Seed);
  const publicKey = crypto.createPublicKey(privateKey);
  return {
    type: 'x25519-derived',
    seed: b64url(x25519Seed),
    publicKey: x25519PublicKeyToBase64url(publicKey),
    fingerprint: x25519Fingerprint(publicKey)
  };
}