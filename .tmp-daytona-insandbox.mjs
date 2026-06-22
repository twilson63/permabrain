import { Daytona } from '@daytona/sdk';
const daytona = new Daytona();
const sb = await daytona.get('b8625c83-5123-4265-93e6-b80894973f20');
try { await sb.start(); } catch(e) {}

const baseUrl = 'http://localhost:8734';
const repoDir = '/tmp/permabrain-insandbox';

async function run(cmd, timeout = 60) {
  console.log('\u003e\u003e\u003e', cmd);
  const r = await sb.process.executeCommand(cmd, undefined, undefined, timeout);
  console.log(r.result.slice(-4000));
  if (r.exitCode !== 0) throw new Error(`Command failed: ${cmd} exit ${r.exitCode}`);
  return r;
}

// Clone repo (public)
await run(`rm -rf ${repoDir} \u0026\u0026 git clone --depth 1 https://github.com/twilson63/permabrain.git ${repoDir}`, 120);

// Install deps including dev (NODE_ENV=production was set in env; override)
await run(`cd ${repoDir} \u0026\u0026 unset NODE_ENV \u0026\u0026 npm install --include=dev --no-audit --no-fund`, 180);

const patchFile = `${repoDir}/scripts/hb-json-accept-patch.mjs`;
const testHome = `/tmp/permabrain-insandbox-home-${Date.now()}`;

// Init identity
await run(`mkdir -p ${testHome} \u0026\u0026 cd ${repoDir} \u0026\u0026 PERMABRAIN_HOME=${testHome} NODE_OPTIONS="--import ${patchFile}" node scripts/cli.mjs init --key-type ed25519 --json`, 60);

const baseEnv = `PERMABRAIN_HOME=${testHome} PERMABRAIN_TRANSPORT=hyperbeam PERMABRAIN_HYPERBEAM_URL=${baseUrl} PERMABRAIN_REQUIRE_HYPERBEAM=1 NODE_OPTIONS="--import ${patchFile}"`;

// Probe hyperbeam
await run(`cd ${repoDir} \u0026\u0026 ${baseEnv} node scripts/cli.mjs probe-hyperbeam --url ${baseUrl} --json`, 60);

// Run live integration test
const live = await sb.process.executeCommand(`cd ${repoDir} \u0026\u0026 ${baseEnv} node test/hyperbeam.mjs`, undefined, undefined, 120);
console.log('LIVE TEST exit', live.exitCode);
console.log(live.result.slice(-4000));

// Run unit tests
for (const t of ['test/hb-reference.mjs', 'test/hb-transport.mjs', 'test/hb-e2e.mjs']) {
  const r = await sb.process.executeCommand(`cd ${repoDir} \u0026\u0026 NODE_OPTIONS="--import ${patchFile}" node ${t}`, undefined, undefined, 120);
  console.log(t, 'exit', r.exitCode);
  console.log(r.result.slice(-2000));
}

// article-hb-reference uses localhost:10000 mocks
const article = await sb.process.executeCommand(`cd ${repoDir} \u0026\u0026 PERMABRAIN_HYPERBEAM_URL=http://localhost:10000 NODE_OPTIONS="--import ${patchFile}" node test/article-hb-reference.mjs`, undefined, undefined, 120);
console.log('article-hb-reference exit', article.exitCode);

// Live reference probe
const probe = await sb.process.executeCommand(`cd ${repoDir} \u0026\u0026 ${baseEnv} node scripts/hb-live-reference-probe.mjs ${baseUrl}`, undefined, undefined, 120);
console.log('reference probe exit', probe.exitCode);
console.log(probe.result.slice(-2000));

// Direct JSON reference probe
const direct = await sb.process.executeCommand(`cd ${repoDir} \u0026\u0026 echo ${baseUrl} \u003e .hb-edge-url \u0026\u0026 node scripts/hb-direct-reference-test.mjs`, undefined, undefined, 60);
console.log('direct probe exit', direct.exitCode);
console.log(direct.result.slice(-2000));
