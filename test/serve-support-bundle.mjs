import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import os from 'node:os';
import { startServer, stopServer } from '../src/serve.mjs';
import { createClient } from '../src/client.mjs';
import { initState } from '../src/config.mjs';
import { ensureIdentity } from '../src/keys.mjs';

function tmpHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-serve-support-bundle-'));
  process.env.PERMABRAIN_HOME = dir;
  return dir;
}

function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get(url, { headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode, headers: res.headers, body });
      });
    }).on('error', reject);
  });
}

{
  const home = tmpHome();
  initState();
  await ensureIdentity(home, { keyType: 'ed25519' });
  const result = await startServer({ home, port: 0 });
  const base = `http://localhost:${result.port}`;

  try {
    const res = await httpGet(`${base}/api/v1/support-bundle`);
    assert.strictEqual(res.status, 200);
    const data = JSON.parse(res.body);
    assert.ok(data.generatedAt, 'generatedAt');
    assert.equal(data.home, home, 'home');
    assert.ok(data.identity, 'identity');
    assert.ok(data.identity.agentId, 'agentId');
    assert.ok(data.config, 'config');
    assert.ok(data.indexSummary, 'indexSummary');
    assert.ok(data.metrics, 'metrics');
    assert.ok(Array.isArray(data.routes), 'routes');
    assert.ok(data.routes.some((r) => r.route === '/api/v1/support-bundle'), 'support-bundle route listed');
    assert.ok(!data.identity.secretKey, 'secret key not exposed');
    console.log('✓ GET /api/v1/support-bundle returns JSON bundle');

    const mdRes = await httpGet(`${base}/api/v1/support-bundle`, { accept: 'text/markdown' });
    assert.strictEqual(mdRes.status, 200);
    assert.ok(mdRes.headers['content-type'].includes('text/markdown'), 'markdown content-type');
    assert.ok(mdRes.body.includes('# PermaBrain Support Bundle'), 'markdown header');
    assert.ok(mdRes.body.includes(data.identity.agentId), 'markdown agentId');
    console.log('✓ GET /api/v1/support-bundle?format=markdown returns markdown');

    const limited = await httpGet(`${base}/api/v1/support-bundle?audit-log-limit=2&access-log-limit=2`);
    assert.strictEqual(limited.status, 200);
    const l = JSON.parse(limited.body);
    assert.equal(l.auditLog.entries.length <= 2, true, 'audit-log-limit honored');
    assert.equal(l.accessLog.entries.length <= 2, true, 'access-log-limit honored');
    console.log('✓ Query limits are honored');

    const client = createClient({ baseUrl: base });
    const cData = await client.supportBundle();
    assert.ok(cData.generatedAt, 'client supportBundle generatedAt');
    assert.ok(cData.routes, 'client supportBundle routes');
    console.log('✓ SDK client.supportBundle() works');

    const cWithLimit = await client.supportBundle({ 'audit-log-limit': 1, 'access-log-limit': 1 });
    assert.equal(cWithLimit.auditLog.entries.length <= 1, true, 'client audit-log-limit honored');
    console.log('✓ SDK client.supportBundle() honors limits');
  } finally {
    await stopServer(result.server);
    fs.rmSync(home, { recursive: true, force: true });
  }
}

{
  const home = tmpHome();
  initState();
  await ensureIdentity(home, { keyType: 'ed25519' });
  const apiKey = 'test-support-bundle-auth';
  const result = await startServer({ home, port: 0, apiKey });
  const base = `http://localhost:${result.port}`;

  try {
    const anon = await httpGet(`${base}/api/v1/support-bundle`);
    assert.equal(anon.status, 401, 'unauthenticated request rejected');

    const authed = await httpGet(`${base}/api/v1/support-bundle`, { 'x-api-key': apiKey });
    assert.equal(authed.status, 200, 'authenticated request succeeds');
    const data = JSON.parse(authed.body);
    assert.ok(data.identity, 'identity in authed response');
    console.log('✓ /api/v1/support-bundle respects API key auth');
  } finally {
    await stopServer(result.server);
    fs.rmSync(home, { recursive: true, force: true });
  }
}

console.log('\n✅ Serve support bundle tests passed');
