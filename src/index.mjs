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

// Verification
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

// Bundle export/import
export { exportBundle, exportAllArticles, importBundle, buildBundle } from './bundle.mjs';
export { exportHistory } from './export-history.mjs';
export { importHistory } from './import-history.mjs';