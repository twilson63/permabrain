/**
 * Viewer Grep panel tests.
 *
 * Verifies that the web viewer includes a Grep panel wired to
 * GET /api/v1/grep, supports deep-link state (?view=grep&grepQ=...),
 * and exposes the expected window functions.
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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-viewer-grep-'));
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

// --- viewer/index.html contains grep panel wiring ---
{
  const html = fs.readFileSync(viewerPath, 'utf8');
  assert.ok(html.includes('id="grepBtn"'), 'viewer should have grep button');
  assert.ok(html.includes('window.showGrep'), 'viewer should expose showGrep');
  assert.ok(html.includes('window.refreshGrep'), 'viewer should expose refreshGrep');
  assert.ok(html.includes('window.runGrep'), 'viewer should expose runGrep');
  assert.ok(html.includes('window.fetchGrep'), 'viewer should expose fetchGrep');
  assert.ok(html.includes('window.renderGrep'), 'viewer should expose renderGrep');
  assert.ok(html.includes('window.setGrepFlag'), 'viewer should expose setGrepFlag');
  assert.ok(html.includes('window.copyGrepMarkdown'), 'viewer should expose copyGrepMarkdown');
  assert.ok(html.includes("'grep'"), 'viewer should reference grep view in state handling');
  assert.ok(html.includes("viewMode === 'grep'"), 'grep panel render guard');
  assert.ok(html.includes('/api/v1/grep'), 'viewer should call grep endpoint');
  assert.ok(html.includes('grepState'), 'viewer should have grepState');
  assert.ok(html.includes('grepQ'), 'viewer should persist grep query in URL');
  assert.ok(html.includes('grepRegex'), 'viewer should persist regex flag in URL');
  assert.ok(html.includes('grepIgnoreCase'), 'viewer should persist ignore-case flag in URL');
}

// --- local API grep endpoint works ---
{
  const home = makeTempHome();
  await resetApi(home);

  const apiKey = generateApiKey();
  const { server, port } = await startServer({ port: 0, home, apiKey });
  try {
    const pub = await request(port, '/api/v1/articles', 'POST', {
      content: '# Grep Test Article\n\nThis article contains the secret phrase purple monkey dishwasher.',
      kind: 'subject',
      topic: 'grep-test',
      sourceUrl: 'https://example.com/grep-test',
      title: 'Grep Test Article'
    }, { authorization: `Bearer ${apiKey}` });
    assert.equal(pub.status, 201, 'publish should succeed: ' + pub.body);
    const key = pub.json?.summary?.key;
    assert.ok(key, 'publish should return a key');

    const grep = await request(port, '/api/v1/grep?q=purple+monkey', 'GET', null, { authorization: `Bearer ${apiKey}` });
    assert.equal(grep.status, 200, 'grep endpoint should return 200');
    assert.equal(typeof grep.json.query, 'string', 'grep response has query');
    assert.equal(grep.json.query, 'purple monkey', 'grep query normalized');
    assert.ok(Array.isArray(grep.json.matches), 'grep matches is array');
    assert.ok(grep.json.matches.length >= 1, 'expected at least one match');
    assert.ok(grep.json.matches.some((m) => (m.key || m.article?.key) === key), 'expected the published article');

    const noResults = await request(port, '/api/v1/grep?q=xyznotfoundever12345', 'GET', null, { authorization: `Bearer ${apiKey}` });
    assert.equal(noResults.status, 200, 'empty grep should return 200');
    assert.equal(noResults.json.matches.length, 0, 'no matches for nonsense query');

    const missingQ = await request(port, '/api/v1/grep', 'GET', null, { authorization: `Bearer ${apiKey}` });
    assert.equal(missingQ.status, 400, 'grep without q should return 400');

    const regexGrep = await request(port, '/api/v1/grep?q=purple%5Cs%2Bmonkey&regex=true', 'GET', null, { authorization: `Bearer ${apiKey}` });
    assert.equal(regexGrep.status, 200, 'regex grep should return 200');
    assert.equal(regexGrep.json.regex, true, 'regex flag returned');
    assert.ok(regexGrep.json.matches.some((m) => (m.key || m.article?.key) === key), 'regex grep found the article');

    const ignoreCaseGrep = await request(port, '/api/v1/grep?q=PURPLE+MONKEY&ignore-case=true', 'GET', null, { authorization: `Bearer ${apiKey}` });
    assert.equal(ignoreCaseGrep.status, 200, 'ignore-case grep should return 200');
    assert.equal(ignoreCaseGrep.json.ignoreCase, true, 'ignore-case flag returned');
    assert.ok(ignoreCaseGrep.json.matches.some((m) => (m.key || m.article?.key) === key), 'ignore-case grep found the article');

    const kindFilter = await request(port, '/api/v1/grep?q=purple+monkey&kind=subject', 'GET', null, { authorization: `Bearer ${apiKey}` });
    assert.equal(kindFilter.status, 200, 'kind filter grep should return 200');
    assert.ok(kindFilter.json.matches.some((m) => (m.key || m.article?.key) === key), 'kind filter grep found the article');

    const keyFilter = await request(port, `/api/v1/grep?q=purple+monkey&key=${encodeURIComponent(key)}`, 'GET', null, { authorization: `Bearer ${apiKey}` });
    assert.equal(keyFilter.status, 200, 'key filter grep should return 200');
    assert.equal(keyFilter.json.matches.length, 1, 'key filter returns exactly one article');

    const mdGrep = await request(port, '/api/v1/grep?q=purple+monkey', 'GET', null, { authorization: `Bearer ${apiKey}`, accept: 'text/markdown' });
    assert.equal(mdGrep.status, 200, 'markdown grep should return 200');
    assert.ok(mdGrep.headers['content-type'].includes('text/markdown'), 'markdown content-type');
    assert.ok(mdGrep.body.includes('purple'), 'markdown report contains query');
  } finally {
    await stopServer(server);
  }
}

console.log('All viewer-grep tests passed.');
