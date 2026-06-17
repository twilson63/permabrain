/**
 * PermaBrain Real-Time Event Bus
 *
 * Lightweight EventEmitter-based bus used by the local HTTP server to
 * stream publish/attest/fork/merge/import/export/backup/init events to
 * WebSocket and Server-Sent Events clients.
 *
 * The audit log is the source of truth: `logAction()` emits a 'log' event
 * whenever a new audit entry is appended. The server forwards these events
 * (and a periodic heartbeat) to connected clients. Consumers can also
 * subscribe directly via `api.events()`.
 */

import { EventEmitter } from 'node:events';

const GLOBAL_BUS = Symbol.for('permabrain.events.bus');
const GLOBAL_EMITTER = Symbol.for('permabrain.events.emitter');

let singletonEmitter = null;

if (typeof globalThis[GLOBAL_EMITTER] === 'undefined') {
  singletonEmitter = new EventEmitter();
  singletonEmitter.setMaxListeners(200);
  globalThis[GLOBAL_EMITTER] = singletonEmitter;
} else {
  singletonEmitter = globalThis[GLOBAL_EMITTER];
}

export function getEventBus() {
  return singletonEmitter;
}

/**
 * Emit a structured event. Used by the audit log and other action modules.
 *
 * @param {string} eventName - e.g. 'publish', 'attest', 'fork', 'merge'
 * @param {object} payload - structured event payload
 */
export function emitEvent(eventName, payload = {}) {
  const bus = getEventBus();
  const event = {
    type: 'event',
    name: eventName,
    timestamp: new Date().toISOString(),
    ...payload
  };
  bus.emit('event', event);
  bus.emit(eventName, event);
  return event;
}

/**
 * Return an async iterator over all events matching a set of names.
 *
 * @param {object} opts
 * @param {string[]} [opts.events] - Names to subscribe to; omit for all events
 * @param {number} [opts.heartbeatMs=30000] - Periodic heartbeat interval
 * @param {AbortSignal} [opts.signal] - Abort signal to stop iteration
 * @returns {{[Symbol.asyncIterator]: function, cancel: function}}
 */
export function subscribeEvents(opts = {}) {
  const bus = getEventBus();
  const names = opts.events || [];
  const heartbeatMs = Number.isFinite(opts.heartbeatMs) ? Math.max(1000, opts.heartbeatMs) : 30000;
  const queue = [];
  let running = true;

  function handler(event) {
    if (names.length === 0 || names.includes(event.name)) {
      queue.push(event);
    }
  }

  bus.on('event', handler);

  const onAbort = () => {
    running = false;
    bus.off('event', handler);
    if (opts.signal) opts.signal.removeEventListener('abort', onAbort);
  };

  if (opts.signal) opts.signal.addEventListener('abort', onAbort, { once: true });

  async function* generator() {
    try {
      let lastHeartbeat = Date.now();
      while (running) {
        if (queue.length > 0) {
          yield queue.shift();
          continue;
        }
        if (Date.now() - lastHeartbeat >= heartbeatMs) {
          lastHeartbeat = Date.now();
          yield { type: 'heartbeat', timestamp: new Date().toISOString() };
          continue;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    } finally {
      onAbort();
    }
  }

  return {
    [Symbol.asyncIterator]: generator,
    cancel: onAbort
  };
}

/**
 * Utility used by serve.mjs to broadcast an event to a Set of WebSocket clients.
 *
 * @param {Set<WebSocket>} clients
 * @param {object} event
 */
export function broadcastToWebSockets(clients, event) {
  const text = JSON.stringify(event);
  for (const ws of clients) {
    try {
      if (ws.readyState === 1) ws.send(text);
    } catch {
      // ignore send failures
    }
  }
}

/**
 * Utility to write an SSE event to an HTTP response.
 *
 * @param {http.ServerResponse} res
 * @param {object} event
 */
export function writeSseEvent(res, event) {
  if (res.writableEnded) return;
  try {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  } catch {
    // ignore write failures
  }
}

export { GLOBAL_BUS, GLOBAL_EMITTER };
