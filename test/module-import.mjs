/**
 * Test: Importable module entry (src/index.mjs)
 *
 * Verifies that other agents can import PermaBrain as a module
 * and access all expected exports.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Test barrel import
import { api, crypto } from '../src/index.mjs';

// Test sub-path imports
import { api as apiDirect } from '../src/agent-api.mjs';
import * as cryptoDirect from '../src/crypto.mjs';
import { publishArticle, queryArticles, getArticle, syncArticlesAndAttestations } from '../src/index.mjs';
import { attestArticle, opinionFromArgs } from '../src/index.mjs';
import { consensusForArticle } from '../src/index.mjs';
import { initState, loadConfig, getHome } from '../src/index.mjs';
import { ensureIdentity, loadIdentity, publicIdentity } from '../src/index.mjs';
import { createDataItem, parseAns104, verifyDataItem, payloadText } from '../src/index.mjs';
import {
  buildArticleTags, buildAttestationTags, contentHash, deriveKey,
  slugify, tagsToObject, validateArticleKey, validateConfidence,
  validateKind, validateOpinion
} from '../src/index.mjs';
import { verifyDataItemById, verifyByKey, verifyItem } from '../src/index.mjs';
import { exportBundle, exportAllArticles, importBundle, buildBundle } from '../src/index.mjs';
import { exportHistory } from '../src/index.mjs';
import { importHistory } from '../src/index.mjs';
import { historyForKey, buildVersionChain, summarizeVersion } from '../src/index.mjs';
import { forkArticle, listForks, deriveForkKey } from '../src/index.mjs';
import { mergeArticles, threeWayMerge } from '../src/index.mjs';
import { diffArticles, diffLocalVsRemote } from '../src/index.mjs';
import { status } from '../src/index.mjs';

// Search + topic feed + activity feed
import { searchArticles } from '../src/index.mjs';
import { topicFeed, feedToMarkdown } from '../src/index.mjs';
import { activityFeed, activityToMarkdown } from '../src/index.mjs';

// --- 1. Barrel exports exist ---
console.log('1. Barrel exports exist');
assert.ok(api, 'api export exists');
assert.ok(crypto, 'crypto export exists');
assert.equal(typeof api.init, 'function', 'api.init is a function');
assert.equal(typeof api.publish, 'function', 'api.publish is a function');
assert.equal(typeof api.query, 'function', 'api.query is a function');
assert.equal(typeof api.get, 'function', 'api.get is a function');
assert.equal(typeof api.attest, 'function', 'api.attest is a function');
assert.equal(typeof api.consensus, 'function', 'api.consensus is a function');
assert.equal(typeof api.sync, 'function', 'api.sync is a function');
assert.equal(typeof api.localIndex, 'function', 'api.localIndex is a function');
assert.equal(typeof api.encrypt, 'function', 'api.encrypt is a function');
assert.equal(typeof api.decrypt, 'function', 'api.decrypt is a function');
assert.equal(typeof api.isEncrypted, 'function', 'api.isEncrypted is a function');
assert.equal(typeof api.listRecipients, 'function', 'api.listRecipients is a function');
assert.equal(typeof api.generateEncryptionKeypair, 'function', 'api.generateEncryptionKeypair is a function');
assert.equal(typeof api.deriveEncryptionKey, 'function', 'api.deriveEncryptionKey is a function');
assert.equal(typeof api.batchAttest, 'function', 'api.batchAttest is a function');
assert.equal(typeof api.autoImport, 'function', 'api.autoImport is a function');
assert.equal(typeof api.attestForAgent, 'function', 'api.attestForAgent is a function');
assert.equal(typeof api.provisionAgent, 'function', 'api.provisionAgent is a function');
assert.equal(typeof api.getCircuitBreakerStatus, 'function', 'api.getCircuitBreakerStatus is a function');
assert.equal(typeof api.getTransportStatus, 'function', 'api.getTransportStatus is a function');
console.log('   ✓ All api methods present');

// --- 2. Crypto namespace exports ---
console.log('2. Crypto namespace exports');
assert.equal(typeof crypto.encrypt, 'function', 'crypto.encrypt');
assert.equal(typeof crypto.decrypt, 'function', 'crypto.decrypt');
assert.equal(typeof crypto.isEncryptedEnvelope, 'function', 'crypto.isEncryptedEnvelope');
assert.equal(typeof crypto.listRecipients, 'function', 'crypto.listRecipients');
assert.equal(typeof crypto.generateEncryptionKeypair, 'function', 'crypto.generateEncryptionKeypair');
assert.equal(typeof crypto.generateX25519KeyPair, 'function', 'crypto.generateX25519KeyPair');
assert.equal(typeof crypto.deriveEncryptionKeyFromEd25519, 'function', 'crypto.deriveEncryptionKeyFromEd25519');
console.log('   ✓ All crypto methods present');

// --- 3. Sub-path imports match barrel ---
console.log('3. Sub-path imports match barrel');
assert.equal(api, apiDirect, 'api === direct import');
assert.deepEqual(Object.keys(crypto).sort(), Object.keys(cryptoDirect).sort(), 'crypto namespace matches direct');
console.log('   ✓ Sub-path imports consistent');

// --- 4. Lower-level module exports ---
console.log('4. Lower-level module exports');
assert.equal(typeof publishArticle, 'function', 'publishArticle');
assert.equal(typeof queryArticles, 'function', 'queryArticles');
assert.equal(typeof getArticle, 'function', 'getArticle');
assert.equal(typeof syncArticlesAndAttestations, 'function', 'syncArticlesAndAttestations');
assert.equal(typeof attestArticle, 'function', 'attestArticle');
assert.equal(typeof opinionFromArgs, 'function', 'opinionFromArgs');
assert.equal(typeof consensusForArticle, 'function', 'consensusForArticle');
assert.equal(typeof initState, 'function', 'initState');
assert.equal(typeof loadConfig, 'function', 'loadConfig');
assert.equal(typeof getHome, 'function', 'getHome');
assert.equal(typeof ensureIdentity, 'function', 'ensureIdentity');
assert.equal(typeof loadIdentity, 'function', 'loadIdentity');
assert.equal(typeof publicIdentity, 'function', 'publicIdentity');
assert.equal(typeof createDataItem, 'function', 'createDataItem');
assert.equal(typeof parseAns104, 'function', 'parseAns104');
assert.equal(typeof verifyDataItem, 'function', 'verifyDataItem');
assert.equal(typeof payloadText, 'function', 'payloadText');
assert.equal(typeof verifyDataItemById, 'function', 'verifyDataItemById');
assert.equal(typeof verifyByKey, 'function', 'verifyByKey');
assert.equal(typeof verifyItem, 'function', 'verifyItem');
assert.equal(typeof exportBundle, 'function', 'exportBundle');
assert.equal(typeof exportAllArticles, 'function', 'exportAllArticles');
assert.equal(typeof importBundle, 'function', 'importBundle');
assert.equal(typeof exportHistory, 'function', 'exportHistory');
assert.equal(typeof importHistory, 'function', 'importHistory');
assert.equal(typeof buildArticleTags, 'function', 'buildArticleTags');
assert.equal(typeof buildAttestationTags, 'function', 'buildAttestationTags');
assert.equal(typeof contentHash, 'function', 'contentHash');
assert.equal(typeof deriveKey, 'function', 'deriveKey');
assert.equal(typeof slugify, 'function', 'slugify');
assert.equal(typeof tagsToObject, 'function', 'tagsToObject');
assert.equal(typeof validateArticleKey, 'function', 'validateArticleKey');
assert.equal(typeof validateConfidence, 'function', 'validateConfidence');
assert.equal(typeof validateKind, 'function', 'validateKind');
assert.equal(typeof validateOpinion, 'function', 'validateOpinion');
assert.equal(typeof historyForKey, 'function', 'historyForKey');
assert.equal(typeof buildVersionChain, 'function', 'buildVersionChain');
assert.equal(typeof summarizeVersion, 'function', 'summarizeVersion');
assert.equal(typeof forkArticle, 'function', 'forkArticle');
assert.equal(typeof listForks, 'function', 'listForks');
assert.equal(typeof deriveForkKey, 'function', 'deriveForkKey');
assert.equal(typeof mergeArticles, 'function', 'mergeArticles');
assert.equal(typeof threeWayMerge, 'function', 'threeWayMerge');
assert.equal(typeof diffArticles, 'function', 'diffArticles');
assert.equal(typeof diffLocalVsRemote, 'function', 'diffLocalVsRemote');
assert.equal(typeof status, 'function', 'status');
assert.equal(typeof searchArticles, 'function', 'searchArticles');
assert.equal(typeof topicFeed, 'function', 'topicFeed');
assert.equal(typeof feedToMarkdown, 'function', 'feedToMarkdown');
assert.equal(typeof activityFeed, 'function', 'activityFeed');
assert.equal(typeof activityToMarkdown, 'function', 'activityToMarkdown');
console.log('   ✓ All lower-level exports present');

// --- 5. package.json exports field ---
console.log('5. package.json exports field');
const pkgPath = new URL('../package.json', import.meta.url).pathname;
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
assert.ok(pkg.exports, 'package.json has exports');
assert.equal(pkg.exports['.'], './src/index.mjs', 'main export points to index.mjs');
assert.equal(pkg.exports['./api'], './src/agent-api.mjs', './api export');
assert.equal(pkg.exports['./crypto'], './src/crypto.mjs', './crypto export');
assert.equal(pkg.main, './src/index.mjs', 'main field set');
console.log('   ✓ package.json exports configured correctly');

// --- 6. Functional test: api.encrypt/decrypt round-trip via module ---
console.log('6. Encryption round-trip via module API');
const keypair1 = api.generateEncryptionKeypair();
const keypair2 = api.generateEncryptionKeypair();
const plaintext = 'Secret article for agent eyes only';

const { envelope, encryptedPayload } = await api.encrypt(plaintext, [keypair1.publicKey, keypair2.publicKey]);
assert.ok(envelope.ephemeralPublicKey, 'envelope has ephemeral key');
assert.ok(envelope.ciphertext, 'envelope has ciphertext');
assert.equal(envelope.recipients.length, 2, 'envelope has 2 recipients');

// Decrypt as recipient 1
const seed1 = Buffer.from(keypair1.seed, 'base64url');
const { content: decrypted1 } = await api.decrypt(encryptedPayload, seed1);
assert.equal(decrypted1, plaintext, 'decrypt as recipient 1');

// Decrypt as recipient 2
const seed2 = Buffer.from(keypair2.seed, 'base64url');
const { content: decrypted2 } = await api.decrypt(encryptedPayload, seed2);
assert.equal(decrypted2, plaintext, 'decrypt as recipient 2');
console.log('   ✓ Encrypt/decrypt round-trip works via api');

// --- 7. isEncrypted + listRecipients ---
console.log('7. isEncrypted + listRecipients');
assert.equal(api.isEncrypted(encryptedPayload), true, 'isEncrypted detects envelope');
assert.equal(api.isEncrypted('just some text'), false, 'isEncrypted rejects plain text');
const fingerprints = api.listRecipients(encryptedPayload);
assert.equal(fingerprints.length, 2, 'listRecipients returns 2 fingerprints');
console.log('   ✓ isEncrypted + listRecipients work via api');

// --- 8. deriveEncryptionKey ---
console.log('8. deriveEncryptionKey from Ed25519 seed');
const edSeed = Buffer.alloc(32, 7); // test seed
const derived = api.deriveEncryptionKey(edSeed);
assert.equal(derived.type, 'x25519-derived', 'derived key type');
assert.ok(derived.publicKey, 'derived public key');
assert.ok(derived.fingerprint, 'derived fingerprint');
console.log('   ✓ deriveEncryptionKey works via api');

// --- 9. batchAttest ---
console.log('9. batchAttest API exists and validates input');
assert.equal(typeof api.batchAttest, 'function', 'batchAttest is a function');
// Test validation: empty array
try {
  await api.batchAttest({ attestations: [] });
  assert.fail('should throw for empty array');
} catch (e) {
  assert.match(e.message, /attestations array is required/);
}
// Test validation: missing attestations
try {
  await api.batchAttest({});
  assert.fail('should throw for missing attestations');
} catch (e) {
  assert.match(e.message, /attestations array is required/);
}
console.log('   ✓ batchAttest validates input');

// --- 10. autoImport ---
console.log('10. autoImport API exists and validates input');
assert.equal(typeof api.autoImport, 'function', 'autoImport is a function');
// Test validation: empty array
try {
  await api.autoImport({ articles: [] });
  assert.fail('should throw for empty array');
} catch (e) {
  assert.match(e.message, /articles array is required/);
}
// Test validation: missing articles
try {
  await api.autoImport({});
  assert.fail('should throw for missing articles');
} catch (e) {
  assert.match(e.message, /articles array is required/);
}
console.log('   ✓ autoImport validates input');

// --- 11. deriveTitleFromUrl helper (indirect test via autoImport input validation) ---
console.log('11. API completeness check');
const expectedMethods = [
  'init', 'ensureInit', 'publish', 'query', 'get', 'attest', 'consensus',
  'sync', 'localIndex', 'importWikipedia', 'attestForAgent', 'provisionAgent',
  'processProxyAttestation', 'parseAttestationRequest', 'buildAttestationRequest',
  'listKnownAgents', 'getKnownAgent', 'encrypt', 'decrypt', 'isEncrypted',
  'listRecipients', 'generateEncryptionKeypair', 'deriveEncryptionKey',
  'batchAttest', 'autoImport', 'getAndDecrypt', 'probe', 'getCircuitBreakerStatus', 'getTransportStatus',
  'verify', 'exportBundle', 'exportAll', 'importBundle', 'exportHistory', 'importHistory', 'history', 'fork', 'listForks', 'merge', 'diff', 'status', 'search', 'topicFeed', 'activity'
];
for (const method of expectedMethods) {
  assert.equal(typeof api[method], 'function', `api.${method} is a function`);
}
console.log('   ✓ All 43 API methods present');

console.log('\n✅ All importable module tests passed');