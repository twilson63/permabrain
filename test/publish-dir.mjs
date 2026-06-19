/**
 * Test: Batch directory publish
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { api } from '../src/index.mjs';
import {
  publishDirectory,
  publishDirectoryToMarkdown,
  deriveKeyFromPath,
  findMarkdownFiles,
} from '../src/publish-dir.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-publish-dir-'));
process.env.PERMABRAIN_HOME = tmp;

await api.init({ keyType: 'ed25519', transport: 'local' });

// --- 1. findMarkdownFiles discovers .md files ---
console.log('1. findMarkdownFiles discovers .md files');
const dirA = path.join(tmp, 'a');
fs.mkdirSync(dirA, { recursive: true });
fs.writeFileSync(path.join(dirA, 'one.md'), '# One\n');
fs.writeFileSync(path.join(dirA, 'two.md'), '# Two\n');
fs.writeFileSync(path.join(dirA, 'skip.txt'), 'not markdown');
const found = findMarkdownFiles(dirA);
assert.equal(found.length, 2);
assert.ok(found.every(f => f.endsWith('.md')));
console.log('   ✓ Found markdown files only');

// --- 2. findMarkdownFiles recurses when recursive=true ---
console.log('2. findMarkdownFiles recurses when recursive=true');
const dirB = path.join(tmp, 'b');
fs.mkdirSync(path.join(dirB, 'sub'), { recursive: true });
fs.writeFileSync(path.join(dirB, 'root.md'), '# Root\n');
fs.writeFileSync(path.join(dirB, 'sub', 'nested.md'), '# Nested\n');
const rec = findMarkdownFiles(dirB, true);
assert.equal(rec.length, 2);
console.log('   ✓ Recursion works');

// --- 3. deriveKeyFromPath respects frontmatter key ---
console.log('3. deriveKeyFromPath respects frontmatter key');
const fmFile = path.join(tmp, 'fm.md');
fs.writeFileSync(fmFile, '---\nkey: subject/custom-key\nkind: subject\ntopic: ai\ntitle: Custom\n---\nBody');
const fm = deriveKeyFromPath(fmFile, tmp);
assert.equal(fm.key, 'subject/custom-key');
assert.equal(fm.topic, 'ai');
assert.equal(fm.title, 'Custom');
console.log('   ✓ Frontmatter key used');

// --- 4. deriveKeyFromPath falls back to kind and derived slug ---
console.log('4. deriveKeyFromPath falls back to kind and derived slug');
const fbFile = path.join(tmp, 'fall-back.md');
fs.writeFileSync(fbFile, 'Plain content');
const fb = deriveKeyFromPath(fbFile, tmp, 'person', 'humans');
assert.equal(fb.kind, 'person');
assert.equal(fb.topic, 'humans');
assert.equal(fb.key, 'person/fall-back');
console.log('   ✓ Fallback derived key works');

// --- 5. publishDirectory dry-run previews files ---
console.log('5. publishDirectory dry-run previews files');
const dryDir = path.join(tmp, 'dry');
fs.mkdirSync(dryDir, { recursive: true });
fs.writeFileSync(path.join(dryDir, 'alpha.md'), '# Alpha\n');
fs.writeFileSync(path.join(dryDir, 'beta.md'), '# Beta\n');
const dry = await publishDirectory(dryDir, { home: tmp, dryRun: true, kind: 'subject', topic: 'test' });
assert.equal(dry.count, 2);
assert.equal(dry.succeeded, 0);
assert.equal(dry.failed, 0);
assert.equal(dry.results[0].status, 'dry-run');
assert.ok(dry.results.every(r => r.key.startsWith('subject/')));
console.log('   ✓ Dry-run returns previews');

// --- 6. publishDirectory publishes live files ---
console.log('6. publishDirectory publishes live files');
const liveDir = path.join(tmp, 'live');
fs.mkdirSync(liveDir, { recursive: true });
fs.writeFileSync(path.join(liveDir, 'gamma.md'), '# Gamma Article\n\nContent here.');
fs.writeFileSync(path.join(liveDir, 'delta.md'), '---\ntopic: science\nkind: subject\n---\n# Delta\n');
const live = await publishDirectory(liveDir, { home: tmp, kind: 'subject', topic: 'default' });
assert.equal(live.count, 2);
assert.equal(live.succeeded, 2);
assert.equal(live.failed, 0);
assert.ok(live.results[0].id);
assert.ok(live.results[1].id);
const keys = live.results.map(r => r.key);
assert.ok(keys.includes('subject/gamma') || keys.includes('subject/gamma-article') || keys.includes('subject/gamma-article-2'), `unexpected keys: ${keys.join(', ')}`);
assert.ok(keys.includes('subject/delta'));
console.log('   ✓ Live publish succeeded');

// --- 7. publishDirectory handles recursive subdirectories ---
console.log('7. publishDirectory handles recursive subdirectories');
const recDir = path.join(tmp, 'recursive');
fs.mkdirSync(path.join(recDir, 'sub1'), { recursive: true });
fs.writeFileSync(path.join(recDir, 'top.md'), '# Top\n');
fs.writeFileSync(path.join(recDir, 'sub1', 'deep.md'), '# Deep\n');
const recPub = await publishDirectory(recDir, { home: tmp, recursive: true, kind: 'subject' });
assert.equal(recPub.count, 2);
assert.equal(recPub.succeeded, 2);
console.log('   ✓ Recursive publish works');

// --- 8. publishDirectory report renders to markdown ---
console.log('8. publishDirectory report renders to markdown');
const md = publishDirectoryToMarkdown(live);
assert.ok(md.includes('Directory Publish:'));
assert.ok(md.includes('Succeeded: 2'));
assert.ok(md.includes('✓'));
console.log('   ✓ Markdown report rendered');

// --- 9. api.publishDirectory wrapper works ---
console.log('9. api.publishDirectory wrapper works');
const apiDir = path.join(tmp, 'api');
fs.mkdirSync(apiDir, { recursive: true });
fs.writeFileSync(path.join(apiDir, 'api-test.md'), '# API Test\n');
const apiReport = await api.publishDirectory(apiDir, { kind: 'subject', topic: 'api', dryRun: true });
assert.equal(apiReport.count, 1);
assert.equal(apiReport.dryRun, true);
console.log('   ✓ api.publishDirectory wrapper works');

// --- 10. Duplicate file produces a new version without error ---
console.log('10. Re-publishing a directory creates new versions');
const second = await publishDirectory(liveDir, { home: tmp, kind: 'subject', topic: 'default' });
assert.equal(second.succeeded, 2);
assert.ok(second.results.every(r => r.version === 2));
console.log('   ✓ Versions increment on re-publish');

// --- 11. Agent API exposes publishDirectoryToMarkdown ---
console.log('11. Agent API exposes publishDirectoryToMarkdown');
const mdFromApi = api.publishDirectoryToMarkdown({ dir: '/tmp', recursive: false, dryRun: false, count: 1, succeeded: 1, failed: 0, skipped: 0, results: [{ file: '/tmp/x.md', key: 'subject/x', status: 'ok' }] });
assert.ok(mdFromApi.includes('✓'));
console.log('   ✓ Markdown helper exposed on api');

console.log('\nAll publish-dir tests passed.');
