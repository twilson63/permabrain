/**
 * Test: Serve Dashboard Route
 *
 * Verifies the live web dashboard endpoints served by `permabrain serve`:
 *   - GET /api/v1/dashboard       → JSON snapshot
 *   - GET /api/v1/dashboard.html  → self-contained HTML page
 *   - query-param filters are passed through
 *   - content-type and status codes are correct
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer, stopServer } from '../src/serve.mjs';
import { api } from '../src/agent-api.mjs';

function tmpHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pb-serve-dashboard-'));
}

function resetApi(home) {
  api._home = home;
  api._config = null;
  api._identity = null;
}

async function initHome(home) {
  process.env.PERMABRAIN_HOME = home;
  await api.init({ keyType: 'ed25519' });
}

console.log('1. GET /api/v1/dashboard.html returns self-contained HTML');
{
  const home = tmpHome();
  resetApi(home);
  await initHome(home);
  const { server, port } = await startServer({ port: 0, home });
  try {
    const res = await fetch(`http://localhost:${port}/api/v1/dashboard.html`);
    assert.equal(res.status, 200, 'status 200');
    const ct = res.headers.get('content-type') || '';
    assert.ok(ct.includes('text/html'), `content-type is html, got ${ct}`);
    const html = await res.text();
    assert.ok(html.startsWith('<!DOCTYPE html>'), 'html doctype');
    assert.ok(html.includes('PermaBrain Dashboard'), 'dashboard title');
    assert.ok(html.includes('stats-grid'), 'stats grid element');
    assert.ok(html.includes('articles-tab'), 'articles tab element');
    assert.ok(html.includes('activity-tab'), 'activity tab element');
    assert.ok(html.includes('audit-tab'), 'audit tab element');
  } finally {
    await stopServer(server);
    fs.rmSync(home, { recursive: true, force: true });
  }
  console.log('   ✓ HTML dashboard route works');
}

console.log('2. GET /api/v1/dashboard returns JSON snapshot');
{
  const home = tmpHome();
  resetApi(home);
  await initHome(home);
  const { server, port } = await startServer({ port: 0, home });
  try {
    const res = await fetch(`http://localhost:${port}/api/v1/dashboard`);
    assert.equal(res.status, 200, 'status 200');
    const ct = res.headers.get('content-type') || '';
    assert.ok(ct.includes('application/json'), `content-type is json, got ${ct}`);
    const data = await res.json();
    assert.equal(data.home, home, 'dashboard home');
    assert.ok(data.agentId, 'agentId present');
    assert.ok(data.stats && typeof data.stats.totals === 'object', 'stats totals');
    assert.ok(data.list && typeof data.list.total === 'number', 'list total');
    assert.ok(data.activity && typeof data.activity.total === 'number', 'activity total');
    assert.ok(data.log && typeof data.log.total === 'number', 'log total');
  } finally {
    await stopServer(server);
    fs.rmSync(home, { recursive: true, force: true });
  }
  console.log('   ✓ JSON dashboard route works');
}

console.log('3. Dashboard route filters via query params');
{
  const home = tmpHome();
  resetApi(home);
  await initHome(home);

  // Seed a couple of articles with distinct topics
  await api.publish({
    title: 'Alpha Article',
    content: 'Alpha content',
    kind: 'subject',
    topic: 'alpha',
    sourceUrl: 'http://example.com/alpha',
    sourceName: 'alpha-source'
  });
  await api.publish({
    title: 'Beta Article',
    content: 'Beta content',
    kind: 'subject',
    topic: 'beta',
    sourceUrl: 'http://example.com/beta',
    sourceName: 'beta-source'
  });

  const { server, port } = await startServer({ port: 0, home });
  try {
    const res = await fetch(`http://localhost:${port}/api/v1/dashboard?topic=alpha`);
    assert.equal(res.status, 200, 'filtered status 200');
    const data = await res.json();
    assert.equal(data.filters.topic, 'alpha', 'topic filter reflected');
    assert.ok(data.list.total >= 1, 'has at least one result');
    assert.ok(data.list.articles.every((a) => a.topic === 'alpha'), 'all articles match topic filter');
  } finally {
    await stopServer(server);
    fs.rmSync(home, { recursive: true, force: true });
  }
  console.log('   ✓ Query filters are passed through');
}

console.log('4. Dashboard HTML honors title query param');
{
  const home = tmpHome();
  resetApi(home);
  await initHome(home);
  const { server, port } = await startServer({ port: 0, home });
  try {
    const res = await fetch(`http://localhost:${port}/api/v1/dashboard.html?title=Custom+Title`);
    assert.equal(res.status, 200, 'status 200');
    const html = await res.text();
    assert.ok(html.includes('<title>Custom Title</title>'), 'custom title in head');
    assert.ok(html.includes('Custom Title'), 'custom title in body');
  } finally {
    await stopServer(server);
    fs.rmSync(home, { recursive: true, force: true });
  }
  console.log('   ✓ HTML title query param works');
}

console.log('5. Unknown dashboard subroute returns 404');
{
  const home = tmpHome();
  resetApi(home);
  await initHome(home);
  const { server, port } = await startServer({ port: 0, home });
  try {
    const res = await fetch(`http://localhost:${port}/api/v1/dashboard/not-real`);
    assert.equal(res.status, 404, 'unknown subroute 404');
  } finally {
    await stopServer(server);
    fs.rmSync(home, { recursive: true, force: true });
  }
  console.log('   ✓ Unknown subroute 404s');
}

// Reset singleton state so other tests are not affected
api._home = undefined;
api._config = undefined;
api._identity = undefined;

console.log('\n✅ All serve-dashboard tests passed');
