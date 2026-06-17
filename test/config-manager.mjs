/**
 * Test: config-manager.mjs — get/set/validate/env/reset and API wiring.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const { api } = await import(path.join(root, 'src/index.mjs'));
const {
  runConfigCommand, loadEffectiveConfig, validateConfig, configToMarkdown,
  getConfigValue, setConfigValue, ENV_MAP, flattenConfig
} = await import(path.join(root, 'src/config-manager.mjs'));

function tmpHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pb-config-test-'));
}

console.log('1. loadEffectiveConfig falls back to defaultConfig when missing');
{
  const home = tmpHome();
  const { config, sources } = loadEffectiveConfig(home);
  assert.ok(config.transport, 'has transport');
  assert.ok(config.gateway, 'has gateway');
  assert.ok(config.bundler, 'has bundler');
  assert.equal(sources.transport, undefined, 'no env overrides by default');
  fs.rmSync(home, { recursive: true, force: true });
}
console.log('   ✓ Default config loads');

console.log('2. env overrides default transport');
{
  const home = tmpHome();
  process.env.PERMABRAIN_TRANSPORT = 'hyperbeam';
  process.env.PERMABRAIN_HYPERBEAM_URL = 'http://127.0.0.1:9000';
  const { config, sources } = loadEffectiveConfig(home);
  assert.equal(config.transport, 'hyperbeam');
  assert.equal(config.gateway.dataUrl, 'http://127.0.0.1:9000');
  assert.ok(config.bundler.uploadUrl.includes('bundler@1.0'));
  assert.equal(sources.transport.from, 'env');
  delete process.env.PERMABRAIN_TRANSPORT;
  delete process.env.PERMABRAIN_HYPERBEAM_URL;
  fs.rmSync(home, { recursive: true, force: true });
}
console.log('   ✓ Env vars override defaults');

console.log('3. getConfigValue / setConfigValue dotted paths');
{
  const config = { a: { b: { c: 1 } } };
  const r1 = getConfigValue(config, 'a.b.c');
  assert.equal(r1.value, 1);
  assert.equal(r1.exists, true);
  const r2 = getConfigValue(config, 'a.b.missing');
  assert.equal(r2.exists, false);
  setConfigValue(config, 'a.b.d', 'hello');
  assert.equal(config.a.b.d, 'hello');
  setConfigValue(config, 'x.y.z', true);
  assert.equal(config.x.y.z, true);
}
console.log('   ✓ Dotted path helpers work');

console.log('4. validateConfig flags missing URLs for arweave transport');
{
  const bad = validateConfig({ transport: 'arweave', gateway: {}, bundler: {} });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some(e => e.includes('graphqlUrl')));
  assert.ok(bad.errors.some(e => e.includes('dataUrl')));
  assert.ok(bad.errors.some(e => e.includes('uploadUrl')));
}
console.log('   ✓ Validation catches missing URLs');

console.log('5. validateConfig accepts local transport');
{
  const ok = validateConfig({ transport: 'local', version: '0.1.0', gateway: { type: 'local' }, bundler: { type: 'local' } });
  assert.equal(ok.ok, true);
  assert.equal(ok.errors.length, 0);
}
console.log('   ✓ Local config validates');

console.log('6. runConfigCommand reset creates valid default config');
{
  const home = tmpHome();
  const result = runConfigCommand({ action: 'reset', home });
  assert.ok(result.config, 'reset returns config');
  const saved = JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf8'));
  assert.equal(saved.transport, result.config.transport);
  fs.rmSync(home, { recursive: true, force: true });
}
console.log('   ✓ Reset writes defaults');

console.log('7. runConfigCommand set updates config.json');
{
  const home = tmpHome();
  runConfigCommand({ action: 'reset', home });
  const result = runConfigCommand({ action: 'set', path: 'transport', value: 'local', home });
  assert.equal(result.path, 'transport');
  assert.equal(result.value, 'local');
  assert.equal(result.validation.ok, true);
  const saved = JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf8'));
  assert.equal(saved.transport, 'local');
  fs.rmSync(home, { recursive: true, force: true });
}
console.log('   ✓ Set persists value');

console.log('8. runConfigCommand set rejects invalid enum value');
{
  const home = tmpHome();
  runConfigCommand({ action: 'reset', home });
  assert.throws(() => runConfigCommand({ action: 'set', path: 'transport', value: 'invalid', home }), /Validation failed/);
  fs.rmSync(home, { recursive: true, force: true });
}
console.log('   ✓ Invalid enum rejected');

console.log('9. runConfigCommand get returns full config or single path');
{
  const home = tmpHome();
  runConfigCommand({ action: 'reset', home });
  const full = runConfigCommand({ action: 'get', home });
  assert.ok(full.config.transport, 'full config has transport');
  const single = runConfigCommand({ action: 'get', path: 'transport', home });
  assert.equal(single.exists, true);
  assert.equal(single.value, full.config.transport);
  fs.rmSync(home, { recursive: true, force: true });
}
console.log('   ✓ Get works full and single');

console.log('10. runConfigCommand validate returns errors/warnings');
{
  const home = tmpHome();
  runConfigCommand({ action: 'reset', home });
  const v = runConfigCommand({ action: 'validate', home });
  assert.equal(typeof v.ok, 'boolean');
  assert.ok(Array.isArray(v.errors));
  assert.ok(Array.isArray(v.warnings));
  fs.rmSync(home, { recursive: true, force: true });
}
console.log('   ✓ Validate returns structured report');

console.log('11. runConfigCommand env lists variables');
{
  const result = runConfigCommand({ action: 'env', home: tmpHome() });
  assert.ok(result.env.PERMABRAIN_TRANSPORT, 'env entry exists');
  assert.equal(result.env.PERMABRAIN_TRANSPORT.mapsTo, 'transport');
}
console.log('   ✓ Env listing works');

console.log('12. configToMarkdown renders markdown');
{
  const md = configToMarkdown({ transport: 'arweave', version: '0.2.0', gateway: { dataUrl: 'https://arweave.net' } });
  assert.ok(md.includes('PermaBrain Configuration'));
  assert.ok(md.includes('transport:'));
  assert.ok(md.includes('gateway.dataUrl'));
}
console.log('   ✓ Markdown rendering works');

console.log('13. flattenConfig produces flat list');
{
  const flat = flattenConfig({ a: { b: 1 }, c: 'x' });
  const paths = flat.map(f => f.path);
  assert.ok(paths.includes('a.b'));
  assert.ok(paths.includes('c'));
}
console.log('   ✓ Flatten works');

console.log('14. api.config() wrapper exists and runs get');
{
  const home = tmpHome();
  await api.init({ keyType: 'ed25519', transport: 'local', homeEnv: home });
  // The api.init above does not override our tmp home; loadConfig resolves via getHome() which is cwd-based.
  // Force it by setting PERMABRAIN_HOME temporarily.
  process.env.PERMABRAIN_HOME = home;
  await api.init({ keyType: 'ed25519', transport: 'local' });
  const result = await api.config({ action: 'get' });
  assert.ok(result.config, 'api.config returns config');
  delete process.env.PERMABRAIN_HOME;
  fs.rmSync(home, { recursive: true, force: true });
}
console.log('   ✓ api.config() available and functional');

console.log('15. api.config() set validates and persists');
{
  const home = tmpHome();
  process.env.PERMABRAIN_HOME = home;
  await api.init({ keyType: 'ed25519', transport: 'local' });
  const setResult = await api.config({ action: 'set', path: 'transport', value: 'local' });
  assert.equal(setResult.value, 'local');
  const saved = JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf8'));
  assert.equal(saved.transport, 'local');
  delete process.env.PERMABRAIN_HOME;
  fs.rmSync(home, { recursive: true, force: true });
}
console.log('   ✓ api.config set persists');

console.log('\n✅ All config-manager tests passed');
