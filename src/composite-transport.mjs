/**
 * Composite Transport — cascading transport with fallback.
 *
 * Tries transports in order: AO (dryrun) → Arweave (GraphQL) → local cache.
 * Each method tries the primary transport first, falling back to the next
 * on failure. Write operations go to all available transports.
 *
 * This is the production-ready transport for PermaBrain:
 *   - Reads: AO dryrun (instant, free) → Arweave GraphQL → local cache
 *   - Writes: Arweave (permanent) + AO (index) in parallel
 *   - queryByTags: Arweave GraphQL (AO doesn't support tag-based queries)
 *   - fetchData: Arweave gateway (AO doesn't store content payloads)
 */

import { ArweaveTransport } from './transport.mjs';
import { AOTransport } from './ao-transport.mjs';
import { LocalTransport } from './transport.mjs';

/**
 * Composite Transport — tries transports in cascade order.
 *
 * @param {Object} config - PermaBrain config with ao, gateway, bundler sections
 * @param {string} home - PermaBrain home directory (for local cache)
 */
export class CompositeTransport {
  constructor(config, home) {
    this.config = config;
    this.home = home;
    this.transports = [];

    // Build transport stack based on config
    if (config.ao?.processId) {
      this.transports.push({ name: 'ao', transport: new AOTransport(config) });
    }
    if (config.gateway?.dataUrl || config.transport === 'arweave') {
      this.transports.push({ name: 'arweave', transport: new ArweaveTransport(config) });
    }
    // Always have local as last resort for reads
    if (home) {
      this.transports.push({ name: 'local', transport: new LocalTransport(home) });
    }
  }

  /**
   * Get the primary transport for write operations.
   * For writes, we prefer Arweave (permanent) over AO (index-only).
   */
  get writeTransport() {
    // Prefer Arweave for writes (permanent storage)
    const arweave = this.transports.find(t => t.name === 'arweave');
    if (arweave) return arweave.transport;
    // Fall back to AO (which internally dual-writes to Arweave)
    const ao = this.transports.find(t => t.name === 'ao');
    if (ao) return ao.transport;
    // Last resort: local
    const local = this.transports.find(t => t.name === 'local');
    if (local) return local.transport;
    throw new Error('No write transport available');
  }

  /**
   * Upload a DataItem to Arweave (primary) and optionally index via AO.
   */
  async uploadDataItem(item) {
    const results = [];

    // Upload to Arweave first (permanent storage)
    const arweave = this.transports.find(t => t.name === 'arweave');
    if (arweave) {
      const result = await arweave.transport.uploadDataItem(item);
      results.push({ name: 'arweave', ...result });
    }

    // If AO transport is configured, send index message
    const ao = this.transports.find(t => t.name === 'ao');
    if (ao) {
      try {
        const result = await ao.transport.uploadDataItem(item);
        results.push({ name: 'ao', ...result });
      } catch (err) {
        // AO indexing failure is non-fatal — data is safe on Arweave
        console.error(`AO upload failed (non-fatal): ${err.message}`);
      }
    }

    // If no Arweave/AO, try local
    if (!arweave && !ao) {
      const local = this.transports.find(t => t.name === 'local');
      if (local) {
        const result = await local.transport.uploadDataItem(item);
        results.push({ name: 'local', ...result });
      }
    }

    // Return the most important result (Arweave, then AO, then local)
    return results[0] || { id: item.id, status: 'no-transport' };
  }

  /**
   * Fetch a DataItem — try transports in order.
   */
  async fetchDataItem(id) {
    for (const { name, transport } of this.transports) {
      try {
        const result = await transport.fetchDataItem(id);
        return result;
      } catch (err) {
        // Transport failed, try next
        continue;
      }
    }
    throw new Error(`All transports failed to fetch DataItem: ${id}`);
  }

  /**
   * Fetch raw data — try transports in order.
   */
  async fetchData(id) {
    for (const { name, transport } of this.transports) {
      try {
        const result = await transport.fetchData(id);
        return result;
      } catch (err) {
        continue;
      }
    }
    throw new Error(`All transports failed to fetch data: ${id}`);
  }

  /**
   * Query by tags — prefer Arweave GraphQL (AO doesn't support this).
   * Fall back to local cache if Arweave is unavailable.
   */
  async queryByTags(filters) {
    for (const { name, transport } of this.transports) {
      try {
        const results = await transport.queryByTags(filters);
        if (results.length > 0) return results;
      } catch (err) {
        continue;
      }
    }
    // Return empty if all transports fail or return empty
    return [];
  }
}