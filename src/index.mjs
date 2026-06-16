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
export { HyperbeamTransport, ArweaveTransport, LocalTransport, getTransport, probeTransport, getCircuitBreakerStatus } from './transport.mjs';