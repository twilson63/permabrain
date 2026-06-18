import { subscribeEventsOverSse, subscribeEventsOverWebSocket } from './events-client.mjs';

/**
 * PermaBrain HTTP Client SDK
 *
 * A typed wrapper around a local `permabrain serve` HTTP API.
 *
 * Usage:
 *   import { createClient } from 'permabrain';
 *   const client = createClient({ baseUrl: 'http://localhost:8765' });
 *   await client.health();
 *   const { summary } = await client.publish({ content, kind: 'subject', topic: 'ai', sourceUrl: '...' });
 *   const article = await client.get('subject/my-article');
 *   const { score } = await client.consensus('subject/my-article');
 *
 * The client mirrors the agent API surface but talks JSON over HTTP.
 * Every method returns a Promise that rejects with { status, error }
 * when the server responds with a non-2xx status code.
 */

/**
 * Create a PermaBrain HTTP API client.
 *
 * @param {Object} [options]
 * @param {string} [options.baseUrl='http://localhost:8765'] - Server base URL
 * @param {number} [options.timeoutMs=30000] - Request timeout in milliseconds
 * @param {Object} [options.headers] - Extra headers added to every request
 * @param {Function} [options.fetch=globalThis.fetch] - Fetch implementation
 * @returns {PermaBrainClient}
 */
export function createClient(options = {}) {
  const baseUrl = (options.baseUrl || 'http://localhost:8765').replace(/\/$/, '');
  const timeoutMs = options.timeoutMs ?? 30000;
  const apiKey = options.apiKey || undefined;
  const authHeaders = apiKey ? { 'authorization': `Bearer ${apiKey}` } : {};
  const defaultHeaders = { 'content-type': 'application/json', ...authHeaders, ...(options.headers || {}) };
  const fetchFn = options.fetch || globalThis.fetch;

  async function request(method, path, body, extraHeaders = {}) {
    const url = `${baseUrl}${path}`;
    const headers = { ...defaultHeaders, ...extraHeaders };
    const hasBody = body !== undefined && body !== null;
    if (method === 'GET' || method === 'DELETE') delete headers['content-type'];

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchFn(url, {
        method,
        headers,
        body: hasBody ? JSON.stringify(body) : undefined,
        signal: controller.signal
      });

      const contentType = response.headers.get('content-type') || '';
      const text = await response.text();
      const parsed = contentType.includes('application/json') && text ? JSON.parse(text) : text;

      if (!response.ok) {
        const err = new Error(parsed?.error || `HTTP ${response.status} ${response.statusText}`);
        err.status = response.status;
        err.body = parsed;
        throw err;
      }

      return parsed;
    } finally {
      clearTimeout(timer);
    }
  }

  function toQuery(params) {
    const entries = [];
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) {
        for (const v of value) entries.push([key, String(v)]);
      } else if (typeof value === 'boolean') {
        entries.push([key, value ? 'true' : 'false']);
      } else {
        entries.push([key, String(value)]);
      }
    }
    return entries.length ? `?${new URLSearchParams(entries).toString()}` : '';
  }

  const client = {
    request,
    post: (path, body, extraHeaders) => request('POST', path, body, extraHeaders),
    get: (path, extraHeaders) => request('GET', path, undefined, extraHeaders),

    /** @returns {Promise<{routes: Array}>} */
    routes: () => request('GET', '/api/v1/routes'),

    /** @returns {Promise<Object>} */
    openapi: () => request('GET', '/api/v1/openapi.json'),

    /** @returns {Promise<{ok: boolean, transport: string, agentId: string|null, home: string, streamTransport?: string, streams?: object}>} */
    health: () => request('GET', '/health'),

    /** @returns {Promise<{total: number, offset: number, limit: number, entries: Array}>} */
    requests: (filters = {}) => request('GET', `/api/v1/log/requests${toQuery(filters)}`),

    /** @returns {Promise<string>} Markdown table of recent requests. */
    requestsMarkdown: (filters = {}) => request('GET', `/api/v1/log/requests${toQuery(filters)}`, undefined, { accept: 'text/markdown' }),

    /** @returns {Promise<{home: string, agentId: string, keyType: string, config: Object}>} */
    init: (body = {}) => request('POST', '/api/v1/init', body),

    /** @returns {Promise<{articles: Array, count: number}>} */
    query: (filters = {}) => request('GET', `/api/v1/articles${toQuery(filters)}`),

    /** Alias for {@link query}. @returns {Promise<{articles: Array, count: number}>} */
    articles: (filters = {}) => request('GET', `/api/v1/articles${toQuery(filters)}`),

    /** @returns {Promise<Object>} */
    article: (key, opts = {}) => request('GET', `/api/v1/articles/${encodeURIComponent(key)}${toQuery(opts)}`),

    /** @returns {Promise<{summary: Object, item: Object, reference?: Object, encrypted: boolean, encryptionEnvelope?: Object}>} */
    publish: (body) => request('POST', '/api/v1/articles', body),

    /** Alias for {@link publish}. @returns {Promise<{summary: Object, item: Object, reference?: Object, encrypted: boolean, encryptionEnvelope?: Object}>} */
    createArticle: (body) => request('POST', '/api/v1/articles', body),

    /** @returns {Promise<Object>} */
    get: (key, opts = {}) => request('GET', `/api/v1/articles/${encodeURIComponent(key)}${toQuery(opts)}`),

    /** @returns {Promise<{summary: Object, reference?: Object}>} */
    attest: (key, body) => request('POST', `/api/v1/articles/${encodeURIComponent(key)}/attest`, body),

    /** @returns {Promise<Object>} */
    consensus: (key, opts = {}) => request('GET', `/api/v1/articles/${encodeURIComponent(key)}/consensus${toQuery(opts)}`),

    /** @returns {Promise<Object>} */
    history: (key, opts = {}) => request('GET', `/api/v1/articles/${encodeURIComponent(key)}/history${toQuery(opts)}`),

    /** @returns {Promise<Object>} */
    fork: (key, body = {}) => request('POST', `/api/v1/articles/${encodeURIComponent(key)}/fork`, body),

    /** @returns {Promise<{forks: Array, count: number}>} */
    listForks: (key, opts = {}) => request('GET', `/api/v1/articles/${encodeURIComponent(key)}/forks${toQuery(opts)}`),

    /** @returns {Promise<Object>} */
    merge: (body) => request('POST', '/api/v1/merge', body),

    /** @returns {Promise<Object>} */
    sync: (body = {}) => request('POST', '/api/v1/sync', body),

    /** @returns {Promise<Object>} */
    search: (query, opts = {}) => request('GET', `/api/v1/search${toQuery({ q: query, ...opts })}`),

    /** @returns {Promise<Object>} */
    status: (opts = {}) => request('GET', `/api/v1/status${toQuery(opts)}`),

    /** @returns {Promise<Object>} */
    activity: (opts = {}) => request('GET', `/api/v1/activity${toQuery(opts)}`),

    /** @returns {Promise<Object>} */
    topicFeed: (topic, opts = {}) => request('GET', `/api/v1/topics/${encodeURIComponent(topic)}${toQuery(opts)}`),

    /** @returns {Promise<Object>} */
    listArticles: (opts = {}) => request('GET', `/api/v1/list${toQuery(opts)}`),

    /** @returns {Promise<Object>} */
    exportArticles: (opts = {}) => request('GET', `/api/v1/export-articles${toQuery(opts)}`),

    /** @returns {Promise<Object>} */
    metrics: (opts = {}) => request('GET', `/api/v1/metrics${toQuery(opts)}`),

    /** @returns {Promise<Object>} */
    stats: (opts = {}) => request('GET', `/api/v1/stats${toQuery(opts)}`),

    /** @returns {Promise<Object>} */
    batchAttest: (body) => request('POST', '/api/v1/batch-attest', body),

    /** @returns {Promise<Object>} */
    autoImport: (body) => request('POST', '/api/v1/auto-import', body),

    /** @returns {Promise<Object>} */
    importWikipedia: (body) => request('POST', '/api/v1/import-wikipedia', body),

    /** @returns {Promise<Object>} */
    verify: (body) => request('POST', '/api/v1/verify', body),

    /** @returns {Promise<Array>} */
    remotes: () => request('GET', '/api/v1/remotes'),

    /** @returns {Promise<Object>} */
    remote: (body) => request('POST', '/api/v1/remotes', body),

    /** @returns {Promise<Object>} */
    config: (body = {}) => {
      const method = body.action === 'get' || body.action === undefined ? 'GET' : 'POST';
      if (method === 'GET') return request('GET', `/api/v1/config${toQuery(body)}`);
      return request('POST', '/api/v1/config', body);
    },

    /** @returns {Promise<Object>} */
    probe: (opts = {}) => request('GET', `/api/v1/probe${toQuery(opts)}`),

    /** @returns {Promise<Object>} */
    transportStatus: () => request('GET', '/api/v1/transport-status'),

    /** @returns {Promise<Object>} */
    localIndex: () => request('GET', '/api/v1/local-index'),

    /** @returns {Promise<Object>} */
    identity: () => request('GET', '/api/v1/identity'),

    /** @returns {Promise<Object>} */
    goal: (body) => request('POST', '/api/v1/goal', body),

    /** @returns {Promise<Object>} */
    template: (body) => request('POST', '/api/v1/template', body),

    /** @returns {Promise<Object>} */
    dashboard: (opts = {}) => request('GET', `/api/v1/dashboard${toQuery(opts)}`),

    /** @returns {Promise<string>} */
    dashboardHTML: (opts = {}) => request('GET', `/api/v1/dashboard.html${toQuery(opts)}`, undefined, { accept: 'text/html' }),

    /** @returns {Promise<Object>} */
    publishDashboard: (body) => request('POST', '/api/v1/dashboard/publish', body),

    /** @returns {Promise<Object>} */
    log: (opts = {}) => request('GET', `/api/v1/log${toQuery(opts)}`),

    /** @returns {Promise<Object>} */
    auditLog: (body) => request('POST', '/api/v1/log', body),

    /** @returns {Promise<Object>} */
    exportLog: (opts = {}) => request('GET', `/api/v1/log/export${toQuery(opts)}`, undefined, { accept: opts.format === 'jsonl' ? 'application/x-ndjson' : 'application/json' }),

    /** @returns {Promise<Object>} */
    importLog: (body) => request('POST', '/api/v1/log/import', body),

    /** @returns {Promise<Object>} */
    backups: () => request('GET', '/api/v1/backups'),

    /** @returns {Promise<Object>} */
    backup: (body) => request('POST', '/api/v1/backups', body),

    /** @returns {Promise<Object>} */
    archive: (body = {}) => request('POST', '/api/v1/archive', body),

    /** @returns {Promise<Object>} */
    restore: (body) => request('POST', '/api/v1/restore', body),

    /** @returns {Promise<Object>} */
    exportBundle: (opts = {}) => request('GET', `/api/v1/bundles${toQuery(opts)}`),

    /** @returns {Promise<Object>} */
    importBundle: (bundle, opts = {}) => request('POST', '/api/v1/bundles', { bundle, ...opts }),

    /** @returns {Promise<Object>} */
    exportAll: (opts = {}) => request('GET', `/api/v1/export-all${toQuery(opts)}`),

    /** @returns {Promise<Object>} */
    exportHistory: (key, opts = {}) => request('GET', `/api/v1/history-export${toQuery({ key, ...opts })}`),

    /** @returns {Promise<Object>} */
    importHistory: (bundle, opts = {}) => request('POST', '/api/v1/history-import', { bundle, ...opts }),

    /** @returns {Promise<Object>} */
    diff: (opts = {}) => request('GET', `/api/v1/diff${toQuery(opts)}`),

    /** @returns {Promise<Object>} */
    completion: (body = {}) => request('POST', '/api/v1/completion', body),

    /** @returns {Promise<Object>} */
    schema: () => request('GET', '/api/v1/schema'),

    /** @returns {Promise<Object>} */
    validate: (body) => request('POST', '/api/v1/validate', body),

    /** @returns {Promise<Object>} */
    validateExample: (type = 'article') => request('GET', `/api/v1/validate?type=${encodeURIComponent(type)}`),

    /** @returns {Promise<Object>} */
    createThresholdAttestation: (body) => request('POST', '/api/v1/threshold-attest', body),

    /** @returns {Promise<Object>} */
    addThresholdSigner: (signer) => {
      const { envelopeId, agentId, signature, signatureType, publicKey } = signer;
      return request('POST', '/api/v1/threshold-attest/sign', { envelopeId, signer: { agentId, signature, signatureType, publicKey } });
    },

    /** @returns {Promise<Object>} */
    finalizeThresholdAttestation: (body) => request('POST', '/api/v1/threshold-attest/finalize', body),

    /** @returns {Promise<Object>} */
    verifyThresholdEnvelope: (body) => request('POST', '/api/v1/threshold-attest/verify', body),

    /** @returns {Promise<Object>} */
    importThresholdEnvelope: (body) => request('POST', '/api/v1/threshold-attest/import', body),

    /** @returns {Promise<Object>} */
    peerInfo: () => request('GET', '/api/v1/peer/info'),

    /** @returns {Promise<Object>} */
    peerPull: (requests, opts = {}) => request('POST', '/api/v1/peer/pull', { requests, includeAttestations: opts.includeAttestations !== false }),

    /** @returns {Promise<Object>} */
    peerPush: (bundle, opts = {}) => request('POST', '/api/v1/peer/push', { bundle, verify: opts.verify !== false, skipDuplicates: opts.skipDuplicates !== false }),

    /** @returns {Promise<Object>} */
    publishEvents: (events) => request('POST', '/api/v1/events/publish', { events }),

    /** @returns {Promise<Object>} */
    subscribe: (opts = {}) => request('GET', `/api/v1/events${toQuery(opts)}`),

    /**
     * Subscribe to the live event stream (SSE by default, WebSocket optional).
     * Returns an async iterator of event objects plus a cancel() method.
     *
     * @param {Object} [opts]
     * @param {'sse'|'ws'} [opts.transport='sse']
     * @param {string|string[]} [opts.events]
     * @param {AbortSignal} [opts.signal]
     * @returns {{[Symbol.asyncIterator]: function, cancel: function}}
     */
    streamEvents: (opts = {}) => {
      const transport = opts.transport || 'sse';
      const urlPath = transport === 'ws' || transport === 'websocket' ? '/api/v1/events/ws' : '/api/v1/events/stream';
      const common = { baseUrl, apiKey: options.apiKey, events: opts.events, signal: opts.signal };
      if (transport === 'ws' || transport === 'websocket') return subscribeEventsOverWebSocket(common);
      return subscribeEventsOverSse({ ...common, url: urlPath });
    },

    /**
     * Subscribe to the live article/attestation query stream (SSE by default).
     *
     * @param {Object} [opts]
     * @param {'sse'|'ws'} [opts.transport='sse']
     * @param {string|string[]} [opts.topic]
     * @param {string|string[]} [opts.kind]
     * @param {string|string[]} [opts.agent]
     * @param {string|string[]} [opts.key]
     * @param {string|string[]} [opts.events]
     * @param {AbortSignal} [opts.signal]
     * @returns {{[Symbol.asyncIterator]: function, cancel: function}}
     */
    streamQuery: (opts = {}) => {
      const transport = opts.transport || 'sse';
      const urlPath = '/api/v1/articles/stream';
      const common = { baseUrl, apiKey: options.apiKey, signal: opts.signal };
      const params = { topic: opts.topic, kind: opts.kind, agent: opts.agent, key: opts.key, events: opts.events };
      if (transport === 'ws' || transport === 'websocket') {
        const wsUrl = baseUrl.replace(/^http/, 'ws') + urlPath + toQuery(params);
        return subscribeEventsOverWebSocket({ ...common, url: wsUrl });
      }
      return subscribeEventsOverSse({ ...common, url: urlPath + toQuery(params) });
    },

    /** @returns {Promise<Object>} */
    subscribeQuery: (opts = {}) => request('GET', `/api/v1/articles/stream${toQuery(opts)}`),

    /** @returns {Promise<Object>} */
    getThresholdEnvelope: (envelopeId) => request('GET', `/api/v1/threshold/envelope/${encodeURIComponent(envelopeId)}`),

    /** @returns {Promise<Object>} */
    shareThresholdEnvelope: (body) => request('POST', '/api/v1/threshold/envelope', body),

    /** @returns {Promise<Object>} */
    doctor: (body = {}) => request('GET', `/api/v1/doctor${toQuery(body)}`),

    /**
     * Stream live request-log entries from /api/v1/log/requests/stream.
     *
     * @param {Object} [opts]
     * @param {AbortSignal} [opts.signal]
     * @returns {{[Symbol.asyncIterator]: function, cancel: function}}
     */
    requestsStream: (opts = {}) => subscribeEventsOverSse({ baseUrl, apiKey: options.apiKey, url: '/api/v1/log/requests/stream', signal: opts.signal })

  };

  return client;
}
