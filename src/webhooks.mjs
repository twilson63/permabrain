/**
 * PermaBrain Webhook Registry
 *
 * Persistent local webhook subscriptions and delivery tracking.
 * Each subscription has:
 *   - id: nanoid-style base36 string
 *   - url: target POST URL
 *   - events: array of event names to subscribe (or ['*'])
 *   - secret: optional HMAC secret (base64url)
 *   - active: boolean
 *   - createdAt, updatedAt: ISO timestamps
 *
 * Delivery records are kept in a bounded ring file per home:
 *   webhooks/deliveries.jsonl
 *
 * Subscriptions are stored in:
 *   webhooks/subscriptions.json
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

function makeId() {
  const now = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${now}-${rand}`;
}

function nowIso() {
  return new Date().toISOString();
}

function webhookDir(home) {
  return path.join(home, 'webhooks');
}

function subscriptionsPath(home) {
  return path.join(webhookDir(home), 'subscriptions.json');
}

function deliveriesPath(home) {
  return path.join(webhookDir(home), 'deliveries.jsonl');
}

function ensureWebhookDir(home) {
  const dir = webhookDir(home);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function readSubscriptions(home) {
  ensureWebhookDir(home);
  const file = subscriptionsPath(home);
  if (!fs.existsSync(file)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Array.isArray(data)) return data;
  } catch {}
  return [];
}

function writeSubscriptions(home, subscriptions) {
  ensureWebhookDir(home);
  const file = subscriptionsPath(home);
  fs.writeFileSync(file, JSON.stringify(subscriptions, null, 2) + '\n');
}

function readDeliveriesFile(home, limit = 500) {
  ensureWebhookDir(home);
  const file = deliveriesPath(home);
  if (!fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split('\n').filter(Boolean);
  const out = [];
  for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
    try {
      out.unshift(JSON.parse(lines[i]));
    } catch {}
  }
  return out;
}

function appendDelivery(home, record) {
  ensureWebhookDir(home);
  const file = deliveriesPath(home);
  const line = JSON.stringify(record) + '\n';
  fs.appendFileSync(file, line);
}

function trimDeliveries(home, max = 2000) {
  ensureWebhookDir(home);
  const file = deliveriesPath(home);
  if (!fs.existsSync(file)) return;
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  if (lines.length <= max) return;
  const keep = lines.slice(lines.length - max);
  fs.writeFileSync(file, keep.join('\n') + '\n');
}

/**
 * Compute HMAC-SHA256 signature for webhook payload.
 * @param {string} secret - base64url-encoded secret
 * @param {string} body - JSON string
 * @returns {string} base64url signature
 */
export function signWebhookPayload(secret, body) {
  const key = Buffer.from(secret, 'base64url');
  return crypto.createHmac('sha256', key).update(body, 'utf8').digest('base64url');
}

/**
 * Verify HMAC-SHA256 signature.
 * @param {string} secret - base64url-encoded secret
 * @param {string} body - JSON string
 * @param {string} signature - base64url signature
 * @returns {boolean}
 */
export function verifyWebhookSignature(secret, body, signature) {
  try {
    const expected = signWebhookPayload(secret, body);
    return crypto.timingSafeEqual(Buffer.from(expected, 'base64url'), Buffer.from(signature, 'base64url'));
  } catch {
    return false;
  }
}

/**
 * Generate a fresh base64url HMAC secret.
 * @returns {string}
 */
export function generateWebhookSecret() {
  return crypto.randomBytes(32).toString('base64url');
}

function validateUrl(url) {
  if (!url || typeof url !== 'string') throw new Error('url is required');
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('url must use http: or https:');
    }
    return parsed.toString();
  } catch (err) {
    throw new Error(`Invalid webhook url: ${err.message}`);
  }
}

/**
 * Register a new webhook subscription.
 * @param {Object} opts
 * @param {string} opts.home
 * @param {string} opts.url
 * @param {string[]} [opts.events]
 * @param {string} [opts.secret]
 * @returns {Object}
 */
export function registerWebhook(opts = {}) {
  const home = opts.home;
  if (!home) throw new Error('home is required');
  const url = validateUrl(opts.url);
  const events = Array.isArray(opts.events) && opts.events.length
    ? opts.events.filter((e) => typeof e === 'string')
    : ['*'];
  const secret = opts.secret || generateWebhookSecret();
  const subscriptions = readSubscriptions(home);
  const existing = subscriptions.find((s) => s.url === url);
  if (existing) {
    existing.events = events;
    existing.secret = secret;
    existing.active = opts.active !== false;
    existing.updatedAt = nowIso();
    writeSubscriptions(home, subscriptions);
    return { created: false, updated: true, subscription: existing };
  }
  const subscription = {
    id: makeId(),
    url,
    events,
    secret,
    active: opts.active !== false,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  subscriptions.push(subscription);
  writeSubscriptions(home, subscriptions);
  return { created: true, updated: false, subscription };
}

/**
 * List all webhook subscriptions.
 * @param {Object} opts
 * @param {string} opts.home
 * @param {boolean} [opts.includeSecrets=false]
 * @returns {Array<Object>}
 */
export function listWebhooks(opts = {}) {
  const home = opts.home;
  if (!home) throw new Error('home is required');
  const subscriptions = readSubscriptions(home);
  if (opts.includeSecrets) return subscriptions;
  return subscriptions.map((s) => ({ ...s, secret: undefined }));
}

/**
 * Get a single webhook subscription by id.
 * @param {Object} opts
 * @param {string} opts.home
 * @param {string} opts.id
 * @param {boolean} [opts.includeSecrets=false]
 * @returns {Object|null}
 */
export function getWebhook(opts = {}) {
  const home = opts.home;
  if (!home) throw new Error('home is required');
  const id = opts.id;
  if (!id) throw new Error('id is required');
  const subscriptions = readSubscriptions(home);
  const s = subscriptions.find((sub) => sub.id === id) || null;
  if (s && !opts.includeSecrets) return { ...s, secret: undefined };
  return s;
}

/**
 * Delete a webhook subscription by id.
 * @param {Object} opts
 * @param {string} opts.home
 * @param {string} opts.id
 * @returns {Object}
 */
export function deleteWebhook(opts = {}) {
  const home = opts.home;
  if (!home) throw new Error('home is required');
  const id = opts.id;
  if (!id) throw new Error('id is required');
  const subscriptions = readSubscriptions(home);
  const idx = subscriptions.findIndex((s) => s.id === id);
  if (idx === -1) return { deleted: false, found: false };
  const removed = subscriptions.splice(idx, 1)[0];
  writeSubscriptions(home, subscriptions);
  return { deleted: true, found: true, subscription: { ...removed, secret: undefined } };
}

/**
 * Toggle active/inactive status for a webhook subscription.
 * @param {Object} opts
 * @param {string} opts.home
 * @param {string} opts.id
 * @param {boolean} [opts.active]
 * @returns {Object}
 */
export function toggleWebhook(opts = {}) {
  const home = opts.home;
  if (!home) throw new Error('home is required');
  const id = opts.id;
  if (!id) throw new Error('id is required');
  const subscriptions = readSubscriptions(home);
  const s = subscriptions.find((sub) => sub.id === id);
  if (!s) return { found: false, toggled: false };
  s.active = opts.active !== undefined ? !!opts.active : !s.active;
  s.updatedAt = nowIso();
  writeSubscriptions(home, subscriptions);
  return { found: true, toggled: true, active: s.active, subscription: { ...s, secret: undefined } };
}

/**
 * Return recent webhook delivery attempts.
 * @param {Object} opts
 * @param {string} opts.home
 * @param {string} [opts.id]
 * @param {number} [opts.limit=100]
 * @returns {Array<Object>}
 */
export function webhookHistory(opts = {}) {
  const home = opts.home;
  if (!home) throw new Error('home is required');
  const limit = opts.limit ? Math.min(Number(opts.limit), 1000) : 100;
  let deliveries = readDeliveriesFile(home, limit * 2);
  if (opts.id) deliveries = deliveries.filter((d) => d.subscriptionId === opts.id);
  return deliveries.slice(-limit);
}

/**
 * Send a test POST payload to a target URL.
 * @param {Object} opts
 * @param {string} opts.home
 * @param {string} opts.url
 * @param {Object} [opts.payload]
 * @param {string} [opts.secret]
 * @param {Function} [opts.fetch] - fetch implementation
 * @returns {Promise<Object>}
 */
export async function testWebhook(opts = {}) {
  const home = opts.home;
  if (!home) throw new Error('home is required');
  const url = validateUrl(opts.url);
  const payload = opts.payload || {
    type: 'test',
    message: 'PermaBrain webhook test',
    timestamp: nowIso()
  };
  const body = JSON.stringify(payload);
  const secret = opts.secret || generateWebhookSecret();
  const signature = signWebhookPayload(secret, body);
  const fetchFn = opts.fetch || globalThis.fetch;
  const startedAt = nowIso();
  let responseStatus = null;
  let responseBody = '';
  let error = null;
  try {
    const res = await fetchFn(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-permabrain-signature': `sha256=${signature}`,
        'x-permabrain-event': payload.type || 'test',
        'x-permabrain-delivery': makeId(),
        'user-agent': 'PermaBrain-Webhook/1.0'
      },
      body
    });
    responseStatus = res.status;
    responseBody = await res.text().catch(() => '');
  } catch (e) {
    error = e.message;
  }
  const record = {
    id: makeId(),
    subscriptionId: opts.subscriptionId || null,
    url,
    event: payload.type || 'test',
    status: error ? 'error' : (responseStatus >= 200 && responseStatus < 300 ? 'ok' : 'failed'),
    httpStatus: responseStatus,
    error: error || null,
    payload,
    signature,
    createdAt: startedAt,
    completedAt: nowIso()
  };
  appendDelivery(home, record);
  trimDeliveries(home);
  return {
    ok: !error && responseStatus >= 200 && responseStatus < 300,
    status: responseStatus,
    error,
    responseBody: responseBody.slice(0, 2000),
    record: { ...record, signature: undefined }
  };
}

/**
 * Dispatch an event to all matching active subscriptions.
 * @param {Object} opts
 * @param {string} opts.home
 * @param {string} opts.event
 * @param {Object} opts.payload
 * @param {Function} [opts.fetch]
 * @returns {Promise<Array<Object>>}
 */
export async function dispatchWebhookEvent(opts = {}) {
  const home = opts.home;
  if (!home) throw new Error('home is required');
  const event = opts.event;
  const payload = opts.payload || {};
  if (!event) throw new Error('event is required');
  const body = JSON.stringify(payload);
  const subscriptions = readSubscriptions(home).filter((s) => s.active);
  const matches = subscriptions.filter((s) =>
    s.events.includes('*') || s.events.includes(event)
  );
  const results = [];
  for (const s of matches) {
    const signature = signWebhookPayload(s.secret, body);
    const deliveryId = makeId();
    const startedAt = nowIso();
    let responseStatus = null;
    let error = null;
    try {
      const fetchFn = opts.fetch || globalThis.fetch;
      const res = await fetchFn(s.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-permabrain-signature': `sha256=${signature}`,
          'x-permabrain-event': event,
          'x-permabrain-delivery': deliveryId,
          'user-agent': 'PermaBrain-Webhook/1.0'
        },
        body
      });
      responseStatus = res.status;
    } catch (e) {
      error = e.message;
    }
    const record = {
      id: deliveryId,
      subscriptionId: s.id,
      url: s.url,
      event,
      status: error ? 'error' : (responseStatus >= 200 && responseStatus < 300 ? 'ok' : 'failed'),
      httpStatus: responseStatus,
      error: error || null,
      payload,
      signature,
      createdAt: startedAt,
      completedAt: nowIso()
    };
    appendDelivery(home, record);
    results.push({ ...record, signature: undefined });
  }
  trimDeliveries(home);
  return results;
}

/**
 * Render webhook subscriptions and recent deliveries as markdown.
 * @param {Object} opts
 * @param {string} opts.home
 * @param {number} [opts.limit=50]
 * @returns {string}
 */
export function webhooksToMarkdown(opts = {}) {
  const home = opts.home;
  if (!home) throw new Error('home is required');
  const subscriptions = listWebhooks({ home });
  const deliveries = webhookHistory({ home, limit: opts.limit || 50 });
  const lines = ['# Webhooks', ''];
  lines.push(`## Subscriptions (${subscriptions.length})`, '');
  if (!subscriptions.length) {
    lines.push('No webhook subscriptions.', '');
  } else {
    lines.push('| ID | URL | Events | Active | Created |', '|---|---|---|---|---|');
    for (const s of subscriptions) {
      lines.push(`| \`${s.id}\` | ${s.url} | ${(s.events || []).join(', ')} | ${s.active ? 'yes' : 'no'} | ${s.createdAt} |`);
    }
    lines.push('');
  }
  lines.push(`## Recent deliveries (${deliveries.length})`, '');
  if (!deliveries.length) {
    lines.push('No deliveries recorded.', '');
  } else {
    lines.push('| Time | Event | URL | Status | HTTP |', '|---|---|---|---|---|');
    for (const d of deliveries.slice().reverse()) {
      lines.push(`| ${d.createdAt} | ${d.event} | ${d.url} | ${d.status} | ${d.httpStatus ?? '—'} |`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
