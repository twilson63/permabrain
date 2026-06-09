import fs from 'node:fs';
import path from 'node:path';
import { statePaths } from './config.mjs';
import { parseAns104, payloadBuffer, payloadText, rawDataItemBytes } from './dataitem.mjs';
import { tagsToObject } from './tags.mjs';

// AO transport removed — PermaBrain now uses Arweave GraphQL + local cache directly.
// See docs/refactor-ao-to-research-publish.md for rationale.
// CompositeTransport removed — no longer needed without AO layer.

export function getTransport(config, home) {
  if (config.transport === 'local' || config.gateway?.type === 'local' || config.bundler?.type === 'local') return new LocalTransport(home);
  if (config.transport === 'arweave' || config.gateway?.type === 'arweave') return new ArweaveTransport(config);
  if (config.transport === 'hyperbeam') return new HyperbeamTransport(config);
  // Default fallback: try Arweave
  return new ArweaveTransport(config);
}

// ============================================================================
// HyperBEAM Devices & Formatters
// ============================================================================

/**
 * HyperBEAM device paths and formatter identifiers.
 *
 * In the HyperBEAM architecture, devices are named services that handle
 * specific operations. Formatters define how data is encoded/decoded.
 * PermaBrain uses these devices for its publish/query/attest pipeline:
 *
 * Publish pipeline:
 *   Article/Attestation DataItem → ~bundler@1.0/tx (persist + index)
 *   AO Process message → ~push@1.0 (submit, no retrieval)
 *
 * Query pipeline:
 *   GET /{id} → HTTP-SIG formatter (httpsig@1.0) returns tags as headers
 *   GET /{scheduler}~process@1.0/now → process resolution (when compute available)
 *   POST /graphql → GraphQL query for tag-based searches
 *
 * GET canonical string for signing: path only, no query params.
 * POST canonical string: full path including page ID.
 */
const HB_DEVICES = {
  /** Bundler device — persists data items and makes them fetchable */
  bundler: '~bundler@1.0',
  /** Push device — submits messages to AO processes (no auto-index) */
  push: '~push@1.0',
  /** Process device — resolves AO process state */
  process: '~process@1.0',
  /** Meta device — node metadata */
  meta: '~meta@1.0',
};

const HB_FORMATTERS = {
  /** ANS-104 codec for bundler uploads */
  ans104: 'ans104@1.0',
  /** HTTP-SIG format for data item responses */
  httpsig: 'httpsig@1.0',
};

/**
 * Build a HyperBEAM bundler upload URL from a base URL.
 * Format: {base}/~bundler@1.0/tx?codec-device=ans104@1.0
 */
function bundlerUrl(baseUrl) {
  return `${baseUrl}/${HB_DEVICES.bundler}/tx?codec-device=${HB_FORMATTERS.ans104}`;
}

/**
 * Build a HyperBEAM push URL for a given scheduler/process.
 * Format: {base}/{scheduler}~push@1.0
 */
function pushUrl(baseUrl, scheduler) {
  return `${baseUrl}/${scheduler}${HB_DEVICES.push}`;
}

/**
 * Build a HyperBEAM process resolution URL.
 * Format: {base}/{process}~process@1.0/now
 */
function processUrl(baseUrl, processId) {
  return `${baseUrl}/${processId}${HB_DEVICES.process}/now`;
}

/**
 * Build a HyperBEAM meta info URL.
 * Format: {base}/~meta@1.0/info
 */
function metaUrl(baseUrl) {
  return `${baseUrl}/${HB_DEVICES.meta}/info`;
}

/**
 * Parse HTTP-SIG response headers into PermaBrain tags.
 * HyperBEAM returns data items via the HTTP-SIG formatter: tags become
 * response headers (lowercase kebab-case), content in the body.
 *
 * Known PermaBrain/Arweave tag prefixes are converted from kebab-case
 * to Title-Case (e.g., 'article-key' → 'Article-Key').
 */
function parseHttpsigtHeaders(headers) {
  const knownPrefixes = [
    'article-', 'app-', 'permabrain-', 'content-', 'data-protocol',
    'type', 'module', 'scheduler', 'visibility', 'author-agent-id',
    'attestation-', 'perma-brain'
  ];
  const tags = [];
  for (const [key, value] of headers.entries()) {
    if (knownPrefixes.some(p => key.startsWith(p) || key === p)) {
      const tagName = key.split('-').map((s) => {
        if (['id', 'url', 'api'].includes(s)) return s.toUpperCase();
        return s.charAt(0).toUpperCase() + s.slice(1);
      }).join('-');
      tags.push({ name: tagName, value });
    }
  }
  return tags;
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
// HyperBEAM Transport
// ============================================================================

export class HyperbeamTransport {
  constructor(config) {
    this.config = config;
    this.baseUrl = config.gateway?.dataUrl || 'http://localhost:10000';
    // Pre-compute device URLs from base
    this._bundlerUploadUrl = config.bundler?.uploadUrl || bundlerUrl(this.baseUrl);
  }

  // --- Device routing helpers ---

  /**
   * Probe HyperBEAM node health and device availability.
   * Checks: health, GraphQL, bundler upload, fetch-by-id, meta info.
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
    // Health check
    await check('health', url, { method: 'GET' });
    // GraphQL device
    await check('graphql', this.config.gateway?.graphqlUrl || `${url}/graphql`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: '{ transactions(first: 1) { edges { node { id } } } }' })
    });
    // Fetch-by-id (404 is fine — proves gateway responds)
    await check('fetch-by-id', `${url}/__permabrain_probe_missing__`, { method: 'GET' });
    // Bundler device upload
    await check('bundler-upload', this._bundlerUploadUrl, { method: 'OPTIONS' });
    // Meta device
    await check('meta-info', metaUrl(url), { method: 'GET' });
    return { url, checks, ok: checks.some((c) => c.name === 'health' && c.ok) };
  }

  // --- Publish pipeline: ~bundler@1.0 ---

  /**
   * Upload a DataItem via the bundler device.
   * Uses ANS-104 codec: POST /~bundler@1.0/tx?codec-device=ans104@1.0
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

  // --- Query pipeline: GET /{id} with httpsig@1.0 formatter ---

  /**
   * Fetch a data item by ID. HyperBEAM returns items via the HTTP-SIG formatter:
   * tags appear as response headers, content in the body.
   * Falls back to ANS-104 binary parsing for non-HyperBEAM responses.
   */
  async fetchDataItem(id) {
    const res = await fetch(`${this.config.gateway.dataUrl}/${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error(`HyperBEAM fetch failed for ${id}: HTTP ${res.status}`);

    // Try HTTP-SIG formatter: tags as response headers
    const headerTags = parseHttpsigtHeaders(res.headers);

    if (headerTags.length > 0) {
      // HyperBEAM returned the item via httpsig@1.0 formatter
      const body = await res.text();
      return {
        format: HB_FORMATTERS.httpsig,
        id,
        tags: headerTags,
        payload: body,
        payloadBase64: Buffer.from(body).toString('base64url'),
      };
    }

    // Fall back to ANS-104 binary parsing (gateway returned raw binary)
    const bytes = Buffer.from(await res.arrayBuffer());
    const text = bytes.toString('utf8');
    try { return JSON.parse(text); }
    catch {
      const parsed = parseAns104(bytes);
      return {
        format: HB_FORMATTERS.ans104,
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
   * Fetch raw content by ID. Returns the payload buffer.
   */
  async fetchData(id) {
    return payloadBuffer(await this.fetchDataItem(id));
  }

  // --- Query pipeline: GraphQL ---

  /**
   * Query by tags via GraphQL. Uses edge cursor pagination
   * (Arweave/HyperBEAM GraphQL doesn't support endCursor in pageInfo).
   */
  async queryByTags(filters = {}) {
    const tags = Object.entries(filters).map(([name, value]) => ({ name, values: [String(value)] }));
    const first = Number(this.config.gateway?.pageSize || 100);
    const maxPages = Number(this.config.gateway?.maxPages || 1000);
    const query = `query($tags: [TagFilter!], $first: Int!, $after: String) { transactions(first: $first, after: $after, tags: $tags) { edges { cursor node { id tags { name value } } } pageInfo { hasNextPage endCursor } } }`;
    const nodes = [];
    const seen = new Set();
    let after = null;
    for (let page = 0; page < maxPages; page++) {
      const res = await fetch(this.config.gateway.graphqlUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query, variables: { tags, first, after } })
      });
      if (!res.ok) throw new Error(`HyperBEAM GraphQL failed: HTTP ${res.status}`);
      const json = await res.json();
      if (json.errors?.length) throw new Error(`HyperBEAM GraphQL failed: ${json.errors.map((err) => err.message || String(err)).join('; ')}`);
      const transactions = json.data?.transactions;
      for (const edge of transactions?.edges || []) {
        if (!edge.node?.id || seen.has(edge.node.id)) continue;
        seen.add(edge.node.id);
        nodes.push(edge.node);
      }
      if (!transactions?.pageInfo?.hasNextPage) return nodes;
      after = transactions.pageInfo.endCursor || transactions.edges?.at(-1)?.cursor;
      if (!after) throw new Error('HyperBEAM GraphQL pagination failed: missing endCursor');
    }
    throw new Error(`HyperBEAM GraphQL pagination exceeded ${maxPages} pages`);
  }

  // --- Future: ~push@1.0 for AO process messages ---

  /**
   * Push a message to an AO process via the push device.
   * Format: POST /{scheduler}~push@1.0
   *
   * NOTE: This is reserved for future use when HyperBEAM process computation
   * is available. Currently, ~process@1.0/now returns 500 on most nodes
   * because WASM runtime is not enabled.
   */
  async pushMessage({ scheduler, data, tags, signer }) {
    // Will be implemented when process compute is available
    throw new Error('HyperBEAM pushMessage not yet implemented. Use bundler upload for articles/attestations.');
  }

  // --- Future: ~process@1.0 for process resolution ---

  /**
   * Resolve an AO process via the process device.
   * Format: GET /{processId}~process@1.0/now
   *
   * NOTE: Requires WASM runtime on the HyperBEAM node. Most nodes don't
   * have this enabled, so this will return 500 until compute is available.
   */
  async resolveProcess(processId) {
    const url = processUrl(this.baseUrl, processId);
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`HyperBEAM process resolution failed for ${processId}: HTTP ${res.status}`);
    }
    return res.json();
  }

  // --- Future: ~meta@1.0 for node info ---

  /**
   * Get HyperBEAM node metadata via the meta device.
   * Format: GET /~meta@1.0/info
   */
  async metaInfo() {
    const url = metaUrl(this.baseUrl);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HyperBEAM meta info failed: HTTP ${res.status}`);
    return res.json();
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
    // Arweave gateways serve decoded content, not raw ANS-104 binary.
    // Strategy: fetch tags from GraphQL, fetch content from gateway, reconstruct item.
    const contentRes = await fetch(`${this.dataUrl}/${encodeURIComponent(id)}`);
    if (!contentRes.ok) throw new Error(`Arweave content fetch failed for ${id}: HTTP ${contentRes.status}`);
    const content = await contentRes.text();

    // Fetch tags from GraphQL
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
      timestamp: '', // Not available from GraphQL without block data
      tags: txNode.tags || [],
      payloadBase64: Buffer.from(content, 'utf8').toString('base64url'),
      // No ans104Base64 since we don't have the raw binary
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
    // Arweave GraphQL does NOT support `endCursor` in pageInfo or `order` on transactions.
    // Use edge cursors for pagination instead.
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

export { HB_DEVICES, HB_FORMATTERS, bundlerUrl, pushUrl, processUrl, metaUrl, parseHttpsigtHeaders };