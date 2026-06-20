/**
 * PermaBrain Agent API
 * 
 * Direct programmatic access to PermaBrain for agents.
 * No CLI shelling required — imports the core modules directly.
 * 
 * Usage:
 *   import { api } from './src/agent-api.mjs';
 *   await api.init({ keyType: 'ed25519' });
 *   const result = await api.publish({ content, kind: 'subject', topic: 'ai', sourceUrl: '...', title: 'My Article' });
 *   const articles = await api.query({ topic: 'ai' });
 *   const article = await api.get('subject/my-article');
 *   await api.attest('subject/my-article', { opinion: 'valid', confidence: 0.95, reason: 'Well-sourced' });
 *   const consensus = await api.consensus('subject/my-article');
 *   await api.sync();
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { initState, getHome, loadConfig, defaultConfig } from './config.mjs';
import { loadIndex } from './cache.mjs';
import { ensureIdentity, loadIdentity } from './keys.mjs';
import { publishArticle, queryArticles, getArticle } from './article.mjs';
import { attestArticle } from './attestation.mjs';
import { attestForAgent, provisionAgentIdentity, parseAttestationRequest, processProxyAttestation, buildAttestationRequestBody, listKnownAgents, getKnownAgent } from './multi-agent.mjs';
import { consensusForArticle } from './consensus.mjs';
import { exportBundle, exportAllArticles, importBundle } from './bundle.mjs';
import { exportHistory } from './export-history.mjs';
import { importHistory } from './import-history.mjs';
import { importBundleAutoDetect, importReportToMarkdown, BUNDLE_TYPES } from './import-unified.mjs';
import { publishDirectory, publishDirectoryToMarkdown } from './publish-dir.mjs';
import { forkArticle, listForks } from './fork.mjs';
import { mergeArticles } from './merge.mjs';
import { syncWithMerge } from './sync.mjs';
import { searchArticles } from './search.mjs';
import { topicFeed } from './topic-feed.mjs';
import { activityFeed } from './activity.mjs';
import { listArticles } from './list.mjs';
import { exportArticles } from './export-articles.mjs';
import { computeMetrics, metricsToMarkdown } from './article-metrics.mjs';
import { computeStats, statsToMarkdown } from './stats.mjs';
import { runConfigCommand, configToMarkdown } from './config-manager.mjs';
import { listRemotes, addRemote, removeRemote, setDefaultRemote, probeRemote, queryRemote, syncRemote, remotesToMarkdown, buildRemoteConfig } from './remotes.mjs';
import { archive, restore } from './archive.mjs';
import { createBackup, listBackups, restoreBackup, pruneBackups } from './backup.mjs';
import { renderTemplate, createArticleFromTemplate } from './template.mjs';
import { logAction, queryLog, logToMarkdown, tailLog, exportLog, importLog } from './log.mjs';
import { accessLogResultToMarkdown } from './request-log.mjs';
import { generateCompletion, listSupportedShells } from './completion.mjs';
import { buildReleaseNotes, generateDraftFromGitCommits, validateChangelog as validateReleaseChangelog } from './release-notes.mjs';
import { buildIdentityReport, identityReportToMarkdown, identityReportToHtml } from './identity-report.mjs';
import { buildDashboard, dashboardToHtml, dashboardToMarkdown, writeDashboard, publishDashboard } from './dashboard.mjs';
import { buildAdminPanel, adminPanelToHtml, adminPanelToMarkdown } from './admin-panel.mjs';
import { buildSupportBundle, supportBundleToMarkdown, redactSecrets } from './support-bundle.mjs';
import * as pbcrypto from './crypto.mjs';
import { slugify } from './tags.mjs';
import { validateArticleMetadata, validateAttestationMetadata, validateDataItemTags, formatValidationErrors } from './schema.mjs';
import { getCircuitBreakerStatus, getTransportMetrics } from './transport.mjs';
import {
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
import { subscribeQuery, matchesQueryStream } from './query-stream.mjs';

function requireGoalModule() {
  return import('./goal.mjs');
}

function requireQueryStream() {
  return import('./query-stream.mjs');
}

function requireInit(home) {
  if (!home) throw new Error('PermaBrain not initialized. Call api.init() first.');
}

function deriveTitleFromUrl(url, content) {
  // Try to extract title from content (first heading or first line)
  const headingMatch = content.match(/^#{1,2}\s+(.+)/m);
  if (headingMatch) return headingMatch[1].trim();
  const firstLine = content.split('\n').find(l => l.trim());
  if (firstLine && firstLine.length < 120) return firstLine.trim();
  // Fall back to URL path
  try {
    const pathname = new URL(url).pathname;
    const segments = pathname.split('/').filter(Boolean);
    const last = segments[segments.length - 1] || segments[0] || 'untitled';
    return last.replace(/[-_]/g, ' ').replace(/\.[^.]+$/, '');
  } catch {
    return 'untitled';
  }
}

const api = {
  _home: null,
  _config: null,
  _identity: null,

  /**
   * Initialize PermaBrain. Creates identity and config if needed.
   * @param {Object} [options]
   * @param {string} [options.keyType='arweave-rsa4096'] - Key type: 'ed25519' or 'arweave-rsa4096'
   * @param {string} [options.transport='arweave'] - Transport: 'local', 'hyperbeam', or 'arweave'
   * @param {string} [options.graphqlUrl] - GraphQL URL (for arweave/hyperbeam)
   * @param {string} [options.dataUrl] - Data URL (for arweave/hyperbeam)
   * @param {string} [options.uploadUrl] - Upload URL (for bundler)
   * @returns {Promise<{home, agentId, keyType, config}>}
   */
  async init(options = {}) {
    const keyType = options.keyType || process.env.PERMABRAIN_KEY_TYPE || 'ed25519';
    const env = { ...process.env, PERMABRAIN_KEY_TYPE: keyType };
    if (options.home) env.PERMABRAIN_HOME = options.home;
    const { home, createdConfig } = initState({ env });
    const { identity, created } = await ensureIdentity(home, { keyType });

    // Update config if transport specified
    if (options.transport || options.graphqlUrl) {
      const config = loadConfig(home);
      const transport = options.transport || config.transport || 'arweave';
      if (transport === 'arweave') {
        config.transport = 'arweave';
        config.gateway = {
          type: 'arweave',
          graphqlUrl: options.graphqlUrl || 'https://arweave.net/graphql',
          dataUrl: options.dataUrl || 'https://arweave.net'
        };
        config.bundler = {
          type: 'arweave',
          uploadUrl: options.uploadUrl || 'https://up.arweave.net/tx'
        };
      } else if (transport === 'local') {
        config.transport = 'local';
        config.gateway = { type: 'local' };
        config.bundler = { type: 'local' };
      } else if (transport === 'hyperbeam') {
        const baseUrl = options.dataUrl || process.env.PERMABRAIN_HYPERBEAM_URL || 'http://localhost:10000';
        config.transport = 'hyperbeam';
        config.gateway = {
          type: 'hyperbeam',
          graphqlUrl: options.graphqlUrl || `${baseUrl}/graphql`,
          dataUrl: baseUrl
        };
        config.bundler = {
          type: 'hyperbeam',
          uploadUrl: options.uploadUrl || `${baseUrl}/~bundler@1.0/tx?codec-device=ans104@1.0`
        };
        config.hyperbeam = { ...(config.hyperbeam || {}), references: options.useHyperbeamReference ?? config.hyperbeam?.references ?? false };
      }
      const { statePaths } = await import('./config.mjs');
      const paths = statePaths(home);
      const fs = await import('fs');
      fs.writeFileSync(paths.configPath, JSON.stringify(config, null, 2) + '\n');
    }

    this._home = home;
    this._config = loadConfig(home);
    this._identity = loadIdentity(home);

    return {
      home,
      agentId: this._identity.agentId,
      keyType: this._identity.type,
      config: this._config
    };
  },

  /**
   * Ensure PermaBrain is initialized. If not, init with defaults.
   * @param {Object} [options] - Same as init options
   * @returns {Promise<{home, agentId, keyType}>}
   */
  async ensureInit(options = {}) {
    if (this._home && this._identity) return { home: this._home, agentId: this._identity.agentId, keyType: this._identity.type };
    try {
      const home = getHome();
      loadConfig(home);
      this._home = home;
      this._identity = loadIdentity(home);
      this._config = loadConfig(home);
      return { home: this._home, agentId: this._identity.agentId, keyType: this._identity.type };
    } catch {
      return this.init(options);
    }
  },

  /**
   * Render a template string with variable substitution and optional frontmatter.
   * @param {string} source - Template source (markdown with optional YAML frontmatter)
   * @param {Object} [variables] - Key/value substitutions for {{var}} placeholders
   * @returns {{frontmatter: Object, body: string, rendered: string, variables: Object}}
   */
  renderTemplate(source, variables = {}) {
    return renderTemplate(source, variables);
  },

  /**
   * Publish an article from a template file or inline source.
   *
   * @param {Object} params
   * @param {string} [params.file] - Path to template file
   * @param {string} [params.source] - Inline template source (alternative to file)
   * @param {Object} [params.variables] - Substitution variables
   * @param {string} [params.topic] - Topic override
   * @param {string} [params.kind] - Kind override
   * @param {string} [params.title] - Title override
   * @param {string} [params.key] - Canonical key override
   * @param {string[]} [params.recipients] - X25519 public keys to encrypt for
   * @param {boolean} [params.encrypt=false] - Encrypt the resulting article
   * @param {Object} [params.publishOptions] - Extra options passed to publishArticle
   * @returns {Promise<Object>}
   */
  async template(params = {}) {
    await this.ensureInit();
    requireInit(this._home);
    if (!params.file && !params.source) throw new Error('file or source is required');
    const opts = {
      home: this._home,
      config: this._config,
      identity: this._identity,
      variables: params.variables || {},
      topic: params.topic,
      kind: params.kind,
      title: params.title,
      key: params.key,
      app: params.app,
      sourceUrl: params.sourceUrl,
      encrypt: params.encrypt,
      recipients: params.recipients,
      publishOptions: params.publishOptions || {},
    };
    if (params.source) opts.source = params.source;
    const result = await createArticleFromTemplate(params.file || params.source, opts);
    return result;
  },

  /**
   * Publish an article to PermaBrain.
   * @param {Object} params
   * @param {string} params.content - Article content (markdown)
   * @param {string} params.kind - Article kind: person|subject|event|organization|source|news
   * @param {string} params.topic - Topic category
   * @param {string} params.sourceUrl - Source URL (required)
   * @param {string} [params.title] - Article title (derived from key/file if omitted)
   * @param {string} [params.key] - Canonical key (e.g., "subject/my-article")
   * @param {string} [params.sourceName] - Source display name
   * @param {string} [params.sourceLicense] - License (e.g., "CC BY-SA")
   * @param {string} [params.language] - Language code (default "en")
   * @param {string[]} [params.encryptedFor] - X25519 public keys to encrypt for; if omitted, public plaintext
   * @returns {Promise<{summary: object, reference?: object, encrypted: boolean, encryptionEnvelope?: object}>}
   */
  async publish(params) {
    await this.ensureInit();
    requireInit(this._home);
    const { content, kind, topic, sourceUrl, useHyperbeam, useHyperbeamReference, encryptedFor, visibility, ...rest } = params;
    if (!content) throw new Error('content is required');
    if (!kind) throw new Error('kind is required');
    if (!topic) throw new Error('topic is required');
    if (!sourceUrl) throw new Error('sourceUrl is required');
    const normalizedVisibility = visibility || (encryptedFor?.length ? 'encrypted' : 'public');
    const result = await publishArticle({ content, kind, topic, sourceUrl, useHyperbeam, useHyperbeamReference, encryptedFor, visibility: normalizedVisibility, ...rest, home: this._home });
    return { summary: result.summary, item: result.item, reference: result.reference, encrypted: result.encrypted, encryptionEnvelope: result.encryptionEnvelope };
  },

  /**
   * Query articles by filters.
   * @param {Object} [filters]
   * @param {string} [filters.topic] - Filter by topic
   * @param {string} [filters.kind] - Filter by kind
   * @param {string} [filters.key] - Filter by canonical key
   * @param {string} [filters.sourceName] - Filter by source name
   * @param {string} [filters.sourceUrl] - Filter by source URL
   * @param {boolean} [filters.useHyperbeam] - Use HyperbeamTransport for this query
   * @returns {Promise<Array<{id, key, kind, title, topic, version, sourceName, sourceUrl, contentHash}>>}
   */
  async query(filters = {}) {
    await this.ensureInit();
    requireInit(this._home);
    return queryArticles(filters);
  },

  /**
   * Get an article by canonical key. Fetches from the transport and verifies content hash.
   * @param {string} key - Canonical key (e.g., "subject/my-article")
   * @param {Object} [opts]
   * @param {boolean} [opts.useHyperbeam] - Use HyperbeamTransport for this get
   * @param {string} [opts.decryptSeed] - X25519 seed for decrypting private articles
   * @returns {Promise<{key, title, content, contentHash, version, sourceName, sourceUrl, encrypted: boolean}>}
   */
  async get(key, opts = {}) {
    await this.ensureInit();
    requireInit(this._home);
    if (!key) throw new Error('key is required');
    const result = await getArticle(key, opts);
    return { ...result.summary, content: result.content, encrypted: result.encrypted };
  },

  /**
   * Get an encrypted article and decrypt it.
   *
   * If no `decryptSeed` is provided, automatically derives the author's X25519
   * seed from the current identity (works for ed25519 identities and arweave
   * identities that have an `encryptionSeed`).
   *
   * @param {string} key - Canonical key
   * @param {Object} [opts]
   * @param {boolean} [opts.useHyperbeam]
   * @param {string} [opts.decryptSeed] - X25519 seed (base64url) or Buffer
   * @returns {Promise<{key, title, content, contentHash, version, sourceName, sourceUrl, encrypted: boolean}>}
   */
  async getAndDecrypt(key, opts = {}) {
    await this.ensureInit();
    requireInit(this._home);
    if (!key) throw new Error('key is required');
    let decryptSeed = opts.decryptSeed;
    if (!decryptSeed) {
      decryptSeed = deriveAuthorSeed(this._identity);
    }
    const result = await getArticle(key, { ...opts, decryptSeed });
    return { ...result.summary, content: result.content, encrypted: result.encrypted };
  },

  /**
   * Attest to an article's validity.
   * @param {string} key - Canonical key of the target article
   * @param {Object} params
   * @param {string} params.opinion - One of: valid, invalid, partially-valid, outdated, disputed
   * @param {number} params.confidence - Confidence from 0 to 1
   * @param {string} params.reason - Short explanation for the attestation
   * @param {string} [params.sourceUrl] - Supporting source URL
   * @param {boolean} [params.useHyperbeam] - Use HyperbeamTransport for this attestation
   * @param {boolean} [params.useHyperbeamReference] - Create/update HyperBEAM reference pointer
   * @returns {Promise<{id, targetKey, opinion, confidence, reason}>}
   */
  async attest(key, params = {}) {
    await this.ensureInit();
    requireInit(this._home);
    if (!key) throw new Error('key is required');
    if (!params.opinion) throw new Error('opinion is required');
    if (params.confidence === undefined) throw new Error('confidence is required');
    if (!params.reason) throw new Error('reason is required');
    const { opinion, confidence, reason, sourceUrl, useHyperbeam, useHyperbeamReference, strict } = params;
    const result = await attestArticle({
      key,
      opinion,
      confidence,
      reason,
      sourceUrl: sourceUrl || '',
      useHyperbeam,
      useHyperbeamReference,
      opts: { strict }
    });
    return { summary: result.summary, reference: result.reference };
  },

  /**
   * Get consensus information for an article.
   * @param {string} key - Canonical key
   * @param {Object} [opts]
   * @param {boolean} [opts.useHyperbeam]
   * @returns {Promise<{key, status, score, totalAttestations, opinionCounts, topReasons}>}
   */
  async consensus(key, opts = {}) {
    await this.ensureInit();
    requireInit(this._home);
    if (!key) throw new Error('key is required');
    return consensusForArticle(key, opts);
  },

  /**
   * Probe the configured transport and return health/status info.
   * @param {Object} [opts]
   * @param {boolean} [opts.useHyperbeam] - Force HyperbeamTransport probe
   * @param {string} [opts.url] - Override probe URL
   * @returns {Promise<{ok, url, transport, checks}>}
   */
  async probe(opts = {}) {
    const { probeTransport } = await import('./transport.mjs');
    if (!this._home) {
      const home = getHome();
      try { this._config = loadConfig(home); } catch { this._config = defaultConfig(); }
      this._home = home;
    }
    if (!this._config) {
      try { this._config = loadConfig(this._home); } catch { this._config = defaultConfig(); }
    }
    requireInit(this._home);
    const useHyperbeam = opts.useHyperbeam === true || this._config.transport === 'hyperbeam';
    const baseUrl = opts.url || this._config.gateway?.dataUrl || process.env.PERMABRAIN_HYPERBEAM_URL || 'http://localhost:10000';
    if (useHyperbeam) {
      this._config = { ...this._config, transport: 'hyperbeam', gateway: { ...(this._config.gateway || {}), type: 'hyperbeam', dataUrl: baseUrl, graphqlUrl: `${baseUrl}/graphql` }, bundler: { ...(this._config.bundler || {}), type: 'hyperbeam', uploadUrl: `${baseUrl}/~bundler@1.0/tx?codec-device=ans104@1.0` } };
    }
    return probeTransport(this._config, this._home, { useHyperbeam });
  },

  /**
   * Sync local cache from the transport (Arweave/HyperBEAM).
   *
   * When `opts.autoMerge` is true (the default), divergent article versions
   * sharing a common ancestor are automatically merged via a three-way line
   * merge. Pass `autoMerge: false` to keep the legacy behavior. Use
   * `dryRun: true` to preview what would be merged without publishing.
   *
   * @param {Object} [opts]
   * @param {boolean} [opts.useHyperbeam] - Use HyperbeamTransport for sync
   * @param {boolean} [opts.autoMerge=true] - Auto-merge divergent versions
   * @param {boolean} [opts.dryRun=false] - Preview merges without publishing
   * @returns {Promise<{articleCount, attestationCount, updatedAt, merges, divergences}>}
   */
  async sync(opts = {}) {
    await this.ensureInit();
    requireInit(this._home);
    const result = await syncWithMerge({
      home: this._home,
      config: this._config,
      useHyperbeam: opts.useHyperbeam,
      useHyperbeamReference: opts.useHyperbeamReference,
      autoMerge: opts.autoMerge !== false,
      dryRun: opts.dryRun === true
    });
    return {
      articles: result.articles,
      attestations: result.attestations,
      updatedAt: result.updatedAt,
      articleCount: result.articleCount,
      attestationCount: result.attestationCount,
      merges: result.report.merges,
      divergences: result.report.divergences,
      articlesSynced: result.report.articlesSynced,
      articlesUnchanged: result.report.articlesUnchanged
    };
  },

  /**
   * Inspect transport circuit breaker state.
   * @returns {Object} Map of breaker names to state/status/counters.
   */
  getCircuitBreakerStatus() {
    return getCircuitBreakerStatus();
  },

  /**
   * Get transport metrics: call counts, successes, failures, latency summaries.
   * @returns {Object} Metrics snapshot.
   */
  getTransportStatus() {
    return getTransportMetrics();
  },

  /**
   * Get the local index (no network call).
   * @returns {Promise<{articles, attestations, updatedAt}>}
   */
  async localIndex() {
    await this.ensureInit();
    requireInit(this._home);
    return loadIndex(this._home);
  },

  /**
   * Publish all .md files in a directory as articles.
   *
   * Derives key/topic/kind from frontmatter and relative path. Each file is
   * published independently; failures do not block other files.
   *
   * @param {string} dir - Directory path
   * @param {Object} [opts]
   * @param {boolean} [opts.recursive=false] - Recurse into subdirectories
   * @param {boolean} [opts.dryRun=false] - Preview without publishing
   * @param {string} [opts.topic] - Override topic
   * @param {string} [opts.kind] - Override kind
   * @param {string} [opts.title] - Override title
   * @param {string} [opts.sourceUrl] - Override source URL
   * @param {string} [opts.sourceName] - Override source display name
   * @param {string} [opts.sourceLicense] - Override source license
   * @param {string} [opts.language='en'] - Language code
   * @param {boolean} [opts.useHyperbeam]
   * @param {boolean} [opts.useHyperbeamReference]
   * @param {string[]} [opts.encryptedFor] - X25519 public keys for encrypted publish
   * @param {string} [opts.visibility='public'] - public|encrypted|private
   * @returns {Promise<{dir, recursive, dryRun, count, succeeded, failed, skipped, results}>}
   */
  async publishDirectory(dir, opts = {}) {
    await this.ensureInit();
    requireInit(this._home);
    if (!dir) throw new Error('dir is required');
    const report = await publishDirectory(dir, { ...opts, home: this._home });
    return report;
  },

  /**
   * Render a directory publish report as markdown.
   */
  publishDirectoryToMarkdown(report) {
    return publishDirectoryToMarkdown(report);
  },

  /**
   * Import a Wikipedia article and publish it.
   * @param {Object} params
   * @param {string} params.title - Wikipedia article title
   * @param {string} params.kind - Article kind
   * @param {string} params.topic - Topic category
   * @param {string} [params.language] - Language code (default "en")
   * @returns {Promise<{id, key, kind, title, version}>}
   */
  async importWikipedia(params) {
    await this.ensureInit();
    requireInit(this._home);
    const { importWikipediaArticle } = await import('./wikipedia.mjs');
    const result = await importWikipediaArticle(params);
    return result.summary;
  },

  /**
   * Create an attestation on behalf of an external agent using their identity.
   * The agent's signing key is used — the attestation is directly from them.
   * @param {Object} params
   * @param {Object} params.agentIdentity - Agent identity with signing keys (ed25519 or arweave)
   * @param {string} params.key - Target article key
   * @param {string} params.opinion - Opinion value
   * @param {number} params.confidence - Confidence 0-1
   * @param {string} params.reason - Reason text
   * @param {string} [params.sourceUrl] - Supporting URL
   * @param {string} [params.targetId] - Specific article version ID
   * @returns {Promise<{id, targetKey, targetId, opinion, confidence, reason, agentId}>}
   */
  async attestForAgent(params = {}) {
    await this.ensureInit();
    requireInit(this._home);
    return attestForAgent(params);
  },

  /**
   * Generate a provisional identity for an external agent.
   * Returns the full identity including secret key — store securely.
   * @param {string} agentName - Agent name label
   * @param {Object} [options]
   * @param {string} [options.keyType='ed25519'] - Key type
   * @returns {Promise<{agentId, type, publicKey, secretKey, createdAt, label}>}
   */
  async provisionAgent(agentName, options = {}) {
    await this.ensureInit();
    requireInit(this._home);
    return provisionAgentIdentity(agentName, options);
  },

  /**
   * Process a CAP attestation request as a proxy attestation.
   * Signs with our identity, tags with requester info.
   * @param {Object} request - Parsed request from parseAttestationRequest
   * @returns {Promise<{id, targetKey, targetId, opinion, confidence, reason, agentId, requesterId, requesterFingerprint}>}
   */
  async processProxyAttestation(request) {
    await this.ensureInit();
    requireInit(this._home);
    return processProxyAttestation(request);
  },

  /**
   * Parse a CAP attestation request body.
   * @param {Object} body - Raw request body
   * @param {string} [senderFingerprint] - CAP sender fingerprint
   * @returns {Object} Validated request
   */
  parseAttestationRequest(body, senderFingerprint) {
    return parseAttestationRequest(body, senderFingerprint);
  },

  /**
   * Build a CAP attestation request body for sending to another agent.
   * @param {Object} params
   * @returns {Object} Request body
   */
  buildAttestationRequest(params) {
    return buildAttestationRequestBody(params);
  },

  /**
   * List known external agents (Sage, Relay, etc.).
   * @returns {Array<{id, name, keyId, publicKeyFingerprint}>}
   */
  listKnownAgents() {
    return listKnownAgents();
  },

  /**
   * Get a known agent by name.
   * @param {string} name - Agent name
   * @returns {{id, name, keyId, publicKeyFingerprint}|null}
   */
  getKnownAgent(name) {
    return getKnownAgent(name);
  },

  /**
   * Encrypt content for specific recipients.
   * Uses X25519 ECDH + AES-256-GCM with forward secrecy.
   * @param {string} content - Plaintext content
   * @param {string[]} recipientPublicKeysB64url - X25519 public keys of recipients
   * @returns {Promise<{envelope: object, encryptedPayload: string}>}
   */
  async encrypt(content, recipientPublicKeysB64url) {
    return pbcrypto.encrypt(content, recipientPublicKeysB64url);
  },

  /**
   * Decrypt content as a specific recipient.
   * @param {string|object} encryptedPayload - JSON string or parsed envelope
   * @param {Buffer} recipientSeed - X25519 private key seed (32 bytes)
   * @returns {Promise<{content: string, envelope: object}>}
   */
  async decrypt(encryptedPayload, recipientSeed) {
    return pbcrypto.decrypt(encryptedPayload, recipientSeed);
  },

  /**
   * Check if a payload is an encrypted envelope.
   * @param {string} payload
   * @returns {boolean}
   */
  isEncrypted(payload) {
    return pbcrypto.isEncryptedEnvelope(payload);
  },

  /**
   * List recipient fingerprints from an encrypted envelope.
   * @param {string|object} encryptedPayload
   * @returns {string[]}
   */
  listRecipients(encryptedPayload) {
    return pbcrypto.listRecipients(encryptedPayload);
  },

  /**
   * Generate an X25519 encryption keypair for private article storage.
   * @returns {{type, seed, publicKey, fingerprint}}
   */
  generateEncryptionKeypair() {
    return pbcrypto.generateEncryptionKeypair();
  },

  /**
   * Derive X25519 encryption keypair from an Ed25519 seed.
   * @param {Buffer|string} ed25519Seed - 32-byte seed
   * @returns {{type, seed, publicKey, fingerprint}}
   */
  deriveEncryptionKey(ed25519Seed) {
    return pbcrypto.deriveEncryptionKeyFromEd25519(ed25519Seed);
  },

  /**
   * Batch attest to multiple articles in one call.
   * Each attestation is signed independently — failures don't block others.
   *
   * @param {Object} params
   * @param {Array<{key, opinion, confidence, reason, sourceUrl?, useHyperbeam?}>} params.attestations
   * @param {boolean} [params.useHyperbeam] - Default HyperbeamTransport flag for all attestations
   * @returns {Promise<{results: Array<{key, status: 'ok'|'error', summary?, error?}>, succeeded: number, failed: number}>}
   */
  async batchAttest(params = {}) {
    await this.ensureInit();
    requireInit(this._home);
    if (!params.attestations?.length) throw new Error('attestations array is required');

    const results = [];
    let succeeded = 0, failed = 0;
    const defaultUseHyperbeam = params.useHyperbeam;
    const defaultUseHyperbeamReference = params.useHyperbeamReference;
    for (const att of params.attestations) {
      try {
        if (!att.key) throw new Error('key is required');
        if (!att.opinion) throw new Error('opinion is required');
        if (att.confidence === undefined) throw new Error('confidence is required');
        if (!att.reason) throw new Error('reason is required');

        const result = await attestArticle({
          key: att.key,
          opinion: att.opinion,
          confidence: att.confidence,
          reason: att.reason,
          sourceUrl: att.sourceUrl || '',
          useHyperbeam: att.useHyperbeam ?? defaultUseHyperbeam,
          useHyperbeamReference: att.useHyperbeamReference ?? defaultUseHyperbeamReference
        });
        results.push({ key: att.key, status: 'ok', summary: result.summary, reference: result.reference });
        succeeded++;
      } catch (err) {
        results.push({ key: att.key, status: 'error', error: err.message });
        failed++;
      }
    }

    return { results, succeeded, failed };
  },

  /**
   * Auto-import articles from URLs. Fetches content from each URL,
   * converts to markdown-ish text, and publishes to PermaBrain.
   *
   * @param {Object} params
   * @param {Array<{url, kind, topic, title?, key?}>} params.articles
   * @returns {Promise<{results: Array<{key, status: 'ok'|'error', summary?, error?}>, succeeded: number, failed: number}>}
   */
  async autoImport(params = {}) {
    await this.ensureInit();
    requireInit(this._home);
    if (!params.articles?.length) throw new Error('articles array is required');

    const results = [];
    let succeeded = 0, failed = 0;
    for (const item of params.articles) {
      try {
        if (!item.url) throw new Error('url is required');
        if (!item.kind) throw new Error('kind is required');
        if (!item.topic) throw new Error('topic is required');

        // Fetch content from URL
        const response = await fetch(item.url);
        if (!response.ok) throw new Error(`Fetch failed: ${response.status} ${response.statusText}`);
        const contentType = response.headers.get('content-type') || '';
        let content = await response.text();

        // Basic HTML-to-text stripping if HTML
        if (contentType.includes('html')) {
          content = content
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/p>/gi, '\n\n')
            .replace(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi, (_, t) => `\n## ${t.replace(/<[^>]+>/g, '')}\n`)
            .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, t) => `- ${t.replace(/<[^>]+>/g, '')}\n`)
            .replace(/<[^>]+>/g, '')
            .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
        }

        const title = item.title || deriveTitleFromUrl(item.url, content);
        const key = item.key || `${item.kind}/${slugify(title)}`;

        const result = await publishArticle({
          content,
          kind: item.kind,
          topic: item.topic,
          key,
          title,
          sourceUrl: item.url,
          sourceName: new URL(item.url).hostname,
          sourceLicense: '',
          language: 'en',
          useHyperbeam: item.useHyperbeam ?? params.useHyperbeam,
          useHyperbeamReference: item.useHyperbeamReference ?? params.useHyperbeamReference
        });

        results.push({ key: result.summary.key, status: 'ok', summary: result.summary });
        succeeded++;
      } catch (err) {
        results.push({ key: item.key || item.url, status: 'error', error: err.message });
        failed++;
      }
    }

    return { results, succeeded, failed };
  },

  /**
   * Parse a PRD/goal markdown document into an ordered implementation plan.
   * @param {string} text - Markdown content
   * @param {Object} [opts]
   * @param {string[]} [opts.kinds] - Override inferred article kinds
   * @param {string[]} [opts.topics] - Override inferred topics
   * @returns {Promise<Object>} Parsed goal structure
   */
  async parseGoal(text, opts = {}) {
    const { parseGoal } = await requireGoalModule();
    return parseGoal(text, opts);
  },

  /**
   * Build a PermaBrain plan object from parsed goal output.
   * @param {Object} parsed - Output of parseGoal
   * @param {Object} [opts]
   * @param {string} [opts.topic] - Override topic
   * @param {string} [opts.kind] - Override kind
   * @returns {Promise<Object>} Plan with steps, import/publish articles, and attestations
   */
  async planFromGoal(parsed, opts = {}) {
    const { planFromGoal: buildPlan } = await requireGoalModule();
    return buildPlan(parsed, opts);
  },

  /**
   * Parse a PRD/goal file and generate a plan in one call.
   * @param {string} filePath
   * @param {Object} [opts]
   * @returns {Promise<Object>} Plan object
   */
  async goalFromFile(filePath, opts = {}) {
    const { parseGoalFile, planFromGoal: buildPlan } = await requireGoalModule();
    return buildPlan(parseGoalFile(filePath, opts), opts);
  },

  /**
   * Generate auto-import article specs from a parsed goal.
   * @param {Object} parsed
   * @param {Object} [opts]
   * @param {string} [opts.topic] - Override topic
   * @param {string} [opts.kind] - Override kind
   * @returns {Promise<Array<{url, kind, topic, title, key}>>}
   */
  async importArticlesFromGoal(parsed, opts = {}) {
    const { importArticlesFromGoal: extract } = await requireGoalModule();
    return extract(parsed, opts);
  },

  /**
   * Generate batch attestation specs from a parsed goal.
   * @param {Object} parsed
   * @param {Object} [opts]
   * @param {string} [opts.topic] - Override topic
   * @param {string} [opts.kind] - Override kind
   * @returns {Promise<Array<{key, opinion, confidence, reason}>>}
   */
  async attestationsFromGoal(parsed, opts = {}) {
    const { attestationsFromGoal: extract } = await requireGoalModule();
    return extract(parsed, opts);
  },

  /**
   * Validate article or attestation tag metadata against the built-in JSON
   * Schema. Useful for import pipelines and pre-flight checks.
   *
   * @param {Object} tagsObject - Object mapping tag names to string values
   * @param {Object} [opts]
   * @param {'article'|'attestation'} [opts.type='article']
   * @returns {{valid: boolean, errors: Array<{path:string, message:string}>}}
   */
  validateMetadata(tagsObject, opts = {}) {
    if (!tagsObject || typeof tagsObject !== 'object') throw new Error('tagsObject is required');
    const type = opts.type === 'attestation' ? 'attestation' : 'article';
    const result = type === 'attestation' ? validateAttestationMetadata(tagsObject) : validateArticleMetadata(tagsObject);
    return { ...result, type };
  },

  /**
   * Validate a published DataItem's tags without uploading.
   *
   * @param {Object} dataItem - Object with a `tags` array
   * @param {Object} [opts]
   * @param {'article'|'attestation'} [opts.type='article']
   * @returns {{valid: boolean, errors: Array, type: string}}
   */
  validateDataItem(dataItem, opts = {}) {
    if (!dataItem || !Array.isArray(dataItem.tags)) throw new Error('dataItem.tags is required');
    const type = opts.type === 'attestation' ? 'attestation' : 'article';
    const result = validateDataItemTags(dataItem, type);
    return { ...result, type };
  },

  /**
   * Get full version chain + attestation timeline for a canonical article key.
   * @param {string} key - Canonical key
   * @param {Object} [opts]
   * @param {boolean} [opts.useHyperbeam]
   * @param {boolean} [opts.includeConsensus]
   * @returns {Promise<{key, versionCount, versions, attestationCount, attestations, timeline, consensus}>}
   */
  async history(key, opts = {}) {
    await this.ensureInit();
    requireInit(this._home);
    if (!key) throw new Error('key is required');
    const { historyForKey } = await import('./history.mjs');
    return historyForKey(key, { ...opts, home: this._home });
  },

  /**
   * Verify a DataItem or article by ID or canonical key.
   * @param {string} idOrKey - DataItem ID or canonical article/attestation key (e.g., "subject/foo")
   * @param {Object} [opts]
   * @param {boolean} [opts.useHyperbeam]
   * @param {boolean} [opts.includeAttestations] - Include consensus summary for articles
   * @returns {Promise<{id, valid, type, checks, article?, attestation?, consensus?}>}
   */
  async verify(idOrKey, opts = {}) {
    await this.ensureInit();
    requireInit(this._home);
    if (!idOrKey) throw new Error('idOrKey is required');
    const { verifyByKey, verifyDataItemById } = await import('./verify.mjs');
    const isKey = idOrKey.includes('/');
    return isKey ? verifyByKey(idOrKey, { ...opts, home: this._home }) : verifyDataItemById(idOrKey, { ...opts, home: this._home });
  },

  /**
   * Export an article bundle (versions + attestations) by key or DataItem ID.
   * @param {Object} [opts]
   * @param {string} [opts.key]
   * @param {string} [opts.id]
   * @param {boolean} [opts.includeAttestations]
   * @param {boolean} [opts.includeVersions]
   * @returns {Promise<Object>} Bundle object
   */
  async exportBundle(opts = {}) {
    await this.ensureInit();
    requireInit(this._home);
    return exportBundle({ ...opts, transport: opts.useHyperbeam ?? false, home: this._home });
  },

  /**
   * Export all indexed articles and attestations as a bundle.
   * @param {Object} [opts]
   * @param {boolean} [opts.includeAttestations]
   * @returns {Promise<Object>} Bundle object
   */
  async exportAll(opts = {}) {
    await this.ensureInit();
    requireInit(this._home);
    return exportAllArticles({ includeAttestations: opts.includeAttestations ?? true, transport: opts.useHyperbeam ?? false, home: this._home });
  },

  /**
   * Export the full version chain + attestations for a single article key.
   *
   * Produces a deterministic bundle (articles sorted by version ascending,
   * attestations sorted by DataItem ID) that can be imported by another
   * PermaBrain node via importBundle(). Each entry is a raw, signed ANS-104
   * DataItem.
   *
   * @param {string} key - Canonical article key
   * @param {Object} [opts]
   * @param {boolean} [opts.useHyperbeam]
   * @param {boolean} [opts.verify=true] - Verify each DataItem signature before bundling
   * @returns {Promise<Object>} History bundle
   */
  async exportHistory(key, opts = {}) {
    await this.ensureInit();
    requireInit(this._home);
    if (!key) throw new Error('key is required');
    return exportHistory(key, { ...opts, home: this._home });
  },

  /**
   * Import articles and attestations from a PermaBrain bundle.
   * @param {Object} bundle
   * @param {Object} [opts]
   * @param {boolean} [opts.verify] - Verify signatures (default true)
   * @param {boolean} [opts.skipDuplicates] - Skip existing items (default true)
   * @returns {Promise<Array<{type, key, id, ok, imported, note, error}>>}
   */
  async importBundle(bundle, opts = {}) {
    await this.ensureInit();
    requireInit(this._home);
    return importBundle(bundle, { ...opts, transport: opts.useHyperbeam ?? false, home: this._home });
  },

  /**
   * Import a history bundle produced by exportHistory() into the local store.
   *
   * Preserves version ordering, updates the local cache index, skips
   * duplicates, and verifies each DataItem signature by default.  Returns a
   * structured report with per-entry results and import counts.
   *
   * @param {Object} bundle - History bundle
   * @param {Object} [opts]
   * @param {boolean} [opts.verify=true] - Verify DataItem signatures
   * @param {boolean} [opts.skipDuplicates=true] - Skip already-present items
   * @param {boolean} [opts.useHyperbeam]
   * @returns {Promise<{ok, meta, importedArticles, importedAttestations, skippedArticles, skippedAttestations, failed, results}>}
   */
  async importHistory(bundle, opts = {}) {
    await this.ensureInit();
    requireInit(this._home);
    return importHistory(bundle, { ...opts, home: this._home });
  },

  /**
   * Import a bundle/envelope/share, auto-detecting its type and routing to the
   * correct importer. Detects article bundle, history bundle, threshold envelope,
   * and encrypted share formats. Supports dry-run previews, conflict/skip
   * reporting, and optional threshold finalization / encrypted-share publish.
   *
   * @param {Object|string} input - Bundle object or JSON file path.
   * @param {Object} [opts]
   * @param {boolean} [opts.dryRun=false]
   * @param {boolean} [opts.verify=true]
   * @param {boolean} [opts.skipDuplicates=true]
   * @param {boolean} [opts.finalize=false] - Finalize threshold envelopes that meet threshold.
   * @param {string|Uint8Array} [opts.seed] - X25519 seed for encrypted shares.
   * @param {boolean} [opts.publish=true] - Publish decrypted encrypted-share content as local article.
   * @param {boolean} [opts.useHyperbeam]
   * @returns {Promise<Object>} Import report.
   */
  async importBundleAutoDetect(input, opts = {}) {
    await this.ensureInit();
    requireInit(this._home);
    return importBundleAutoDetect(input, { ...opts, home: this._home });
  },

  /**
   * Alias for importBundleAutoDetect.
   */
  async importBundle(input, opts = {}) {
    await this.ensureInit();
    requireInit(this._home);
    return importBundleAutoDetect(input, { ...opts, home: this._home });
  },

  /**
   * Render an import report as markdown.
   */
  importReportToMarkdown(report) {
    return importReportToMarkdown(report);
  },

  /** Threshold attestation constants. */
  BUNDLE_TYPES,

  /**
   * Fork an existing article into a new canonical key.
   *
   * The fork copies source metadata/content and applies supplied edits,
   * then publishes a new DataItem starting its own version chain at v1.
   * Fork lineage is recorded via Article-Fork-Of and Article-Fork-Source-Id tags.
   *
   * @param {string} key - Source canonical key
   * @param {Object} [edits]
   * @param {string} [edits.key] - Explicit fork canonical key (must differ from source)
   * @param {string} [edits.slug] - Slug suffix used to derive fork key
   * @param {string} [edits.title]
   * @param {string} [edits.content]
   * @param {string} [edits.topic]
   * @param {string} [edits.kind]
   * @param {string} [edits.sourceUrl]
   * @param {string} [edits.sourceName]
   * @param {string} [edits.sourceLicense]
   * @param {string} [edits.language]
   * @param {Object} [opts]
   * @param {boolean} [opts.useHyperbeam]
   * @param {boolean} [opts.useHyperbeamReference]
   * @param {string} [opts.targetId] - Fork a specific source version
   * @returns {Promise<{source: object, fork: object, forkKey: string, editsApplied: string[], item: object, reference?: object}>}
   */
  async fork(key, edits = {}, opts = {}) {
    await this.ensureInit();
    requireInit(this._home);
    if (!key) throw new Error('key is required');
    return forkArticle(key, edits, { ...opts, home: this._home });
  },

  /**
   * List forks of a source article.
   * @param {string} key - Source canonical key
   * @param {Object} [opts]
   * @param {boolean} [opts.useHyperbeam]
   * @returns {Promise<Array<{id, key, title, kind, topic, forkedAt, sourceVersion, version}>>}
   */
  async listForks(key, opts = {}) {
    await this.ensureInit();
    requireInit(this._home);
    if (!key) throw new Error('key is required');
    return listForks(key, { ...opts, home: this._home });
  },

  /**
   * Merge a source article fork into a target article's version branch.
   *
   * Performs a three-way line-level merge, auto-merges non-conflicting
   * changes, marks conflicts with standard conflict markers, publishes a new
   * target version with merge provenance tags, and optionally carries forward
   * source attestations to the new merged version.
   *
   * @param {string} targetKey - Canonical key receiving the merge
   * @param {string} sourceKey - Canonical key being merged in
   * @param {Object} [opts]
   * @param {boolean} [opts.useHyperbeam]
   * @param {boolean} [opts.useHyperbeamReference]
   * @param {string} [opts.title] - Override merged title
   * @param {string} [opts.topic] - Override merged topic
   * @param {string} [opts.kind] - Override merged kind
   * @param {string} [opts.sourceUrl] - Override merged source URL
   * @param {string} [opts.sourceName] - Override merged source name
   * @param {string} [opts.sourceLicense] - Override merged source license
   * @param {string} [opts.language] - Override merged language
   * @param {boolean} [opts.carryAttestations=true] - Re-attest source attestations to the merged version
   * @returns {Promise<{target: object, source: object, ancestor: object|null, merged: object, mergedContent: string, hasConflicts: boolean, conflictCount: number, editsApplied: string[], carriedAttestations: object[], item: object, reference?: object}>}
   */
  async merge(targetKey, sourceKey, opts = {}) {
    await this.ensureInit();
    requireInit(this._home);
    if (!targetKey) throw new Error('targetKey is required');
    if (!sourceKey) throw new Error('sourceKey is required');
    return mergeArticles(targetKey, sourceKey, { ...opts, home: this._home });
  },

  /**
   * Diff two article versions or compare local vs remote.
   *
   * Accepts:
   *   - two DataItem IDs (base, head)
   *   - two canonical keys (latest of each)
   *   - a single canonical key with opts.local = true for local-vs-remote
   *
   * Emits a unified-diff or JSON report, plus an optional three-way conflict
   * preview when a common ancestor can be resolved.
   *
   * @param {string} base - Base DataItem ID or canonical key
   * @param {string} head - Head DataItem ID or canonical key (omit for local-vs-remote)
   * @param {Object} [opts]
   * @param {boolean} [opts.useHyperbeam]
   * @param {boolean} [opts.local=false] - Compare local cached version against remote latest
   * @param {string} [opts.format='unified'] - 'unified' or 'json'
   * @param {number} [opts.context=3] - Context lines around each hunk
   * @param {boolean} [opts.preview=true] - Include three-way conflict preview when possible
   * @returns {Promise<{base: object, head: object, ancestor?: object, format: string, changes: number, additions: number, deletions: number, hunks: object[], text: string, conflictPreview?: object}>}
   */
  async diff(base, head, opts = {}) {
    await this.ensureInit();
    requireInit(this._home);
    if (!base) throw new Error('base identifier is required');
    const { diffArticles, diffLocalVsRemote } = await import('./diff.mjs');
    if (base.includes('/') && (!head || opts.local)) {
      return diffLocalVsRemote(base, { ...opts, home: this._home });
    }
    if (!head) throw new Error('head identifier is required (or use opts.local)');
    return diffArticles(base, head, { ...opts, home: this._home });
  },

  /**
   * Get a working-state overview for the PermaBrain node.
   *
   * Reports local articles, remote latest versions, pending sync
   * divergences, fork heads, merge/conflict status, transport health,
   * circuit breakers, and transport metrics.
   *
   * @param {Object} [opts]
   * @param {boolean} [opts.useHyperbeam]
   * @returns {Promise<Object>} Status report
   */
  async status(opts = {}) {
    await this.ensureInit();
    requireInit(this._home);
    const { status } = await import('./status.mjs');
    return status({ ...opts, home: this._home, config: this._config });
  },

  /**
   * Search articles by query, kind, topic, author, or date range.
   *
   * Performs full-text scoring across titles, topics, keys, source names,
   * and plaintext content. Encrypted articles are returned when their metadata
   * matches but their content is not searchable. Results may be boosted by a
   * consensus map supplied in opts.consensusByKey.
   *
   * @param {string} query - Free-text search terms
   * @param {Object} [opts]
   * @param {string} [opts.kind] - Article kind filter
   * @param {string} [opts.topic] - Topic filter
   * @param {string} [opts.author] - Author agent id filter
   * @param {string} [opts.key] - Exact canonical key filter
   * @param {string} [opts.after] - ISO date lower bound
   * @param {string} [opts.before] - ISO date upper bound
   * @param {number} [opts.limit=20] - Maximum results to return
   * @param {number} [opts.offset=0] - Pagination offset
   * @param {boolean} [opts.useHyperbeam]
   * @param {Object} [opts.consensusByKey] - Optional map from key to consensus score
   * @returns {Promise<{query, total, limit, offset, results: object[], took}>}
   */
  async search(query, opts = {}) {
    await this.ensureInit();
    requireInit(this._home);
    if (!query) throw new Error('query is required');
    return searchArticles(query, { ...opts, home: this._home });
  },

  async topicFeed(topic, opts = {}) {
    await this.ensureInit();
    requireInit(this._home);
    if (!topic) throw new Error('topic is required');
    return topicFeed(topic, { ...opts, home: this._home });
  },

  /**
   * Get a chronological activity feed combining publish, attest, fork, and
   * merge events.
   *
   * @param {Object} [opts]
   * @param {string} [opts.topic] - Filter by article topic
   * @param {string} [opts.kind] - Filter by article kind
   * @param {string} [opts.key] - Filter by canonical key (or attestation target key)
   * @param {string|string[]} [opts.agent] - Filter by any participating agent
   * @param {string|string[]} [opts.author] - Filter publish events by author agent
   * @param {string|string[]} [opts.attestedBy] - Filter by attesting agent
   * @param {string|string[]} [opts.eventKind] - Filter by event kind: publish, attest, fork, merge
   * @param {string} [opts.after] - ISO timestamp lower bound
   * @param {string} [opts.before] - ISO timestamp upper bound
   * @param {string} [opts.order='desc'] - 'asc' or 'desc'
   * @param {number} [opts.limit=100]
   * @param {number} [opts.offset=0]
   * @param {boolean} [opts.useHyperbeam]
   * @returns {Promise<{total, limit, offset, order, filters, events, took}>}
   */
  async activity(opts = {}) {
    await this.ensureInit();
    requireInit(this._home);
    return activityFeed({ ...opts, home: this._home });
  },

  /**
   * List articles as a paginated directory.
   *
   * Filters by kind, topic, author, and date range; sorts by date, title,
   * consensus, or attestation count; returns attestations and activity
   * counts per article.
   *
   * @param {Object} [opts]
   * @param {string} [opts.kind]
   * @param {string} [opts.topic]
   * @param {string} [opts.author]
   * @param {string} [opts.after]
   * @param {string} [opts.before]
   * @param {string} [opts.sort='date'] - 'date'|'updated'|'title'|'consensus'|'attestations'|'key'
   * @param {number} [opts.limit=50]
   * @param {number} [opts.offset=0]
   * @param {boolean} [opts.useHyperbeam]
   * @returns {Promise<{total, limit, offset, sort, filters, articles, took}>}
   */
  async listArticles(opts = {}) {
    await this.ensureInit();
    requireInit(this._home);
    return listArticles({ ...opts, home: this._home });
  },

  /**
   * Export a filtered, sorted article directory.
   *
   * Reuses listArticles() so all filters, sorting, pagination, and counts
   * are available. Output can be JSON (default) or markdown.
   *
   * @param {Object} [opts]
   * @param {string} [opts.format='json'] - 'json' or 'markdown'
   * @param {string} [opts.kind]
   * @param {string} [opts.topic]
   * @param {string} [opts.author]
   * @param {string} [opts.after]
   * @param {string} [opts.before]
   * @param {string} [opts.sort='date']
   * @param {number} [opts.limit=50]
   * @param {number} [opts.offset=0]
   * @param {boolean} [opts.useHyperbeam]
   * @returns {Promise<{format, total, limit, offset, sort, filters, articles?, markdown?, took}>}
   */
  async exportArticles(opts = {}) {
    await this.ensureInit();
    requireInit(this._home);
    return exportArticles({ ...opts, home: this._home });
  },

  /**
   * Manage PermaBrain configuration.
   *
   * @param {Object} params
   * @param {string} [params.action='get'] - get|set|validate|env|reset
   * @param {string} [params.path]
   * @param {string} [params.value]
   * @returns {Promise<Object>}
   */
  async config(params = {}) {
    await this.ensureInit();
    requireInit(this._home);
    const action = params.action || 'get';
    const result = runConfigCommand({ action, path: params.path, value: params.value, home: this._home });
    if (params.markdown) {
      return { ...result, markdown: configToMarkdown(result.config || this._config, result.sources || {}) };
    }
    return result;
  },

  /**
   * Compute aggregate article/attestation metrics from the local cache.
   *
   * @param {Object} [opts]
   * @param {string} [opts.kind] - Filter by article kind
   * @param {string} [opts.topic] - Filter by topic
   * @param {string} [opts.author] - Filter by author agent id
   * @param {string} [opts.after] - ISO date lower bound
   * @param {string} [opts.before] - ISO date upper bound
   * @param {number} [opts.top=10] - Number of top-attested articles to include
   * @returns {Promise<Object>} Metrics report
   */
  async metrics(opts = {}) {
    await this.ensureInit();
    requireInit(this._home);
    return computeMetrics({ ...opts, home: this._home });
  },

  /**
   * Compute dashboard-style aggregate stats from the local cache.
   *
   * Adds agents, topics, kinds, consensus score distribution, active
   * windows, and an activity timeline on top of the base metrics.
   *
   * @param {Object} [opts]
   * @param {string} [opts.kind] - Filter by article kind
   * @param {string} [opts.topic] - Filter by topic
   * @param {string} [opts.author] - Filter by author agent id
   * @param {string} [opts.after] - ISO date lower bound
   * @param {string} [opts.before] - ISO date upper bound
   * @param {number} [opts.top=10] - Number of top entries to include
   * @returns {Promise<Object>} Stats dashboard report
   */
  async stats(opts = {}) {
    await this.ensureInit();
    requireInit(this._home);
    return computeStats({ ...opts, home: this._home });
  },

  /**
   * Manage named remote endpoints.
   *
   * Actions: list, add, remove, default, probe, query, sync.
   *
   * @param {string} action
   * @param {Object} [params]
   * @param {string} [params.name]
   * @param {string} [params.url]
   * @param {string} [params.transport]
   * @returns {Promise<Object>}
   */
  async remote(action, params = {}) {
    await this.ensureInit();
    requireInit(this._home);
    const home = this._home;
    if (action === 'list') return listRemotes(home);
    if (action === 'add') return addRemote(params.name, params, home);
    if (action === 'remove' || action === 'rm') return removeRemote(params.name, home);
    if (action === 'default') return setDefaultRemote(params.name, home);
    if (action === 'probe') return probeRemote(params.name, home);
    if (action === 'query') return queryRemote(params.name, params.filters || {}, home);
    if (action === 'sync') return syncRemote(params.name, params, home);
    throw new Error(`Unknown remote action: ${action}`);
  },

  /**
   * Create an encrypted archive snapshot of this PermaBrain home.
   *
   * @param {Object} [opts]
   * @param {string} [opts.passphrase] - Passphrase for self-contained restore
   * @param {string[]} [opts.recipients] - Extra X25519 public keys to encrypt for
   * @returns {Promise<Object>} Archive object
   */
  async archive(opts = {}) {
    await this.ensureInit();
    requireInit(this._home);
    return archive({ ...opts, home: this._home });
  },

  /**
   * Restore a PermaBrain home from an encrypted archive snapshot.
   *
   * @param {Object} archiveObj
   * @param {Object} [opts]
   * @param {string} [opts.home] - Target home directory (default this._home)
   * @param {string} [opts.passphrase]
   * @param {string|Buffer} [opts.seed]
   * @param {boolean} [opts.dryRun=false]
   * @returns {Promise<Object>} Restore report
   */
  async restore(archiveObj, opts = {}) {
    await this.ensureInit();
    requireInit(this._home);
    return restore(archiveObj, { ...opts, home: opts.home || this._home });
  },

  /**
   * Create a timestamped encrypted backup of this PermaBrain home.
   *
   * @param {Object} [opts]
   * @param {string} [opts.passphrase]
   * @param {string[]} [opts.recipients]
   * @param {string} [opts.name]
   * @returns {Promise<Object>}
   */
  async backup(opts = {}) {
    await this.ensureInit();
    requireInit(this._home);
    return createBackup(this._home, opts);
  },

  /**
   * List stored backups for this PermaBrain home.
   * @returns {Array<Object>}
   */
  listBackups() {
    requireInit(this._home);
    return listBackups(this._home);
  },

  /**
   * Restore this PermaBrain home from a stored backup.
   *
   * @param {Object} opts
   * @param {string} opts.backup - Filename or 1-based index
   * @param {string} [opts.passphrase]
   * @param {string|Buffer} [opts.seed]
   * @param {boolean} [opts.dryRun=false]
   * @returns {Promise<Object>}
   */
  async restoreBackup(opts) {
    await this.ensureInit();
    requireInit(this._home);
    if (!opts?.backup) throw new Error('backup is required (filename or 1-based index)');
    return restoreBackup(this._home, opts);
  },

  /**
   * Prune old backups, keeping the newest N and/or deleting older than maxAgeDays.
   *
   * @param {Object} [opts]
   * @param {number} [opts.keep=10]
   * @param {number} [opts.maxAgeDays]
   * @param {boolean} [opts.dryRun=false]
   * @returns {{kept: Array<Object>, removed: Array<Object>}}
   */
  pruneBackups(opts = {}) {
    requireInit(this._home);
    return pruneBackups(this._home, opts);
  },

  /**
   * Start the local HTTP API server.
   *
   * @param {Object} [opts]
   * @param {number} [opts.port=8765] - HTTP port (also PERMABRAIN_PORT)
   * @param {string} [opts.home] - PermaBrain home directory
   * @returns {Promise<{server, home, port, agentId}>}
   */
  async serve(opts = {}) {
    await this.ensureInit();
    requireInit(this._home);
    const { startServer } = await import('./serve.mjs');
    return startServer({ ...opts, home: this._home });
  },

  /**
   * Return a real-time event stream for the local node.
   *
   * Events are generated from the audit log (publish, attest, fork, merge,
   * import, export, backup, init, etc.) and optionally from explicit server
   * broadcasts. Yields structured event objects with name, timestamp,
   * and action metadata. Heartbeat events are emitted periodically.
   *
   * @param {Object} [opts]
   * @param {string[]} [opts.events] - Filter by event name(s); omit for all
   * @param {number} [opts.heartbeatMs=30000]
   * @param {AbortSignal} [opts.signal]
   * @returns {{[Symbol.asyncIterator]: function, cancel: function}}
   */
  events(opts = {}) {
    requireInit(this._home);
    return import('./events.mjs').then(({ subscribeEvents }) => subscribeEvents(opts));
  },

  /**
   * Subscribe to real-time events from a remote `permabrain serve` instance.
   *
   * @param {Object} [opts]
   * @param {string} [opts.baseUrl='http://localhost:8765']
   * @param {'sse'|'ws'} [opts.transport='sse']
   * @param {string|string[]} [opts.events]
   * @param {number} [opts.heartbeatMs=30000]
   * @param {AbortSignal} [opts.signal]
   * @returns {{[Symbol.asyncIterator]: function, cancel: function}}
   */
  subscribeEventsRemote(opts = {}) {
    return import('./events-client.mjs').then(({ subscribeEventsRemote }) => subscribeEventsRemote(opts));
  },

  /**
   * Forward local real-time events to a remote PermaBrain peer.
   *
   * This is the publisher mirror of `subscribeEventsRemote()`: it listens
   * to the local event bus and POSTs matching audit events to the remote
   * `POST /api/v1/events/publish` endpoint.
   *
   * @param {Object} [opts]
   * @param {string} [opts.baseUrl='http://localhost:8765']
   * @param {string|string[]} [opts.events]
   * @param {number} [opts.batchMs=50]
   * @param {string|Object} [opts.authHeader]
   * @param {AbortSignal} [opts.signal]
   * @returns {{[Symbol.asyncIterator]: function, cancel: function, push: function, flush: function}}
   */
  subscribe(opts = {}) {
    requireInit(this._home);
    return import('./subscribe.mjs').then(({ forwardEvents }) => forwardEvents(opts));
  },

  /**
   * Validate and optionally repair the local PermaBrain state.
   *
   * @param {Object} [opts]
   * @param {boolean} [opts.fix=false] - Attempt safe auto-repairs
   * @param {boolean} [opts.markdown=false] - Include markdown report
   * @returns {Promise<Object>} Doctor report
   */
  async doctor(opts = {}) {
    await this.ensureInit();
    requireInit(this._home);
    const { runDoctor, doctorReportToMarkdown } = await import('./doctor.mjs');
    const report = await runDoctor(this._home, { fix: opts.fix === true });
    if (opts.markdown) {
      return { ...report, markdown: doctorReportToMarkdown(report) };
    }
    return report;
  },

  /**
   * Record a local audit-log event.
   *
   * @param {Object} opts
   * @param {string} opts.action - Action name, e.g. 'publish', 'attest', 'fork'.
   * @param {string} [opts.status='ok'] - 'ok' | 'error' | 'pending'.
   * @param {string} [opts.key] - Article key, if any.
   * @param {string} [opts.id] - DataItem/id, if any.
   * @param {string} [opts.message] - Human-readable summary.
   * @param {Object} [opts.details] - Structured metadata.
   * @returns {Object} The written log entry.
   */
  auditLog(opts = {}) {
    requireInit(this._home);
    return logAction({ ...opts, home: this._home });
  },

  /**
   * Query the local HTTP access/request log persisted by `permabrain serve`.
   *
   * @param {Object} [opts]
   * @param {string} [opts.method] - Filter by HTTP method
   * @param {number} [opts.status] - Filter by response status code
   * @param {string} [opts.path] - Path substring filter
   * @param {string} [opts.after] - ISO date lower bound
   * @param {string} [opts.before] - ISO date upper bound
   * @param {number} [opts.limit=100]
   * @param {number} [opts.offset=0]
   * @returns {Promise<{total, offset, limit, entries}>}
   */
  async accessLog(opts = {}) {
    await this.ensureInit();
    requireInit(this._home);
    const { requestLogger } = await import('./request-log.mjs');
    const logger = requestLogger({ format: 'none', home: this._home });
    return logger.queryDisk(opts);
  },

  /**
   * Render access-log query results as markdown.
   *
   * @param {Object} result - Result from `api.accessLog()`.
   * @returns {string}
   */
  accessLogToMarkdown(result) {
    return accessLogResultToMarkdown(result);
  },

  /**
   * Build a consolidated, read-only admin/monitoring snapshot.
   *
   * Aggregates runtime metrics, recent HTTP access-log entries, and the
   * audit-log tail. Intended for a single `/admin` endpoint view.
   *
   * @param {Object} [opts]
   * @param {number} [opts.accessLogLimit=25]
   * @param {number} [opts.auditLogLimit=25]
   * @param {Object} [opts.metricsFilters]
   * @returns {Promise<Object>} Admin panel data
   */
  async adminPanel(opts = {}) {
    await this.ensureInit();
    requireInit(this._home);
    return buildAdminPanel({ ...opts, home: this._home });
  },

  /**
   * Render admin panel data to a self-contained HTML string.
   *
   * @param {Object} data - Output of api.adminPanel()
   * @param {Object} [opts]
   * @param {string} [opts.title]
   * @returns {string} HTML
   */
  adminPanelHTML(data, opts = {}) {
    return adminPanelToHtml(data, opts);
  },

  /**
   * Render admin panel data as markdown.
   *
   * @param {Object} data - Output of api.adminPanel()
   * @param {Object} [opts]
   * @param {string} [opts.title]
   * @returns {string} Markdown
   */
  adminPanelMarkdown(data, opts = {}) {
    return adminPanelToMarkdown(data, opts);
  },

  /**
   * Build a self-contained support/diagnostics bundle.
   *
   * Collects package version, local config (secrets redacted), public
   * identity metadata, index summary, recent audit/access logs, runtime
   * metrics, registered routes, transport health, and environment variable
   * names. Useful for troubleshooting and cross-node comparisons.
   *
   * @param {Object} [opts]
   * @param {number} [opts.auditLogLimit=50]
   * @param {number} [opts.accessLogLimit=50]
   * @param {Object} [opts.metricsFilters]
   * @param {boolean} [opts.markdown=false] - Also return markdown rendering
   * @param {boolean} [opts.redact=true] - Redact secret fields
   * @returns {Promise<Object>} Support bundle data
   */
  async supportBundle(opts = {}) {
    await this.ensureInit();
    requireInit(this._home);
    const bundle = await buildSupportBundle({ ...opts, home: this._home });
    if (opts.markdown) {
      return { ...bundle, markdown: supportBundleToMarkdown(bundle) };
    }
    return bundle;
  },

  /**
   * Render a support bundle to markdown.
   *
   * @param {Object} data - Output of api.supportBundle()
   * @returns {string} Markdown
   */
  supportBundleMarkdown(data) {
    return supportBundleToMarkdown(data);
  },

  /**
   * Tail the local HTTP access/request log.
   *
   * @param {Object} [opts]
   * @param {number} [opts.limit=10]
   * @returns {Promise<{total, offset, limit, entries}>}
   */
  async tailAccessLog(opts = {}) {
    await this.ensureInit();
    requireInit(this._home);
    const { requestLogger } = await import('./request-log.mjs');
    const logger = requestLogger({ format: 'none', home: this._home });
    return logger.queryDisk({ limit: opts.limit || 10, offset: 0, ...opts });
  },

  /**
   * Query the local audit log.
   *
   * @param {Object} [opts]
   * @param {string|string[]} [opts.action]
   * @param {string|string[]} [opts.status]
   * @param {string|string[]} [opts.key]
   * @param {string|string[]} [opts.agentId]
   * @param {string} [opts.after]
   * @param {string} [opts.before]
   * @param {string} [opts.order='desc']
   * @param {number} [opts.limit=50]
   * @param {number} [opts.offset=0]
   * @param {string} [opts.search]
   * @param {boolean} [opts.markdown=false]
   * @returns {Object}
   */
  log(opts = {}) {
    requireInit(this._home);
    return queryLog({ ...opts, home: this._home });
  },

  /**
   * Render audit log results as markdown.
   *
   * @param {Object} result - Result from `api.log()`.
   * @returns {string}
   */
  logToMarkdown(result) {
    return logToMarkdown(result);
  },

  /**
   * Return the most recent audit-log entries.
   *
   * @param {Object} [opts]
   * @param {number} [opts.limit=10]
   * @returns {Object}
   */
  tailLog(opts = {}) {
    requireInit(this._home);
    return tailLog({ home: this._home, ...opts });
  },

  /**
   * Build a self-contained dashboard snapshot of local PermaBrain state.
   *
   * Aggregates stats, article directory, activity feed, and audit-log tail
   * into a single data object. Use `api.dashboardHTML()` or `api.dashboardMarkdown()`
   * to render it, or `api.publishDashboard()` to publish it to ZenBin.
   *
   * @param {Object} [opts]
   * @param {string} [opts.kind]
   * @param {string} [opts.topic]
   * @param {string} [opts.author]
   * @param {string} [opts.key]
   * @param {string|string[]} [opts.agent]
   * @param {string} [opts.after]
   * @param {string} [opts.before]
   * @param {string} [opts.sort='date']
   * @param {string} [opts.order='desc']
   * @param {number} [opts.articleLimit=50]
   * @param {number} [opts.activityLimit=50]
   * @param {number} [opts.logLimit=25]
   * @param {boolean} [opts.useHyperbeam]
   * @returns {Promise<Object>} Dashboard data
   */
  async dashboard(opts = {}) {
    await this.ensureInit();
    requireInit(this._home);
    return buildDashboard({ ...opts, home: this._home });
  },

  /**
   * Render dashboard data to a self-contained HTML string.
   *
   * @param {Object} data - Output of api.dashboard()
   * @param {Object} [opts]
   * @param {string} [opts.title]
   * @returns {string} HTML
   */
  dashboardHTML(data, opts = {}) {
    return dashboardToHtml(data, opts);
  },

  /**
   * Render dashboard data as markdown.
   *
   * @param {Object} data - Output of api.dashboard()
   * @param {Object} [opts]
   * @param {string} [opts.title]
   * @returns {string} Markdown
   */
  dashboardMarkdown(data, opts = {}) {
    return dashboardToMarkdown(data, opts);
  },

  /**
   * Build, render, and write a dashboard HTML snapshot to disk.
   *
   * @param {Object} [opts]
   * @param {string} opts.output - Output file path
   * @param {string} [opts.title]
   * @returns {Promise<{path, bytes}>}
   */
  async writeDashboard(opts = {}) {
    await this.ensureInit();
    requireInit(this._home);
    if (!opts.output) throw new Error('output is required');
    const data = await buildDashboard({ ...opts, home: this._home });
    return writeDashboard(data, { output: opts.output, title: opts.title });
  },

  /**
   * Publish a dashboard snapshot to ZenBin as a self-contained HTML page.
   *
   * Reads the ZenBin keyId and private JWK from opts, falling back to the
   * workspace TOOLS.md when not provided. Supports directed content via
   * recipientKeyId or recipient public JWK/fingerprint.
   *
   * @param {Object} [opts]
   * @param {string} [opts.keyId]
   * @param {Object} [opts.privateJwk]
   * @param {string} [opts.pageId]
   * @param {string} [opts.title]
   * @param {string} [opts.recipientKeyId]
   * @param {Object|string} [opts.recipient] - Recipient public JWK or fingerprint
   * @param {string} [opts.subdomain]
   * @returns {Promise<{ok, pageId, url, bytes, agentId, generatedAt, recipientKeyId}>}
   */
  async publishDashboard(opts = {}) {
    await this.ensureInit();
    requireInit(this._home);
    const { keyId, privateJwk } = await resolveZenBinCredentials(opts);
    const data = await buildDashboard({ ...opts, home: this._home });
    return publishDashboard(data, { ...opts, keyId, privateJwk });
  },

  /**
   * Share an encrypted article via a ZenBin CAP page.
   *
   * Encrypts the content for the requested recipients (always including the
   * author), builds a self-contained HTML share page, and publishes it to ZenBin
   * with an optional CAP recipient. Set opts.alsoPublish to also publish the
   * article as a PermaBrain DataItem to the configured transport.
   *
   * @param {Object} opts
   * @param {string} [opts.file]
   * @param {string} [opts.content]
   * @param {string} opts.kind
   * @param {string} opts.topic
   * @param {string} [opts.key]
   * @param {string} [opts.title]
   * @param {string} opts.sourceUrl
   * @param {string} [opts.sourceName]
   * @param {string} [opts.sourceLicense]
   * @param {string} [opts.language='en']
   * @param {string[]} opts.encryptedFor
   * @param {string} [opts.recipientKeyId]
   * @param {Object|string} [opts.recipient]
   * @param {string} [opts.pageId]
   * @param {string} [opts.subdomain]
   * @param {boolean} [opts.alsoPublish]
   * @param {boolean} [opts.useHyperbeam]
   * @returns {Promise<{share: object, zenbin: object, article?: object}>}
   */
  async shareEncrypted(opts = {}) {
    await this.ensureInit();
    requireInit(this._home);
    const { shareEncryptedArticle, publishEncryptedShare } = await import('./share-encrypted.mjs');
    const result = await shareEncryptedArticle({ ...opts, home: this._home });
    let zenbin = null;
    if (!opts.output) {
      const { keyId, privateJwk } = await resolveZenBinCredentials(opts);
      zenbin = await publishEncryptedShare(result.share, { ...opts, keyId, privateJwk });
    }
    if (opts.output) {
      const fs = await import('node:fs');
      fs.writeFileSync(opts.output, result.share.html, 'utf8');
    }
    return { share: result.share, zenbin, article: result.article };
  },

  /**
   * Export the local audit log as a migration bundle.
   *
   * @param {Object} [opts]
   * @param {string} [opts.format='json'] - 'json' or 'jsonl'
   * @returns {Object}
   */
  exportLog(opts = {}) {
    requireInit(this._home);
    return exportLog({ home: this._home, ...opts });
  },

  /**
   * Import an audit-log bundle into the local log.
   *
   * @param {Object} bundle
   * @param {Object} [opts]
   * @param {boolean} [opts.skipDuplicates=true]
   * @returns {Object}
   */
  importLog(bundle, opts = {}) {
    requireInit(this._home);
    return importLog(bundle, { home: this._home, ...opts });
  },

  /**
   * Generate a shell completion script.
   *
   * @param {Object} opts
   * @param {'bash'|'zsh'|'fish'} [opts.shell='bash']
   * @returns {{shell: string, script: string, shells: string[]}}
   */
  async completion(opts = {}) {
    const { generateCompletion, listSupportedShells } = await import('./completion.mjs');
    const shell = opts.shell || opts._?.[0] || 'bash';
    const script = generateCompletion(shell);
    return { shell, script, shells: listSupportedShells() };
  },

  /**
   * Subscribe to live article/attestation updates matching query filters.
   *
   * @param {Object} opts
   * @param {string|string[]} [opts.topic]
   * @param {string|string[]} [opts.kind]
   * @param {string|string[]} [opts.agent]
   * @param {string|string[]} [opts.key]
   * @param {string|string[]} [opts.events]
   * @returns {{[Symbol.asyncIterator]: function, cancel: function}}
   */
  subscribeQuery(opts = {}) {
    return subscribeQuery(opts);
  },

  /**
   * Create a threshold/multi-sig attestation envelope.
   *
   * @param {Object} params
   * @param {string} params.key - Target article key
   * @param {string} params.opinion
   * @param {number} params.confidence
   * @param {string} params.reason
   * @param {Object} params.policy - { threshold: number, coSignerAgentIds: string[] }
   * @param {string} [params.sourceUrl]
   * @param {string} [params.targetId]
   * @returns {Promise<Object>} Envelope
   */
  async createThresholdAttestation(params = {}) {
    await this.ensureInit();
    requireInit(this._home);
    const threshold = await import('./threshold-attestation.mjs');
    return threshold.createThresholdEnvelope({ ...params, now: params.now });
  },

  /**
   * Add a co-signer signature to a pending threshold envelope.
   *
   * @param {string} envelopeId
   * @param {Object} signer - { agentId, signatureType, signature, publicKey? }
   * @returns {Object} Updated envelope
   */
  addThresholdSigner(envelopeId, signer) {
    return import('./threshold-attestation.mjs').then(({ addCoSigner }) => {
      const updated = addCoSigner(envelopeId, signer);
      return updated;
    });
  },

  /**
   * Export a threshold envelope for sharing with co-signers.
   *
   * @param {string} envelopeId
   * @returns {Object}
   */
  async exportThresholdEnvelope(envelopeId) {
    const threshold = await import('./threshold-attestation.mjs');
    return threshold.exportThresholdEnvelope(envelopeId);
  },

  /**
   * Finalize and publish a threshold attestation once signatures meet threshold.
   *
   * @param {string} envelopeId
   * @param {Object} [opts]
   * @param {boolean} [opts.useHyperbeam]
   * @returns {Promise<Object>}
   */
  async finalizeThresholdAttestation(envelopeId, opts = {}) {
    await this.ensureInit();
    requireInit(this._home);
    const threshold = await import('./threshold-attestation.mjs');
    return threshold.finalizeThresholdAttestation(envelopeId, opts);
  },

  /**
   * Verify all co-signer signatures in a threshold envelope.
   *
   * @param {Object} envelope
   * @returns {Promise<{ok:boolean, valid:number, required:number, invalid:string[]}>}
   */
  async verifyThresholdEnvelope(envelope) {
    const threshold = await import('./threshold-attestation.mjs');
    return threshold.verifyThresholdEnvelope(envelope);
  },

  /**
   * Return public peer-sync info for this node.
   *
   * Includes agentId, transport, protocol version, and a map of public
   * (non-encrypted/non-private) articles with their current version/id.
   *
   * @param {Object} [opts]
   * @param {boolean} [opts.includeAttestations=true]
   * @returns {{agentId, transport, version, peerProtocol, articles, attestationCount, attestations}}
   */
  peerInfo(opts = {}) {
    requireInit(this._home);
    return peerInfo(this._home, opts);
  },

  /**
   * Build a peer pull bundle for a list of requested keys/ids.
   *
   * @param {Array<{key?: string, id?: string, sinceVersion?: number}>} requests
   * @param {Object} [opts]
   * @param {boolean} [opts.includeAttestations=true]
   * @param {boolean} [opts.includeVersions=true]
   * @returns {Promise<Object>} PermaBrain bundle
   */
  async buildPeerPullBundle(requests, opts = {}) {
    await this.ensureInit();
    requireInit(this._home);
    return buildPeerPullBundle(requests, this._home, opts);
  },

  /**
   * Pull newer/missing articles from a remote PermaBrain node.
   *
   * Uses the remote node's /api/v1/peer/info and /api/v1/peer/pull endpoints.
   *
   * @param {string} baseUrl - Remote permabrain serve base URL
   * @param {Object} [opts]
   * @param {boolean} [opts.includeAttestations=true]
   * @param {boolean} [opts.verify=true]
   * @param {boolean} [opts.skipDuplicates=true]
   * @returns {Promise<{peer: Object, pulled: Array, imported: number, skipped: number, failed: number, diff: Object, results?: Array}>}
   */
  async pullFromPeer(baseUrl, opts = {}) {
    await this.ensureInit();
    requireInit(this._home);
    const { createClient } = await import('./client.mjs');
    const client = createClient({ baseUrl });
    return pullFromPeerClient(client, { ...opts, home: this._home });
  },

  async pullFromPeerAsBundle(baseUrl, opts = {}) {
    await this.ensureInit();
    requireInit(this._home);
    const { createClient } = await import('./client.mjs');
    const client = createClient({ baseUrl });
    return pullFromPeerClientAsBundle(client, { ...opts, home: this._home });
  },

  /**
   * Compute pullable summary for one or more peer infos.
   *
   * @param {Object|Object[]} peers
   * @param {Object} [opts]
   * @returns {{peers: Array, totalPullable: number, uniquePeers: number}}
   */
  peerStatus(peers, opts = {}) {
    requireInit(this._home);
    const list = Array.isArray(peers) ? peers : [peers];
    return peerStatus(list, { ...opts, home: this._home });
  },

  /**
   * Build a peer push bundle for a list of local keys.
   *
   * @param {string[]} keys
   * @param {Object} [opts]
   * @returns {Promise<Object>} PermaBrain bundle
   */
  async buildPeerPushBundle(keys, opts = {}) {
    await this.ensureInit();
    requireInit(this._home);
    return buildPeerPushBundle(keys, this._home, opts);
  },

  /**
   * Push newer/missing local articles to a remote PermaBrain node.
   *
   * @param {string} baseUrl - Remote permabrain serve base URL
   * @param {Object} [opts]
   * @param {boolean} [opts.includeAttestations=true]
   * @param {boolean} [opts.includeVersions=true]
   * @returns {Promise<{peer: Object, pushed: Array, accepted: number, rejected: number, failed: number, bundle: Object, diff: Object, results?: Array}>}
   */
  async pushToPeer(baseUrl, opts = {}) {
    await this.ensureInit();
    requireInit(this._home);
    const { createClient } = await import('./client.mjs');
    const client = createClient({ baseUrl });
    return pushToPeerClient(client, { ...opts, home: this._home });
  },

  /**
   * Import a threshold envelope shared by another co-signer.
   *
   * @param {Object} envelope
   * @returns {Object}
   */
  importThresholdEnvelope(envelope) {
    return import('./threshold-attestation.mjs').then(({ importThresholdEnvelope }) => importThresholdEnvelope(envelope));
  },

  /**
   * Validate article or attestation metadata tags against the PermaBrain JSON Schema.
   *
   * @param {Object} tags - Flat tag name/value object
   * @param {Object} [opts]
   * @param {string} [opts.type='article'] - 'article' or 'attestation'
   * @returns {{valid: boolean, errors: Array<{path: string, message: string}>}}
   */
  validateMetadata(tags, opts = {}) {
    const type = opts.type === 'attestation' ? 'attestation' : 'article';
    if (type === 'attestation') return validateAttestationMetadata(tags);
    return validateArticleMetadata(tags);
  },

  /**
   * Validate an ANS-104-style DataItem's tags against the PermaBrain JSON Schema.
   *
   * @param {Object} dataItem - Object with a `tags` array of `{name, value}` objects
   * @param {Object} [opts]
   * @param {string} [opts.type='article'] - 'article' or 'attestation'
   * @returns {{valid: boolean, errors: Array<{path: string, message: string}>}}
   */
  validateDataItem(dataItem, opts = {}) {
    return validateDataItemTags(dataItem, opts.type === 'attestation' ? 'attestation' : 'article');
  },

  /**
   * Start an interactive REPL for live agent API exploration.
   *
   * Exposes `api` (and the alias `pb`) as the REPL context so you can run
   * commands like `await api.query({topic:'ai'})` or `pb.status()`. History is
   * persisted to the PermaBrain home directory and tab completion covers the
   * `api` method surface.
   *
   * @param {Object} [opts]
   * @param {stream.Readable} [opts.input] - Input stream (default process.stdin)
   * @param {stream.Writable} [opts.output] - Output stream (default process.stdout)
   * @param {string} [opts.historyPath] - File to persist command history
   * @param {string} [opts.prompt] - REPL prompt
   * @param {boolean} [opts.terminal] - Force terminal mode
   * @returns {Promise<void>}
   */
  async repl(opts = {}) {
    await this.ensureInit();
    requireInit(this._home);
    const { createRepl } = await import('./repl.mjs');
    return createRepl({ api: this, home: this._home, ...opts });
  },

  /**
   * Build or validate release notes from CHANGELOG.md.
   *
   * @param {Object} opts
   * @param {string} [opts.text] - Full CHANGELOG.md text (takes precedence over path)
   * @param {string} [opts.path] - Path to CHANGELOG.md (default ./CHANGELOG.md)
   * @param {string} [opts.version] - Release version to build notes for
   * @param {boolean} [opts.unreleased] - Build notes for the [Unreleased] section
   * @param {boolean} [opts.draft] - Generate a draft from recent git commits
   * @param {number} [opts.limit] - Max commits for --draft (default 50)
   * @param {string} [opts.since] - Git --since date for --draft
   * @returns {Promise<{markdown, json, release, parsed?}|{valid, errors}|{markdown, json, release}>}
   */
  async releaseNotes(opts = {}) {
    const { buildReleaseNotes, generateDraftFromGitCommits, validateChangelog } = await import('./release-notes.mjs');
    if (opts.validate) {
      const text = opts.text ?? fs.readFileSync(opts.path || './CHANGELOG.md', 'utf8');
      return validateChangelog(text);
    }
    if (opts.draft) {
      return generateDraftFromGitCommits({
        limit: opts.limit || 50,
        since: opts.since || undefined,
        path: process.cwd()
      });
    }
    return buildReleaseNotes(opts);
  },

  /**
   * Build a detailed local identity introspection report.
   *
   * Includes the public signing identity, derived X25519 encryption key
   * (for ed25519 identities), home directory, transport, and a redacted
   * config summary.
   *
   * @param {Object} [opts]
   * @param {boolean} [opts.markdown=false]
   * @param {boolean} [opts.html=false]
   * @returns {Promise<Object|string>}
   */
  async whoami(opts = {}) {
    await this.ensureInit();
    requireInit(this._home);
    const report = buildIdentityReport({ home: this._home, config: this._config });
    if (opts.html) return identityReportToHtml(report);
    if (opts.markdown) return { ...report, markdown: identityReportToMarkdown(report) };
    return report;
  },

  /**
   * Return a health report for the local node and optionally a remote server.
   *
   * Without `opts.url`, this probes the configured transport via `api.probe()`
   * and returns local identity metadata. With `opts.url`, it also fetches the
   * remote `/health` endpoint via the HTTP SDK.
   *
   * @param {Object} [opts]
   * @param {string} [opts.url] - Remote PermaBrain serve base URL to check
   * @param {boolean} [opts.useHyperbeam] - Force HyperbeamTransport probe locally
   * @param {boolean} [opts.markdown] - Include a markdown rendering of the report
   * @returns {Promise<{ok: boolean, agentId: string, home: string, transport: string, version: string, checks: Array, remote?: Object, markdown?: string}>}
   */
  async health(opts = {}) {
    await this.ensureInit();
    requireInit(this._home);
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));
    const transport = this._config?.transport || 'local';
    let probe;
    try {
      probe = await this.probe({ useHyperbeam: opts.useHyperbeam });
    } catch (e) {
      probe = { ok: false, url: null, transport, checks: [{ name: 'transport-probe', ok: false, error: e.message }] };
    }
    const report = {
      ok: probe.ok,
      agentId: this._identity?.agentId || null,
      home: this._home,
      transport,
      version: pkg.version || 'unknown',
      checks: probe.checks || []
    };
    if (opts.url) {
      const { createClient } = await import('./client.mjs');
      const client = createClient({ baseUrl: opts.url });
      try {
        report.remote = await client.health();
        report.ok = report.ok && report.remote.ok;
      } catch (e) {
        report.remote = { ok: false, error: e.message };
        report.ok = false;
      }
    }
    if (opts.markdown) {
      const lines = [
        `# PermaBrain health`,
        '',
        `- **ok**: ${report.ok ? 'yes' : 'no'}`,
        `- **agentId**: ${report.agentId || '(unknown)'}`,
        `- **home**: ${report.home}`,
        `- **transport**: ${report.transport}`,
        `- **version**: ${report.version}`,
        ''
      ];
      if (report.remote) {
        lines.push(`## Remote: ${opts.url}`, '');
        lines.push(`- **ok**: ${report.remote.ok ? 'yes' : 'no'}`);
        if (report.remote.error) lines.push(`- **error**: ${report.remote.error}`);
        else {
          lines.push(`- **agentId**: ${report.remote.agentId || '(unknown)'}`);
          lines.push(`- **home**: ${report.remote.home || '(unknown)'}`);
          lines.push(`- **transport**: ${report.remote.transport || '(unknown)'}`);
        }
        lines.push('');
      }
      lines.push('## Checks', '');
      for (const check of report.checks) {
        lines.push(`- ${check.ok ? '✓' : '✗'} ${check.name}${check.error ? `: ${check.error}` : ''}`);
      }
      report.markdown = lines.join('\n');
    }
    return report;
  },

  /**
   * Get the current agent identity.
   * @returns {{agentId, keyType}}
   */
  get identity() {
    if (!this._identity) return null;
    return { agentId: this._identity.agentId, keyType: this._identity.type };
  }
};

function deriveAuthorSeed(identity) {
  if (identity.type === 'ed25519') {
    const edSeed = Buffer.from(identity.secretKey, 'base64url').subarray(0, 32);
    return Buffer.from(pbcrypto.deriveEncryptionKeyFromEd25519(edSeed).seed, 'base64url');
  }
  if (identity.type === 'arweave-rsa4096' && identity.encryptionSeed) {
    return Buffer.from(identity.encryptionSeed, 'base64url');
  }
  throw new Error('Cannot derive decryption seed from identity. Provide decryptSeed or use an ed25519 identity.');
}

export { api, resolveZenBinCredentials };

async function resolveZenBinCredentials(opts = {}) {
  if (opts.keyId && opts.privateJwk) return { keyId: opts.keyId, privateJwk: opts.privateJwk };

  const fs = await import('node:fs');
  const path = await import('node:path');
  const toolsCandidates = [
    opts.toolsPath,
    process.env.ZENBIN_TOOLS_PATH,
    '/home/node/.openclaw/workspace/TOOLS.md',
    path.join(process.cwd(), 'TOOLS.md')
  ].filter(Boolean);

  let parsed = null;
  for (const toolsPath of toolsCandidates) {
    if (!fs.existsSync(toolsPath)) continue;
    const text = fs.readFileSync(toolsPath, 'utf8');
    parsed = parseZenBinToolsMd(text);
    if (parsed) break;
  }

  if (!parsed?.keyId || !parsed?.privateJwk) {
    throw new Error('ZenBin credentials not found. Provide keyId and privateJwk, or ensure TOOLS.md contains a ZenBin section with keyId and private JWK.');
  }

  return {
    keyId: opts.keyId || parsed.keyId,
    privateJwk: opts.privateJwk || parsed.privateJwk
  };
}

function parseZenBinToolsMd(text) {
  const sectionMatch = text.match(/###\s*ZenBin[\s\S]*?(?=###\s|$)/);
  if (!sectionMatch) return null;
  const section = sectionMatch[0];
  const keyIdMatch = section.match(/\*\*keyId:\*\*\s*`?([^`\n]+)`?/);
  const publicFingerprintMatch = section.match(/\*\*publicKeyFingerprint:\*\*\s*`?([^`\n]+)`?/);

  const publicJwkMatch = section.match(/###\s*Public JWK[\s\S]*?```json\n([\s\S]*?)\n```/);
  const privateJwkMatch = section.match(/###\s*Private JWK[\s\S]*?```json\n([\s\S]*?)\n```/);

  let publicJwk = null;
  let privateJwk = null;
  try { if (publicJwkMatch) publicJwk = JSON.parse(publicJwkMatch[1]); } catch {}
  try { if (privateJwkMatch) privateJwk = JSON.parse(privateJwkMatch[1]); } catch {}

  return {
    keyId: keyIdMatch?.[1]?.trim(),
    publicKeyFingerprint: publicFingerprintMatch?.[1]?.trim(),
    publicJwk,
    privateJwk
  };
}