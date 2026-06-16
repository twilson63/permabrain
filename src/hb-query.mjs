import {
  queryUrl, matchUrl, parseHttpsigtHeaders,
  buildPermaBrainFilters,
} from './hb-devices.mjs';
import { resilientCall } from './resilience.mjs';

export class HyperbeamQuery {
  constructor(baseUrl, opts = {}) {
    this.baseUrl = baseUrl;
    this.breakers = opts.breakers;
  }

  _breaker(name) {
    return this.breakers?.get(name) || null;
  }

  /**
   * Query for articles using the ~query@1.0 device.
   * Returns message IDs or full messages matching all tag filters.
   *
   * @param {Object} filters - Key-value tag filters
   * @param {Object} opts
   * @param {string} [opts.returnType='messages'] - 'paths'|'messages'|'count'|'first'|'boolean'
   * @returns {Promise<string[]|Object[]|number|boolean>}
   */
  async query(filters, opts = {}) {
    return resilientCall(async () => {
      const returnType = opts.returnType || 'messages';
      const url = queryUrl(this.baseUrl, filters, returnType);

      const res = await fetch(url);
      if (!res.ok) {
        const err = new Error(`HyperBEAM query failed: HTTP ${res.status}`);
        err.status = res.status;
        throw err;
      }

      const contentType = res.headers.get('content-type') || '';

      // JSON response (structured@1.0 or json@1.0 formatter)
      if (contentType.includes('json') || contentType.includes('structured')) {
        const json = await res.json();
        return json;
      }

      // HTTP-SIG response (tags as headers)
      const headerTags = parseHttpsigtHeaders(res.headers);
      if (headerTags.length > 0) {
        return returnType === 'count'
          ? 1
          : returnType === 'boolean'
            ? true
            : [{ tags: headerTags, body: await res.text() }];
      }

      // Plain text response (list of paths/IDs)
      const text = await res.text();
      if (returnType === 'count') return parseInt(text, 10) || 0;
      if (returnType === 'boolean') return text.length > 0;

      // Parse as newline-separated paths/IDs
      return text.trim().split('\n').filter(Boolean);
    }, { breaker: this._breaker('hyperbeam:query'), label: 'hyperbeam:query', retryOptions: { maxAttempts: 3, baseDelayMs: 250 } });
  }

  /**
   * Direct match lookup using the ~match@1.0 device.
   * Returns all message IDs that contain the specified key-value pair.
   *
   * @param {string} key - Tag name (e.g. 'Attestation-Target')
   * @param {string} value - Tag value (e.g. article ID)
   * @returns {Promise<string[]>} Array of matching message IDs
   */
  async match(key, value) {
    return resilientCall(async () => {
      const url = matchUrl(this.baseUrl, key, value);
      const res = await fetch(url);

      if (res.status === 404) return [];
      if (!res.ok) {
        const err = new Error(`HyperBEAM match failed for ${key}=${value}: HTTP ${res.status}`);
        err.status = res.status;
        throw err;
      }

      const text = await res.text();
      // Match returns paths or IDs, typically newline-separated
      return text.trim().split('\n').filter(Boolean);
    }, { breaker: this._breaker('hyperbeam:query'), label: `hyperbeam:match:${key}`, retryOptions: { maxAttempts: 3, baseDelayMs: 250 } });
  }

  // --- PermaBrain-specific queries ---

  /**
   * Query for articles by PermaBrain filters.
   */
  async findArticles(opts = {}) {
    const filters = buildPermaBrainFilters(opts);
    // Also forward any extra tag filters supplied directly to queryByTags
    for (const [name, value] of Object.entries(opts)) {
      if (!filters[name] && value !== undefined && value !== null && value !== '') {
        filters[name] = String(value);
      }
    }
    // Remove attestation-specific filters for article queries
    delete filters['Attestation-Target'];
    return this.query(filters, { returnType: opts.returnType || 'messages' });
  }

  /**
   * Find attestations for a specific article.
   * Uses the match device for direct reverse-index lookup.
   */
  async findAttestations(articleId) {
    return this.match('Attestation-Target', articleId);
  }

  /**
   * Count articles matching filters.
   */
  async countArticles(opts = {}) {
    const filters = buildPermaBrainFilters(opts);
    delete filters['Attestation-Target'];
    return this.query(filters, { returnType: 'count' });
  }

  /**
   * Check if an article exists.
   */
  async articleExists(articleKey) {
    const filters = buildPermaBrainFilters({ articleKey });
    return this.query(filters, { returnType: 'boolean' });
  }

  /**
   * Get the first article matching filters.
   */
  async firstArticle(opts = {}) {
    const filters = buildPermaBrainFilters(opts);
    delete filters['Attestation-Target'];
    return this.query(filters, { returnType: 'first' });
  }
}
