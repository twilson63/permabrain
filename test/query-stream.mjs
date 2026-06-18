/**
 * Test: Query stream (src/query-stream.mjs)
 *
 * Covers local subscribeQuery() filters, matchesQueryStream helper,
 * the SSE HTTP route, client.subscribeQuery(), api.subscribeQuery(), and
 * the CLI query-stream help/JSON output.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  subscribeQuery,
  matchesQueryStream
} from '../src/query-stream.mjs';
import { getEventBus, emitEvent } from '../src/events.mjs';
import { startServer, stopServer } from '../src/serve.mjs';
import { createClient } from '../src/client.mjs';
import { api } from '../src/agent-api.mjs';

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-query-stream-'));
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

console.log('1. matchesQueryStream helper');
{
  const publishEvent = {
    type: 'event',
    name: 'publish',
    timestamp: '2024-01-01T00:00:00Z',
    topic: 'ai',
    kind: 'subject',
    key: 'subject/neural-nets',
    agentId: 'ed25519:alice',
    title: 'Neural Nets'
  };
  assert.equal(matchesQueryStream(publishEvent, {}), true, 'no filters match');
  assert.equal(matchesQueryStream(publishEvent, { topic: 'ai' }), true, 'topic match');
  assert.equal(matchesQueryStream(publishEvent, { topic: 'biology' }), false, 'topic mismatch');
  assert.equal(matchesQueryStream(publishEvent, { kind: 'subject' }), true, 'kind match');
  assert.equal(matchesQueryStream(publishEvent, { kind: 'person' }), false, 'kind mismatch');
  assert.equal(matchesQueryStream(publishEvent, { agent: 'ed25519:alice' }), true, 'agent match');
  assert.equal(matchesQueryStream(publishEvent, { agent: 'ed25519:bob' }), false, 'agent mismatch');
  assert.equal(matchesQueryStream(publishEvent, { key: 'subject/neural-nets' }), true, 'key match');
  assert.equal(matchesQueryStream(publishEvent, { key: 'subject/other' }), false, 'key mismatch');
  assert.equal(matchesQueryStream(publishEvent, { events: 'publish' }), true, 'events whitelist match');
  assert.equal(matchesQueryStream(publishEvent, { events: 'attest' }), false, 'events whitelist mismatch');

  const attestEvent = {
    type: 'event',
    name: 'attest',
    timestamp: '2024-01-01T00:00:00Z',
    targetKey: 'subject/neural-nets',
    'Attestation-Agent-Id': 'ed25519:bob'
  };
  assert.equal(matchesQueryStream(attestEvent, { key: 'subject/neural-nets' }), true, 'attestation target key match');
  assert.equal(matchesQueryStream(attestEvent, { agent: 'ed25519:bob' }), true, 'attestation agent match');
  assert.equal(matchesQueryStream(attestEvent, { agent: 'ed25519:alice' }), false, 'attestation agent mismatch');
}
console.log('   ✓ matchesQueryStream filters work');

console.log('2. Local subscribeQuery filters events');
{
  const bus = getEventBus();
  const collected = [];
  const sub = subscribeQuery({ topic: 'ai', events: 'publish' });
  const timer = setTimeout(() => sub.cancel(), 1500);

  // Emit matching and non-matching events.
  emitEvent('publish', { topic: 'ai', kind: 'subject', key: 'subject/neural-nets', agentId: 'ed25519:alice' });
  emitEvent('publish', { topic: 'biology', kind: 'subject', key: 'subject/cells', agentId: 'ed25519:bob' });
  emitEvent('attest', { topic: 'ai', kind: 'subject', key: 'subject/neural-nets', agentId: 'ed25519:bob' });

  for await (const event of sub) {
    collected.push(event);
    if (collected.length >= 1) sub.cancel();
  }
  clearTimeout(timer);
  assert.equal(collected.length, 1, 'received exactly one matching event');
  assert.equal(collected[0].name, 'publish');
  assert.equal(collected[0].topic, 'ai');
}
console.log('   ✓ local subscribeQuery filters by topic/events');

console.log('3. HTTP GET /api/v1/articles/stream is SSE');
{
  const started = await startServer({ home: tmpHome, port: 0 });
  server = started.server;
  port = started.port;
  baseUrl = `http://localhost:${port}`;

  await httpRequest('POST', '/api/v1/init', { home: tmpHome, transport: 'local' });

  await new Promise((resolve, reject) => {
    const req = http.request({ hostname: 'localhost', port, method: 'GET', path: '/api/v1/articles/stream?topic=ai&events=publish', headers: { accept: 'text/event-stream' } }, (res) => {
      try {
        assert.equal(res.statusCode, 200);
        assert.equal(res.headers['content-type'], 'text/event-stream');
        let buffer = '';
        let sawOpen = false;
        res.on('data', (chunk) => {
          buffer += chunk;
          if (buffer.includes('\n\n')) {
            const raw = buffer.split('\n\n')[0];
            const data = raw.replace(/^data: /, '');
            const event = JSON.parse(data);
            if (event.type === 'open') sawOpen = true;
          }
          if (sawOpen) {
            req.destroy();
            resolve();
          }
        });
        res.on('end', () => { if (sawOpen) resolve(); else reject(new Error('no open event')); });
      } catch (err) { reject(err); }
    });
    req.on('error', reject);
    req.end();
  });
}
console.log('   ✓ SSE stream route opens');

console.log('4. SSE route receives filtered article events');
{
  const events = [];
  const controller = new AbortController();
  const req = http.request({ hostname: 'localhost', port, method: 'GET', path: '/api/v1/articles/stream?topic=ai&events=publish', headers: { accept: 'text/event-stream' } }, (res) => {
    let buffer = '';
    let done = false;
    res.on('data', async (chunk) => {
      if (done) return;
      buffer += chunk;
      const parts = buffer.split('\n\n');
      buffer = parts.pop();
      for (const raw of parts) {
        const data = raw.replace(/^data: /, '');
        try {
          const event = JSON.parse(data);
          if (event.type !== 'open') events.push(event);
          if (event.type === 'event' && event.name === 'publish') {
            done = true;
            controller.abort();
            req.destroy();
          }
        } catch {}
      }
    });
  });
  req.end();

  // Publish after a short delay so the subscription is established.
  setTimeout(async () => {
    await httpRequest('POST', '/api/v1/articles', {
      title: 'Query Stream Article',
      content: 'Testing query stream SSE.',
      kind: 'subject',
      topic: 'ai',
      sourceUrl: 'http://example.com/query-stream',
      sourceName: 'query-stream-source',
      language: 'en'
    });
  }, 200);

  await new Promise((resolve) => {
    controller.signal.addEventListener('abort', resolve, { once: true });
    setTimeout(() => { controller.abort(); resolve(); }, 3000);
  });
  req.destroy();

  const publishEvent = events.find((e) => e.type === 'event' && e.name === 'publish');
  assert.ok(publishEvent, 'SSE received a publish event');
  assert.equal(publishEvent.topic, 'ai');
}
console.log('   ✓ SSE route streams filtered publish events');

console.log('5. client.subscribeQuery is exported');
{
  const client = createClient({ baseUrl });
  assert.equal(typeof client.subscribeQuery, 'function', 'client.subscribeQuery is a function');
}
console.log('   ✓ client.subscribeQuery exists');

console.log('6. api.subscribeQuery wrapper returns async iterator');
{
  await api.init({ home: tmpHome, transport: 'local' });
  const sub = api.subscribeQuery({ topic: 'ai', events: 'publish' });
  assert.ok(sub[Symbol.asyncIterator], 'subscribeQuery is async iterable');
  assert.equal(typeof sub.cancel, 'function', 'subscribeQuery has cancel');
  sub.cancel();
  api._home = undefined;
  api._identity = undefined;
  api._config = undefined;
}
console.log('   ✓ api.subscribeQuery returns async iterator');

console.log('7. CLI query-stream --help');
{
  const cliPath = fileURLToPath(new URL('../scripts/cli.mjs', import.meta.url));
  const child = spawn(process.execPath, [cliPath, 'query-stream', 'help'], { env: { ...process.env, PERMABRAIN_HOME: tmpHome } });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stderr += d; });
  await new Promise((resolve) => child.on('close', resolve));
  const out = stdout + stderr;
  assert.ok(out.includes('query-stream'), 'help mentions query-stream');
  assert.ok(out.includes('--topic'), 'help mentions --topic');
  assert.ok(out.includes('--events'), 'help mentions --events');
}
console.log('   ✓ CLI query-stream help works');

await stopServer(server);
fs.rmSync(tmpHome, { recursive: true, force: true });

console.log('\n✅ All query-stream tests passed');
