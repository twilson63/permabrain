/**
 * Viewer live updates test
 *
 * Verifies that the web viewer is wired for live SSE updates from
 * /api/v1/articles/stream and that the server pushes publish/attest
 * events over that stream. The viewer JavaScript re-subscribes when
 * topic filters change, debounces refreshes, and updates the modal
 * data for the currently selected article.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { startServer, stopServer } from '../src/serve.mjs';
import { api } from '../src/agent-api.mjs';
import { initState } from '../src/config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const viewerPath = path.resolve(__dirname, '..', 'viewer', 'index.html');

function makeTempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-viewer-live-'));
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

function httpRequest(method, pathName, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost',
      port,
      method,
      path: pathName,
      headers: body ? { 'content-type': 'application/json' } : {}
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: data ? JSON.parse(data) : {}, raw: data }); }
        catch { resolve({ status: res.statusCode, body: data, raw: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

let server;
let port;

// --- viewer/index.html contains live update wiring ---
{
  const html = fs.readFileSync(viewerPath, 'utf8');
  assert.ok(html.includes('/api/v1/articles/stream'), 'viewer should reference query-stream SSE endpoint');
  assert.ok(html.includes('EventSource'), 'viewer should use EventSource for SSE');
  assert.ok(html.includes('startLiveStream'), 'viewer should expose startLiveStream');
  assert.ok(html.includes('stopLiveStream'), 'viewer should expose stopLiveStream');
  assert.ok(html.includes('handleStreamEvent'), 'viewer should handle stream events');
  assert.ok(html.includes('liveIndicator'), 'viewer should have live indicator element');
  assert.ok(html.includes('scheduleListRefresh'), 'viewer should schedule list refresh on events');
  assert.ok(html.includes('refreshModalData'), 'viewer should refresh modal data on live events');
  assert.ok(html.includes('@keyframes pulse'), 'viewer should include pulse animation for live indicator');
}

// --- SSE stream receives publish events ---
{
  const home = makeTempHome();
  await resetApi(home);

  const { server: srv, port: p } = await startServer({ port: 0, home });
  server = srv;
  port = p;

  await httpRequest('POST', '/api/v1/init', { home, transport: 'local' });

  const events = [];
  const controller = new AbortController();
  const req = http.request({
    hostname: 'localhost',
    port,
    method: 'GET',
    path: '/api/v1/articles/stream?events=publish,attest',
    headers: { accept: 'text/event-stream' }
  }, (res) => {
    let buffer = '';
    let done = false;
    res.on('data', (chunk) => {
      if (done) return;
      buffer += chunk;
      const parts = buffer.split('\n\n');
      buffer = parts.pop();
      for (const raw of parts) {
        const data = raw.replace(/^data: /, '');
        try {
          const event = JSON.parse(data);
          if (event.type !== 'open') events.push(event);
          if (event.type === 'event' && event.name === 'attest') {
            done = true;
            controller.abort();
            req.destroy();
          }
        } catch {}
      }
    });
  });
  req.end();

  setTimeout(async () => {
    await httpRequest('POST', '/api/v1/articles', {
      title: 'Live Update Article',
      content: '# Live Update\n\nInitial content.',
      kind: 'subject',
      topic: 'viewer-live',
      sourceUrl: 'http://example.com/live',
      sourceName: 'live-source',
      language: 'en',
      key: 'subject/viewer-live'
    });
    await httpRequest('POST', '/api/v1/articles/' + encodeURIComponent('subject/viewer-live') + '/attest', {
      opinion: 'valid',
      confidence: 0.85,
      reason: 'live test'
    });
  }, 200);

  await new Promise((resolve) => {
    controller.signal.addEventListener('abort', resolve, { once: true });
    setTimeout(() => { controller.abort(); resolve(); }, 5000);
  });
  req.destroy();

  const publishEvent = events.find((e) => e.type === 'event' && e.name === 'publish');
  const attestEvent = events.find((e) => e.type === 'event' && e.name === 'attest');
  assert.ok(publishEvent, 'SSE should receive publish event');
  assert.equal(publishEvent.key, 'subject/viewer-live');
  assert.equal(publishEvent.topic, 'viewer-live');
  assert.ok(attestEvent, 'SSE should receive attest event');
  assert.equal(attestEvent.key, 'subject/viewer-live');

  await stopServer(server);
  fs.rmSync(home, { recursive: true, force: true });
}

// --- SSE stream filters by topic ---
{
  const home = makeTempHome();
  await resetApi(home);

  const { server: srv, port: p } = await startServer({ port: 0, home });
  server = srv;
  port = p;

  await httpRequest('POST', '/api/v1/init', { home, transport: 'local' });

  const events = [];
  const controller = new AbortController();
  const req = http.request({
    hostname: 'localhost',
    port,
    method: 'GET',
    path: '/api/v1/articles/stream?topic=matching-topic&events=publish',
    headers: { accept: 'text/event-stream' }
  }, (res) => {
    let buffer = '';
    let done = false;
    res.on('data', (chunk) => {
      if (done) return;
      buffer += chunk;
      const parts = buffer.split('\n\n');
      buffer = parts.pop();
      for (const raw of parts) {
        const data = raw.replace(/^data: /, '');
        try {
          const event = JSON.parse(data);
          if (event.type !== 'open') events.push(event);
          if (event.type === 'event' && event.name === 'publish' && event.topic === 'matching-topic') {
            done = true;
            controller.abort();
            req.destroy();
          }
        } catch {}
      }
    });
  });
  req.end();

  setTimeout(async () => {
    await httpRequest('POST', '/api/v1/articles', {
      title: 'Filtered Out',
      content: 'Should not be received.',
      kind: 'subject',
      topic: 'other-topic',
      sourceUrl: 'http://example.com/other',
      sourceName: 'other-source',
      language: 'en',
      key: 'subject/other-topic'
    });
    await httpRequest('POST', '/api/v1/articles', {
      title: 'Filtered In',
      content: 'Should be received.',
      kind: 'subject',
      topic: 'matching-topic',
      sourceUrl: 'http://example.com/matching',
      sourceName: 'matching-source',
      language: 'en',
      key: 'subject/matching-topic'
    });
  }, 200);

  await new Promise((resolve) => {
    controller.signal.addEventListener('abort', resolve, { once: true });
    setTimeout(() => { controller.abort(); resolve(); }, 5000);
  });
  req.destroy();

  assert.equal(events.filter((e) => e.type === 'event' && e.name === 'publish').length, 1, 'only matching topic event received');
  assert.equal(events[events.length - 1].topic, 'matching-topic');

  await stopServer(server);
  fs.rmSync(home, { recursive: true, force: true });
}

console.log('viewer-live tests passed');
