import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { WebSocket } from 'ws';
import { startServer, stopServer } from '../src/serve.mjs';
import { api } from '../src/agent-api.mjs';

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-serve-events-'));
process.env.PERMABRAIN_HOME = tmpHome;
process.env.PERMABRAIN_TRANSPORT = 'local';

let server;
let port;

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

function connectWebSocket() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}/api/v1/events/ws`);
    const messages = [];
    ws.on('open', () => resolve({ ws, messages }));
    ws.on('message', (data) => messages.push(JSON.parse(data.toString())));
    ws.on('error', reject);
  });
}

console.log('1. startServer exposes stream URLs in /health');
const started = await startServer({ home: tmpHome, port: 0 });
server = started.server;
port = started.port;
const health = await httpRequest('GET', '/health');
assert.equal(health.status, 200);
assert.equal(health.body.streamTransport, 'sse', 'default stream transport is sse');
assert.equal(health.body.streams?.articles?.default, 'sse', 'default articles stream is sse');
assert.equal(health.body.streams?.websocket, '/api/v1/events/ws');
assert.equal(health.body.streams?.sse, '/api/v1/events/stream');
console.log('   ✓ /health advertises stream endpoints');

console.log('2. WebSocket upgrade receives open message');
const init = await httpRequest('POST', '/api/v1/init', { home: tmpHome, transport: 'local' });
assert.equal(init.status, 200);
const wsConn = await connectWebSocket();
await new Promise((resolve) => setTimeout(resolve, 200));
assert.ok(wsConn.messages.length >= 1, 'received at least open message');
assert.equal(wsConn.messages[0].type, 'open');
console.log('   ✓ WebSocket connection established');

console.log('3. Publishing an article emits a publish event over WebSocket');
const beforeCount = wsConn.messages.length;
const article = await httpRequest('POST', '/api/v1/articles', {
  title: 'Stream Test',
  content: 'Real-time event stream test article',
  kind: 'subject',
  topic: 'events-test',
  sourceUrl: 'http://example.com/stream-test',
  sourceName: 'stream-source',
  language: 'en'
});
assert.equal(article.status, 201);
await new Promise((resolve) => setTimeout(resolve, 300));
const afterCount = wsConn.messages.length;
assert.ok(afterCount > beforeCount, 'received an event after publish');
const publishEvent = wsConn.messages.slice(beforeCount).find((m) => m.type === 'event' && m.name === 'publish');
assert.ok(publishEvent, 'publish event found');
assert.equal(publishEvent.key, article.body.summary.key);
console.log('   ✓ publish event broadcast over WebSocket');

console.log('4. Attesting emits an attest event over WebSocket');
const attestBefore = wsConn.messages.length;
const key = article.body.summary.key;
const attest = await httpRequest('POST', `/api/v1/articles/${encodeURIComponent(key)}/attest`, {
  opinion: 'valid',
  confidence: 0.85,
  reason: 'Looks good via stream.'
});
assert.equal(attest.status, 201);
await new Promise((resolve) => setTimeout(resolve, 300));
const attestEvent = wsConn.messages.slice(attestBefore).find((m) => m.type === 'event' && m.name === 'attest');
assert.ok(attestEvent, 'attest event found');
assert.equal(attestEvent.key, key);
console.log('   ✓ attest event broadcast over WebSocket');

console.log('5. SSE endpoint streams events');
const sseEvents = [];
const sseReq = await new Promise((resolve, reject) => {
  const req = http.request({ hostname: 'localhost', port, method: 'GET', path: '/api/v1/events/stream' }, (res) => {
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['content-type'], 'text/event-stream');
    res.on('data', (chunk) => {
      const text = chunk.toString();
      for (const line of text.split('\n')) {
        if (line.startsWith('data: ')) {
          try { sseEvents.push(JSON.parse(line.slice(6))); } catch {}
        }
      }
    });
    resolve(req);
  });
  req.on('error', reject);
  req.end();
});

// Allow time to receive open + any published events.
await new Promise((resolve) => setTimeout(resolve, 600));
sseReq.destroy();
assert.ok(sseEvents.length >= 1, 'SSE received at least open event');
assert.equal(sseEvents[0].type, 'open');
console.log('   ✓ SSE endpoint streams open + events');

wsConn.ws.close();
await stopServer(server);

api._home = undefined;
api._identity = undefined;
api._config = undefined;
fs.rmSync(tmpHome, { recursive: true, force: true });

console.log('\n✅ All serve-events tests passed');
