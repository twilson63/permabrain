/**
 * Test: Web Dashboard
 *
 * Verifies dashboard data building, HTML rendering, markdown rendering,
 * file writing, and API/CLI/HTTP integration.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildDashboard, dashboardToHtml, dashboardToMarkdown, writeDashboard, publishDashboard } from '../src/dashboard.mjs';
import { api } from '../src/agent-api.mjs';
import { runCommand } from '../src/commands.mjs';
import { createServer, startServer, stopServer } from '../src/serve.mjs';

function tmpHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pb-dashboard-'));
}

async function initHome(home) {
  process.env.PERMABRAIN_HOME = home;
  await api.init({ keyType: 'ed25519' });
}

function resetApi(home) {
  api._home = home;
  api._config = null;
  api._identity = null;
}

console.log('1. buildDashboard returns expected shape');
{
  const home = tmpHome();
  resetApi(home);
  await initHome(home);
  const data = await buildDashboard({ home });
  assert.equal(typeof data.generatedAt, 'string');
  assert.equal(data.home, home);
  assert.ok(data.agentId.startsWith('ed25519:'));
  assert.equal(data.transport, 'arweave');
  assert.ok(data.stats && typeof data.stats === 'object');
  assert.ok(data.list && typeof data.list.total === 'number');
  assert.ok(data.activity && typeof data.activity.total === 'number');
  assert.ok(data.log && typeof data.log.total === 'number');
  assert.deepEqual(Object.keys(data.filters).sort(), ['after', 'agent', 'author', 'before', 'key', 'kind', 'order', 'sort', 'topic']);
  console.log('   ✓ Dashboard shape correct');
}

console.log('2. dashboardToHtml returns a self-contained HTML string');
{
  const home = tmpHome();
  resetApi(home);
  await initHome(home);
  const data = await buildDashboard({ home });
  const html = dashboardToHtml(data);
  assert.ok(html.startsWith('<!DOCTYPE html>'));
  assert.ok(html.includes('PermaBrain Dashboard'));
  assert.ok(html.includes(data.agentId));
  assert.ok(html.includes('stats-grid'));
  assert.ok(html.includes('articles-tab'));
  assert.ok(html.includes('activity-tab'));
  assert.ok(html.includes('audit-tab'));
  assert.ok(html.includes('const DATA ='));
  console.log('   ✓ HTML generated');
}

console.log('3. dashboardToMarkdown renders a markdown summary');
{
  const home = tmpHome();
  resetApi(home);
  await initHome(home);
  const data = await buildDashboard({ home });
  const md = dashboardToMarkdown(data);
  assert.ok(md.startsWith('# PermaBrain Dashboard'));
  assert.ok(md.includes(data.agentId));
  assert.ok(md.includes('## Snapshot'));
  assert.ok(md.includes(`## Articles (${data.list.total})`));
  assert.ok(md.includes(`## Activity (${data.activity.total})`));
  assert.ok(md.includes(`## Audit log (${data.log.total})`));
  console.log('   ✓ Markdown generated');
}

console.log('4. writeDashboard writes the HTML file');
{
  const home = tmpHome();
  resetApi(home);
  await initHome(home);
  const data = await buildDashboard({ home });
  const output = path.join(home, 'dash.html');
  const result = await writeDashboard(data, { output });
  assert.equal(result.path, path.resolve(output));
  assert.ok(result.bytes > 1000);
  assert.ok(fs.existsSync(output));
  assert.ok(fs.readFileSync(output, 'utf8').startsWith('<!DOCTYPE html>'));
  console.log('   ✓ File written');
}

console.log('5. api.dashboard() and api.writeDashboard() wrappers work');
{
  const home = tmpHome();
  resetApi(home);
  await initHome(home);
  const data = await api.dashboard();
  assert.equal(data.home, home);
  assert.equal(typeof api.dashboardHTML(data), 'string');
  assert.equal(typeof api.dashboardMarkdown(data), 'string');
  const out = await api.writeDashboard({ output: path.join(home, 'api-dash.html') });
  assert.ok(out.bytes > 1000);
  console.log('   ✓ API wrappers work');
}

console.log('6. CLI dashboard command prints markdown by default');
{
  const home = tmpHome();
  resetApi(home);
  await initHome(home);
  const oldLog = console.log;
  const logs = [];
  console.log = (...args) => logs.push(args.join(' '));
  let threw = null;
  try {
    await runCommand('dashboard', { home });
  } catch (err) {
    threw = err;
  }
  console.log = oldLog;
  if (threw) throw threw;
  const combined = logs.join('\n');
  assert.ok(combined.includes('# PermaBrain Dashboard'));
  assert.ok(combined.includes('Use --output dashboard.html'));
  console.log('   ✓ CLI default markdown output');
}

console.log('7. CLI dashboard --output writes HTML');
{
  const home = tmpHome();
  resetApi(home);
  await initHome(home);
  const output = path.join(home, 'cli-dash.html');
  await runCommand('dashboard', { home, output });
  assert.ok(fs.existsSync(output));
  assert.ok(fs.readFileSync(output, 'utf8').startsWith('<!DOCTYPE html>'));
  console.log('   ✓ CLI --output writes HTML');
}

console.log('8. CLI dashboard --json returns data');
{
  const home = tmpHome();
  resetApi(home);
  await initHome(home);
  const result = await runCommand('dashboard', { home, json: true });
  assert.equal(result.home, home);
  assert.ok(result.agentId);
  console.log('   ✓ CLI --json returns data');
}

console.log('9. HTTP GET /api/v1/dashboard returns JSON');
{
  const home = tmpHome();
  resetApi(home);
  await initHome(home);
  const { server, port } = await startServer({ port: 0, home });
  try {
    const res = await fetch(`http://localhost:${port}/api/v1/dashboard`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.home, home);
    assert.ok(data.stats);
    assert.ok(data.list);
    console.log('   ✓ HTTP dashboard JSON');
  } finally {
    await stopServer(server);
  }
}

console.log('10. HTTP GET /api/v1/dashboard.html returns HTML');
{
  const home = tmpHome();
  resetApi(home);
  await initHome(home);
  const { server, port } = await startServer({ port: 0, home });
  try {
    const res = await fetch(`http://localhost:${port}/api/v1/dashboard.html`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.startsWith('<!DOCTYPE html>'));
    assert.ok(res.headers.get('content-type').includes('text/html'));
    console.log('   ✓ HTTP dashboard HTML');
  } finally {
    await stopServer(server);
  }
}

console.log('11. publishDashboard signs and publishes to a mock ZenBin endpoint');
{
  const home = tmpHome();
  resetApi(home);
  await initHome(home);
  const data = await buildDashboard({ home });

  const publicJwk = {
    crv: 'Ed25519',
    kty: 'OKP',
    x: 'VNwCdReytqk_dtPgMOOTQn_wUaejDMTYjtC0ymPEhSg'
  };
  const privateJwk = {
    ...publicJwk,
    d: 'uG4rsZfaMrp6OTQaWY9SyimcBLaUfi3R-FBcovTNuIQ'
  };

  let captured = null;
  const originalFetch = global.fetch;
  global.fetch = async (url, init) => {
    captured = { url, init };
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => JSON.stringify({ id: 'test-page-123' })
    };
  };

  let threw = null;
  let result;
  try {
    result = await publishDashboard(data, {
      keyId: 'dev1-key-test',
      privateJwk,
      pageId: 'test-page-123',
      title: 'Test Dashboard',
      recipient: publicJwk
    });
  } catch (err) {
    threw = err;
  } finally {
    global.fetch = originalFetch;
  }
  if (threw) throw threw;

  assert.ok(captured, 'fetch was called');
  assert.ok(captured.url.includes('/v1/pages/test-page-123'));
  assert.equal(captured.init.method, 'POST');
  const headers = captured.init.headers;
  assert.ok(headers['x-zenbin-key-id'], 'key id header present');
  assert.ok(headers['x-zenbin-signature'], 'signature header present');
  assert.ok(headers['content-digest'], 'digest header present');
  assert.equal(headers['cap-recipient-key-id'], 'q1D9p4puc0UkWVUD-PEMze2GRH11MLu-Sf1kP7-anMc');
  const body = JSON.parse(captured.init.body);
  assert.ok(body.html, 'html body present');
  assert.equal(body.recipientKeyId, 'q1D9p4puc0UkWVUD-PEMze2GRH11MLu-Sf1kP7-anMc');
  assert.equal(result.url, 'https://zenbin.org/p/test-page-123');
  assert.equal(result.pageId, 'test-page-123');
  assert.ok(result.bytes > 1000);
  console.log('   ✓ publishDashboard sent signed ZenBin request');
}

console.log('\n✅ All dashboard tests passed');
