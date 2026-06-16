/**
 * HyperBEAM Consensus Module
 *
 * Computes PermaBrain consensus scores using HyperBEAM's native
 * devices instead of client-side calculation.
 *
 * Two modes:
 * 1. Lua device — Runs consensus computation on the HyperBEAM node
 *    (requires permabrain-consensus.lua module loaded as process)
 * 2. Query-based — Falls back to match device + client-side scoring
 *    when Lua compute is not available
 *
 * The Lua device approach is preferred because:
 * - Consensus runs where the data lives (no network round-trips)
 * - Results are cached and signed by the node
 * - Multiple nodes can compute independently for trustless verification
 */

import { HyperbeamQuery } from './hb-query.mjs';
import {
  DEVICES, processUrl, pushUrl,
  PERMABRAIN_CONSENSUS_LUA, PERMABRAIN_QUERY_LUA
} from './hb-devices.mjs';
import { resilientCall } from './resilience.mjs';

export class HyperbeamConsensus {
  constructor(baseUrl, config = {}) {
    this.baseUrl = baseUrl;
    this.query = new HyperbeamQuery(baseUrl, { breakers: config.breakers });
    this.config = config;
    this.processId = config.consensusProcessId;
    this.breakers = config.breakers;
  }

  _breaker(name) {
    return this.breakers?.get(name) || null;
  }

  /**
   * Compute consensus for an article.
   *
   * Tries Lua device first, falls back to query-based computation.
   *
   * @param {string} articleId - Article DataItem ID
   * @returns {Promise<Object>} { score, count, validCount, invalidCount, method }
   */
  async compute(articleId) {
    // Try Lua device if a process is configured
    if (this.processId) {
      try {
        return await this.computeViaLua(articleId);
      } catch (err) {
        console.warn(`Lua consensus failed, falling back to query: ${err.message}`);
      }
    }

    // Fallback: query-based consensus
    return this.computeViaQuery(articleId);
  }

  /**
   * Compute consensus via the Lua device.
   *
   * Sends a request to the process with Attestation-Target header.
   * The Lua module resolves attestations via match device and computes
   * the weighted score on the node.
   *
   * Format: GET /{processId}~process@1.0/consensus
   *         Header: Attestation-Target: {articleId}
   */
  async computeViaLua(articleId) {
    return resilientCall(async () => {
      const url = processUrl(this.baseUrl, this.processId, 'consensus');
      const res = await fetch(url, {
        headers: {
          'Attestation-Target': articleId,
          'content-type': 'application/json',
        },
      });

      if (!res.ok) {
        const err = new Error(`Lua consensus failed: HTTP ${res.status}`);
        err.status = res.status;
        throw err;
      }

      const result = await res.json();
      return {
        score: parseFloat(result.score || result['Consensus-Score'] || 0),
        count: parseInt(result.count || result['Consensus-Count'] || 0, 10),
        validCount: parseInt(result.validCount || result['Consensus-Valid-Count'] || 0, 10),
        invalidCount: parseInt(result.invalidCount || result['Consensus-Invalid-Count'] || 0, 10),
        method: 'lua-device',
      };
    }, { breaker: this._breaker('hyperbeam:consensus'), label: 'hyperbeam:consensus', retryOptions: { maxAttempts: 3, baseDelayMs: 250 } });
  }

  /**
   * Compute consensus via match device queries + client-side scoring.
   *
   * This is the fallback when Lua compute is not available.
   * Fetches all attestation IDs via match, then fetches each
   * attestation's tags to compute the score.
   */
  async computeViaQuery(articleId) {
    // Find all attestation IDs for this article
    const attIds = await this.query.findAttestations(articleId);

    if (attIds.length === 0) {
      return {
        score: 0, count: 0, validCount: 0, invalidCount: 0,
        attestations: [], method: 'query-fallback',
      };
    }

    // Fetch each attestation's tags
    const attestations = [];
    for (const id of attIds) {
      try {
        const res = await fetch(`${this.baseUrl}/${encodeURIComponent(id)}`);
        if (!res.ok) continue;
        const tags = parseHttpsigtHeaders(res.headers);
        const tagMap = {};
        for (const t of tags) tagMap[t.name] = t.value;
        attestations.push({ id, ...tagMap });
      } catch { /* skip unavailable attestations */ }
    }

    // Compute weighted consensus score
    let validScore = 0, invalidScore = 0;
    let validCount = 0, invalidCount = 0;

    for (const att of attestations) {
      const valid = att['Attestation-Valid'];
      const confidence = parseFloat(att['Attestation-Confidence'] || '0');

      if (valid === 'valid') {
        validScore += confidence;
        validCount++;
      } else if (valid === 'invalid') {
        invalidScore += confidence;
        invalidCount++;
      }
    }

    const totalCount = validCount + invalidCount;
    const netScore = validScore - invalidScore;
    const avgScore = totalCount > 0 ? netScore / totalCount : 0;

    return {
      score: avgScore,
      count: totalCount,
      validCount,
      invalidCount,
      attestations,
      method: 'query-fallback',
    };
  }

  /**
   * Deploy the PermaBrain consensus Lua module to a HyperBEAM node.
   *
   * Uploads the Lua script as a DataItem via the bundler, then
   * creates a process that loads it as its module.
   *
   * Returns the process ID for future consensus calls.
   */
  async deploy(bundlerUploadUrl, signer) {
    return resilientCall(async () => {
      const { createDataItem } = await import('./dataitem.mjs');
      const consensusItem = await createDataItem({
        payload: PERMABRAIN_CONSENSUS_LUA,
        tags: [
          { name: 'Content-Type', value: 'application/lua' },
          { name: 'App-Name', value: 'PermaBrain' },
          { name: 'Type', value: 'module' },
          { name: 'Module-Name', value: 'permabrain-consensus' },
          { name: 'Device', value: 'lua@5.3a' },
        ],
        identity: signer,
      });

      const uploadRes = await fetch(bundlerUploadUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        body: new Blob([consensusItem.raw], { type: 'application/octet-stream' }),
      });
      if (!uploadRes.ok) {
        const err = new Error(`Consensus module upload failed: HTTP ${uploadRes.status}`);
        err.status = uploadRes.status;
        throw err;
      }
      const moduleId = consensusItem.id;

      const queryItem = await createDataItem({
        payload: PERMABRAIN_QUERY_LUA,
        tags: [
          { name: 'Content-Type', value: 'application/lua' },
          { name: 'App-Name', value: 'PermaBrain' },
          { name: 'Type', value: 'module' },
          { name: 'Module-Name', value: 'permabrain-query' },
          { name: 'Device', value: 'lua@5.3a' },
        ],
        identity: signer,
      });

      const queryUploadRes = await fetch(bundlerUploadUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        body: new Blob([queryItem.raw], { type: 'application/octet-stream' }),
      });
      if (!queryUploadRes.ok) {
        const err = new Error(`Query module upload failed: HTTP ${queryUploadRes.status}`);
        err.status = queryUploadRes.status;
        throw err;
      }

      return { consensusModuleId: moduleId, queryModuleId: queryItem.id };
    }, { breaker: this._breaker('hyperbeam:upload'), label: 'hyperbeam:deploy', retryOptions: { maxAttempts: 3, baseDelayMs: 250 } });
  }
}

// Re-import needed for computeViaQuery
import { parseHttpsigtHeaders } from './hb-devices.mjs';