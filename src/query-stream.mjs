/**
 * PermaBrain Query Stream
 *
 * Live query subscription over the local event bus. Filters real-time
 * article/attestation updates by topic, kind, agent, key, and event names.
 * Used by `api.subscribeQuery()`, the HTTP `/api/v1/articles/stream` SSE
 * endpoint, and the `permabrain query-stream` CLI command.
 */

import { getEventBus, subscribeEvents } from './events.mjs';

/**
 * Normalize an event filter argument to an array of strings.
 * @param {string|string[]|undefined} value
 * @returns {string[]}
 */
function parseListArg(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  return String(value).split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * Check whether a structured event matches a set of query-stream filters.
 *
 * Filters:
 *   - topic:      matches Article-Topic, topic, or attestation target article topic
 *   - kind:       matches Article-Kind or kind
 *   - agent:      matches authorAgentId, agentId, attestingAgentId, or Attestation-Agent-Id
 *   - key:        matches key, targetKey, or Attestation-Target-Key
 *   - events:     whitelist of event names (publish, attest, fork, merge, import, export, backup, init, etc.)
 *
 * @param {object} event
 * @param {object} filters
 * @returns {boolean}
 */
export function matchesQueryStream(event, filters = {}) {
  if (!event || typeof event !== 'object') return false;

  const names = parseListArg(filters.events);
  if (names.length > 0 && !names.includes(event.name)) return false;

  const topics = parseListArg(filters.topic);
  const kinds = parseListArg(filters.kind);
  const agents = parseListArg(filters.agent);
  const keys = parseListArg(filters.key);

  const articleTopic = event.topic ?? event.articleTopic ?? event['Article-Topic'];
  const articleKind = event.kind ?? event.articleKind ?? event['Article-Kind'];
  const articleKey = event.key ?? event.targetKey ?? event['Article-Key'] ?? event['Attestation-Target-Key'];

  const agentId = event.agentId ?? event.authorAgentId ?? event.attestingAgentId ?? event['Attestation-Agent-Id'];

  if (topics.length > 0) {
    if (!articleTopic) return false;
    if (!topics.includes(articleTopic)) return false;
  }
  if (kinds.length > 0) {
    if (!articleKind) return false;
    if (!kinds.includes(articleKind)) return false;
  }
  if (agents.length > 0) {
    if (!agentId) return false;
    if (!agents.includes(agentId)) return false;
  }
  if (keys.length > 0) {
    if (!articleKey) return false;
    if (!keys.includes(articleKey)) return false;
  }

  return true;
}

/**
 * Subscribe to a live, filtered stream of article/attestation events.
 *
 * @param {object} opts
 * @param {string|string[]} [opts.topic]
 * @param {string|string[]} [opts.kind]
 * @param {string|string[]} [opts.agent]
 * @param {string|string[]} [opts.key]
 * @param {string|string[]} [opts.events]
 * @param {number} [opts.heartbeatMs=30000]
 * @param {AbortSignal} [opts.signal]
 * @returns {{[Symbol.asyncIterator]: function, cancel: function}}
 */
export function subscribeQuery(opts = {}) {
  const filters = {
    topic: opts.topic,
    kind: opts.kind,
    agent: opts.agent,
    key: opts.key,
    events: opts.events
  };

  const heartbeatMs = Number.isFinite(opts.heartbeatMs) ? Math.max(1000, opts.heartbeatMs) : 30000;
  const signal = opts.signal;

  const source = subscribeEvents({ events: parseListArg(opts.events).length > 0 ? parseListArg(opts.events) : [], heartbeatMs, signal });
  let running = true;

  function cancel() {
    running = false;
    source.cancel();
  }

  if (signal) signal.addEventListener('abort', cancel, { once: true });

  async function* generator() {
    try {
      for await (const event of source) {
        if (!running) return;
        if (matchesQueryStream(event, filters)) yield event;
      }
    } finally {
      cancel();
    }
  }

  return { [Symbol.asyncIterator]: generator, cancel };
}
