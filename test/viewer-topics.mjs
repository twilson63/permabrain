/**
 * Viewer topics catalog panel tests.
 *
 * Verifies that the web viewer includes a Topics panel wired to
 * GET /api/v1/topics, supports deep-link state (?view=topics), and
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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-viewer-topics-'));
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

// --- viewer/index.html contains topics panel wiring ---
{
  const html = fs.readFileSync(viewerPath, 'utf8');
  assert.ok(html.includes('id="topicsBtn"'), 'viewer should have topics button');
  assert.ok(html.includes('window.showTopics'), 'viewer should expose showTopics');
  assert.ok(html.includes('window.refreshTopics'), 'viewer should expose refreshTopics');
  assert.ok(html.includes('window.fetchTopics'), 'viewer should expose fetchTopics');
  assert.ok(html.includes('window.renderTopics'), 'viewer should expose renderTopics');
  assert.ok(html.includes('window.setTopicsSort'), 'viewer should expose setTopicsSort');
  assert.ok(html.includes('window.setTopicsLimit'), 'viewer should expose setTopicsLimit');
  assert.ok(html.includes("'topics'"), 'viewer should reference topics view in state handling');
  assert.ok(html.includes("viewMode === 'topics'"), 'topics panel render guard');
  assert.ok(html.includes('/api/v1/topics'), 'viewer should call topics endpoint');
}

// --- local API topics endpoint works, and panel query params pass through ---
{
  const home = makeTempHome();
  await resetApi(home);

  const apiKey = generateApiKey();
  const { server, port } = await startServer({ port: 0, home, apiKey });
  try {
    // Seed an article so the topics catalog is non-empty.
    const pub = await request(port, '/api/v1/articles', 'POST', {
      content: '# Viewer Topics Test\n\nA test article for the topics panel.',
      kind: 'subject',
      topic: 'viewer-topics-test',
      sourceUrl: 'https://example.com/viewer-topics-test',
      title: 'Viewer Topics Test'
    }, { authorization: `Bearer ${apiKey}` });
    assert.equal(pub.status, 201, 'publish should succeed');
    assert.ok(pub.json?.summary?.key, 'publish should return a key');

    const topics = await request(port, '/api/v1/topics', 'GET', null, { authorization: `Bearer ${apiKey}` });
    assert.equal(topics.status, 200, 'topics endpoint should return 200');
    assert.ok(topics.json.generatedAt, 'topics has generatedAt');
    assert.ok(topics.json.home, 'topics has home');
    assert.ok(Array.isArray(topics.json.topics), 'topics response is array');
    assert.equal(typeof topics.json.totals.topics, 'number', 'totals.topics is a number');
    assert.equal(typeof topics.json.totals.articles, 'number', 'totals.articles is a number');
    const seeded = topics.json.topics.find((t) => t.name === 'viewer-topics-test');
    assert.ok(seeded, 'seeded topic appears in catalog');
    assert.ok(seeded.count >= 1, 'seeded topic has at least one article');
    assert.ok(seeded.uniqueKeys >= 1, 'seeded topic has at least one unique key');
    assert.ok(seeded.byKind.subject >= 1, 'seeded topic kind breakdown includes subject');

    const sorted = await request(port, '/api/v1/topics?sort=name&limit=5', 'GET', null, { authorization: `Bearer ${apiKey}` });
    assert.equal(sorted.status, 200, 'topics endpoint should accept sort/limit');
    assert.ok(Array.isArray(sorted.json.topics), 'sorted topics response is array');
    assert.ok(sorted.json.topics.length <= 5, 'limit is respected');
  } finally {
    await stopServer(server);
    fs.rmSync(home, { recursive: true, force: true });
  }
}

console.log('viewer-topics tests passed');
