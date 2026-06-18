/**
 * Viewer permalink / URL state capture tests.
 *
 * Verifies that the web viewer includes a "Copy link" button and exposes
 * helpers to encode/decode the current view state (filters, sort, search,
 * selected article, active tab, live transport, view mode) into the URL
 * query string. Also checks that the local HTTP API routes used by restored
 * state still serve correctly when requested with query parameters.
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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-viewer-permalinks-'));
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

// --- viewer/index.html contains permalink wiring ---
{
  const html = fs.readFileSync(viewerPath, 'utf8');
  assert.ok(html.includes('id="copyLinkBtn"'), 'viewer should have copy link button');
  assert.ok(html.includes('window.copyPermalink'), 'viewer should expose copyPermalink');
  assert.ok(html.includes('window.buildUrlState'), 'viewer should expose buildUrlState');
  assert.ok(html.includes('window.applyUrlState'), 'viewer should expose applyUrlState');
  assert.ok(html.includes('window.updateUrlState'), 'viewer should expose updateUrlState');
  assert.ok(html.includes('readUrlState'), 'viewer should read URL state');
  assert.ok(html.includes('history.replaceState'), 'viewer should update URL via replaceState');
  assert.ok(html.includes('navigator.clipboard'), 'copyPermalink should use clipboard API');
}

// --- Local server routes required by restored permalink state work ---
{
  const home = makeTempHome();
  await resetApi(home);

  await api.publish({
    content: '# Permalink article A\n\nFirst.',
    kind: 'subject',
    topic: 'permalink-a',
    sourceUrl: 'https://example.com/a',
    title: 'Permalink A',
    key: 'subject/permalink-a'
  });
  await api.publish({
    content: '# Permalink article B\n\nSecond.',
    kind: 'subject',
    topic: 'permalink-b',
    sourceUrl: 'https://example.com/b',
    title: 'Permalink B',
    key: 'subject/permalink-b'
  });

  const { server, port } = await startServer({ port: 0, home });
  try {
    // API routes used by restored permalink state work and accept query params.
    const listRes = await fetch(`http://127.0.0.1:${port}/api/v1/list?topic=permalink-a&sort=title`);
    assert.equal(listRes.status, 200, 'list should accept query params');
    const listData = await listRes.json();
    assert.equal(listData.total, 1, 'topic filter should return one article');
    assert.equal(listData.articles[0].key, 'subject/permalink-a');

    const detailRes = await fetch(`http://127.0.0.1:${port}/api/v1/articles/${encodeURIComponent('subject/permalink-a')}`);
    assert.equal(detailRes.status, 200, 'detail route should accept article key');
    const article = await detailRes.json();
    assert.equal(article.key, 'subject/permalink-a');

    // The viewer file itself contains the state-encode helpers.
    const html = fs.readFileSync(viewerPath, 'utf8');
    assert.ok(html.includes('window.applyUrlState'), 'viewer HTML should include applyUrlState helper');
  } finally {
    await stopServer(server);
  }

  fs.rmSync(home, { recursive: true, force: true });
}

console.log('viewer-permalinks tests passed');
