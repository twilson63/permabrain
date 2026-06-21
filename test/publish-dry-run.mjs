import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = join(__dirname, '..');
const pkgPath = join(root, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

// Ensure files field exists and includes expected publish paths
assert(Array.isArray(pkg.files), 'package.json must have a files array');
const required = ['src/', 'scripts/', 'viewer/', 'skills/permabrain/', 'skills/permabrain-pi/', 'CHANGELOG.md'];
for (const entry of required) {
  assert(pkg.files.includes(entry), `package.json files field must include ${entry}`);
}

// README must have an installation section
const readme = readFileSync(join(root, 'README.md'), 'utf8');
assert(readme.includes('## Installation'), 'README.md must have an Installation section');
assert(readme.includes('npm install -g permabrain'), 'README installation section should mention global install');
assert(readme.includes('npm install permabrain'), 'README installation section should mention local install');

// CHANGELOG must exist and be non-empty
const changelogPath = join(root, 'CHANGELOG.md');
assert(existsSync(changelogPath), 'CHANGELOG.md must exist');
const changelog = readFileSync(changelogPath, 'utf8');
assert(changelog.includes('## [Unreleased]'), 'CHANGELOG must have an Unreleased section');
assert(changelog.includes(pkg.version), `CHANGELOG should mention current version ${pkg.version}`);

// Run npm pack --dry-run and verify it succeeds and includes required files
const child = spawnSync('npm', ['pack', '--dry-run'], { cwd: root, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
const dryRun = `${child.stdout}\n${child.stderr}`;
assert(dryRun.includes('npm notice'), `npm pack --dry-run should produce notice output: ${dryRun.slice(0, 200)}`);
for (const entry of ['src/', 'scripts/', 'viewer/', 'src/client.mjs']) {
  assert(dryRun.includes(entry), `npm pack --dry-run should include ${entry}`);
}

console.log('OK: npm packaging checklist passed');
