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
 * - Build script and GitHub Actions workflow are structurally sound
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
assert.ok(buildScript.includes('--platform linux/amd64'), 'build script should include amd64 platform');
assert.ok(buildScript.includes('--platform linux/amd64,linux/arm64'), 'build script should include multi-arch platform');
assert.ok(buildScript.includes('--push'), 'build script should support --push flag');
assert.ok(buildScript.includes('--load'), 'build script should use --load for local build');
assert.ok(buildScript.includes('docker buildx'), 'build script should use docker buildx');

// GitHub Actions workflow validates the Docker build orchestration without a daemon.
const workflowPath = path.resolve(__dirname, '..', '.github', 'workflows', 'build-dev-image.yml');
assert.ok(fs.existsSync(workflowPath), '.github/workflows/build-dev-image.yml should exist');
const workflow = fs.readFileSync(workflowPath, 'utf8');
assert.ok(workflow.includes('docker/setup-buildx-action@v3'), 'workflow should set up Docker Buildx');
assert.ok(workflow.includes('docker/login-action@v3'), 'workflow should log in to GHCR');
assert.ok(workflow.includes('docker/build-push-action@v5'), 'workflow should build and push image');
assert.ok(workflow.includes('linux/amd64,linux/arm64'), 'workflow should build multi-arch images');
assert.ok(workflow.includes("file: ./hb-forge/Dockerfile"), 'workflow should reference hb-forge/Dockerfile');
assert.ok(workflow.includes("type=raw,value=latest"), 'workflow should tag image as latest');
assert.ok(workflow.includes("type=sha"), 'workflow should tag image with git sha');
assert.ok(workflow.includes('packages: write'), 'workflow should have packages:write permission');
assert.ok(workflow.includes("paths:\n      - 'hb-forge/Dockerfile'"), 'workflow should trigger on Dockerfile changes');

// The project name is consistent across files.
const rebar = read('rebar.config');
assert.ok(readme.includes('hyperbeam-permabrain'), 'README should reference hyperbeam-permabrain project');
assert.ok(rebar.includes('hyperbeam_permabrain'), 'rebar.config should reference hyperbeam_permabrain release');

console.log('hb-forge structural smoke tests passed');
