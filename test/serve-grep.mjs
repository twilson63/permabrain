/**
 * Server Grep endpoint tests.
 *
 * Verifies the /api/v1/grep HTTP endpoint wiring, query params,
 * regex/ignore-case toggles, metadata filters, auth, and markdown format.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { startServer, stopServer } from '../src/serve.mjs';
import { api } from '../src/agent-api.mjs';
import { initState } from '../src/config.mjs';
import { generateApiKey } from '../src/auth.mjs';

function makeTempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-serve-grep-'));
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

{
  const home = makeTempHome();
  await resetApi(home);

  const apiKey = generateApiKey();
  const { server, port } = await startServer({ port: 0, home, apiKey });
  try {
    const pub = await request(port, '/api/v1/articles', 'POST', {
      content: '# Grep Serve Test\n\nThe quick brown fox jumps over the lazy dog.\n\n## Details\n\nFoxes are clever animals.',
      kind: 'subject',
      topic: 'serve-grep',
      sourceUrl: 'https://example.com/serve-grep',
      title: 'Grep Serve Test',
      language: 'en'
    }, { authorization: `Bearer ${apiKey}` });
    assert.equal(pub.status, 201, 'publish should succeed: ' + pub.body);
    const key = pub.json?.summary?.key;
    assert.ok(key, 'publish should return a key');

    console.log('1. Basic grep endpoint');
    {
      const r = await request(port, '/api/v1/grep?q=quick+brown+fox', 'GET', null, { authorization: `Bearer ${apiKey}` });
      assert.equal(r.status, 200, 'grep should return 200');
      assert.equal(r.json.query, 'quick brown fox');
      assert.ok(Array.isArray(r.json.matches));
      assert.ok(r.json.matches.some((m) => (m.key || m.article?.key) === key), 'expected published article');
      assert.equal(r.json.regex, false);
      assert.equal(r.json.ignoreCase, false);
      console.log('   ✓ basic grep works');
    }

    console.log('2. Regex mode');
    {
      const r = await request(port, '/api/v1/grep?q=%5Cbfox%5Cb&regex=true', 'GET', null, { authorization: `Bearer ${apiKey}` });
      assert.equal(r.status, 200);
      assert.equal(r.json.regex, true);
      assert.ok(r.json.total >= 1, 'regex word boundary should find fox');
      console.log('   ✓ regex mode works');
    }

    console.log('3. Ignore-case mode');
    {
      const r = await request(port, '/api/v1/grep?q=FOXES&ignore-case=true', 'GET', null, { authorization: `Bearer ${apiKey}` });
      assert.equal(r.status, 200);
      assert.equal(r.json.ignoreCase, true);
      assert.ok(r.json.matches.some((m) => (m.key || m.article?.key) === key), 'ignore-case should find article');
      console.log('   ✓ ignore-case works');
    }

    console.log('4. Metadata filters');
    {
      const kind = await request(port, '/api/v1/grep?q=quick&kind=subject', 'GET', null, { authorization: `Bearer ${apiKey}` });
      assert.equal(kind.status, 200);
      assert.ok(kind.json.matches.some((m) => (m.key || m.article?.key) === key), 'kind filter should match');

      const topic = await request(port, '/api/v1/grep?q=quick&topic=serve-grep', 'GET', null, { authorization: `Bearer ${apiKey}` });
      assert.equal(topic.status, 200);
      assert.ok(topic.json.matches.some((m) => (m.key || m.article?.key) === key), 'topic filter should match');

      const language = await request(port, '/api/v1/grep?q=quick&language=en', 'GET', null, { authorization: `Bearer ${apiKey}` });
      assert.equal(language.status, 200);
      assert.ok(language.json.matches.some((m) => (m.key || m.article?.key) === key), 'language filter should match');

      const byKey = await request(port, `/api/v1/grep?q=quick&key=${encodeURIComponent(key)}`, 'GET', null, { authorization: `Bearer ${apiKey}` });
      assert.equal(byKey.status, 200);
      assert.equal(byKey.json.matches.length, 1, 'key filter should return one article');
      console.log('   ✓ metadata filters work');
    }

    console.log('5. Limit and context');
    {
      const r = await request(port, '/api/v1/grep?q=fox&limit=1&context=20', 'GET', null, { authorization: `Bearer ${apiKey}` });
      assert.equal(r.status, 200);
      assert.equal(r.json.total, 1, 'limit=1 caps total matches');
      const snippet = r.json.matches[0]?.matches?.[0]?.snippet || '';
      assert.ok(snippet.length <= 40, 'context=20 means ~40 chars max');
      console.log('   ✓ limit and context respected');
    }

    console.log('6. Missing query validation');
    {
      const r = await request(port, '/api/v1/grep', 'GET', null, { authorization: `Bearer ${apiKey}` });
      assert.equal(r.status, 400);
      assert.ok(r.body.includes('q is required'), 'error message mentions q');
      console.log('   ✓ missing q returns 400');
    }

    console.log('7. Markdown format');
    {
      const r = await request(port, '/api/v1/grep?q=fox', 'GET', null, { authorization: `Bearer ${apiKey}`, accept: 'text/markdown' });
      assert.equal(r.status, 200);
      assert.ok(r.headers['content-type'].includes('text/markdown'), 'markdown content-type');
      assert.ok(r.body.includes('# PermaBrain grep'), 'markdown report header');
      assert.ok(r.body.includes(key), 'markdown report contains key');
      console.log('   ✓ markdown format works');
    }

    console.log('8. Auth required');
    {
      const r = await request(port, '/api/v1/grep?q=fox', 'GET', null, {});
      assert.equal(r.status, 401, 'unauthenticated request rejected');
      console.log('   ✓ auth enforced');
    }

    console.log('9. Empty results');
    {
      const r = await request(port, '/api/v1/grep?q=xyznotfound12345', 'GET', null, { authorization: `Bearer ${apiKey}` });
      assert.equal(r.status, 200);
      assert.deepEqual(r.json.matches, []);
      assert.equal(r.json.total, 0);
      console.log('   ✓ empty results handled');
    }
  } finally {
    await stopServer(server);
  }
}

console.log('✅ All serve-grep tests passed');
