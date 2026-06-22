/**
 * Test: local article body grep
 *
 * Covers:
 *   - Literal string matching in cached page markdown
 *   - Regex mode with flags
 *   - Case-insensitive mode
 *   - Metadata filters (kind, topic, key)
 *   - Snippet context
 *   - Markdown rendering
 *   - Empty index handling
 *   - CLI help
 *   - API wrapper
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';

import { grepArticles, grepToMarkdown } from '../src/grep.mjs';
import { statePaths } from '../src/config.mjs';
import { api } from '../src/agent-api.mjs';

const PERMABRAIN = path.resolve('scripts', 'cli.mjs');

function tmpHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-grep-'));
}

function seedHome(home) {
  const { cacheDir, pagesDir } = statePaths(home);
  fs.mkdirSync(pagesDir, { recursive: true });
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(
    path.join(pagesDir, 'ai__neural-nets.md'),
    '# neural networks\n\nA neural network is a computing system inspired by biological neural networks.\n\n## deep learning\n\nDeep learning uses many layers.\n'
  );
  fs.writeFileSync(
    path.join(pagesDir, 'math__linear-algebra.md'),
    '# Linear Algebra\n\nLinear algebra is central to machine learning.\n'
  );
  const index = {
    articles: {
      'ai/neural-nets': {
        key: 'ai/neural-nets',
        title: 'Neural Networks',
        kind: 'subject',
        topic: 'ai',
        language: 'en'
      },
      'math/linear-algebra': {
        key: 'math/linear-algebra',
        title: 'Linear Algebra',
        kind: 'subject',
        topic: 'math',
        language: 'en'
      }
    },
    attestations: {},
    updatedAt: new Date().toISOString()
  };
  fs.writeFileSync(path.join(cacheDir, 'index.json'), JSON.stringify(index, null, 2) + '\n');
  return index;
}

console.log('1. Literal string match');
{
  const home = tmpHome();
  seedHome(home);
  const result = await grepArticles('neural network', { home, limit: 10 });
  assert.equal(result.query, 'neural network');
  assert.equal(result.regex, false);
  assert.equal(result.total, 2);
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].key, 'ai/neural-nets');
  assert.equal(result.matches[0].matches.length, 2);
  assert.ok(result.matches[0].matches.some((m) => m.line === 1));
  fs.rmSync(home, { recursive: true, force: true });
  console.log('   ✓ Literal match works');
}

console.log('2. Regex mode');
{
  const home = tmpHome();
  seedHome(home);
  const result = await grepArticles('^# ', { home, regex: true });
  assert.equal(result.total, 2);
  assert.equal(result.matches.length, 2);
  console.log('   ✓ Regex mode works');
  fs.rmSync(home, { recursive: true, force: true });
}

console.log('3. Case-insensitive mode');
{
  const home = tmpHome();
  seedHome(home);
  const result = await grepArticles('DEEP LEARNING', { home, ignoreCase: true });
  assert.equal(result.total, 2);
  assert.equal(result.matches[0].key, 'ai/neural-nets');
  console.log('   ✓ Case-insensitive match works');
  fs.rmSync(home, { recursive: true, force: true });
}

console.log('4. Metadata filters');
{
  const home = tmpHome();
  seedHome(home);
  const byTopic = await grepArticles('network', { home, topic: 'ai' });
  assert.equal(byTopic.total, 2);
  assert.equal(byTopic.matches[0].topic, 'ai');

  const byKind = await grepArticles('is', { home, kind: 'subject' });
  assert.ok(byKind.total >= 2);

  const byKey = await grepArticles('layers', { home, key: 'ai/neural-nets' });
  assert.equal(byKey.total, 1);
  assert.equal(byKey.matches[0].key, 'ai/neural-nets');
  console.log('   ✓ Topic, kind, and key filters work');
  fs.rmSync(home, { recursive: true, force: true });
}

console.log('5. Limit and snippet context');
{
  const home = tmpHome();
  seedHome(home);
  const result = await grepArticles('network', { home, limit: 1, context: 20 });
  assert.equal(result.total, 1);
  assert.ok(result.matches[0].matches[0].snippet.length <= 40);
  console.log('   ✓ Limit and context respected');
  fs.rmSync(home, { recursive: true, force: true });
}

console.log('6. Empty home returns no matches');
{
  const home = tmpHome();
  const { cacheDir, pagesDir } = statePaths(home);
  fs.mkdirSync(pagesDir, { recursive: true });
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(path.join(cacheDir, 'index.json'), JSON.stringify({ articles: {}, attestations: {}, updatedAt: null }, null, 2) + '\n');
  const result = await grepArticles('anything', { home });
  assert.equal(result.total, 0);
  assert.deepEqual(result.matches, []);
  console.log('   ✓ Empty index handled');
  fs.rmSync(home, { recursive: true, force: true });
}

console.log('7. Markdown rendering');
{
  const home = tmpHome();
  seedHome(home);
  const result = await grepArticles('deep learning', { home, ignoreCase: true });
  const md = grepToMarkdown(result);
  assert.ok(md.includes('# PermaBrain grep'));
  assert.ok(md.includes('Neural Networks'));
  assert.ok(md.includes('deep learning'));
  console.log('   ✓ Markdown rendering works');
  fs.rmSync(home, { recursive: true, force: true });
}

console.log('8. API wrapper');
{
  const home = tmpHome();
  seedHome(home);
  process.env.PERMABRAIN_HOME = home;
  await api.init({ home });
  const result = await api.grep('machine learning', { ignoreCase: true });
  assert.equal(result.total, 1);
  assert.equal(result.matches[0].key, 'math/linear-algebra');

  const withMd = await api.grep('machine learning', { ignoreCase: true, markdown: true });
  assert.ok(withMd.markdown);
  assert.ok(withMd.markdown.includes('machine learning'));
  console.log('   ✓ API wrapper works');
  fs.rmSync(home, { recursive: true, force: true });
}

console.log('9. CLI help');
{
  const out = execSync(`node ${PERMABRAIN} grep --help`, { encoding: 'utf8' });
  assert.ok(out.includes('Usage: permabrain grep'));
  console.log('   ✓ CLI help works');
}

console.log('✅ All grep tests passed');
