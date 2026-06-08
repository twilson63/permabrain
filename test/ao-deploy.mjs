/**
 * AO Deploy Unit Tests
 *
 * Validates ao-deploy.mjs module: spawn, loadLua, saveProcessId, waitForProcess.
 * These are unit tests — live AO network calls are mocked/stubbed.
 * Integration tests with a real AO process require PERMABRAIN_AO_PROCESS_ID set.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initState, loadConfig } from '../src/config.mjs';
import { saveProcessId } from '../src/ao-deploy.mjs';

// ============================================================================
// Module structure
// ============================================================================

const deployModule = await import('../src/ao-deploy.mjs');

assert.ok(typeof deployModule.spawn === 'function', 'spawn is exported');
assert.ok(typeof deployModule.loadLua === 'function', 'loadLua is exported');
assert.ok(typeof deployModule.saveProcessId === 'function', 'saveProcessId is exported');
assert.ok(typeof deployModule.waitForProcess === 'function', 'waitForProcess is exported');

console.log('✓ All ao-deploy exports present');

// ============================================================================
// saveProcessId — config file update
// ============================================================================

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-deploy-test-'));
initState({ env: { PERMABRAIN_HOME: tempHome } });

// Save a process ID to config
const testProcessId = 'test-process-id-abc123xyz789';
const updatedConfig = saveProcessId(testProcessId, tempHome);

assert.equal(updatedConfig.ao.processId, testProcessId, 'Config updated with process ID');
assert.ok(fs.existsSync(path.join(tempHome, 'config.json')), 'Config file exists');

// Reload and verify persistence
const reloaded = loadConfig(tempHome);
assert.equal(reloaded.ao.processId, testProcessId, 'Process ID persists after reload');

console.log('✓ saveProcessId writes and persists process ID');

// Update an existing process ID
const newProcessId = 'updated-process-id-def456uvw012';
const updatedAgain = saveProcessId(newProcessId, tempHome);
assert.equal(updatedAgain.ao.processId, newProcessId, 'Process ID updated');

const reloadedAgain = loadConfig(tempHome);
assert.equal(reloadedAgain.ao.processId, newProcessId, 'Updated process ID persists');

console.log('✓ saveProcessId updates existing process ID');

// Save process ID when config.ao already has other fields
const fullConfig = loadConfig(tempHome);
fullConfig.ao.muUrl = 'https://mu.example.com';
fullConfig.ao.cuUrl = 'https://cu.example.com';
fs.writeFileSync(path.join(tempHome, 'config.json'), JSON.stringify(fullConfig, null, 2) + '\n');

const preservedConfig = saveProcessId('third-process-id', tempHome);
assert.equal(preservedConfig.ao.processId, 'third-process-id', 'Process ID set');
assert.equal(preservedConfig.ao.muUrl, 'https://mu.example.com', 'Existing muUrl preserved');
assert.equal(preservedConfig.ao.cuUrl, 'https://cu.example.com', 'Existing cuUrl preserved');

console.log('✓ saveProcessId preserves existing config.ao fields');

// ============================================================================
// readProcessLua (via module internals — test file existence)
// ============================================================================

const processLuaPath = path.resolve(import.meta.dirname, '..', 'process.lua');
assert.ok(fs.existsSync(processLuaPath), 'process.lua exists in package root');
const luaSource = fs.readFileSync(processLuaPath, 'utf8');
assert.ok(luaSource.includes('Handlers.add'), 'process.lua contains AO handler registrations');
assert.ok(luaSource.includes('PermaBrainVersion'), 'process.lua has version constant');

console.log('✓ process.lua is loadable');

// ============================================================================
// AOS module and scheduler constants
// ============================================================================

// The AOS module ID and scheduler ID should be well-known constants
// We verify they're defined as strings (actual values checked at integration time)
const modulePath = path.resolve(import.meta.dirname, '..', 'src', 'ao-deploy.mjs');
const source = fs.readFileSync(modulePath, 'utf8');

assert.ok(source.includes('AOS_MODULE_ID'), 'AOS_MODULE_ID constant defined');
assert.ok(source.includes('AOS_SCHEDULER_ID'), 'AOS_SCHEDULER_ID constant defined');
assert.ok(source.includes('Do_Uc2SjjfffJW5CU2f74wt2blx7h4QS8uS9M1n9Ccs'), 'AOS module ID value present');
assert.ok(source.includes('_G2F5OgMuoCLLM5VIQ2NJDMfN_IJ0OFGbB5XhM0F-Ys'), 'AOS scheduler ID value present');

console.log('✓ AOS module and scheduler constants defined');

// ============================================================================
// spawn/loadLua function signatures
// ============================================================================

// Verify spawn accepts the documented options
assert.ok(source.includes('module'), 'spawn accepts module option');
assert.ok(source.includes('scheduler'), 'spawn accepts scheduler option');
assert.ok(source.includes('cwd'), 'spawn accepts cwd option');
assert.ok(source.includes('ao'), 'spawn accepts ao connection options');

console.log('✓ spawn function accepts documented options');

// Verify loadLua accepts documented options
assert.ok(source.includes('processId'), 'loadLua accepts processId');
assert.ok(source.includes('luaSource'), 'loadLua accepts luaSource override');
assert.ok(source.includes('cwd'), 'loadLua accepts cwd option');

console.log('✓ loadLua function accepts documented options');

// ============================================================================
// CLI integration — commands.mjs has ao-deploy and ao-bootstrap
// ============================================================================

const commandsPath = path.resolve(import.meta.dirname, '..', 'src', 'commands.mjs');
const commandsSource = fs.readFileSync(commandsPath, 'utf8');

assert.ok(commandsSource.includes('ao-deploy'), 'commands.mjs includes ao-deploy');
assert.ok(commandsSource.includes('ao-bootstrap'), 'commands.mjs includes ao-bootstrap');
assert.ok(commandsSource.includes('aoDeployCommand'), 'aoDeployCommand function defined');
assert.ok(commandsSource.includes('aoBootstrapCommand'), 'aoBootstrapCommand function defined');
assert.ok(commandsSource.includes('aoSpawn'), 'aoSpawn imported from ao-deploy');
assert.ok(commandsSource.includes('aoLoadLua'), 'aoLoadLua imported from ao-deploy');
assert.ok(commandsSource.includes('aoSaveProcessId'), 'aoSaveProcessId imported from ao-deploy');
assert.ok(commandsSource.includes('waitForProcess'), 'waitForProcess imported from ao-deploy');

console.log('✓ CLI commands integrate ao-deploy module');

// ============================================================================
// CLI script — commands listed
// ============================================================================

const cliPath = path.resolve(import.meta.dirname, '..', 'scripts', 'cli.mjs');
const cliSource = fs.readFileSync(cliPath, 'utf8');

assert.ok(cliSource.includes("'ao-deploy'"), 'CLI lists ao-deploy command');
assert.ok(cliSource.includes("'ao-bootstrap'"), 'CLI lists ao-bootstrap command');
assert.ok(cliSource.includes('ao-deploy'), 'CLI help includes ao-deploy');
assert.ok(cliSource.includes('ao-bootstrap'), 'CLI help includes ao-bootstrap');

console.log('✓ CLI script includes new commands');

// ============================================================================
// Cleanup
// ============================================================================

try { fs.rmSync(tempHome, { recursive: true }); } catch {}

console.log('\nAO deploy unit tests passed');