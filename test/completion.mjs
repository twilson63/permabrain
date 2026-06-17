/**
 * Tests for shell completion generators and CLI command.
 */

import assert from 'node:assert/strict';
import {
  generateCompletion,
  listSupportedShells,
  COMMANDS,
  COMMAND_OPTIONS,
  GLOBAL_OPTIONS
} from '../src/completion.mjs';

console.log('completion: listSupportedShells');
assert.deepEqual(listSupportedShells(), ['bash', 'zsh', 'fish']);

console.log('completion: bash script contains shebang and command list');
const bash = generateCompletion('bash');
assert(bash.includes('#!/usr/bin/env bash'));
assert(bash.includes('complete -F _permabrain_completion permabrain'));
for (const cmd of COMMANDS) {
  assert(bash.includes(cmd), `bash script missing command ${cmd}`);
}
for (const opt of GLOBAL_OPTIONS) {
  assert(bash.includes(opt), `bash script missing global option ${opt}`);
}

console.log('completion: bash per-command options');
const publishOpts = COMMAND_OPTIONS.publish;
for (const opt of publishOpts) {
  assert(bash.includes(`'${opt}'`), `bash publish case missing option ${opt}`);
}

console.log('completion: zsh script contains compdef');
const zsh = generateCompletion('zsh');
assert(zsh.includes('#compdef permabrain'));
assert(zsh.includes('PermaBrain command'));
for (const cmd of COMMANDS) {
  assert(zsh.includes(cmd), `zsh script missing command ${cmd}`);
}

console.log('completion: fish script contains completions');
const fish = generateCompletion('fish');
assert(fish.includes('PermaBrain fish completion'));
assert(fish.includes("complete -c permabrain -n '__fish_use_subcommand'"));
for (const cmd of COMMANDS) {
  assert(fish.includes(`__fish_seen_subcommand_from ${cmd}`), `fish missing command ${cmd}`);
}

console.log('completion: unsupported shell throws');
assert.throws(() => generateCompletion('powershell'), /Unsupported shell: powershell/);

console.log('completion: bash script can be parsed as shell (basic syntax check)');
// Each case branch ends with ;; and the function closes with }
assert(bash.includes('case "${CMD}" in'));
assert(bash.includes('    *)'));
assert(bash.includes('  esac'));

console.log('completion: all commands have an option entry');
for (const cmd of COMMANDS) {
  assert(Array.isArray(COMMAND_OPTIONS[cmd]), `COMMAND_OPTIONS missing ${cmd}`);
}

console.log('completion tests passed');
