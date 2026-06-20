import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { api } from '../src/agent-api.mjs';
import { createClient } from '../src/client.mjs';
import { startServer, stopServer } from '../src/serve.mjs';

const tmpBase = mkdtempSync(join(tmpdir(), 'permabrain-health-'));
const homeA = join(tmpBase, 'a');

function run(args) {
  return execSync(`node ${join(process.cwd(), 'scripts/cli.mjs')} ${args}`, {
    cwd: homeA,
    encoding: 'utf8',
    env: { ...process.env, PERMABRAIN_HOME: homeA, PERMABRAIN_TRANSPORT: 'local' }
  }).trim();
}

console.log('1. health API exists');
assert.equal(typeof api.health, 'function', 'api.health is a function');
console.log('   ✓ api.health exists');

console.log('2. local health without init returns useful error');
try {
  await api.health();
  assert.fail('should throw when not initialized');
} catch (e) {
  assert.match(e.message, /not initialized|Call api.init/);
}
console.log('   ✓ local health requires init');

console.log('3. init and local health report');
await api.init({ keyType: 'ed25519', home: homeA, transport: 'local' });
const local = await api.health();
assert.equal(local.ok, true, 'local health ok');
assert.equal(typeof local.agentId, 'string');
assert.equal(local.home, homeA);
assert.equal(local.transport, 'local');
assert.equal(local.version, '0.2.0');
assert.ok(Array.isArray(local.checks), 'checks array present');
assert.ok(local.checks.length > 0, 'checks non-empty');
console.log('   ✓ local health report shape good');

console.log('4. remote health via URL against a running server');
const server = await startServer({ home: homeA, port: 0, config: { transport: 'local' } });
const baseUrl = `http://localhost:${server.port}`;
const remote = await api.health({ url: baseUrl });
assert.equal(remote.ok, true, 'remote health ok');
assert.equal(remote.remote.ok, true, 'remote server ok');
assert.equal(remote.remote.home, homeA);
assert.equal(typeof remote.remote.agentId, 'string');
await stopServer(server.server);
console.log('   ✓ remote health via URL works');

console.log('5. health markdown output');
const md = await api.health({ markdown: true });
assert.ok(md.markdown, 'markdown field present');
assert.match(md.markdown, /PermaBrain health/i);
console.log('   ✓ markdown output works');

console.log('6. health with useHyperbeam falls back gracefully in local mode');
const hb = await api.health({ useHyperbeam: true });
assert.equal(typeof hb.ok, 'boolean');
console.log('   ✓ hyperbeam flag accepted');

console.log('7. CLI permabrain health --help');
const help = run('health --help');
assert.match(help, /health/i);
console.log('   ✓ CLI help works');

console.log('8. CLI permabrain health local output');
const out = run('health');
assert.match(out, /PermaBrain health/i);
assert.match(out, /ok/i);
console.log('   ✓ CLI local health output works');

console.log('9. CLI permabrain health --json');
const jsonOut = run('health --json');
const parsed = JSON.parse(jsonOut);
assert.equal(parsed.ok, true);
assert.equal(parsed.home, homeA);
console.log('   ✓ CLI JSON output works');

console.log('10. CLI permabrain health --url parses and attempts remote fetch');
const badRemote = run('health --url http://localhost:1 --json');
const badParsed = JSON.parse(badRemote);
assert.equal(badParsed.remote.ok, false);
assert.ok(badParsed.remote.error, 'remote error present');
console.log('   ✓ CLI remote URL option works (reports failure for unreachable host)');

console.log('✅ All health tests passed');
