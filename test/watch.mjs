/**
 * Watch command tests — poll local transport for new articles and attestations.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { api } from '../src/agent-api.mjs';
import { initState } from '../src/config.mjs';
import { pollOnce, watchOnce } from '../src/watch.mjs';
import { LocalTransport } from '../src/transport.mjs';

function makeTempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-watch-'));
}

async function resetApi(home) {
  api._home = null;
  api._identity = null;
  api._config = null;
  process.env.PERMABRAIN_HOME = home;
  initState({ env: { ...process.env, PERMABRAIN_HOME: home, PERMABRAIN_TRANSPORT: 'local' } });
  await api.init({ transport: 'local' });
}

async function publishSample(home, { key, topic = 'ai', title = 'Sample' } = {}) {
  await resetApi(home);
  const result = await api.publish({
    content: `# ${title}\n\nSome content for ${key || topic}.`,
    kind: 'subject',
    topic,
    sourceUrl: 'https://example.com/' + (key || topic),
    title,
    key: key || `${topic}/${title.toLowerCase().replace(/\s+/g, '-')}`,
  });
  return result;
}

async function attestSample(home, key, { reason = 'Looks good' } = {}) {
  await resetApi(home);
  return api.attest(key, {
    opinion: 'valid',
    confidence: 0.9,
    reason,
  });
}

// --- pollOnce discovers articles on first run and records them as seen ---
{
  const home = makeTempHome();
  await publishSample(home, { key: 'subject/first', title: 'First' });
  const config = api._config;
  const transport = new LocalTransport(home);
  const state = { articleIds: [], attestationIds: [], lastRun: null };
  const result = await pollOnce({ config, transport, state, filters: {} });
  assert.equal(result.articles.length, 1);
  assert.equal(result.articles[0].key, 'subject/first');
  assert.equal(result.attestations.length, 0);
  assert.ok(state.articleIds.includes(result.articles[0].id));
  fs.rmSync(home, { recursive: true, force: true });
}

// --- watchOnce sees existing articles as new on first invocation, then only deltas ---
{
  const home = makeTempHome();
  await publishSample(home, { key: 'subject/seed', title: 'Seed' });
  const events1 = [];
  await watchOnce({ home, transport: new LocalTransport(home), onEvent: (e) => events1.push(e) });
  const articleEvents1 = events1.filter((e) => e.type === 'article');
  assert.equal(articleEvents1.length, 1, 'first watch should report existing article as new');
  assert.equal(articleEvents1[0].key, 'subject/seed');

  await publishSample(home, { key: 'subject/new', title: 'New' });
  const events2 = [];
  await watchOnce({ home, transport: new LocalTransport(home), onEvent: (e) => events2.push(e) });
  const articleEvents2 = events2.filter((e) => e.type === 'article');
  assert.equal(articleEvents2.length, 1, 'second watch should only report the new article');
  assert.equal(articleEvents2[0].key, 'subject/new');

  fs.rmSync(home, { recursive: true, force: true });
}

// --- watchOnce discovers new attestations incrementally ---
{
  const home = makeTempHome();
  await publishSample(home, { key: 'subject/to-attest', title: 'To Attest' });
  await attestSample(home, 'subject/to-attest', { reason: 'First attestation' });

  const events1 = [];
  await watchOnce({ home, transport: new LocalTransport(home), onEvent: (e) => events1.push(e) });
  const attestationEvents1 = events1.filter((e) => e.type === 'attestation');
  assert.equal(attestationEvents1.length, 1, 'first watch should report existing attestation as new');

  await attestSample(home, 'subject/to-attest', { reason: 'Second attestation' });
  const events2 = [];
  await watchOnce({ home, transport: new LocalTransport(home), onEvent: (e) => events2.push(e) });
  const attestationEvents2 = events2.filter((e) => e.type === 'attestation');
  assert.equal(attestationEvents2.length, 1, 'second watch should only report the new attestation');
  assert.equal(attestationEvents2[0].targetKey, 'subject/to-attest');

  fs.rmSync(home, { recursive: true, force: true });
}

// --- topic filter only reports matching articles ---
{
  const home = makeTempHome();
  await publishSample(home, { key: 'subject/ai-article', title: 'AI Article', topic: 'ai' });
  await publishSample(home, { key: 'subject/crypto-article', title: 'Crypto Article', topic: 'crypto' });

  const events = [];
  await watchOnce({ home, transport: new LocalTransport(home), topic: 'ai', onEvent: (e) => events.push(e) });
  const articleEvents = events.filter((e) => e.type === 'article');
  assert.equal(articleEvents.length, 1);
  assert.equal(articleEvents[0].topic, 'ai');

  fs.rmSync(home, { recursive: true, force: true });
}

// --- key filter applies to both articles and attestations ---
{
  const home = makeTempHome();
  await publishSample(home, { key: 'subject/filtered', title: 'Filtered' });
  await publishSample(home, { key: 'subject/other', title: 'Other' });
  await attestSample(home, 'subject/filtered');

  const events = [];
  await watchOnce({ home, transport: new LocalTransport(home), key: 'subject/filtered', onEvent: (e) => events.push(e) });
  const articleEvents = events.filter((e) => e.type === 'article');
  const attestationEvents = events.filter((e) => e.type === 'attestation');
  assert.equal(articleEvents.length, 1);
  assert.equal(articleEvents[0].key, 'subject/filtered');
  assert.equal(attestationEvents.length, 1);
  assert.equal(attestationEvents[0].targetKey, 'subject/filtered');

  fs.rmSync(home, { recursive: true, force: true });
}

console.log('watch tests passed');
