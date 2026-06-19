import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import os from 'node:os';
import { startServer, stopServer } from '../src/serve.mjs';
import { createClient } from '../src/client.mjs';

function tmpHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pb-serve-admin-'));
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
  const result = await startServer({ home, port: 0, accessLog: 'short', requestLogMaxEntries: 50 });
  const base = `http://localhost:${result.port}`;

  try {
    const health = await httpGet(`${base}/health`);
    assert.strictEqual(health.status, 200);

    const res = await httpGet(`${base}/api/v1/admin`);
    assert.strictEqual(res.status, 200);
    const data = JSON.parse(res.body);
    assert.ok(data.generatedAt, 'generatedAt');
    assert.equal(data.home, home, 'home');
    assert.equal(typeof data.agentId, 'string', 'agentId');
    assert.equal(typeof data.transport, 'string', 'transport');
    assert.ok(data.metrics, 'metrics');
    assert.ok(data.metrics.runtime, 'metrics.runtime');
    assert.ok(data.metrics.data, 'metrics.data');
    assert.ok(data.accessLog, 'accessLog');
    assert.ok(data.auditLog, 'auditLog');
    assert.ok(data.links, 'links');
    assert.ok(data.links.metrics, 'links.metrics');
    assert.ok(data.links.requests, 'links.requests');
    assert.ok(data.links.audit, 'links.audit');
    assert.equal(data.accessLog.entries.length >= 1, true, 'access log contains the /health request');
    assert.equal(data.accessLog.entries[0].method, 'GET');
    assert.equal(data.accessLog.entries[0].path, '/health');
    assert.equal(typeof data.accessLog.entries[0].requestId, 'string');
    console.log('✓ /api/v1/admin returns consolidated JSON');

    const htmlRes = await httpGet(`${base}/api/v1/admin.html`);
    assert.strictEqual(htmlRes.status, 200);
    assert.ok(htmlRes.headers['content-type'].includes('text/html'), 'html content-type');
    assert.ok(htmlRes.body.includes('PermaBrain Admin'), 'html title');
    assert.ok(htmlRes.body.includes(data.agentId), 'html shows agentId');
    console.log('✓ /api/v1/admin.html returns self-contained HTML');

    const queryRes = await httpGet(`${base}/api/v1/admin?access-log-limit=1&audit-log-limit=1`);
    assert.strictEqual(queryRes.status, 200);
    const q = JSON.parse(queryRes.body);
    assert.equal(q.accessLog.entries.length <= 1, true, 'access-log-limit honored');
    assert.equal(q.auditLog.entries.length <= 1, true, 'audit-log-limit honored');
    console.log('✓ /api/v1/admin limits are honored');

    const client = createClient({ baseUrl: base });
    const cData = await client.admin();
    assert.ok(cData.generatedAt, 'client.admin generatedAt');
    assert.ok(cData.metrics, 'client.admin metrics');
    assert.ok(cData.accessLog, 'client.admin accessLog');
    const cHtml = await client.adminHTML();
    assert.ok(cHtml.includes('PermaBrain Admin'), 'client.adminHTML');
    console.log('✓ SDK client.admin() methods work');
  } finally {
    await stopServer(result.server);
    fs.rmSync(home, { recursive: true, force: true });
  }
}

console.log('\n✅ Admin panel tests passed');
