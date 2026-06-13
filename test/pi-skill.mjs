/**
 * Test: Pi skill integration — batch-attest, auto-import CLI commands
 * and agent API methods (batchAttest, autoImport, parseAttestationRequest,
 * buildAttestationRequest, listKnownAgents, getKnownAgent)
 *
 * These are unit tests that validate input/output without network calls.
 * Network-dependent tests are in test.mjs (local transport tests).
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';

const PROJECT = path.resolve(import.meta.url.replace('file://', '').replace(/\/test\/.*$/, ''));
const CLI = path.join(PROJECT, 'scripts/cli.mjs');

// ─── Helper: Run CLI command ──────────────────────────────────────

function runCli(args, expectFailure = false) {
  try {
    const result = execSync(`node "${CLI}" ${args}`, {
      cwd: PROJECT,
      encoding: 'utf8',
      timeout: 30000,
      env: { ...process.env, PERMABRAIN_KEY_TYPE: 'ed25519', PERMABRAIN_HOME: path.join(os.tmpdir(), `pb-pi-test-${Date.now()}`) }
    });
    if (expectFailure) {
      assert.fail(`Expected CLI to fail but it succeeded: ${result}`);
    }
    return result;
  } catch (err) {
    if (expectFailure) return err.stderr || err.stdout || err.message;
    throw err;
  }
}

// ─── 1. CLI: batch-attest command exists ──────────────────────────

console.log('1. CLI: batch-attest command is recognized');
{
  // Test that batch-attest is in the COMMANDS list
  const commandsSrc = fs.readFileSync(path.join(PROJECT, 'src/commands.mjs'), 'utf8');
  assert.ok(commandsSrc.includes('batch-attest'), 'commands.mjs includes batch-attest');
  assert.ok(commandsSrc.includes('batchAttestCommand'), 'commands.mjs has batchAttestCommand function');
  
  const cliSrc = fs.readFileSync(CLI, 'utf8');
  assert.ok(cliSrc.includes('batch-attest'), 'CLI includes batch-attest in COMMANDS');
}
console.log('   ✓ batch-attest command registered');

// ─── 2. CLI: auto-import command exists ───────────────────────────

console.log('2. CLI: auto-import command is recognized');
{
  const commandsSrc = fs.readFileSync(path.join(PROJECT, 'src/commands.mjs'), 'utf8');
  assert.ok(commandsSrc.includes('auto-import'), 'commands.mjs includes auto-import');
  assert.ok(commandsSrc.includes('autoImportCommand'), 'commands.mjs has autoImportCommand function');
  
  const cliSrc = fs.readFileSync(CLI, 'utf8');
  assert.ok(cliSrc.includes('auto-import'), 'CLI includes auto-import in COMMANDS');
}
console.log('   ✓ auto-import command registered');

// ─── 3. CLI: batch-attest help ────────────────────────────────────

console.log('3. CLI: batch-attest --help');
{
  const helpOutput = runCli('batch-attest --help');
  assert.ok(helpOutput.includes('--file'), 'help mentions --file');
  assert.ok(helpOutput.includes('JSON array'), 'help mentions JSON array');
}
console.log('   ✓ batch-attest help works');

// ─── 4. CLI: auto-import help ─────────────────────────────────────

console.log('4. CLI: auto-import --help');
{
  const helpOutput = runCli('auto-import --help');
  assert.ok(helpOutput.includes('--file'), 'help mentions --file');
  assert.ok(helpOutput.includes('URL'), 'help mentions URL');
}
console.log('   ✓ auto-import help works');

// ─── 5. CLI: batch-attest requires --file ─────────────────────────

console.log('5. CLI: batch-attest requires --file');
{
  const error = runCli('batch-attest', true);
  assert.match(error, /--file/i, 'error mentions --file is required');
}
console.log('   ✓ batch-attest validates --file');

// ─── 6. CLI: auto-import requires --file ──────────────────────────

console.log('6. CLI: auto-import requires --file');
{
  const error = runCli('auto-import', true);
  assert.match(error, /--file/i, 'error mentions --file is required');
}
console.log('   ✓ auto-import validates --file');

// ─── 7. CLI: batch-attest with invalid file ───────────────────────

console.log('7. CLI: batch-attest with nonexistent file');
{
  const error = runCli('batch-attest --file /nonexistent/path.json', true);
  assert.match(error, /(ENOENT|read|parse|Failed)/i, 'error mentions file read failure');
}
console.log('   ✓ batch-attest fails on missing file');

// ─── 8. CLI: auto-import with invalid file ────────────────────────

console.log('8. CLI: auto-import with nonexistent file');
{
  const error = runCli('auto-import --file /nonexistent/path.json', true);
  assert.match(error, /(ENOENT|read|parse|Failed)/i, 'error mentions file read failure');
}
console.log('   ✓ auto-import fails on missing file');

// ─── 9. Agent API: batchAttest input validation ──────────────────

console.log('9. Agent API: batchAttest validates inputs');
{
  const { api } = await import('../src/agent-api.mjs');
  
  // Missing attestations
  await assert.rejects(
    () => api.batchAttest({}),
    /attestations array is required/
  );
  
  // Empty attestations
  await assert.rejects(
    () => api.batchAttest({ attestations: [] }),
    /attestations array is required/
  );
}
console.log('   ✓ batchAttest validates required inputs');

// ─── 10. Agent API: autoImport input validation ──────────────────

console.log('10. Agent API: autoImport validates inputs');
{
  const { api } = await import('../src/agent-api.mjs');
  
  // Missing articles
  await assert.rejects(
    () => api.autoImport({}),
    /articles array is required/
  );
  
  // Empty articles
  await assert.rejects(
    () => api.autoImport({ articles: [] }),
    /articles array is required/
  );
}
console.log('   ✓ autoImport validates required inputs');

// ─── 11. Agent API: parseAttestationRequest validation ────────────

console.log('11. Agent API: parseAttestationRequest validates');
{
  const { api } = await import('../src/agent-api.mjs');
  
  // Missing type
  assert.throws(
    () => api.parseAttestationRequest({}),
    /Invalid request type/
  );
  
  // Wrong type
  assert.throws(
    () => api.parseAttestationRequest({ type: 'wrong' }),
    /Invalid request type/
  );
  
  // Missing fields
  assert.throws(
    () => api.parseAttestationRequest({ type: 'permabrain-attest' }),
    /agentId is required/
  );
  
  // Valid request
  const req = api.parseAttestationRequest({
    type: 'permabrain-attest',
    agentId: 'ed25519:test',
    key: 'subject/ai',
    opinion: 'valid',
    confidence: 0.9,
    reason: 'Well-sourced'
  }, 'fingerprint123');
  
  assert.equal(req.type, 'permabrain-attest');
  assert.equal(req.agentId, 'ed25519:test');
  assert.equal(req.key, 'subject/ai');
  assert.equal(req.opinion, 'valid');
  assert.equal(req.confidence, 0.9);
  assert.equal(req.reason, 'Well-sourced');
  assert.equal(req.senderFingerprint, 'fingerprint123');
}
console.log('   ✓ parseAttestationRequest validates and parses');

// ─── 12. Agent API: buildAttestationRequest ───────────────────────

console.log('12. Agent API: buildAttestationRequest');
{
  const { api } = await import('../src/agent-api.mjs');
  
  // Missing fields
  assert.throws(() => api.buildAttestationRequest({}), /key is required/);
  assert.throws(() => api.buildAttestationRequest({ key: 'k' }), /opinion is required/);
  
  // Valid request
  const body = api.buildAttestationRequest({
    key: 'subject/ai',
    opinion: 'valid',
    confidence: 0.9,
    reason: 'Accurate',
    agentId: 'ed25519:me',
    sourceUrl: 'https://example.com',
    targetId: 'tx123'
  });
  
  assert.equal(body.type, 'permabrain-attest');
  assert.equal(body.key, 'subject/ai');
  assert.equal(body.opinion, 'valid');
  assert.equal(body.confidence, 0.9);
  assert.equal(body.reason, 'Accurate');
  assert.equal(body.agentId, 'ed25519:me');
  assert.equal(body.sourceUrl, 'https://example.com');
  assert.equal(body.targetId, 'tx123');
  assert.ok(body.requestedAt, 'has timestamp');
}
console.log('   ✓ buildAttestationRequest works');

// ─── 13. Agent API: listKnownAgents / getKnownAgent ───────────────

console.log('13. Agent API: listKnownAgents / getKnownAgent');
{
  const { api } = await import('../src/agent-api.mjs');
  
  const agents = api.listKnownAgents();
  assert.ok(Array.isArray(agents), 'returns array');
  assert.ok(agents.length >= 2, 'at least 2 known agents');
  
  const sage = api.getKnownAgent('sage');
  assert.ok(sage, 'sage found');
  assert.equal(sage.name, 'Sage');
  assert.ok(sage.publicKeyFingerprint, 'sage has fingerprint');
  
  const unknown = api.getKnownAgent('nonexistent');
  assert.equal(unknown, null, 'unknown agent returns null');
}
console.log('   ✓ listKnownAgents / getKnownAgent work');

// ─── 14. Pi skill files exist ─────────────────────────────────────

console.log('14. Pi skill files exist');
{
  const skillDir = path.join(PROJECT, 'skills', 'permabrain-pi');
  assert.ok(fs.existsSync(path.join(skillDir, 'SKILL.md')), 'SKILL.md exists');
  assert.ok(fs.existsSync(path.join(skillDir, 'goal.md')), 'goal.md exists');
  assert.ok(fs.existsSync(path.join(skillDir, 'pi-prompt.md')), 'pi-prompt.md exists');
  
  const skill = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
  assert.ok(skill.includes('batchAttest'), 'SKILL.md mentions batchAttest');
  assert.ok(skill.includes('autoImport'), 'SKILL.md mentions autoImport');
  assert.ok(skill.includes('batch-attest'), 'SKILL.md mentions batch-attest CLI');
  assert.ok(skill.includes('auto-import'), 'SKILL.md mentions auto-import CLI');
  
  const goal = fs.readFileSync(path.join(skillDir, 'goal.md'), 'utf8');
  assert.ok(goal.includes('api.publish'), 'goal.md has publish');
  assert.ok(goal.includes('api.batchAttest'), 'goal.md has batchAttest');
  assert.ok(goal.includes('api.autoImport'), 'goal.md has autoImport');
  
  const prompt = fs.readFileSync(path.join(skillDir, 'pi-prompt.md'), 'utf8');
  assert.ok(prompt.includes('batchAttest'), 'pi-prompt.md has batchAttest');
  assert.ok(prompt.includes('autoImport'), 'pi-prompt.md has autoImport');
}
console.log('   ✓ Pi skill files complete');

// ─── 15. CLI main help includes new commands ──────────────────────

console.log('15. CLI main help includes batch-attest and auto-import');
{
  const help = runCli('--help');
  assert.ok(help.includes('batch-attest'), 'main help mentions batch-attest');
  assert.ok(help.includes('auto-import'), 'main help mentions auto-import');
}
console.log('   ✓ CLI help includes new commands');

// ─── 16. HyperBEAM device commands registered ─────────────────────

console.log('16. CLI: HyperBEAM device commands are recognized');
{
  const cliSrc = fs.readFileSync(CLI, 'utf8');
  for (const cmd of ['probe-devices', 'match', 'deploy-consensus', 'meta-info', 'whois']) {
    assert.ok(cliSrc.includes(`'${cmd}'`), `CLI COMMANDS includes ${cmd}`);
    assert.ok(cliSrc.includes(`${cmd}:`) || cliSrc.includes(`'${cmd}':`), `CLI help object includes ${cmd}`);
  }
}
console.log('   ✓ HyperBEAM device commands registered');

// ─── 17. HyperBEAM device command help ──────────────────────────

console.log('17. CLI: HyperBEAM device command help works');
{
  for (const cmd of ['probe-devices', 'match', 'deploy-consensus', 'meta-info', 'whois']) {
    const help = runCli(`${cmd} --help`);
    assert.ok(help.length > 0, `${cmd} --help produces output`);
    assert.ok(help.includes('Usage:'), `${cmd} help includes Usage`);
  }
}
console.log('   ✓ HyperBEAM device command help works');

// ─── 18. CLI main help includes HyperBEAM device commands ─────────

console.log('18. CLI main help includes HyperBEAM device commands');
{
  const help = runCli('--help');
  for (const cmd of ['probe-devices', 'match', 'deploy-consensus', 'meta-info', 'whois']) {
    assert.ok(help.includes(cmd), `main help mentions ${cmd}`);
  }
}
console.log('   ✓ CLI main help includes HyperBEAM device commands');

console.log('\n✅ All Pi skill integration tests passed');