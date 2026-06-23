/**
 * HyperBEAM Forge device package structural smoke tests.
 *
 * This environment does not have Erlang/OTP or rebar3 installed, so we cannot
 * run `rebar3 device test` directly. Instead this test verifies:
 * - All required hb-forge project files exist (app src, config, device modules, tests)
 * - Each .erl module declares the expected exports
 * - The consensus device uses _Opts or #{} consistently (no unbound variables)
 * - The query device exposes build_query_path/3 for EUnit tests
 * - Device metadata functions are present
 *
 * When a full Erlang toolchain is available (Docker dev image or CI), run:
 *   rebar3 device test
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const forgeDir = path.resolve(__dirname, '..', 'hb-forge');

function read(rel) {
  return fs.readFileSync(path.join(forgeDir, rel), 'utf8');
}

function moduleExports(rel) {
  const text = read(rel);
  const m = text.match(/-export\(\[([^\]]*)\]\)\./s);
  if (!m) return [];
  return m[1].split(',').map((s) => s.replace(/\s|\n/g, '').split('/')[0]).filter(Boolean);
}

function hasFunction(rel, name, arity) {
  const text = read(rel);
  const exportRe = new RegExp(`-export\\(\\[[^\\]]*${name}/${arity}[^\\]]*\\]\\)\\.`, 's');
  const clauseRe = new RegExp(`^${name}\\(`, 'm');
  return exportRe.test(text) && clauseRe.test(text);
}

// Required project files exist.
const required = [
  'src/permabrain.app.src',
  'config/sys.config',
  'config/vm.args',
  'rebar.config',
  'src/dev_permabrain_consensus.erl',
  'src/dev_permabrain_query.erl',
  'test/dev_permabrain_consensus_test.erl',
  'test/dev_permabrain_query_test.erl',
  'README.md',
  'Dockerfile',
  'scripts/build-dev-image.sh',
];
for (const f of required) {
  assert.ok(fs.existsSync(path.join(forgeDir, f)), `hb-forge should have ${f}`);
}

// Consensus module exports consensus/2 and info/1.
const consensusExports = moduleExports('src/dev_permabrain_consensus.erl');
assert.ok(consensusExports.includes('consensus'), 'consensus module should export consensus/2');
assert.ok(consensusExports.includes('info'), 'consensus module should export info/1');
assert.ok(hasFunction('src/dev_permabrain_consensus.erl', 'consensus', 2), 'consensus/2 function should exist');
assert.ok(hasFunction('src/dev_permabrain_consensus.erl', 'info', 1), 'info/1 function should exist');

// Query module exports query/2, attestations/2, resolve/2, info/1, build_query_path/3.
const queryExports = moduleExports('src/dev_permabrain_query.erl');
for (const name of ['query', 'attestations', 'resolve', 'info', 'build_query_path']) {
  assert.ok(queryExports.includes(name), `query module should export ${name}`);
}

// No unbound Opts variable in consensus module (was a previous bug).
const consensusText = read('src/dev_permabrain_consensus.erl');
assert.ok(!/\bOpts\b/.test(consensusText), 'consensus module should not contain unbound Opts variable; use _Opts or #{}');

// Device metadata is present in both modules.
for (const [rel, expectedDevice] of [
  ['src/dev_permabrain_consensus.erl', 'permabrain-consensus'],
  ['src/dev_permabrain_query.erl', 'permabrain-query'],
]) {
  const text = read(rel);
  assert.ok(text.includes(`device => <<"${expectedDevice}">>`), `${rel} should set device name`);
  assert.ok(text.includes('version => <<"1.0.0">>'), `${rel} should set version`);
}

// README describes the expected device usage and Docker quickstart.
const readme = read('README.md');
assert.ok(readme.includes('permabrain-consensus@1.0'), 'README should mention consensus device');
assert.ok(readme.includes('permabrain-query@1.0'), 'README should mention query device');
assert.ok(readme.includes('rebar3 device test'), 'README should reference rebar3 device test');
assert.ok(readme.includes('docker build'), 'README should reference docker build');

// Dockerfile and build script reference the correct paths.
const dockerfile = read('Dockerfile');
assert.ok(dockerfile.includes('rebar3 device test'), 'Dockerfile should document device test command');
assert.ok(dockerfile.includes('/work'), 'Dockerfile should set /work as working directory');

const buildScript = read('scripts/build-dev-image.sh');
assert.ok(buildScript.includes('hb-forge/Dockerfile'), 'build script should reference hb-forge/Dockerfile');

console.log('hb-forge structural smoke tests passed');
