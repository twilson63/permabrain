/**
 * PermaBrain Transport Metrics
 *
 * Lightweight in-memory counters + histograms for transport calls.
 * Designed for runtime observability without external dependencies.
 *
 * Tracks:
 *   - call counts per operation (total, success, failure)
 *   - latency histogram buckets (ms) per operation
 *   - summary stats (min, max, avg, p50/p95/p99 estimates)
 *
 * No data is persisted to disk; metrics reset each process start.
 */

export class MetricsRegistry {
  constructor() {
    this.counters = new Map();
    this.histograms = new Map();
  }

  _counterKey(name, label) {
    return `${name}:${label}`;
  }

  increment(name, label = 'total', value = 1) {
    const key = this._counterKey(name, label);
    this.counters.set(key, (this.counters.get(key) || 0) + value);
  }

  count(name, label) {
    return this.counters.get(this._counterKey(name, label)) || 0;
  }

  recordLatency(name, durationMs) {
    if (!this.histograms.has(name)) {
      this.histograms.set(name, []);
    }
    this.histograms.get(name).push(durationMs);
  }

  histogram(name) {
    return (this.histograms.get(name) || []).slice().sort((a, b) => a - b);
  }

  percentile(sorted, p) {
    if (sorted.length === 0) return null;
    if (sorted.length === 1) return sorted[0];
    const idx = (p / 100) * (sorted.length - 1);
    const lower = Math.floor(idx);
    const upper = Math.ceil(idx);
    if (lower === upper) return sorted[lower];
    const weight = idx - lower;
    return sorted[lower] * (1 - weight) + sorted[upper] * weight;
  }

  summary(name) {
    const values = this.histogram(name);
    if (values.length === 0) {
      return { count: 0, min: null, max: null, avg: null, p50: null, p95: null, p99: null };
    }
    const total = values.reduce((a, b) => a + b, 0);
    return {
      count: values.length,
      min: values[0],
      max: values[values.length - 1],
      avg: total / values.length,
      p50: this.percentile(values, 50),
      p95: this.percentile(values, 95),
      p99: this.percentile(values, 99),
    };
  }

  operationStatus(name) {
    return {
      total: this.count(name, 'total'),
      success: this.count(name, 'success'),
      failure: this.count(name, 'failure'),
      summary: this.summary(name),
    };
  }

  status() {
    const result = { counters: {}, histograms: {} };
    for (const [key, value] of this.counters) {
      result.counters[key] = value;
    }
    for (const [name] of this.histograms) {
      result.histograms[name] = this.operationStatus(name);
    }
    return result;
  }

  reset() {
    this.counters.clear();
    this.histograms.clear();
  }
}

const globalMetrics = new MetricsRegistry();

export function getMetrics() {
  return globalMetrics;
}

export function getTransportMetrics() {
  return globalMetrics.status();
}

export async function withMetrics(name, fn) {
  globalMetrics.increment(name, 'total');
  const start = performance.now();
  try {
    const result = await fn();
    globalMetrics.increment(name, 'success');
    return result;
  } catch (err) {
    globalMetrics.increment(name, 'failure');
    throw err;
  } finally {
    globalMetrics.recordLatency(name, performance.now() - start);
  }
}
