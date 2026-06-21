/**
 * Test: Tag index catalog (`listTags` / `api.tags()` / `GET /api/v1/tags`)
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { listTags, tagsToMarkdown, isCustomTag } from '../src/tag-index.mjs';
import { statePaths } from '../src/config.mjs';
import { startServer, stopServer } from '../src/serve.mjs';
import { api } from '../src/index.mjs';
import { generateApiKey } from '../src/auth.mjs';

function makeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-tags-'));
  fs.mkdirSync(path.join(home, 'cache', 'objects'), { recursive: true });
  fs.mkdirSync(path.join(home, 'logs'), { recursive: true });
  return home;
}

function seedObject(home, id, extraTags = []) {
  const { objectsDir } = statePaths(home);
  const item = {
    id,
    format: 'ans104@1.0',
    owner: 'agent-one',
    timestamp: new Date().toISOString(),
    tags: [
      { name: 'App-Name', value: 'PermaBrain' },
      { name: 'App-Version', value: '0.0.0-test' },
      { name: 'PermaBrain-Type', value: 'article' },
      { name: 'Article-Key', value: `subject/test-${id}` },
      { name: 'Article-Kind', value: 'subject' },
      { name: 'Article-Title', value: `Test ${id}` },
      { name: 'Article-Slug', value: `test-${id}` },
      { name: 'Article-Topic', value: 'testing' },
      { name: 'Article-Language', value: 'en' },
      { name: 'Article-Version', value: '1' },
      { name: 'Article-Content-Hash', value: 'sha256:aa' },
      { name: 'Article-Updated-At', value: new Date().toISOString() },
      { name: 'Author-Agent-Id', value: 'agent-one' },
      { name: 'Visibility', value: 'public' },
      ...extraTags
    ]
  };
  fs.writeFileSync(path.join(objectsDir, `${id}.json`), JSON.stringify(item) + '\n');
}

function request(port, reqPath, method = 'GET', body = null, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const headers = { ...extraHeaders };
    if (body) headers['content-type'] = 'application/json';
    const req = http.request({ hostname: '127.0.0.1', port, method, path: reqPath, headers }, (res) => {
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

console.log('1. isCustomTag excludes reserved tags');
{
  assert.equal(isCustomTag('Article-Key'), false, 'Article-Key is reserved');
  assert.equal(isCustomTag('Attestation-Opinion'), false, 'attestation tag is reserved');
  assert.equal(isCustomTag('My-Custom-Tag'), true, 'custom tag is allowed');
}
console.log('   ✓ reserved/custom classification ok');

console.log('2. listTags on empty objects dir');
{
  const home = makeHome();
  const report = listTags({ home });
  assert.equal(report.tags.length, 0, 'no tags');
  assert.equal(report.totals.tags, 0, 'zero tag total');
  assert.equal(report.totals.articles, 0, 'zero article total');
  assert.ok(tagsToMarkdown(report).includes('No custom tags found'));
  fs.rmSync(home, { recursive: true, force: true });
}
console.log('   ✓ empty report ok');

console.log('3. listTags aggregates custom tags');
{
  const home = makeHome();
  seedObject(home, 'a', [{ name: 'Project', value: 'alpha' }, { name: 'Status', value: 'draft' }]);
  seedObject(home, 'b', [{ name: 'Project', value: 'alpha' }, { name: 'Priority', value: 'high' }]);
  seedObject(home, 'c', [{ name: 'Project', value: 'beta' }, { name: 'Status', value: 'draft' }]);

  const report = listTags({ home });
  assert.equal(report.totals.tags, 3, 'three custom tag names');
  assert.equal(report.totals.articles, 3, 'three articles');

  const project = report.tags.find((t) => t.name === 'Project');
  assert.ok(project, 'Project tag present');
  assert.equal(project.count, 3, 'Project appears on all three');
  assert.equal(project.uniqueKeys, 3, 'Project spans three keys');
  assert.equal(project.uniqueValues, 2, 'Project has two values');

  const status = report.tags.find((t) => t.name === 'Status');
  assert.equal(status.count, 2, 'Status appears twice');

  const priority = report.tags.find((t) => t.name === 'Priority');
  assert.equal(priority.count, 1, 'Priority appears once');

  fs.rmSync(home, { recursive: true, force: true });
}
console.log('   ✓ aggregation ok');

console.log('4. listTags filters and sorts');
{
  const home = makeHome();
  const d1 = new Date('2026-06-15T10:00:00.000Z').toISOString();
  const d2 = new Date('2026-06-18T10:00:00.000Z').toISOString();
  seedObject(home, 'x', [{ name: 'Project', value: 'old' }, { name: 'Stage', value: 'one' }]);
  seedObject(home, 'y', [{ name: 'Project', value: 'new' }, { name: 'Stage', value: 'two' }]);

  // Patch timestamps for predictable after filtering.
  const { objectsDir } = statePaths(home);
  const patch = (id, updatedAt) => {
    const p = path.join(objectsDir, `${id}.json`);
    const item = JSON.parse(fs.readFileSync(p, 'utf8'));
    item.timestamp = updatedAt;
    const idx = item.tags.findIndex((t) => t.name === 'Article-Updated-At');
    if (idx >= 0) item.tags[idx].value = updatedAt;
    fs.writeFileSync(p, JSON.stringify(item) + '\n');
  };
  patch('x', d1);
  patch('y', d2);

  const byName = listTags({ home, sort: 'name' });
  assert.equal(byName.tags[0].name, 'Project', 'sort by name starts with Project');

  const limited = listTags({ home, limit: 1 });
  assert.equal(limited.tags.length, 1, 'limit respected');

  const filtered = listTags({ home, prefix: 'Pro' });
  assert.equal(filtered.tags.length, 1, 'prefix filters to Project');

  const after = listTags({ home, after: '2026-06-16T00:00:00.000Z' });
  const afterProject = after.tags.find((t) => t.name === 'Project');
  assert.ok(afterProject, 'Project still present after date filter');
  assert.ok(afterProject.latestAt >= '2026-06-16T00:00:00.000Z', 'Project latestAt is after cutoff');

  const before = listTags({ home, before: '2026-06-17T00:00:00.000Z' });
  const beforeProject = before.tags.find((t) => t.name === 'Project');
  assert.ok(!beforeProject, 'Project filtered out by before cutoff');

  fs.rmSync(home, { recursive: true, force: true });
}
console.log('   ✓ filters/sorts ok');

console.log('5. tagsToMarkdown renders table');
{
  const home = makeHome();
  seedObject(home, 'md', [{ name: 'Project', value: 'demo' }]);
  const report = listTags({ home });
  const md = tagsToMarkdown(report);
  assert.ok(md.includes('# PermaBrain Tags'), 'markdown header');
  assert.ok(md.includes('| Tag | Count |'), 'markdown table header');
  assert.ok(md.includes('Project'), 'markdown includes tag name');
  fs.rmSync(home, { recursive: true, force: true });
}
console.log('   ✓ markdown ok');

console.log('6. api.tags() integration');
{
  const home = makeHome();
  process.env.PERMABRAIN_HOME = home;
  process.env.PERMABRAIN_TRANSPORT = 'local';
  api._home = null;
  api._identity = null;
  api._config = null;
  await api.init({ transport: 'local', keyType: 'ed25519' });

  seedObject(home, 'api', [{ name: 'ApiTag', value: 'value1' }]);
  const report = await api.tags({ home, sort: 'name' });
  assert.ok(report.tags.find((t) => t.name === 'ApiTag'), 'api.tags returns ApiTag');
  assert.equal(report.totals.articles, 1, 'api.tags counts one article');

  const md = await api.tagsToMarkdown({ home, limit: 10 });
  assert.ok(md.includes('ApiTag'), 'markdown from API includes tag');
  fs.rmSync(home, { recursive: true, force: true });
}
console.log('   ✓ agent API integration ok');

console.log('7. HTTP GET /api/v1/tags');
{
  const home = makeHome();
  process.env.PERMABRAIN_HOME = home;
  process.env.PERMABRAIN_TRANSPORT = 'local';
  api._home = null;
  api._identity = null;
  api._config = null;
  await api.init({ transport: 'local', keyType: 'ed25519' });
  const apiKey = generateApiKey();
  const { server, port } = await startServer({ port: 0, home, apiKey });

  try {
    seedObject(home, 'http', [{ name: 'HttpTag', value: 'x' }]);
    const json = await request(port, '/api/v1/tags', 'GET', null, { authorization: `Bearer ${apiKey}` });
    assert.equal(json.status, 200, 'tags endpoint returns 200');
    assert.ok(json.json.generatedAt, 'has generatedAt');
    assert.equal(typeof json.json.totals.tags, 'number', 'totals.tags is number');
    assert.ok(json.json.tags.find((t) => t.name === 'HttpTag'), 'HttpTag in response');

    const md = await request(port, '/api/v1/tags?limit=10', 'GET', null, { authorization: `Bearer ${apiKey}`, accept: 'text/markdown' });
    assert.equal(md.status, 200, 'markdown endpoint returns 200');
    assert.ok(md.headers['content-type'].includes('text/markdown'), 'markdown content type');
    assert.ok(md.body.includes('# PermaBrain Tags'), 'markdown body header');
  } finally {
    await stopServer(server);
    fs.rmSync(home, { recursive: true, force: true });
  }
}
console.log('   ✓ HTTP endpoint ok');

console.log('tags tests passed');
