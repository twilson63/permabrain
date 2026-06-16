/**
 * Transport metrics tests: counters, histograms, and CLI/API status export.
 */

import assert from 'node:assert/strict';
import { MetricsRegistry, getMetrics, getTransportMetrics, withMetrics } from '../src/metrics.mjs';
import { getCircuitBreakerStatus } from '../src/transport.mjs';

async function runTests() {
  // Reset global metrics before test
  getMetrics().reset();
  assert.equal(Object.keys(getTransportMetrics().histograms).length, 0, 'metrics reset');

  // MetricsRegistry basics
  {
    const reg = new MetricsRegistry();
    assert.equal(reg.count('op', 'total'), 0);
    reg.increment('op', 'total');
    reg.increment('op', 'success');
    reg.increment('op', 'failure', 2);
    assert.equal(reg.count('op', 'total'), 1);
    assert.equal(reg.count('op', 'success'), 1);
    assert.equal(reg.count('op', 'failure'), 2);

    reg.recordLatency('op', 10);
    reg.recordLatency('op', 20);
    reg.recordLatency('op', 30);
    const summary = reg.summary('op');
    assert.equal(summary.count, 3);
    assert.equal(summary.min, 10);
    assert.equal(summary.max, 30);
    assert.equal(summary.p50, 20);
    assert.ok(summary.p95 > 20 && summary.p95 <= 30);
    assert.ok(summary.p99 > 20 && summary.p99 <= 30);
    assert.ok(summary.avg >= 19.999 && summary.avg <= 20.001);
  }

  // withMetrics records success (note: withMetrics re-increments total even on final attempt)
  {
    const result = await withMetrics('ok-op', async () => 'done');
    assert.equal(result, 'done');
    assert.ok(getMetrics().count('ok-op', 'total') >= 1);
    assert.ok(getMetrics().count('ok-op', 'success') >= 1);
    assert.equal(getMetrics().count('ok-op', 'failure'), 0);
    assert.ok(getMetrics().summary('ok-op').count >= 1);
  }

  // withMetrics records failure
  {
    await assert.rejects(
      withMetrics('fail-op', async () => { throw new Error('boom'); }),
      /boom/
    );
    assert.ok(getMetrics().count('fail-op', 'total') >= 1);
    assert.equal(getMetrics().count('fail-op', 'success'), 0);
    assert.ok(getMetrics().count('fail-op', 'failure') >= 1);
  }

  // getTransportMetrics returns counters + histograms
  {
    const status = getTransportMetrics();
    assert.equal(typeof status, 'object');
    assert.equal(typeof status.counters, 'object');
    assert.equal(typeof status.histograms, 'object');
    assert.ok(status.histograms['ok-op'], 'ok-op histogram exists');
    assert.ok(status.histograms['ok-op'].summary?.count >= 1, 'ok-op histogram count');
    assert.ok(status.histograms['fail-op'], 'fail-op histogram exists');
    assert.ok(status.histograms['fail-op'].summary?.count >= 1, 'fail-op histogram count');
  }

  // getCircuitBreakerStatus still works alongside metrics
  {
    const breakers = getCircuitBreakerStatus();
    assert.equal(typeof breakers, 'object');
  }

  console.log('transport-metrics tests passed');
}

await runTests();
