/**
 * Viewer raw endpoint + attestation link integration tests.
 *
 * Verifies that:
 *   1. The static viewer HTML renders source and Viewblock links on attestation cards.
 *   2. The local HTTP API exposes GET /api/v1/raw/:id and returns the raw ANS-104 bytes.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { startServer, stopServer } from '../src/serve.mjs';
import { api } from '../src/agent-api.mjs';
import { initState } from '../src/config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const viewerPath = path.resolve(__dirname, '..', 'viewer', 'index.html');

function makeTempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-viewer-raw-links-'));
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

function requestRaw(port, id) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost',
      port,
      method: 'GET',
      path: `/api/v1/raw/${encodeURIComponent(id)}`
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        resolve({ status: res.statusCode, body: Buffer.concat(chunks), headers: res.headers });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// --- viewer/index.html renders attestation source/Viewblock links ---
{
  const html = fs.readFileSync(viewerPath, 'utf8');
  const attCardsStart = html.indexOf('var attCards = atts.map');
  const attCardsEnd = html.indexOf(").join('');", attCardsStart);
  assert.ok(attCardsStart > 0, 'viewer should render attestation cards');
  const attCardsBlock = html.slice(attCardsStart, attCardsEnd);

  assert.ok(
    attCardsBlock.includes('viewblock.io/arweave/tx/' + "' + att.id"),
    'attestation card should link to Viewblock'
  );
  assert.ok(
    attCardsBlock.includes('arweave.net/' + "' + att.id"),
    'attestation card should link to Arweave'
  );
  assert.ok(
    attCardsBlock.includes("att.sourceUrl ? '<a href=\"' + esc(att.sourceUrl)"),
    'attestation card should conditionally link to source URL'
  );
}

// --- GET /api/v1/raw/:id returns ANS-104 bytes for a published article ---
{
  const home = makeTempHome();
  await resetApi(home);

  const publish = await api.publish({
    content: '# Raw endpoint test article\n\nHello raw bytes.',
    kind: 'subject',
    topic: 'viewer-raw-links',
    sourceUrl: 'https://example.com/viewer-raw-links',
    key: 'subject/viewer-raw-links-test'
  });
  assert.ok(publish.summary?.id, 'publish should return an id');

  const { server, port } = await startServer({ port: 0, home });
  try {
    const res = await requestRaw(port, publish.summary.id);
    assert.equal(res.status, 200, 'raw endpoint should return 200');
    assert.equal(res.headers['content-type'], 'application/octet-stream', 'raw endpoint should return octet-stream');
    assert.ok(res.body.length > 0, 'raw endpoint should return non-empty bytes');

    // Verify it is a valid ANS-104 DataItem by checking the signature type prefix.
    const sigType = res.body.readUInt16LE(0);
    assert.ok(sigType === 1 || sigType === 2, `raw bytes should start with ANS-104 signature type (got ${sigType})`);
  } finally {
    await stopServer(server);
  }

  fs.rmSync(home, { recursive: true, force: true });
}

console.log('viewer-raw-links tests passed');
