/**
 * Tests for the remote event subscriber (src/events-client.mjs).
 *
 * Starts a real permabrain serve instance and subscribes via SSE and
 * WebSocket using the events-client helpers.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {
  subscribeEventsOverSse,
  subscribeEventsOverWebSocket,
  subscribeEventsRemote,
  formatEvent,
  runEventsSubscriber
} from '../src/events-client.mjs';
import { startServer, stopServer } from '../src/serve.mjs';
import { api } from '../src/agent-api.mjs';

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-events-client-'));
process.env.PERMABRAIN_HOME = tmpHome;
process.env.PERMABRAIN_TRANSPORT = 'local';

let server;
let port;
let baseUrl;

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

console.log('1. formatEvent renders compact and JSON output');
{
  const event = { type: 'event', name: 'publish', timestamp: '2024-01-01T00:00:00Z', key: 'subject/ai', title: 'AI', agentId: 'ed25519:a' };
  const compact = formatEvent(event, 'compact');
  assert.ok(compact.includes('publish'), 'compact includes event name');
  assert.ok(compact.includes('subject/ai'), 'compact includes key');
  assert.equal(formatEvent(event, 'json'), JSON.stringify(event));
  assert.equal(formatEvent({ type: 'heartbeat', timestamp: '2024-01-01T00:00:00Z' }, 'compact'), '[heartbeat 2024-01-01T00:00:00Z]');
}
console.log('   ✓ formatEvent works');

console.log('2. startServer advertises event stream URLs');
{
  const started = await startServer({ home: tmpHome, port: 0 });
  server = started.server;
  port = started.port;
  baseUrl = `http://localhost:${port}`;
  const health = await httpRequest('GET', '/health');
  assert.equal(health.status, 200);
  assert.equal(health.body.streams?.websocket, '/api/v1/events/ws');
  assert.equal(health.body.streams?.sse, '/api/v1/events/stream');
}
console.log('   ✓ /health advertises stream endpoints');

console.log('3. SSE subscriber receives open message');
{
  const events = [];
  const sub = subscribeEventsOverSse({ baseUrl });
  const timer = setTimeout(() => sub.cancel(), 1500);
  for await (const event of sub) {
    events.push(event);
    if (event.type === 'open') break;
  }
  clearTimeout(timer);
  const openEvent = events.find((e) => e.type === 'open');
  assert.ok(openEvent, 'SSE received open event');
}
console.log('   ✓ SSE subscriber received open');

console.log('4. WebSocket subscriber receives open and publish events');
{
  await httpRequest('POST', '/api/v1/init', { home: tmpHome, transport: 'local' });
  const events = [];
  const sub = subscribeEventsOverWebSocket({ baseUrl });
  const timer = setTimeout(() => sub.cancel(), 2000);
  // Publish an article after a short delay so the subscription is open.
  setTimeout(async () => {
    await httpRequest('POST', '/api/v1/articles', {
      title: 'Events Client Test',
      content: 'Testing remote event subscriber.',
      kind: 'subject',
      topic: 'events-client-test',
      sourceUrl: 'http://example.com/events-client',
      sourceName: 'events-client-source',
      language: 'en'
    });
  }, 200);

  for await (const event of sub) {
    events.push(event);
    if (events.length >= 2 && events.some((e) => e.type === 'event' && e.name === 'publish')) break;
  }
  clearTimeout(timer);
  assert.ok(events.find((e) => e.type === 'open'), 'WS received open event');
  const publishEvent = events.find((e) => e.type === 'event' && e.name === 'publish');
  assert.ok(publishEvent, 'WS received publish event');
  assert.equal(publishEvent.name, 'publish');
}
console.log('   ✓ WebSocket subscriber received publish event');

console.log('5. subscribeEventsRemote defaults to SSE');
{
  const events = [];
  const sub = subscribeEventsRemote({ baseUrl });
  const timer = setTimeout(() => sub.cancel(), 1000);
  for await (const event of sub) {
    events.push(event);
    if (event.type === 'open') break;
  }
  clearTimeout(timer);
  assert.ok(events.find((e) => e.type === 'open'), 'default remote subscriber works');
}
console.log('   ✓ subscribeEventsRemote defaults to SSE');

console.log('6. runEventsSubscriber honors --count limit');
{
  const result = await runEventsSubscriber({ baseUrl, transport: 'sse', maxEvents: 1, maxMs: 3000 });
  assert.ok(Number.isFinite(result.count), 'subscriber returned count');
  assert.equal(result.transport, 'sse');
}
console.log('   ✓ runEventsSubscriber works');

console.log('7. API exposes subscribeEventsRemote without requiring local init');
{
  const sub = await api.subscribeEventsRemote({ baseUrl, transport: 'sse' });
  let sawOpen = false;
  const timer = setTimeout(() => sub.cancel(), 1000);
  for await (const event of sub) {
    if (event.type === 'open') { sawOpen = true; break; }
  }
  clearTimeout(timer);
  assert.ok(sawOpen, 'api.subscribeEventsRemote works');
}
console.log('   ✓ api.subscribeEventsRemote works');

await stopServer(server);
api._home = undefined;
api._identity = undefined;
api._config = undefined;
fs.rmSync(tmpHome, { recursive: true, force: true });

console.log('\n✅ All events-client tests passed');
