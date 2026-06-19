import fs from 'node:fs';
import crypto from 'node:crypto';
import Arweave from 'arweave';
import * as ed25519 from '@noble/ed25519';
import { statePaths, loadJson, APP_VERSION } from './config.mjs';

const arweave = Arweave.init({});
ed25519.hashes.sha512 = (message) => crypto.createHash('sha512').update(message).digest();

function b64url(buffer) {
  return Buffer.from(buffer).toString('base64url');
}

function fromB64url(value) {
  return Buffer.from(value, 'base64url');
}

export async function agentIdFromJwk(jwk) {
  const address = await arweave.wallets.jwkToAddress(jwk);
  return `arweave:${address}`;
}

export async function createIdentity(keyType = 'arweave-rsa4096') {
  if (keyType === 'ed25519') {
    const secretKey = ed25519.utils.randomSecretKey();
    const publicKey = ed25519.getPublicKey(secretKey);
    return {
      type: 'ed25519',
      agentId: `ed25519:${b64url(publicKey)}`,
      publicKey: b64url(publicKey),
      secretKey: b64url(secretKey),
      createdAt: new Date().toISOString()
    };
  }
  if (keyType !== 'arweave-rsa4096') throw new Error(`Unsupported key type '${keyType}'. Use arweave-rsa4096 or ed25519.`);
  const jwk = await arweave.wallets.generate();
  return {
    type: 'arweave-rsa4096',
    agentId: await agentIdFromJwk(jwk),
    jwk,
    createdAt: new Date().toISOString()
  };
}

export function identityInitEvent(identity) {
  return {
    type: 'identity-init',
    appName: 'PermaBrain',
    appVersion: APP_VERSION,
    agentId: identity.agentId,
    keyType: identity.type,
    visibility: 'public',
    createdAt: identity.createdAt,
    note: 'Local first-run identity initialization event. Private key material is stored only in keys.json and is not included here.'
  };
}

export async function ensureIdentity(home, { keyType = process.env.PERMABRAIN_KEY_TYPE || 'arweave-rsa4096' } = {}) {
  const { keysPath, identityInitPath } = statePaths(home);
  if (fs.existsSync(keysPath)) {
    const identity = loadJson(keysPath);
    if (!identity.agentId && identity.jwk) identity.agentId = await agentIdFromJwk(identity.jwk);
    if (!fs.existsSync(identityInitPath)) fs.writeFileSync(identityInitPath, JSON.stringify(identityInitEvent(identity), null, 2) + '\n');
    return { identity, created: false, identityInitPath, identityInitCreated: false };
  }
  const identity = await createIdentity(keyType);
  fs.writeFileSync(keysPath, JSON.stringify(identity, null, 2) + '\n', { mode: 0o600 });
  try { fs.chmodSync(keysPath, 0o600); } catch {}
  fs.writeFileSync(identityInitPath, JSON.stringify(identityInitEvent(identity), null, 2) + '\n');
  return { identity, created: true, identityInitPath, identityInitCreated: true };
}

export function loadIdentity(home) {
  const { keysPath } = statePaths(home);
  if (!fs.existsSync(keysPath)) throw new Error(`Missing keys at ${keysPath}. Run 'permabrain init'.`);
  return loadJson(keysPath);
}

export function publicIdentity(identity) {
  return {
    type: identity.type,
    agentId: identity.agentId,
    publicKey: identity.publicKey || undefined,
    createdAt: identity.createdAt
  };
}
