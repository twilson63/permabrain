/**
 * Test: export-articles command / exportArticles API
 *
 * Covers JSON/markdown export, filter passthrough, CLI registration,
 * API exposure, module export, and --output file writing.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { exportArticles, exportArticlesToMarkdown } from '../src/export-articles.mjs';
import { exportArticles as exportedFn } from '../src/index.mjs';
import { api } from '../src/agent-api.mjs';
import { initState } from '../src/config.mjs';
import { runCommand } from '../src/commands.mjs';

function tmpHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-export-articles-'));
}

function makeSummary(overrides) {
  return {
    id: overrides.id,
    key: overrides.key,
    kind: overrides.kind || 'subject',
    title: overrides.title || 'Untitled',
    slug: overrides.key.split('/').pop(),
    topic: overrides.topic || 'ai',
    language: overrides.language || 'en',
    version: overrides.version || 1,
    previousId: null,
    rootId: null,
    sourceName: overrides.sourceName || 'Example',
    sourceUrl: overrides.sourceUrl || 'https://example.com/' + overrides.key,
    contentHash: overrides.contentHash || 'sha256:aaa',
    updatedAt: overrides.updatedAt || new Date().toISOString(),
    authorAgentId: overrides.authorAgentId || 'ed25519:author'
  };
}

function writeIndex(home, articles, attestations = {}) {
  const init = initState({ env: { ...process.env, PERMABRAIN_HOME: home } });
  fs.writeFileSync(
    init.paths.indexPath,
    JSON.stringify({ articles, attestations, updatedAt: new Date().toISOString() }, null, 2) + '\n'
  );
  return init.paths.home;
}

const transport = { async queryByTags() { return []; } };

// 1. JSON export default
{
  const home = tmpHome();
  writeIndex(home, {
    'subject/one': makeSummary({ id: 'id1', key: 'subject/one', title: 'One' }),
    'subject/two': makeSummary({ id: 'id2', key: 'subject/two', title: 'Two' })
  });

  const result = await exportArticles({ home, transport });
  assert.equal(result.format, 'json');
  assert.equal(result.total, 2);
  assert.ok(Array.isArray(result.articles));
  assert.equal(result.articles.length, 2);
  assert.equal(result.sort, 'date');
  console.log('1. JSON export default: OK');
}

// 2. Markdown export
{
  const home = tmpHome();
  writeIndex(home, {
    'subject/one': makeSummary({ id: 'id1', key: 'subject/one', title: 'One' })
  });

  const result = await exportArticles({ home, transport, format: 'markdown' });
  assert.equal(result.format, 'markdown');
  assert.ok(result.markdown);
  assert.match(result.markdown, /# PermaBrain Article Directory/);
  assert.match(result.markdown, /subject\/one/);
  assert.equal(result.total, 1);
  console.log('2. Markdown export: OK');
}

// 3. Filter passthrough
{
  const home = tmpHome();
  writeIndex(home, {
    'subject/one': makeSummary({ id: 'id1', key: 'subject/one', title: 'One', topic: 'ai' }),
    'subject/two': makeSummary({ id: 'id2', key: 'subject/two', title: 'Two', topic: 'web3' })
  });

  const result = await exportArticles({ home, transport, topic: 'ai' });
  assert.equal(result.total, 1);
  assert.equal(result.articles[0].key, 'subject/one');
  assert.equal(result.filters.topic, 'ai');
  console.log('3. Filter passthrough: OK');
}

// 4. Sorting and pagination
{
  const home = tmpHome();
  writeIndex(home, {
    'b/b': makeSummary({ id: 'idb', key: 'b/b', title: 'Beta' }),
    'a/a': makeSummary({ id: 'ida', key: 'a/a', title: 'Alpha' })
  });

  const result = await exportArticles({ home, transport, sort: 'title', limit: 1, offset: 1 });
  assert.equal(result.total, 2);
  assert.equal(result.articles.length, 1);
  assert.equal(result.articles[0].key, 'b/b');
  assert.equal(result.limit, 1);
  assert.equal(result.offset, 1);
  console.log('4. Sorting and pagination: OK');
}

// 5. Module exports
{
  assert.equal(typeof exportedFn, 'function');
  const home = tmpHome();
  writeIndex(home, { 'k/k': makeSummary({ id: 'k', key: 'k/k', title: 'K' }) });
  const result = await exportedFn({ home, transport });
  assert.equal(result.format, 'json');
  assert.equal(result.total, 1);
  console.log('5. Module exports: OK');
}

// 6. Agent API exposes exportArticles
{
  assert.equal(typeof api.exportArticles, 'function');
  console.log('6. Agent API exposes exportArticles: OK');
}

// 7. Format alias 'md'
{
  const home = tmpHome();
  writeIndex(home, {
    'subject/one': makeSummary({ id: 'id1', key: 'subject/one', title: 'One' })
  });

  const result = await exportArticles({ home, transport, format: 'md' });
  assert.equal(result.format, 'markdown');
  console.log('7. Format alias md: OK');
}

// 8. exportArticlesToMarkdown helper
{
  const home = tmpHome();
  writeIndex(home, {
    'subject/one': makeSummary({ id: 'id1', key: 'subject/one', title: 'One' })
  });
  const { listArticles } = await import('../src/list.mjs');
  const list = await listArticles({ home, transport });
  const md = exportArticlesToMarkdown(list);
  assert.match(md, /PermaBrain Article Directory/);
  console.log('8. exportArticlesToMarkdown helper: OK');
}

// 9. CLI command registration
{
  const home = tmpHome();
  writeIndex(home, {
    'subject/one': makeSummary({ id: 'id1', key: 'subject/one', title: 'One' })
  });
  process.env.PERMABRAIN_HOME = home;
  const out = [];
  const originalLog = console.log;
  console.log = (...args) => out.push(args.join(' '));
  const result = await runCommand('export-articles', { json: true });
  console.log = originalLog;
  assert.ok(result, 'export-articles command returns result');
  assert.equal(result.format, 'json');
  assert.ok(Array.isArray(result.articles));
  console.log('9. CLI export-articles command: OK');
}

// 10. CLI --output file writing
{
  const home = tmpHome();
  const outPath = path.join(home, 'export.md');
  writeIndex(home, {
    'subject/one': makeSummary({ id: 'id1', key: 'subject/one', title: 'One' })
  });
  process.env.PERMABRAIN_HOME = home;
  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => logs.push(args.join(' '));
  const result = await runCommand('export-articles', { output: outPath });
  console.log = originalLog;
  assert.equal(result.format, 'markdown');
  assert.ok(fs.existsSync(outPath), 'output file written');
  const written = fs.readFileSync(outPath, 'utf8');
  assert.match(written, /subject\/one/);
  console.log('10. CLI --output file writing: OK');
}

// 11. Unsupported format throws
{
  try {
    await exportArticles({ home: tmpHome(), transport, format: 'yaml' });
    assert.fail('should throw for unsupported format');
  } catch (e) {
    assert.match(e.message, /Unsupported export format/);
  }
  console.log('11. Unsupported format throws: OK');
}

console.log('\n✅ All export-articles tests passed');
