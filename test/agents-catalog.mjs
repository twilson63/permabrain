/**
 * Test: Agents catalog (`api.agents()` / `GET /api/v1/agents`)
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { listAgents, agentsToMarkdown } from '../src/agents-catalog.mjs';
import { writeIndex } from '../src/cache.mjs';
import { api } from '../src/index.mjs';
import { startServer, stopServer } from '../src/serve.mjs';
import { createClient } from '../src/client.mjs';
import { generateApiKey } from '../src/auth.mjs';

function makeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-agents-'));
  fs.mkdirSync(path.join(home, 'cache'), { recursive: true });
  fs.mkdirSync(path.join(home, 'logs'), { recursive: true });
  return home;
}

function seedIndex(home) {
  const articles = {
    'subject/ai': {
      id: 'art-ai-1',
      key: 'subject/ai',
      kind: 'subject',
      title: 'Artificial Intelligence',
      slug: 'ai',
      topic: 'ai',
      language: 'en',
      version: 1,
      previousId: null,
      rootId: null,
      sourceName: 'Wikipedia',
      sourceUrl: 'https://en.wikipedia.org/wiki/AI',
      contentHash: 'sha256:aa',
      updatedAt: '2026-06-15T10:00:00.000Z',
      authorAgentId: 'agent-one',
      visibility: 'public'
    },
    'person/ada-lovelace': {
      id: 'art-ada-1',
      key: 'person/ada-lovelace',
      kind: 'person',
      title: 'Ada Lovelace',
      slug: 'ada-lovelace',
      topic: 'computing',
      language: 'en',
      version: 2,
      previousId: 'art-ada-0',
      rootId: 'art-ada-0',
      sourceName: 'Wikipedia',
      sourceUrl: 'https://en.wikipedia.org/wiki/Ada_Lovelace',
      contentHash: 'sha256:bb',
      updatedAt: '2026-06-14T09:00:00.000Z',
      authorAgentId: 'agent-one',
      visibility: 'public'
    },
    'subject/machine-learning': {
      id: 'art-ml-1',
      key: 'subject/machine-learning',
      kind: 'subject',
      title: 'Machine Learning',
      slug: 'machine-learning',
      topic: 'ai',
      language: 'en',
      version: 1,
      previousId: null,
      rootId: null,
      sourceName: 'Wikipedia',
      sourceUrl: 'https://en.wikipedia.org/wiki/Machine_learning',
      contentHash: 'sha256:dd',
      updatedAt: '2026-06-16T08:00:00.000Z',
      authorAgentId: 'agent-two',
      visibility: 'public'
    }
  };
  const attestations = {
    'subject/ai': [
      { id: 'att-a1', targetKey: 'subject/ai', agentId: 'agent-two', opinion: 'valid', confidence: 0.9, createdAt: '2026-06-17T10:00:00.000Z' }
    ],
    'person/ada-lovelace': [
      { id: 'att-b1', targetKey: 'person/ada-lovelace', agentId: 'agent-two', opinion: 'partially-valid', confidence: 0.6, createdAt: '2026-06-13T10:00:00.000Z' }
    ]
  };
  writeIndex(home, { articles, attestations, updatedAt: new Date().toISOString() });
}

console.log('1. listAgents on empty index');
{
  const home = makeHome();
  const report = listAgents({ home });
  assert.equal(report.agents.length, 0, 'no agents');
  assert.equal(report.totals.articles, 0, 'no articles');
  assert.ok(report.generatedAt, 'generatedAt');
  assert.ok(agentsToMarkdown(report).includes('No agents found'));
}
console.log('   ✓ empty report ok');

console.log('2. listAgents aggregates agents');
{
  const home = makeHome();
  seedIndex(home);
  const report = listAgents({ home });
  assert.equal(report.totals.agents, 2, 'two agents');
  assert.equal(report.totals.articles, 3, 'three articles');

  const one = report.agents.find((a) => a.agentId === 'agent-one');
  assert.ok(one, 'agent-one exists');
  assert.equal(one.articles, 2, 'agent-one authored two');
  assert.equal(one.uniqueKeys, 2, 'agent-one has two unique keys');
  assert.equal(one.attestationsReceived, 2, 'agent-one received two attestations');
  assert.equal(one.attestationsGiven, 0, 'agent-one gave none');
  assert.equal(one.byKind.subject, 1, 'agent-one subject count');
  assert.equal(one.byKind.person, 1, 'agent-one person count');

  const two = report.agents.find((a) => a.agentId === 'agent-two');
  assert.ok(two, 'agent-two exists');
  assert.equal(two.articles, 1, 'agent-two authored one');
  assert.equal(two.attestationsGiven, 2, 'agent-two gave two attestations');
  assert.equal(two.attestationsReceived, 0, 'agent-two received no attestations');
  assert.equal(two.byOpinion.valid, 1, 'agent-two one valid opinion');
  assert.equal(two.byOpinion['partially-valid'], 1, 'agent-two one partially-valid');

  assert.equal(report.agents[0].agentId, 'agent-one', 'sorted by articles desc');
}
console.log('   ✓ aggregation ok');

console.log('3. listAgents filtering and sorting');
{
  const home = makeHome();
  seedIndex(home);
  const byKind = listAgents({ home, kind: 'person' });
  assert.equal(byKind.agents.length, 1, 'one person agent');
  assert.equal(byKind.agents[0].agentId, 'agent-one', 'agent-one is person agent');

  const byTopic = listAgents({ home, topic: 'ai' });
  assert.ok(byTopic.agents.some((a) => a.agentId === 'agent-one'), 'agent-one in ai');
  assert.ok(byTopic.agents.some((a) => a.agentId === 'agent-two'), 'agent-two in ai');

  const after = listAgents({ home, after: '2026-06-15T00:00:00.000Z' });
  assert.equal(after.agents.length, 2, 'two agents have activity after cutoff');
  assert.ok(after.agents.some((a) => a.agentId === 'agent-two'), 'agent-two appears after cutoff');

  const byName = listAgents({ home, sort: 'name' });
  assert.equal(byName.agents[0].agentId, 'agent-one', 'alphabetical first');
  assert.equal(byName.agents[1].agentId, 'agent-two', 'alphabetical second');

  const limited = listAgents({ home, limit: 1 });
  assert.equal(limited.agents.length, 1, 'limit respected');

  const minArticles = listAgents({ home, minArticles: 2 });
  assert.equal(minArticles.agents.length, 1, 'minArticles respected');
  assert.equal(minArticles.agents[0].agentId, 'agent-one', 'agent-one meets min');

  const substring = listAgents({ home, agentId: 'one' });
  assert.equal(substring.agents.length, 1, 'agentId substring');
}
console.log('   ✓ filtering and sorting ok');

console.log('4. api.agents() integration');
{
  const home = makeHome();
  seedIndex(home);
  process.env.PERMABRAIN_HOME = home;
  process.env.PERMABRAIN_TRANSPORT = 'local';
  api._home = null;
  api._config = null;
  api._identity = null;
  const report = await api.agents({ sort: 'articles' });
  assert.equal(report.totals.agents, 2, 'api sees two agents');
  const markdown = await api.agentsToMarkdown({ sort: 'articles' });
  assert.ok(markdown.includes('# PermaBrain Agents'), 'markdown header');
  assert.ok(markdown.includes('| agent-one |'), 'agent-one row');
  api._home = null;
  api._config = null;
  api._identity = null;
}
console.log('   ✓ api integration ok');

console.log('5. HTTP GET /api/v1/agents');
{
  const home = makeHome();
  seedIndex(home);
  process.env.PERMABRAIN_HOME = home;
  process.env.PERMABRAIN_TRANSPORT = 'local';
  api._home = null;
  api._config = null;
  api._identity = null;
  await api.init({ transport: 'local', keyType: 'ed25519' });

  const apiKey = generateApiKey();
  const started = await startServer({ home, port: 0, apiKey });
  const server = started.server;
  const port = started.port;

  function request(method, reqPath, headers = {}) {
    return new Promise((resolve, reject) => {
      const req = http.request({ hostname: 'localhost', port, method, path: reqPath, headers }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          const contentType = res.headers['content-type'] || '';
          const parsed = contentType.includes('application/json') && data ? JSON.parse(data) : data;
          resolve({ status: res.statusCode, body: parsed, contentType });
        });
      });
      req.on('error', reject);
      req.end();
    });
  }

  const json = await request('GET', '/api/v1/agents', { authorization: `Bearer ${apiKey}` });
  assert.equal(json.status, 200, 'agents status 200');
  assert.equal(json.body.totals.agents, 2, 'HTTP sees two agents');
  assert.ok(json.body.agents.some((a) => a.agentId === 'agent-one'), 'HTTP has agent-one');

  const filtered = await request('GET', '/api/v1/agents?kind=person', { authorization: `Bearer ${apiKey}` });
  assert.equal(filtered.body.totals.agents, 1, 'HTTP kind filter works');

  const md = await request('GET', '/api/v1/agents', { authorization: `Bearer ${apiKey}`, accept: 'text/markdown' });
  assert.equal(md.status, 200, 'markdown status 200');
  assert.ok(md.contentType.includes('text/markdown'), 'markdown content type');
  assert.ok(md.body.includes('# PermaBrain Agents'), 'markdown body header');

  const client = createClient({ baseUrl: `http://localhost:${port}`, apiKey });
  const clientAgents = await client.agents({ sort: 'name' });
  assert.equal(clientAgents.totals.agents, 2, 'SDK sees two agents');
  assert.equal(clientAgents.agents[0].agentId, 'agent-one', 'SDK sort works');

  const clientMarkdown = await client.agentsMarkdown();
  assert.ok(clientMarkdown.includes('| agent-one |'), 'SDK markdown includes agent-one row');

  await stopServer(server);
  api._home = null;
  api._config = null;
  api._identity = null;
}
console.log('   ✓ HTTP agents ok');

console.log('All agents-catalog tests passed.');
