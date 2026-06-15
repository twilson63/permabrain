import fs from 'node:fs';
import path from 'node:path';
import { statePaths } from './config.mjs';
import { parseAns104, payloadBuffer, payloadText, rawDataItemBytes } from './dataitem.mjs';
import { tagsToObject } from './tags.mjs';
import { HyperbeamQuery } from './hb-query.mjs';
import { HyperbeamConsensus } from './hb-consensus.mjs';
import { HyperbeamReference } from './hb-reference.mjs';
import {
  DEVICES, FORMATTERS,
  bundlerUploadUrl, fetchUrl, pushUrl, processUrl, metaUrl,
  parseHttpsigtHeaders, kebabToTitleCase, titleToKebabCase,
  buildPermaBrainFilters,
} from './hb-devices.mjs';

export function getTransport(config, home, opts = {}) {
  if (opts.useHyperbeam) return new HyperbeamTransport(configForHyperbeam(config));
  if (config.transport === 'local' || config.gateway?.type === 'local' || config.bundler?.type === 'local') return new LocalTransport(home);
  if (config.transport === 'arweave' || config.gateway?.type === 'arweave') return new ArweaveTransport(config);
  if (config.transport === 'hyperbeam') return new HyperbeamTransport(config);
  // Default fallback: Arweave
  return new ArweaveTransport(config);
}

function configForHyperbeam(config) {
  const baseUrl = config.gateway?.dataUrl || process.env.PERMABRAIN_HYPERBEAM_URL || 'http://localhost:10000';
  return {
    ...config,
    transport: 'hyperbeam',
    gateway: {
      ...(config.gateway || {}),
      type: 'hyperbeam',
      dataUrl: baseUrl,
      graphqlUrl: config.gateway?.graphqlUrl || `${baseUrl}/graphql`
    },
    bundler: {
      ...(config.bundler || {}),
      type: 'hyperbeam',
      uploadUrl: config.bundler?.uploadUrl || `${baseUrl}/~bundler@1.0/tx?codec-device=ans104@1.0`
    },
    hyperbeam: {
      references: config.hyperbeam?.references ?? false
    }
  };
}

// ============================================================================
// Local Transport
// ============================================================================

export class LocalTransport {
  constructor(home) {
    this.paths = statePaths(home);
    fs.mkdirSync(this.paths.objectsDir, { recursive: true });
  }

  objectPath(id) {
    return path.join(this.paths.objectsDir, encodeURIComponent(id) + '.json');
  }

  async uploadDataItem(item) {
    fs.writeFileSync(this.objectPath(item.id), JSON.stringify(item, null, 2) + '\n');
    return { id: item.id, status: 'stored-local' };
  }

  async fetchDataItem(id) {
    const file = this.objectPath(id);
    if (!fs.existsSync(file)) throw new Error(`DataItem not found: ${id}`);
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }

  async fetchData(id) {
    return payloadBuffer(await this.fetchDataItem(id));
  }

  async queryByTags(filters = {}) {
    if (!fs.existsSync(this.paths.objectsDir)) return [];
    const files = fs.readdirSync(this.paths.objectsDir).filter((name) => name.endsWith('.json'));
    const items = files.map((file) => JSON.parse(fs.readFileSync(path.join(this.paths.objectsDir, file), 'utf8')));
    return items.filter((item) => {
      const obj = tagsToObject(item.tags || []);
      return Object.entries(filters).every(([name, value]) => obj[name] === String(value));
    }).sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
  }
}

// ============================================================================
// HyperBEAM Transport — Device-Model Architecture
// ============================================================================

/**
 * HyperBEAM Transport using native devices for all operations.
 *
 * Publish pipeline:  ~bundler@1.0 (ANS-104 codec) → match index auto-built
 * Query pipeline:   ~query@1.0 (tag-based search) + ~match@1.0 (reverse index)
 * Fetch pipeline:    GET /{id} via httpsig@1.0 formatter (tags as headers)
 * Consensus:        lua@5.3a device (on-node compute) with query fallback
 * Push:             ~push@1.0 (message routing to processes)
 * Attestations:     ~match@1.0/Attestation-Target={id} (reverse lookup)
 * References:       ~reference@1.0 (mutable pointers for article versioning)
 * Node info:        ~meta@1.0/info
 *
 * Reference@1.0 gives PermaBrain articles stable, mutable pointers:
 * - Article key → reference → latest version DataItem ID
 * - Topic index → reference set → { "ai": ref_id, "crypto": ref_id, ... }
 * - Author identity → reference → latest attestation
 *
 * This is the recommended approach from Sam Williams (@samcamwilliams):
 * using ~reference@1.0 for PermaBrain nodes instead of relying solely
 * on the match index. References provide:
 * - Composable resolution chains through nested references
 * - Each reference independently owned and updated by its authority
 * - First-class caching and freshness via max-age
 *
 * Arweave serves as the underlying persistence layer; HyperBEAM
 * devices provide indexing, querying, and compute on top.
 */
export class HyperbeamTransport {
  constructor(config) {
    this.config = config;
    this.baseUrl = config.gateway?.dataUrl || 'http://localhost:10000';
    this.graphqlUrl = config.gateway?.graphqlUrl || `${this.baseUrl}/graphql`;
    this._bundlerUploadUrl = config.bundler?.uploadUrl || bundlerUploadUrl(this.baseUrl);
    this.query = new HyperbeamQuery(this.baseUrl);
    this.consensus = new HyperbeamConsensus(this.baseUrl, {
      consensusProcessId: config.consensus?.processId,
    });
    this.reference = new HyperbeamReference(this.baseUrl, config.reference);
  }

  // --- Device: ~bundler@1.0 ---

  /**
   * Probe HyperBEAM node health and device availability.
   * Checks: health, bundler, fetch-by-id, query, match, meta, GraphQL.
   */
  async probe(url = this.baseUrl) {
    const checks = [];
    async function check(name, endpoint, options) {
      try {
        const res = await fetch(endpoint, options);
        const ok = res.ok || (res.status >= 300 && res.status < 400);
        checks.push({ name, endpoint, ok, status: res.status });
      } catch (err) {
        checks.push({ name, endpoint, ok: false, error: err.message });
      }
    }

    await check('health', url, { method: 'GET' });
    await check('bundler-upload', this._bundlerUploadUrl, { method: 'OPTIONS' });
    await check('fetch-by-id', fetchUrl(url, '__permabrain_probe_missing__'), { method: 'GET' });
    await check('query-device', `${url}/${DEVICES.query}?App-Name=PermaBrain&return=boolean`, { method: 'GET' });
    await check('match-device', `${url}/${DEVICES.match}/App-Name=PermaBrain`, { method: 'GET' });
    await check('meta-info', metaUrl(url), { method: 'GET' });
    await check('graphql', this.graphqlUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: '{ transactions(first: 1) { edges { node { id } } } }' })
    });

    return { url, checks, ok: checks.some((c) => c.name === 'health' && c.ok) };
  }

  /**
   * Upload a DataItem via the bundler device.
   * Uses ANS-104 codec: POST /~bundler@1.0/tx?codec-device=ans104@1.0
   *
   * After upload, the bundler auto-indexes all tags into the match device,
   * making the item queryable by any tag key-value pair.
   */
  async uploadDataItem(item) {
    const bytes = rawDataItemBytes(item);
    const res = await fetch(this._bundlerUploadUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: new Blob([bytes], { type: 'application/octet-stream' })
    });
    if (!res.ok) throw new Error(`HyperBEAM bundler upload failed: HTTP ${res.status} ${await res.text().catch(() => '')}`);
    return { id: item.id, status: 'uploaded', response: await res.text().catch(() => '') };
  }

  // --- Device: message@1.0 (fetch via httpsig@1.0 formatter) ---

  /**
   * Fetch a data item by ID. HyperBEAM returns items via the HTTP-SIG formatter:
   * tags appear as response headers, content in the body.
   * Falls back to ANS-104 binary parsing for non-HyperBEAM responses.
   */
  async fetchDataItem(id) {
    const url = fetchUrl(this.baseUrl, id);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HyperBEAM fetch failed for ${id}: HTTP ${res.status}`);

    // Try HTTP-SIG formatter: tags as response headers
    const headerTags = parseHttpsigtHeaders(res.headers);

    if (headerTags.length > 0) {
      const body = await res.text();
      return {
        format: FORMATTERS.httpsig,
        id,
        tags: headerTags,
        payload: body,
        payloadBase64: Buffer.from(body).toString('base64url'),
      };
    }

    // Fall back to ANS-104 binary parsing
    const bytes = Buffer.from(await res.arrayBuffer());
    const text = bytes.toString('utf8');
    try { return JSON.parse(text); }
    catch {
      const parsed = parseAns104(bytes);
      return {
        format: FORMATTERS.ans104,
        id: parsed.id,
        owner: parsed.owner,
        tags: parsed.tags,
        payloadBase64: Buffer.from(parsed.rawData).toString('base64url'),
        ans104Base64: bytes.toString('base64url'),
        signature: parsed.signature,
        publicKey: parsed.owner
      };
    }
  }

  /**
   * Fetch raw content by ID.
   */
  async fetchData(id) {
    return payloadBuffer(await this.fetchDataItem(id));
  }

  // --- Device: ~query@1.0 + ~match@1.0 ---

  /**
   * Query by tags. Uses HyperBEAM's query device by default when available,
   * falls back to GraphQL.
   *
   * @param {Object} filters - Key-value tag filters
   * @param {Object} [opts] - Options
   * @param {boolean} [opts.useQueryDevice=true] - Use ~query@1.0 device (falls back to GraphQL)
   */
  async queryByTags(filters = {}, opts = {}) {
    const useQueryDevice = opts.useQueryDevice !== false && this.config.gateway?.dataUrl;

    if (useQueryDevice) {
      try {
        const results = await this.query.findArticles(filters);
        if (Array.isArray(results)) {
          return results.map(r => {
            if (typeof r === 'string') return { id: r };
            if (r.tags) {
              const tagMap = tagsToObject(r.tags);
              return { id: r.id || tagMap.id, tags: r.tags, ...tagMap };
            }
            return r;
          });
        }
        return results;
      } catch (err) {
        console.warn(`HyperBEAM query device failed, falling back to GraphQL: ${err.message}`);
      }
    }

    return this.queryByTagsGraphQL(filters);
  }

  /**
   * GraphQL fallback for tag-based queries.
   * Used when HyperBEAM's query device is not available or returns errors.
   */
  async queryByTagsGraphQL(filters = {}) {
    const tags = Object.entries(filters).map(([name, value]) => ({ name, values: [String(value)] }));
    const first = Number(this.config.gateway?.pageSize || 100);
    const maxPages = Number(this.config.gateway?.maxPages || 1000);
    const query = `query($tags: [TagFilter!], $first: Int!, $after: String) { transactions(first: $first, after: $after, tags: $tags) { edges { cursor node { id tags { name value } } } pageInfo { hasNextPage endCursor } } }`;
    const nodes = [];
    const seen = new Set();
    let after = null;
    for (let page = 0; page < maxPages; page++) {
      const res = await fetch(this.graphqlUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query, variables: { tags, first, after } })
      });
      if (!res.ok) throw new Error(`GraphQL failed: HTTP ${res.status}`);
      const json = await res.json();
      if (json.errors?.length) throw new Error(`GraphQL error: ${json.errors.map((err) => err.message || String(err)).join('; ')}`);
      const transactions = json.data?.transactions;
      for (const edge of transactions?.edges || []) {
        if (!edge.node?.id || seen.has(edge.node.id)) continue;
        seen.add(edge.node.id);
        nodes.push(edge.node);
      }
      if (!transactions?.pageInfo?.hasNextPage) return nodes;
      after = transactions.pageInfo.endCursor || transactions.edges?.at(-1)?.cursor;
      if (!after) throw new Error('GraphQL pagination: missing endCursor');
    }
    throw new Error(`GraphQL pagination exceeded ${maxPages} pages`);
  }

  /**
   * Find attestations for a specific article via the match device.
   */
  async findAttestations(articleId) {
    return this.query.findAttestations(articleId);
  }

  // --- Device: lua@5.3a (consensus) ---

  /**
   * Compute consensus for an article.
   * Uses Lua device if available, falls back to query-based computation.
   */
  async computeConsensus(articleId) {
    return this.consensus.compute(articleId);
  }

  // --- Device: ~push@1.0 ---

  /**
   * Push a message to an AO process via the push device.
   * Format: POST /{scheduler}~push@1.0
   *
   * The push device routes messages to the specified process/scheduler.
   * It handles initialization of new processes and recursive message
   * forwarding (fan-out to downstream processes).
   */
  async pushMessage({ scheduler, data, tags, signer }) {
    const url = pushUrl(this.baseUrl, scheduler);

    // Build the push request as an HTTP-SIG message
    const headers = { 'content-type': 'application/octet-stream' };
    for (const tag of tags || []) {
      headers[titleToKebabCase(tag.name)] = tag.value;
    }

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: data,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`HyperBEAM push failed: HTTP ${res.status} ${body}`);
    }

    const result = await res.json().catch(() => ({}));
    return { status: 'pushed', response: result };
  }

  // --- Device: ~process@1.0 ---

  /**
   * Resolve an AO process via the process device.
   * Format: GET /{processId}~process@1.0/{key}
   */
  async resolveProcess(processId, key = 'now') {
    const url = processUrl(this.baseUrl, processId, key);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Process resolution failed for ${processId}: HTTP ${res.status}`);
    return res.json();
  }

  // --- Device: ~meta@1.0 ---

  /**
   * Get HyperBEAM node metadata.
   * Format: GET /~meta@1.0/info
   */
  async metaInfo() {
    const url = metaUrl(this.baseUrl);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Meta info failed: HTTP ${res.status}`);
    return res.json();
  }

  // --- Node info / whois ---

  /**
   * Look up an agent's identity via the whois device.
   * Format: GET /~whois@1.0/{address}
   */
  async whois(address) {
    const url = `${this.baseUrl}/${DEVICES.whois}/${encodeURIComponent(address)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Whois failed for ${address}: HTTP ${res.status}`);
    return res.json();
  }

  // --- Device: ~reference@1.0 ---

  /**
   * Create a new reference on the HyperBEAM node.
   * Wrapper around HyperbeamReference.create.
   */
  async createReference(value, signer, opts = {}) {
    return this.reference.create(value, signer, opts);
  }

  /**
   * Update an existing reference on the HyperBEAM node.
   * Wrapper around HyperbeamReference.update.
   */
  async updateReference(referenceId, value, signer, opts = {}) {
    return this.reference.update(referenceId, value, signer, opts);
  }

  /**
   * Resolve a reference's current value.
   * Wrapper around HyperbeamReference.resolve.
   */
  async resolveReference(referenceId, path = '') {
    return this.reference.resolve(referenceId, path);
  }

  /**
   * Create a PermaBrain article reference.
   * Wrapper around HyperbeamReference.createArticleReference.
   */
  async createArticleReference(articleKey, articleId, signer) {
    return this.reference.createArticleReference(articleKey, articleId, signer);
  }

  /**
   * Update a PermaBrain article reference to point to a new version.
   * Wrapper around HyperbeamReference.updateArticleReference.
   */
  async updateArticleReference(referenceId, newArticleId, signer) {
    return this.reference.updateArticleReference(referenceId, newArticleId, signer);
  }
}

// ============================================================================
// Arweave Transport
// ============================================================================

export class ArweaveTransport {
  constructor(config) {
    this.config = config;
    this.graphqlUrl = config.gateway?.graphqlUrl || 'https://arweave.net/graphql';
    this.dataUrl = config.gateway?.dataUrl || 'https://arweave.net';
    this.uploadUrl = config.bundler?.uploadUrl || 'https://up.arweave.net/tx';
  }

  async uploadDataItem(item) {
    const bytes = rawDataItemBytes(item);
    const res = await fetch(this.uploadUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: new Blob([bytes], { type: 'application/octet-stream' })
    });
    if (!res.ok) throw new Error(`Arweave upload failed: HTTP ${res.status} ${await res.text().catch(() => '')}`);
    return { id: item.id, status: 'uploaded', response: await res.text().catch(() => '') };
  }

  async fetchDataItem(id) {
    const contentRes = await fetch(`${this.dataUrl}/${encodeURIComponent(id)}`);
    if (!contentRes.ok) throw new Error(`Arweave content fetch failed for ${id}: HTTP ${contentRes.status}`);
    const content = await contentRes.text();

    const tagQuery = `query($id: ID!) { transaction(id: $id) { id owner { address } tags { name value } } }`;
    const tagRes = await fetch(this.graphqlUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: tagQuery, variables: { id } })
    });
    if (!tagRes.ok) throw new Error(`Arweave GraphQL tag fetch failed for ${id}: HTTP ${tagRes.status}`);
    const tagJson = await tagRes.json();
    if (tagJson.errors?.length) throw new Error(`Arweave GraphQL error: ${tagJson.errors.map((e) => e.message || String(e)).join('; ')}`);
    const txNode = tagJson.data?.transaction;
    if (!txNode) throw new Error(`Arweave transaction not found: ${id}`);

    return {
      id: txNode.id,
      owner: txNode.owner?.address || txNode.owner || '',
      timestamp: '',
      tags: txNode.tags || [],
      payloadBase64: Buffer.from(content, 'utf8').toString('base64url'),
    };
  }

  async fetchData(id) {
    const res = await fetch(`${this.dataUrl}/${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error(`Arweave data fetch failed for ${id}: HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  async queryByTags(filters = {}) {
    const tags = Object.entries(filters).map(([name, value]) => ({ name, values: [String(value)] }));
    const first = Number(this.config.gateway?.pageSize || 100);
    const maxPages = Number(this.config.gateway?.maxPages || 100);
    const query = `query($tags: [TagFilter!], $first: Int!, $after: String) { transactions(first: $first, after: $after, tags: $tags) { edges { cursor node { id tags { name value } } } pageInfo { hasNextPage } } }`;
    const nodes = [];
    const seen = new Set();
    let after = null;
    for (let page = 0; page < maxPages; page++) {
      const res = await fetch(this.graphqlUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query, variables: { tags, first, after } })
      });
      if (!res.ok) throw new Error(`Arweave GraphQL failed: HTTP ${res.status} ${await res.text().catch(() => '')}`);
      const json = await res.json();
      if (json.errors?.length) throw new Error(`Arweave GraphQL error: ${json.errors.map((e) => e.message || String(e)).join('; ')}`);
      const transactions = json.data?.transactions;
      const edges = transactions?.edges || [];
      for (const edge of edges) {
        if (!edge.node?.id || seen.has(edge.node.id)) continue;
        seen.add(edge.node.id);
        nodes.push(edge.node);
      }
      if (!transactions?.pageInfo?.hasNextPage || edges.length === 0) return nodes;
      after = edges[edges.length - 1].cursor;
      if (!after) return nodes;
    }
    throw new Error(`Arweave GraphQL pagination exceeded ${maxPages} pages`);
  }
}

export function itemSummary(item) {
  return { id: item.id, owner: item.owner, timestamp: item.timestamp, tags: tagsToObject(item.tags || []), text: payloadText(item) };
}