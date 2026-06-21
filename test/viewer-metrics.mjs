/**
 * Viewer runtime metrics panel tests.
 *
 * Verifies that the web viewer includes a Metrics panel wired to
 * GET /api/v1/metrics, supports deep-link state (?view=metrics), and
 * exposes the expected window functions.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { startServer, stopServer } from '../src/serve.mjs';
import { api } from '../src/agent-api.mjs';
import { initState } from '../src/config.mjs';
import { generateApiKey } from '../src/auth.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const viewerPath = path.resolve(__dirname, '..', 'viewer', 'index.html');

function makeTempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-viewer-metrics-'));
}

async function resetApi(home) {
  api._home = null;
  api._identity = null;
  api._config = null;
  process.env.PERMABRAIN_HOME = home;
  process.env.PERMABRAIN_TRANSPORT = 'local';
  initState({ env: { ...process.env, PERMABRAIN_HOME: home, PERMABRAIN_TRANSPORT: 'local' } });
  await api.init({ transport: 'local', keyType: 'ed25519' });
}

function request(port, reqPath, method = 'GET', body = null, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const headers = { ...extraHeaders };
    if (body) headers['content-type'] = 'application/json';
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      method,
      path: reqPath,
      headers
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch {}
        resolve({ status: res.statusCode, body: text, json, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// --- viewer/index.html contains metrics panel wiring ---
{
  const html = fs.readFileSync(viewerPath, 'utf8');
  assert.ok(html.includes('id="metricsBtn"'), 'viewer should have metrics button');
  assert.ok(html.includes('window.showMetrics'), 'viewer should expose showMetrics');
  assert.ok(html.includes('window.refreshMetrics'), 'viewer should expose refreshMetrics');
  assert.ok(html.includes('window.fetchMetrics'), 'viewer should expose fetchMetrics');
  assert.ok(html.includes('window.renderMetrics'), 'viewer should expose renderMetrics');
  assert.ok(html.includes('window.setMetricsFormat'), 'viewer should expose setMetricsFormat');
  assert.ok(html.includes("'metrics'"), 'viewer should reference metrics view in state handling');
  assert.ok(html.includes("viewMode === 'metrics'"), 'metrics panel render guard');
  assert.ok(html.includes('/api/v1/metrics'), 'viewer should call metrics endpoint');
  assert.ok(html.includes('isLocalListMode'), 'viewer should use isLocalListMode guard');
}

// --- local API metrics endpoint works, and panel query params pass through ---
{
  const home = makeTempHome();
  await resetApi(home);

  const apiKey = generateApiKey();
  const { server, port } = await startServer({ port: 0, home, apiKey });
  try {
    const pub = await request(port, '/api/v1/articles', 'POST', {
      content: '# Viewer Metrics Test\n\nA test article for the metrics panel.',
      kind: 'subject',
      topic: 'viewer-metrics-test',
      sourceUrl: 'https://example.com/viewer-metrics-test',
      title: 'Viewer Metrics Test'
    }, { authorization: `Bearer ${apiKey}` });
    assert.equal(pub.status, 201, 'publish should succeed');
    assert.ok(pub.json?.summary?.key, 'publish should return a key');

    const metrics = await request(port, '/api/v1/metrics', 'GET', null, { authorization: `Bearer ${apiKey}` });
    assert.equal(metrics.status, 200, 'metrics endpoint should return 200');
    assert.ok(metrics.json.generatedAt, 'metrics has generatedAt');
    assert.ok(metrics.json.runtime, 'metrics has runtime block');
    assert.ok(metrics.json.data, 'metrics has data block');
    assert.equal(typeof metrics.json.data.totals.articles, 'number', 'totals.articles is a number');
    assert.ok(metrics.json.data.totals.articles >= 1, 'metrics sees at least one article');
    assert.equal(typeof metrics.json.runtime.requests.total, 'number', 'runtime.requests.total is a number');

    const prom = await request(port, '/api/v1/metrics?format=prometheus', 'GET', null, { authorization: `Bearer ${apiKey}` });
    assert.equal(prom.status, 200, 'prometheus metrics endpoint should return 200');
    assert.ok(prom.headers['content-type'].includes('text/plain'), 'prometheus content type');
    assert.ok(prom.body.includes('permabrain_runtime_uptime_seconds'), 'prometheus uptime metric');
    assert.ok(prom.body.includes('permabrain_articles_total'), 'prometheus articles metric');

    const filtered = await request(port, '/api/v1/metrics?topic=viewer-metrics-test', 'GET', null, { authorization: `Bearer ${apiKey}` });
    assert.equal(filtered.status, 200, 'filtered metrics endpoint should return 200');
    assert.equal(filtered.json.data.filters.topic, 'viewer-metrics-test', 'filtered metrics topic param preserved in filters');
    assert.equal(typeof filtered.json.data.totals.articles, 'number', 'filtered metrics totals.articles is a number');
  } finally {
    await stopServer(server);
    fs.rmSync(home, { recursive: true, force: true });
  }
}

console.log('viewer-metrics tests passed');
