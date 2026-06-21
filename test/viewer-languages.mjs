/**
 * Viewer languages catalog panel tests.
 *
 * Verifies that the web viewer includes a Languages panel wired to
 * GET /api/v1/languages, supports deep-link state (?view=languages), and
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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-viewer-languages-'));
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

// --- viewer/index.html contains languages panel wiring ---
{
  const html = fs.readFileSync(viewerPath, 'utf8');
  assert.ok(html.includes('id="languagesBtn"'), 'viewer should have languages button');
  assert.ok(html.includes('window.showLanguages'), 'viewer should expose showLanguages');
  assert.ok(html.includes('window.refreshLanguages'), 'viewer should expose refreshLanguages');
  assert.ok(html.includes('window.fetchLanguages'), 'viewer should expose fetchLanguages');
  assert.ok(html.includes('window.renderLanguages'), 'viewer should expose renderLanguages');
  assert.ok(html.includes('window.setLanguagesSort'), 'viewer should expose setLanguagesSort');
  assert.ok(html.includes('window.setLanguagesLimit'), 'viewer should expose setLanguagesLimit');
  assert.ok(html.includes("'languages'"), 'viewer should reference languages view in state handling');
  assert.ok(html.includes("viewMode === 'languages'"), 'languages panel render guard');
  assert.ok(html.includes('/api/v1/languages'), 'viewer should call languages endpoint');
}

// --- local API languages endpoint works, and panel query params pass through ---
{
  const home = makeTempHome();
  await resetApi(home);

  const apiKey = generateApiKey();
  const { server, port } = await startServer({ port: 0, home, apiKey });
  try {
    const pub = await request(port, '/api/v1/articles', 'POST', {
      content: '# Viewer Languages Test\n\nA test article for the languages panel.',
      kind: 'subject',
      topic: 'viewer-languages-test',
      sourceUrl: 'https://example.com/viewer-languages-test',
      title: 'Viewer Languages Test'
    }, { authorization: `Bearer ${apiKey}` });
    assert.equal(pub.status, 201, 'publish should succeed');
    assert.ok(pub.json?.summary?.key, 'publish should return a key');

    const languages = await request(port, '/api/v1/languages', 'GET', null, { authorization: `Bearer ${apiKey}` });
    assert.equal(languages.status, 200, 'languages endpoint should return 200');
    assert.ok(languages.json.generatedAt, 'languages has generatedAt');
    assert.ok(languages.json.home, 'languages has home');
    assert.ok(Array.isArray(languages.json.languages), 'languages response is array');
    assert.equal(typeof languages.json.totals.languages, 'number', 'totals.languages is a number');
    assert.equal(typeof languages.json.totals.articles, 'number', 'totals.articles is a number');
    const seeded = languages.json.languages.find((l) => l.name === 'en');
    assert.ok(seeded, 'seeded en language appears in catalog');
    assert.ok(seeded.count >= 1, 'seeded language has at least one article');
    assert.ok(seeded.uniqueKeys >= 1, 'seeded language has at least one unique key');
    assert.ok(seeded.byTopic['viewer-languages-test'] >= 1, 'language topic breakdown includes seeded topic');

    const sorted = await request(port, '/api/v1/languages?sort=name&limit=5', 'GET', null, { authorization: `Bearer ${apiKey}` });
    assert.equal(sorted.status, 200, 'languages endpoint should accept sort/limit');
    assert.ok(Array.isArray(sorted.json.languages), 'sorted languages response is array');
    assert.ok(sorted.json.languages.length <= 5, 'limit is respected');

    const filtered = await request(port, '/api/v1/languages?topic=viewer-languages-test', 'GET', null, { authorization: `Bearer ${apiKey}` });
    assert.equal(filtered.status, 200, 'languages endpoint should accept topic filter');
    assert.equal(filtered.json.totals.languages, 1, 'topic filter leaves one language');
    assert.equal(filtered.json.languages[0].name, 'en', 'topic filter yields en');

    const md = await request(port, '/api/v1/languages?sort=name', 'GET', null, { authorization: `Bearer ${apiKey}`, accept: 'text/markdown' });
    assert.equal(md.status, 200, 'languages markdown endpoint should return 200');
    assert.ok(md.headers['content-type'].includes('text/markdown'), 'markdown content type');
    assert.ok(md.body.includes('# PermaBrain Languages'), 'markdown body has header');
  } finally {
    await stopServer(server);
    fs.rmSync(home, { recursive: true, force: true });
  }
}

console.log('viewer-languages tests passed');
