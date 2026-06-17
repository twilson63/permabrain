/**
 * Test: Local audit log (api.log / permabrain log)
 *
 * Covers logAction, queryLog, logToMarkdown, CLI command, and
 * the HTTP GET/POST /api/v1/log route.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { logAction, queryLog, logToMarkdown, logPath, tailLog, followLog, exportLog, importLog } from '../src/log.mjs';
import { api } from '../src/agent-api.mjs';
import { runCommand } from '../src/commands.mjs';
import { startServer, stopServer } from '../src/serve.mjs';

function tmpHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pb-log-'));
}

async function initApi(home) {
  process.env.PERMABRAIN_HOME = home;
  process.env.PERMABRAIN_TRANSPORT = 'local';
  api._home = undefined;
  api._identity = undefined;
  api._config = undefined;
  await api.init({ transport: 'local' });
  return api;
}

function request(serverPort, method, path, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost',
      port: serverPort,
      method,
      path,
      headers: body ? { 'content-type': 'application/json' } : {}
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// --- 1. logAction writes an entry ---
console.log('1. logAction writes an entry');
{
  const home = tmpHome();
  await initApi(home);
  const entry = logAction({ home, action: 'publish', key: 'subject/test', status: 'ok', message: 'Published test', details: { version: 1 } });
  assert.equal(entry.action, 'publish');
  assert.equal(entry.key, 'subject/test');
  assert.equal(entry.status, 'ok');
  assert.ok(fs.existsSync(logPath(home)), 'log file created');
  const queried = queryLog({ home });
  assert.equal(queried.total, 1);
  assert.equal(queried.entries[0].action, 'publish');
  console.log('   ✓ logAction writes and queries');
}

// --- 2. queryLog filters by action ---
console.log('2. queryLog filters by action');
{
  const home = tmpHome();
  await initApi(home);
  logAction({ home, action: 'publish', key: 'subject/a' });
  logAction({ home, action: 'attest', key: 'subject/a' });
  logAction({ home, action: 'fork', key: 'subject/a' });
  const result = queryLog({ home, action: 'attest' });
  assert.equal(result.total, 1);
  assert.equal(result.entries[0].action, 'attest');
  console.log('   ✓ Action filter works');
}

// --- 3. queryLog filters by status ---
console.log('3. queryLog filters by status');
{
  const home = tmpHome();
  await initApi(home);
  logAction({ home, action: 'publish', status: 'ok' });
  logAction({ home, action: 'publish', status: 'error', message: 'boom' });
  const errors = queryLog({ home, status: 'error' });
  assert.equal(errors.total, 1);
  assert.equal(errors.entries[0].status, 'error');
  console.log('   ✓ Status filter works');
}

// --- 4. queryLog date range and order ---
console.log('4. queryLog date range and order');
{
  const home = tmpHome();
  await initApi(home);
  logAction({ home, action: 'publish' });
  logAction({ home, action: 'attest' });
  logAction({ home, action: 'merge' });
  const desc = queryLog({ home, limit: 2 });
  assert.equal(desc.entries[0].action, 'merge');
  const asc = queryLog({ home, order: 'asc', limit: 2 });
  assert.equal(asc.entries[0].action, 'publish');
  const future = new Date();
  future.setUTCDate(future.getUTCDate() + 1);
  const past = new Date();
  past.setUTCDate(past.getUTCDate() - 1);
  const range = queryLog({ home, after: past.toISOString(), before: future.toISOString() });
  assert.equal(range.total, 3);
  console.log('   ✓ Date range and order work');
}

// --- 5. queryLog search ---
console.log('5. queryLog search');
{
  const home = tmpHome();
  await initApi(home);
  logAction({ home, action: 'publish', message: 'first article' });
  logAction({ home, action: 'attest', message: 'second attestation' });
  const found = queryLog({ home, search: 'attestation' });
  assert.equal(found.total, 1);
  assert.equal(found.entries[0].action, 'attest');
  console.log('   ✓ Search works');
}

// --- 6. markdown output ---
console.log('6. markdown output');
{
  const home = tmpHome();
  await initApi(home);
  logAction({ home, action: 'publish', key: 'subject/md', message: 'Markdown test' });
  const result = queryLog({ home, markdown: true });
  assert.ok(result.markdown);
  assert.match(result.markdown, /# PermaBrain Audit Log/);
  assert.match(result.markdown, /publish/);
  assert.match(result.markdown, /Markdown test/);
  const direct = logToMarkdown(result);
  assert.match(direct, /# PermaBrain Audit Log/);
  console.log('   ✓ Markdown output works');
}

// --- 7. Empty log markdown ---
console.log('7. Empty log markdown');
{
  const home = tmpHome();
  await initApi(home);
  const result = queryLog({ home, markdown: true });
  assert.match(result.markdown, /No audit events found/);
  console.log('   ✓ Empty log markdown works');
}

// --- 8. CLI log command ---
console.log('8. CLI log command');
{
  const home = tmpHome();
  process.env.PERMABRAIN_HOME = home;
  await initApi(home);
  logAction({ home, action: 'publish', key: 'subject/cli', message: 'CLI test' });
  const out = await runCommand('log', { json: true, action: 'publish' });
  assert.equal(out.total, 1);
  assert.equal(out.entries[0].action, 'publish');
  console.log('   ✓ CLI log command works');
}

// --- 9. Agent API methods ---
console.log('9. Agent API methods');
{
  const home = tmpHome();
  await initApi(home);
  const written = await api.auditLog({ action: 'import', status: 'ok', message: 'Imported bundle' });
  assert.equal(written.action, 'import');
  const result = await api.log({ action: 'import' });
  assert.equal(result.total, 1);
  assert.equal(result.entries[0].action, 'import');
  console.log('   ✓ api.auditLog and api.log work');
}

// --- 10. HTTP GET /api/v1/log ---
console.log('10. HTTP GET /api/v1/log');
{
  const home = tmpHome();
  process.env.PERMABRAIN_HOME = home;
  process.env.PERMABRAIN_TRANSPORT = 'local';
  api._home = undefined;
  api._identity = undefined;
  api._config = undefined;
  const { server, port } = await startServer({ home, port: 0 });
  logAction({ home, action: 'publish', key: 'subject/http', message: 'HTTP test' });
  const res = await request(port, 'GET', '/api/v1/log');
  assert.equal(res.status, 200);
  assert.equal(res.body.total, 1);
  assert.equal(res.body.entries[0].action, 'publish');
  const filtered = await request(port, 'GET', '/api/v1/log?action=publish&key=subject/http');
  assert.equal(filtered.body.total, 1);
  await stopServer(server);
  console.log('   ✓ HTTP GET /api/v1/log works');
}

// --- 11. HTTP POST /api/v1/log ---
console.log('11. HTTP POST /api/v1/log');
{
  const home = tmpHome();
  process.env.PERMABRAIN_HOME = home;
  process.env.PERMABRAIN_TRANSPORT = 'local';
  api._home = undefined;
  api._identity = undefined;
  api._config = undefined;
  const { server, port } = await startServer({ home, port: 0 });
  const res = await request(port, 'POST', '/api/v1/log', { action: 'merge', key: 'subject/http', message: 'HTTP post test' });
  assert.equal(res.status, 201);
  assert.equal(res.body.action, 'merge');
  const list = await request(port, 'GET', '/api/v1/log?action=merge');
  assert.equal(list.body.total, 1);
  await stopServer(server);
  console.log('   ✓ HTTP POST /api/v1/log works');
}

// --- 12. tailLog returns the most recent entries ---
console.log('12. tailLog returns the most recent entries');
{
  const home = tmpHome();
  await initApi(home);
  logAction({ home, action: 'publish', key: 'subject/tail-1' });
  logAction({ home, action: 'attest', key: 'subject/tail-1' });
  logAction({ home, action: 'fork', key: 'subject/tail-1' });
  const tail = tailLog({ home, limit: 2 });
  assert.equal(tail.total, 3);
  assert.equal(tail.entries.length, 2);
  assert.equal(tail.entries[0].action, 'fork');
  assert.equal(tail.entries[1].action, 'attest');
  console.log('   ✓ tailLog works');
}

// --- 13. followLog yields newly appended entries ---
console.log('13. followLog yields newly appended entries');
{
  const home = tmpHome();
  await initApi(home);
  const follower = followLog({ home, interval: 50, tail: 0 });
  setTimeout(() => {
    logAction({ home, action: 'publish', key: 'subject/follow', message: 'follow me' });
  }, 80);
  setTimeout(() => follower.cancel(), 250);
  const seen = [];
  for await (const entry of follower) {
    seen.push(entry);
  }
  assert.ok(seen.length >= 1, 'followLog saw at least one new entry');
  assert.equal(seen[0].action, 'publish');
  assert.equal(seen[0].key, 'subject/follow');
  console.log('   ✓ followLog works');
}

// --- 14. exportLog / importLog cross-node migration ---
console.log('14. exportLog / importLog cross-node migration');
{
  const sourceHome = tmpHome();
  await initApi(sourceHome);
  logAction({ home: sourceHome, action: 'publish', key: 'subject/migrate', message: 'source entry' });
  const bundle = exportLog({ home: sourceHome });
  assert.equal(bundle.type, 'audit-log');
  assert.equal(bundle.entries.length, 1);
  assert.equal(bundle.meta.entryCount, 1);

  const destHome = tmpHome();
  await initApi(destHome);
  const result = importLog(bundle, { home: destHome });
  assert.equal(result.imported, 1);
  assert.equal(result.skipped, 0);
  assert.equal(result.failed, 0);

  // Idempotent: importing the same bundle again should skip.
  const repeat = importLog(bundle, { home: destHome });
  assert.equal(repeat.imported, 0);
  assert.equal(repeat.skipped, 1);
  assert.equal(repeat.failed, 0);

  const destQuery = queryLog({ home: destHome });
  assert.equal(destQuery.total, 1);
  assert.equal(destQuery.entries[0].key, 'subject/migrate');
  console.log('   ✓ exportLog / importLog work');
}

// --- 15. HTTP log export / import routes ---
console.log('15. HTTP log export / import routes');
{
  const home = tmpHome();
  process.env.PERMABRAIN_HOME = home;
  process.env.PERMABRAIN_TRANSPORT = 'local';
  api._home = undefined;
  api._identity = undefined;
  api._config = undefined;
  const { server, port } = await startServer({ home, port: 0 });
  logAction({ home, action: 'publish', key: 'subject/log-export', message: 'export route' });

  const exported = await request(port, 'GET', '/api/v1/log/export');
  assert.equal(exported.status, 200);
  assert.equal(exported.body.type, 'audit-log');
  assert.equal(exported.body.entries.length, 1);

  const destHome = tmpHome();
  const destServer = await startServer({ home: destHome, port: 0 });
  const imported = await request(destServer.port, 'POST', '/api/v1/log/import', { bundle: exported.body });
  assert.equal(imported.status, 200);
  assert.equal(imported.body.imported, 1);

  await stopServer(server);
  await stopServer(destServer.server);
  console.log('   ✓ HTTP log export/import routes work');
}

console.log('\n✅ All audit log tests passed');
