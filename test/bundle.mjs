import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildBundle, exportBundle, importBundle } from '../src/bundle.mjs';
import { publishArticle } from '../src/article.mjs';
import { attestArticle } from '../src/attestation.mjs';
import { initState } from '../src/config.mjs';
import { ensureIdentity } from '../src/keys.mjs';
import { defaultConfig } from '../src/config.mjs';

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function setupLocalHome(home) {
  fs.mkdirSync(path.join(home, 'cache', 'objects'), { recursive: true });
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ ...defaultConfig(), transport: 'local', gateway: { type: 'local' }, bundler: { type: 'local' } }, null, 2) + '\n');
}

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERT: ${message}`);
}

async function run() {
  const cases = [];

  cases.push(async () => {
    const home = tmpDir('permabrain-bundle-build-');
    process.env.PERMABRAIN_HOME = home;
    initState();
    setupLocalHome(home);
    await ensureIdentity(home, { keyType: 'ed25519' });

    const pub1 = await publishArticle({
      content: 'First export article',
      kind: 'subject',
      topic: 'bundle-test',
      key: 'subject/bundle-build',
      title: 'Bundle Build',
      sourceUrl: 'https://example.com/1'
    });
    const pub2 = await publishArticle({
      content: 'Second export article',
      kind: 'subject',
      topic: 'bundle-test',
      key: 'subject/bundle-build',
      title: 'Bundle Build V2',
      sourceUrl: 'https://example.com/2'
    });
    const att = await attestArticle({
      key: 'subject/bundle-build',
      opinion: 'valid',
      confidence: 0.9,
      reason: 'Looks good',
      sourceUrl: 'https://example.com/att'
    });

    const bundle = await exportBundle({ key: 'subject/bundle-build' });
    assert(bundle.version === 'permabrain-bundle/1.0.0', 'bundle version');
    assert(bundle.entries.length >= 3, 'bundle has articles + attestation');
    const articles = bundle.entries.filter(e => e.type === 'article');
    const atts = bundle.entries.filter(e => e.type === 'attestation');
    assert(articles.length >= 2, 'bundle contains both versions');
    assert(atts.length >= 1, 'bundle contains attestation');
    assert(bundle.meta.sourceKey === 'subject/bundle-build', 'meta sourceKey');
    fs.rmSync(home, { recursive: true, force: true });
  });

  cases.push(async () => {
    const home = tmpDir('permabrain-bundle-import-');
    process.env.PERMABRAIN_HOME = home;
    initState();
    setupLocalHome(home);
    await ensureIdentity(home, { keyType: 'ed25519' });

    const pub = await publishArticle({
      content: 'Import me',
      kind: 'subject',
      topic: 'bundle-test',
      key: 'subject/bundle-import',
      title: 'Bundle Import',
      sourceUrl: 'https://example.com/import'
    });

    const bundle = await exportBundle({ key: 'subject/bundle-import' });

    const home2 = tmpDir('permabrain-bundle-import-target-');
    process.env.PERMABRAIN_HOME = home2;
    initState();
    setupLocalHome(home2);
    await ensureIdentity(home2, { keyType: 'ed25519' });

    const results = await importBundle(bundle);
    assert(results.length >= 1, 'import produced results');
    const first = results[0];
    assert(first.ok, 'first import ok');
    assert(first.imported, 'first article imported');
    assert(first.type === 'article', 'first is article');

    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(home2, { recursive: true, force: true });
  });

  cases.push(async () => {
    const home = tmpDir('permabrain-bundle-raw-');
    process.env.PERMABRAIN_HOME = home;
    initState();
    setupLocalHome(home);
    const { identity } = await ensureIdentity(home, { keyType: 'ed25519' });

    const pub = await publishArticle({
      content: 'Raw bundle article',
      kind: 'subject',
      topic: 'bundle-test',
      key: 'subject/bundle-raw',
      title: 'Raw Bundle',
      sourceUrl: 'https://example.com/raw'
    });

    const raw = pub.item.ans104Base64 ? Buffer.from(pub.item.ans104Base64, 'base64url') : pub.item.raw;
    const bundle = buildBundle({ articles: [raw], meta: { test: true } });
    assert(bundle.entries.length === 1, 'raw bundle has one entry');
    assert(bundle.entries[0].type === 'article', 'raw bundle entry type');
    assert(bundle.meta.test === true, 'raw bundle meta');

    fs.rmSync(home, { recursive: true, force: true });
  });

  cases.push(async () => {
    const home = tmpDir('permabrain-bundle-skip-');
    process.env.PERMABRAIN_HOME = home;
    initState();
    setupLocalHome(home);
    await ensureIdentity(home, { keyType: 'ed25519' });

    const pub = await publishArticle({
      content: 'Skip dup article',
      kind: 'subject',
      topic: 'bundle-test',
      key: 'subject/bundle-skip',
      title: 'Skip Dup',
      sourceUrl: 'https://example.com/skip'
    });

    const bundle = await exportBundle({ key: 'subject/bundle-skip' });
    const results1 = await importBundle(bundle);
    const results2 = await importBundle(bundle);
    const skipped = results2.filter(r => r.ok && !r.imported);
    assert(skipped.length >= 1, 'duplicate skipped');

    fs.rmSync(home, { recursive: true, force: true });
  });

  let passed = 0;
  let failed = 0;
  for (const [i, fn] of cases.entries()) {
    try {
      await fn();
      console.log(`  ✓ case ${i + 1}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ case ${i + 1}: ${err.message}`);
      failed++;
    }
  }

  console.log(`\nBundle tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
