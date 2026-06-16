import { HyperbeamQuery } from './hb-query.mjs';
import { HyperbeamConsensus } from './hb-consensus.mjs';
import { HyperbeamReference } from './hb-reference.mjs';
import {
  DEVICES, FORMATTERS,
  bundlerUploadUrl, fetchUrl, pushUrl, processUrl, metaUrl,
  parseHttpsigtHeaders, titleToKebabCase,
} from './hb-devices.mjs';
import { rawDataItemBytes } from './dataitem.mjs';
import { validateHyperbeamConfig } from './config.mjs';
import { resilientCall } from './resilience.mjs';

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
  constructor(config, opts = {}) {
    this.config = config;
    validateHyperbeamConfig(config);
    this.baseUrl = config.gateway?.dataUrl || 'http://localhost:10000';
    this.graphqlUrl = config.gateway?.graphqlUrl || `${this.baseUrl}/graphql`;
    this._bundlerUploadUrl = config.bundler?.uploadUrl || bundlerUploadUrl(this.baseUrl);
    this.query = new HyperbeamQuery(this.baseUrl, { breakers: opts.breakers });
    this.consensus = new HyperbeamConsensus(this.baseUrl, {
      consensusProcessId: config.consensus?.processId,
      breakers: opts.breakers,
    });
    this.reference = new HyperbeamReference(this.baseUrl, config.reference, { breakers: opts.breakers });
    this.breakers = opts.breakers;
  }

  _breaker(name) {
    return this.breakers?.get(name) || null;
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

    const breakerStatus = this.breakers?.status ? this.breakers.status() : {};
    return { url, transport: 'hyperbeam', checks, circuitBreakers: breakerStatus, ok: checks.some((c) => c.name === 'health' && c.ok) };
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
    return resilientCall(async () => {
      const res = await fetch(this._bundlerUploadUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        body: new Blob([bytes], { type: 'application/octet-stream' })
      });
      if (!res.ok) {
        const err = new Error(`HyperBEAM bundler upload failed: HTTP ${res.status} ${await res.text().catch(() => '')}`);
        err.status = res.status;
        throw err;
      }
      return { id: item.id, status: 'uploaded', response: await res.text().catch(() => '') };
    }, { breaker: this._breaker('hyperbeam:upload'), label: 'hyperbeam:upload', retryOptions: { maxAttempts: 3, baseDelayMs: 250 } });
  }

  // --- Device: message@1.0 (fetch via httpsig@1.0 formatter) ---

  /**
   * Fetch a data item by ID. HyperBEAM returns items via the HTTP-SIG formatter:
   * tags appear as response headers, content in the body.
   * Falls back to ANS-104 binary parsing for non-HyperBEAM responses.
   */
  async fetchDataItem(id) {
    return resilientCall(async () => {
      const url = fetchUrl(this.baseUrl, id);
      const res = await fetch(url);
      if (!res.ok) {
        const err = new Error(`HyperBEAM fetch failed for ${id}: HTTP ${res.status}`);
        err.status = res.status;
        throw err;
      }

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
        const { parseAns104 } = await import('./dataitem.mjs');
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
    }, { breaker: this._breaker('hyperbeam:fetch'), label: 'hyperbeam:fetch', retryOptions: { maxAttempts: 3, baseDelayMs: 250 } });
  }

  /**
   * Fetch raw content by ID. Uses the same HTTP-SIG endpoint as fetchDataItem
   * but returns only the raw body bytes, falling back to a direct GET if the
   * endpoint does not expose headers.
   */
  async fetchData(id) {
    return resilientCall(async () => {
      const item = await this.fetchDataItem(id);
      if (item.format === FORMATTERS.httpsig && typeof item.payload === 'string') {
        return Buffer.from(item.payload, 'utf8');
      }
      return payloadBuffer(item);
    }, { breaker: this._breaker('hyperbeam:fetch'), label: 'hyperbeam:fetch', retryOptions: { maxAttempts: 3, baseDelayMs: 250 } });
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
              const tagMap = {};
              for (const t of r.tags) tagMap[t.name] = t.value;
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
    return resilientCall(async () => {
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
        if (!res.ok) {
          const err = new Error(`GraphQL failed: HTTP ${res.status}`);
          err.status = res.status;
          throw err;
        }
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
    }, { breaker: this._breaker('hyperbeam:query'), label: 'hyperbeam:query', retryOptions: { maxAttempts: 3, baseDelayMs: 250 } });
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
