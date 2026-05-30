import crypto from 'node:crypto';
import { ArweaveSigner, createData, DataItem, SIG_CONFIG } from 'arbundles';
import * as ed25519 from '@noble/ed25519';

ed25519.hashes.sha512 = (message) => crypto.createHash('sha512').update(message).digest();

function b64url(buffer) {
  return Buffer.from(buffer).toString('base64url');
}

function fromB64url(value) {
  return Buffer.from(value, 'base64url');
}

class Ed25519Ans104Signer {
  signatureType = 2;
  ownerLength = SIG_CONFIG[2].pubLength;
  signatureLength = SIG_CONFIG[2].sigLength;

  constructor(identity) {
    this.secretKey = fromB64url(identity.secretKey);
    this._publicKey = fromB64url(identity.publicKey);
  }

  get publicKey() {
    return this._publicKey;
  }

  async sign(message) {
    return Buffer.from(await ed25519.sign(message, this.secretKey));
  }
}

function signerForIdentity(identity) {
  if (identity?.type === 'ed25519') return new Ed25519Ans104Signer(identity);
  if (identity?.jwk) return new ArweaveSigner(identity.jwk);
  throw new Error('ANS-104 signing requires an arweave-rsa4096 or ed25519 identity. Run permabrain init.');
}

export async function createDataItem({ payload, tags, identity }) {
  const payloadBuffer = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload));
  const signer = signerForIdentity(identity);
  const dataItem = createData(payloadBuffer, signer, { tags });
  await dataItem.sign(signer);
  const raw = Buffer.from(dataItem.getRaw());
  return {
    format: 'ans104@1.0',
    id: dataItem.id,
    owner: identity.agentId,
    timestamp: new Date().toISOString(),
    tags,
    payloadBase64: b64url(payloadBuffer),
    ans104Base64: b64url(raw),
    signature: dataItem.signature,
    publicKey: dataItem.owner
  };
}

export function rawDataItemBytes(item) {
  if (!item.ans104Base64) throw new Error('DataItem does not contain serialized ANS-104 bytes');
  return fromB64url(item.ans104Base64);
}

export function parseAns104(itemOrBytes) {
  const bytes = Buffer.isBuffer(itemOrBytes) || itemOrBytes instanceof Uint8Array
    ? Buffer.from(itemOrBytes)
    : rawDataItemBytes(itemOrBytes);
  return new DataItem(bytes);
}

export function payloadBuffer(item) {
  if (item.ans104Base64) return Buffer.from(parseAns104(item).rawData);
  return fromB64url(item.payloadBase64);
}

export function payloadText(item) {
  return payloadBuffer(item).toString('utf8');
}

export async function verifyDataItem(item) {
  return parseAns104(item).isValid();
}

export function ans104Tags(item) {
  return parseAns104(item).tags;
}
