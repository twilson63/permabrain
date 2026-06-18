/**
 * Tests for the remote event publisher (src/subscribe.mjs) and the
 * corresponding POST /api/v1/events/publish server route.
 *
 * Starts two real permabrain serve instances: a "local" node that emits
 * audit events, and a "remote" node that receives forwarded events via
 * the publisher. Verifies that local publish/attest activity shows up on the
 * remote event stream.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { WebSocket } from 'ws';
import { startServer, stopServer } from '../src/serve.mjs';
import { api } from '../src/agent-api.mjs';
import { forwardEvents, runEventPublisher } from '../src/subscribe.mjs';
import { createClient } from '../src/client.mjs';
import { subscribeEventsOverSse } from '../src/events-client.mjs';

const tmpLocal = fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-sub-local-'));
const tmpRemote = fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-sub-remote-'));
process.env.PERMABRAIN_HOME = tmpLocal;
process.env.PERMABRAIN_TRANSPORT = 'local';

let localServer;
let localPort;
let remoteServer;
let remotePort;
let remoteBaseUrl;

function httpRequest(port, method, pathName, body) {
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

console.log('1. forwardEvents exists and exposes asyncIterator + cancel + flush');
{
  const pub = forwardEvents({ baseUrl: 'http://localhost:8765', fetch: () => Promise.resolve({ ok: true }) });
  assert.equal(typeof pub[Symbol.asyncIterator], 'function', 'asyncIterator');
  assert.equal(typeof pub.cancel, 'function', 'cancel');
  assert.equal(typeof pub.flush, 'function', 'flush');
  pub.cancel();
}
console.log('   ✓ forwardEvents API present');

console.log('2. Start local and remote servers');
{
  const local = await startServer({ home: tmpLocal, port: 0 });
  localServer = local.server;
  localPort = local.port;
  const remote = await startServer({ home: tmpRemote, port: 0 });
  remoteServer = remote.server;
  remotePort = remote.port;
  remoteBaseUrl = `http://localhost:${remotePort}`;

  const localHealth = await httpRequest(localPort, 'GET', '/health');
  const remoteHealth = await httpRequest(remotePort, 'GET', '/health');
  assert.equal(localHealth.status, 200);
  assert.equal(remoteHealth.status, 200);
}
console.log(`   ✓ servers on ${localPort} and ${remotePort}`);

console.log('3. Server exposes POST /api/v1/events/publish and GET /api/v1/events/stream');
{
  const publishInfo = await httpRequest(remotePort, 'GET', '/health');
  assert.equal(publishInfo.status, 200);

  const bad = await httpRequest(remotePort, 'POST', '/api/v1/events/publish', {});
  assert.equal(bad.status, 400, 'missing events array rejected');

  const ok = await httpRequest(remotePort, 'POST', '/api/v1/events/publish', {
    events: [{ type: 'event', name: 'publish', timestamp: '2024-01-01T00:00:00Z', key: 'subject/test' }]
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.forwarded, 1);
}
console.log('   ✓ publish route validates and forwards events');

console.log('4. forwardEvents pushes local events to remote publish endpoint');
{
  // Initialize local node.
  await httpRequest(localPort, 'POST', '/api/v1/init', { home: tmpLocal, transport: 'local' });

  const remoteEvents = [];
  const sub = subscribeEventsOverSse({ baseUrl: remoteBaseUrl });
  const timer = setTimeout(() => sub.cancel(), 2000);
  const reader = (async () => {
    for await (const event of sub) {
      remoteEvents.push(event);
      if (event.type === 'event' && event.name === 'publish') break;
    }
  })();

  // Give the SSE subscriber time to connect.
  await new Promise((resolve) => setTimeout(resolve, 150));

  const fetchCalls = [];
  const pub = forwardEvents({
    baseUrl: remoteBaseUrl,
    batchMs: 0,
    fetch: (url, opts) => {
      fetchCalls.push({ url, opts });
      return globalThis.fetch(url, opts);
    }
  });

  // Trigger a local event via the local API.
  await httpRequest(localPort, 'POST', '/api/v1/articles', {
    title: 'Subscribe Test',
    content: 'Testing remote event subscription.',
    kind: 'subject',
    topic: 'subscribe-test',
    sourceUrl: 'http://example.com/subscribe-test',
    sourceName: 'subscribe-source',
    language: 'en'
  });

  // Wait for the publisher to pick up the event.
  await new Promise((resolve) => setTimeout(resolve, 300));
  await pub.flush();

  await reader;
  clearTimeout(timer);
  pub.cancel();

  assert.ok(fetchCalls.length >= 1, 'publisher called remote endpoint');
  assert.ok(fetchCalls[0].url.includes('/api/v1/events/publish'), 'calls publish endpoint');
  const publishEvent = remoteEvents.find((e) => e.type === 'event' && e.name === 'publish');
  assert.ok(publishEvent, 'remote received publish event');
}
console.log('   ✓ publisher forwarded local publish event to remote');

console.log('5. forwardEvents filters by event name');
{
  const fetchCalls = [];
  const pub = forwardEvents({
    baseUrl: remoteBaseUrl,
    events: 'attest',
    batchMs: 0,
    fetch: (url, opts) => {
      fetchCalls.push({ url, opts });
      return globalThis.fetch(url, opts);
    }
  });

  // Trigger a publish event; it should be ignored.
  await httpRequest(localPort, 'POST', '/api/v1/articles', {
    title: 'Filter Test',
    content: 'Should be filtered out.',
    kind: 'subject',
    topic: 'subscribe-filter',
    sourceUrl: 'http://example.com/filter',
    sourceName: 'filter-source',
    language: 'en'
  });

  await new Promise((resolve) => setTimeout(resolve, 300));
  await pub.flush();
  pub.cancel();

  const bodies = fetchCalls.map((c) => JSON.parse(c.opts.body));
  const hasPublish = bodies.some((b) => b.events?.some((e) => e.name === 'publish'));
  assert.equal(hasPublish, false, 'filtered publish event not forwarded');
}
console.log('   ✓ event filter works');

console.log('6. runEventPublisher returns forwarded/error counts');
{
  await api.init({ home: tmpLocal, transport: 'local' });
  // Pre-trigger a publish event so runEventPublisher exits quickly via maxEvents.
  await httpRequest(localPort, 'POST', '/api/v1/articles', {
    title: 'Publisher Count Test',
    content: 'Triggering a publish for runEventPublisher count.',
    kind: 'subject',
    topic: 'subscribe-count',
    sourceUrl: 'http://example.com/count',
    sourceName: 'count-source',
    language: 'en'
  });
  await new Promise((resolve) => setTimeout(resolve, 200));
  const result = await runEventPublisher({ baseUrl: remoteBaseUrl, batchMs: 0, maxEvents: 1, verbose: false });
  assert.ok(Number.isFinite(result.forwarded), 'forwarded count is numeric');
  assert.ok(Number.isFinite(result.errors), 'errors count is numeric');
}
console.log('   ✓ runEventPublisher runs and returns counts');

console.log('7. SDK client.publishEvents() sends events to remote');
{
  const client = createClient({ baseUrl: remoteBaseUrl });
  const result = await client.publishEvents([
    { type: 'event', name: 'fork', timestamp: '2024-01-01T00:00:00Z', key: 'subject/sdk' }
  ]);
  assert.equal(result.forwarded, 1);
}
console.log('   ✓ client.publishEvents works');

console.log('8. api.subscribe() exists and returns a publisher');
{
  const pub = await api.subscribe({ baseUrl: remoteBaseUrl, events: 'publish', batchMs: 0 });
  assert.equal(typeof pub[Symbol.asyncIterator], 'function');
  assert.equal(typeof pub.cancel, 'function');
  pub.cancel();
}
console.log('   ✓ api.subscribe works');

await stopServer(localServer);
await stopServer(remoteServer);
api._home = undefined;
api._identity = undefined;
api._config = undefined;
fs.rmSync(tmpLocal, { recursive: true, force: true });
fs.rmSync(tmpRemote, { recursive: true, force: true });

console.log('\n✅ All subscribe tests passed');
