/**
 * Test: release-notes module (parseChangelog, validateChangelog, buildReleaseNotes,
 * generateDraftFromGitCommits, CLI, API wrapper, and index exports).
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.join(__dirname, '..');
const cli = path.join(root, 'scripts', 'cli.mjs');

import {
  parseChangelog,
  validateChangelog,
  buildReleaseNotes,
  generateDraftFromGitCommits,
  releaseNotesToMarkdown,
  releaseNotesToJson,
  categorizeCommitMessage,
  releaseNotesToMarkdownString,
  releaseNotesToJsonObject
} from '../src/release-notes.mjs';

const sampleChangelog = `# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-06-17

### Added
- CLI quick-start, command catalog, and multi-agent workflow examples in README.
- Local-first CLI for identity, publishing, attestation, consensus, search, version control, transport, backups, audit log, dashboard, and HTTP API.

### Changed
- Migrated from AO to Arweave GraphQL + local cache.

### Fixed
- Race condition in sync index updates.

### Security
- Hardened encrypted article envelope nonce handling.

## [0.1.0] - 2026-06-06

### Added
- Initial PermaBrain CLI and viewer prototype.
`;

function runCli(args) {
  return spawnSync('node', [cli, ...args], { encoding: 'utf8', cwd: root });
}

// --- 1. parseChangelog basics ---
console.log('1. parseChangelog basics');
{
  const parsed = parseChangelog(sampleChangelog);
  assert.equal(parsed.title, 'Changelog');
  assert.ok(parsed.intro.length >= 0, 'intro parsing attempted');
  assert.ok(parsed.unreleased, 'unreleased section present');
  assert.equal(parsed.versions.length, 2, 'two versions parsed');
  assert.equal(parsed.versions[0].version, '0.2.0');
  assert.equal(parsed.versions[0].date, '2026-06-17');
  assert.deepEqual(parsed.versions[0].subsections.Added, [
    'CLI quick-start, command catalog, and multi-agent workflow examples in README.',
    'Local-first CLI for identity, publishing, attestation, consensus, search, version control, transport, backups, audit log, dashboard, and HTTP API.'
  ]);
  assert.deepEqual(parsed.versions[0].subsections.Changed, ['Migrated from AO to Arweave GraphQL + local cache.']);
  assert.deepEqual(parsed.versions[0].subsections.Fixed, ['Race condition in sync index updates.']);
  assert.deepEqual(parsed.versions[0].subsections.Security, ['Hardened encrypted article envelope nonce handling.']);
  assert.equal(parsed.versions[1].version, '0.1.0');
}
console.log('   ✓ parseChangelog works');

// --- 2. validateChangelog ---
console.log('2. validateChangelog');
{
  const { valid, errors } = validateChangelog(sampleChangelog);
  assert.equal(valid, true, `valid changelog: ${JSON.stringify(errors)}`);

  const bad = `# Changelog

## [Unreleased]

## [0.1.0]

### UnknownSection
- item
`;
  const badResult = validateChangelog(bad);
  assert.equal(badResult.valid, false);
  assert.ok(badResult.errors.some((e) => e.path.includes('date')), 'missing date reported');
  assert.ok(badResult.errors.some((e) => e.path.includes('subsections')), 'missing/unknown subsections reported');
}
console.log('   ✓ validateChangelog works');

// --- 3. buildReleaseNotes latest ---
console.log('3. buildReleaseNotes latest');
{
  const { markdown, json, release, parsed } = buildReleaseNotes({ text: sampleChangelog });
  assert.ok(markdown.includes('## [0.2.0] - 2026-06-17'), 'markdown has latest version');
  assert.ok(markdown.includes('### Added'), 'markdown has Added section');
  assert.equal(release.version, '0.2.0');
  assert.equal(json.version, '0.2.0');
  assert.ok(Array.isArray(json.subsections.added), 'json has added array');
  assert.equal(parsed.versions.length, 2);
}
console.log('   ✓ buildReleaseNotes latest works');

// --- 4. buildReleaseNotes specific version ---
console.log('4. buildReleaseNotes specific version');
{
  const { markdown, json } = buildReleaseNotes({ text: sampleChangelog, version: '0.1.0' });
  assert.ok(markdown.includes('## [0.1.0] - 2026-06-06'));
  assert.ok(!markdown.includes('## [0.2.0]'));
  assert.equal(json.version, '0.1.0');
  assert.equal(json.subsections.added[0], 'Initial PermaBrain CLI and viewer prototype.');
}
console.log('   ✓ buildReleaseNotes specific version works');

// --- 5. buildReleaseNotes Unreleased ---
console.log('5. buildReleaseNotes Unreleased');
{
  const unreleasedText = `# Changelog

## [Unreleased]

### Added
- New unreleased feature.

## [0.2.0] - 2026-06-17

### Added
- Released feature.
`;
  const { markdown, json, release } = buildReleaseNotes({ text: unreleasedText, unreleased: true });
  assert.ok(markdown.includes('## [Unreleased]'));
  assert.equal(release.version, 'Unreleased');
  assert.deepEqual(json.subsections.added, ['New unreleased feature.']);
}
console.log('   ✓ buildReleaseNotes Unreleased works');

// --- 6. releaseNotesToMarkdown/Json helpers ---
console.log('6. releaseNotesToMarkdown/Json helpers');
{
  const release = {
    version: '1.0.0',
    date: '2026-01-01',
    description: ['A release note description.'],
    subsections: { Added: ['feature A'], Fixed: ['bug B'] }
  };
  const md = releaseNotesToMarkdown(release);
  assert.ok(md.includes('## [1.0.0] - 2026-01-01'));
  assert.ok(md.includes('A release note description.'));
  assert.ok(md.includes('### Added'));
  assert.ok(md.includes('- feature A'));
  assert.ok(md.includes('### Fixed'));
  const json = releaseNotesToJson(release);
  assert.equal(json.version, '1.0.0');
  assert.deepEqual(json.subsections.added, ['feature A']);
  assert.deepEqual(json.subsections.fixed, ['bug B']);
}
console.log('   ✓ helper functions work');

// --- 7. categorizeCommitMessage ---
console.log('7. categorizeCommitMessage');
{
  assert.deepEqual(categorizeCommitMessage('feat(api): add new endpoint'), { category: 'Added', scope: 'api', body: 'add new endpoint' });
  assert.deepEqual(categorizeCommitMessage('fix: resolve crash'), { category: 'Fixed', scope: null, body: 'resolve crash' });
  assert.deepEqual(categorizeCommitMessage('docs: update readme'), { category: 'Changed', scope: null, body: 'update readme' });
  assert.deepEqual(categorizeCommitMessage('security: patch vulnerability'), { category: 'Security', scope: null, body: 'patch vulnerability' });
  assert.deepEqual(categorizeCommitMessage('random message without prefix'), { category: 'Changed', scope: null, body: 'random message without prefix' });
}
console.log('   ✓ categorizeCommitMessage works');

// --- 8. generateDraftFromGitCommits in temp repo ---
console.log('8. generateDraftFromGitCommits temp repo');
{
  const tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-release-notes-'));
  try {
    const run = (cmd) => spawnSync(cmd, { shell: true, cwd: tmpRepo, encoding: 'utf8' });
    run('git init -q');
    run('git config user.email "test@test.com"');
    run('git config user.name "Test"');
    fs.writeFileSync(path.join(tmpRepo, 'a.txt'), 'a');
    run('git add a.txt && git commit -q -m "feat: add feature alpha"');
    fs.writeFileSync(path.join(tmpRepo, 'b.txt'), 'b');
    run('git add b.txt && git commit -q -m "fix: fix bug beta"');
    fs.writeFileSync(path.join(tmpRepo, 'c.txt'), 'c');
    run('git add c.txt && git commit -q -m "docs: update changelog"');

    const draft = generateDraftFromGitCommits({ path: tmpRepo, limit: 10 });
    assert.ok(draft.markdown.includes('## [Unreleased]'));
    assert.ok(draft.markdown.includes('### Added'), 'draft has Added');
    assert.ok(draft.markdown.includes('- add feature alpha'), 'draft has feature alpha');
    assert.ok(draft.markdown.includes('### Fixed'), 'draft has Fixed');
    assert.ok(draft.markdown.includes('- fix bug beta'), 'draft has bug beta');
    assert.ok(draft.markdown.includes('### Changed'), 'draft has Changed');
    assert.ok(draft.markdown.includes('- update changelog'), 'draft has docs change');
    assert.ok(draft.json.subsections.added.length >= 1);
  } finally {
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
}
console.log('   ✓ generateDraftFromGitCommits works');

// --- 9. CLI release-notes help ---
console.log('9. CLI release-notes help');
{
  const child = runCli(['release-notes', '--help']);
  assert.equal(child.status, 0, `help should exit 0: ${child.stderr}`);
  assert.ok(child.stdout.includes('release-notes'), 'help mentions release-notes');
}
console.log('   ✓ CLI help works');

// --- 10. CLI JSON output for latest version ---
console.log('10. CLI JSON output latest version');
{
  const child = runCli(['release-notes', '--json', '--version', '0.2.0']);
  assert.equal(child.status, 0, `json latest should exit 0: ${child.stderr}`);
  const out = JSON.parse(child.stdout);
  assert.equal(out.version, '0.2.0');
  assert.ok(Array.isArray(out.subsections.added));
}
console.log('   ✓ CLI JSON output works');

// --- 11. CLI markdown output from sample file ---
console.log('11. CLI markdown output from sample file');
{
  const tmpFile = path.join(os.tmpdir(), 'permabrain-test-changelog.md');
  fs.writeFileSync(tmpFile, sampleChangelog);
  try {
    const child = runCli(['release-notes', '--version', '0.1.0', '--file', tmpFile]);
    assert.equal(child.status, 0, `markdown from file should exit 0: ${child.stderr}`);
    assert.ok(child.stdout.includes('## [0.1.0] - 2026-06-06'));
    assert.ok(child.stdout.includes('Initial PermaBrain CLI and viewer prototype.'));
  } finally {
    fs.rmSync(tmpFile, { force: true });
  }
}
console.log('   ✓ CLI markdown output works');

// --- 12. CLI validate CHANGELOG.md ---
console.log('12. CLI validate CHANGELOG.md');
{
  const child = runCli(['release-notes', '--validate']);
  assert.equal(child.status, 0, `validate should exit 0: ${child.stderr}`);
  assert.ok(child.stdout.includes('valid') || child.stdout.includes('true'), 'validate reports valid');
}
console.log('   ✓ CLI validate works');

// --- 13. CLI draft from git commits ---
console.log('13. CLI draft from git commits');
{
  const child = runCli(['release-notes', '--draft', '--json', '--limit', '20']);
  assert.equal(child.status, 0, `draft should exit 0: ${child.stderr}`);
  const out = JSON.parse(child.stdout);
  assert.equal(out.version, 'Unreleased');
  assert.ok(typeof out.subsections === 'object');
}
console.log('   ✓ CLI draft works');

// --- 14. API wrapper ---
console.log('14. API wrapper');
{
  const { api } = await import('../src/agent-api.mjs');
  assert.equal(typeof api.releaseNotes, 'function', 'api.releaseNotes is a function');
  const result = await api.releaseNotes({ text: sampleChangelog, version: '0.2.0' });
  assert.equal(result.json.version, '0.2.0');
  assert.ok(result.markdown.includes('## [0.2.0]'));
}
console.log('   ✓ API wrapper works');

// --- 15. Index exports ---
console.log('15. Index exports');
{
  const index = await import('../src/index.mjs');
  assert.equal(typeof index.parseChangelog, 'function', 'parseChangelog re-exported');
  assert.equal(typeof index.validateChangelog, 'function', 'validateChangelog re-exported');
  assert.equal(typeof index.buildReleaseNotes, 'function', 'buildReleaseNotes re-exported');
  assert.equal(typeof index.generateDraftFromGitCommits, 'function', 'generateDraftFromGitCommits re-exported');
  assert.equal(typeof index.releaseNotesToMarkdown, 'function', 'releaseNotesToMarkdown re-exported');
  assert.equal(typeof index.releaseNotesToJson, 'function', 'releaseNotesToJson re-exported');
}
console.log('   ✓ Index exports present');

console.log('✅ All release-notes tests passed');
