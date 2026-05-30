import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const requireHyperbeam = process.env.PERMABRAIN_REQUIRE_HYPERBEAM === '1';
const requireNetwork = process.env.PERMABRAIN_REQUIRE_NETWORK === '1';
const url = process.env.PERMABRAIN_HYPERBEAM_URL || 'http://localhost:10000';

function run(args, env) {
  return spawnSync(process.execPath, ['scripts/cli.mjs', ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
}

function skip(message) {
  if (requireHyperbeam) throw new Error(message);
  console.log(`${message}; skipping Wikipedia+HyperBEAM E2E test`);
  process.exit(0);
}

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-wiki-'));
const probe = run(['probe-hyperbeam', '--url', url, '--json'], { PERMABRAIN_HOME: tempHome });
if (probe.status !== 0) skip(`HyperBEAM probe failed: ${probe.stderr}`);
const probeJson = JSON.parse(probe.stdout);
const check = (name) => probeJson.checks.find((c) => c.name === name);
if (!check('health')?.ok || !check('graphql')?.ok || !check('upload')?.ok) skip('HyperBEAM is unavailable or lacks required GraphQL/upload routes');

try {
  const wiki = await fetch('https://en.wikipedia.org/api/rest_v1/page/summary/Ada_Lovelace');
  if (!wiki.ok) throw new Error(`Wikipedia HTTP ${wiki.status}`);
} catch (err) {
  const msg = `Wikipedia unavailable: ${err.message}`;
  if (requireNetwork) throw new Error(msg);
  console.log(`${msg}; skipping Wikipedia network test`);
  process.exit(0);
}

const env = { PERMABRAIN_HOME: tempHome, PERMABRAIN_HYPERBEAM_URL: url };
let res = run(['init'], env);
assert.equal(res.status, 0, res.stderr);
for (const [title, kind, topic] of [
  ['Ada Lovelace', 'person', 'computing'],
  ['Arweave', 'organization', 'web3'],
  ['Artificial intelligence', 'subject', 'ai']
]) {
  res = run(['import-wikipedia', title, '--kind', kind, '--topic', topic, '--json'], env);
  assert.equal(res.status, 0, res.stderr);
}
res = run(['query', '--topic', 'computing', '--json'], env);
assert.equal(res.status, 0, res.stderr);
assert.ok(JSON.parse(res.stdout).some((a) => a.key === 'person/ada-lovelace'));
res = run(['query', '--kind', 'subject', '--json'], env);
assert.equal(res.status, 0, res.stderr);
assert.ok(JSON.parse(res.stdout).some((a) => a.key === 'subject/artificial-intelligence'));
res = run(['get', 'person/ada-lovelace'], env);
assert.equal(res.status, 0, res.stderr);
assert.match(res.stdout, /Wikipedia/);
res = run(['attest', 'person/ada-lovelace', '--valid', '--confidence', '0.95', '--reason', 'Source-backed Wikipedia import'], env);
assert.equal(res.status, 0, res.stderr);
res = run(['consensus', 'person/ada-lovelace', '--json'], env);
assert.equal(res.status, 0, res.stderr);
assert.ok(JSON.parse(res.stdout).totalAttestations >= 1);
res = run(['sync', '--json'], env);
assert.equal(res.status, 0, res.stderr);
const index = JSON.parse(res.stdout);
for (const key of ['person/ada-lovelace', 'organization/arweave', 'subject/artificial-intelligence']) assert.ok(index.articles[key]);
console.log('Wikipedia+HyperBEAM E2E passed');
