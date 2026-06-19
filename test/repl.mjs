/**
 * Test: Interactive REPL (api.repl() + permabrain shell)
 *
 * Verifies that the REPL exposes the agent API, evaluates JavaScript and
 * async API calls, persists history, and provides tab completion for api/pb
 * methods.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable, PassThrough } from 'node:stream';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { api } from '../src/agent-api.mjs';
import { createRepl, readHistory, writeHistory, buildApiCompleter } from '../src/repl.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function makeStreams(lines = []) {
  const input = new PassThrough();
  const output = new PassThrough();
  let data = '';
  output.on('data', chunk => { data += chunk.toString(); });
  return { input, output, data: () => data, send: (line) => input.write(`${line}\n`) };
}

function tmpHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-repl-'));
}

function stripAnsi(str) {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

// --- 1. REPL helpers exist ---
console.log('1. REPL helpers exist');
assert.equal(typeof createRepl, 'function', 'createRepl exported');
assert.equal(typeof readHistory, 'function', 'readHistory exported');
assert.equal(typeof writeHistory, 'function', 'writeHistory exported');
assert.equal(typeof buildApiCompleter, 'function', 'buildApiCompleter exported');
assert.equal(typeof api.repl, 'function', 'api.repl is a function');
console.log('   ✓ REPL helpers exported');

// --- 2. History read/write ---
console.log('2. History read/write');
const histDir = tmpHome();
const histPath = path.join(histDir, 'history.jsonl');
writeHistory(histPath, ['1 + 1', 'api.query({topic:\'ai\'})', 'pb.status()'], 10);
const hist = readHistory(histPath, 10);
assert.deepEqual(hist, ['1 + 1', 'api.query({topic:\'ai\'})', 'pb.status()'], 'history round-trips');
console.log('   ✓ History persists to JSONL');

// --- 3. api-aware completer ---
console.log('3. api-aware completer');
const completer = buildApiCompleter(api);
await new Promise((resolve, reject) => {
  completer('api.pub', (err, [hits, line]) => {
    if (err) return reject(err);
    assert.ok(hits.includes('api.publish'), 'completes api.publish');
    assert.equal(line, 'api.pub');
    resolve();
  });
});
await new Promise((resolve, reject) => {
  completer('pb.que', (err, [hits, line]) => {
    if (err) return reject(err);
    assert.ok(hits.includes('pb.query'), 'completes pb.query');
    assert.equal(line, 'pb.que');
    resolve();
  });
});
console.log('   ✓ Completer suggests api/pb methods');

// --- 4. Programmatic REPL evaluates JS and API calls ---
console.log('4. Programmatic REPL evaluates JS and API calls');
const home = tmpHome();
process.env.PERMABRAIN_HOME = home;
try {
  await api.init({ keyType: 'ed25519' });
} catch (err) {
  console.error('init failed', err);
  throw err;
}

const s1 = makeStreams();
const replPromise = createRepl({
  api,
  home,
  input: s1.input,
  output: s1.output,
  terminal: false,
  useColors: false,
  historyPath: path.join(home, 'repl-history.jsonl'),
  prompt: ''
});
s1.send('1 + 1');
s1.send('api.identity.agentId');
s1.send('.exit');
s1.input.end();
await replPromise;
const out1 = stripAnsi(s1.data());
assert.match(out1, /2/, 'REPL evaluated 1+1');
assert.match(out1, /[A-Za-z0-9_-]{20,}/, 'REPL printed agentId');
console.log('   ✓ REPL evaluated JS and API identity');

// --- 5. History persisted after REPL session ---
console.log('5. History persisted after REPL session');
const replayHist = readHistory(path.join(home, 'repl-history.jsonl'));
assert.ok(replayHist.includes('1 + 1'), 'history includes 1 + 1');
assert.ok(replayHist.includes('api.identity.agentId'), 'history includes api.identity.agentId');
console.log('   ✓ REPL history persisted');

// --- 6. CLI `permabrain shell --help` ---
console.log('6. CLI permabrain shell --help');
const help = await new Promise((resolve, reject) => {
  const child = spawn('node', [path.join(root, 'scripts/cli.mjs'), 'shell', '--help'], {
    cwd: root,
    env: { ...process.env, PERMABRAIN_HOME: home }
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', d => { stdout += d; });
  child.stderr.on('data', d => { stderr += d; });
  child.on('close', code => {
    if (code !== 0) return reject(new Error(`shell --help exited ${code}: ${stderr}`));
    resolve(stdout);
  });
});
assert.match(help, /Usage:\s+permabrain shell/, 'shell help shows usage');
assert.match(help, /interactive REPL/, 'shell help mentions REPL');
console.log('   ✓ CLI shell --help works');

// --- 7. CLI `permabrain shell` non-interactive eval via piped input ---
console.log('7. CLI permabrain shell non-interactive eval');
const childHome = tmpHome();
process.env.PERMABRAIN_HOME = childHome;
await api.init({ keyType: 'ed25519' }); // ensure childHome has identity
const shellOut = await new Promise((resolve, reject) => {
  const child = spawn('node', [path.join(root, 'scripts/cli.mjs'), 'shell'], {
    cwd: root,
    env: { ...process.env, PERMABRAIN_HOME: childHome }
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', d => { stdout += d; });
  child.stderr.on('data', d => { stderr += d; });
  child.on('close', code => {
    if (code !== 0) return reject(new Error(`shell exited ${code}: ${stderr}\nstdout: ${stdout}`));
    resolve(stdout);
  });
  setTimeout(() => {
    child.stdin.write('typeof api.publish\n');
    child.stdin.write('.exit\n');
    child.stdin.end();
  }, 500);
});
assert.match(stripAnsi(shellOut), /function/, 'shell CLI printed "function" for typeof api.publish');
console.log('   ✓ CLI shell accepts piped commands');

console.log('\n✓ All REPL tests passed');
