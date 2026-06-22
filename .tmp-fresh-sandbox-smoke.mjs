import { Daytona } from '@daytona/sdk';
import fs from 'node:fs';
import path from 'node:path';

const daytona = new Daytona();
const logFile = '/home/node/.openclaw/workspace/.hb-fresh-edge-test.log';
fs.writeFileSync(logFile, `# fresh sandbox smoke test ${new Date().toISOString()}\n`);
function log(...parts) {
  const line = parts.join(' ');
  console.log(line);
  fs.appendFileSync(logFile, line + '\n');
}

async function sbExec(sb, cmd, timeout = 60) {
  log(`[sandbox] ${cmd}`);
  const r = await sb.process.executeCommand(cmd, undefined, undefined, timeout);
  const out = (r.result || '').slice(0, 4000);
  if (out) log(out);
  if (r.exitCode !== 0) log(`sandbox exit ${r.exitCode}`);
  return r;
}

async function main() {
  log('Creating fresh Daytona sandbox from daytonaio/sandbox:0.8.0...');
  const sb = await daytona.create({
    language: 'javascript',
    name: `hb-edge-smoke-${Date.now()}`,
    snapshot: 'daytonaio/sandbox:0.8.0',
    envVars: { NODE_ENV: 'development' },
  });
  log(`Created sandbox ${sb.id}`);
  await sb.start();
  log('Sandbox started');

  // Install base deps
  await sbExec(sb, 'apt-get update && apt-get install -y git curl build-essential autoconf libtool pkg-config libssl-dev gcc g++ make erlang-base erlang-dev erlang-parsetools erlang-eunit rebar3 2>&1 | tail -20', 300);

  // Clone and build HyperBEAM
  await sbExec(sb, 'cd /tmp && git clone --branch edge --single-branch https://github.com/permaweb/HyperBEAM.git', 300);
  const hbDir = '/tmp/HyperBEAM';
  const commit = await sbExec(sb, `cd ${hbDir} && git rev-parse --short HEAD`, 30);
  log(`HyperBEAM commit: ${commit.result.trim()}`);

  // Work around GCC 14 warnings-as-errors and missing config.flat
  await sbExec(sb, `cd ${hbDir} && CFLAGS="-Wno-error -Wno-incompatible-pointer-types -Wno-pointer-sign" CXXFLAGS="-Wno-error -Wno-incompatible-pointer-types -Wno-pointer-sign" rebar3 release`, 900);
  await sbExec(sb, `cd ${hbDir} && cp test/config.flat .`, 30);

  // Start HyperBEAM daemon
  await sbExec(sb, `cd ${hbDir}/_build/default/rel/hb && ./bin/hb daemon > /tmp/hb-daemon.log 2>&1 &`, 30);
  await new Promise(r => setTimeout(r, 8000));

  // Verify node up
  const meta = await sbExec(sb, "curl -s http://localhost:8734/~meta@1.0/info | head -c 200", 30);
  log(`meta info: ${meta.result.trim()}`);

  // Clone permabrain
  await sbExec(sb, 'cd /tmp && git clone https://github.com/twilson63/permabrain.git permabrain-insandbox', 300);
  const pbDir = '/tmp/permabrain-insandbox';

  // Install deps (NODE_ENV=development to get dev deps)
  await sbExec(sb, `cd ${pbDir} && NODE_ENV=development npm install`, 300);

  // Recreate the Accept: application/json fetch patch
  const patch = `import fetch, { Request } from 'node-fetch';
const OriginalRequest = Request;
const origFetch = globalThis.fetch || fetch;
function patchedFetch(input, init = {}) {
  if (typeof input === 'string' && input.includes('localhost:8734')) {
    init = { ...init, headers: { ...(init.headers || {}), Accept: 'application/json' } };
  } else if (input instanceof OriginalRequest && input.url.includes('localhost:8734')) {
    const headers = { ...Object.fromEntries(input.headers.entries()), Accept: 'application/json' };
    input = new OriginalRequest(input.url, { method: input.method, body: input.body, headers });
  }
  return origFetch(input, init);
}
if (!globalThis.fetch) { globalThis.fetch = patchedFetch; }
`;
  await sbExec(sb, `cat > ${pbDir}/scripts/hb-json-accept-patch.mjs <<'EOF'\n${patch}\nEOF`, 30);

  const baseEnv = `PERMABRAIN_TRANSPORT=hyperbeam PERMABRAIN_HYPERBEAM_URL=http://localhost:8734 PERMABRAIN_REQUIRE_HYPERBEAM=1 NODE_OPTIONS="--import ./scripts/hb-json-accept-patch.mjs"`;

  const results = {};

  // Live integration test
  const live = await sbExec(sb, `cd ${pbDir} && ${baseEnv} node test/hyperbeam.mjs`, 120);
  results['test/hyperbeam.mjs'] = live.exitCode === 0 ? 'pass' : `fail (exit ${live.exitCode})`;

  // Unit tests
  const unitTests = [
    'test/hb-reference.mjs',
    'test/hb-transport.mjs',
    'test/hb-e2e.mjs',
  ];
  for (const t of unitTests) {
    const r = await sbExec(sb, `cd ${pbDir} && node ${t}`, 120);
    results[t] = r.exitCode === 0 ? 'pass' : `fail (exit ${r.exitCode})`;
  }

  // Recreate reference probes inside sandbox
  const liveProbe = `import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initState } from '../src/config.mjs';
import { ensureIdentity } from '../src/keys.mjs';
import { HyperbeamTransport } from '../src/transport.mjs';
const baseUrl = process.argv[2] || 'http://localhost:8734';
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-live-ref-probe-'));
process.env.PERMABRAIN_HOME = home;
process.env.PERMABRAIN_TRANSPORT = 'hyperbeam';
process.env.PERMABRAIN_HYPERBEAM_URL = baseUrl;
initState({ env: process.env });
const { identity } = await ensureIdentity(home, { keyType: 'ed25519' });
const config = {
  gateway: { dataUrl: baseUrl, graphqlUrl: baseUrl + '/graphql' },
  bundler: { uploadUrl: baseUrl + '/~bundler@1.0/tx?codec-device=ans104@1.0' },
};
const transport = new HyperbeamTransport(config);
const key = 'subject/live-ref-probe-' + Date.now().toString(36);
const v1 = 'article-v1-' + Date.now().toString(36);
const v2 = 'article-v2-' + Date.now().toString(36);
const created = await transport.createArticleReference(key, v1, identity);
let resolved = await transport.resolveReference(created.referenceId);
const updated = await transport.updateArticleReference(created.referenceId, v2, identity);
resolved = await transport.resolveReference(created.referenceId);
const ok = resolved && (resolved['current-version'] === v2 || resolved === v2);
console.log(ok ? 'LIVE REFERENCE PROBE OK' : 'LIVE REFERENCE PROBE FAILED');
fs.rmSync(home, { recursive: true, force: true });
process.exit(ok ? 0 : 1);
`;
  const directProbe = `const baseUrl = process.argv[2] || 'http://localhost:8734';
async function device(path, method='GET', body) {
  const init = { method, headers: { Accept: 'application/json' } };
  if (body) { init.headers['Content-Type']='application/json'; init.body=JSON.stringify(body); }
  const res = await fetch(baseUrl + path, init);
  return { status: res.status, text: await res.text() };
}
const probeValue = 'probe-' + Date.now();
const post = await device('/~reference@1.0', 'POST', { value: probeValue });
const list = await device('/~reference@1.0');
const ok = post.status === 200 && list.status === 200;
console.log(ok ? 'DIRECT REFERENCE PROBE OK' : 'DIRECT REFERENCE PROBE FAILED');
process.exit(ok ? 0 : 1);
`;
  await sbExec(sb, `cat > ${pbDir}/scripts/hb-live-reference-probe.mjs <<'PROBE_EOF'\n${liveProbe}\nPROBE_EOF`, 30);
  await sbExec(sb, `cat > ${pbDir}/scripts/hb-direct-reference-test.mjs <<'DIRECT_EOF'\n${directProbe}\nDIRECT_EOF`, 30);

  const liveRef = await sbExec(sb, `cd ${pbDir} && ${baseEnv} node scripts/hb-live-reference-probe.mjs http://localhost:8734`, 120);
  results['live-reference-probe (bundler)'] = liveRef.exitCode === 0 ? 'ok' : `fail (exit ${liveRef.exitCode})`;

  const directRef = await sbExec(sb, `cd ${pbDir} && node scripts/hb-direct-reference-test.mjs http://localhost:8734`, 60);
  results['live-reference-probe (direct JSON)'] = directRef.exitCode === 0 ? 'ok' : `fail (exit ${directRef.exitCode})`;

  log('\n=== FRESH SANDBOX RESULTS ===');
  for (const [k, v] of Object.entries(results)) log(`${k}: ${v}`);

  const failed = Object.values(results).some(v => v.startsWith('fail'));
  log(`\nFinal: ${failed ? 'FAILED' : 'OK'}`);
  if (!failed) {
    try { await sb.stop(); } catch (e) { log(`stop error: ${e.message}`); }
  } else {
    log('Tests failed — keeping sandbox running for debugging.');
    fs.writeFileSync('/home/node/.openclaw/workspace/.hb-fresh-edge-sandbox-id.log', sb.id);
  }
}

main().catch(err => {
  log(`\nOrchestrator error: ${err.stack || err.message}`);
  process.exit(1);
});
