/**
 * Test: Runtime metrics collector (`src/metrics-runtime.mjs`)
 *
 * Verifies in-process counter behaviour and Prometheus formatting.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRuntimeMetrics, buildMetricsReport, formatPrometheus, stopRuntimeMetrics } from '../src/metrics-runtime.mjs';

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-metrics-runtime-'));
process.env.PERMABRAIN_HOME = tmpHome;
process.env.PERMABRAIN_TRANSPORT = 'local';

console.log('1. createRuntimeMetrics returns a collector');
const metrics = createRuntimeMetrics();
assert.ok(metrics, 'metrics created');
assert.equal(typeof metrics.countRequest, 'function', 'countRequest method');
assert.equal(typeof metrics.countEvent, 'function', 'countEvent method');
assert.equal(typeof metrics.snapshot, 'function', 'snapshot method');
console.log('   ✓ collector created');

console.log('2. countRequest increments total/status/method/route buckets');
metrics.countRequest({ statusCode: 200, method: 'GET', route: '/api/v1/articles' });
metrics.countRequest({ statusCode: 201, method: 'POST', route: '/api/v1/articles' });
metrics.countRequest({ statusCode: 500, method: 'GET', route: '/api/v1/articles', error: true });
metrics.countRequest({ statusCode: 429, method: 'GET', route: '/api/v1/articles', rateLimited: true });
const snap = metrics.snapshot();
assert.equal(snap.requests.total, 4, 'total requests');
assert.equal(snap.requests.byStatus[200], 2, '2xx bucket');
assert.equal(snap.requests.byStatus[400], 1, '4xx bucket (429)');
assert.equal(snap.requests.byStatus[500], 1, '5xx bucket');
assert.equal(snap.requests.byMethod.GET, 3, 'GET count');
assert.equal(snap.requests.byMethod.POST, 1, 'POST count');
assert.equal(snap.requests.byRoute['/api/v1/articles'], 4, 'route count');
assert.equal(snap.requests.errors, 1, 'errors (5xx)');
assert.equal(snap.requests.rateLimited, 1, 'rate limited count');
console.log('   ✓ request counters work');

console.log('3. countEvent increments known and unknown event kinds');
metrics.countEvent('publish');
metrics.countEvent('attest');
metrics.countEvent('attest');
metrics.countEvent('unknown-kind');
const snap2 = metrics.snapshot();
assert.equal(snap2.events.publish, 1, 'publish event');
assert.equal(snap2.events.attest, 2, 'attest events');
assert.equal(snap2.events.other, 1, 'unknown event goes to other');
console.log('   ✓ event counters work');

console.log('4. active stream counts can be set');
metrics.setActiveStreams({ sse: 3, websocket: 7 });
const snap3 = metrics.snapshot();
assert.equal(snap3.activeStreams.sse, 3, 'sse count');
assert.equal(snap3.activeStreams.websocket, 7, 'websocket count');
console.log('   ✓ active stream counts set');

console.log('5. buildMetricsReport merges runtime snapshot with cache metrics');
const report = await buildMetricsReport({ runtime: metrics, home: tmpHome });
assert.ok(report.generatedAt, 'report has generatedAt');
assert.equal(report.format, 'json', 'default format json');
assert.ok(report.runtime.uptimeSeconds >= 0, 'uptimeSeconds present');
assert.equal(report.runtime.requests.total, 4, 'runtime total in report');
assert.ok(typeof report.data.totals.articles === 'number', 'data totals present');
console.log('   ✓ report built');

console.log('6. formatPrometheus emits valid exposition text');
const prom = formatPrometheus(report);
assert.ok(prom.includes('# HELP permabrain_runtime_uptime_seconds'), 'uptime help');
assert.ok(prom.includes('# TYPE permabrain_runtime_requests_total counter'), 'requests type');
assert.ok(prom.includes('permabrain_runtime_requests_total 4'), 'requests total value');
assert.ok(prom.includes('permabrain_articles_total'), 'articles total metric');
assert.ok(prom.includes('transport="sse"'), 'sse label');
console.log('   ✓ prometheus format ok');

console.log('7. stopRuntimeMetrics detaches event-bus handler');
stopRuntimeMetrics(metrics);
assert.equal(metrics._eventHandler, null, 'handler removed');
console.log('   ✓ metrics stopped');

console.log('✅ All metrics-runtime tests passed');
