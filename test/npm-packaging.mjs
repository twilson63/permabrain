import assert from 'node:assert';
import { execSync, spawnSync } from 'node:child_process';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = join(__dirname, '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

const requiredFiles = [
  'src/index.mjs',
  'scripts/cli.mjs',
  'README.md',
  'package.json',
  'viewer/index.html',
  'skills/permabrain/SKILL.md',
  'skills/permabrain-pi/SKILL.md'
];

const expectedBins = { permabrain: './scripts/cli.mjs' };
const expectedMain = './src/index.mjs';

// 1. package.json metadata
assert.strictEqual(pkg.name, 'permabrain', 'package name is permabrain');
assert.ok(pkg.version, 'package version is set');
assert.strictEqual(pkg.main, expectedMain, 'main entry is ./src/index.mjs');
assert.deepStrictEqual(pkg.bin, expectedBins, 'bin map includes permabrain');
assert.ok(pkg.type === 'module', 'type is module');
assert.ok(Array.isArray(pkg.files), 'files array is defined');

function runNpm(args) {
  const child = spawnSync('npm', args, { cwd: root, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  return { stdout: child.stdout, stderr: child.stderr, status: child.status };
}

// 2. npm pack dry-run lists expected files
const dryRun = runNpm(['pack', '--dry-run']);
const packOut = dryRun.stdout;
const packErr = dryRun.stderr;
for (const f of requiredFiles) {
  assert.ok(packOut.includes(f) || packErr.includes(f), `npm pack dry-run should include ${f}`);
}
assert.ok(packOut.includes('Tarball Contents') || packErr.includes('Tarball Contents'), 'dry-run prints Tarball Contents');

// 3. actual npm pack produces a tarball
const tmpDir = join(tmpdir(), `pb-pack-${Date.now()}`);
mkdirSync(tmpDir, { recursive: true });
const packReal = runNpm(['pack', '--pack-destination', tmpDir]);
const tarball = packReal.stdout.trim();
assert.strictEqual(packReal.status, 0, `npm pack exited 0: ${packReal.stderr}`);
assert.ok(tarball.endsWith('.tgz'), `tarball ends with .tgz: ${tarball}`);
const tarballPath = join(tmpDir, tarball);

// 4. tarball contains package contents
const listOut = execSync('tar -tzf ' + tarballPath, { encoding: 'utf8', stdio: 'pipe' });
assert.ok(listOut.includes('package/scripts/cli.mjs'), 'tarball contains scripts/cli.mjs');
assert.ok(listOut.includes('package/src/index.mjs'), 'tarball contains src/index.mjs');
assert.ok(listOut.includes('package/README.md'), 'tarball contains README.md');
assert.ok(listOut.includes('package/viewer/index.html'), 'tarball contains viewer/index.html');
assert.ok(listOut.includes('package/skills/permabrain/SKILL.md'), 'tarball contains skill docs');

// 5. CLI --version / version command work
const cli = join(root, 'scripts', 'cli.mjs');
const versionOut = execSync(`node ${cli} --version`, { encoding: 'utf8', stdio: 'pipe' }).trim();
assert.strictEqual(versionOut, pkg.version, '--version prints package version');
const versionCmdOut = execSync(`node ${cli} version`, { encoding: 'utf8', stdio: 'pipe' }).trim();
assert.ok(versionCmdOut.includes(pkg.version), 'version command prints package version');
const versionJson = JSON.parse(execSync(`node ${cli} version --json`, { encoding: 'utf8', stdio: 'pipe' }).trim());
assert.strictEqual(versionJson.name, pkg.name, 'version --json includes name');
assert.strictEqual(versionJson.version, pkg.version, 'version --json includes version');

console.log('OK: npm packaging checklist passed');
