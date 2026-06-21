/**
 * Viewer Stats catalog panel tests.
 *
 * Verifies that the web viewer includes a Stats panel wired to
 * GET /api/v1/stats, supports deep-link state (?view=stats plus filter
 * params), exposes the expected window functions, and that the backend
 * endpoint supports JSON and Markdown output.
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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-viewer-stats-'));
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

// --- viewer/index.html contains stats panel wiring ---
{
  const html = fs.readFileSync(viewerPath, 'utf8');
  assert.ok(html.includes('id="statsBtn"'), 'viewer should have stats button');
  assert.ok(html.includes('window.showStats'), 'viewer should expose showStats');
  assert.ok(html.includes('window.refreshStats'), 'viewer should expose refreshStats');
  assert.ok(html.includes('window.fetchStats'), 'viewer should expose fetchStats');
  assert.ok(html.includes('window.renderStats'), 'viewer should expose renderStats');
  assert.ok(html.includes('window.setStatsFilter'), 'viewer should expose setStatsFilter');
  assert.ok(html.includes('window.setStatsTop'), 'viewer should expose setStatsTop');
  assert.ok(html.includes('statsState'), 'viewer should have statsState');
  assert.ok(html.includes("viewMode === 'stats'"), 'stats panel render guard');
  assert.ok(html.includes('/api/v1/stats'), 'viewer should call stats endpoint');
}

// --- local API stats endpoint works, and panel query params pass through ---
{
  const home = makeTempHome();
  await resetApi(home);

  const apiKey = generateApiKey();
  const { server, port } = await startServer({ port: 0, home, apiKey });
  try {
    const pub = await request(port, '/api/v1/articles', 'POST', {
      content: '# Viewer Stats Test\n\nA test article for the stats panel.',
      kind: 'subject',
      topic: 'viewer-stats-test',
      sourceUrl: 'https://example.com/viewer-stats-test',
      title: 'Viewer Stats Test'
    }, { authorization: `Bearer ${apiKey}` });
    assert.equal(pub.status, 201, 'publish should succeed');
    assert.ok(pub.json?.summary?.key, 'publish should return a key');

    const stats = await request(port, '/api/v1/stats', 'GET', null, { authorization: `Bearer ${apiKey}` });
    assert.equal(stats.status, 200, 'stats endpoint should return 200');
    assert.ok(stats.json.generatedAt, 'stats has generatedAt');
    assert.ok(stats.json.home, 'stats has home');
    assert.ok(stats.json.totals, 'stats has totals');
    assert.equal(typeof stats.json.totals.articles, 'number', 'totals.articles is a number');
    assert.equal(typeof stats.json.totals.attestations, 'number', 'totals.attestations is a number');
    assert.equal(typeof stats.json.totals.agentCount, 'number', 'totals.agentCount is a number');
    assert.equal(typeof stats.json.consensus.averageConsensus, 'number', 'averageConsensus is a number');
    assert.ok(stats.json.activity.timeline != null, 'activity timeline present');

    const filtered = await request(port, '/api/v1/stats?kind=subject&topic=viewer-stats-test&top=5', 'GET', null, { authorization: `Bearer ${apiKey}` });
    assert.equal(filtered.status, 200, 'stats endpoint should accept kind/topic/top');
    assert.equal(filtered.json.totals.kindCount, 1, 'kind filter narrows to one kind');
    assert.equal(filtered.json.totals.topicCount, 1, 'topic filter narrows to one topic');
    assert.ok(filtered.json.totals.articles >= 1, 'at least one article matches filter');

    const md = await request(port, '/api/v1/stats', 'GET', null, { authorization: `Bearer ${apiKey}`, accept: 'text/markdown' });
    assert.equal(md.status, 200, 'stats markdown endpoint should return 200');
    assert.ok(md.headers['content-type'].includes('text/markdown'), 'markdown content type');
    assert.ok(md.body.includes('# PermaBrain Stats Dashboard'), 'markdown body has header');
  } finally {
    await stopServer(server);
    fs.rmSync(home, { recursive: true, force: true });
  }
}

console.log('viewer-stats tests passed');
