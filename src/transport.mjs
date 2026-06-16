import fs from 'node:fs';
import path from 'node:path';
import { statePaths } from './config.mjs';
import { parseAns104, payloadBuffer, payloadText, rawDataItemBytes } from './dataitem.mjs';
import { tagsToObject } from './tags.mjs';
import { HyperbeamTransport as ExternalHyperbeamTransport } from './hyperbeam-transport.mjs';
import { CircuitBreakerRegistry, resilientCall } from './resilience.mjs';
import { getMetrics } from './metrics.mjs';
import { summarizeArticle, latestByArticleKey } from './cache.mjs';

const globalBreakers = new CircuitBreakerRegistry({
  failureThreshold: 5,
  recoveryTimeoutMs: 30000,
  halfOpenMaxAttempts: 3,
});

export function getTransport(config, home, opts = {}) {
  if (opts.useHyperbeam) return new ExternalHyperbeamTransport(configForHyperbeam(config), { breakers: globalBreakers });
  if (config.transport === 'local' || config.gateway?.type === 'local' || config.bundler?.type === 'local') return new LocalTransport(home);
  if (config.transport === 'arweave' || config.gateway?.type === 'arweave') return new ArweaveTransport(config, { breakers: globalBreakers });
  if (config.transport === 'hyperbeam') return new ExternalHyperbeamTransport(config, { breakers: globalBreakers });
  // Default fallback: Arweave
  return new ArweaveTransport(config, { breakers: globalBreakers });
}

export function getCircuitBreakerStatus() {
  return globalBreakers.status();
}

export function getTransportMetrics() {
  return getMetrics().status();
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

  async localIndex() {
    if (!fs.existsSync(this.paths.objectsDir)) return [];
    const files = fs.readdirSync(this.paths.objectsDir).filter((name) => name.endsWith('.json'));
    return files
      .map((file) => JSON.parse(fs.readFileSync(path.join(this.paths.objectsDir, file), 'utf8')))
      .filter((item) => tagsToObject(item.tags || [])['PermaBrain-Type'] === 'article')
      .map(summarizeArticle);
  }

  async queryByKey(key) {
    const items = await this.queryByTags({ 'App-Name': 'PermaBrain', 'PermaBrain-Type': 'article', 'Article-Key': key });
    const latest = latestByArticleKey(items).get(key);
    if (!latest) return null;
    return { summary: summarizeArticle(latest) };
  }

  async getItem(id) {
    return this.fetchDataItem(id);
  }

  async submit(raw) {
    const parsed = parseAns104(raw);
    const item = {
      format: 'ans104@1.0',
      id: parsed.id,
      owner: parsed.owner,
      timestamp: new Date().toISOString(),
      tags: parsed.tags,
      payloadBase64: parsed.rawData.toString('base64url'),
      ans104Base64: raw.toString('base64url'),
      signature: parsed.signature,
      publicKey: parsed.owner
    };
    return this.uploadDataItem(item);
  }

  async query({ tags = [], cursor, limit = 100 } = {}) {
    const filters = {};
    for (let i = 0; i < tags.length; i += 2) {
      filters[tags[i]] = tags[i + 1];
    }
    const items = await this.queryByTags(filters);
    const start = cursor || 0;
    const slice = items.slice(start, start + limit);
    return { items: slice.map(summarizeArticle), cursor: start + slice.length < items.length ? start + slice.length : null };
  }

  /**
   * Probe local transport health.
   * Validates that the state directory is writable/readable.
   */
  async probe(url = `file://${this.paths.home || this.paths.objectsDir.replace(/\/cache\/objects$/, '')}`) {
    try {
      fs.mkdirSync(this.paths.objectsDir, { recursive: true });
      const probeFile = path.join(this.paths.objectsDir, '.permabrain-probe');
      fs.writeFileSync(probeFile, 'ok');
      const read = fs.readFileSync(probeFile, 'utf8');
      fs.unlinkSync(probeFile);
      return {
        url,
        transport: 'local',
        ok: read === 'ok',
        checks: [{ name: 'local-state', ok: true, endpoint: this.paths.objectsDir }]
      };
    } catch (err) {
      return {
        url,
        transport: 'local',
        ok: false,
        checks: [{ name: 'local-state', ok: false, endpoint: this.paths.objectsDir, error: err.message }]
      };
    }
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
// Re-export the external transport so all importers continue to work.
export { HyperbeamTransport } from './hyperbeam-transport.mjs';

// ============================================================================
// Arweave Transport
// ============================================================================

export class ArweaveTransport {
  constructor(config, opts = {}) {
    this.config = config;
    this.graphqlUrl = config.gateway?.graphqlUrl || 'https://arweave.net/graphql';
    this.dataUrl = config.gateway?.dataUrl || 'https://arweave.net';
    this.uploadUrl = config.bundler?.uploadUrl || 'https://up.arweave.net/tx';
    this.breakers = opts.breakers;
  }

  _breaker(name) {
    return this.breakers?.get(name) || null;
  }

  /**
   * Probe Arweave transport health.
   * Checks GraphQL and data gateway reachability.
   */
  async probe(url = this.dataUrl) {
    const checks = [];
    async function check(name, endpoint, options) {
      try {
        const res = await fetch(endpoint, options);
        checks.push({ name, endpoint, ok: res.ok, status: res.status });
      } catch (err) {
        checks.push({ name, endpoint, ok: false, error: err.message });
      }
    }

    await check('gateway', this.dataUrl, { method: 'GET' });
    await check('graphql', this.graphqlUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: '{ transactions(first: 1) { edges { node { id } } } }' })
    });

    return { url, transport: 'arweave', checks, ok: checks.some((c) => c.ok) };
  }

  async uploadDataItem(item) {
    return resilientCall(async () => {
      const bytes = rawDataItemBytes(item);
      const res = await fetch(this.uploadUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        body: new Blob([bytes], { type: 'application/octet-stream' })
      });
      if (!res.ok) {
        const err = new Error(`Arweave upload failed: HTTP ${res.status} ${await res.text().catch(() => '')}`);
        err.status = res.status;
        throw err;
      }
      return { id: item.id, status: 'uploaded', response: await res.text().catch(() => '') };
    }, { breaker: this._breaker('arweave:upload'), label: 'arweave:upload', retryOptions: { maxAttempts: 3, baseDelayMs: 250 } });
  }

  async fetchDataItem(id) {
    return resilientCall(async () => {
      const contentRes = await fetch(`${this.dataUrl}/${encodeURIComponent(id)}`);
      if (!contentRes.ok) {
        const err = new Error(`Arweave content fetch failed for ${id}: HTTP ${contentRes.status}`);
        err.status = contentRes.status;
        throw err;
      }
      const content = await contentRes.text();

      const tagQuery = `query($id: ID!) { transaction(id: $id) { id owner { address } tags { name value } } }`;
      const tagRes = await fetch(this.graphqlUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: tagQuery, variables: { id } })
      });
      if (!tagRes.ok) {
        const err = new Error(`Arweave GraphQL tag fetch failed for ${id}: HTTP ${tagRes.status}`);
        err.status = tagRes.status;
        throw err;
      }
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
    }, { breaker: this._breaker('arweave:fetch'), label: 'arweave:fetch', retryOptions: { maxAttempts: 3, baseDelayMs: 250 } });
  }

  async fetchData(id) {
    return resilientCall(async () => {
      const res = await fetch(`${this.dataUrl}/${encodeURIComponent(id)}`);
      if (!res.ok) {
        const err = new Error(`Arweave data fetch failed for ${id}: HTTP ${res.status}`);
        err.status = res.status;
        throw err;
      }
      return Buffer.from(await res.arrayBuffer());
    }, { breaker: this._breaker('arweave:fetch'), label: 'arweave:fetch', retryOptions: { maxAttempts: 3, baseDelayMs: 250 } });
  }

  async queryByTags(filters = {}) {
    return resilientCall(async () => {
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
        if (!res.ok) {
          const err = new Error(`Arweave GraphQL failed: HTTP ${res.status} ${await res.text().catch(() => '')}`);
          err.status = res.status;
          throw err;
        }
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
    }, { breaker: this._breaker('arweave:query'), label: 'arweave:query', retryOptions: { maxAttempts: 3, baseDelayMs: 250 } });
  }
}

export function itemSummary(item) {
  return { id: item.id, owner: item.owner, timestamp: item.timestamp, tags: tagsToObject(item.tags || []), text: payloadText(item) };
}

export async function probeTransport(config, home, opts = {}) {
  const transport = getTransport(config, home, opts);
  if (typeof transport.probe === 'function') {
    return transport.probe(config.gateway?.dataUrl);
  }
  // Local transport: validate state directories are writable/readable.
  try {
    const testDir = path.join(home, 'cache', 'objects');
    fs.mkdirSync(testDir, { recursive: true });
    const probeFile = path.join(testDir, '.permabrain-probe');
    fs.writeFileSync(probeFile, 'ok');
    const read = fs.readFileSync(probeFile, 'utf8');
    fs.unlinkSync(probeFile);
    return {
      url: `file://${home}`,
      transport: 'local',
      ok: read === 'ok',
      checks: [{ name: 'local-state', ok: true, endpoint: testDir }]
    };
  } catch (err) {
    return {
      url: `file://${home}`,
      transport: 'local',
      ok: false,
      checks: [{ name: 'local-state', ok: false, endpoint: home, error: err.message }]
    };
  }
}