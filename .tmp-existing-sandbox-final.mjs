import { Daytona } from '@daytona/sdk';
import fs from 'node:fs';

const daytona = new Daytona();
const sb = await daytona.get('b8625c83-5123-4265-93e6-b80894973f20');
try { await sb.start(); } catch(e) {}

const baseUrl = 'http://localhost:8734';
const repoDir = '/tmp/permabrain-insandbox';
const patchPath = `${repoDir}/scripts/hb-json-accept-patch.mjs`;
const baseEnv = `PERMABRAIN_TRANSPORT=hyperbeam PERMABRAIN_HYPERBEAM_URL=${baseUrl} PERMABRAIN_REQUIRE_HYPERBEAM=1 NODE_OPTIONS="--import ${patchPath}"`;

const commit = await sb.process.executeCommand(`cd /tmp/HyperBEAM && git rev-parse --short HEAD`, undefined, undefined, 30);
console.log('HyperBEAM commit:', commit.result.trim());

const results = {};

async function run(name, cmd, timeout = 120) {
  const r = await sb.process.executeCommand(cmd, undefined, undefined, timeout);
  results[name] = r.exitCode === 0 ? 'pass' : `fail (exit ${r.exitCode})`;
  console.log(`\n=== ${name} (exit ${r.exitCode}) ===`);
  console.log(r.result.slice(-2500));
}

await run('test/hyperbeam.mjs', `cd ${repoDir} && ${baseEnv} node test/hyperbeam.mjs`, 120);
await run('test/hb-reference.mjs', `cd ${repoDir} && node test/hb-reference.mjs`, 120);
await run('test/hb-transport.mjs', `cd ${repoDir} && node test/hb-transport.mjs`, 120);
await run('test/hb-e2e.mjs', `cd ${repoDir} && node test/hb-e2e.mjs`, 120);
await run('live-reference-probe (bundler)', `cd ${repoDir} && ${baseEnv} node scripts/hb-live-reference-probe.mjs ${baseUrl}`, 120);
await run('live-reference-probe (direct JSON)', `cd ${repoDir} && node scripts/hb-direct-reference-test.mjs ${baseUrl}`, 60);

console.log('\n=== FINAL RESULTS ===');
for (const [k, v] of Object.entries(results)) console.log(`${k}: ${v}`);

const failed = Object.values(results).some(v => v.startsWith('fail'));
console.log(`\nOverall: ${failed ? 'FAILED' : 'OK'}`);
process.exit(failed ? 1 : 0);
