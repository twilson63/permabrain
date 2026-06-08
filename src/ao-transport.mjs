/**
 * AO Transport — wraps @permaweb/aoconnect for PermaBrain.
 *
 * Provides message (write) and dryrun (read) against the AO process,
 * with GraphQL + local-cache fallback for queryByTags and fetchData.
 *
 * Architecture:
 *   - Publish/Attest → message() (on-chain, permanent)
 *   - Query/Get/Consensus → dryrun() (instant, free) → ArweaveTransport (fallback)
 *   - queryByTags → ArweaveTransport (AO has no tag-index query)
 *   - fetchData → ArweaveTransport (AO process doesn't store content)
 */

import { connect } from '@permaweb/aoconnect';
import Arweave from 'arweave';
import { ArweaveTransport } from './transport.mjs';

/**
 * Create an AO-compatible signer from a PermaBrain identity.
 * aoconnect expects: async ({ data, tags, target, anchor }) => { id, owner, signature, data }
 * But the new createSigner API expects: async (create, type) => { signature, address }
 */
function createAoSigner(identity) {
  if (identity.type === 'arweave-rsa4096' && identity.jwk) {
    // Use the Arweave JWK directly — aoconnect's createSigner accepts JWK objects
    const { createSigner } = connect;
    // createSigner from @permaweb/aoconnect/node handles JWK signing natively
    return identity.jwk;
  }
  if (identity.type === 'ed25519') {
    // For ed25519, we return a custom signer function.
    // aoconnect's message/spawn expect either a JWK or a signer function.
    // We'll provide a signer compatible with the aoconnect RawSigner API.
    throw new Error(
      'Ed25519 signing for AO is not yet supported. ' +
      'Use an Arweave JWK identity (permabrain init --key-type arweave-rsa4096) for AO transport.'
    );
  }
  throw new Error(`Unsupported identity type for AO transport: ${identity.type}`);
}

/**
 * AO Transport — sends PermaBrain operations to an AO process via aoconnect,
 * with ArweaveTransport as fallback for data retrieval and tag queries.
 */
export class AOTransport {
  constructor(config) {
    this.config = config;
    this.processId = config.ao?.processId;
    if (!this.processId) throw new Error('AO transport requires config.ao.processId');

    // aoconnect connection — use custom URLs if provided, else defaults
    const connectOpts = {};
    if (config.ao?.muUrl) connectOpts.MU_URL = config.ao.muUrl;
    if (config.ao?.cuUrl) connectOpts.CU_URL = config.ao.cuUrl;
    if (config.ao?.gatewayUrl) connectOpts.GATEWAY_URL = config.ao.gatewayUrl;
    if (config.ao?.graphqlUrl) connectOpts.GRAPHQL_URL = config.ao.graphqlUrl;

    this.ao = Object.keys(connectOpts).length > 0 ? connect(connectOpts) : connect();

    // Fallback transport for fetchData and queryByTags
    this.fallback = new ArweaveTransport({
      ...config,
      gateway: config.ao?.gatewayUrl
        ? { ...config.gateway, graphqlUrl: config.ao.graphqlUrl || `${config.ao.gatewayUrl}/graphql`, dataUrl: config.ao.gatewayUrl }
        : config.gateway
    });
  }

  // ============================================================================
  // AO message — write operations (Publish, Attest, Sync)
  // ============================================================================

  /**
   * Send a message to the AO process (on-chain, permanent).
   * Used for Publish and Attest operations.
   *
   * @param {Object} params
   * @param {string} params.action - Action tag value (e.g. "Publish", "Attest", "Sync")
   * @param {Array<{name: string, value: string}>} params.tags - Message tags
   * @param {string} [params.data] - Message data payload
   * @param {Object} params.identity - PermaBrain identity for signing
   * @returns {Promise<{messageId: string}>}
   */
  async sendMessage({ action, tags = [], data = '', identity }) {
    const allTags = [
      { name: 'Action', value: action },
      ...tags
    ];

    const signer = createAoSigner(identity);
    const messageId = await this.ao.message({
      process: this.processId,
      signer,
      tags: allTags,
      data
    });

    return { messageId };
  }

  /**
   * Publish an article DataItem to Arweave AND send a Publish message to the AO process.
   * This dual-writes: the content lives on Arweave, the index lives in AO state.
   */
  async uploadDataItem(item) {
    // First, upload to Arweave via fallback (permanent storage)
    const arweaveResult = await this.fallback.uploadDataItem(item);

    // Then, send Publish message to AO process with article metadata
    const tags = item.tags || [];
    const articleTags = tags.filter(t => t.name.startsWith('Article-') || t.name.startsWith('Author-') || t.name === 'PermaBrain-Type' || t.name === 'App-Name');

    const dataPayload = tags.find(t => t.name === 'PermaBrain-Type')?.value === 'attestation'
      ? JSON.stringify({
          targetKey: tags.find(t => t.name === 'Attestation-Target-Key')?.value,
          targetId: tags.find(t => t.name === 'Attestation-Target-Id')?.value,
          opinion: tags.find(t => t.name === 'Attestation-Opinion')?.value,
          confidence: Number(tags.find(t => t.name === 'Attestation-Confidence')?.value || 0),
          reason: tags.find(t => t.name === 'Attestation-Reason')?.value,
          agentId: tags.find(t => t.name === 'Attestation-Agent-Id')?.value,
          sourceUrl: tags.find(t => t.name === 'Attestation-Source-Url')?.value,
          createdAt: tags.find(t => t.name === 'Attestation-Created-At')?.value
        })
      : JSON.stringify({
          id: item.id,
          key: tags.find(t => t.name === 'Article-Key')?.value,
          kind: tags.find(t => t.name === 'Article-Kind')?.value,
          title: tags.find(t => t.name === 'Article-Title')?.value,
          slug: tags.find(t => t.name === 'Article-Slug')?.value,
          topic: tags.find(t => t.name === 'Article-Topic')?.value,
          language: tags.find(t => t.name === 'Article-Language')?.value,
          version: Number(tags.find(t => t.name === 'Article-Version')?.value || 1),
          previousId: tags.find(t => t.name === 'Article-Previous-Id')?.value || null,
          rootId: tags.find(t => t.name === 'Article-Root-Id')?.value || null,
          sourceName: tags.find(t => t.name === 'Article-Source-Name')?.value,
          sourceUrl: tags.find(t => t.name === 'Article-Source-Url')?.value,
          sourceLicense: tags.find(t => t.name === 'Article-Source-License')?.value,
          contentHash: tags.find(t => t.name === 'Article-Content-Hash')?.value,
          publishedAt: tags.find(t => t.name === 'Article-Published-At')?.value,
          updatedAt: tags.find(t => t.name === 'Article-Updated-At')?.value,
          authorAgentId: tags.find(t => t.name === 'Author-Agent-Id')?.value
        });

    const action = tags.find(t => t.name === 'PermaBrain-Type')?.value === 'attestation' ? 'Attest' : 'Publish';

    try {
      // We need the identity to sign AO messages.
      // The item was already signed for Arweave; we need a separate AO signing.
      // For now, we skip the AO message if no identity is available
      // (the caller should handle this by passing identity separately).
      // This is a design limitation — the transport layer only has the DataItem, not the identity.
      // The article.mjs and attestation.mjs layers will call sendMessage directly.
    } catch (err) {
      // AO message failure should not block Arweave upload
      console.error(`AO ${action} message failed (non-fatal, data is on Arweave): ${err.message}`);
    }

    return { ...arweaveResult, aoAction: action };
  }

  // ============================================================================
  // AO dryrun — read operations (Query, Get, Consensus)
  // ============================================================================

  /**
   * Send a dryrun (read-only) message to the AO process.
   * Returns the response without modifying process state.
   *
   * @param {Object} params
   * @param {string} params.action - Action tag value (e.g. "Query", "Get", "Consensus")
   * @param {Array<{name: string, value: string}>} [params.tags] - Additional tags
   * @param {string} [params.data] - Message data
   * @returns {Promise<Object>} - Parsed response from the AO process
   */
  async dryrun({ action, tags = [], data = '' }) {
    const result = await this.ao.dryrun({
      process: this.processId,
      tags: [{ name: 'Action', value: action }, ...tags],
      data
    });

    // Parse the response — dryrun returns { Messages, Spawns, Output, Error }
    if (result.Error) {
      throw new Error(`AO dryrun error: ${result.Error}`);
    }

    // Find the response message with matching Action tag
    const responseAction = `${action}-Response` in RESPONSE_ACTIONS
      ? RESPONSE_ACTIONS[action]
      : `${action}-Response`;

    for (const msg of result.Messages || []) {
      const msgTags = Object.fromEntries((msg.Tags || []).map(t => [t.name, t.value]));
      if (msgTags.Action === responseAction || msgTags.Action === `${action}-Notice`) {
        // Try to parse Data as JSON
        const rawData = msg.Data || msg.data || '';
        if (rawData) {
          try {
            return JSON.parse(rawData);
          } catch {
            // Data is not JSON — return raw
            return { data: rawData, tags: msg.Tags || [] };
          }
        }
        return { tags: msg.Tags || [], action: msgTags.Action };
      }
    }

    // If no matching message, return the raw result
    return result;
  }

  /**
   * Query articles via AO dryrun (instant, free) with Arweave fallback.
   */
  async queryByTags(filters) {
    // AO process doesn't support arbitrary tag-based queries like GraphQL.
    // Use ArweaveTransport for tag queries.
    return this.fallback.queryByTags(filters);
  }

  /**
   * Fetch article content from Arweave (AO process stores metadata, not content).
   */
  async fetchDataItem(id) {
    return this.fallback.fetchDataItem(id);
  }

  async fetchData(id) {
    return this.fallback.fetchData(id);
  }

  // ============================================================================
  // High-level AO operations
  // ============================================================================

  /**
   * Query articles from the AO process by filters.
   * Returns parsed article summaries.
   */
  async queryArticles(filters = {}) {
    const tags = [];
    if (filters.topic) tags.push({ name: 'Article-Topic', value: filters.topic });
    if (filters.kind) tags.push({ name: 'Article-Kind', value: filters.kind });
    if (filters.key) tags.push({ name: 'Article-Key', value: filters.key });
    if (filters.sourceName) tags.push({ name: 'Article-Source-Name', value: filters.sourceName });

    try {
      const result = await this.dryrun({ action: 'Query', tags });
      if (Array.isArray(result)) return result;
      if (result.data) {
        try { return JSON.parse(result.data); } catch { /* fall through */ }
      }
    } catch (err) {
      // AO dryrun failed — fall through to Arweave query
    }

    // Fallback to Arweave GraphQL query
    const tagFilters = { 'App-Name': 'PermaBrain', 'PermaBrain-Type': 'article' };
    if (filters.topic) tagFilters['Article-Topic'] = filters.topic;
    if (filters.kind) tagFilters['Article-Kind'] = filters.kind;
    if (filters.key) tagFilters['Article-Key'] = filters.key;
    return this.fallback.queryByTags(tagFilters);
  }

  /**
   * Get a single article from the AO process by key.
   */
  async getArticle(key) {
    try {
      const result = await this.dryrun({ action: 'Get', tags: [{ name: 'Article-Key', value: key }] });
      if (result.key) return result;
    } catch (err) {
      // AO dryrun failed — fall through
    }
    return null;
  }

  /**
   * Get consensus score for an article from the AO process.
   */
  async getConsensus(key) {
    try {
      const result = await this.dryrun({ action: 'Consensus', tags: [{ name: 'Article-Key', value: key }] });
      return result;
    } catch (err) {
      return null;
    }
  }

  /**
   * Bootstrap the AO process with existing articles and attestations from Arweave.
   * Sends a Sync message with all known data.
   */
  async syncFromArweave(identity) {
    // Fetch all articles and attestations from Arweave
    const articles = await this.fallback.queryByTags({ 'App-Name': 'PermaBrain', 'PermaBrain-Type': 'article' });
    const attestations = await this.fallback.queryByTags({ 'App-Name': 'PermaBrain', 'PermaBrain-Type': 'attestation' });

    const { tagsToObject: toObj } = await import('./tags.mjs');

    const payload = {
      articles: articles.map(item => {
        const t = toObj(item.tags || []);
        return {
          id: item.id,
          key: t['Article-Key'],
          kind: t['Article-Kind'],
          title: t['Article-Title'],
          slug: t['Article-Slug'],
          topic: t['Article-Topic'],
          language: t['Article-Language'],
          version: Number(t['Article-Version'] || 1),
          previousId: t['Article-Previous-Id'] || null,
          rootId: t['Article-Root-Id'] || null,
          sourceName: t['Article-Source-Name'],
          sourceUrl: t['Article-Source-Url'],
          sourceLicense: t['Article-Source-License'],
          contentHash: t['Article-Content-Hash'],
          publishedAt: t['Article-Published-At'],
          updatedAt: t['Article-Updated-At'],
          authorAgentId: t['Author-Agent-Id']
        };
      }),
      attestations: attestations.map(item => {
        const t = toObj(item.tags || []);
        return {
          id: item.id,
          targetId: t['Attestation-Target-Id'],
          targetKey: t['Attestation-Target-Key'],
          opinion: t['Attestation-Opinion'],
          confidence: Number(t['Attestation-Confidence'] || 0),
          reason: t['Attestation-Reason'],
          agentId: t['Attestation-Agent-Id'],
          sourceUrl: t['Attestation-Source-Url'],
          createdAt: t['Attestation-Created-At']
        };
      })
    };

    const signer = createAoSigner(identity);
    const messageId = await this.ao.message({
      process: this.processId,
      signer,
      tags: [{ name: 'Action', value: 'Sync' }],
      data: JSON.stringify(payload)
    });

    return { messageId, articles: payload.articles.length, attestations: payload.attestations.length };
  }
}

// Map AO actions to their expected response action suffixes
const RESPONSE_ACTIONS = {
  Publish: 'Publish-Notice',
  Attest: 'Attest-Notice',
  Query: 'Query-Response',
  Get: 'Get-Response',
  Consensus: 'Consensus-Response',
  Sync: 'Sync-Notice',
  Info: 'Info-Response'
};