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

import { initState, getHome, loadConfig, defaultConfig } from './config.mjs';
import { ensureIdentity, loadIdentity } from './keys.mjs';
import { publishArticle, queryArticles, getArticle, syncArticlesAndAttestations } from './article.mjs';
import { attestArticle } from './attestation.mjs';
import { attestForAgent, provisionAgentIdentity, parseAttestationRequest, processProxyAttestation, buildAttestationRequestBody, listKnownAgents, getKnownAgent } from './multi-agent.mjs';
import { consensusForArticle } from './consensus.mjs';
import { exportBundle, exportAllArticles, importBundle } from './bundle.mjs';
import { forkArticle, listForks } from './fork.mjs';
import { loadIndex } from './cache.mjs';
import * as pbcrypto from './crypto.mjs';
import { slugify } from './tags.mjs';
import { getCircuitBreakerStatus, getTransportMetrics } from './transport.mjs';

function requireGoalModule() {
  return import('./goal.mjs');
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
    const { home, createdConfig } = initState({ env: { ...process.env, PERMABRAIN_KEY_TYPE: keyType } });
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
    const result = await publishArticle({ content, kind, topic, sourceUrl, useHyperbeam, useHyperbeamReference, encryptedFor, visibility: normalizedVisibility, ...rest });
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
    const { opinion, confidence, reason, sourceUrl, useHyperbeam, useHyperbeamReference } = params;
    const result = await attestArticle({
      key,
      opinion,
      confidence,
      reason,
      sourceUrl: sourceUrl || '',
      useHyperbeam,
      useHyperbeamReference
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
   * @param {Object} [opts]
   * @param {boolean} [opts.useHyperbeam] - Use HyperbeamTransport for sync
   * @returns {Promise<{articleCount, attestationCount, updatedAt}>}
   */
  async sync(opts = {}) {
    await this.ensureInit();
    requireInit(this._home);
    const index = await syncArticlesAndAttestations({ useHyperbeam: opts.useHyperbeam });
    return {
      articleCount: Object.keys(index.articles).length,
      attestationCount: Object.values(index.attestations).reduce((n, xs) => n + xs.length, 0),
      updatedAt: index.updatedAt
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

export { api };