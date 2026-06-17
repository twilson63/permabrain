import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = join(__dirname, '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const cli = join(root, 'scripts', 'cli.mjs');

function run(args) {
  return spawnSync('node', [cli, ...args], { encoding: 'utf8' });
}

// --version prints the package version and exits 0
{
  const child = run(['--version']);
  assert.strictEqual(child.status, 0, `--version should exit 0: ${child.stderr}`);
  assert.strictEqual(child.stdout.trim(), pkg.version, `--version should print ${pkg.version}`);
}

// -v is a short alias
{
  const child = run(['-v']);
  assert.strictEqual(child.status, 0, `-v should exit 0: ${child.stderr}`);
  assert.strictEqual(child.stdout.trim(), pkg.version, `-v should print ${pkg.version}`);
}

// Help banner includes the version
{
  const child = run(['--help']);
  assert.strictEqual(child.status, 0, `--help should exit 0`);
  assert(child.stdout.includes(`v${pkg.version}`), 'help banner should include version');
}

console.log('✅ All version tests passed');
