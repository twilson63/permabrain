import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runDoctor, doctorReportToMarkdown, rebuildIndexFromObjects } from '../src/doctor.mjs';
import { statePaths } from '../src/config.mjs';

process.env.PERMABRAIN_KEY_TYPE = 'ed25519';

function tmpHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pb-doctor-'));
}

async function initHome(home) {
  process.env.PERMABRAIN_HOME = home;
  const { api } = await import('../src/agent-api.mjs');
  await api.init({ transport: 'local' });
  return api;
}

function corruptIndex(home) {
  const { indexPath } = statePaths(home);
  fs.writeFileSync(indexPath, '{ not json');
}

function fakeAttestationSummary(targetKey, id) {
  return {
    id,
    targetId: id,
    targetKey,
    opinion: 'valid',
    confidence: 0.9,
    reason: 'test',
    agentId: 'ed25519:fake',
    sourceUrl: null,
    createdAt: new Date().toISOString()
  };
}

// --- 1. Healthy home reports OK ---
{
  const home = tmpHome();
  const api = await initHome(home);
  const report = await api.doctor();
  assert.equal(report.ok, true, 'healthy home should be ok');
  assert.equal(report.issues, 0, 'no issues');
  assert.ok(report.checks.some((c) => c.name === 'identity' && c.ok), 'identity check ok');
  assert.ok(report.checks.some((c) => c.name === 'config' && c.ok), 'config check ok');
  assert.ok(report.checks.some((c) => c.name === 'cache-index' && c.ok), 'cache check ok');
  console.log('1. Healthy home reports OK');
}

// --- 2. Markdown report generation ---
{
  const home = tmpHome();
  const api = await initHome(home);
  const report = await api.doctor({ markdown: true });
  assert.ok(report.markdown, 'markdown field present');
  assert.ok(report.markdown.includes('# PermaBrain Doctor Report'), 'markdown header');
  assert.ok(report.markdown.includes('healthy') || report.markdown.includes('issues detected'), 'markdown status');
  console.log('2. Markdown report generation');
}

// --- 3. Corrupt index is detected and fixed ---
{
  const home = tmpHome();
  const api = await initHome(home);
  const pub = await api.publish({
    content: '# Test\n\nContent.',
    kind: 'subject',
    topic: 'test',
    title: 'Test',
    sourceUrl: 'https://example.com/test'
  });
  corruptIndex(home);
  const broken = await api.doctor();
  assert.equal(broken.ok, false, 'corrupt index fails');
  assert.ok(broken.checks.some((c) => c.name === 'cache-index' && !c.ok), 'cache-index check fails');

  const fixed = await api.doctor({ fix: true });
  assert.equal(fixed.ok, true, 'fixed index is ok');
  assert.ok(fixed.checks.find((c) => c.name === 'cache-index').fixes.length > 0, 'index fixes applied');

  const index = JSON.parse(fs.readFileSync(path.join(home, 'cache', 'index.json'), 'utf8'));
  assert.ok(index.articles[pub.summary.key], 'article restored to index');
  console.log('3. Corrupt index is detected and fixed');
}

// --- 4. Missing identity-init.json is recreated with --fix ---
{
  const home = tmpHome();
  const api = await initHome(home);
  const { identityInitPath } = statePaths(home);
  fs.unlinkSync(identityInitPath);
  const report = await api.doctor({ fix: true });
  assert.equal(report.ok, true, 'identity restored');
  assert.ok(fs.existsSync(identityInitPath), 'identity-init.json recreated');
  const init = JSON.parse(fs.readFileSync(identityInitPath, 'utf8'));
  assert.equal(init.type, 'identity-init');
  console.log('4. Missing identity-init.json is recreated with --fix');
}

// --- 5. Missing config.json is recreated with --fix ---
{
  const home = tmpHome();
  const api = await initHome(home);
  const { configPath } = statePaths(home);
  fs.unlinkSync(configPath);
  const report = await api.doctor({ fix: true });
  assert.equal(report.ok, true, 'config restored');
  assert.ok(fs.existsSync(configPath), 'config.json recreated');
  console.log('5. Missing config.json is recreated with --fix');
}

// --- 6. Missing object file is reported ---
{
  const home = tmpHome();
  const api = await initHome(home);
  const pub = await api.publish({
    content: '# Test\n\nContent.',
    kind: 'subject',
    topic: 'test',
    title: 'Test Two',
    sourceUrl: 'https://example.com/test2'
  });
  const objPath = path.join(home, 'cache', 'objects', encodeURIComponent(pub.summary.id) + '.json');
  fs.unlinkSync(objPath);
  const report = await api.doctor();
  assert.equal(report.ok, false, 'missing object fails');
  assert.ok(report.details.cache.missingObjects.some((m) => m.id === pub.summary.id), 'missing object listed');

  const fixed = await api.doctor({ fix: true });
  assert.equal(fixed.ok, true, 'rebuilt index without missing object is ok');
  const index = JSON.parse(fs.readFileSync(path.join(home, 'cache', 'index.json'), 'utf8'));
  assert.equal(index.articles[pub.summary.key], undefined, 'article removed from index after object deleted');
  console.log('6. Missing object file is reported');
}

// --- 7. Stale index is rebuilt from objects ---
{
  const home = tmpHome();
  const api = await initHome(home);
  const pub1 = await api.publish({
    content: '# Version 1',
    kind: 'subject',
    topic: 'test',
    title: 'Stale Test',
    sourceUrl: 'https://example.com/v1',
    key: 'subject/stale-test'
  });
  const pub2 = await api.publish({
    content: '# Version 2',
    kind: 'subject',
    topic: 'test',
    title: 'Stale Test',
    sourceUrl: 'https://example.com/v2',
    key: 'subject/stale-test'
  });
  assert.notEqual(pub1.summary.id, pub2.summary.id, 'versions have different ids');

  // Force index back to version 1
  const { indexPath } = statePaths(home);
  fs.writeFileSync(indexPath, JSON.stringify({ articles: { [pub1.summary.key]: pub1.summary }, attestations: {}, updatedAt: new Date().toISOString() }, null, 2) + '\n');

  const report = await api.doctor();
  assert.equal(report.ok, false, 'stale index fails');
  assert.ok(report.details.cache.staleIndexKeys.some((s) => s.key === 'subject/stale-test'), 'stale key listed');

  const fixed = await api.doctor({ fix: true });
  assert.equal(fixed.ok, true, 'stale index fixed');
  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  assert.equal(index.articles['subject/stale-test'].id, pub2.summary.id, 'index points to latest version');
  console.log('7. Stale index is rebuilt from objects');
}

// --- 8. Orphan attestations are detected ---
{
  const home = tmpHome();
  const api = await initHome(home);
  const pub = await api.publish({
    content: '# Orphan Test',
    kind: 'subject',
    topic: 'test',
    title: 'Orphan Test',
    sourceUrl: 'https://example.com/orphan'
  });
  await api.attest(pub.summary.key, { opinion: 'valid', confidence: 0.8, reason: 'ok' });

  const { indexPath } = statePaths(home);
  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  index.attestations['subject/does-not-exist'] = [fakeAttestationSummary('subject/does-not-exist', 'fake-id-1')];
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2) + '\n');

  const report = await api.doctor();
  assert.equal(report.ok, false, 'orphan attestation fails');
  assert.ok(report.details.cache.orphanAttestations.some((o) => o.targetKey === 'subject/does-not-exist'), 'orphan listed');
  console.log('8. Orphan attestations are detected');
}

// --- 9. rebuildIndexFromObjects is exported and works ---
{
  const home = tmpHome();
  const api = await initHome(home);
  await api.publish({
    content: '# Rebuild Test',
    kind: 'subject',
    topic: 'test',
    title: 'Rebuild Test',
    sourceUrl: 'https://example.com/rebuild',
    key: 'subject/rebuild-test'
  });
  const { indexPath } = statePaths(home);
  fs.writeFileSync(indexPath, JSON.stringify({ articles: {}, attestations: {}, updatedAt: null }, null, 2) + '\n');
  rebuildIndexFromObjects(home);
  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  assert.ok(index.articles['subject/rebuild-test'], 'rebuild restored article');
  console.log('9. rebuildIndexFromObjects is exported and works');
}

// --- 10. CLI doctor command runs ---
{
  const home = tmpHome();
  process.env.PERMABRAIN_HOME = home;
  const { api } = await import('../src/agent-api.mjs');
  await api.init({ transport: 'local' });
  const { execFileSync } = await import('node:child_process');
  const out = execFileSync('node', ['scripts/cli.mjs', 'doctor', '--json'], { encoding: 'utf8', cwd: '/home/node/.openclaw/workspace/permabrain', env: { ...process.env, PERMABRAIN_HOME: home } });
  const report = JSON.parse(out);
  assert.equal(report.ok, true, 'CLI doctor reports ok');
  console.log('10. CLI doctor command runs');
}

console.log('\n✅ All doctor tests passed');
