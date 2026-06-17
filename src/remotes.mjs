/**
 * PermaBrain Named Remotes
 *
 * Manage named remote endpoints (add, remove, list, default, probe),
 * stored in `remotes.json` under PERMABRAIN_HOME. Allows query/sync
 * operations to target a selected remote by name.
 */

import fs from 'node:fs';
import path from 'node:path';
import { getHome, statePaths, defaultConfig, loadConfig, ensureDir, validateHyperbeamConfig } from './config.mjs';
import { getTransport, probeTransport } from './transport.mjs';
import { loadIndex, writeIndex } from './cache.mjs';

const RESERVED_NAMES = ['local', 'default', 'current'];

function remotesPath(home) {
  return path.join(home, 'remotes.json');
}

function loadRemotes(home) {
  const file = remotesPath(home);
  if (!fs.existsSync(file)) return { defaultRemote: null, remotes: {} };
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`Failed to parse remotes.json: ${err.message}`);
  }
}

function saveRemotes(home, data) {
  const file = remotesPath(home);
  ensureDir(home);
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
  return data;
}

function validateName(name) {
  if (!name) throw new Error('Remote name is required');
  if (RESERVED_NAMES.includes(name)) throw new Error(`Remote name '${name}' is reserved`);
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error('Remote name must be alphanumeric with - or _ only');
}

function normalizeRemote(name, values) {
  const out = { name, createdAt: values.createdAt || new Date().toISOString() };
  const baseUrl = values.url || values.baseUrl;
  if (baseUrl) out.url = baseUrl;
  if (values.transport) out.transport = values.transport;
  if (values.graphqlUrl) out.graphqlUrl = values.graphqlUrl;
  if (values.dataUrl) out.dataUrl = values.dataUrl;
  if (values.uploadUrl) out.uploadUrl = values.uploadUrl;
  if (values.hyperbeamReferences != null) out.hyperbeamReferences = !!values.hyperbeamReferences;
  if (values.description) out.description = values.description;
  if (!out.url && !out.graphqlUrl && !out.dataUrl) {
    throw new Error('Remote requires url, baseUrl, graphqlUrl, or dataUrl');
  }
  return out;
}

function remoteToConfig(remote) {
  const baseUrl = remote.url || remote.dataUrl;
  const transport = remote.transport || (baseUrl.includes('hyperbeam') || baseUrl.includes('localhost') ? 'hyperbeam' : 'arweave');
  const cfg = defaultConfig();
  cfg.transport = transport;
  cfg.gateway.type = transport;
  cfg.gateway.dataUrl = baseUrl;
  cfg.gateway.graphqlUrl = remote.graphqlUrl || `${baseUrl}/graphql`;
  cfg.bundler.type = transport;
  cfg.bundler.uploadUrl = remote.uploadUrl || (transport === 'hyperbeam' ? `${baseUrl}/~bundler@1.0/tx?codec-device=ans104@1.0` : 'https://up.arweave.net/tx');
  cfg.hyperbeam.references = remote.hyperbeamReferences ?? false;
  if (transport === 'hyperbeam') validateHyperbeamConfig(cfg);
  return cfg;
}

export function listRemotes(home = getHome()) {
  return loadRemotes(home);
}

export function addRemote(name, values, home = getHome()) {
  validateName(name);
  const data = loadRemotes(home);
  const normalized = normalizeRemote(name, values);
  normalized.createdAt = data.remotes[name]?.createdAt || new Date().toISOString();
  data.remotes[name] = normalized;
  if (!data.defaultRemote) data.defaultRemote = name;
  saveRemotes(home, data);
  return { added: true, remote: normalized, defaultRemote: data.defaultRemote };
}

export function removeRemote(name, home = getHome()) {
  validateName(name);
  const data = loadRemotes(home);
  if (!data.remotes[name]) throw new Error(`Remote '${name}' not found`);
  const removed = data.remotes[name];
  delete data.remotes[name];
  if (data.defaultRemote === name) {
    const remaining = Object.keys(data.remotes);
    data.defaultRemote = remaining[0] || null;
  }
  saveRemotes(home, data);
  return { removed: true, remote: removed, defaultRemote: data.defaultRemote };
}

export function setDefaultRemote(name, home = getHome()) {
  validateName(name);
  const data = loadRemotes(home);
  if (!data.remotes[name]) throw new Error(`Remote '${name}' not found`);
  data.defaultRemote = name;
  saveRemotes(home, data);
  return { defaultRemote: name };
}

export async function probeRemote(name, home = getHome()) {
  const data = loadRemotes(home);
  const target = name || data.defaultRemote;
  if (!target) throw new Error('No remote name provided and no default remote set');
  const remote = data.remotes[target];
  if (!remote) throw new Error(`Remote '${target}' not found`);
  const config = remoteToConfig(remote);
  const useHyperbeam = config.transport === 'hyperbeam';
  const result = await probeTransport(config, home, { useHyperbeam });
  return { name: target, remote, ...result };
}

export async function queryRemote(name, filters, home = getHome()) {
  const data = loadRemotes(home);
  const target = name || data.defaultRemote;
  if (!target) throw new Error('No remote name provided and no default remote set');
  const remote = data.remotes[target];
  if (!remote) throw new Error(`Remote '${target}' not found`);
  const config = remoteToConfig(remote);
  const useHyperbeam = config.transport === 'hyperbeam';
  const transport = getTransport(config, home, { useHyperbeam });
  return transport.queryByTags(filters);
}

export async function syncRemote(name, opts = {}, home = getHome()) {
  const { syncWithMerge } = await import('./sync.mjs');
  const data = loadRemotes(home);
  const target = name || data.defaultRemote;
  if (!target) throw new Error('No remote name provided and no default remote set');
  const remote = data.remotes[target];
  if (!remote) throw new Error(`Remote '${target}' not found`);
  const config = remoteToConfig(remote);
  const useHyperbeam = config.transport === 'hyperbeam';
  return syncWithMerge({ ...opts, home, config, useHyperbeam });
}

export function remotesToMarkdown(data) {
  const lines = ['# PermaBrain Remotes\n'];
  const names = Object.keys(data.remotes);
  if (!names.length) {
    lines.push('No remotes configured.');
  } else {
    lines.push(`Default: ${data.defaultRemote || '(none)'}\n`);
    for (const name of names) {
      const r = data.remotes[name];
      const def = data.defaultRemote === name ? ' [default]' : '';
      lines.push(`- **${name}**${def}`);
      lines.push(`  - url: ${r.url || r.dataUrl || '(unset)'}`);
      lines.push(`  - transport: ${r.transport || 'auto'}`);
      if (r.description) lines.push(`  - description: ${r.description}`);
      lines.push(`  - added: ${r.createdAt}`);
    }
  }
  return lines.join('\n') + '\n';
}

export function buildRemoteConfig(name, home = getHome()) {
  const data = loadRemotes(home);
  const target = name || data.defaultRemote;
  if (!target) throw new Error('No remote name provided and no default remote set');
  const remote = data.remotes[target];
  if (!remote) throw new Error(`Remote '${target}' not found`);
  return { config: remoteToConfig(remote), remote, name: target };
}
