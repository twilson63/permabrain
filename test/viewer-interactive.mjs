/**
 * Viewer interactive local filter + modal integration tests.
 *
 * Verifies that the static viewer HTML includes interactive controls
 * (topic dropdown, date filters, author filter, sort buttons, article modal)
 * and that the local HTTP API's /api/v1/list route supports filtering,
 * sorting, and paging. Also verifies /api/v1/articles/:key returns a
 * single article and the sub-routes /history and /consensus exist.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, stopServer } from '../src/serve.mjs';
import { api } from '../src/agent-api.mjs';
import { initState } from '../src/config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const viewerPath = path.resolve(__dirname, '..', 'viewer', 'index.html');

function makeTempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-viewer-interactive-'));
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

// --- viewer/index.html contains the new interactive controls ---
{
  const html = fs.readFileSync(viewerPath, 'utf8');
  assert.ok(html.includes('id="filterPanel"'), 'viewer should have filter panel');
  assert.ok(html.includes('id="topicSelect"'), 'viewer should have topic select');
  assert.ok(html.includes('id="filterAfter"'), 'viewer should have after date filter');
  assert.ok(html.includes('id="filterBefore"'), 'viewer should have before date filter');
  assert.ok(html.includes('id="filterAuthor"'), 'viewer should have author filter');
  assert.ok(html.includes('id="articleModal"'), 'viewer should have article modal');
  assert.ok(html.includes('window.openArticleModal'), 'viewer should expose openArticleModal');
  assert.ok(html.includes('window.closeModal'), 'viewer should expose closeModal');
  assert.ok(html.includes('window.applyFilters'), 'viewer should expose applyFilters');
  assert.ok(html.includes('window.resetFilters'), 'viewer should expose resetFilters');
  assert.ok(html.includes('/api/v1/list'), 'viewer should call /api/v1/list');
  assert.ok(html.includes('/api/v1/articles/'), 'viewer should call /api/v1/articles/:key');
}

// --- local API list, filters, sort, and detail routes work ---
{
  const home = makeTempHome();
  await resetApi(home);

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isoDay = (d) => d.toISOString().slice(0, 10);

  const p1 = await api.publish({
    content: '# Interactive article A\n\nFirst.',
    kind: 'subject',
    topic: 'viewer-interactive-a',
    sourceUrl: 'https://example.com/a',
    title: 'Interactive A',
    key: 'subject/viewer-interactive-a'
  });
  const p2 = await api.publish({
    content: '# Interactive article B\n\nSecond.',
    kind: 'subject',
    topic: 'viewer-interactive-b',
    sourceUrl: 'https://example.com/b',
    title: 'Interactive B',
    key: 'subject/viewer-interactive-b'
  });

  await api.attest('subject/viewer-interactive-a', {
    opinion: 'valid',
    confidence: 0.9,
    reason: 'looks good'
  });

  const agentId = api._identity.agentId;

  const { server, port } = await startServer({ port: 0, home });
  try {
    // Full list
    const listAll = await fetch(`http://127.0.0.1:${port}/api/v1/list?limit=100`);
    assert.equal(listAll.status, 200, 'list should return 200');
    const all = await listAll.json();
    assert.equal(all.total, 2, 'list should include two articles');
    assert.equal(all.articles.length, 2, 'list page should have two rows');
    assert.ok(all.articles.every((a) => a.key && a.title), 'rows should have key and title');

    // Topic filter
    const listTopic = await fetch(`http://127.0.0.1:${port}/api/v1/list?topic=viewer-interactive-a`);
    assert.equal(listTopic.status, 200);
    const topicData = await listTopic.json();
    assert.equal(topicData.total, 1, 'topic filter should return one article');
    assert.equal(topicData.articles[0].key, 'subject/viewer-interactive-a');

    // Author filter
    const listAuthor = await fetch(`http://127.0.0.1:${port}/api/v1/list?author=${encodeURIComponent(agentId)}`);
    assert.equal(listAuthor.status, 200);
    const authorData = await listAuthor.json();
    assert.equal(authorData.total, 2, 'author filter should match both articles');

    // Sort by title
    const listTitle = await fetch(`http://127.0.0.1:${port}/api/v1/list?sort=title`);
    assert.equal(listTitle.status, 200);
    const titleData = await listTitle.json();
    assert.equal(titleData.articles[0].key, 'subject/viewer-interactive-a', 'title sort should put A first');

    // Sort by consensus
    const listScore = await fetch(`http://127.0.0.1:${port}/api/v1/list?sort=consensus`);
    assert.equal(listScore.status, 200);
    const scoreData = await listScore.json();
    assert.ok(typeof scoreData.articles[0].consensus.score === 'number', 'consensus sort should include scores');

    // Date filter (after/before using the published day)
    const todayIso = isoDay(new Date());
    const listAfter = await fetch(`http://127.0.0.1:${port}/api/v1/list?after=${todayIso}T00:00:00.000Z`);
    assert.equal(listAfter.status, 200);
    const afterData = await listAfter.json();
    assert.equal(afterData.total, 2, 'after filter today should match both');

    const listRange = await fetch(`http://127.0.0.1:${port}/api/v1/list?after=${isoDay(yesterday)}T00:00:00.000Z&before=${isoDay(tomorrow)}T23:59:59.999Z`);
    assert.equal(listRange.status, 200);
    const rangeData = await listRange.json();
    assert.equal(rangeData.total, 2, 'date range should match both');

    // Article detail
    const detail = await fetch(`http://127.0.0.1:${port}/api/v1/articles/${encodeURIComponent('subject/viewer-interactive-a')}`);
    assert.equal(detail.status, 200);
    const article = await detail.json();
    assert.equal(article.key, 'subject/viewer-interactive-a');
    assert.ok(article.content.includes('First.'), 'detail should include article content');

    // History sub-route
    const history = await fetch(`http://127.0.0.1:${port}/api/v1/articles/${encodeURIComponent('subject/viewer-interactive-a')}/history`);
    assert.equal(history.status, 200);
    const hist = await history.json();
    assert.equal(hist.key, 'subject/viewer-interactive-a');
    assert.equal(hist.versionCount, 1);
    assert.equal(hist.attestationCount, 1);

    // Consensus sub-route
    const consensus = await fetch(`http://127.0.0.1:${port}/api/v1/articles/${encodeURIComponent('subject/viewer-interactive-a')}/consensus`);
    assert.equal(consensus.status, 200);
    const cons = await consensus.json();
    assert.equal(cons.key, 'subject/viewer-interactive-a');
    assert.ok(typeof cons.score === 'number', 'consensus should have numeric score');
  } finally {
    await stopServer(server);
  }

  fs.rmSync(home, { recursive: true, force: true });
}

console.log('viewer-interactive tests passed');
