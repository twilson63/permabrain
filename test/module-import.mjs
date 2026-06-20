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
import { importBundleAutoDetect, importReportToMarkdown, detectBundleType, BUNDLE_TYPES } from '../src/index.mjs';
import { historyForKey, buildVersionChain, summarizeVersion } from '../src/index.mjs';
import { forkArticle, listForks, deriveForkKey } from '../src/index.mjs';
import { mergeArticles, threeWayMerge } from '../src/index.mjs';
import { diffArticles, diffLocalVsRemote } from '../src/index.mjs';
import { status } from '../src/index.mjs';

// Search + topic feed + activity feed + article list + export
import { searchArticles } from '../src/index.mjs';
import { topicFeed, feedToMarkdown } from '../src/index.mjs';
import { activityFeed, activityToMarkdown } from '../src/index.mjs';
import { listArticles, listToMarkdown } from '../src/index.mjs';
import { exportArticles, exportArticlesToMarkdown } from '../src/index.mjs';
import { computeMetrics, metricsToMarkdown } from '../src/index.mjs';
import { runConfigCommand, loadEffectiveConfig, validateConfig, configToMarkdown, getConfigValue, setConfigValue, ENV_MAP } from '../src/index.mjs';
import { listRemotes, addRemote, removeRemote, setDefaultRemote, probeRemote, queryRemote, syncRemote, remotesToMarkdown, buildRemoteConfig } from '../src/index.mjs';
import { createBackup, listBackups, restoreBackup, pruneBackups, backupsToMarkdown } from '../src/index.mjs';
import { archive, restore } from '../src/index.mjs';
import { logDir } from '../src/index.mjs';
import { renderTemplate, createArticleFromTemplate, template } from '../src/index.mjs';
import { buildDashboard, dashboardToHtml, dashboardToMarkdown, writeDashboard, publishDashboard } from '../src/index.mjs';
import { publishPage, dashboardPageId, computeFingerprint, contentDigest, signRequest } from '../src/index.mjs';
import { shareEncryptedArticle, publishEncryptedShare, buildEncryptedSharePage, sharePageId, subscribeEventsRemote, subscribeEventsOverSse, subscribeEventsOverWebSocket, formatEvent, runEventsSubscriber } from '../src/index.mjs';

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
assert.equal(typeof api.serve, 'function', 'api.serve is a function');
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
assert.equal(typeof importBundleAutoDetect, 'function', 'importBundleAutoDetect');
assert.equal(typeof importReportToMarkdown, 'function', 'importReportToMarkdown');
assert.equal(typeof detectBundleType, 'function', 'detectBundleType');
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
assert.equal(typeof listArticles, 'function', 'listArticles');
assert.equal(typeof listToMarkdown, 'function', 'listToMarkdown');
assert.equal(typeof exportArticles, 'function', 'exportArticles');
assert.equal(typeof exportArticlesToMarkdown, 'function', 'exportArticlesToMarkdown');
assert.equal(typeof runConfigCommand, 'function', 'runConfigCommand');
assert.equal(typeof loadEffectiveConfig, 'function', 'loadEffectiveConfig');
assert.equal(typeof validateConfig, 'function', 'validateConfig');
assert.equal(typeof configToMarkdown, 'function', 'configToMarkdown');
assert.equal(typeof listRemotes, 'function', 'listRemotes');
assert.equal(typeof addRemote, 'function', 'addRemote');
assert.equal(typeof removeRemote, 'function', 'removeRemote');
assert.equal(typeof setDefaultRemote, 'function', 'setDefaultRemote');
assert.equal(typeof probeRemote, 'function', 'probeRemote');
assert.equal(typeof queryRemote, 'function', 'queryRemote');
assert.equal(typeof syncRemote, 'function', 'syncRemote');
assert.equal(typeof remotesToMarkdown, 'function', 'remotesToMarkdown');
assert.equal(typeof buildRemoteConfig, 'function', 'buildRemoteConfig');
assert.equal(typeof archive, 'function', 'archive');
assert.equal(typeof restore, 'function', 'restore');
assert.equal(typeof createBackup, 'function', 'createBackup');
assert.equal(typeof listBackups, 'function', 'listBackups');
assert.equal(typeof restoreBackup, 'function', 'restoreBackup');
assert.equal(typeof logDir, 'function', 'logDir');
assert.equal(typeof renderTemplate, 'function', 'renderTemplate');
assert.equal(typeof createArticleFromTemplate, 'function', 'createArticleFromTemplate');
assert.equal(typeof template, 'function', 'template');
assert.equal(typeof buildDashboard, 'function', 'buildDashboard');
assert.equal(typeof dashboardToHtml, 'function', 'dashboardToHtml');
assert.equal(typeof dashboardToMarkdown, 'function', 'dashboardToMarkdown');
assert.equal(typeof writeDashboard, 'function', 'writeDashboard');
assert.equal(typeof publishDashboard, 'function', 'publishDashboard');
assert.equal(typeof publishPage, 'function', 'publishPage');
assert.equal(typeof dashboardPageId, 'function', 'dashboardPageId');
assert.equal(typeof computeFingerprint, 'function', 'computeFingerprint');
assert.equal(typeof contentDigest, 'function', 'contentDigest');
assert.equal(typeof signRequest, 'function', 'signRequest');

// Threshold exports
import {
  createThresholdEnvelope as createThresholdEnvelopeExport,
  addCoSigner as addCoSignerExport,
  finalizeThresholdAttestation as finalizeThresholdAttestationExport,
  verifyThresholdEnvelope as verifyThresholdEnvelopeExport,
  importThresholdEnvelope as importThresholdEnvelopeExport,
  exportThresholdEnvelope as exportThresholdEnvelopeExport,
  verifyThresholdSignature,
  signThresholdDigest,
  thresholdAttestationDigest,
  normalizeThresholdPolicy,
  summarizeThresholdAttestation
} from '../src/index.mjs';
assert.equal(typeof createThresholdEnvelopeExport, 'function', 'createThresholdEnvelope');
assert.equal(typeof addCoSignerExport, 'function', 'addCoSigner');
assert.equal(typeof finalizeThresholdAttestationExport, 'function', 'finalizeThresholdAttestation');
assert.equal(typeof verifyThresholdEnvelopeExport, 'function', 'verifyThresholdEnvelope');
assert.equal(typeof importThresholdEnvelopeExport, 'function', 'importThresholdEnvelope');
assert.equal(typeof exportThresholdEnvelopeExport, 'function', 'exportThresholdEnvelope');
assert.equal(typeof verifyThresholdSignature, 'function', 'verifyThresholdSignature');
assert.equal(typeof signThresholdDigest, 'function', 'signThresholdDigest');
assert.equal(typeof thresholdAttestationDigest, 'function', 'thresholdAttestationDigest');
assert.equal(typeof normalizeThresholdPolicy, 'function', 'normalizeThresholdPolicy');
assert.equal(typeof summarizeThresholdAttestation, 'function', 'summarizeThresholdAttestation');

// SDK exports
import { createClient } from '../src/index.mjs';
import { generateCompletion, listSupportedShells } from '../src/index.mjs';
import { publishDirectory, publishDirectoryToMarkdown, deriveKeyFromPath, findMarkdownFiles } from '../src/index.mjs';
import { watchFiles, publishFilesOnce, watchFilesToMarkdown } from '../src/index.mjs';

// Server exports
import { createServer, startServer, stopServer } from '../src/index.mjs';
import { createRateLimiter, getClientIdentifier } from '../src/index.mjs';
assert.equal(typeof createServer, 'function', 'createServer');
assert.equal(typeof startServer, 'function', 'startServer');
assert.equal(typeof stopServer, 'function', 'stopServer');
assert.equal(typeof createClient, 'function', 'createClient');
assert.equal(typeof createRateLimiter, 'function', 'createRateLimiter');
assert.equal(typeof getClientIdentifier, 'function', 'getClientIdentifier');
assert.equal(typeof publishDirectory, 'function', 'publishDirectory');
assert.equal(typeof publishDirectoryToMarkdown, 'function', 'publishDirectoryToMarkdown');
assert.equal(typeof deriveKeyFromPath, 'function', 'deriveKeyFromPath');
assert.equal(typeof findMarkdownFiles, 'function', 'findMarkdownFiles');
assert.equal(typeof watchFiles, 'function', 'watchFiles');
assert.equal(typeof publishFilesOnce, 'function', 'publishFilesOnce');
assert.equal(typeof watchFilesToMarkdown, 'function', 'watchFilesToMarkdown');
console.log('   ✓ All lower-level exports present (including dashboard + ZenBin + client + rate limit + publish-dir + watch-files)');

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
  'releaseNotes', 'repl', 'accessLog', 'tailAccessLog', 'accessLogToMarkdown', 'events', 'subscribeEventsRemote', 'subscribe', 'renderTemplate', 'template', 'dashboard', 'dashboardHTML', 'dashboardMarkdown', 'writeDashboard', 'publishDashboard', 'whoami', 'health',
  'validateMetadata', 'validateDataItem',
  'peerInfo', 'buildPeerPullBundle', 'pullFromPeer', 'pullFromPeerAsBundle', 'peerStatus',
  'init', 'ensureInit', 'publish', 'query', 'get', 'attest', 'consensus',
  'sync', 'localIndex', 'importWikipedia', 'attestForAgent', 'provisionAgent',
  'processProxyAttestation', 'parseAttestationRequest', 'buildAttestationRequest',
  'listKnownAgents', 'getKnownAgent', 'encrypt', 'decrypt', 'isEncrypted',
  'listRecipients', 'generateEncryptionKeypair', 'deriveEncryptionKey',
  'batchAttest', 'autoImport', 'getAndDecrypt', 'probe', 'getCircuitBreakerStatus', 'getTransportStatus',
  'verify', 'exportBundle', 'exportAll', 'importBundle', 'importBundleAutoDetect', 'exportHistory', 'importHistory', 'history', 'fork', 'listForks', 'merge', 'diff', 'status', 'search', 'topicFeed', 'activity', 'listArticles', 'exportArticles', 'metrics', 'stats', 'config', 'remote', 'archive', 'restore', 'backup', 'listBackups', 'restoreBackup', 'pruneBackups', 'serve', 'doctor', 'log', 'auditLog', 'logToMarkdown', 'tailLog', 'exportLog', 'importLog', 'completion',
  'createThresholdAttestation', 'addThresholdSigner', 'finalizeThresholdAttestation', 'verifyThresholdEnvelope', 'importThresholdEnvelope', 'exportThresholdEnvelope', 'shareEncrypted',
  'adminPanel', 'adminPanelHTML', 'adminPanelMarkdown',
  'watchFiles', 'watchFilesOnce', 'watchFilesToMarkdown'
];
for (const method of expectedMethods) {
  assert.equal(typeof api[method], 'function', `api.${method} is a function`);
}
console.log('   ✓ All 101 API methods present');

// --- 11a. Admin panel API methods ---
console.log('11a. Admin panel API methods');
assert.equal(typeof api.adminPanel, 'function', 'api.adminPanel is a function');
assert.equal(typeof api.adminPanelHTML, 'function', 'api.adminPanelHTML is a function');
assert.equal(typeof api.adminPanelMarkdown, 'function', 'api.adminPanelMarkdown is a function');
console.log('   ✓ Admin panel API methods present');

// --- 12. Log API methods ---
console.log('12. Log API methods');
assert.equal(typeof api.log, 'function', 'api.log is a function');
assert.equal(typeof api.auditLog, 'function', 'api.auditLog is a function');
assert.equal(typeof api.logToMarkdown, 'function', 'api.logToMarkdown is a function');
assert.equal(typeof api.tailLog, 'function', 'api.tailLog is a function');
assert.equal(typeof api.exportLog, 'function', 'api.exportLog is a function');
assert.equal(typeof api.importLog, 'function', 'api.importLog is a function');
assert.equal(typeof api.accessLog, 'function', 'api.accessLog is a function');
assert.equal(typeof api.tailAccessLog, 'function', 'api.tailAccessLog is a function');
assert.equal(typeof api.accessLogToMarkdown, 'function', 'api.accessLogToMarkdown is a function');
console.log('   ✓ Log API methods present');

// --- 13. Template API methods ---
console.log('13. Template API methods');
assert.equal(typeof api.renderTemplate, 'function', 'api.renderTemplate is a function');
assert.equal(typeof api.template, 'function', 'api.template is a function');
console.log('   ✓ Template API methods present');

// --- 14. Dashboard API methods ---
console.log('14. Dashboard API methods');
assert.equal(typeof api.dashboard, 'function', 'api.dashboard is a function');
assert.equal(typeof api.dashboardHTML, 'function', 'api.dashboardHTML is a function');
assert.equal(typeof api.dashboardMarkdown, 'function', 'api.dashboardMarkdown is a function');
assert.equal(typeof api.writeDashboard, 'function', 'api.writeDashboard is a function');
assert.equal(typeof api.publishDashboard, 'function', 'api.publishDashboard is a function');
console.log('   ✓ Dashboard API methods present');

// --- 14b. Encrypted share exports ---
console.log('14b. Encrypted share exports');
assert.equal(typeof shareEncryptedArticle, 'function', 'shareEncryptedArticle');
assert.equal(typeof publishEncryptedShare, 'function', 'publishEncryptedShare');
assert.equal(typeof buildEncryptedSharePage, 'function', 'buildEncryptedSharePage');
assert.equal(typeof sharePageId, 'function', 'sharePageId');
assert.equal(typeof api.shareEncrypted, 'function', 'api.shareEncrypted is a function');
console.log('   ✓ Encrypted share exports present');

// --- 15. Publish directory API methods ---
console.log('15. Publish directory API methods');
assert.equal(typeof api.publishDirectory, 'function', 'api.publishDirectory is a function');
assert.equal(typeof api.publishDirectoryToMarkdown, 'function', 'api.publishDirectoryToMarkdown is a function');
console.log('   ✓ Publish directory API methods present');

// --- 16. REPL exports ---
console.log('16. REPL exports');
import { createRepl, readHistory, writeHistory, buildApiCompleter } from '../src/index.mjs';
assert.equal(typeof api.repl, 'function', 'api.repl is a function');
assert.equal(typeof createRepl, 'function', 'createRepl is a function');
assert.equal(typeof readHistory, 'function', 'readHistory is a function');
assert.equal(typeof writeHistory, 'function', 'writeHistory is a function');
assert.equal(typeof buildApiCompleter, 'function', 'buildApiCompleter is a function');
console.log('   ✓ REPL exports present');

// --- 17. Completion exports ---
console.log('17. Completion exports');
assert.equal(typeof generateCompletion, 'function', 'generateCompletion');
assert.equal(typeof listSupportedShells, 'function', 'listSupportedShells');
assert.equal(typeof api.completion, 'function', 'api.completion is a function');
// Events exports
import { getEventBus, emitEvent, subscribeEvents } from '../src/index.mjs';
assert.equal(typeof getEventBus, 'function', 'getEventBus');
assert.equal(typeof emitEvent, 'function', 'emitEvent');
assert.equal(typeof subscribeEvents, 'function', 'subscribeEvents');

// Schema exports
import {
  ARTICLE_METADATA_SCHEMA,
  ATTESTATION_METADATA_SCHEMA,
  validateMetadata,
  validateArticleMetadata,
  validateAttestationMetadata,
  validateDataItemTags,
  formatValidationErrors
} from '../src/index.mjs';
assert.equal(typeof ARTICLE_METADATA_SCHEMA, 'object', 'ARTICLE_METADATA_SCHEMA');
assert.equal(typeof ATTESTATION_METADATA_SCHEMA, 'object', 'ATTESTATION_METADATA_SCHEMA');
assert.equal(typeof validateMetadata, 'function', 'validateMetadata');
assert.equal(typeof validateArticleMetadata, 'function', 'validateArticleMetadata');
assert.equal(typeof validateAttestationMetadata, 'function', 'validateAttestationMetadata');
assert.equal(typeof validateDataItemTags, 'function', 'validateDataItemTags');
assert.equal(typeof formatValidationErrors, 'function', 'formatValidationErrors');

// Remote event subscriber exports
assert.equal(typeof subscribeEventsRemote, 'function', 'subscribeEventsRemote');
assert.equal(typeof subscribeEventsOverSse, 'function', 'subscribeEventsOverSse');
assert.equal(typeof subscribeEventsOverWebSocket, 'function', 'subscribeEventsOverWebSocket');
assert.equal(typeof formatEvent, 'function', 'formatEvent');
assert.equal(typeof runEventsSubscriber, 'function', 'runEventsSubscriber');

// Remote event publisher exports
import { forwardEvents, runEventPublisher } from '../src/index.mjs';
assert.equal(typeof forwardEvents, 'function', 'forwardEvents');
assert.equal(typeof runEventPublisher, 'function', 'runEventPublisher');

console.log('   OK Events + schema exports present');

// Request-log exports
import { requestLogger, RequestLogger, getRecentRequests, requestsToMarkdown, accessLogResultToMarkdown } from '../src/index.mjs';
assert.equal(typeof requestLogger, 'function', 'requestLogger');
assert.equal(typeof RequestLogger, 'function', 'RequestLogger');
assert.equal(typeof getRecentRequests, 'function', 'getRecentRequests');
assert.equal(typeof requestsToMarkdown, 'function', 'requestsToMarkdown');
assert.equal(typeof accessLogResultToMarkdown, 'function', 'accessLogResultToMarkdown');

console.log('   OK Request-log exports present');

// Admin panel exports
import { buildAdminPanel, adminPanelToHtml, adminPanelToMarkdown } from '../src/index.mjs';
assert.equal(typeof buildAdminPanel, 'function', 'buildAdminPanel');
assert.equal(typeof adminPanelToHtml, 'function', 'adminPanelToHtml');
assert.equal(typeof adminPanelToMarkdown, 'function', 'adminPanelToMarkdown');

console.log('   OK Admin panel exports present');