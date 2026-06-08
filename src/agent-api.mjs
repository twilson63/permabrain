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

import { initState, getHome, loadConfig } from './config.mjs';
import { ensureIdentity, loadIdentity } from './keys.mjs';
import { publishArticle, queryArticles, getArticle, syncArticlesAndAttestations } from './article.mjs';
import { attestArticle } from './attestation.mjs';
import { attestForAgent, provisionAgentIdentity, parseAttestationRequest, processProxyAttestation, buildAttestationRequestBody, listKnownAgents, getKnownAgent } from './multi-agent.mjs';
import { consensusForArticle } from './consensus.mjs';
import { loadIndex } from './cache.mjs';

function requireInit(home) {
  if (!home) throw new Error('PermaBrain not initialized. Call api.init() first.');
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
    const { home, createdConfig } = initState({ env: { PERMABRAIN_KEY_TYPE: keyType } });
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
      }
      const { writeJsonIfMissing } = await import('./config.mjs');
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
    if (this._home) return { home: this._home, agentId: this._identity.agentId, keyType: this._identity.type };
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
   * @returns {Promise<{id, key, kind, title, version, contentHash}>}
   */
  async publish(params) {
    await this.ensureInit();
    requireInit(this._home);
    const { content, kind, topic, sourceUrl, ...rest } = params;
    if (!content) throw new Error('content is required');
    if (!kind) throw new Error('kind is required');
    if (!topic) throw new Error('topic is required');
    if (!sourceUrl) throw new Error('sourceUrl is required');
    const result = await publishArticle({ content, kind, topic, sourceUrl, ...rest });
    return result.summary;
  },

  /**
   * Query articles by filters.
   * @param {Object} [filters]
   * @param {string} [filters.topic] - Filter by topic
   * @param {string} [filters.kind] - Filter by kind
   * @param {string} [filters.key] - Filter by canonical key
   * @param {string} [filters.sourceName] - Filter by source name
   * @param {string} [filters.sourceUrl] - Filter by source URL
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
   * @returns {Promise<{key, title, content, contentHash, version, sourceName, sourceUrl}>}
   */
  async get(key) {
    await this.ensureInit();
    requireInit(this._home);
    if (!key) throw new Error('key is required');
    const result = await getArticle(key);
    return { ...result.summary, content: result.content };
  },

  /**
   * Attest to an article's validity.
   * @param {string} key - Canonical key of the target article
   * @param {Object} params
   * @param {string} params.opinion - One of: valid, invalid, partially-valid, outdated, disputed
   * @param {number} params.confidence - Confidence from 0 to 1
   * @param {string} params.reason - Short explanation for the attestation
   * @param {string} [params.sourceUrl] - Supporting source URL
   * @returns {Promise<{id, targetKey, opinion, confidence, reason}>}
   */
  async attest(key, params = {}) {
    await this.ensureInit();
    requireInit(this._home);
    if (!key) throw new Error('key is required');
    if (!params.opinion) throw new Error('opinion is required');
    if (params.confidence === undefined) throw new Error('confidence is required');
    if (!params.reason) throw new Error('reason is required');
    const result = await attestArticle({
      key,
      opinion: params.opinion,
      confidence: params.confidence,
      reason: params.reason,
      sourceUrl: params.sourceUrl || ''
    });
    return result.summary;
  },

  /**
   * Get consensus information for an article.
   * @param {string} key - Canonical key
   * @returns {Promise<{key, status, score, totalAttestations, opinionCounts, topReasons}>}
   */
  async consensus(key) {
    await this.ensureInit();
    requireInit(this._home);
    if (!key) throw new Error('key is required');
    return consensusForArticle(key);
  },

  /**
   * Sync local cache from the transport (Arweave/HyperBEAM).
   * @returns {Promise<{articleCount, attestationCount, updatedAt}>}
   */
  async sync() {
    await this.ensureInit();
    requireInit(this._home);
    const index = await syncArticlesAndAttestations();
    return {
      articleCount: Object.keys(index.articles).length,
      attestationCount: Object.values(index.attestations).reduce((n, xs) => n + xs.length, 0),
      updatedAt: index.updatedAt
    };
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
   * Get the current agent identity.
   * @returns {{agentId, keyType}}
   */
  get identity() {
    if (!this._identity) return null;
    return { agentId: this._identity.agentId, keyType: this._identity.type };
  }
};

export { api };