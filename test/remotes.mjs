/**
 * Test: Named remotes management
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { initState, getHome, statePaths } from '../src/config.mjs';
import { ensureIdentity } from '../src/keys.mjs';
import {
  listRemotes,
  addRemote,
  removeRemote,
  setDefaultRemote,
  probeRemote,
  queryRemote,
  syncRemote,
  remotesToMarkdown,
  buildRemoteConfig
} from '../src/remotes.mjs';
import { api } from '../src/index.mjs';
import { runCommand } from '../src/commands.mjs';

function tmpHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pb-remotes-'));
}

function setupHome(home) {
  process.env.PERMABRAIN_HOME = home;
  initState();
  ensureIdentity(home, { keyType: 'ed25519' });
}

function mockTransport(items) {
  return {
    queryByTags: async (filters) => items.filter((item) => {
      const tags = Object.fromEntries((item.tags || []).map((t) => [t.name, t.value]));
      return Object.entries(filters).every(([k, v]) => tags[k] === String(v));
    }),
    fetchDataItem: async (id) => items.find((i) => i.id === id),
    probe: async () => ({ ok: true, transport: 'mock', checks: [{ name: 'mock', ok: true }] })
  };
}

console.log('1. listRemotes empty');
{
  const home = tmpHome();
  setupHome(home);
  const data = listRemotes(home);
  assert.equal(data.defaultRemote, null);
  assert.deepEqual(Object.keys(data.remotes), []);
  console.log('   ✓ Empty remotes list');
}

console.log('2. addRemote requires url');
{
  const home = tmpHome();
  setupHome(home);
  assert.throws(() => addRemote('origin', {}, home), /requires url/);
  console.log('   ✓ addRemote validates url');
}

console.log('3. addRemote and list');
{
  const home = tmpHome();
  setupHome(home);
  const result = addRemote('origin', { url: 'http://localhost:10000', transport: 'hyperbeam', description: 'local hb' }, home);
  assert.ok(result.added);
  assert.equal(result.remote.name, 'origin');
  assert.equal(result.remote.url, 'http://localhost:10000');
  assert.equal(result.defaultRemote, 'origin');
  const data = listRemotes(home);
  assert.equal(data.remotes.origin.url, 'http://localhost:10000');
  console.log('   ✓ addRemote stores remote and sets default');
}

console.log('4. setDefaultRemote');
{
  const home = tmpHome();
  setupHome(home);
  addRemote('one', { url: 'http://one' }, home);
  addRemote('two', { url: 'http://two' }, home);
  assert.equal(listRemotes(home).defaultRemote, 'one');
  setDefaultRemote('two', home);
  assert.equal(listRemotes(home).defaultRemote, 'two');
  console.log('   ✓ default remote can be changed');
}

console.log('5. removeRemote updates default');
{
  const home = tmpHome();
  setupHome(home);
  addRemote('one', { url: 'http://one' }, home);
  addRemote('two', { url: 'http://two' }, home);
  const result = removeRemote('one', home);
  assert.equal(result.defaultRemote, 'two');
  assert.equal(listRemotes(home).remotes.one, undefined);
  console.log('   ✓ remove remote updates default');
}

console.log('6. reserved names rejected');
{
  const home = tmpHome();
  setupHome(home);
  assert.throws(() => addRemote('local', { url: 'http://x' }, home), /reserved/);
  assert.throws(() => addRemote('', { url: 'http://x' }, home), /required/);
  console.log('   ✓ reserved/empty names rejected');
}

console.log('7. buildRemoteConfig');
{
  const home = tmpHome();
  setupHome(home);
  addRemote('ar', { url: 'https://arweave.net', transport: 'arweave' }, home);
  const { config, remote, name } = buildRemoteConfig('ar', home);
  assert.equal(name, 'ar');
  assert.equal(config.transport, 'arweave');
  assert.equal(config.gateway.dataUrl, 'https://arweave.net');
  console.log('   ✓ buildRemoteConfig produces transport config');
}

console.log('8. remotesToMarkdown');
{
  const home = tmpHome();
  setupHome(home);
  addRemote('origin', { url: 'http://localhost:10000', description: 'local' }, home);
  const md = remotesToMarkdown(listRemotes(home));
  assert.match(md, /# PermaBrain Remotes/);
  assert.match(md, /origin/);
  assert.match(md, /default/);
  console.log('   ✓ markdown rendering');
}

console.log('9. probeRemote with mocked transport (via agent api)');
{
  const home = tmpHome();
  setupHome(home);
  addRemote('mock', { url: 'http://mock.test', transport: 'local' }, home);
  const result = await probeRemote('mock', home);
  assert.equal(result.name, 'mock');
  assert.ok(result.ok);
  console.log('   ✓ probe remote works');
}

console.log('10. queryRemote with mocked transport');
{
  const home = tmpHome();
  setupHome(home);
  addRemote('localcache', { url: 'http://local', transport: 'local' }, home);
  const result = await queryRemote('localcache', { 'App-Name': 'PermaBrain' }, home);
  assert.ok(Array.isArray(result));
  console.log('   ✓ query remote works');
}

console.log('11. syncRemote falls back to local with no items');
{
  const home = tmpHome();
  setupHome(home);
  addRemote('localcache', { url: 'http://local', transport: 'local' }, home);
  const result = await syncRemote('localcache', {}, home);
  assert.equal(result.articleCount, 0);
  assert.equal(result.attestationCount, 0);
  console.log('   ✓ sync remote works');
}

console.log('12. api.remote list/add/remove/default/probe');
{
  const home = tmpHome();
  setupHome(home);
  // Reset api singleton state and re-init from disk
  api._home = null;
  api._identity = null;
  api._config = null;
  await api.ensureInit();
  const added = await api.remote('add', { name: 'api-test', url: 'http://api.test', transport: 'arweave' });
  assert.equal(added.remote.name, 'api-test');
  const listed = await api.remote('list');
  assert.equal(listed.remotes['api-test'].url, 'http://api.test');
  const defaulted = await api.remote('default', { name: 'api-test' });
  assert.equal(defaulted.defaultRemote, 'api-test');
  const probed = await api.remote('probe', { name: 'api-test' });
  assert.equal(probed.name, 'api-test');
  const removed = await api.remote('remove', { name: 'api-test' });
  assert.equal(removed.remote.name, 'api-test');
  const afterRemove = await api.remote('list');
  assert.equal(afterRemove.remotes['api-test'], undefined);
  console.log('   ✓ api.remote works');
}

console.log('13. CLI remote command registered and help');
{
  await runCommand('remote', { _: [], help: true });
  console.log('   ✓ CLI remote help registered');
}

console.log('14. CLI remote add/list/remove');
{
  const home = tmpHome();
  setupHome(home);
  const listBefore = await runCommand('remote', { _: ['list'], json: true });
  assert.equal(listBefore.defaultRemote, null);

  await runCommand('remote', { _: ['add', 'cli-test', 'http://cli.test'], json: true });
  const listAfter = await runCommand('remote', { _: ['list'], json: true });
  assert.equal(listAfter.defaultRemote, 'cli-test');

  await runCommand('remote', { _: ['remove', 'cli-test'], json: true });
  const listFinal = await runCommand('remote', { _: ['list'], json: true });
  assert.equal(listFinal.remotes['cli-test'], undefined);
  console.log('   ✓ CLI remote add/list/remove');
}

console.log('\n✅ All remotes tests passed');
