/**
 * Viewer Goal / PRD planner panel tests.
 *
 * Verifies that the web viewer includes a Goal panel wired to
 * POST /api/v1/goal, supports deep-link state (?view=goal),
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

const SAMPLE_PRD = `# Add Telegram Onboarding Bot

## Context
New users joining the Telegram group should receive a short onboarding message explaining how to interact with the assistant and where to find documentation.

## Success criteria
- Bot detects new members within 10 seconds
- Sends a personalized welcome message
- Includes a link to the user guide

## Step 1: Listen to Telegram chat member events
Subscribe to chat_member updates from the Telegram bot API.

## Step 2: Compose a welcome message from a template
Render a markdown template with the user's first name.

## Step 3: Send the message via the Telegram bot API
POST to sendMessage with the rendered text.

## Step 4: Log onboarding attempts to the activity stream
Emit an activity event for analytics.

## References
- https://core.telegram.org/bots/api`;

function makeTempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-viewer-goal-'));
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

// --- viewer/index.html contains goal panel wiring ---
{
  const html = fs.readFileSync(viewerPath, 'utf8');
  assert.ok(html.includes('id="goalBtn"'), 'viewer should have goal button');
  assert.ok(html.includes('window.showGoal'), 'viewer should expose showGoal');
  assert.ok(html.includes('window.refreshGoal'), 'viewer should expose refreshGoal');
  assert.ok(html.includes('window.runGoalParse'), 'viewer should expose runGoalParse');
  assert.ok(html.includes('window.renderGoal'), 'viewer should expose renderGoal');
  assert.ok(html.includes('window.loadGoalExample'), 'viewer should expose loadGoalExample');
  assert.ok(html.includes('window.clearGoal'), 'viewer should expose clearGoal');
  assert.ok(html.includes("viewMode === 'goal'"), 'goal panel render guard');
  assert.ok(html.includes('/api/v1/goal'), 'viewer should call goal endpoint');
  assert.ok(html.includes('goalState'), 'viewer should have goalState');
  assert.ok(html.includes('goal-input'), 'viewer should have goal input');
  assert.ok(html.includes('permabrain-goal-draft'), 'viewer should persist goal draft');
}

// --- local API goal endpoint works: empty body 400, parse PRD, metadata arrays ---
{
  const home = makeTempHome();
  await resetApi(home);

  const apiKey = generateApiKey();
  const { server, port } = await startServer({ port: 0, home, apiKey });
  try {
    const empty = await request(port, '/api/v1/goal', 'POST', {}, {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json'
    });
    assert.equal(empty.status, 400, 'goal endpoint should require text or filePath');
    assert.ok(empty.json.error, 'error body should include message');

    const parsed = await request(port, '/api/v1/goal', 'POST', { text: SAMPLE_PRD }, {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json'
    });
    assert.equal(parsed.status, 200, 'goal parse should return 200');
    assert.equal(parsed.json.title, 'Add Telegram Onboarding Bot', 'title extracted');
    assert.ok(parsed.json.summary, 'summary extracted');
    assert.ok(Array.isArray(parsed.json.steps), 'steps is an array');
    assert.equal(parsed.json.steps.length, 4, 'four ordered steps');
    assert.ok(parsed.json.steps.every(s => s.title && s.criteria && Array.isArray(s.criteria)), 'steps have criteria');
    assert.ok(Array.isArray(parsed.json.urls), 'urls is an array');
    assert.ok(parsed.json.urls.some(u => u.url.includes('telegram.org')), 'telegram URL extracted');
    assert.ok(parsed.json.metadata, 'metadata present');
    assert.ok(Array.isArray(parsed.json.metadata.kinds), 'metadata.kinds serialized as array');
    assert.ok(Array.isArray(parsed.json.metadata.topics), 'metadata.topics serialized as array');

    const withTopic = await request(port, '/api/v1/goal', 'POST', { text: SAMPLE_PRD, options: { topics: ['messaging'] } }, {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json'
    });
    assert.equal(withTopic.status, 200, 'goal parse with options should return 200');
    assert.ok(withTopic.json.metadata.topics.includes('messaging'), 'explicit messaging topic preserved');

    const nokey = await request(port, '/api/v1/goal', 'POST', { text: SAMPLE_PRD });
    assert.equal(nokey.status, 401, 'goal endpoint requires API key');
  } finally {
    await stopServer(server);
    fs.rmSync(home, { recursive: true, force: true });
  }
}

console.log('viewer-goal tests passed');
