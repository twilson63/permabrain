import crypto from 'node:crypto';
import * as ed25519 from '@noble/ed25519';

ed25519.hashes.sha512 = (message) => crypto.createHash('sha512').update(message).digest();

// PermaBrain intentionally supports only the key types it can create: Arweave RSA-4096 and Ed25519.
// ANS-104 also defines other signature types, but accepting them here would imply verification support we do not have.
export const SIG_CONFIG = {
  1: { sigLength: 512, pubLength: 512, name: 'arweave-rsa4096' },
  2: { sigLength: 64, pubLength: 32, name: 'ed25519' }
};

function b64url(buffer) {
  return Buffer.from(buffer).toString('base64url');
}

function fromB64url(value) {
  return Buffer.from(value, 'base64url');
}

function longToNByteArray(n, value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 2 ** (n * 8) - 1) throw new Error(`Invalid unsigned ${n}-byte integer: ${value}`);
  const out = Buffer.alloc(n);
  let current = value;
  for (let i = 0; i < n; i++) {
    out[i] = current & 0xff;
    current = Math.floor(current / 256);
  }
  return out;
}

function byteArrayToLong(bytes) {
  let value = 0;
  for (let i = bytes.length - 1; i >= 0; i--) value = value * 256 + bytes[i];
  return value;
}

function requireBytes(binary, start, length, label) {
  if (start < 0 || length < 0 || start + length > binary.length) {
    throw new Error(`Invalid ANS-104 DataItem: ${label} exceeds binary length (${binary.length} bytes)`);
  }
}

function avroWriteLongParts(value) {
  let n = value >= 0 ? value * 2 : -value * 2 - 1;
  const bytes = [];
  do {
    let b = n & 0x7f;
    n = Math.floor(n / 128);
    if (n) b |= 0x80;
    bytes.push(b);
  } while (n);
  return Buffer.from(bytes);
}

function avroReadLong(buffer, state) {
  let n = 0;
  let shift = 0;
  let b;
  do {
    if (state.pos >= buffer.length) throw new Error('Invalid tag encoding');
    b = buffer[state.pos++];
    n += (b & 0x7f) * 2 ** shift;
    shift += 7;
  } while (b & 0x80);
  return n % 2 ? -(n + 1) / 2 : n / 2;
}

function avroWriteString(value) {
  const bytes = Buffer.from(String(value), 'utf8');
  return Buffer.concat([avroWriteLongParts(bytes.length), bytes]);
}

function avroReadString(buffer, state) {
  const len = avroReadLong(buffer, state);
  if (len < 0 || state.pos + len > buffer.length) throw new Error('Invalid tag string length');
  const value = buffer.subarray(state.pos, state.pos + len).toString('utf8');
  state.pos += len;
  return value;
}

function serializeTags(tags = []) {
  if (!Array.isArray(tags)) throw new Error('Tags must be an array');
  const parts = [avroWriteLongParts(tags.length)];
  for (const tag of tags) {
    if (typeof tag?.name !== 'string' || typeof tag?.value !== 'string') throw new Error('Tags must be { name, value } strings');
    parts.push(avroWriteString(tag.name), avroWriteString(tag.value));
  }
  parts.push(avroWriteLongParts(0));
  return Buffer.concat(parts);
}

function deserializeTags(buffer) {
  const state = { pos: 0 };
  const tags = [];
  let count;
  while ((count = avroReadLong(buffer, state))) {
    if (count < 0) {
      count = -count;
      avroReadLong(buffer, state); // block byte size, unused here
    }
    for (let i = 0; i < count; i++) tags.push({ name: avroReadString(buffer, state), value: avroReadString(buffer, state) });
  }
  return tags;
}

function sha384(data) {
  return crypto.createHash('sha384').update(data).digest();
}

async function deepHash(data) {
  if (Array.isArray(data)) {
    const tag = Buffer.concat([Buffer.from('list'), Buffer.from(String(data.length))]);
    let acc = sha384(tag);
    for (const chunk of data) acc = sha384(Buffer.concat([acc, await deepHash(chunk)]));
    return acc;
  }
  const bytes = Buffer.from(data);
  const tag = Buffer.concat([Buffer.from('blob'), Buffer.from(String(bytes.byteLength))]);
  return sha384(Buffer.concat([sha384(tag), sha384(bytes)]));
}

class MiniDataItem {
  constructor(binary) {
    this.binary = Buffer.from(binary);
    this.validateLayout();
  }

  validateLayout() {
    requireBytes(this.binary, 0, 2, 'signature type');
    const type = byteArrayToLong(this.binary.subarray(0, 2));
    const config = SIG_CONFIG[type];
    if (!config) throw new Error(`Unsupported ANS-104 signature type: ${type}. Supported types: ${Object.keys(SIG_CONFIG).join(', ')}`);

    requireBytes(this.binary, 2, config.sigLength + config.pubLength, 'signature/owner fields');
    const targetStart = 2 + config.sigLength + config.pubLength;
    const targetPresent = this.readPresenceFlag(targetStart, 'target');
    if (targetPresent) requireBytes(this.binary, targetStart + 1, 32, 'target');

    const anchorStart = targetStart + (targetPresent ? 33 : 1);
    const anchorPresent = this.readPresenceFlag(anchorStart, 'anchor');
    if (anchorPresent) requireBytes(this.binary, anchorStart + 1, 32, 'anchor');

    const tagsStart = anchorStart + (anchorPresent ? 33 : 1);
    requireBytes(this.binary, tagsStart, 16, 'tag header');
    const tagCount = byteArrayToLong(this.binary.subarray(tagsStart, tagsStart + 8));
    const tagBytesLength = byteArrayToLong(this.binary.subarray(tagsStart + 8, tagsStart + 16));
    requireBytes(this.binary, tagsStart + 16, tagBytesLength, 'tag bytes');

    const tags = tagBytesLength ? deserializeTags(this.binary.subarray(tagsStart + 16, tagsStart + 16 + tagBytesLength)) : [];
    if (tags.length !== tagCount) throw new Error(`Invalid ANS-104 DataItem: tag count mismatch (${tags.length} decoded, ${tagCount} declared)`);
  }

  readPresenceFlag(start, label) {
    requireBytes(this.binary, start, 1, `${label} presence flag`);
    const flag = this.binary[start];
    if (flag !== 0 && flag !== 1) throw new Error(`Invalid ANS-104 DataItem: ${label} presence flag must be 0 or 1`);
    return flag === 1;
  }

  get signatureType() {
    return byteArrayToLong(this.binary.subarray(0, 2));
  }

  get signatureLength() { return SIG_CONFIG[this.signatureType].sigLength; }
  get ownerLength() { return SIG_CONFIG[this.signatureType].pubLength; }
  get rawSignature() { return this.binary.subarray(2, 2 + this.signatureLength); }
  get signature() { return b64url(this.rawSignature); }
  get rawOwner() { return this.binary.subarray(2 + this.signatureLength, 2 + this.signatureLength + this.ownerLength); }
  get owner() { return b64url(this.rawOwner); }
  getTargetStart() { return 2 + this.signatureLength + this.ownerLength; }
  getAnchorStart() { return this.getTargetStart() + (this.readPresenceFlag(this.getTargetStart(), 'target') ? 33 : 1); }
  getTagsStart() { return this.getAnchorStart() + (this.readPresenceFlag(this.getAnchorStart(), 'anchor') ? 33 : 1); }
  get rawTarget() { const start = this.getTargetStart(); return this.readPresenceFlag(start, 'target') ? this.binary.subarray(start + 1, start + 33) : Buffer.alloc(0); }
  get rawAnchor() { const start = this.getAnchorStart(); return this.readPresenceFlag(start, 'anchor') ? this.binary.subarray(start + 1, start + 33) : Buffer.alloc(0); }
  get rawTags() {
    const start = this.getTagsStart();
    const size = byteArrayToLong(this.binary.subarray(start + 8, start + 16));
    return this.binary.subarray(start + 16, start + 16 + size);
  }
  get tags() { return this.rawTags.length ? deserializeTags(this.rawTags) : []; }
  get rawData() {
    const start = this.getTagsStart();
    const size = byteArrayToLong(this.binary.subarray(start + 8, start + 16));
    return this.binary.subarray(start + 16 + size);
  }
  get rawId() { return crypto.createHash('sha256').update(this.rawSignature).digest(); }
  get id() { return b64url(this.rawId); }
  getRaw() { return this.binary; }
  async getSignatureData() {
    return deepHash([
      Buffer.from('dataitem'),
      Buffer.from('1'),
      Buffer.from(String(this.signatureType)),
      this.rawOwner,
      this.rawTarget,
      this.rawAnchor,
      this.rawTags,
      this.rawData
    ]);
  }
  async isValid() { return verifyMiniDataItem(this); }
}

function signerForIdentity(identity) {
  if (identity?.type === 'ed25519') {
    const secretKey = fromB64url(identity.secretKey);
    const publicKey = fromB64url(identity.publicKey);
    return {
      signatureType: 2,
      signatureLength: 64,
      ownerLength: 32,
      publicKey,
      sign: async (message) => Buffer.from(await ed25519.sign(message, secretKey))
    };
  }
  if (identity?.jwk) {
    const privateKey = crypto.createPrivateKey({ key: identity.jwk, format: 'jwk' });
    const publicKey = fromB64url(identity.jwk.n);
    return {
      signatureType: 1,
      signatureLength: 512,
      ownerLength: 512,
      publicKey,
      sign: async (message) => crypto.sign('sha256', message, { key: privateKey, padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 })
    };
  }
  throw new Error('ANS-104 signing requires an arweave-rsa4096 or ed25519 identity. Run permabrain init.');
}

function createUnsignedDataItem(payloadBuffer, tags, signer) {
  const tagBytes = tags.length ? serializeTags(tags) : Buffer.alloc(0);
  const length = 2 + signer.signatureLength + signer.ownerLength + 1 + 1 + 16 + tagBytes.length + payloadBuffer.length;
  const bytes = Buffer.alloc(length);
  bytes.set(longToNByteArray(2, signer.signatureType), 0);
  bytes.set(signer.publicKey, 2 + signer.signatureLength);
  const position = 2 + signer.signatureLength + signer.ownerLength;
  bytes[position] = 0; // no target
  bytes[position + 1] = 0; // no anchor
  const tagsStart = position + 2;
  bytes.set(longToNByteArray(8, tags.length), tagsStart);
  bytes.set(longToNByteArray(8, tagBytes.length), tagsStart + 8);
  bytes.set(tagBytes, tagsStart + 16);
  bytes.set(payloadBuffer, tagsStart + 16 + tagBytes.length);
  return new MiniDataItem(bytes);
}

async function verifyMiniDataItem(item) {
  const signatureData = await item.getSignatureData();
  if (item.signatureType === 2) return ed25519.verify(item.rawSignature, signatureData, item.rawOwner);
  if (item.signatureType === 1) {
    const publicKey = crypto.createPublicKey({ key: { kty: 'RSA', n: b64url(item.rawOwner), e: 'AQAB' }, format: 'jwk' });
    return crypto.verify('sha256', signatureData, { key: publicKey, padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 }, item.rawSignature);
  }
  return false;
}

export async function createDataItem({ payload, tags, identity }) {
  const payloadBytes = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload));
  const signer = signerForIdentity(identity);
  const dataItem = createUnsignedDataItem(payloadBytes, tags, signer);
  const signatureData = await dataItem.getSignatureData();
  const signature = await signer.sign(signatureData);
  if (signature.length !== signer.signatureLength) throw new Error(`Signature must be ${signer.signatureLength} bytes, got ${signature.length}`);
  dataItem.binary.set(signature, 2);
  const raw = dataItem.getRaw();
  return {
    format: 'ans104@1.0',
    id: dataItem.id,
    owner: identity.agentId,
    timestamp: new Date().toISOString(),
    tags,
    payloadBase64: b64url(payloadBytes),
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
  const bytes = Buffer.isBuffer(itemOrBytes) || itemOrBytes instanceof Uint8Array ? Buffer.from(itemOrBytes) : rawDataItemBytes(itemOrBytes);
  return new MiniDataItem(bytes);
}

export function payloadBuffer(item) {
  if (item.format === 'httpsig@1.0' && typeof item.payload === 'string') {
    // HyperBEAM HTTP-SIG format: payload is already a string (the body content)
    return Buffer.from(item.payload, 'utf8');
  }
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
