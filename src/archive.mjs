/**
 * PermaBrain Archive / Restore
 *
 * Creates a portable, encrypted snapshot of a PermaBrain home directory.
 * The snapshot is intended for offline backups and cross-node migration.
 *
 * Snapshots include:
 *   - keys.json (encrypted with a passphrase-derived X25519 public key)
 *   - identity-init.json
 *   - config.json
 *   - remotes.json (if present)
 *   - cache/watch-state.json (if present)
 *   - cache/index.json
 *   - cache/objects/*.json (raw signed DataItems)
 *
 * Snapshots deliberately EXCLUDE the plaintext page cache:
 *   - cache/pages/*.md
 *
 * Encryption uses the existing ./crypto.mjs X25519 encrypt() helper,
 * supporting either:
 *   - A passphrase-derived recipient key (default, self-contained restore)
 *   - An explicit recipient X25519 public key (e.g. for escrow / migration)
 *
 * The archive format is a single JSON file with an embedded manifest and
 * per-file encrypted payloads. Each file is individually encrypted as a
 * multi-recipient envelope (author + any provided recipients) so the original
 * author can always decrypt; passphrase mode adds the passphrase-derived key
 * so the restore command can recover with only the passphrase.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getHome, statePaths } from './config.mjs';
import { loadIdentity } from './keys.mjs';
import * as pbcrypto from './crypto.mjs';

const ARCHIVE_VERSION = 'permabrain-archive/1.0.0';
function b64url(buffer) {
  return Buffer.from(buffer).toString('base64url');
}

function fromB64url(value) {
  return Buffer.from(value, 'base64url');
}

/**
 * Derive a deterministic X25519 keypair from a UTF-8 passphrase.
 * Uses SHA-256(passphrase) as the Ed25519 seed, then maps to X25519 the same
 * way deriveEncryptionKeyFromEd25519 does (SHA-512, first 32 bytes).
 */
function deriveArchiveKeypair(passphrase) {
  const seed = crypto.createHash('sha256').update(Buffer.from(passphrase, 'utf8')).digest();
  return pbcrypto.deriveEncryptionKeyFromEd25519(seed);
}

/**
 * Build the public-only list of files to include in the snapshot.
 */
function gatherArchiveFiles(home) {
  const paths = statePaths(home);
  const files = [];

  const required = [
    { rel: 'keys.json', full: paths.keysPath },
    { rel: 'identity-init.json', full: paths.identityInitPath },
    { rel: 'config.json', full: paths.configPath },
  ];
  for (const { rel, full } of required) {
    if (!fs.existsSync(full)) throw new Error(`Missing required file for archive: ${full}`);
    files.push({ rel, full });
  }

  const optional = [
    { rel: 'remotes.json', full: path.join(home, 'remotes.json') },
    { rel: 'cache/watch-state.json', full: path.join(home, 'cache', 'watch-state.json') },
    { rel: 'cache/index.json', full: paths.indexPath },
  ];
  for (const { rel, full } of optional) {
    if (fs.existsSync(full)) files.push({ rel, full });
  }

  const objectsDir = paths.objectsDir;
  if (fs.existsSync(objectsDir)) {
    for (const name of fs.readdirSync(objectsDir).filter((n) => n.endsWith('.json'))) {
      files.push({ rel: `cache/objects/${name}`, full: path.join(objectsDir, name) });
    }
  }

  // Always include article-references.json and attestation-references.json if present
  for (const refName of ['article-references.json', 'attestation-references.json']) {
    const refPath = path.join(home, 'cache', refName);
    if (fs.existsSync(refPath)) files.push({ rel: `cache/${refName}`, full: refPath });
  }

  return files;
}

/**
 * Encrypt a single file for the given recipients. Always includes the author's
 * derived encryption key so the creating identity can decrypt later.
 */
async function encryptFile(file, recipientPublicKeys, identity) {
  const plaintext = fs.readFileSync(file.full);
  const keys = [...recipientPublicKeys];

  // Always include author so they can restore their own backup even without passphrase.
  const authorKey = await authorEncryptionPublicKey(identity);
  if (authorKey && !keys.includes(authorKey)) keys.push(authorKey);

  const { encryptedPayload } = await pbcrypto.encrypt(plaintext, keys);
  return {
    path: file.rel,
    size: plaintext.length,
    encrypted: true,
    envelope: encryptedPayload
  };
}

async function authorEncryptionPublicKey(identity) {
  try {
    if (identity.type === 'ed25519') {
      const edSeed = Buffer.from(identity.secretKey, 'base64url').subarray(0, 32);
      return pbcrypto.deriveEncryptionKeyFromEd25519(edSeed).publicKey;
    }
    if (identity.type === 'arweave-rsa4096' && identity.encryptionSeed) {
      return pbcrypto.deriveEncryptionKeyFromEd25519(Buffer.from(identity.encryptionSeed, 'base64url')).publicKey;
    }
  } catch {
    // Ignore: author key is best-effort; passphrase/external recipient is required.
  }
  return null;
}

/**
 * Create an encrypted archive snapshot of a PermaBrain home directory.
 *
 * @param {Object} [opts]
 * @param {string} [opts.home] - PermaBrain home directory
 * @param {string} [opts.passphrase] - Passphrase for self-contained restore
 * @param {string[]} [opts.recipients] - Extra X25519 public keys to encrypt for
 * @returns {Promise<Object>} Archive object
 */
export async function createArchive(opts = {}) {
  const legacy = await archive(opts);
  return legacy;
}

export async function archive(opts = {}) {
  const home = opts.home || getHome();
  const identity = loadIdentity(home);
  const files = gatherArchiveFiles(home);

  const recipientPublicKeys = [];
  if (opts.passphrase) {
    const derived = deriveArchiveKeypair(opts.passphrase);
    recipientPublicKeys.push(derived.publicKey);
  }
  if (opts.recipients) {
    for (const r of opts.recipients) {
      if (r && !recipientPublicKeys.includes(r)) recipientPublicKeys.push(r);
    }
  }

  if (recipientPublicKeys.length === 0) {
    throw new Error('archive requires --passphrase or at least one --recipient public key');
  }

  const entries = [];
  for (const file of files) {
    entries.push(await encryptFile(file, recipientPublicKeys, identity));
  }

  return {
    version: ARCHIVE_VERSION,
    createdAt: new Date().toISOString(),
    agentId: identity.agentId,
    home,
    encryption: {
      scheme: 'x25519-ecdh-aes256gcm',
      recipientCount: recipientPublicKeys.length,
      hasPassphrase: !!opts.passphrase
    },
    entries
  };
}

export { archive as backup, restore as recover };

/**
 * Decrypt a single archive entry using the provided seed.
 */
async function decryptEntry(entry, seed) {
  const { content } = await pbcrypto.decrypt(entry.envelope, seed);
  return content;
}

/**
 * Restore a PermaBrain home directory from an archive.
 *
 * If `passphrase` is provided, the seed is derived deterministically.
 * If `seed` is provided directly, it is used as the X25519 seed (base64url or Buffer).
 * If neither is sufficient, the caller's current identity seed is tried last.
 *
 * @param {Object} archive - Archive object from archive()
 * @param {Object} [opts]
 * @param {string} [opts.home] - Target home directory (default PERMABRAIN_HOME)
 * @param {string} [opts.passphrase] - Passphrase used at archive time
 * @param {string|Buffer} [opts.seed] - Raw X25519 seed (base64url or Buffer)
 * @param {boolean} [opts.dryRun=false] - Validate decryption without writing files
 * @returns {Promise<Object>} Restore report
 */
export async function restore(archive, opts = {}) {
  if (!archive || typeof archive !== 'object') throw new Error('restore requires an archive object');
  if (archive.version !== ARCHIVE_VERSION) throw new Error(`Unsupported archive version: ${archive.version}`);

  const home = opts.home || getHome();

  const seeds = [];
  if (opts.seed) {
    const buf = Buffer.isBuffer(opts.seed) ? opts.seed : fromB64url(opts.seed);
    seeds.push(buf);
  }
  if (opts.passphrase) {
    const derived = deriveArchiveKeypair(opts.passphrase);
    seeds.push(Buffer.from(derived.seed, 'base64url'));
  }
  if (seeds.length === 0) {
    try {
      const identity = loadIdentity(home);
      const authorSeed = await authorEncryptionSeed(identity);
      if (authorSeed) seeds.push(authorSeed);
    } catch {
      // No current identity; passphrase/seed is required.
    }
  }

  if (seeds.length === 0) {
    throw new Error('restore requires --passphrase or --seed');
  }

  const decrypted = [];
  for (const entry of archive.entries) {
    let content = null;
    let lastErr = null;
    for (const seed of seeds) {
      try {
        content = await decryptEntry(entry, seed);
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
      }
    }
    if (content === null) {
      throw new Error(`Failed to decrypt ${entry.path}: ${lastErr?.message || 'no usable key'}`);
    }
    decrypted.push({ path: entry.path, content });
  }

  if (!opts.dryRun) {
    for (const { path: relPath, content } of decrypted) {
      const target = path.join(home, relPath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
    }
  }

  return {
    restoredAt: new Date().toISOString(),
    home,
    dryRun: !!opts.dryRun,
    entriesRestored: decrypted.length,
    paths: decrypted.map((d) => d.path)
  };
}

async function authorEncryptionSeed(identity) {
  if (identity.type === 'ed25519') {
    const edSeed = Buffer.from(identity.secretKey, 'base64url').subarray(0, 32);
    return Buffer.from(pbcrypto.deriveEncryptionKeyFromEd25519(edSeed).seed, 'base64url');
  }
  if (identity.type === 'arweave-rsa4096' && identity.encryptionSeed) {
    return Buffer.from(identity.encryptionSeed, 'base64url');
  }
  return null;
}
