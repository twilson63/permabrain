/**
 * PermaBrain watch — poll a transport for new articles and attestations.
 *
 * Watches the configured transport (local, Arweave, or HyperBEAM) and emits
 * events for items that have not been seen in a previous poll. State is
 * persisted to $PERMABRAIN_HOME/cache/watch-state.json so restarts don't
 * re-emit the whole history.
 */

import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, getHome } from './config.mjs';
import { getTransport } from './transport.mjs';
import { summarizeArticle, summarizeAttestation } from './cache.mjs';

const DEFAULT_INTERVAL_SECONDS = 30;

function watchStatePath(home) {
  return path.join(home, 'cache', 'watch-state.json');
}

function loadWatchState(statePath) {
  if (!fs.existsSync(statePath)) {
    return { articleIds: [], attestationIds: [], lastRun: null };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    return {
      articleIds: Array.isArray(raw.articleIds) ? raw.articleIds : [],
      attestationIds: Array.isArray(raw.attestationIds) ? raw.attestationIds : [],
      lastRun: raw.lastRun || null
    };
  } catch {
    return { articleIds: [], attestationIds: [], lastRun: null };
  }
}

function saveWatchState(statePath, state) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify({
    articleIds: [...state.articleIds],
    attestationIds: [...state.attestationIds],
    lastRun: state.lastRun
  }, null, 2) + '\n');
}

function buildArticleFilters(filters) {
  const tagFilters = {
    'App-Name': 'PermaBrain',
    'PermaBrain-Type': 'article'
  };
  if (filters.topic) tagFilters['Article-Topic'] = filters.topic;
  if (filters.kind) tagFilters['Article-Kind'] = filters.kind;
  if (filters.key) tagFilters['Article-Key'] = filters.key;
  return tagFilters;
}

function buildAttestationFilters(filters) {
  const tagFilters = {
    'App-Name': 'PermaBrain',
    'PermaBrain-Type': 'attestation'
  };
  if (filters.key) tagFilters['Attestation-Target-Key'] = filters.key;
  return tagFilters;
}

/**
 * Run a single watch poll and return newly discovered items.
 *
 * @param {Object} opts
 * @param {string} opts.home
 * @param {Object} opts.config
 * @param {Object} opts.transport
 * @param {Object} opts.state
 * @param {Object} [opts.filters]
 * @returns {{articles: Array, attestations: Array, state: Object}}
 */
export async function pollOnce(opts) {
  const { config, transport, state, filters = {} } = opts;
  const seenArticles = new Set(state.articleIds);
  const seenAttestations = new Set(state.attestationIds);

  const articleItems = await transport.queryByTags(buildArticleFilters(filters));
  const attestationItems = await transport.queryByTags(buildAttestationFilters(filters));

  const articles = [];
  for (const item of articleItems) {
    const summary = summarizeArticle(item);
    if (!summary.key || !summary.id) continue;
    if (seenArticles.has(summary.id)) continue;
    seenArticles.add(summary.id);
    articles.push(summary);
  }

  const attestations = [];
  for (const item of attestationItems) {
    const summary = summarizeAttestation(item);
    if (!summary.id) continue;
    if (seenAttestations.has(summary.id)) continue;
    seenAttestations.add(summary.id);
    attestations.push(summary);
  }

  state.articleIds = [...seenArticles];
  state.attestationIds = [...seenAttestations];
  state.lastRun = new Date().toISOString();

  return { articles, attestations, state };
}

/**
 * Watch the configured transport for new articles and attestations.
 *
 * @param {Object} [opts]
 * @param {boolean} [opts.useHyperbeam] - Force HyperbeamTransport
 * @param {string} [opts.topic] - Filter articles by topic
 * @param {string} [opts.kind] - Filter articles by kind
 * @param {string} [opts.key] - Filter by article/attestation target key
 * @param {number} [opts.interval] - Poll interval in seconds (default 30)
 * @param {boolean} [opts.once] - Run one poll and return
 * @param {boolean} [opts.json] - Emit JSON events to console
 * @param {Function} [opts.onEvent] - Called with each event object
 * @returns {Promise<{cancel: Function}>} - Call cancel() to stop watching
 */
export async function watch(opts = {}) {
  const home = opts.home || getHome();
  const config = opts.config || loadConfig(home);
  const transport = opts.transport || getTransport(config, home, { useHyperbeam: opts.useHyperbeam });
  const statePath = watchStatePath(home);
  const state = opts.state || loadWatchState(statePath);
  const interval = Math.max(1, Number(opts.interval || DEFAULT_INTERVAL_SECONDS)) * 1000;
  const filters = { topic: opts.topic, kind: opts.kind, key: opts.key };

  let running = true;
  let timeoutId = null;

  function emit(event) {
    if (opts.onEvent) {
      opts.onEvent(event);
      return;
    }
    if (opts.json) {
      console.log(JSON.stringify(event));
    } else {
      if (event.type === 'article') {
        console.log(`[article] ${event.key} v${event.version} — ${event.title} (${event.id})`);
      } else if (event.type === 'attestation') {
        console.log(`[attestation] ${event.targetKey}: ${event.opinion} (${event.confidence}) by ${event.agentId} (${event.id})`);
      } else if (event.type === 'tick') {
        console.log(`[tick] ${event.checkedAt} — ${event.articles} articles, ${event.attestations} attestations new`);
      }
    }
  }

  async function tick() {
    if (!running) return;
    try {
      const result = await pollOnce({ config, transport, state, filters });
      saveWatchState(statePath, state);
      for (const article of result.articles) {
        emit({ type: 'article', ...article });
      }
      for (const attestation of result.attestations) {
        emit({ type: 'attestation', ...attestation });
      }
      emit({ type: 'tick', checkedAt: state.lastRun, articles: result.articles.length, attestations: result.attestations.length });
    } catch (err) {
      emit({ type: 'error', message: err.message, at: new Date().toISOString() });
    }

    if (!running) return;
    if (opts.once) return;
    timeoutId = setTimeout(tick, interval);
  }

  // For a one-shot poll, emit current items and return immediately.
  if (opts.once) {
    await tick();
    return { cancel: () => { running = false; if (timeoutId) clearTimeout(timeoutId); } };
  }

  // For continuous watch, seed existing items as seen without emitting, then loop.
  try {
    await pollOnce({ config, transport, state, filters });
    saveWatchState(statePath, state);
  } catch (err) {
    emit({ type: 'error', message: `Initial seed failed: ${err.message}`, at: new Date().toISOString() });
  }
  timeoutId = setTimeout(tick, interval);

  return {
    cancel: () => {
      running = false;
      if (timeoutId) clearTimeout(timeoutId);
    }
  };
}

/**
 * Convenience: run a single poll and print discovered items.
 */
export async function watchOnce(opts = {}) {
  return watch({ ...opts, once: true });
}
