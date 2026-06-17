/**
 * Test: Audit log auto-captures real actions
 *
 * Verifies that publish/attest/fork/merge/export/import actions leave
 * entries in the local audit log.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { queryLog } from '../src/log.mjs';
import { api } from '../src/agent-api.mjs';

function tmpHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pb-log-int-'));
}

async function initApi(home) {
  process.env.PERMABRAIN_HOME = home;
  process.env.PERMABRAIN_TRANSPORT = 'local';
  api._home = undefined;
  api._identity = undefined;
  api._config = undefined;
  await api.init({ transport: 'local' });
  return api;
}

console.log('1. Publish creates audit entry');
{
  const home = tmpHome();
  await initApi(home);
  const result = await api.publish({
    content: '# Hello\n\nWorld',
    kind: 'subject',
    topic: 'test',
    key: 'subject/hello',
    title: 'Hello',
    sourceUrl: 'https://example.com/hello'
  });
  const log = queryLog({ home, action: 'publish' });
  assert.equal(log.total, 1);
  assert.equal(log.entries[0].key, 'subject/hello');
  assert.equal(log.entries[0].status, 'ok');
  console.log('   ✓ Publish audit entry present');
}

console.log('2. Attest creates audit entry');
{
  const home = tmpHome();
  await initApi(home);
  await api.publish({
    content: '# Attest target',
    kind: 'subject',
    topic: 'test',
    key: 'subject/attest-target',
    title: 'Attest Target',
    sourceUrl: 'https://example.com/attest'
  });
  await api.attest('subject/attest-target', { opinion: 'valid', confidence: 0.9, reason: 'Good' });
  const log = queryLog({ home, action: 'attest' });
  assert.equal(log.total, 1);
  assert.equal(log.entries[0].key, 'subject/attest-target');
  console.log('   ✓ Attest audit entry present');
}

console.log('3. Fork creates audit entry');
{
  const home = tmpHome();
  await initApi(home);
  await api.publish({
    content: '# Original\n\nLine one',
    kind: 'subject',
    topic: 'test',
    key: 'subject/original',
    title: 'Original',
    sourceUrl: 'https://example.com/original'
  });
  await api.fork('subject/original', { content: '# Fork\n\nLine one\n\nLine two', slug: 'forked' });
  const log = queryLog({ home, action: 'fork' });
  assert.equal(log.total, 1);
  assert.equal(log.entries[0].key, 'subject/forked');
  console.log('   ✓ Fork audit entry present');
}

console.log('4. Merge creates audit entry');
{
  const home = tmpHome();
  await initApi(home);
  await api.publish({
    content: '# Target\n\nLine one',
    kind: 'subject',
    topic: 'test',
    key: 'subject/merge-target',
    title: 'Merge Target',
    sourceUrl: 'https://example.com/target'
  });
  await api.publish({
    content: '# Source\n\nLine one\n\nLine source',
    kind: 'subject',
    topic: 'test',
    key: 'subject/merge-source',
    title: 'Merge Source',
    sourceUrl: 'https://example.com/source'
  });
  await api.merge('subject/merge-target', 'subject/merge-source');
  const log = queryLog({ home, action: 'merge' });
  assert.equal(log.total, 1);
  assert.equal(log.entries[0].key, 'subject/merge-target');
  console.log('   ✓ Merge audit entry present');
}

console.log('5. Export and import history create audit entries');
{
  const home = tmpHome();
  await initApi(home);
  await api.publish({
    content: '# Export me\n\nBody',
    kind: 'subject',
    topic: 'test',
    key: 'subject/export-me',
    title: 'Export Me',
    sourceUrl: 'https://example.com/export'
  });
  const bundle = await api.exportHistory('subject/export-me');
  const imported = await api.importHistory(bundle);
  const log = queryLog({ home });
  assert.ok(log.total >= 2, `expected at least 2 entries, got ${log.total}`);
  assert.ok(log.entries.some((e) => e.action === 'export'), 'export entry exists');
  assert.ok(log.entries.some((e) => e.action === 'import'), 'import entry exists');
  console.log('   ✓ Export/import audit entries present');
}

console.log('\n✅ All audit log integration tests passed');
