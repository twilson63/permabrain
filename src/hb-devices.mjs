/**
 * HyperBEAM Device Constants, URL Builders, and HTTP-SIG Helpers
 *
 * Implements the PermaBrain → HyperBEAM device mapping from
 * docs/hyperbeam-device-architecture.md
 *
 * Every piece of data in HyperBEAM is a Message (HTTP headers + body).
 * Devices are named services that operate on messages. Formatters define
 * how data is encoded/decoded. The match index provides reverse lookups.
 */

// ============================================================================
// Device & Formatter Identifiers
// ============================================================================

export const DEVICES = {
  /** Bundler — persist DataItems, auto-index tags into match index */
  bundler: '~bundler@1.0',
  /** Push — submit messages to AO processes (routes to scheduler) */
  push: '~push@1.0',
  /** Process — resolve AO process state */
  process: '~process@1.0',
  /** Meta — node metadata and configuration */
  meta: '~meta@1.0',
  /** Query — tag-based search using match index */
  query: '~query@1.0',
  /** Match — reverse index for key-value pairs (lower-level than query) */
  match: '~match@1.0',
  /** Message — identity/default device (returns raw message keys) */
  message: 'message@1.0',
  /** Cache — node-local caching device */
  cache: '~cache@1.0',
  /** Router — request routing device */
  router: '~router@1.0',
  /** Cron — scheduled execution device */
  cron: '~cron@1.0',
  /** Whois — agent identity registry */
  whois: '~whois@1.0',
};

export const FORMATTERS = {
  /** ANS-104 Arweave bundle item codec */
  ans104: 'ans104@1.0',
  /** HTTP Message Signatures (RFC 9421) — primary signing/verification format */
  httpsig: 'httpsig@1.0',
  /** JSON codec for HyperBEAM messages */
  json: 'json@1.0',
  /** Flat map codec (path-delimited keys) */
  flat: 'flat@1.0',
  /** Structured internal message format */
  structured: 'structured@1.0',
  /** Gzip compression codec */
  gzip: 'gzip@1.0',
  /** Arweave L1 transaction codec */
  tx: 'tx@1.0',
};

/** Lua VM device identifier */
export const LUA_DEVICE = 'lua@5.3a';

/** Content types for Lua modules */
export const LUA_CONTENT_TYPES = ['application/lua', 'text/x-lua'];

// ============================================================================
// URL Builders
// ============================================================================

/**
 * Build a bundler upload URL.
 * Format: {base}/~bundler@1.0/tx?codec-device=ans104@1.0
 */
export function bundlerUploadUrl(base) {
  return `${base}/${DEVICES.bundler}/tx?codec-device=${FORMATTERS.ans104}`;
}

/**
 * Build a fetch-by-ID URL.
 * Format: {base}/{id}
 * HyperBEAM returns items via HTTP-SIG formatter (tags as headers).
 */
export function fetchUrl(base, id) {
  return `${base}/${encodeURIComponent(id)}`;
}

/**
 * Build a push URL for a scheduler/process.
 * Format: {base}/{scheduler}~push@1.0
 */
export function pushUrl(base, scheduler) {
  return `${base}/${encodeURIComponent(scheduler)}${DEVICES.push}`;
}

/**
 * Build a process resolution URL.
 * Format: {base}/{processId}~process@1.0/{key}
 */
export function processUrl(base, processId, key = 'now') {
  return `${base}/${encodeURIComponent(processId)}${DEVICES.process}/${key}`;
}

/**
 * Build a meta info URL.
 * Format: {base}/~meta@1.0/info
 */
export function metaUrl(base) {
  return `${base}/${DEVICES.meta}/info`;
}

/**
 * Build a query URL using the query device.
 * Format: {base}/~query@1.0?{tag1}={val1}&{tag2}={val2}&return={type}
 *
 * The query device searches the match index for all key-value pairs
 * in the request message. Supported return types:
 * - paths (default): Return paths of matching messages
 * - messages: Return full message objects
 * - count: Return number of matches
 * - first: Return first matching message
 * - boolean: Return true/false
 */
export function queryUrl(base, tags, returnType = 'messages') {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(tags)) {
    params.set(encodeURIComponent(name), encodeURIComponent(value));
  }
  params.set('return', returnType);
  return `${base}/${DEVICES.query}?${params.toString()}`;
}

/**
 * Build a match URL for a specific key-value pair.
 * Format: {base}/~match@1.0/{key}={value}
 *
 * The match device provides direct reverse-index lookups.
 * Lower-level than query; returns message IDs that contain
 * the specified key-value pair.
 */
export function matchUrl(base, key, value) {
  return `${base}/${DEVICES.match}/${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
}

/**
 * Build a Lua compute URL.
 * Format: {base}/{processId}~process@1.0/{functionName}
 *
 * The Lua device resolves function names from the loaded Lua module.
 * For PermaBrain, the process loads permabrain-consensus.lua as its module.
 */
export function luaComputeUrl(base, processId, functionName) {
  return `${base}/${encodeURIComponent(processId)}${DEVICES.process}/${functionName}`;
}

// ============================================================================
// HTTP-SIG Header Parsing
// ============================================================================

/**
 * Known PermaBrain/Arweave tag prefixes that should be extracted from
 * HTTP-SIG response headers. HyperBEAM returns data items via the
 * HTTP-SIG formatter: tags become response headers (lowercase kebab-case).
 */
const KNOWN_TAG_PREFIXES = [
  'article-', 'attestation-', 'app-', 'permabrain-', 'content-',
  'data-protocol', 'type', 'module', 'scheduler', 'visibility',
  'perma-brain', 'consensus-', 'author-agent-id',
];

const KNOWN_EXACT_TAGS = [
  'type', 'module', 'scheduler', 'visibility',
];

/**
 * Parse HTTP-SIG response headers into PermaBrain tags.
 *
 * HyperBEAM returns data items via the httpsig@1.0 formatter.
 * Tags appear as HTTP response headers (lowercase kebab-case).
 * This function extracts known PermaBrain/Arweave tags and converts
 * them from kebab-case to Title-Case.
 *
 * Example: 'article-key' → 'Article-Key', 'app-name' → 'App-Name'
 */
export function parseHttpsigtHeaders(headers) {
  const tags = [];
  for (const [key, value] of headers.entries()) {
    const isMatch = KNOWN_EXACT_TAGS.includes(key) ||
      KNOWN_TAG_PREFIXES.some(p => key.startsWith(p));
    if (isMatch) {
      tags.push({ name: kebabToTitleCase(key), value });
    }
  }
  return tags;
}

/**
 * Convert kebab-case to Title-Case.
 * 'article-key' → 'Article-Key'
 * 'attestation-target' → 'Attestation-Target'
 * Special cases: 'id' → 'ID', 'url' → 'URL', 'api' → 'API'
 */
export function kebabToTitleCase(str) {
  const specials = { id: 'ID', url: 'URL', api: 'API' };
  return str.split('-').map(part => {
    if (specials[part]) return specials[part];
    return part.charAt(0).toUpperCase() + part.slice(1);
  }).join('-');
}

/**
 * Convert Title-Case to kebab-case (inverse of kebabToTitleCase).
 * 'Article-Key' → 'article-key'
 */
export function titleToKebabCase(str) {
  return str.split('-').map(part => part.toLowerCase()).join('-');
}

// ============================================================================
// Query Builder
// ============================================================================

/**
 * Build a HyperBEAM query message for the ~query@1.0 device.
 *
 * The query device searches the match index for messages matching
 * all key-value pairs in the request. Returns paths, messages,
 * count, or boolean.
 *
 * @param {Object} filters - Key-value tag filters
 * @param {string} returnType - 'paths'|'messages'|'count'|'first'|'boolean'
 * @returns {Object} Query message with headers
 */
export function buildQueryMessage(filters, returnType = 'messages') {
  const headers = {};
  for (const [name, value] of Object.entries(filters)) {
    headers[titleToKebabCase(name)] = String(value);
  }
  headers['return'] = returnType;
  return headers;
}

/**
 * Build PermaBrain-specific query filters.
 *
 * @param {Object} opts
 * @param {string} [opts.articleKey] - Canonical article key (e.g. 'subject/foo')
 * @param {string} [opts.kind] - Article kind (person, subject, etc.)
 * @param {string} [opts.topic] - Article topic
 * @param {string} [opts.attestationTarget] - Target ID for attestation lookup
 * @param {string} [opts.authorAgentId] - Author agent ID filter
 */
export function buildPermaBrainFilters(opts = {}) {
  const filters = { 'App-Name': 'PermaBrain' };
  if (opts.articleKey) filters['Article-Key'] = opts.articleKey;
  if (opts.kind) filters['Article-Kind'] = opts.kind;
  if (opts.topic) filters['Article-Topic'] = opts.topic;
  if (opts.attestationTarget) filters['Attestation-Target'] = opts.attestationTarget;
  if (opts.authorAgentId) filters['Author-Agent-Id'] = opts.authorAgentId;
  return filters;
}

// ============================================================================
// Lua Script Templates
// ============================================================================

/**
 * PermaBrain consensus Lua script.
 *
 * This script runs as a module on the HyperBEAM Lua device.
 * It computes consensus for an article by:
 * 1. Resolving all attestations via the match device
 * 2. Computing weighted score from valid attestations
 * 3. Returning score, count, and details
 *
 * Lua device API:
 * - ao.get(key) — read a value from the base message
 * - ao.resolve(path) — resolve a path on the node
 * - ao.set(key, value) — set a value in the result
 * - ao.event(msg) — log an event
 */
export const PERMABRAIN_CONSENSUS_LUA = `-- PermaBrain Consensus Device
-- Computes weighted consensus score for articles on HyperBEAM
-- content-type: application/lua

function consensus()
  local target = ao.get("Attestation-Target")
  if not target then
    ao.set("status", "error")
    ao.set("body", "Missing Attestation-Target")
    return { status = "error", body = "Missing Attestation-Target" }
  end

  -- Resolve all attestations for this target via match device
  local matchPath = "~match@1.0/Attestation-Target=" .. target
  local attResult = ao.resolve(matchPath)

  if not attResult or #attResult == 0 then
    ao.set("Consensus-Score", "0")
    ao.set("Consensus-Count", "0")
    ao.set("Consensus-Status", "no-attestations")
    return { status = "ok", score = 0, count = 0 }
  end

  local validScore = 0
  local invalidScore = 0
  local validCount = 0
  local invalidCount = 0

  for _, attId in ipairs(attResult) do
    local valid = ao.get(attId, "Attestation-Valid")
    local confidence = tonumber(ao.get(attId, "Attestation-Confidence") or "0")

    if valid == "valid" then
      validScore = validScore + confidence
      validCount = validCount + 1
    elseif valid == "invalid" then
      invalidScore = invalidScore + confidence
      invalidCount = invalidCount + 1
    end
  end

  local totalCount = validCount + invalidCount
  local netScore = validScore - invalidScore
  local avgScore = totalCount > 0 and (netScore / totalCount) or 0

  ao.set("Consensus-Score", tostring(avgScore))
  ao.set("Consensus-Count", tostring(totalCount))
  ao.set("Consensus-Valid-Count", tostring(validCount))
  ao.set("Consensus-Invalid-Count", tostring(invalidCount))
  ao.set("Consensus-Status", totalCount > 0 and "computed" or "no-attestations")

  ao.event("consensus-computed:" .. target .. ":score=" .. tostring(avgScore))

  return {
    status = "ok",
    score = avgScore,
    count = totalCount,
    validCount = validCount,
    invalidCount = invalidCount
  }
end

function info()
  return {
    status = "ok",
    device = "permabrain-consensus",
    version = "1.0.0",
    functions = { "consensus", "info" }
  }
end
`;

/**
 * PermaBrain query Lua script.
 *
 * Provides structured query capabilities on the HyperBEAM node,
 * wrapping the match and query devices for PermaBrain-specific lookups.
 */
export const PERMABRAIN_QUERY_LUA = `-- PermaBrain Query Device
-- Provides structured PermaBrain queries on HyperBEAM
-- content-type: application/lua

function query()
  local articleKey = ao.get("Article-Key")
  local kind = ao.get("Article-Kind")
  local topic = ao.get("Article-Topic")

  -- Build match query
  local queryPath = "~query@1.0?App-Name=PermaBrain"
  if articleKey then
    queryPath = queryPath .. "&Article-Key=" .. articleKey
  end
  if kind then
    queryPath = queryPath .. "&Article-Kind=" .. kind
  end
  if topic then
    queryPath = queryPath .. "&Article-Topic=" .. topic
  end

  local result = ao.resolve(queryPath)
  ao.set("Query-Result", tostring(#(result or {})))

  return {
    status = "ok",
    results = result or {},
    count = #(result or {})
  }
end

function attestations()
  local target = ao.get("Attestation-Target")
  if not target then
    return { status = "error", body = "Missing Attestation-Target" }
  end

  local matchPath = "~match@1.0/Attestation-Target=" .. target
  local result = ao.resolve(matchPath)

  return {
    status = "ok",
    target = target,
    attestations = result or {},
    count = #(result or {})
  }
end

function info()
  return {
    status = "ok",
    device = "permabrain-query",
    version = "1.0.0",
    functions = { "query", "attestations", "info" }
  }
end
`;