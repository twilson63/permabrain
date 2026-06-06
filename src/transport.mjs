import fs from 'node:fs';
import path from 'node:path';
import { statePaths } from './config.mjs';
import { parseAns104, payloadBuffer, payloadText, rawDataItemBytes } from './dataitem.mjs';
import { tagsToObject } from './tags.mjs';

export function getTransport(config, home) {
  if (config.transport === 'local' || config.gateway?.type === 'local' || config.bundler?.type === 'local') return new LocalTransport(home);
  if (config.transport === 'arweave' || config.gateway?.type === 'arweave') return new ArweaveTransport(config);
  return new HyperbeamTransport(config);
}

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

export class HyperbeamTransport {
  constructor(config) {
    this.config = config;
  }

  async probe(url = this.config.gateway?.dataUrl || 'http://localhost:10000') {
    const checks = [];
    async function check(name, endpoint, options) {
      try {
        const res = await fetch(endpoint, options);
        checks.push({ name, endpoint, ok: res.ok, status: res.status });
      } catch (err) {
        checks.push({ name, endpoint, ok: false, error: err.message });
      }
    }
    await check('health', url, { method: 'GET' });
    await check('graphql', this.config.gateway?.graphqlUrl || `${url}/graphql`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: '{ transactions(first: 1) { edges { node { id } } } }' }) });
    await check('fetch-by-id', `${this.config.gateway?.dataUrl || url}/__permabrain_probe_missing__`, { method: 'GET' });
    await check('upload', this.config.bundler?.uploadUrl || `${url}/~bundler@1.0/tx?codec-device=ans104@1.0`, { method: 'OPTIONS' });
    return { url, checks, ok: checks.some((c) => c.name === 'health' && c.ok) };
  }

  async uploadDataItem(item) {
    const bytes = rawDataItemBytes(item);
    const res = await fetch(this.config.bundler.uploadUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: new Blob([bytes], { type: 'application/octet-stream' })
    });
    if (!res.ok) throw new Error(`HyperBEAM upload failed: HTTP ${res.status} ${await res.text().catch(() => '')}`);
    return { id: item.id, status: 'uploaded', response: await res.text().catch(() => '') };
  }

  async fetchDataItem(id) {
    const res = await fetch(`${this.config.gateway.dataUrl}/${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error(`HyperBEAM fetch failed for ${id}: HTTP ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    const text = bytes.toString('utf8');
    try { return JSON.parse(text); }
    catch {
      const parsed = parseAns104(bytes);
      return {
        format: 'ans104@1.0',
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

  async fetchData(id) {
    return payloadBuffer(await this.fetchDataItem(id));
  }

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
}

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
