/**
 * PermaBrain configuration manager.
 *
 * Provides get/set/validate operations for the PermaBrain JSON config file,
 * plus environment-variable merging. The CLI `config` command and the
 * `api.config()` method are thin wrappers over this module.
 */

import fs from 'node:fs';
import path from 'node:path';
import { getHome, statePaths, loadConfig, defaultConfig, VALID_TRANSPORTS, validateHyperbeamConfig, ensureDir } from './config.mjs';

/** Environment variables that map directly to config keys. */
export const ENV_MAP = {
  PERMABRAIN_HOME: { section: null, key: 'home', type: 'string' },
  PERMABRAIN_TRANSPORT: { section: null, key: 'transport', type: 'enum', values: VALID_TRANSPORTS },
  PERMABRAIN_GRAPHQL_URL: { section: 'gateway', key: 'graphqlUrl', type: 'url' },
  PERMABRAIN_DATA_URL: { section: 'gateway', key: 'dataUrl', type: 'url' },
  PERMABRAIN_UPLOAD_URL: { section: 'bundler', key: 'uploadUrl', type: 'url' },
  PERMABRAIN_HYPERBEAM_URL: { section: 'hyperbeamBase', key: 'baseUrl', type: 'url', synthetic: true },
  PERMABRAIN_HYPERBEAM_REFERENCES: { section: 'hyperbeam', key: 'references', type: 'boolean' },
  PERMABRAIN_FALLBACK_ARWEAVE: { section: 'fallback', key: 'arweave', type: 'boolean' },
  PERMABRAIN_KEY_TYPE: { section: null, key: 'keyType', type: 'enum', values: ['ed25519', 'arweave-rsa4096'] }
};

/**
 * Load effective configuration: disk config merged with recognised env vars.
 * Env vars override disk values.
 *
 * @param {string} [home]
 * @returns {{config: object, sources: object}}
 */
export function loadEffectiveConfig(home = getHome()) {
  let config;
  try {
    config = loadConfig(home);
  } catch {
    config = defaultConfig();
  }

  const sources = {};
  for (const [env, { section, key, type, values }] of Object.entries(ENV_MAP)) {
    const raw = process.env[env];
    if (raw === undefined) continue;
    let value = raw;
    if (type === 'boolean') value = raw === '1' || raw === 'true';
    if (type === 'enum' && !values.includes(value)) continue;
    if (type === 'url') {
      try { new URL(value); } catch { continue; }
    }
    if (section) {
      if (!config[section]) config[section] = {};
      config[section][key] = value;
    } else {
      config[key] = value;
    }
    sources[key] = { from: 'env', env };
  }

  // Synthetic PERMABRAIN_HYPERBEAM_URL overrides gateway/bundler URLs when transport=hyperbeam
  const baseUrl = process.env.PERMABRAIN_HYPERBEAM_URL;
  if (baseUrl && (config.transport === 'hyperbeam' || sources.transport?.from === 'env')) {
    try {
      new URL(baseUrl);
      config.gateway = { ...config.gateway, dataUrl: baseUrl, graphqlUrl: `${baseUrl}/graphql` };
      config.bundler = { ...config.bundler, uploadUrl: `${baseUrl}/~bundler@1.0/tx?codec-device=ans104@1.0` };
      sources.hyperbeamBase = { from: 'env', env: 'PERMABRAIN_HYPERBEAM_URL' };
    } catch {}
  }

  return { config, sources };
}

/**
 * Get a config value by dotted path.
 *
 * @param {object} config
 * @param {string} path
 * @returns {{value: any, exists: boolean}}
 */
export function getConfigValue(config, path) {
  const parts = path.split('.');
  let cur = config;
  for (const part of parts) {
    if (cur === null || cur === undefined || !(part in cur)) return { exists: false };
    cur = cur[part];
  }
  return { value: cur, exists: true };
}

/**
 * Set a config value by dotted path.
 *
 * @param {object} config
 * @param {string} path
 * @param {any} value
 * @returns {object} Mutated config
 */
export function setConfigValue(config, path, value) {
  const parts = path.split('.');
  let cur = config;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!cur[part] || typeof cur[part] !== 'object') cur[part] = {};
    cur = cur[part];
  }
  cur[parts[parts.length - 1]] = value;
  return config;
}

/**
 * Coerce a string value to the target type inferred from an existing value.
 *
 * @param {string} raw
 * @param {any} existing
 * @returns {any}
 */
function coerceValue(raw, existing) {
  if (typeof existing === 'boolean') return raw === 'true' || raw === '1';
  if (typeof existing === 'number') {
    const n = Number(raw);
    if (Number.isNaN(n)) throw new Error(`Cannot coerce "${raw}" to number`);
    return n;
  }
  return raw;
}

/**
 * Validate the current configuration.
 *
 * @param {object} config
 * @returns {{ok: boolean, errors: string[], warnings: string[]}}
 */
export function validateConfig(config) {
  const errors = [];
  const warnings = [];

  if (!config.version) warnings.push('config.version is missing');

  if (!VALID_TRANSPORTS.includes(config.transport)) {
    errors.push(`transport must be one of ${VALID_TRANSPORTS.join(', ')} (got: ${config.transport})`);
  }

  if (config.transport === 'arweave' || config.transport === 'hyperbeam') {
    for (const [label, url] of Object.entries({ graphqlUrl: config.gateway?.graphqlUrl, dataUrl: config.gateway?.dataUrl })) {
      if (!url) errors.push(`gateway.${label} is required`);
      else {
        try { new URL(url); } catch { errors.push(`gateway.${label} is not a valid URL: ${url}`); }
      }
    }
    if (!config.bundler?.uploadUrl) errors.push('bundler.uploadUrl is required');
    else {
      try { new URL(config.bundler.uploadUrl); } catch { errors.push(`bundler.uploadUrl is not a valid URL: ${config.bundler.uploadUrl}`); }
    }
  }

  if (config.transport === 'hyperbeam') {
    try {
      validateHyperbeamConfig(config);
    } catch (err) {
      errors.push(err.message);
    }
  }

  if (config.transport === 'local') {
    if (config.gateway?.type !== 'local') warnings.push('transport is local but gateway.type is not local');
  }

  return { ok: errors.length === 0, errors, warnings };
}

/**
 * Build a flat map of all config values with their source labels.
 *
 * @param {object} config
 * @param {object} [sources={}]
 * @returns {Array<{path: string, value: any, source?: string}>}
 */
export function flattenConfig(config, sources = {}) {
  const out = [];
  function walk(obj, prefix) {
    for (const [k, v] of Object.entries(obj)) {
      const p = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, p);
      else out.push({ path: p, value: v, source: sources[k]?.from || 'config' });
    }
  }
  walk(config, '');
  return out;
}

/**
 * Run a configuration command: get, set, validate, env, or reset.
 *
 * @param {Object} params
 * @param {string} params.action
 * @param {string} [params.path]
 * @param {string} [params.value]
 * @param {string} [params.home]
 * @returns {Object}
 */
export function runConfigCommand({ action, path, value, home = getHome() }) {
  const paths = statePaths(home);
  ensureDir(paths.home);
  ensureDir(paths.cacheDir);

  if (action === 'env') {
    const env = {};
    for (const [name, { section, key, type }] of Object.entries(ENV_MAP)) {
      const raw = process.env[name];
      env[name] = {
        value: raw === undefined ? null : raw,
        mapsTo: section ? `${section}.${key}` : key,
        type,
        active: raw !== undefined
      };
    }
    return { action: 'env', env };
  }

  if (action === 'reset') {
    const fresh = defaultConfig();
    fs.writeFileSync(paths.configPath, JSON.stringify(fresh, null, 2) + '\n');
    return { action: 'reset', config: fresh };
  }

  const { config, sources } = loadEffectiveConfig(home);

  if (action === 'get') {
    if (!path) {
      return { action: 'get', config, sources };
    }
    const { value: v, exists } = getConfigValue(config, path);
    return { action: 'get', path, exists, value: v, source: exists ? (sources[path.split('.').pop()]?.from || 'config') : undefined };
  }

  if (action === 'set') {
    if (!path) throw new Error('set requires a path');
    if (value === undefined) throw new Error('set requires a value');
    const { exists, value: existing } = getConfigValue(config, path);
    const coerced = exists ? coerceValue(String(value), existing) : value;
    setConfigValue(config, path, coerced);
    const validation = validateConfig(config);
    if (!validation.ok && validation.errors.length) {
      throw new Error(`Validation failed after set: ${validation.errors.join('; ')}`);
    }
    fs.writeFileSync(paths.configPath, JSON.stringify(config, null, 2) + '\n');
    return { action: 'set', path, value: coerced, validation };
  }

  if (action === 'validate') {
    const validation = validateConfig(config);
    return { action: 'validate', ok: validation.ok, errors: validation.errors, warnings: validation.warnings, config };
  }

  throw new Error(`Unknown config action: ${action}`);
}

/**
 * Render config as human-readable markdown.
 *
 * @param {object} config
 * @param {object} [sources={}]
 * @returns {string}
 */
export function configToMarkdown(config, sources = {}) {
  const lines = ['# PermaBrain Configuration\n'];
  lines.push(`- transport: ${config.transport || '(unset)'}`);
  lines.push(`- version: ${config.version || '(unset)'}`);
  for (const { path, value, source } of flattenConfig(config, sources)) {
    if (path === 'transport' || path === 'version') continue;
    const display = value === undefined ? '(unset)' : JSON.stringify(value);
    const tag = source === 'env' ? ' [env]' : '';
    lines.push(`- ${path}: ${display}${tag}`);
  }
  return lines.join('\n') + '\n';
}
