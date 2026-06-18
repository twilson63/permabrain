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
 *   POST /api/v1/validate            → validate article/attestation metadata or DataItem tags
 *   GET  /api/v1/validate?type=...     → validation info
 *   GET  /api/v1/schema              → JSON schemas for article/attestation metadata
 *   GET  /api/v1/routes              → registered HTTP route catalog
 *   GET  /api/v1/openapi.json        → OpenAPI 3.0 JSON document
 *   GET  /api/v1/events/stream       → Server-Sent Events real-time stream
 *   GET  /api/v1/events/ws           → WebSocket upgrade for real-time events
 *
 * Errors return JSON with { error, status } and appropriate HTTP status codes.
 */

import http from 'node:http';
import { URL } from 'node:url';
import { WebSocketServer } from 'ws';
import { initState, getHome, loadConfig, defaultConfig } from './config.mjs';
import { ensureIdentity, loadIdentity, publicIdentity } from './keys.mjs';
import { api } from './agent-api.mjs';
import { getEventBus, subscribeEvents, emitEvent, broadcastToWebSockets, writeSseEvent } from './events.mjs';
import { createApiKeyAuth, generateApiKey } from './auth.mjs';
import { buildOpenApiDocument, listRoutes } from './route-registry.mjs';

const DEFAULT_PORT = 8765;
const DEFAULT_SSE_HEARTBEAT_MS = 30000;

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body, null, 2));
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

function sendError(res, status, message) {
  sendJson(res, status, { error: message, status });
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
  const method = req.method;
  const pathname = url.pathname;

  const route = pathname.replace(/\/$/, '') || '/';

  try {
    let body = null;
    const auth = options.apiKeyAuth;
    const needsAuth = auth && auth.apiKeys.length > 0;
    const isPublic = route === '/health' || route === '/api/v1/events/stream' || route === '/api/v1/events/ws' || route === '/api/v1/articles/stream' || route.startsWith('/api/v1/articles/stream');
    if (needsAuth && !isPublic) {
      body = await readBody(req);
      const authResult = auth.check({ headers: req.headers, url: req.url }, body);
      if (!authResult.ok) {
        return sendError(res, authResult.status, authResult.error);
      }
    }

    const bodyOrRead = body ?? (method === 'POST' || method === 'PUT' || method === 'PATCH' ? await readBody(req) : null);
    body = bodyOrRead;
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
      const opts = {
        kind: url.searchParams.get('kind'),
        topic: url.searchParams.get('topic'),
        author: url.searchParams.get('author'),
        after: url.searchParams.get('after'),
        before: url.searchParams.get('before'),
        top: url.searchParams.has('top') ? Number(url.searchParams.get('top')) : undefined
      };
      const result = await api.metrics(opts);
      return sendJson(res, 200, result);
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
        const result = await api.exportBundle(opts);
        return sendJson(res, 200, result);
      }
      if (method === 'POST') {
        const body = bodyOrRead || await readBody(req);
        if (!body.bundle) return sendError(res, 400, 'bundle is required');
        const result = await api.importBundle(body.bundle, body.options || {});
        return sendJson(res, 200, result);
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
      if (!body.bundle) return sendError(res, 400, 'bundle is required');
      const result = await api.importHistory(body.bundle, body.options || {});
      return sendJson(res, 200, result);
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
      const updated = api.addThresholdSigner(body.envelopeId, body.signer);
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

    if (method === 'POST' && route === '/api/v1/peer/pull') {
      const body = bodyOrRead || await readBody(req);
      if (!Array.isArray(body.requests)) return sendError(res, 400, 'requests array is required');
      const includeAttestations = body.includeAttestations !== false;
      const { buildPeerPullBundle } = await import('./peer.mjs');
      const result = await buildPeerPullBundle(body.requests, currentHome, { includeAttestations });
      return sendJson(res, 200, result);
    }

    if (method === 'POST' && route === '/api/v1/peer/push') {
      const body = bodyOrRead || await readBody(req);
      if (!body.bundle && !Array.isArray(body.entries)) return sendError(res, 400, 'bundle object with entries is required');
      const bundle = body.bundle || body;
      const result = await api.importBundle(bundle, { home: currentHome, verify: body.verify !== false, skipDuplicates: body.skipDuplicates !== false });
      return sendJson(res, 200, { imported: result.filter((r) => r.ok && r.imported).length, skipped: result.filter((r) => r.ok && !r.imported).length, failed: result.filter((r) => !r.ok).length, results: result });
    }

    return sendError(res, 404, `Unknown route: ${method} ${pathname}`);
  } catch (err) {
    const status = err.status || (err.message?.includes('required') ? 400 : 500);
    sendError(res, status, err.message || String(err));
  }
}

export function createServer(options = {}) {
  const home = options.home || process.env.PERMABRAIN_HOME || getHome();
  const streamTransport = normalizeStreamTransport(options.streamTransport || process.env.PERMABRAIN_STREAM_TRANSPORT);
  const apiKey = options.apiKey || process.env.PERMABRAIN_API_KEY || undefined;
  const apiKeyAuth = apiKey ? createApiKeyAuth({ apiKey }) : null;
  const serverOptions = { ...options, home, streamTransport, apiKeyAuth };
  const server = http.createServer((req, res) => handleRequest(req, res, home, serverOptions));

  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url, `http://localhost`);
    const pathname = url.pathname.replace(/\/$/, '');
    if (apiKeyAuth && apiKeyAuth.apiKeys.length > 0) {
      const authResult = apiKeyAuth.check({ headers: request.headers, url: request.url });
      if (!authResult.ok) {
        socket.write(`HTTP/1.1 ${authResult.status} ${authResult.error}\r\n\r\n`);
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

  return { server, home, wss, streamTransport };
}

export async function startServer(options = {}) {
  const { server, home, wss, streamTransport } = createServer(options);
  const requestedPort = options.port ?? (process.env.PERMABRAIN_PORT || DEFAULT_PORT);
  await new Promise((resolve, reject) => {
    server.listen(requestedPort, (err) => (err ? reject(err) : resolve()));
  });
  const actualPort = server.address()?.port || requestedPort;
  await ensureApiInit(home);
  const identity = api._identity;
  return { server, home, port: actualPort, agentId: identity?.agentId || null, wss, streamTransport };
}

export function stopServer(server) {
  return new Promise((resolve) => {
    stopEventSubscription();
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
