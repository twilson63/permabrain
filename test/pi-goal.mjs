/**
 * Test: Pi skill `goal` integration — parse PRD/goal markdown and generate
 * `permabrain plan` / `permabrain import` workflows.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { parseGoal, planFromGoal, importArticlesFromGoal, attestationsFromGoal, parseGoalFile } from '../src/goal.mjs';

const PROJECT = path.resolve(import.meta.url.replace('file://', '').replace(/\/test\/.*$/, ''));
const CLI = path.join(PROJECT, 'scripts/cli.mjs');

// ─── Helpers ─────────────────────────────────────────────────────

function tmpFile(name, content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-goal-test-'));
  const file = path.join(dir, name);
  fs.writeFileSync(file, content, 'utf8');
  return file;
}

function runCli(args, expectFailure = false) {
  try {
    const result = execSync(`node "${CLI}" ${args}`, {
      cwd: PROJECT,
      encoding: 'utf8',
      timeout: 30000,
      env: { ...process.env, PERMABRAIN_KEY_TYPE: 'ed25519', PERMABRAIN_HOME: path.join(os.tmpdir(), `pb-pi-goal-${Date.now()}`) }
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

const SAMPLE_PRD = `# Add Telegram Onboarding Bot

Build a Telegram bot that guides new users through identity setup.

## Step 1 — Create bot entrypoint

Implement a Node.js HTTP webhook handler for Telegram updates.

Success criteria:
- Webhook endpoint returns 200 OK for valid updates.
- Invalid signatures are rejected with 401.
- Logs are written to .permabrain/logs/telegram-bot.log.

## Step 2 — Add inline button

Implement an inline "Open my bot" button in the completion message.

Success criteria:
- Final onboarding reply includes an inline keyboard button.
- Button text is "Open my bot".
- Button URL points to the user's Telegram bot link.

## Sources

- https://core.telegram.org/bots/api
- https://example.com/telegram-tutorial
`;

// ─── 1. parseGoal extracts title and summary ─────────────────────

console.log('1. parseGoal extracts title and summary');
{
  const parsed = parseGoal(SAMPLE_PRD);
  assert.equal(parsed.title, 'Add Telegram Onboarding Bot');
  assert.ok(parsed.summary.includes('Telegram bot'), 'summary includes Telegram bot');
}
console.log('   ✓ title and summary extracted');

// ─── 2. parseGoal extracts steps with criteria ────────────────────

console.log('2. parseGoal extracts steps with criteria');
{
  const parsed = parseGoal(SAMPLE_PRD);
  assert.equal(parsed.steps.length, 2, 'two steps');
  assert.equal(parsed.steps[0].title, 'Step 1 — Create bot entrypoint');
  assert.equal(parsed.steps[0].criteria.length, 3, 'step 1 has three criteria');
  assert.ok(parsed.steps[0].criteria.some(c => c.includes('200 OK')), 'step 1 has 200 OK criterion');
  assert.equal(parsed.steps[1].title, 'Step 2 — Add inline button');
  assert.ok(parsed.steps[1].criteria.some(c => c.includes('Open my bot')), 'step 2 has button text criterion');
}
console.log('   ✓ steps and criteria extracted');

// ─── 3. parseGoal extracts URLs ──────────────────────────────────

console.log('3. parseGoal extracts URLs');
{
  const parsed = parseGoal(SAMPLE_PRD);
  assert.equal(parsed.urls.length, 2, 'two URLs');
  assert.ok(parsed.urls.some(u => u.url === 'https://core.telegram.org/bots/api'), 'telegram API URL found');
  assert.ok(parsed.urls.some(u => u.url === 'https://example.com/telegram-tutorial'), 'tutorial URL found');
}
console.log('   ✓ URLs extracted');

// ─── 4. planFromGoal builds plan JSON ────────────────────────────

console.log('4. planFromGoal builds plan JSON');
{
  const parsed = parseGoal(SAMPLE_PRD, { topics: ['messaging'] });
  const plan = planFromGoal(parsed, { topic: 'messaging' });
  assert.equal(plan.title, 'Add Telegram Onboarding Bot');
  assert.equal(plan.steps.length, 2);
  assert.equal(plan.importArticles.length, 2, 'two import articles');
  assert.equal(plan.publishArticles.length, 2, 'two publishable step articles');
  assert.equal(plan.attestations.length, 2, 'two attestations');
  assert.ok(plan.planKey, 'planKey generated');
  assert.equal(plan.topic, 'messaging', 'topic override respected');
  assert.equal(plan.kind, 'subject', 'default kind is subject');
}
console.log('   ✓ plan JSON generated');

// ─── 5. importArticlesFromGoal output ────────────────────────────

console.log('5. importArticlesFromGoal output');
{
  const parsed = parseGoal(SAMPLE_PRD);
  const articles = importArticlesFromGoal(parsed);
  assert.ok(Array.isArray(articles));
  assert.equal(articles.length, 2);
  for (const art of articles) {
    assert.ok(art.url, 'article has url');
    assert.ok(art.kind, 'article has kind');
    assert.ok(art.topic, 'article has topic');
    assert.ok(art.key, 'article has key');
  }
}
console.log('   ✓ import articles generated');

// ─── 6. attestationsFromGoal output ──────────────────────────────

console.log('6. attestationsFromGoal output');
{
  const parsed = parseGoal(SAMPLE_PRD);
  const attestations = attestationsFromGoal(parsed);
  assert.ok(Array.isArray(attestations));
  assert.equal(attestations.length, 2);
  for (const att of attestations) {
    assert.ok(att.key, 'attestation has key');
    assert.equal(att.opinion, 'valid');
    assert.equal(att.confidence, 0.9);
    assert.ok(att.reason, 'attestation has reason');
  }
}
console.log('   ✓ attestations generated');

// ─── 7. Fallback parser for plain numbered steps ─────────────────

console.log('7. Fallback parser for plain numbered steps');
{
  const prd = `# Simple Plan

1. First thing to do
2. Second thing to do
3. Third thing to do
`;
  const parsed = parseGoal(prd);
  assert.equal(parsed.steps.length, 3, 'three fallback steps');
  assert.equal(parsed.steps[0].title, 'First thing to do');
  assert.ok(parsed.steps[2].criteria.length > 0, 'third step has inferred criteria');
}
console.log('   ✓ fallback parser works');

// ─── 8. parseGoalFile reads from disk ────────────────────────────

console.log('8. parseGoalFile reads from disk');
{
  const file = tmpFile('prd.md', SAMPLE_PRD);
  const parsed = parseGoalFile(file, { topics: ['messaging'] });
  assert.equal(parsed.title, 'Add Telegram Onboarding Bot');
  assert.equal(parsed.steps.length, 2);
}
console.log('   ✓ parseGoalFile works');

// ─── 9. CLI: goal command registered ───────────────────────────────

console.log('9. CLI: goal command registered');
{
  const commandsSrc = fs.readFileSync(path.join(PROJECT, 'src/commands.mjs'), 'utf8');
  assert.ok(commandsSrc.includes("'goal'"), 'commands.mjs includes goal');
  assert.ok(commandsSrc.includes('goalCommand'), 'commands.mjs has goalCommand function');

  const cliSrc = fs.readFileSync(CLI, 'utf8');
  assert.ok(cliSrc.includes("'goal'"), 'CLI COMMANDS includes goal');
  assert.ok(cliSrc.includes("'plan'"), 'CLI COMMANDS includes plan');
}
console.log('   ✓ goal/plan commands registered');

// ─── 10. CLI: goal --help ───────────────────────────────────────

console.log('10. CLI: goal --help');
{
  const helpOutput = runCli('goal --help');
  assert.ok(helpOutput.includes('--topic'), 'help mentions --topic');
  assert.ok(helpOutput.includes('--kind'), 'help mentions --kind');
  assert.ok(helpOutput.includes('--execute'), 'help mentions --execute');
}
console.log('   ✓ goal help works');

// ─── 11. CLI: plan --help ────────────────────────────────────────

console.log('11. CLI: plan --help');
{
  const helpOutput = runCli('plan --help');
  assert.ok(helpOutput.includes('goal'), 'plan help references goal');
}
console.log('   ✓ plan help works');

// ─── 12. CLI: goal requires file argument ─────────────────────────

console.log('12. CLI: goal requires file argument');
{
  const error = runCli('goal', true);
  assert.match(error, /prd-file|file/i, 'error mentions PRD file');
}
console.log('   ✓ goal validates file argument');

// ─── 13. CLI: goal generates JSON plan ────────────────────────────

console.log('13. CLI: goal generates JSON plan');
{
  const file = tmpFile('prd.md', SAMPLE_PRD);
  const output = runCli(`goal "${file}" --json --topic messaging`);
  const plan = JSON.parse(output);
  assert.equal(plan.title, 'Add Telegram Onboarding Bot');
  assert.equal(plan.steps.length, 2);
  assert.equal(plan.topic, 'messaging');
  assert.equal(plan.importArticles.length, 2);
}
console.log('   ✓ goal CLI outputs JSON plan');

// ─── 14. CLI: plan alias generates JSON plan ──────────────────────

console.log('14. CLI: plan alias generates JSON plan');
{
  const file = tmpFile('prd.md', SAMPLE_PRD);
  const output = runCli(`plan "${file}" --json`);
  const plan = JSON.parse(output);
  assert.equal(plan.title, 'Add Telegram Onboarding Bot');
  assert.ok(plan.steps.length >= 2);
}
console.log('   ✓ plan alias outputs JSON plan');

// ─── 15. CLI: goal --import output ─────────────────────────────────

console.log('15. CLI: goal --import output');
{
  const file = tmpFile('prd.md', SAMPLE_PRD);
  const output = runCli(`goal "${file}" --import --json --topic messaging`);
  const articles = JSON.parse(output);
  assert.ok(Array.isArray(articles));
  assert.equal(articles.length, 2);
  assert.ok(articles.every(a => a.url && a.key && a.kind && a.topic));
}
console.log('   ✓ goal --import outputs import articles');

// ─── 16. CLI: goal --batch-attest output ──────────────────────────

console.log('16. CLI: goal --batch-attest output');
{
  const file = tmpFile('prd.md', SAMPLE_PRD);
  const output = runCli(`goal "${file}" --batch-attest --json --topic messaging`);
  const attestations = JSON.parse(output);
  assert.ok(Array.isArray(attestations));
  assert.equal(attestations.length, 2);
  assert.ok(attestations.every(a => a.key && a.opinion === 'valid' && a.confidence === 0.9));
}
console.log('   ✓ goal --batch-attest outputs attestation spec');

// ─── 17. Agent API: parseGoal available ──────────────────────────

console.log('17. Agent API: parseGoal available');
{
  const { api } = await import('../src/agent-api.mjs');
  const parsed = await api.parseGoal(SAMPLE_PRD);
  assert.equal(parsed.title, 'Add Telegram Onboarding Bot');
  assert.equal(parsed.steps.length, 2);
}
console.log('   ✓ api.parseGoal works');

// ─── 18. Agent API: planFromGoal available ─────────────────────────

console.log('18. Agent API: planFromGoal available');
{
  const { api } = await import('../src/agent-api.mjs');
  const parsed = await api.parseGoal(SAMPLE_PRD, { topics: ['messaging'] });
  const plan = await api.planFromGoal(parsed);
  assert.equal(plan.title, 'Add Telegram Onboarding Bot');
  assert.equal(plan.topic, 'messaging');
  assert.equal(plan.publishArticles.length, 2);
}
console.log('   ✓ api.planFromGoal works');

// ─── 19. Agent API: goalFromFile available ─────────────────────────

console.log('19. Agent API: goalFromFile available');
{
  const { api } = await import('../src/agent-api.mjs');
  const file = tmpFile('prd.md', SAMPLE_PRD);
  const plan = await api.goalFromFile(file, { topics: ['messaging'] });
  assert.equal(plan.title, 'Add Telegram Onboarding Bot');
  assert.equal(plan.steps.length, 2);
}
console.log('   ✓ api.goalFromFile works');

// ─── 20. Skill docs mention goal integration ──────────────────────

console.log('20. Skill docs mention goal integration');
{
  const goalSkill = fs.readFileSync(path.join(PROJECT, 'skills', 'permabrain-pi', 'goal.md'), 'utf8');
  assert.ok(goalSkill.includes('/goal'), 'goal.md mentions /goal');
  assert.ok(goalSkill.includes('api.goalFromFile') || goalSkill.includes('api.parseGoal'), 'goal.md mentions goal API');
  assert.ok(goalSkill.includes('permabrain goal') || goalSkill.includes('permabrain plan'), 'goal.md mentions goal CLI');
}
console.log('   ✓ skill docs updated');

console.log('\n✅ All Pi skill goal integration tests passed');
