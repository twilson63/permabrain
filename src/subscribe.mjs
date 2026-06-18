/**
 * PermaBrain Remote Event Publisher
 *
 * Mirror of the events consumer path: connects to a remote PermaBrain peer
 * and forwards locally-generated audit events to it. Used by
 * `permabrain subscribe <remote-url>` and `api.subscribe()`.
 *
 * The publisher listens to the local event bus via `subscribeEvents()` from
 * `src/events.mjs` and POSTs each event to the remote
 * `POST /api/v1/events/publish` endpoint. Delivery is best-effort: failed
 * pushes are logged but do not block local operation.
 *
 * Events are forwarded in near-real-time with a small buffer/debounce to
 * batch rapid local activity.
 */

import { URL } from 'node:url';
import { getEventBus, subscribeEvents } from './events.mjs';

const DEFAULT_BASE_URL = 'http://localhost:8765';
const DEFAULT_BATCH_MS = 50;
const DEFAULT_MAX_QUEUE = 1000;

function parseBaseUrl(value) {
  const url = value || DEFAULT_BASE_URL;
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

function shouldForward(event, opts = {}) {
  if (event.type !== 'event') return false;
  const names = opts.events || [];
  if (names.length === 0) return true;
  return names.includes(event.name);
}

/**
 * Forward local events to a remote PermaBrain peer.
 *
 * @param {object} opts
 * @param {string} [opts.baseUrl]
 * @param {string|string[]} [opts.events]
 * @param {number} [opts.batchMs=50]
 * @param {number} [opts.maxQueue=1000]
 * @param {string|object} [opts.authHeader]
 * @param {Function} [opts.fetch=globalThis.fetch]
 * @param {AbortSignal} [opts.signal]
 * @returns {{[Symbol.asyncIterator]: function, cancel: function, push: function, flush: function}}
 */
export function forwardEvents(opts = {}) {
  const baseUrl = parseBaseUrl(opts.baseUrl);
  const events = (typeof opts.events === 'string'
    ? opts.events.split(',').map((s) => s.trim()).filter(Boolean)
    : Array.isArray(opts.events) ? opts.events : []);
  const batchMs = Number.isFinite(opts.batchMs) ? Math.max(0, opts.batchMs) : DEFAULT_BATCH_MS;
  const maxQueue = Number.isFinite(opts.maxQueue) ? Math.max(1, opts.maxQueue) : DEFAULT_MAX_QUEUE;
  const fetchFn = opts.fetch || globalThis.fetch;
  const url = new URL(`${baseUrl}/api/v1/events/publish`);

  const queue = [];
  let running = true;
  let flushTimer = null;
  let resolveNext = null;
  let eventSubscriptionDone = false;

  const headers = { 'content-type': 'application/json' };
  if (opts.authHeader) {
    if (typeof opts.authHeader === 'string') headers.authorization = opts.authHeader;
    else Object.assign(headers, opts.authHeader);
  }

  async function flush() {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    if (queue.length === 0) return;
    const batch = queue.splice(0, queue.length);
    try {
      const response = await fetchFn(url.toString(), {
        method: 'POST',
        headers,
        body: JSON.stringify({ events: batch }),
        signal: opts.signal
      });
      if (!response.ok) {
        throw new Error(`Remote publish failed: HTTP ${response.status}`);
      }
      for (const event of batch) pushResult({ type: 'forwarded', event });
    } catch (err) {
      if (err.name !== 'AbortError') {
        for (const event of batch) pushResult({ type: 'error', event, message: err.message });
      }
    }
  }

  function scheduleFlush() {
    if (flushTimer || !running) return;
    flushTimer = setTimeout(() => { flushTimer = null; flush(); }, batchMs);
  }

  function pushResult(result) {
    if (resolveNext) {
      resolveNext({ value: result, done: false });
      resolveNext = null;
    } else if (queue.length < maxQueue) {
      // For results we use a separate results queue isn't needed for the
      // primary forwarding contract. Dropping on overload is acceptable.
    }
  }

  const sub = subscribeEvents({ events: [], heartbeatMs: 0 });

  async function consumeLocalEvents() {
    try {
      for await (const event of sub) {
        if (!running) break;
        if (!shouldForward(event, { events })) continue;
        queue.push(event);
        if (queue.length >= maxQueue) {
          await flush();
        } else {
          scheduleFlush();
        }
      }
    } catch {
      // subscription cancelled or bus error
    } finally {
      eventSubscriptionDone = true;
      await flush();
    }
  }

  consumeLocalEvents();

  function cancel() {
    running = false;
    sub.cancel();
    if (flushTimer) clearTimeout(flushTimer);
    flush();
  }

  if (opts.signal) opts.signal.addEventListener('abort', cancel, { once: true });

  async function* generator() {
    try {
      while (running || !eventSubscriptionDone || queue.length > 0) {
        const next = await new Promise((resolve) => { resolveNext = resolve; });
        if (next.done) return;
        yield next.value;
      }
    } finally {
      cancel();
      // Drain the background consumer so timers/subscriptions don't keep
      // the process alive after the generator is closed.
      await consumeLocalEvents().catch(() => {});
    }
  }

  return {
    [Symbol.asyncIterator]: generator,
    cancel,
    push(event) {
      if (!running) return;
      if (shouldForward(event, { events })) {
        queue.push(event);
        scheduleFlush();
      }
    },
    flush
  };
}

/**
 * Run a publisher loop from the CLI.
 *
 * @param {object} opts
 * @returns {Promise<{forwarded: number, errors: number}>}
 */
export async function runEventPublisher(opts = {}) {
  const controller = new AbortController();

  function stop() {
    controller.abort();
  }

  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  let forwarded = 0;
  let errors = 0;

  try {
    const pub = forwardEvents({ ...opts, signal: controller.signal });
    const consumer = (async () => {
      for await (const result of pub) {
        if (result.type === 'forwarded') forwarded++;
        else if (result.type === 'error') {
          errors++;
          if (opts.verbose) console.error(`Forward error: ${result.message}`);
        }
        if (opts.maxEvents && forwarded + errors >= opts.maxEvents) {
          stop();
          break;
        }
      }
    })();

    // Wait for abort or consumer completion with a bounded timeout so CLI
    // tests and the build loop don't hang on event-less nodes.
    await Promise.race([
      consumer,
      new Promise((resolve) => {
        const onAbort = () => resolve();
        controller.signal.addEventListener('abort', onAbort, { once: true });
      }),
      new Promise((resolve) => setTimeout(resolve, opts.timeoutMs ?? 10000))
    ]);
    pub.cancel();
  } finally {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
  }

  return { forwarded, errors };
}
