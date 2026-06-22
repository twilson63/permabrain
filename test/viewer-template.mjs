/**
 * Viewer Template publisher panel tests.
 *
 * Verifies that the web viewer includes a Template panel wired to
 * POST /api/v1/template, supports deep-link state (?view=template),
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

const TEMPLATE_SOURCE = `---
topic: general
kind: subject
title: Hello {{name}}
---

# Welcome, {{name}}

This article was generated from a template for the **{{project}}** project on {{date}}.
`;

function makeTempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-viewer-template-'));
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

// --- viewer/index.html contains template panel wiring ---
{
  const html = fs.readFileSync(viewerPath, 'utf8');
  assert.ok(html.includes('id="templateBtn"'), 'viewer should have template button');
  assert.ok(html.includes('window.showTemplate'), 'viewer should expose showTemplate');
  assert.ok(html.includes('window.refreshTemplate'), 'viewer should expose refreshTemplate');
  assert.ok(html.includes('window.runTemplatePreview'), 'viewer should expose runTemplatePreview');
  assert.ok(html.includes('window.runTemplatePublish'), 'viewer should expose runTemplatePublish');
  assert.ok(html.includes('window.renderTemplatePanel'), 'viewer should expose renderTemplatePanel');
  assert.ok(html.includes('window.loadTemplateExample'), 'viewer should expose loadTemplateExample');
  assert.ok(html.includes('window.clearTemplate'), 'viewer should expose clearTemplate');
  assert.ok(html.includes("viewMode === 'template'"), 'template panel render guard');
  assert.ok(html.includes('/api/v1/template'), 'viewer should call template endpoint');
  assert.ok(html.includes('templateState'), 'viewer should have templateState');
  assert.ok(html.includes('data-testid="template-source"'), 'viewer should have template source input');
  assert.ok(html.includes('data-testid="template-variables"'), 'viewer should have template variables input');
  assert.ok(html.includes('permabrain-template-draft'), 'viewer should persist template draft');
  assert.ok(html.includes("'template' | 'activity'"), 'viewMode comment includes template');
}

// --- local API template endpoint works: empty body 400, publish from source, variable substitution ---
{
  const home = makeTempHome();
  await resetApi(home);

  const apiKey = generateApiKey();
  const { server, port } = await startServer({ port: 0, home, apiKey });
  try {
    const empty = await request(port, '/api/v1/template', 'POST', {}, {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json'
    });
    assert.equal(empty.status, 400, 'template endpoint should require file or source');
    assert.ok(empty.json.error, 'error body should include message');

    const variables = { name: 'PermaBrain', project: 'PermaBrain', date: '2026-06-22' };
    const published = await request(port, '/api/v1/template', 'POST', {
      source: TEMPLATE_SOURCE,
      variables,
      topic: 'general',
      kind: 'subject'
    }, {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json'
    });
    assert.equal(published.status, 201, 'template publish should return 201');
    assert.ok(published.json.key, 'published article has a key');
    assert.equal(published.json.tags.Title, 'Hello PermaBrain', 'variables substituted into title');
    assert.equal(published.json.tags.Kind, 'subject', 'kind tag set');
    assert.equal(published.json.tags.Topic, 'general', 'topic tag set');
    assert.equal(published.json.encrypted, false, 'article is not encrypted');

    const nokey = await request(port, '/api/v1/template', 'POST', { source: TEMPLATE_SOURCE });
    assert.equal(nokey.status, 401, 'template endpoint requires API key');
  } finally {
    await stopServer(server);
    fs.rmSync(home, { recursive: true, force: true });
  }
}

console.log('viewer-template tests passed');
