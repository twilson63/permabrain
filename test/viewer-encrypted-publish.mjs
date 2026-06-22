/**
 * Viewer encrypted publish panel tests.
 *
 * Verifies that the web viewer includes an Encrypted publish panel wired to
 * POST /api/v1/articles with visibility: 'encrypted' and an encryptedFor
 * recipient list, supports deep-link state (?view=encrypted), metadata inputs,
 * recipient chips, markdown preview, localStorage draft save/restore, and
 * API-key auth.
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
import { generateApiKey } from '../src/auth.mjs';
import { generateEncryptionKeypair } from '../src/crypto.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const viewerPath = path.resolve(__dirname, '..', 'viewer', 'index.html');

function makeTempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-viewer-encrypted-'));
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

function request(port, reqPath, method = 'GET', body = null, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const headers = { ...extraHeaders };
    if (body) headers['content-type'] = 'application/json';
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      method,
      path: reqPath,
      headers
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch {}
        resolve({ status: res.statusCode, body: text, json, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// --- viewer/index.html contains encrypted publish panel wiring ---
{
  const html = fs.readFileSync(viewerPath, 'utf8');
  assert.ok(html.includes('id="encryptedBtn"'), 'viewer should have encrypted publish button');
  assert.ok(html.includes('window.showEncrypted'), 'viewer should expose showEncrypted');
  assert.ok(html.includes('window.updateEncryptedDraft'), 'viewer should expose updateEncryptedDraft');
  assert.ok(html.includes('window.runEncryptedPublish'), 'viewer should expose runEncryptedPublish');
  assert.ok(html.includes('window.clearEncrypted'), 'viewer should expose clearEncrypted');
  assert.ok(html.includes('window.renderEncrypted'), 'viewer should expose renderEncrypted');
  assert.ok(html.includes('window.addEncryptedRecipient'), 'viewer should expose addEncryptedRecipient');
  assert.ok(html.includes('window.removeEncryptedRecipient'), 'viewer should expose removeEncryptedRecipient');
  assert.ok(html.includes('window.refreshEncryptedPreview'), 'viewer should expose refreshEncryptedPreview');
  assert.ok(html.includes("'encrypted'"), 'viewer should reference encrypted view in state handling');
  assert.ok(html.includes("viewMode === 'encrypted'"), 'boot should restore encrypted view');
  assert.ok(html.includes('encrypted-recipient-chip'), 'viewer should have recipient chip style');
  assert.ok(html.includes('encrypted-recipient-box'), 'viewer should have recipient input box');
  assert.ok(html.includes('id="encryptedContent"'), 'viewer should have encrypted content textarea');
  assert.ok(html.includes('id="encryptedTitle"'), 'viewer should have encrypted title input');
  assert.ok(html.includes('id="encryptedTopic"'), 'viewer should have encrypted topic input');
  assert.ok(html.includes('id="encryptedKind"'), 'viewer should have encrypted kind select');
  assert.ok(html.includes('id="encryptedRecipientInput"'), 'viewer should have recipient input');
  assert.ok(html.includes('id="encryptedApiKey"'), 'viewer should have encrypted API key input');
  assert.ok(html.includes('visibility: \'encrypted\''), 'viewer should hard-code encrypted visibility');
  assert.ok(html.includes('encryptedFor'), 'viewer should pass encryptedFor array');
  assert.ok(html.includes('/api/v1/articles'), 'viewer should call articles endpoint');
  assert.ok(html.includes("'authorization'"), 'viewer should set authorization header');
  assert.ok(html.includes('permabrain-encrypted-draft'), 'viewer should use localStorage draft key');
  assert.ok(html.includes('loadEncryptedDraft'), 'viewer should load draft from localStorage');
  assert.ok(html.includes('saveEncryptedDraft'), 'viewer should save draft to localStorage');
}

// --- local API encrypted article publish endpoint works and requires auth ---
{
  const home = makeTempHome();
  await resetApi(home);

  const apiKey = generateApiKey();
  const { server, port } = await startServer({ port: 0, home, apiKey });
  try {
    const recipient = generateEncryptionKeypair();
    const body = {
      content: '# Secret note\n\nThis article should be encrypted for the recipient.',
      title: 'Secret note',
      key: 'subject/secret-note',
      kind: 'subject',
      topic: 'encrypted-tests',
      sourceUrl: 'https://example.com/encrypted',
      sourceName: 'Encrypted publish',
      language: 'en',
      visibility: 'encrypted',
      encryptedFor: [recipient.publicKey]
    };

    // Publish without auth fails
    const noAuth = await request(port, '/api/v1/articles', 'POST', body);
    assert.equal(noAuth.status, 401, 'encrypted publish without key should 401');

    // Publish with auth succeeds
    const publish = await request(port, '/api/v1/articles', 'POST', body, { authorization: `Bearer ${apiKey}` });
    assert.equal(publish.status, 201, 'encrypted publish should return 201');
    assert.equal(publish.json.summary.key, 'subject/secret-note', 'published key matches');
    assert.equal(publish.json.summary.title, 'Secret note', 'published title matches');
    assert.equal(publish.json.summary.topic, 'encrypted-tests', 'published topic matches');
    assert.equal(publish.json.summary.version, 1, 'published version is 1');
    assert.equal(publish.json.encrypted, true, 'response reports encrypted article');

    // Author can retrieve and decrypt the encrypted article through the API
    const decrypted = await api.getAndDecrypt('subject/secret-note');
    assert.equal(decrypted.key, 'subject/secret-note', 'decrypted key matches');
    assert.equal(decrypted.title, 'Secret note', 'decrypted title matches');
    assert.equal(decrypted.visibility, 'encrypted', 'decrypted visibility is encrypted');
    assert.equal(decrypted.content.includes('This article should be encrypted for the recipient.'), true, 'decrypted content contains plaintext');
  } finally {
    await stopServer(server);
    fs.rmSync(home, { recursive: true, force: true });
  }
}

console.log('viewer-encrypted-publish tests passed');
