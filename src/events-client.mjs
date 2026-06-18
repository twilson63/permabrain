/**
 * PermaBrain Remote Event Subscriber
 *
 * Connects to a running `permabrain serve` instance and streams live events
 * over Server-Sent Events (default) or WebSocket. Used by the CLI `events`
 * command and available programmatically via `api.subscribeEventsRemote()`.
 */

import { URL } from 'node:url';

const DEFAULT_BASE_URL = 'http://localhost:8765';
const DEFAULT_SSE_HEARTBEAT_MS = 30000;

function parseEventsArg(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  return String(value).split(',').map((s) => s.trim()).filter(Boolean);
}

function parseBaseUrl(value) {
  const url = value || DEFAULT_BASE_URL;
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

/**
 * Format an event for terminal output.
 *
 * @param {object} event
 * @param {'json'|'compact'} [format='compact']
 * @returns {string}
 */
export function formatEvent(event, format = 'compact') {
  if (format === 'json') return JSON.stringify(event);
  if (event.type === 'heartbeat') return `[heartbeat ${event.timestamp}]`;
  const name = event.name || event.type || 'event';
  const ts = event.timestamp || new Date().toISOString();
  const key = event.key || event.targetKey || '';
  const agent = event.agentId || event.authorAgentId || '';
  const title = event.title || '';
  const parts = [`[${ts}] ${name}`];
  if (key) parts.push(`key=${key}`);
  if (agent) parts.push(`agent=${agent}`);
  if (title) parts.push(`title="${title}"`);
  return parts.join(' ');
}

/**
 * Subscribe to events from a remote PermaBrain server via Server-Sent Events.
 *
 * @param {object} opts
 * @param {string} [opts.baseUrl]
 * @param {string|string[]} [opts.events]
 * @param {number} [opts.heartbeatMs]
 * @param {AbortSignal} [opts.signal]
 * @returns {{[Symbol.asyncIterator]: function, cancel: function}}
 */
export function subscribeEventsOverSse(opts = {}) {
  const baseUrl = parseBaseUrl(opts.baseUrl);
  const events = parseEventsArg(opts.events);
  const signal = opts.signal;
  const urlPath = opts.url || '/api/v1/events/stream';
  const url = new URL(urlPath.startsWith('http') ? urlPath : `${baseUrl}${urlPath}`);
  if (events.length > 0) url.searchParams.set('events', events.join(','));

  let reader = null;
  let response = null;
  let running = true;
  let buffer = '';
  const queue = [];
  let resolveNext = null;

  function push(event) {
    if (resolveNext) {
      resolveNext({ value: event, done: false });
      resolveNext = null;
    } else {
      queue.push(event);
    }
  }

  function finish() {
    running = false;
    if (resolveNext) {
      resolveNext({ value: undefined, done: true });
      resolveNext = null;
    }
  }

  function parseSseChunk(chunk) {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop(); // keep incomplete tail
    let currentData = null;
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        currentData = line.slice(6);
      } else if (line.trim() === '' && currentData !== null) {
        try {
          push(JSON.parse(currentData));
        } catch {
          push({ type: 'raw', data: currentData });
        }
        currentData = null;
      }
    }
  }

  async function start() {
    try {
      response = await fetch(url.toString(), {
        headers: { Accept: 'text/event-stream' },
        signal
      });
      if (!response.ok) {
        throw new Error(`SSE subscription failed: HTTP ${response.status}`);
      }
      reader = response.body.getReader();
      const decoder = new TextDecoder();
      while (running) {
        const { done, value } = await reader.read();
        if (done) break;
        parseSseChunk(decoder.decode(value, { stream: true }));
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        push({ type: 'error', name: 'error', timestamp: new Date().toISOString(), message: err.message });
      }
    } finally {
      finish();
    }
  }

  start();

  function cancel() {
    running = false;
    try { reader?.cancel().catch(() => {}); } catch {}
    finish();
  }

  if (signal) signal.addEventListener('abort', cancel, { once: true });

  async function* generator() {
    try {
      while (running || queue.length > 0) {
        if (queue.length > 0) {
          yield queue.shift();
          continue;
        }
        const next = await new Promise((resolve) => { resolveNext = resolve; });
        if (next.done) return;
        yield next.value;
      }
    } finally {
      cancel();
    }
  }

  return { [Symbol.asyncIterator]: generator, cancel };
}

/**
 * Subscribe to events from a remote PermaBrain server via WebSocket.
 *
 * @param {object} opts
 * @param {string} [opts.baseUrl]
 * @param {string|string[]} [opts.events]
 * @param {AbortSignal} [opts.signal]
 * @returns {{[Symbol.asyncIterator]: function, cancel: function}}
 */
export function subscribeEventsOverWebSocket(opts = {}) {
  const baseUrl = parseBaseUrl(opts.baseUrl);
  const events = parseEventsArg(opts.events);
  const signal = opts.signal;

  const wsUrl = baseUrl.replace(/^http/, 'ws') + '/api/v1/events/ws';
  const queue = [];
  let resolveNext = null;
  let running = true;
  let ws = null;

  function push(event) {
    if (resolveNext) {
      resolveNext({ value: event, done: false });
      resolveNext = null;
    } else {
      queue.push(event);
    }
  }

  function finish() {
    running = false;
    if (resolveNext) {
      resolveNext({ value: undefined, done: true });
      resolveNext = null;
    }
  }

  async function start() {
    try {
      const { WebSocket } = await import('ws');
      ws = new WebSocket(wsUrl);
      ws.on('open', () => {
        if (events.length > 0) {
          ws.send(JSON.stringify({ type: 'subscribe', events }));
        }
      });
      ws.on('message', (data) => {
        try {
          push(JSON.parse(data.toString()));
        } catch {
          push({ type: 'raw', data: String(data) });
        }
      });
      ws.on('error', (err) => {
        push({ type: 'error', name: 'error', timestamp: new Date().toISOString(), message: err.message });
      });
      ws.on('close', () => finish());
    } catch (err) {
      push({ type: 'error', name: 'error', timestamp: new Date().toISOString(), message: err.message });
      finish();
    }
  }

  start();

  function cancel() {
    running = false;
    try { ws?.close(); } catch {}
    finish();
  }

  if (signal) signal.addEventListener('abort', cancel, { once: true });

  async function* generator() {
    try {
      while (running || queue.length > 0) {
        if (queue.length > 0) {
          yield queue.shift();
          continue;
        }
        const next = await new Promise((resolve) => { resolveNext = resolve; });
        if (next.done) return;
        yield next.value;
      }
    } finally {
      cancel();
    }
  }

  return { [Symbol.asyncIterator]: generator, cancel };
}

/**
 * Subscribe to remote events, choosing SSE or WebSocket transport.
 *
 * @param {object} opts
 * @param {'sse'|'ws'} [opts.transport='sse']
 * @returns {{[Symbol.asyncIterator]: function, cancel: function}}
 */
export function subscribeEventsRemote(opts = {}) {
  const transport = opts.transport || 'sse';
  if (transport === 'ws' || transport === 'websocket') {
    return subscribeEventsOverWebSocket(opts);
  }
  return subscribeEventsOverSse({ ...opts, heartbeatMs: opts.heartbeatMs || DEFAULT_SSE_HEARTBEAT_MS });
}

/**
 * Run an interactive event subscription for the CLI.
 *
 * @param {object} opts
 * @returns {Promise<{count: number}>}
 */
export async function runEventsSubscriber(opts = {}) {
  const transport = opts.transport || 'sse';
  const format = opts.format || 'compact';
  const maxEvents = Number.isFinite(opts.maxEvents) ? opts.maxEvents : Infinity;
  const maxMs = Number.isFinite(opts.maxMs) ? opts.maxMs : Infinity;
  const controller = new AbortController();
  const startTime = Date.now();
  let count = 0;

  function stop() {
    controller.abort();
  }

  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  try {
    const sub = subscribeEventsRemote({ ...opts, signal: controller.signal });
    for await (const event of sub) {
      if (event.type === 'error') {
        if (opts.json) {
          console.log(JSON.stringify(event));
        } else {
          console.error(`Error: ${event.message}`);
        }
        continue;
      }
      if (opts.json) {
        console.log(JSON.stringify(event));
      } else {
        console.log(formatEvent(event, format));
      }
      count++;
      if (count >= maxEvents || (Date.now() - startTime) >= maxMs) {
        stop();
        break;
      }
    }
  } finally {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
  }

  return { count, transport };
}
