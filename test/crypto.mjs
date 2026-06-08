import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  encrypt,
  decrypt,
  isEncryptedEnvelope,
  listRecipients,
  generateEncryptionKeypair,
  deriveEncryptionKeyFromEd25519,
  generateX25519KeyPair,
  x25519PublicKeyToBase64url,
  x25519PublicKeyFromBase64url,
  x25519Fingerprint,
  x25519PublicKeyToRaw
} from '../src/crypto.mjs';

// --- Key generation ---

const keypair1 = generateEncryptionKeypair();
assert.equal(keypair1.type, 'x25519');
assert.ok(keypair1.seed, 'keypair should have seed');
assert.ok(keypair1.publicKey, 'keypair should have publicKey');
assert.ok(keypair1.fingerprint, 'keypair should have fingerprint');
assert.match(keypair1.publicKey, /^[A-Za-z0-9_-]+$/, 'public key should be base64url');
assert.match(keypair1.fingerprint, /^[a-f0-9]{64}$/, 'fingerprint should be sha256 hex');

const keypair2 = generateEncryptionKeypair();
assert.notStrictEqual(keypair1.publicKey, keypair2.publicKey, 'different keypairs should have different keys');
assert.notStrictEqual(keypair1.fingerprint, keypair2.fingerprint, 'different keypairs should have different fingerprints');

// --- Ed25519 → X25519 derivation ---

const edSeed = crypto.randomBytes(32);
const derived = deriveEncryptionKeyFromEd25519(edSeed);
assert.equal(derived.type, 'x25519-derived');
assert.ok(derived.seed);
assert.ok(derived.publicKey);
assert.ok(derived.fingerprint);

// Deriving from the same seed should give the same X25519 key
const derived2 = deriveEncryptionKeyFromEd25519(edSeed);
assert.equal(derived.publicKey, derived2.publicKey, 'same Ed25519 seed → same X25519 key');
assert.equal(derived.fingerprint, derived2.fingerprint);

// Different seeds → different keys
const edSeed2 = crypto.randomBytes(32);
const derived3 = deriveEncryptionKeyFromEd25519(edSeed2);
assert.notStrictEqual(derived.publicKey, derived3.publicKey);

// Invalid seed length
assert.throws(() => deriveEncryptionKeyFromEd25519(crypto.randomBytes(16)), /Ed25519 seed must be 32 bytes/);

// --- X25519 key pair operations ---

const xk = generateX25519KeyPair();
assert.ok(xk.privateKey);
assert.ok(xk.publicKey);
assert.ok(xk.seed);
assert.equal(xk.seed.length, 32);

// Round-trip: raw → base64url → raw
const rawPub = x25519PublicKeyToRaw(xk.publicKey);
assert.equal(rawPub.length, 32);
const b64url = x25519PublicKeyToBase64url(xk.publicKey);
const reconst = x25519PublicKeyFromBase64url(b64url);
const rawReconst = x25519PublicKeyToRaw(reconst);
assert.deepEqual(rawPub, rawReconst, 'public key round-trip should match');

// Fingerprint consistency
const fp1 = x25519Fingerprint(xk.publicKey);
const fp2 = x25519Fingerprint(rawPub);
assert.equal(fp1, fp2, 'fingerprint from key object and raw bytes should match');

// --- Single recipient encrypt/decrypt ---

const plaintext = 'Hello, encrypted PermaBrain! This is a private article.';
const { envelope, encryptedPayload } = await encrypt(plaintext, [keypair1.publicKey]);

// Envelope structure
assert.equal(envelope.v, 1);
assert.ok(envelope.ephemeralPublicKey, 'envelope should have ephemeralPublicKey');
assert.ok(envelope.salt, 'envelope should have salt');
assert.ok(envelope.iv, 'envelope should have iv');
assert.ok(envelope.ciphertext, 'envelope should have ciphertext');
assert.ok(envelope.authTag, 'envelope should have authTag');
assert.equal(envelope.recipients.length, 1);
assert.equal(envelope.recipients[0].publicKeyFingerprint, keypair1.fingerprint);
assert.ok(envelope.recipients[0].encryptedKey);

// isEncryptedEnvelope
assert.equal(isEncryptedEnvelope(encryptedPayload), true);
assert.equal(isEncryptedEnvelope('just plain text'), false);
assert.equal(isEncryptedEnvelope('{"v":2}'), false);
assert.equal(isEncryptedEnvelope(42), false);

// listRecipients
const recipients = listRecipients(encryptedPayload);
assert.deepEqual(recipients, [keypair1.fingerprint]);

// Decrypt
const seed1 = Buffer.from(keypair1.seed, 'base64url');
const result = await decrypt(encryptedPayload, seed1);
assert.equal(result.content, plaintext);

// Decrypt from parsed envelope object (not string)
const result2 = await decrypt(envelope, seed1);
assert.equal(result2.content, plaintext);

// --- Multi-recipient encrypt/decrypt ---

const multiRecipientPubKeys = [keypair1.publicKey, keypair2.publicKey];
const { envelope: multiEnvelope, encryptedPayload: multiPayload } = await encrypt(plaintext, multiRecipientPubKeys);

assert.equal(multiEnvelope.recipients.length, 2);
const multiRecipients = listRecipients(multiPayload);
assert.equal(multiRecipients.length, 2);
assert.ok(multiRecipients.includes(keypair1.fingerprint));
assert.ok(multiRecipients.includes(keypair2.fingerprint));

// Each recipient can decrypt
const seed2 = Buffer.from(keypair2.seed, 'base64url');
const r1 = await decrypt(multiPayload, seed1);
const r2 = await decrypt(multiPayload, seed2);
assert.equal(r1.content, plaintext);
assert.equal(r2.content, plaintext);

// --- Wrong recipient cannot decrypt ---

const keypair3 = generateEncryptionKeypair();
const seed3 = Buffer.from(keypair3.seed, 'base64url');
await assert.rejects(
  () => decrypt(multiPayload, seed3),
  /not found in envelope/,
  'non-recipient should fail to decrypt'
);

// --- Buffer content encrypt/decrypt ---

const bufferContent = Buffer.from('Binary content 🎉', 'utf8');
const { encryptedPayload: bufPayload } = await encrypt(bufferContent, [keypair1.publicKey]);
const bufResult = await decrypt(bufPayload, seed1);
assert.equal(bufResult.content, bufferContent.toString('utf8'));

// --- Large content ---

const largeContent = 'A'.repeat(100000);
const { encryptedPayload: largePayload } = await encrypt(largeContent, [keypair1.publicKey]);
const largeResult = await decrypt(largePayload, seed1);
assert.equal(largeResult.content, largeContent);

// --- Empty content ---

const emptyContent = '';
const { encryptedPayload: emptyPayload } = await encrypt(emptyContent, [keypair1.publicKey]);
const emptyResult = await decrypt(emptyPayload, seed1);
assert.equal(emptyResult.content, '');

// --- No recipients should throw ---

await assert.rejects(
  () => encrypt('test', []),
  /At least one recipient public key is required/
);

await assert.rejects(
  () => encrypt('test'),
  /At least one recipient public key is required/
);

// --- Tampered ciphertext should fail ---

const { encryptedPayload: tamperPayload } = await encrypt('secret', [keypair1.publicKey]);
const tampered = JSON.parse(tamperPayload);
tampered.ciphertext = Buffer.from(crypto.randomBytes(32)).toString('base64url');
await assert.rejects(
  () => decrypt(tampered, seed1),
  /Unsupported state/,
  'tampered ciphertext should fail decryption'
);

// --- Tampered auth tag should fail ---

const { encryptedPayload: tagPayload } = await encrypt('secret', [keypair1.publicKey]);
const tagTampered = JSON.parse(tagPayload);
tagTampered.authTag = Buffer.from(crypto.randomBytes(16)).toString('base64url');
await assert.rejects(
  () => decrypt(tagTampered, seed1),
  /Unsupported state/,
  'tampered auth tag should fail decryption'
);

// --- ECDH derived from Ed25519 should work for encrypt/decrypt ---

const edSeedA = crypto.randomBytes(32);
const edKeyA = deriveEncryptionKeyFromEd25519(edSeedA);
const edSeedB = crypto.randomBytes(32);
const edKeyB = deriveEncryptionKeyFromEd25519(edSeedB);

const edPlaintext = 'Derived key encryption test';
const { encryptedPayload: edPayload } = await encrypt(edPlaintext, [edKeyA.publicKey, edKeyB.publicKey]);

const edSeedBufA = Buffer.from(edKeyA.seed, 'base64url');
const edResultA = await decrypt(edPayload, edSeedBufA);
assert.equal(edResultA.content, edPlaintext);

const edSeedBufB = Buffer.from(edKeyB.seed, 'base64url');
const edResultB = await decrypt(edPayload, edSeedBufB);
assert.equal(edResultB.content, edPlaintext);

console.log('crypto tests passed');