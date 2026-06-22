import { Daytona } from '@daytona/sdk';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(__dirname, '..');
const logFile = path.join(workspaceRoot, '.hb-edge-test.log');
const urlFile = path.join(workspaceRoot, '.hb-edge-url');
const patchFile = path.join(workspaceRoot, 'scripts', 'hb-json-accept-patch.mjs');

const SANDBOX_ID = 'b8625c83-5123-4265-93e6-b80894973f20';

function log(...parts) {
  const line = parts.join(' ');
  console.log(line);
  fs.appendFileSync(logFile, line + '\n');
}

function runLocal(cmd, args, env = {}, timeout = 120000, cwd = workspaceRoot) {
  log(`$ ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    timeout,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const out = (r.stdout || '') + (r.stderr || '');
  log(out.slice(0, 4000));
  if (r.status !== 0 && r.status !== null) log(`exit ${r.status}`);
  return { status: r.status, out };
}

async function sandboxExec(sb, cmd, timeout = 60) {
  log(`[sandbox] ${cmd}`);
  try {
    const r = await sb.process.executeCommand(cmd, undefined, undefined, timeout);
    const out = r.result || '';
    log(out.slice(0, 4000));
    if (r.exitCode !== 0) log(`sandbox exit ${r.exitCode}`);
    return r;
  } catch (err) {
    log(`sandbox exec error: ${err.message}`);
    throw err;
  }
}

async function ensureNodeRunning(sb) {
  const ps = await sandboxExec(sb, 'ps aux | grep -E "hb daemon|beam.smp" | grep -v grep || true', 30);
  if (!ps.result.includes('hb daemon')) {
    log('Starting hb daemon...');
    await sandboxExec(sb, 'cd /tmp/HyperBEAM/_build/default/rel/hb && ./bin/hb daemon > /tmp/hb-daemon.log 2>&1 &', 30);
    await new Promise((r) => setTimeout(r, 8000));
  }
}

async function main() {
  fs.writeFileSync(logFile, `# hb-edge-permabrain-test run ${new Date().toISOString()}\n`);

  const daytona = new Daytona();
  const sb = await daytona.get(SANDBOX_ID);
  try { await sb.start(); } catch {}
  log(`Sandbox: ${SANDBOX_ID}`);

  // Verify HyperBEAM is built and at latest edge
  const commit = await sandboxExec(sb, 'cd /tmp/HyperBEAM && git rev-parse --short HEAD && git log -1 --format=%cd', 30);
  log(`HyperBEAM commit: ${commit.result.trim()}`);

  // Start node if needed
  await ensureNodeRunning(sb);

  // Get signed preview URL
  const preview = await sb.getSignedPreviewUrl(8734);
  const baseUrl = preview.url;
  fs.writeFileSync(urlFile, baseUrl);
  log(`Signed preview URL: ${baseUrl}`);

  // Sanity check
  const sanity = await sandboxExec(sb, `curl -s -H 'Accept: application/json' ${baseUrl}/~meta@1.0/info | head -c 200`, 60);
  log(`meta info: ${sanity.result.trim()}`);

  // Set up PermaBrain home for integration tests
  const testHome = fs.mkdtempSync(path.join('/tmp', 'permabrain-edge-test-'));
  log(`PERMABRAIN_HOME: ${testHome}`);

  const baseEnv = {
    PERMABRAIN_HOME: testHome,
    PERMABRAIN_TRANSPORT: 'hyperbeam',
    PERMABRAIN_HYPERBEAM_URL: baseUrl,
    PERMABRAIN_REQUIRE_HYPERBEAM: '1',
    NODE_OPTIONS: `--import ${patchFile}`,
  };

  // Init identity
  runLocal('node', ['permabrain/scripts/cli.mjs', 'init', '--key-type', 'ed25519', '--json'], baseEnv);

  const results = {};

  // Run the live integration test from the permabrain directory so scripts/cli.mjs resolves
  const live = runLocal('node', ['test/hyperbeam.mjs'], baseEnv, 120000, path.join(workspaceRoot, 'permabrain'));
  results['test/hyperbeam.mjs'] = live.status === 0 ? 'pass' : `fail (exit ${live.status})`;

  // Run unit tests (do not leak live URL to fully-mocked tests)
  const unitEnv = { ...process.env, NODE_OPTIONS: `--import ${patchFile}` };
  for (const test of ['permabrain/test/hb-reference.mjs', 'permabrain/test/hb-transport.mjs', 'permabrain/test/hb-e2e.mjs']) {
    const r = runLocal('node', [test], unitEnv, 120000);
    results[test] = r.status === 0 ? 'pass' : `fail (exit ${r.status})`;
  }

  // article-hb-reference uses localhost:10000 mocks; keep its URL local
  const articleEnv = {
    ...process.env,
    PERMABRAIN_HYPERBEAM_URL: 'http://localhost:10000',
    NODE_OPTIONS: `--import ${patchFile}`,
  };
  const article = runLocal('node', ['permabrain/test/article-hb-reference.mjs'], articleEnv, 120000);
  results['test/article-hb-reference.mjs'] = article.status === 0 ? 'pass' : `fail (exit ${article.status})`;

  // PermaBrain-style live reference probe (uses bundler upload)
  const probe = runLocal('node', ['scripts/hb-live-reference-probe.mjs', baseUrl], baseEnv, 120000);
  results['live-reference-probe (bundler)'] = probe.status === 0 ? 'ok' : `fail (exit ${probe.status})`;

  // Direct JSON reference probe against the node
  fs.writeFileSync(urlFile, baseUrl);
  const directProbe = runLocal('node', ['scripts/hb-direct-reference-test.mjs'], {}, 60000);
  results['live-reference-probe (direct JSON)'] = directProbe.status === 0 ? 'ok' : `fail (exit ${directProbe.status})`;

  // Summary
  log('\n=== RESULTS ===');
  for (const [k, v] of Object.entries(results)) log(`${k}: ${v}`);

  const failed = Object.values(results).some((v) => v.startsWith('fail'));

  // Cleanup unless debugging
  if (failed) {
    log('\nTests failed — keeping sandbox running for debugging.');
  } else {
    log('\nAll tests passed — stopping sandbox.');
    try { await sb.stop(); } catch (err) { log(`stop error: ${err.message}`); }
  }

  return { baseUrl, commit: commit.result.trim(), results, failed };
}

main().then((summary) => {
  log(`\nFinal: ${summary.failed ? 'FAILED' : 'OK'}`);
  process.exit(summary.failed ? 1 : 0);
}).catch((err) => {
  log(`\nOrchestrator error: ${err.stack || err.message}`);
  process.exit(1);
});
