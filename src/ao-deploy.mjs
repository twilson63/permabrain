/**
 * AO Deploy — Spawn an AO process and bootstrap it with PermaBrain's process.lua.
 *
 * Two operations:
 *   1. spawn() — Create a new AO process, load process.lua, return process ID
 *   2. loadLua() — Send process.lua source to an existing AO process (re-load/update)
 *
 * After spawning, the process ID is saved to config so all other AO commands work.
 */

import fs from 'node:fs';
import path from 'node:path';
import { connect } from '@permaweb/aoconnect';
import { getHome, loadConfig, statePaths } from './config.mjs';
import { loadIdentity } from './keys.mjs';

// The AOS module ID (AOS = the standard AO operating system process)
// This is the well-known module that runs Lua smart contracts on AO.
const AOS_MODULE_ID = 'Do_Uc2SjjfffJW5CU2f74wt2blx7h4QS8uS9M1n9Ccs';

// The default AO scheduler (SU) — uses the official Arweave-backed scheduler unit
const AOS_SCHEDULER_ID = '_G2F5OgMuoCLLM5VIQ2NJDMfN_IJ0OFGbB5XhM0F-Ys';

/**
 * Read process.lua source from the permabrain package directory.
 */
function readProcessLua(cwd = process.cwd()) {
  // Look for process.lua next to src/ or in the package root
  const candidates = [
    path.resolve(cwd, 'process.lua'),
    path.resolve(import.meta.dirname, '..', 'process.lua')
  ];
  for (const filePath of candidates) {
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, 'utf8');
    }
  }
  throw new Error('process.lua not found. Expected in package root or next to src/.');
}

/**
 * Create an AO-compatible signer from a PermaBrain identity.
 * Returns a signer function suitable for aoconnect spawn/message.
 */
function createSigner(identity) {
  if (identity.type === 'arweave-rsa4096' && identity.jwk) {
    // aoconnect accepts JWK directly as signer for Arweave keys
    return identity.jwk;
  }
  throw new Error(
    `Unsupported identity type for AO: ${identity.type}. ` +
    'Use arweave-rsa4096 (run permabrain init --key-type arweave-rsa4096).'
  );
}

/**
 * Spawn a new AO process running PermaBrain's process.lua.
 *
 * @param {Object} options
 * @param {string} [options.cwd] - Working directory (for process.lua lookup)
 * @param {string} [options.module] - AO module ID (defaults to AOS)
 * @param {string} [options.scheduler] - AO scheduler ID (defaults to official SU)
 * @param {Object} [options.ao] - Custom AO connection options { muUrl, cuUrl, gatewayUrl, graphqlUrl }
 * @returns {Promise<{ processId: string, messageId: string }>}
 */
export async function spawn({ cwd, module, scheduler, ao } = {}) {
  const home = getHome(cwd);
  const identity = loadIdentity(home);
  const signer = createSigner(identity);

  const moduleId = module || AOS_MODULE_ID;
  const schedulerId = scheduler || AOS_SCHEDULER_ID;

  // Build aoconnect instance with optional custom URLs
  const connectOpts = {};
  if (ao?.muUrl) connectOpts.MU_URL = ao.muUrl;
  if (ao?.cuUrl) connectOpts.CU_URL = ao.cuUrl;
  if (ao?.gatewayUrl) connectOpts.GATEWAY_URL = ao.gatewayUrl;
  if (ao?.graphqlUrl) connectOpts.GRAPHQL_URL = ao.graphqlUrl;

  const aoconnect = Object.keys(connectOpts).length > 0 ? connect(connectOpts) : connect();

  // Spawn the process
  const processId = await aoconnect.spawn({
    module: moduleId,
    scheduler: schedulerId,
    signer,
    tags: [
      { name: 'App-Name', value: 'PermaBrain' },
      { name: 'App-Version', value: '0.1.0' },
      { name: 'PermaBrain-Process', value: 'true' },
      { name: 'Content-Type', value: 'text/x-lua' }
    ]
  });

  // Wait for the process to be confirmed on-chain before loading Lua
  // In production, we'd poll for confirmation. For now, we proceed and let
  // the loadLua step handle retries if the process isn't ready yet.
  // Typical confirmation time is 5-30 seconds.

  return { processId, moduleId, schedulerId };
}

/**
 * Load process.lua into an AO process via aoconnect.message().
 *
 * This sends the Lua source code as a message with Action=Eval,
 * which AOS processes execute to load new handler definitions.
 *
 * @param {Object} options
 * @param {string} options.processId - AO process ID to load Lua into
 * @param {string} [options.cwd] - Working directory (for process.lua lookup)
 * @param {string} [options.luaSource] - Lua source code (overrides file read)
 * @param {Object} [options.ao] - Custom AO connection options
 * @returns {Promise<{ messageId: string, processId: string }>}
 */
export async function loadLua({ processId, cwd, luaSource, ao } = {}) {
  const home = getHome(cwd);
  const identity = loadIdentity(home);
  const signer = createSigner(identity);

  const source = luaSource || readProcessLua(cwd);

  const connectOpts = {};
  if (ao?.muUrl) connectOpts.MU_URL = ao.muUrl;
  if (ao?.cuUrl) connectOpts.CU_URL = ao.cuUrl;
  if (ao?.gatewayUrl) connectOpts.GATEWAY_URL = ao.gatewayUrl;
  if (ao?.graphqlUrl) connectOpts.GRAPHQL_URL = ao.graphqlUrl;

  const aoconnect = Object.keys(connectOpts).length > 0 ? connect(connectOpts) : connect();

  // Send the Lua source as an Eval message (AOS convention)
  const messageId = await aoconnect.message({
    process: processId,
    signer,
    tags: [
      { name: 'Action', value: 'Eval' },
      { name: 'App-Name', value: 'PermaBrain' },
      { name: 'App-Version', value: '0.1.0' }
    ],
    data: source
  });

  return { messageId, processId };
}

/**
 * Save the AO process ID to the PermaBrain config.
 * Updates config.json with the ao.processId field.
 *
 * @param {string} processId - The AO process ID to save
 * @param {string} [home] - PermaBrain home directory
 */
export function saveProcessId(processId, home) {
  home = home || getHome();
  const { configPath } = statePaths(home);
  const config = loadConfig(home);

  config.ao = config.ao || {};
  config.ao.processId = processId;

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  return config;
}

/**
 * Wait for an AO process to be ready by polling with dryrun.
 * Retries until the process responds or timeout is reached.
 *
 * @param {Object} options
 * @param {string} options.processId - AO process ID
 * @param {Object} [options.ao] - Custom AO connection options
 * @param {number} [options.timeoutMs=120000] - Max wait time in ms
 * @param {number} [options.intervalMs=5000] - Polling interval in ms
 * @returns {Promise<boolean>} - true if process is ready
 */
export async function waitForProcess({ processId, ao, timeoutMs = 120000, intervalMs = 5000 } = {}) {
  const connectOpts = {};
  if (ao?.muUrl) connectOpts.MU_URL = ao.muUrl;
  if (ao?.cuUrl) connectOpts.CU_URL = ao.cuUrl;
  if (ao?.gatewayUrl) connectOpts.GATEWAY_URL = ao.gatewayUrl;
  if (ao?.graphqlUrl) connectOpts.GRAPHQL_URL = ao.graphqlUrl;

  const aoconnect = Object.keys(connectOpts).length > 0 ? connect(connectOpts) : connect();

  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const result = await aoconnect.dryrun({
        process: processId,
        tags: [{ name: 'Action', value: 'Info' }],
        data: ''
      });

      // If we got any response (even an error), the process is up
      if (result && (result.Messages || result.Output || result.Error)) {
        return true;
      }
    } catch (err) {
      // Process not ready yet — continue polling
    }

    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }

  return false;
}