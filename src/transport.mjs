import fs from 'node:fs';
import path from 'node:path';
import { statePaths } from './config.mjs';
import { payloadBuffer, payloadText, rawDataItemBytes } from './dataitem.mjs';
import { tagsToObject } from './tags.mjs';

export function getTransport(config, home) {
  if (config.transport === 'local' || config.gateway?.type === 'local' || config.bundler?.type === 'local') return new LocalTransport(home);
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
      return {
        format: 'hyperbeam-raw-fetch',
        id,
        payloadBase64: bytes.toString('base64url'),
        tags: []
      };
    }
  }

  async fetchData(id) {
    return payloadBuffer(await this.fetchDataItem(id));
  }

  async queryByTags(filters = {}) {
    const tags = Object.entries(filters).map(([name, value]) => ({ name, values: [String(value)] }));
    const query = `query($tags: [TagFilter!]) { transactions(first: 100, tags: $tags) { edges { node { id tags { name value } } } } }`;
    const res = await fetch(this.config.gateway.graphqlUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables: { tags } })
    });
    if (!res.ok) throw new Error(`HyperBEAM GraphQL failed: HTTP ${res.status}`);
    const json = await res.json();
    return json.data?.transactions?.edges?.map((edge) => edge.node) || [];
  }
}

export function itemSummary(item) {
  return { id: item.id, owner: item.owner, timestamp: item.timestamp, tags: tagsToObject(item.tags || []), text: payloadText(item) };
}
