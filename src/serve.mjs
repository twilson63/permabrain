function normalizeImportResult(result) {
  // importBundle is now unified import; article bundles return a results array,
  // while other shapes return a summary object. Normalize to a standard response.
  if (!result) return { imported: 0, skipped: 0, failed: 0, type: 'unknown' };
  if (Array.isArray(result)) {
    return {
      type: 'article-bundle',
      imported: result.filter((r) => r.ok && r.imported).length,
      skipped: result.filter((r) => r.ok && !r.imported).length,
      failed: result.filter((r) => !r.ok).length,
      results: result
    };
  }
  if (result.results) {
    return {
      type: result.type || 'article-bundle',
      imported: result.imported ?? result.importedArticles ?? 0,
      skipped: result.skipped ?? 0,
      failed: result.failed ?? 0,
      results: result.results
    };
  }
  // threshold / encrypted-share / history summaries without a nested results array
  return {
    type: result.type || 'unknown',
    imported: result.imported ?? result.importedArticles ?? (result.imported === true ? 1 : 0),
    skipped: result.skipped ?? 0,
    failed: result.failed ?? 0,
    ...result
  };
}

/**
 * PermaBrain Local HTTP API Server
 *
 * Exposes the agent API from src/agent-api.mjs as a REST/JSON HTTP server.
 * Usage:
 *   import { createServer, startServer } from './src/serve.mjs';
 *   const server = await startServer({ port: 8765, home: '/tmp/.permabrain' });
 *
 * Routes:
 *   GET  /health                      → { ok, transport, agentId, home }
 *   POST /api/v1/init                 → { home, agentId, keyType, config }
 *   GET  /api/v1/articles             → query articles (filters as query params)
 *   POST /api/v1/articles             → publish article (JSON body)
 *   GET  /api/v1/articles/:key        → get latest article
 *   POST /api/v1/articles/:key/attest → attest
 *   GET  /api/v1/articles/:key/consensus → consensus
 *   GET  /api/v1/articles/:key/history   → version history
 *   GET  /api/v1/identity            → basic public identity
 *   GET  /api/v1/identity/report      → full identity introspection report (JSON)
 *   GET  /api/v1/identity/report.md   → markdown identity report
 *   GET  /api/v1/identity/report.html → HTML identity report
 *   GET  /api/v1/version               → package version info (JSON)
 *   GET  /api/v1/release-notes         → release notes from CHANGELOG.md (JSON/markdown)
 *   GET  /api/v1/raw/:id                → raw ANS-104 DataItem bytes
 *   POST /api/v1/sync                  → sync
 *   GET  /api/v1/search?q=...          → search
 *   GET  /api/v1/status                → node status
 *   GET  /api/v1/activity              → activity feed
 *   GET  /api/v1/list                  → paginated article directory
 *   POST /api/v1/batch-attest          → batch attestations
 *   POST /api/v1/auto-import           → auto-import from URLs
 *   POST /api/v1/verify                → verify id or key
 *   GET  /api/v1/config                → get config
 *   POST /api/v1/config                → set/validate/reset config
 *   POST /api/v1/completion            → generate shell completion script
 *   POST /api/v1/validate            → validate article/attestation metadata or DataItem tags
 *   GET  /api/v1/validate?type=...     → validation info
 *   GET  /api/v1/schema              → JSON schemas for article/attestation metadata
 *   GET  /api/v1/routes              → registered HTTP route catalog
 *   GET  /api/v1/openapi.json        → OpenAPI 3.0 JSON document
 *   GET  /api/v1/log/requests         → recent HTTP requests ring buffer
 *   GET  /api/v1/events/stream       → Server-Sent Events real-time stream
 *   GET  /api/v1/events/ws           → WebSocket upgrade for real-time events
 *
 * Errors return JSON with { error, status } and appropriate HTTP status codes.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { URL } from 'node:url';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { WebSocketServer } from 'ws';
import { initState, getHome, loadConfig, defaultConfig } from './config.mjs';
import { ensureIdentity, loadIdentity, publicIdentity } from './keys.mjs';
import { api } from './agent-api.mjs';
import { getEventBus, subscribeEvents, emitEvent, broadcastToWebSockets, writeSseEvent } from './events.mjs';
import { createApiKeyAuth, generateApiKey } from './auth.mjs';
import { buildOpenApiDocument, listRoutes } from './route-registry.mjs';
import { createRateLimiter, DEFAULT_RATE_LIMIT_MAX, DEFAULT_RATE_LIMIT_WINDOW_MS, DEFAULT_RATE_LIMIT_BURST } from './rate-limit.mjs';
import { requestLogger } from './request-log.mjs';
import { buildIdentityReport, identityReportToMarkdown, identityReportToHtml } from './identity-report.mjs';
import { loadIndex } from './cache.mjs';
import { createRuntimeMetrics, stopRuntimeMetrics, buildMetricsReport, formatPrometheus } from './metrics-runtime.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));

const DEFAULT_PORT = 8765;
const DEFAULT_SSE_HEARTBEAT_MS = 30000;
const CORS_ALLOWED_METHODS = 'GET, POST, PUT, PATCH, DELETE, OPTIONS';
const CORS_ALLOWED_HEADERS = 'Content-Type, Authorization, X-Api-Key, X-Requested-With';

function resolveAllowedOrigin(requestOrigin, configuredOrigin) {
  if (!configuredOrigin || configuredOrigin === '*') return '*';
  if (!requestOrigin) return configuredOrigin;
  if (requestOrigin === configuredOrigin) return configuredOrigin;
  return null;
}

function applyCorsHeaders(res, allowedOrigin) {
  if (!allowedOrigin) return;
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', CORS_ALLOWED_METHODS);
  res.setHeader('Access-Control-Allow-Headers', CORS_ALLOWED_HEADERS);
  res.setHeader('Vary', 'Origin');
}

function sendJson(res, status, body, extraHeaders = {}) {
  const headers = { ...(res.rateLimitHeaders || {}), ...extraHeaders };
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body, null, 2));
  if (res._recordRouteOutcome) res._recordRouteOutcome(status);
}

function sendError(res, status, message, extraHeaders = {}) {
  const headers = { ...(res.rateLimitHeaders || {}), ...extraHeaders };
  if (res._recordRouteOutcome) res._recordRouteOutcome(status, status >= 500);
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify({ error: message, status }, null, 2));
}

function rateLimitHeaders(result) {
  const headers = {};
  if (result.limit >= 0) headers['RateLimit-Limit'] = String(result.limit);
  if (result.remaining >= 0) headers['RateLimit-Remaining'] = String(result.remaining);
  if (result.resetAt > 0) headers['RateLimit-Reset'] = String(Math.ceil(result.resetAt / 1000));
  return headers;
}

const wsClients = new Set();
let eventSubscription = null;
let sseClients = new Set();

function stopEventSubscription() {
  if (eventSubscription) {
    eventSubscription.cancel();
    eventSubscription = null;
  }
}

async function startEventSubscription() {
  if (eventSubscription) return;
  const sub = subscribeEvents({ events: [], heartbeatMs: DEFAULT_SSE_HEARTBEAT_MS });
  eventSubscription = sub;
  try {
    for await (const event of sub) {
      broadcastToWebSockets(wsClients, event);
      writeSseEventToAll(sseClients, event);
    }
  } catch {
    // Subscription cancelled or bus error; restart on next client connect.
    eventSubscription = null;
  }
}

function writeSseEventToAll(clients, event) {
  const text = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of clients) {
    try {
      if (!res.writableEnded) res.write(text);
    } catch {
      // ignore
    }
  }
}

function maybeStartEventSubscription() {
  if (wsClients.size > 0 || sseClients.size > 0) {
    startEventSubscription().catch(() => {});
  }
}



function normalizeStreamTransport(value) {
  if (value === 'ws' || value === 'websocket' || value === 'ws-only') return 'ws';
  if (value === 'sse' || value === 'eventsource' || value === 'sse-only') return 'sse';
  return 'sse';
}

function parseBool(value) {
  if (value === undefined || value === null) return undefined;
  if (value === true || value === false) return value;
  if (typeof value === 'string') {
    const lowered = value.toLowerCase();
    if (lowered === 'true' || lowered === '1') return true;
    if (lowered === 'false' || lowered === '0') return false;
  }
  return undefined;
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  try { return JSON.parse(text); } catch (err) { throw new Error(`Invalid JSON body: ${err.message}`); }
}

function extractApiKey(req) {
  const auth = req.headers['authorization'] || req.headers['Authorization'];
  if (auth && auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  const key = req.headers['x-api-key'] || req.headers['X-Api-Key'];
  if (key) return String(key).trim();
  return undefined;
}

function setApiHome(home) {
  api._home = home;
  try { api._config = loadConfig(home); } catch { api._config = defaultConfig(); }
  try { api._identity = loadIdentity(home); } catch { api._identity = null; }
}

async function resetApiForRequest(home) {
  if (api._home !== home) {
    api._home = home;
    api._config = null;
    api._identity = null;
  }
  try {
    api._config = loadConfig(home);
    api._identity = loadIdentity(home);
  } catch {
    initState({ env: { ...process.env, PERMABRAIN_HOME: home } });
    await ensureIdentity(home);
    try { api._config = loadConfig(home); } catch { api._config = defaultConfig(); }
    try { api._identity = loadIdentity(home); } catch { api._identity = null; }
  }
}

async function ensureApiInit(home) {
  if (!api._home) {
    try {
      api._home = home || getHome();
      api._config = loadConfig(api._home);
      api._identity = loadIdentity(api._home);
    } catch {
      initState({ env: { ...process.env, PERMABRAIN_HOME: home } });
      await ensureIdentity(home);
      setApiHome(home);
    }
  }
  await api.ensureInit();
  return api._home;
}

function queryArticlesOptions(query) {
  return {
    topic: query.topic,
    kind: query.kind,
    key: query.key,
    sourceName: query['source-name'],
    sourceUrl: query['source-url'],
    useHyperbeam: parseBool(query['use-hyperbeam']) || parseBool(query.useHyperbeam)
  };
}

function searchOptions(query) {
  return {
    kind: query.kind,
    topic: query.topic,
    author: query.author,
    key: query.key,
    after: query.after,
    before: query.before,
    limit: query.limit ? Number(query.limit) : undefined,
    offset: query.offset ? Number(query.offset) : undefined,
    useHyperbeam: parseBool(query['use-hyperbeam']) || parseBool(query.useHyperbeam)
  };
}

function listOptions(query) {
  return {
    kind: query.kind,
    topic: query.topic,
    author: query.author,
    after: query.after,
    before: query.before,
    sort: query.sort || 'date',
    limit: query.limit ? Number(query.limit) : undefined,
    offset: query.offset ? Number(query.offset) : undefined,
    useHyperbeam: parseBool(query['use-hyperbeam']) || parseBool(query.useHyperbeam)
  };
}

function activityOptions(query) {
  const parseList = (v) => (v ? String(v).split(',').map((s) => s.trim()).filter(Boolean) : undefined);
  return {
    topic: query.topic,
    kind: query.kind,
    key: query.key,
    agent: parseList(query.agent),
    author: parseList(query.author),
    attestedBy: parseList(query['attested-by']),
    eventKind: query['event-kind'] || query.eventKind,
    after: query.after,
    before: query.before,
    order: query.order || 'desc',
    limit: query.limit ? Number(query.limit) : undefined,
    offset: query.offset ? Number(query.offset) : undefined,
    useHyperbeam: parseBool(query['use-hyperbeam']) || parseBool(query.useHyperbeam)
  };
}

async function handleRequest(req, res, home, options = {}) {
  const url = new URL(req.url, `http://localhost`);
  const parsedUrl = url;
  const method = req.method;
  const pathname = url.pathname;
  const runtimeMetrics = options.runtimeMetrics;
  const route = pathname.replace(/\/$/, '') || '/';

  res._recordRouteOutcome = (statusCode, error = false) => {
    if (runtimeMetrics) {
      runtimeMetrics.countRequest({ statusCode, method, route, error });
    }
  };

  const requestOrigin = req.headers.origin || null;
  const allowedOrigin = resolveAllowedOrigin(requestOrigin, options.corsOrigin);
  applyCorsHeaders(res, allowedOrigin);

  if (method === 'OPTIONS') {
    res.setHeader('Access-Control-Max-Age', '86400');
    res.writeHead(204);
    return res.end();
  }

  // Rate limiting applies to all HTTP routes except stream upgrade endpoints
  // (SSE/WebSocket) which maintain long-lived connections.
  const rateLimiter = options.rateLimiter;
  const isStreamRoute = route === '/api/v1/events/stream' || route === '/api/v1/articles/stream' || route === '/api/v1/events/ws' || route === '/api/v1/log/requests/stream' || route.startsWith('/api/v1/articles/stream');
  if (rateLimiter && !isStreamRoute) {
    const limitResult = rateLimiter.check(req);
    const rlHeaders = rateLimitHeaders(limitResult);
    applyCorsHeaders(res, allowedOrigin);
    if (!limitResult.ok) {
      const retryHeaders = { ...rlHeaders, 'Retry-After': String(limitResult.retryAfter) };
      res._recordRouteOutcome(429, false);
      return sendError(res, 429, limitResult.error, retryHeaders);
    }
    // Attach rate-limit headers to all successful responses below.
    res.rateLimitHeaders = rlHeaders;
  }

  try {
    let body = null;
    const auth = options.apiKeyAuth;
    const needsAuth = auth && auth.apiKeys.length > 0;
    const isPublic = route === '/health' || route === '/api/v1/events/stream' || route === '/api/v1/events/ws' || route === '/api/v1/articles/stream' || route.startsWith('/api/v1/articles/stream') || route === '/api/v1/log/requests/stream';
    if (needsAuth && !isPublic) {
      body = await readBody(req);
      const authResult = auth.check({ headers: req.headers, url: req.url }, body);
      if (!authResult.ok) {
        res._recordRouteOutcome(authResult.status, true);
        return sendError(res, authResult.status, authResult.error);
      }
    }

    const bodyOrRead = body || (method === 'POST' || method === 'PUT' || method === 'PATCH' ? await readBody(req) : null);
    // body may have been read for auth; avoid re-reading when empty
    let requestBody = bodyOrRead || {};
    if (typeof requestBody === 'string' && requestBody.trim()) {
      try { requestBody = JSON.parse(requestBody); } catch {}
    }
    if (method === 'GET' && route === '/health') {
      const transport = api._config?.transport || process.env.PERMABRAIN_TRANSPORT || 'local';
      const streamTransport = options.streamTransport || process.env.PERMABRAIN_STREAM_TRANSPORT || 'sse';
      const normalized = normalizeStreamTransport(streamTransport);
      return sendJson(res, 200, {
        ok: true,
        transport,
        agentId: api._identity?.agentId || null,
        home: api._home || home,
        streamTransport: normalized,
        streams: {
          websocket: '/api/v1/events/ws',
          sse: '/api/v1/events/stream',
          articles: {
            default: normalized,
            sse: '/api/v1/articles/stream',
            websocket: '/api/v1/articles/stream'
          }
        }
      });
    }

    if (method === 'GET' && route === '/api/v1/log/requests') {
      const logger = options.requestLogger || requestLogger({ format: 'none', home });
      const limit = url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : undefined;
      const offset = url.searchParams.get('offset') ? Number(url.searchParams.get('offset')) : undefined;
      const methodFilter = url.searchParams.get('method') || undefined;
      const statusFilter = url.searchParams.get('status') !== null ? Number(url.searchParams.get('status')) : undefined;
      const pathFilter = url.searchParams.get('path') || undefined;
      const after = url.searchParams.get('after') || undefined;
      const before = url.searchParams.get('before') || undefined;
      const accept = req.headers.accept || '';
      const useDisk = logger.diskEnabled && url.searchParams.get('source') === 'disk';
      const result = useDisk
        ? await logger.queryDisk({ limit, offset, method: methodFilter, status: statusFilter, path: pathFilter, after, before })
        : logger.getRecentRequests({ limit, offset, method: methodFilter, status: statusFilter, path: pathFilter });
      if (accept.includes('text/markdown')) {
        const { requestsToMarkdown } = await import('./request-log.mjs');
        const markdown = requestsToMarkdown(logger, { limit, offset, method: methodFilter, status: statusFilter, path: pathFilter });
        res.setHeader('content-type', 'text/markdown');
        return res.end(markdown);
      }
      return sendJson(res, 200, result);
    }

    if (method === 'GET' && route === '/api/v1/log/requests/stream') {
      const logger = options.requestLogger || requestLogger({ format: 'none', home });
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        'connection': 'keep-alive'
      });
      res.write(`data: ${JSON.stringify({ type: 'open', timestamp: new Date().toISOString() })}\n\n`);
      logger.subscribeTail(res);
      req.on('close', () => logger.unsubscribeTail(res));
      return;
    }

    if (method === 'GET' && route === '/api/v1/events/stream') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        'connection': 'keep-alive'
      });
      res.write(`data: ${JSON.stringify({ type: 'open', timestamp: new Date().toISOString() })}\n\n`);
      sseClients.add(res);
      maybeStartEventSubscription();
      req.on('close', () => {
        sseClients.delete(res);
        if (sseClients.size === 0 && wsClients.size === 0) stopEventSubscription();
      });
      return;
    }

    if (method === 'GET' && route === '/api/v1/articles/stream') {
      const { subscribeQuery } = await import('./query-stream.mjs');
      const filters = {
        topic: url.searchParams.get('topic') || undefined,
        kind: url.searchParams.get('kind') || undefined,
        agent: url.searchParams.get('agent') || undefined,
        key: url.searchParams.get('key') || undefined,
        events: url.searchParams.get('events') || undefined
      };
      const controller = new AbortController();
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        'connection': 'keep-alive'
      });
      res.write(`data: ${JSON.stringify({ type: 'open', timestamp: new Date().toISOString() })}\n\n`);
      const sub = subscribeQuery({ ...filters, signal: controller.signal });
      req.on('close', () => controller.abort());
      (async () => {
        try {
          for await (const event of sub) {
            if (res.writableEnded || controller.signal.aborted) break;
            writeSseEvent(res, event);
          }
        } catch {
          // subscription cancelled
        } finally {
          try { res.end(); } catch {}
        }
      })();
      return;
    }

    if (method === 'POST' && route === '/api/v1/events/publish') {
      const body = bodyOrRead || await readBody(req);
      if (!Array.isArray(body.events)) return sendError(res, 400, 'events array is required');
      const forwarded = [];
      for (const event of body.events) {
        const name = event?.name || event?.type;
        if (!name) continue;
        emitEvent(name, event);
        forwarded.push(event);
      }
      return sendJson(res, 200, { forwarded: forwarded.length });
    }

    if (method === 'POST' && route === '/api/v1/init') {
      const body = bodyOrRead || await readBody(req);
      const initHome = body.home || home;
      const result = await api.init({
        ...body,
        transport: body.transport || process.env.PERMABRAIN_TRANSPORT
      });
      setApiHome(initHome);
      return sendJson(res, 200, result);
    }

    await resetApiForRequest(home);
    const currentHome = api._home;

    if (route === '/api/v1/articles') {
      if (method === 'GET') {
        const result = await api.query(queryArticlesOptions(Object.fromEntries(url.searchParams)));
        return sendJson(res, 200, { articles: result, count: result.length });
      }
      if (method === 'POST') {
        const body = bodyOrRead || await readBody(req);
        if (!body.content) return sendError(res, 400, 'content is required');
        if (!body.kind) return sendError(res, 400, 'kind is required');
        if (!body.topic) return sendError(res, 400, 'topic is required');
        if (!body.sourceUrl) return sendError(res, 400, 'sourceUrl is required');
        const result = await api.publish(body);
        return sendJson(res, 201, result);
      }
    }

    const keyMatch = route.match(/^\/api\/v1\/articles\/(.+)$/);
    if (keyMatch) {
      const key = decodeURIComponent(keyMatch[1]);
      const subMatch = key.match(/^(.+)\/(attest|consensus|history|fork|merge)$/);
      const articleKey = subMatch ? subMatch[1] : key;
      const subAction = subMatch ? subMatch[2] : null;

      if (method === 'GET' && !subAction) {
        const opts = { useHyperbeam: parseBool(url.searchParams.get('use-hyperbeam')) };
        const result = await api.get(articleKey, opts);
        return sendJson(res, 200, result);
      }

      if (method === 'POST' && subAction === 'attest') {
        const body = bodyOrRead || await readBody(req);
        if (!body.opinion) return sendError(res, 400, 'opinion is required');
        if (body.confidence === undefined) return sendError(res, 400, 'confidence is required');
        if (!body.reason) return sendError(res, 400, 'reason is required');
        const result = await api.attest(articleKey, body);
        return sendJson(res, 201, result);
      }

      if (method === 'GET' && subAction === 'consensus') {
        const opts = { useHyperbeam: parseBool(url.searchParams.get('use-hyperbeam')) };
        const result = await api.consensus(articleKey, opts);
        return sendJson(res, 200, result);
      }

      if (method === 'GET' && subAction === 'history') {
        const opts = { useHyperbeam: parseBool(url.searchParams.get('use-hyperbeam')) };
        const result = await api.history(articleKey, opts);
        return sendJson(res, 200, result);
      }

      if (method === 'POST' && subAction === 'fork') {
        const body = bodyOrRead || await readBody(req);
        const result = await api.fork(articleKey, body, body);
        return sendJson(res, 201, result);
      }
    }

    const forksMatch = route.match(/^\/api\/v1\/articles\/(.+)\/forks$/);
    if (forksMatch && method === 'GET') {
      const sourceKey = decodeURIComponent(forksMatch[1]);
      const result = await api.listForks(sourceKey, { useHyperbeam: parseBool(url.searchParams.get('use-hyperbeam')) });
      return sendJson(res, 200, { forks: result, count: result.length });
    }

    if (method === 'POST' && route === '/api/v1/merge') {
      const body = bodyOrRead || await readBody(req);
      if (!body.targetKey) return sendError(res, 400, 'targetKey is required');
      if (!body.sourceKey) return sendError(res, 400, 'sourceKey is required');
      const result = await api.merge(body.targetKey, body.sourceKey, body);
      return sendJson(res, 201, result);
    }

    if (method === 'POST' && route === '/api/v1/sync') {
      const body = bodyOrRead || await readBody(req);
      const result = await api.sync(body || {});
      return sendJson(res, 200, result);
    }

    if (method === 'GET' && route === '/api/v1/search') {
      const q = url.searchParams.get('q');
      if (!q) return sendError(res, 400, 'q is required');
      const result = await api.search(q, searchOptions(Object.fromEntries(url.searchParams)));
      return sendJson(res, 200, result);
    }

    if (method === 'GET' && route === '/api/v1/status') {
      const result = await api.status({ useHyperbeam: parseBool(url.searchParams.get('use-hyperbeam')) });
      return sendJson(res, 200, result);
    }

    if (method === 'GET' && route === '/api/v1/activity') {
      const result = await api.activity(activityOptions(Object.fromEntries(url.searchParams)));
      return sendJson(res, 200, result);
    }

    const topicMatch = route.match(/^\/api\/v1\/topics\/(.+)$/);
    if (method === 'GET' && route === '/api/v1/topics') {
      const opts = {
        kind: url.searchParams.get('kind'),
        after: url.searchParams.get('after'),
        before: url.searchParams.get('before'),
        sort: url.searchParams.get('sort') || 'count',
        limit: url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : undefined
      };
      const accept = req.headers.accept || '';
      const result = await api.topics(opts);
      if (accept.includes('text/markdown')) {
        const markdown = await api.topicsToMarkdown(opts);
        res.setHeader('content-type', 'text/markdown');
        return res.end(markdown);
      }
      return sendJson(res, 200, result);
    }
    if (method === 'GET' && route === '/api/v1/tags') {
      const opts = {
        prefix: url.searchParams.get('prefix'),
        name: url.searchParams.get('name'),
        kind: url.searchParams.get('kind'),
        after: url.searchParams.get('after'),
        before: url.searchParams.get('before'),
        sort: url.searchParams.get('sort') || 'count',
        limit: url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : undefined
      };
      const accept = req.headers.accept || '';
      const result = await api.tags(opts);
      if (accept.includes('text/markdown')) {
        const markdown = await api.tagsToMarkdown(opts);
        res.setHeader('content-type', 'text/markdown');
        return res.end(markdown);
      }
      return sendJson(res, 200, result);
    }
    if (method === 'GET' && route === '/api/v1/agents') {
      const opts = {
        kind: url.searchParams.get('kind'),
        topic: url.searchParams.get('topic'),
        after: url.searchParams.get('after'),
        before: url.searchParams.get('before'),
        minArticles: url.searchParams.has('minArticles') ? Number(url.searchParams.get('minArticles')) : undefined,
        minAttestations: url.searchParams.has('minAttestations') ? Number(url.searchParams.get('minAttestations')) : undefined,
        agentId: url.searchParams.get('agentId'),
        sort: url.searchParams.get('sort') || 'articles',
        limit: url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : undefined
      };
      const accept = req.headers.accept || '';
      const result = await api.agents(opts);
      if (accept.includes('text/markdown')) {
        const markdown = await api.agentsToMarkdown(opts);
        res.setHeader('content-type', 'text/markdown');
        return res.end(markdown);
      }
      return sendJson(res, 200, result);
    }
    if (method === 'GET' && route === '/api/v1/sources') {
      const opts = {
        kind: url.searchParams.get('kind'),
        topic: url.searchParams.get('topic'),
        name: url.searchParams.get('name'),
        url: url.searchParams.get('url'),
        agentId: url.searchParams.get('agentId'),
        after: url.searchParams.get('after'),
        before: url.searchParams.get('before'),
        sort: url.searchParams.get('sort') || 'count',
        limit: url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : undefined
      };
      const accept = req.headers.accept || '';
      const result = await api.sources(opts);
      if (accept.includes('text/markdown')) {
        const markdown = await api.sourcesToMarkdown(opts);
        res.setHeader('content-type', 'text/markdown');
        return res.end(markdown);
      }
      return sendJson(res, 200, result);
    }
    if (method === 'GET' && route === '/api/v1/kinds') {
      const opts = {
        topic: url.searchParams.get('topic'),
        after: url.searchParams.get('after'),
        before: url.searchParams.get('before'),
        sort: url.searchParams.get('sort') || 'count',
        limit: url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : undefined
      };
      const accept = req.headers.accept || '';
      const result = await api.kinds(opts);
      if (accept.includes('text/markdown')) {
        const markdown = await api.kindsToMarkdown(opts);
        res.setHeader('content-type', 'text/markdown');
        return res.end(markdown);
      }
      return sendJson(res, 200, result);
    }
    if (method === 'GET' && route === '/api/v1/languages') {
      const opts = {
        topic: url.searchParams.get('topic'),
        kind: url.searchParams.get('kind'),
        source: url.searchParams.get('source'),
        agent: url.searchParams.get('agent'),
        after: url.searchParams.get('after'),
        before: url.searchParams.get('before'),
        sort: url.searchParams.get('sort') || 'count',
        limit: url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : undefined
      };
      const accept = req.headers.accept || '';
      const result = await api.languages(opts);
      if (accept.includes('text/markdown')) {
        const markdown = await api.languagesToMarkdown(opts);
        res.setHeader('content-type', 'text/markdown');
        return res.end(markdown);
      }
      return sendJson(res, 200, result);
    }
    if (topicMatch && method === 'GET') {
      const topic = decodeURIComponent(topicMatch[1]);
      const opts = {
        kind: url.searchParams.get('kind'),
        language: url.searchParams.get('language'),
        agent: url.searchParams.get('author'),
        sort: url.searchParams.get('sort') || 'date',
        limit: url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : undefined,
        offset: url.searchParams.has('offset') ? Number(url.searchParams.get('offset')) : undefined,
        includeAttestations: url.searchParams.get('no-attestations') === null,
        useHyperbeam: parseBool(url.searchParams.get('use-hyperbeam'))
      };
      const result = await api.topicFeed(topic, opts);
      return sendJson(res, 200, result);
    }

    if (method === 'GET' && route === '/api/v1/list') {
      const result = await api.listArticles(listOptions(Object.fromEntries(url.searchParams)));
      return sendJson(res, 200, result);
    }

    if (method === 'GET' && route === '/api/v1/export-articles') {
      const opts = { ...listOptions(Object.fromEntries(url.searchParams)), format: url.searchParams.get('format') || 'json' };
      const result = await api.exportArticles(opts);
      return sendJson(res, 200, result);
    }

    if (method === 'GET' && route === '/api/v1/metrics') {
      const format = url.searchParams.get('format');
      const filters = {
        kind: url.searchParams.get('kind'),
        topic: url.searchParams.get('topic'),
        author: url.searchParams.get('author'),
        after: url.searchParams.get('after'),
        before: url.searchParams.get('before'),
        top: url.searchParams.has('top') ? Number(url.searchParams.get('top')) : undefined
      };
      if (runtimeMetrics) {
        runtimeMetrics.setActiveStreams({ sse: sseClients.size, websocket: wsClients.size });
      }
      const report = await buildMetricsReport({ runtime: runtimeMetrics, home: currentHome, filters });
      if (format === 'prometheus') {
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
        return res.end(formatPrometheus(report));
      }
      return sendJson(res, 200, report);
    }

    if (method === 'GET' && route === '/api/v1/stats') {
      const opts = {
        kind: url.searchParams.get('kind'),
        topic: url.searchParams.get('topic'),
        author: url.searchParams.get('author'),
        after: url.searchParams.get('after'),
        before: url.searchParams.get('before'),
        top: url.searchParams.has('top') ? Number(url.searchParams.get('top')) : undefined
      };
      const result = await api.stats(opts);
      return sendJson(res, 200, result);
    }

    if (method === 'POST' && route === '/api/v1/batch-attest') {
      const body = bodyOrRead || await readBody(req);
      if (!body.attestations?.length) return sendError(res, 400, 'attestations array is required');
      const result = await api.batchAttest(body);
      return sendJson(res, 200, result);
    }

    if (method === 'POST' && route === '/api/v1/auto-import') {
      const body = bodyOrRead || await readBody(req);
      if (!body.articles?.length) return sendError(res, 400, 'articles array is required');
      const result = await api.autoImport(body);
      return sendJson(res, 200, result);
    }

    if (method === 'POST' && route === '/api/v1/verify') {
      const body = bodyOrRead || await readBody(req);
      if (!body.idOrKey) return sendError(res, 400, 'idOrKey is required');
      const result = await api.verify(body.idOrKey, body);
      return sendJson(res, 200, result);
    }

    if (route === '/api/v1/remotes') {
      if (method === 'GET') {
        const result = await api.remote('list');
        return sendJson(res, 200, result);
      }
      if (method === 'POST') {
        const body = bodyOrRead || await readBody(req);
        if (!body.action) return sendError(res, 400, 'action is required');
        const result = await api.remote(body.action, body.params || {});
        return sendJson(res, 200, result);
      }
    }

    if (route === '/api/v1/backups') {
      if (method === 'GET') {
        const result = api.listBackups();
        return sendJson(res, 200, { backups: result, count: result.length });
      }
      if (method === 'POST') {
        const body = bodyOrRead || await readBody(req);
        const action = body.action || 'create';
        if (action === 'create') {
          if (!body.passphrase) return sendError(res, 400, 'passphrase is required');
          const result = await api.backup({ passphrase: body.passphrase, recipients: body.recipients, name: body.name });
          return sendJson(res, 201, result);
        }
        if (action === 'prune') {
          const result = api.pruneBackups(body);
          return sendJson(res, 200, result);
        }
        if (action === 'restore') {
          if (!body.backup) return sendError(res, 400, 'backup is required');
          const result = await api.restoreBackup({ backup: body.backup, passphrase: body.passphrase, dryRun: body.dryRun });
          return sendJson(res, 200, result);
        }
        return sendError(res, 400, `Unknown backup action: ${action}`);
      }
    }

    if (method === 'POST' && route === '/api/v1/archive') {
      const body = bodyOrRead || await readBody(req);
      const result = await api.archive(body || {});
      return sendJson(res, 201, result);
    }
    if (method === 'POST' && route === '/api/v1/restore') {
      const body = bodyOrRead || await readBody(req);
      if (!body.archive) return sendError(res, 400, 'archive is required');
      const result = await api.restore(body.archive, body.options || {});
      return sendJson(res, 200, result);
    }

    if (route === '/api/v1/bundles') {
      if (method === 'GET') {
        const key = url.searchParams.get('key');
        const id = url.searchParams.get('id');
        const opts = {
          key,
          id,
          includeAttestations: url.searchParams.get('no-attestations') === null,
          includeVersions: url.searchParams.get('no-versions') === null,
          useHyperbeam: parseBool(url.searchParams.get('use-hyperbeam'))
        };
        const result = await api.exportBundle({ ...opts, useHyperbeam: opts.useHyperbeam ?? false, home: currentHome });
        return sendJson(res, 200, result);
      }
      if (method === 'POST') {
        const body = bodyOrRead || await readBody(req);
        const isDirectBundle = body && Array.isArray(body.entries);
        const bundle = isDirectBundle ? body : body?.bundle;
        if (!bundle) return sendError(res, 400, 'bundle is required');
        const options = isDirectBundle
          ? { home: currentHome, verify: body.verify !== false, skipDuplicates: body.skipDuplicates !== false }
          : { home: currentHome, ...(body.options || {}), verify: body.verify !== false, skipDuplicates: body.skipDuplicates !== false };
        const result = await api.importBundle(bundle, options);
        return sendJson(res, 200, normalizeImportResult(result));
      }
    }

    if (method === 'GET' && route === '/api/v1/export-all') {
      const opts = { includeAttestations: url.searchParams.get('no-attestations') === null };
      const result = await api.exportAll(opts);
      return sendJson(res, 200, result);
    }

    if (method === 'GET' && route === '/api/v1/history-export') {
      const key = url.searchParams.get('key');
      if (!key) return sendError(res, 400, 'key is required');
      const result = await api.exportHistory(key, { useHyperbeam: parseBool(url.searchParams.get('use-hyperbeam')) });
      return sendJson(res, 200, result);
    }
    if (method === 'POST' && route === '/api/v1/history-import') {
      const body = bodyOrRead || await readBody(req);
      const isDirectBundle = body && Array.isArray(body.entries);
      const bundle = isDirectBundle ? body : body?.bundle;
      if (!bundle) return sendError(res, 400, 'bundle is required');
      const options = isDirectBundle
        ? { home: currentHome, verify: body.verify !== false, skipDuplicates: body.skipDuplicates !== false }
        : { home: currentHome, ...(body.options || {}), verify: body.verify !== false, skipDuplicates: body.skipDuplicates !== false };
      const result = await api.importHistory(bundle, options);
      return sendJson(res, 200, result);
    }

    if (method === 'POST' && (route === '/api/v1/publish-dir' || route === '/api/v1/publish-dir/preview')) {
      const body = bodyOrRead || await readBody(req);
      const { publishDirectory: publishDir, publishDirectoryToMarkdown, deriveKeyFromPath } = await import('./publish-dir.mjs');
      const dryRun = route === '/api/v1/publish-dir/preview' || body.dryRun === true;
      const files = body.files;
      const dir = body.dir;
      const baseDir = dir ? path.resolve(currentHome, dir) : undefined;
      let results = [];
      let count = 0;
      let succeeded = 0;
      let failed = 0;
      let skipped = 0;

      if (files && Array.isArray(files) && files.length > 0) {
        count = files.length;
        const baseDirForMeta = dir ? path.resolve(currentHome, dir) : (files[0].path ? path.dirname(path.resolve(currentHome, files[0].path)) : currentHome);
        for (const entry of files) {
          const filePath = entry.path ? path.resolve(currentHome, entry.path) : undefined;
          const meta = deriveKeyFromPath(filePath, baseDirForMeta, body.kind || 'subject', body.topic || 'general');
          const finalKey = body.key && typeof body.key === 'string' ? body.key : meta.key;
          if (dryRun) {
            results.push({ file: filePath, key: finalKey || meta.key, kind: meta.kind, topic: meta.topic, title: meta.title, status: 'dry-run' });
            continue;
          }
          try {
            const fileContent = entry.content ?? (entry.file ? fs.readFileSync(path.resolve(currentHome, entry.file), 'utf8') : undefined);
            const result = await api.publish({
              content: fileContent,
              file: entry.file ? path.resolve(currentHome, entry.file) : filePath,
              key: finalKey || meta.key,
              kind: meta.kind,
              topic: meta.topic,
              title: meta.title,
              sourceUrl: entry.sourceUrl || body.sourceUrl || (filePath ? `file://${path.resolve(currentHome, filePath)}` : undefined),
              sourceName: entry.sourceName || body.sourceName || 'Directory Publish',
              sourceLicense: entry.sourceLicense || body.sourceLicense || '',
              language: entry.language || body.language || 'en',
              visibility: body.visibility || (body.encryptedFor?.length ? 'encrypted' : 'public'),
              encryptedFor: body.encryptedFor || []
            });
            results.push({ file: filePath, key: result.summary.key, id: result.summary.id, version: result.summary.version, status: 'ok', encrypted: result.encrypted });
            succeeded++;
          } catch (err) {
            results.push({ file: filePath, key: finalKey || meta.key, status: 'error', error: err.message });
            failed++;
          }
        }
      } else if (dir && fs.existsSync(baseDir) && fs.statSync(baseDir).isDirectory()) {
        const { findMarkdownFiles } = await import('./publish-dir.mjs');
        const filePaths = findMarkdownFiles(baseDir, body.recursive === true);
        count = filePaths.length;
        for (const filePath of filePaths) {
          const meta = deriveKeyFromPath(filePath, baseDir, body.kind || 'subject', body.topic || 'general');
          if (dryRun) {
            results.push({ file: filePath, key: meta.key, kind: meta.kind, topic: meta.topic, title: meta.title, status: 'dry-run' });
            continue;
          }
          try {
            const fileContent = fs.readFileSync(filePath, 'utf8');
            const result = await api.publish({
              content: fileContent,
              file: filePath,
              key: meta.key,
              kind: meta.kind,
              topic: meta.topic,
              title: meta.title,
              sourceUrl: body.sourceUrl || `file://${filePath}`,
              sourceName: body.sourceName || 'Directory Publish',
              sourceLicense: body.sourceLicense || '',
              language: body.language || 'en',
              visibility: body.visibility || (body.encryptedFor?.length ? 'encrypted' : 'public'),
              encryptedFor: body.encryptedFor || []
            });
            results.push({ file: filePath, key: result.summary.key, id: result.summary.id, version: result.summary.version, status: 'ok', encrypted: result.encrypted });
            succeeded++;
          } catch (err) {
            results.push({ file: filePath, key: meta.key, status: 'error', error: err.message });
            failed++;
          }
        }
      } else {
        return sendError(res, 400, 'files array or existing dir is required');
      }

      const report = {
        dir: dir || '(inline batch)',
        recursive: body.recursive === true,
        dryRun,
        count,
        succeeded,
        failed,
        skipped,
        results
      };
      const accept = req.headers.accept || '';
      if (accept.includes('text/markdown')) {
        res.setHeader('content-type', 'text/markdown');
        return res.end(publishDirectoryToMarkdown(report));
      }
      return sendJson(res, dryRun ? 200 : 201, report);
    }

    if (method === 'POST' && route === '/api/v1/import-wikipedia') {
      const body = bodyOrRead || await readBody(req);
      if (!body.title) return sendError(res, 400, 'title is required');
      const result = await api.importWikipedia(body);
      return sendJson(res, 201, result);
    }

    if (method === 'GET' && route === '/api/v1/diff') {
      const base = url.searchParams.get('base');
      const head = url.searchParams.get('head');
      if (!base) return sendError(res, 400, 'base is required');
      const opts = {
        useHyperbeam: parseBool(url.searchParams.get('use-hyperbeam')),
        local: parseBool(url.searchParams.get('local')) || !head,
        format: url.searchParams.get('format') || 'unified',
        context: url.searchParams.has('context') ? Number(url.searchParams.get('context')) : undefined
      };
      const result = await api.diff(base, head, opts);
      return sendJson(res, 200, result);
    }

    if (route === '/api/v1/config') {
      if (method === 'GET') {
        const action = url.searchParams.get('action') || 'get';
        const result = await api.config({ action, path: url.searchParams.get('path') });
        return sendJson(res, 200, result);
      }
      if (method === 'POST') {
        const body = bodyOrRead || await readBody(req);
        const result = await api.config(body || { action: 'get' });
        return sendJson(res, 200, result);
      }
    }

    if (method === 'POST' && route === '/api/v1/completion') {
      const body = bodyOrRead || await readBody(req);
      const shell = body?.shell || 'bash';
      const result = await api.completion({ shell });
      return sendJson(res, 200, result);
    }

    if (method === 'GET' && route === '/api/v1/probe') {
      const opts = { useHyperbeam: parseBool(url.searchParams.get('use-hyperbeam')) };
      if (url.searchParams.has('url')) opts.url = url.searchParams.get('url');
      const result = await api.probe(opts);
      return sendJson(res, 200, result);
    }
    if (method === 'GET' && route === '/api/v1/transport-status') {
      const result = await api.getTransportStatus();
      return sendJson(res, 200, result);
    }

    if (method === 'GET' && route === '/api/v1/local-index') {
      const result = await api.localIndex();
      return sendJson(res, 200, result);
    }

    if (method === 'GET' && route === '/api/v1/log') {
      const result = await api.log(Object.fromEntries(url.searchParams));
      return sendJson(res, 200, result);
    }

    if (method === 'POST' && route === '/api/v1/log') {
      const body = bodyOrRead || await readBody(req);
      if (!body.action) return sendError(res, 400, 'action is required');
      const result = await api.auditLog(body);
      return sendJson(res, 201, result);
    }

    if (method === 'GET' && route === '/api/v1/log/export') {
      const format = url.searchParams.get('format') || 'json';
      const result = await api.exportLog({ format, home });
      if (format === 'jsonl') {
        res.writeHead(200, { 'content-type': 'application/x-ndjson' });
        return res.end(result.raw);
      }
      return sendJson(res, 200, result);
    }

    if (method === 'POST' && route === '/api/v1/log/import') {
      const body = bodyOrRead || await readBody(req);
      const bundle = body.bundle || body;
      const result = await api.importLog(bundle, { ...(body.options || {}), home });
      return sendJson(res, 200, result);
    }

    if (method === 'GET' && route === '/api/v1/identity') {
      const id = publicIdentity(api._identity);
      return sendJson(res, 200, id);
    }

    if (method === 'GET' && (route === '/api/v1/identity/report' || route === '/api/v1/identity/report.json')) {
      const report = buildIdentityReport({ home: currentHome, config: api._config });
      return sendJson(res, 200, report);
    }

    if (method === 'GET' && route === '/api/v1/identity/report.md') {
      const report = buildIdentityReport({ home: currentHome, config: api._config });
      const markdown = identityReportToMarkdown(report);
      res.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8' });
      return res.end(markdown);
    }

    if (method === 'GET' && route === '/api/v1/identity/report.html') {
      const report = buildIdentityReport({ home: currentHome, config: api._config });
      const html = identityReportToHtml(report);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(html);
    }

    if (method === 'GET' && (route === '/api/v1/version' || route === '/api/v1/version.json')) {
      return sendJson(res, 200, {
        version: pkg.version || 'unknown',
        name: pkg.name || 'permabrain',
        description: pkg.description || ''
      });
    }

    if (method === 'GET' && route === '/api/v1/release-notes') {
      const { buildReleaseNotes } = await import('./release-notes.mjs');
      const params = url.searchParams;
      const opts = {
        path: params.get('file') || './CHANGELOG.md',
        version: params.get('version') || undefined,
        unreleased: params.get('unreleased') === 'true'
      };
      const notes = buildReleaseNotes(opts);
      const accept = req.headers['accept'] || '';
      if (accept.includes('text/markdown')) {
        res.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8' });
        return res.end(notes.markdown);
      }
      return sendJson(res, 200, { markdown: notes.markdown, json: notes.json, release: notes.release });
    }

    const rawMatch = route.match(/^\/api\/v1\/raw\/(.+)$/);
    if (rawMatch && method === 'GET') {
      const id = decodeURIComponent(rawMatch[1]);
      const { getTransport } = await import('./transport.mjs');
      const { rawDataItemBytes } = await import('./dataitem.mjs');
      const transport = getTransport(api._config, currentHome);
      const item = await transport.fetchDataItem(id);
      const bytes = rawDataItemBytes(item);
      res.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': bytes.length
      });
      return res.end(bytes);
    }

    if (method === 'POST' && route === '/api/v1/goal') {
      const body = bodyOrRead || await readBody(req);
      if (!body.text && !body.filePath) return sendError(res, 400, 'text or filePath is required');
      let parsed;
      if (body.filePath) parsed = await api.goalFromFile(body.filePath, body.options || {});
      else parsed = await api.parseGoal(body.text, body.options || {});
      return sendJson(res, 200, parsed);
    }

    if (method === 'POST' && route === '/api/v1/template') {
      const body = bodyOrRead || await readBody(req);
      if (!body.file && !body.source) return sendError(res, 400, 'file or source is required');
      const result = await api.template({
        file: body.file,
        source: body.source,
        variables: body.variables || {},
        topic: body.topic,
        kind: body.kind,
        title: body.title,
        key: body.key,
        app: body.app,
        sourceUrl: body.sourceUrl,
        encrypt: parseBool(body.encrypt) || parseBool(body.encrypted),
        recipients: body.recipients || body.encryptedFor,
        publishOptions: body.publishOptions || {}
      });
      return sendJson(res, 201, result);
    }

    if (method === 'GET' && route === '/api/v1/dashboard') {
      const opts = {
        kind: url.searchParams.get('kind'),
        topic: url.searchParams.get('topic'),
        author: url.searchParams.get('author'),
        after: url.searchParams.get('after'),
        before: url.searchParams.get('before'),
        sort: url.searchParams.get('sort') || 'date',
        order: url.searchParams.get('order') || 'desc',
        articleLimit: url.searchParams.has('article-limit') ? Number(url.searchParams.get('article-limit')) : undefined,
        activityLimit: url.searchParams.has('activity-limit') ? Number(url.searchParams.get('activity-limit')) : undefined,
        logLimit: url.searchParams.has('log-limit') ? Number(url.searchParams.get('log-limit')) : undefined,
        useHyperbeam: parseBool(url.searchParams.get('use-hyperbeam'))
      };
      const result = await api.dashboard(opts);
      return sendJson(res, 200, result);
    }

    if (method === 'GET' && route === '/api/v1/dashboard.html') {
      const opts = {
        kind: url.searchParams.get('kind'),
        topic: url.searchParams.get('topic'),
        author: url.searchParams.get('author'),
        after: url.searchParams.get('after'),
        before: url.searchParams.get('before'),
        sort: url.searchParams.get('sort') || 'date',
        order: url.searchParams.get('order') || 'desc',
        articleLimit: url.searchParams.has('article-limit') ? Number(url.searchParams.get('article-limit')) : undefined,
        activityLimit: url.searchParams.has('activity-limit') ? Number(url.searchParams.get('activity-limit')) : undefined,
        logLimit: url.searchParams.has('log-limit') ? Number(url.searchParams.get('log-limit')) : undefined,
        useHyperbeam: parseBool(url.searchParams.get('use-hyperbeam')),
        title: url.searchParams.get('title')
      };
      const data = await api.dashboard(opts);
      const html = api.dashboardHTML(data, { title: opts.title });
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(html);
    }

    if (method === 'GET' && route === '/api/v1/admin') {
      const opts = {
        accessLogLimit: url.searchParams.has('access-log-limit') ? Number(url.searchParams.get('access-log-limit')) : undefined,
        auditLogLimit: url.searchParams.has('audit-log-limit') ? Number(url.searchParams.get('audit-log-limit')) : undefined
      };
      const result = await api.adminPanel({ ...opts, runtimeMetrics });
      return sendJson(res, 200, result);
    }

    if (method === 'GET' && route === '/api/v1/admin.html') {
      const opts = {
        accessLogLimit: url.searchParams.has('access-log-limit') ? Number(url.searchParams.get('access-log-limit')) : undefined,
        auditLogLimit: url.searchParams.has('audit-log-limit') ? Number(url.searchParams.get('audit-log-limit')) : undefined,
        title: url.searchParams.get('title')
      };
      const data = await api.adminPanel({ ...opts, runtimeMetrics });
      const html = api.adminPanelHTML(data, { title: opts.title });
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(html);
    }

    if (method === 'GET' && route === '/api/v1/support-bundle') {
      const opts = {
        accessLogLimit: url.searchParams.has('access-log-limit') ? Number(url.searchParams.get('access-log-limit')) : undefined,
        auditLogLimit: url.searchParams.has('audit-log-limit') ? Number(url.searchParams.get('audit-log-limit')) : undefined,
        redact: url.searchParams.get('redact') !== 'false'
      };
      const result = await api.supportBundle({ ...opts, runtimeMetrics });
      if (req.headers.accept?.includes('text/markdown')) {
        res.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8' });
        return res.end(api.supportBundleMarkdown(result));
      }
      return sendJson(res, 200, result);
    }

    if (method === 'POST' && route === '/api/v1/dashboard/publish') {
      const body = bodyOrRead || await readBody(req);
      const dashboardOpts = {
        kind: body.kind,
        topic: body.topic,
        author: body.author,
        after: body.after,
        before: body.before,
        sort: body.sort,
        order: body.order,
        articleLimit: body.articleLimit,
        activityLimit: body.activityLimit,
        logLimit: body.logLimit,
        useHyperbeam: parseBool(body.useHyperbeam),
        title: body.title
      };
      const publishOpts = {
        keyId: body.keyId,
        privateJwk: body.privateJwk,
        pageId: body.pageId,
        title: body.title,
        recipientKeyId: body.recipientKeyId,
        recipient: body.recipient,
        subdomain: body.subdomain
      };
      const data = await api.dashboard(dashboardOpts);
      const result = await publishDashboard(data, publishOpts);
      return sendJson(res, 201, result);
    }

    if (method === 'POST' && route === '/api/v1/threshold-attest') {
      const body = bodyOrRead || await readBody(req);
      if (!body.key) return sendError(res, 400, 'key is required');
      if (!body.opinion) return sendError(res, 400, 'opinion is required');
      if (body.confidence === undefined) return sendError(res, 400, 'confidence is required');
      if (!body.reason) return sendError(res, 400, 'reason is required');
      if (!body.policy?.threshold) return sendError(res, 400, 'policy.threshold is required');
      if (!body.policy?.coSignerAgentIds?.length) return sendError(res, 400, 'policy.coSignerAgentIds is required');
      const envelope = await api.createThresholdAttestation(body);
      return sendJson(res, 201, envelope);
    }

    if (method === 'POST' && route === '/api/v1/threshold-attest/sign') {
      const body = bodyOrRead || await readBody(req);
      if (!body.envelopeId) return sendError(res, 400, 'envelopeId is required');
      if (!body.signer?.agentId || !body.signer?.signature) return sendError(res, 400, 'signer.agentId and signer.signature are required');
      const updated = await api.addThresholdSigner(body.envelopeId, body.signer);
      return sendJson(res, 200, updated);
    }

    if (method === 'POST' && route === '/api/v1/threshold-attest/sign-local') {
      const body = bodyOrRead || await readBody(req);
      if (!body.envelopeId) return sendError(res, 400, 'envelopeId is required');
      const updated = await api.signThresholdEnvelope(body.envelopeId);
      return sendJson(res, 200, updated);
    }

    if (method === 'POST' && route === '/api/v1/threshold-attest/finalize') {
      const body = bodyOrRead || await readBody(req);
      if (!body.envelopeId) return sendError(res, 400, 'envelopeId is required');
      const result = await api.finalizeThresholdAttestation(body.envelopeId, { useHyperbeam: parseBool(body.useHyperbeam) });
      return sendJson(res, 201, result);
    }

    if (method === 'POST' && route === '/api/v1/threshold-attest/verify') {
      const body = bodyOrRead || await readBody(req);
      if (!body.envelope) return sendError(res, 400, 'envelope is required');
      const result = await api.verifyThresholdEnvelope(body.envelope);
      return sendJson(res, 200, result);
    }

    if (route === '/api/v1/validate') {
      if (method === 'POST') {
        const body = bodyOrRead || await readBody(req);
        if (!body.tags && !body.dataItem) return sendError(res, 400, 'tags or dataItem is required');
        const type = body.type === 'attestation' ? 'attestation' : 'article';
        let result;
        try {
          if (body.dataItem) {
            result = api.validateDataItem(body.dataItem, { type });
          } else {
            result = api.validateMetadata(body.tags, { type });
          }
        } catch (err) {
          return sendError(res, 400, err.message);
        }
        return sendJson(res, result.valid ? 200 : 422, result);
      }
      if (method === 'GET') {
        const type = url.searchParams.get('type') === 'attestation' ? 'attestation' : 'article';
        const schema = type === 'attestation' ? 'ATTESTATION_METADATA_SCHEMA' : 'ARTICLE_METADATA_SCHEMA';
        return sendJson(res, 200, {
          type,
          note: 'POST to /api/v1/validate with tags or dataItem',
          schema: `/api/v1/schema#${type}`
        });
      }
    }

    if (method === 'GET' && route === '/api/v1/validate/example') {
      const type = url.searchParams.get('type') === 'attestation' ? 'attestation' : 'article';
      return sendJson(res, 200, { type, note: 'POST to /api/v1/validate with tags or dataItem' });
    }

    if (method === 'GET' && route === '/api/v1/schema') {
      const { ARTICLE_METADATA_SCHEMA, ATTESTATION_METADATA_SCHEMA } = await import('./schema.mjs');
      return sendJson(res, 200, {
        article: ARTICLE_METADATA_SCHEMA,
        attestation: ATTESTATION_METADATA_SCHEMA
      });
    }

    if (method === 'GET' && route === '/api/v1/routes') {
      const authRequired = needsAuth && !isPublic;
      return sendJson(res, 200, { routes: listRoutes({ authRequired }) });
    }

    if (method === 'GET' && route === '/api/v1/openapi.json') {
      const authRequired = needsAuth && !isPublic;
      return sendJson(res, 200, buildOpenApiDocument({ requireAuth: authRequired }));
    }

    if (method === 'POST' && route === '/api/v1/threshold-attest/import') {
      const body = bodyOrRead || await readBody(req);
      if (!body.envelope) return sendError(res, 400, 'envelope is required');
      const stored = await api.importThresholdEnvelope(body.envelope);
      return sendJson(res, 200, stored);
    }

    const envelopeMatch = route.match(/^\/api\/v1\/threshold\/envelope\/(.+)$/);
    if (envelopeMatch && method === 'GET') {
      const envelopeId = decodeURIComponent(envelopeMatch[1]);
      const envelope = await api.exportThresholdEnvelope(envelopeId);
      return sendJson(res, 200, envelope);
    }

    if (method === 'POST' && route === '/api/v1/threshold/envelope') {
      const body = bodyOrRead || await readBody(req);
      if (!body.envelope) return sendError(res, 400, 'envelope is required');
      const stored = await api.importThresholdEnvelope(body.envelope);
      return sendJson(res, 200, stored);
    }

    if (method === 'GET' && route === '/api/v1/peer/info') {
      const { peerInfo } = await import('./peer.mjs');
      const info = peerInfo(currentHome);
      return sendJson(res, 200, info);
    }

    if (method === 'GET' && route === '/api/v1/peer/diff') {
      const remote = parsedUrl.searchParams.get('remote');
      if (!remote) return sendError(res, 400, 'remote query parameter is required');
      const direction = parsedUrl.searchParams.get('direction') || 'pull';
      const includeAttestations = parsedUrl.searchParams.get('includeAttestations') !== 'false';
      const includeVersions = parsedUrl.searchParams.get('includeVersions') !== 'false';
      const { createClient } = await import('./client.mjs');
      const remoteClient = createClient({ baseUrl: remote, apiKey: parsedUrl.searchParams.get('remoteApiKey') || extractApiKey(req) });
      if (direction === 'push') {
        const { diffKeysForPush } = await import('./peer.mjs');
        const localIndex = loadIndex(currentHome);
        const remoteInfo = await remoteClient.peerInfo();
        const diff = diffKeysForPush(localIndex, remoteInfo, { includePrivate: false });
        return sendJson(res, 200, { ...diff, peer: remoteInfo, remoteBaseUrl: remote });
      }
      const { diffPeerKeys } = await import('./peer.mjs');
      const localIndex = loadIndex(currentHome);
      const remoteInfo = await remoteClient.peerInfo();
      const diff = diffPeerKeys(localIndex, remoteInfo);
      return sendJson(res, 200, { ...diff, peer: remoteInfo, remoteBaseUrl: remote });
    }

    if (method === 'POST' && route === '/api/v1/peer/pull') {
      const dryRun = parsedUrl.searchParams.get('dryRun') === 'true';
      const body = requestBody;
      if (body.remoteUrl != null) {
        const { pullFromPeer, pullFromPeerClientAsBundle } = await import('./peer.mjs');
        const { createClient } = await import('./client.mjs');
        const remoteClient = createClient({ baseUrl: body.remoteUrl, apiKey: body.remoteApiKey || extractApiKey(req) });
        if (dryRun) {
          const { bundle, diff } = await pullFromPeerClientAsBundle(remoteClient, {
            home: currentHome,
            includeAttestations: body.includeAttestations !== false,
            includeVersions: body.includeVersions !== false
          });
          return sendJson(res, 200, { dryRun: true, peer: diff.peer, remoteBaseUrl: body.remoteUrl, diff, pulled: diff.pulled || [], bundleMeta: bundle?.meta || {} });
        }
        const result = await pullFromPeer(body.remoteUrl, {
          home: currentHome,
          apiKey: body.remoteApiKey || extractApiKey(req),
          includeAttestations: body.includeAttestations !== false,
          includeVersions: body.includeVersions !== false,
          verify: body.verify !== false,
          skipDuplicates: body.skipDuplicates !== false
        });
        return sendJson(res, 200, { ...result, remoteBaseUrl: body.remoteUrl });
      }
      if (Array.isArray(body.requests)) {
        const includeAttestations = body.includeAttestations !== false;
        const { buildPeerPullBundle } = await import('./peer.mjs');
        const result = await buildPeerPullBundle(body.requests, currentHome, { includeAttestations });
        return sendJson(res, 200, result);
      }
      return sendError(res, 400, 'remoteUrl or requests array is required');
    }

    if (method === 'POST' && route === '/api/v1/peer/push') {
      const dryRun = parsedUrl.searchParams.get('dryRun') === 'true';
      const body = requestBody;
      if (body.remoteUrl != null) {
        const { pushToPeerClient, buildPeerPushBundle, diffKeysForPush } = await import('./peer.mjs');
        const { createClient } = await import('./client.mjs');
        const remoteClient = createClient({ baseUrl: body.remoteUrl, apiKey: body.remoteApiKey || extractApiKey(req) });
        if (dryRun) {
          const remoteInfo = await remoteClient.peerInfo();
          const localIndex = loadIndex(currentHome);
          const diff = diffKeysForPush(localIndex, remoteInfo, { includePrivate: false });
          const pushKeys = diff.pushed.map((p) => p.key);
          const bundle = pushKeys.length
            ? await buildPeerPushBundle(pushKeys, currentHome, {
                includeAttestations: body.includeAttestations !== false,
                includeVersions: body.includeVersions !== false
              })
            : { type: 'bundle', version: 1, entries: [], meta: { pushed: 0 } };
          return sendJson(res, 200, { dryRun: true, peer: remoteInfo, remoteBaseUrl: body.remoteUrl, diff, pushed: pushKeys, bundleMeta: bundle?.meta || {} });
        }
        const result = await pushToPeerClient(remoteClient, {
          home: currentHome,
          includeAttestations: body.includeAttestations !== false,
          includeVersions: body.includeVersions !== false,
          includePrivate: false
        });
        return sendJson(res, 200, { ...result, remoteBaseUrl: body.remoteUrl });
      }
      if (body.bundle || Array.isArray(body.entries)) {
        const bundle = body.bundle || body;
        const result = await api.importBundle(bundle, { home: currentHome, verify: body.verify !== false, skipDuplicates: body.skipDuplicates !== false });
        return sendJson(res, 200, normalizeImportResult(result));
      }
      return sendError(res, 400, 'remoteUrl or bundle/entries is required');
    }

    return sendError(res, 404, `Unknown route: ${method} ${pathname}`);
  } catch (err) {
    const status = err.status || (err.message?.includes('required') ? 400 : (err.message?.includes('Article not found') || err.message?.includes('Attestation not found') || err.message?.includes('not found') ? 404 : 500));
    if (res._recordRouteOutcome) res._recordRouteOutcome(status, status >= 500);
    sendError(res, status, err.message || String(err));
  }
}

export function createServer(options = {}) {
  const home = options.home || process.env.PERMABRAIN_HOME || getHome();
  const streamTransport = normalizeStreamTransport(options.streamTransport || process.env.PERMABRAIN_STREAM_TRANSPORT);
  const apiKey = options.apiKey || process.env.PERMABRAIN_API_KEY || undefined;
  const apiKeyAuth = apiKey ? createApiKeyAuth({ apiKey }) : null;
  const corsOrigin = options.corsOrigin || process.env.PERMABRAIN_CORS_ORIGIN || '*';

  // Rate limiting: disabled by default unless an option/env is provided. `0`
  // disables the limiter entirely.
  const rateLimitMax = options.rateLimit !== undefined
    ? options.rateLimit
    : (process.env.PERMABRAIN_RATE_LIMIT !== undefined ? process.env.PERMABRAIN_RATE_LIMIT : undefined);
  const rateLimitWindow = options.rateWindow || process.env.PERMABRAIN_RATE_WINDOW;
  const rateLimitBurst = options.rateBurst || process.env.PERMABRAIN_RATE_BURST;
  const trustProxy = options.trustProxy || process.env.PERMABRAIN_TRUST_PROXY;
  const rateLimiter = rateLimitMax === 0 || rateLimitMax === '0'
    ? null
    : createRateLimiter({
        max: rateLimitMax,
        windowMs: rateLimitWindow,
        burst: rateLimitBurst,
        trustProxy
      });

  const accessLogFormat = options.accessLog || process.env.PERMABRAIN_ACCESS_LOG || 'none';
  const requestLoggerMaxEntries = options.requestLogMaxEntries || process.env.PERMABRAIN_REQUEST_LOG_MAX_ENTRIES;
  const accessLogDir = options.accessLogDir || process.env.PERMABRAIN_ACCESS_LOG_DIR || undefined;
  const accessLogMaxSize = options.accessLogMaxSize || process.env.PERMABRAIN_ACCESS_LOG_MAX_SIZE || undefined;
  const accessLogMaxFiles = options.accessLogMaxFiles || process.env.PERMABRAIN_ACCESS_LOG_MAX_FILES || undefined;
  const accessLogRetentionDays = options.accessLogRetentionDays || process.env.PERMABRAIN_ACCESS_LOG_RETENTION_DAYS || undefined;
  const reqLogger = requestLogger({
    format: accessLogFormat,
    maxEntries: requestLoggerMaxEntries,
    trustProxy,
    home,
    logDir: accessLogDir,
    maxSize: accessLogMaxSize,
    maxFiles: accessLogMaxFiles,
    retentionDays: accessLogRetentionDays
  });

  const runtimeMetrics = createRuntimeMetrics();

  const serverOptions = { ...options, home, streamTransport, apiKeyAuth, corsOrigin, rateLimiter, requestLogger: reqLogger, runtimeMetrics };
  const server = http.createServer((req, res) => {
    reqLogger.middleware()(req, res, () => handleRequest(req, res, home, serverOptions));
  });

  if (runtimeMetrics) {
    const handler = () => runtimeMetrics.setActiveStreams({ sse: sseClients.size, websocket: wsClients.size });
    server.on('request', handler);
    server.permabrainMetricsHandler = handler;
  }

  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url, `http://localhost`);
    const pathname = url.pathname.replace(/\/$/, '');
    const requestId = request.headers['x-request-id'] || `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    if (apiKeyAuth && apiKeyAuth.apiKeys.length > 0) {
      const authResult = apiKeyAuth.check({ headers: request.headers, url: request.url });
      if (!authResult.ok) {
        socket.write(`HTTP/1.1 ${authResult.status} ${authResult.error}\r\nX-Request-ID: ${requestId}\r\n\r\n`);
        socket.destroy();
        return;
      }
    }
    if (pathname === '/api/v1/events/ws') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wsClients.add(ws);
        ws.send(JSON.stringify({ type: 'open', timestamp: new Date().toISOString() }));
        maybeStartEventSubscription();
        ws.on('close', () => {
          wsClients.delete(ws);
          if (wsClients.size === 0 && sseClients.size === 0) stopEventSubscription();
        });
        ws.on('error', () => {
          wsClients.delete(ws);
          if (wsClients.size === 0 && sseClients.size === 0) stopEventSubscription();
        });
      });
    } else if (pathname === '/api/v1/articles/stream') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        const filters = {
          topic: url.searchParams.get('topic') || undefined,
          kind: url.searchParams.get('kind') || undefined,
          agent: url.searchParams.get('agent') || undefined,
          key: url.searchParams.get('key') || undefined,
          events: url.searchParams.get('events') || undefined
        };
        const controller = new AbortController();
        ws.send(JSON.stringify({ type: 'open', timestamp: new Date().toISOString() }));
        (async () => {
          try {
            const { subscribeQuery } = await import('./query-stream.mjs');
            const sub = subscribeQuery({ ...filters, signal: controller.signal });
            for await (const event of sub) {
              if (ws.readyState !== 1) break;
              ws.send(JSON.stringify(event));
            }
          } catch {
            // subscription cancelled or closed
          } finally {
            try { ws.close(); } catch {}
          }
        })();
        ws.on('close', () => controller.abort());
        ws.on('error', () => controller.abort());
      });
    } else {
      socket.destroy();
    }
  });

  return { server, home, wss, streamTransport, requestLogger: reqLogger };
}

export async function startServer(options = {}) {
  const { server, home, wss, streamTransport, requestLogger } = createServer(options);
  const requestedPort = options.port ?? (process.env.PERMABRAIN_PORT || DEFAULT_PORT);
  await new Promise((resolve, reject) => {
    server.listen(requestedPort, (err) => (err ? reject(err) : resolve()));
  });
  const actualPort = server.address()?.port || requestedPort;
  await ensureApiInit(home);
  // Force the loaded config to match the requested home/env so API calls inside
  // the server use the intended transport and state directory.
  if (fs.existsSync(path.join(home, 'config.json'))) {
    api._config = loadConfig(home);
  } else {
    initState({ env: { ...process.env, PERMABRAIN_HOME: home } });
    await ensureIdentity(home);
    api._config = loadConfig(home);
  }
  api._home = home;
  const identity = api._identity;
  return { server, home, port: actualPort, agentId: identity?.agentId || null, wss, streamTransport, requestLogger };
}

export function stopServer(server) {
  return new Promise((resolve) => {
    stopEventSubscription();
    stopRuntimeMetrics(server?.runtimeMetrics);
    if (server?.permabrainMetricsHandler) {
      server.off('request', server.permabrainMetricsHandler);
      server.permabrainMetricsHandler = null;
    }
    for (const ws of wsClients) {
      try { ws.close(); } catch {}
    }
    wsClients.clear();
    for (const res of sseClients) {
      try { res.end(); } catch {}
    }
    sseClients.clear();
    server.close(resolve);
  });
}

export { createRuntimeMetrics, stopRuntimeMetrics, buildMetricsReport, formatPrometheus };
