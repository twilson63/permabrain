/**
 * Test: Topics catalog (`permabrain topics` / `api.topics()` / `GET /api/v1/topics`)
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { listTopics, topicsToMarkdown } from '../src/topics.mjs';
import { writeIndex } from '../src/cache.mjs';
import { runCommand } from '../src/commands.mjs';
import { api } from '../src/index.mjs';
import { startServer, stopServer } from '../src/serve.mjs';
import { createClient } from '../src/client.mjs';

function makeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-topics-'));
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
  writeIndex(home, { articles, attestations: {}, updatedAt: new Date().toISOString() });
}

console.log('1. listTopics on empty index');
{
  const home = makeHome();
  const report = listTopics({ home });
  assert.equal(report.topics.length, 0, 'no topics');
  assert.equal(report.totals.articles, 0, 'no articles');
  assert.ok(report.generatedAt, 'generatedAt');
  assert.ok(topicsToMarkdown(report).includes('No topics found'));
}
console.log('   ✓ empty report ok');

console.log('2. listTopics aggregates topics');
{
  const home = makeHome();
  seedIndex(home);
  const report = listTopics({ home });
  assert.equal(report.totals.topics, 2, 'two topics');
  assert.equal(report.totals.articles, 3, 'three articles');

  const ai = report.topics.find((t) => t.name === 'ai');
  assert.ok(ai, 'ai topic exists');
  assert.equal(ai.count, 2, 'ai has two articles');
  assert.equal(ai.uniqueKeys, 2, 'ai has two unique keys');
  assert.equal(ai.byKind.subject, 2, 'ai subject count');

  const computing = report.topics.find((t) => t.name === 'computing');
  assert.ok(computing, 'computing topic exists');
  assert.equal(computing.count, 1, 'computing has one article');
  assert.equal(computing.byKind.person, 1, 'computing person count');

  assert.equal(report.topics[0].name, 'ai', 'sorted by count desc');
}
console.log('   ✓ aggregation ok');

console.log('3. listTopics filtering and sorting');
{
  const home = makeHome();
  seedIndex(home);
  const byKind = listTopics({ home, kind: 'person' });
  assert.equal(byKind.topics.length, 1, 'one person topic');
  assert.equal(byKind.topics[0].name, 'computing', 'person topic is computing');

  const byAfter = listTopics({ home, after: '2026-06-15T00:00:00.000Z' });
  assert.equal(byAfter.totals.articles, 2, 'two articles after cutoff');
  assert.equal(byAfter.topics[0].name, 'ai', 'ai is latest topic');

  const byName = listTopics({ home, sort: 'name' });
  assert.equal(byName.topics[0].name, 'ai', 'alphabetical first');
  assert.equal(byName.topics[1].name, 'computing', 'alphabetical second');

  const limited = listTopics({ home, limit: 1 });
  assert.equal(limited.topics.length, 1, 'limit respected');
}
console.log('   ✓ filtering and sorting ok');

console.log('4. api.topics() integration');
{
  const home = makeHome();
  seedIndex(home);
  process.env.PERMABRAIN_HOME = home;
  process.env.PERMABRAIN_TRANSPORT = 'local';
  api._home = null;
  api._config = null;
  api._identity = null;
  const report = await api.topics({ sort: 'count' });
  assert.equal(report.totals.topics, 2, 'api sees two topics');
  const markdown = await api.topicsToMarkdown({ sort: 'count' });
  assert.ok(markdown.includes('PermaBrain Topics'), 'markdown header');
  assert.ok(markdown.includes('| ai |'), 'ai row');
  api._home = null;
  api._config = null;
  api._identity = null;
}
console.log('   ✓ api integration ok');

console.log('5. CLI permabrain topics');
{
  const home = makeHome();
  seedIndex(home);
  let output = '';
  const originalLog = console.log;
  console.log = (msg) => { output += String(msg) + '\n'; };
  await runCommand('topics', { home, json: true });
  console.log = originalLog;
  const parsed = JSON.parse(output);
  assert.equal(parsed.totals.topics, 2, 'CLI sees two topics');
  assert.ok(parsed.topics.some((t) => t.name === 'ai'), 'CLI has ai topic');
}
console.log('   ✓ CLI topics ok');

console.log('6. HTTP GET /api/v1/topics');
{
  const home = makeHome();
  seedIndex(home);
  process.env.PERMABRAIN_HOME = home;
  process.env.PERMABRAIN_TRANSPORT = 'local';
  api._home = null;
  api._config = null;
  api._identity = null;

  const started = await startServer({ home, port: 0 });
  const server = started.server;
  const port = started.port;

  function request(method, path, headers = {}) {
    return new Promise((resolve, reject) => {
      const req = http.request({ hostname: 'localhost', port, method, path, headers }, (res) => {
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

  const json = await request('GET', '/api/v1/topics');
  assert.equal(json.status, 200, 'topics status 200');
  assert.equal(json.body.totals.topics, 2, 'HTTP sees two topics');
  assert.ok(json.body.topics.some((t) => t.name === 'ai'), 'HTTP has ai');

  const filtered = await request('GET', '/api/v1/topics?kind=person');
  assert.equal(filtered.body.totals.topics, 1, 'HTTP kind filter works');

  const md = await request('GET', '/api/v1/topics', { accept: 'text/markdown' });
  assert.equal(md.status, 200, 'markdown status 200');
  assert.ok(md.contentType.includes('text/markdown'), 'markdown content type');
  assert.ok(md.body.includes('PermaBrain Topics'), 'markdown body header');

  const client = createClient({ baseUrl: `http://localhost:${port}` });
  const clientTopics = await client.topics({ sort: 'name' });
  assert.equal(clientTopics.totals.topics, 2, 'SDK sees two topics');
  assert.equal(clientTopics.topics[0].name, 'ai', 'SDK sort works');

  const clientMarkdown = await client.topicsMarkdown();
  assert.ok(clientMarkdown.includes('| ai |'), 'SDK markdown includes ai row');

  await stopServer(server);
  api._home = null;
  api._config = null;
  api._identity = null;
}
console.log('   ✓ HTTP topics ok');

console.log('All topics tests passed.');
