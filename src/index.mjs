/**
 * PermaBrain — Importable Module Entry
 *
 * Usage from other agents:
 *   import { api, crypto } from '/path/to/permabrain/src/index.mjs';
 *   // or with npm install:
 *   import { api, crypto } from 'permabrain';
 *
 * The `api` object is the primary interface. See agent-api.mjs for full docs.
 * The `crypto` namespace provides encryption/decryption for private articles.
 */

// Primary agent API
export { api } from './agent-api.mjs';

// Crypto for encrypted articles
export * as crypto from './crypto.mjs';

// Lower-level modules for advanced usage
export { publishArticle, queryArticles, getArticle, syncArticlesAndAttestations } from './article.mjs';
export { attestArticle, opinionFromArgs } from './attestation.mjs';
export { consensusForArticle } from './consensus.mjs';
export { initState, loadConfig, getHome } from './config.mjs';
export { ensureIdentity, loadIdentity, publicIdentity } from './keys.mjs';
export { createDataItem, parseAns104, verifyDataItem, payloadText } from './dataitem.mjs';
export {
  buildArticleTags, buildAttestationTags, contentHash, deriveKey,
  slugify, tagsToObject, validateArticleKey, validateConfidence,
  validateKind, validateOpinion
} from './tags.mjs';

// HyperBEAM device architecture
export { HyperbeamQuery } from './hb-query.mjs';
export { HyperbeamConsensus } from './hb-consensus.mjs';
export { HyperbeamReference } from './hb-reference.mjs';
export {
  DEVICES as HB_DEVICES,
  FORMATTERS as HB_FORMATTERS,
  LUA_DEVICE, PERMABRAIN_CONSENSUS_LUA, PERMABRAIN_QUERY_LUA,
  bundlerUploadUrl, fetchUrl, pushUrl, processUrl, metaUrl, queryUrl, matchUrl, referenceUrl,
  parseHttpsigtHeaders, kebabToTitleCase, titleToKebabCase,
  buildPermaBrainFilters, buildQueryMessage
} from './hb-devices.mjs';
export { HyperbeamTransport, ArweaveTransport, LocalTransport, getTransport, probeTransport, getCircuitBreakerStatus, getTransportMetrics } from './transport.mjs';

// Article directory list
export { listArticles, listToMarkdown } from './list.mjs';

// Export filtered article directory
export { exportArticles, exportArticlesToMarkdown } from './export-articles.mjs';
export { verifyDataItemById, verifyByKey, verifyItem } from './verify.mjs';

// History
export { historyForKey, buildVersionChain, summarizeVersion } from './history.mjs';

// Fork
export { forkArticle, listForks, deriveForkKey } from './fork.mjs';

// Merge
export { mergeArticles, threeWayMerge } from './merge.mjs';

// Sync with merge
export { syncWithMerge, syncArticlesAndAttestationsBase } from './sync.mjs';

// Diff
export { diffArticles, diffLocalVsRemote } from './diff.mjs';

// Status
export { status } from './status.mjs';

// Search
export { searchArticles } from './search.mjs';

// Topic feed
export { topicFeed, feedToMarkdown } from './topic-feed.mjs';

// Activity feed
export { activityFeed, activityToMarkdown } from './activity.mjs';

// Config manager
export { runConfigCommand, loadEffectiveConfig, validateConfig, configToMarkdown, getConfigValue, setConfigValue, ENV_MAP } from './config-manager.mjs';

// Named remotes
export { listRemotes, addRemote, removeRemote, setDefaultRemote, probeRemote, queryRemote, syncRemote, remotesToMarkdown, buildRemoteConfig } from './remotes.mjs';

// Article-level metrics and dashboard stats
export { computeMetrics, metricsToMarkdown } from './article-metrics.mjs';
export { computeStats, statsToMarkdown } from './stats.mjs';

// Bundle export/import
export { exportBundle, exportAllArticles, importBundle, buildBundle } from './bundle.mjs';
export { exportHistory } from './export-history.mjs';
export { importHistory } from './import-history.mjs';

// Archive / restore snapshots
export { archive, restore } from './archive.mjs';

// Backup manager (timestamped multi-backup directory)
export { createBackup, listBackups, restoreBackup, pruneBackups, backupsToMarkdown } from './backup.mjs';

// Local HTTP API server
export { createServer, startServer, stopServer } from './serve.mjs';

// HTTP client SDK for permabrain serve
export { createClient } from './client.mjs';

// State doctor / repair
export { runDoctor, doctorReportToMarkdown } from './doctor.mjs';

// Template-driven article creation
export { renderTemplate, createArticleFromTemplate, template } from './template.mjs';

// Local audit log
export { logAction, queryLog, logToMarkdown, logDir, tailLog, followLog, exportLog, importLog } from './log.mjs';

// Web dashboard snapshot + ZenBin publishing
export { buildDashboard, dashboardToHtml, dashboardToMarkdown, writeDashboard, publishDashboard } from './dashboard.mjs';

// Encrypted article sharing via ZenBin CAP pages
export { shareEncryptedArticle, publishEncryptedShare, buildEncryptedSharePage, sharePageId } from './share-encrypted.mjs';

// Shell completion generators
export { generateCompletion, listSupportedShells } from './completion.mjs';

// Real-time event bus and subscriptions
export { getEventBus, emitEvent, subscribeEvents } from './events.mjs';

// Remote event subscriber (connect to permabrain serve)
export { subscribeEventsRemote, subscribeEventsOverSse, subscribeEventsOverWebSocket, formatEvent, runEventsSubscriber } from './events-client.mjs';

// Remote event publisher (forward local events to a remote peer)
export { forwardEvents, runEventPublisher } from './subscribe.mjs';

// Peer sync (gossip-style article exchange)
export {
  peerInfo,
  diffPeerKeys,
  diffKeysForPush,
  buildPeerPullBundle,
  buildPeerPushBundle,
  pullFromPeer,
  pullFromPeerAsBundle,
  pushToPeer,
  pushToPeerClient,
  peerStatus,
  peerInfoToMarkdown,
  peerStatusToMarkdown
} from './peer.mjs';

// JSON Schema metadata validation
export {
  ARTICLE_METADATA_SCHEMA,
  ATTESTATION_METADATA_SCHEMA,
  validateMetadata,
  validateArticleMetadata,
  validateAttestationMetadata,
  validateDataItemTags,
  formatValidationErrors
} from './schema.mjs';

// ZenBin client helpers
export { publishPage, dashboardPageId, computeFingerprint, contentDigest, signRequest, ZENBIN_BASE_URL, ZENBIN_PUBLISH_PATH } from './zenbin.mjs';

// Threshold / multi-sig attestations
export {
  createThresholdEnvelope,
  addCoSigner,
  finalizeThresholdAttestation,
  exportThresholdEnvelope,
  importThresholdEnvelope,
  verifyThresholdEnvelope,
  verifyThresholdSignature,
  signThresholdDigest,
  thresholdAttestationDigest,
  normalizeThresholdPolicy,
  summarizeThresholdAttestation
} from './threshold-attestation.mjs';