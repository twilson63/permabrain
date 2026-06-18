/**
 * PermaBrain HTTP API Key Authentication
 *
 * Lightweight shared-secret auth for `permabrain serve` endpoints.
 *
 * Usage:
 *   import { createApiKeyAuth } from './auth.mjs';
 *   const auth = createApiKeyAuth({ apiKey: process.env.PERMABRAIN_API_KEY });
 *   const result = auth.check(req);
 *   if (!result.ok) return sendError(res, result.status, result.error);
 *
 * Supports:
 *   - Header: Authorization: Bearer <api-key>
 *   - Header: X-Api-Key: <api-key>
 *   - Query param: ?api-key=<api-key>
 *   - Body field: { apiKey: '<api-key>' } (JSON POST only)
 *
 * When no API key is configured, all requests are allowed (default permissive
 * behavior).  Protected endpoints may opt out by passing { required: false }.
 *
 * The middleware also appends the configured key to outbound SDK headers when
 * given to the client as `apiKey`.
 */

import { randomBytes, createHash } from 'node:crypto';

const DEFAULT_HEADER_NAME = 'x-api-key';

function constantTimeEquals(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export function generateApiKey(prefix = 'pb') {
  const bytes = randomBytes(32);
  const key = bytes.toString('base64url');
  return `${prefix}_${key}`;
}

export function hashApiKey(apiKey) {
  return createHash('sha256').update(apiKey).digest('base64url');
}

export function createApiKeyAuth(options = {}) {
  const apiKey = options.apiKey || options.apiKeys?.[0] || null;
  const apiKeys = options.apiKeys || (apiKey ? [apiKey] : []);
  const headerName = (options.headerName || DEFAULT_HEADER_NAME).toLowerCase();

  function extractKey(req, body = null) {
    const headers = req.headers || {};
    const authHeader = headers.authorization || headers.Authorization;
    if (authHeader) {
      const match = authHeader.match(/^\s*[Bb]earer\s+(\S+)\s*$/);
      if (match) return match[1];
    }
    if (headers[headerName]) return headers[headerName];
    const mixed = Object.keys(headers).find((k) => k.toLowerCase() === headerName);
    if (mixed) return headers[mixed];

    const url = req.url || '';
    const queryIndex = url.indexOf('?');
    if (queryIndex !== -1) {
      const params = new URLSearchParams(url.slice(queryIndex + 1));
      const fromQuery = params.get('api-key') || params.get('apiKey') || params.get('api_key') || params.get('key');
      if (fromQuery) return fromQuery;
    }

    if (body && typeof body === 'object') {
      return body.apiKey || body.api_key || body['api-key'] || undefined;
    }

    return undefined;
  }

  function check(req, body = null) {
    if (apiKeys.length === 0) return { ok: true };
    const provided = extractKey(req, body);
    if (!provided) return { ok: false, status: 401, error: 'API key required' };
    const found = apiKeys.some((key) => constantTimeEquals(provided, key));
    if (!found) return { ok: false, status: 403, error: 'Invalid API key' };
    return { ok: true };
  }

  return { apiKey, apiKeys, check, extractKey, generateApiKey, hashApiKey };
}
