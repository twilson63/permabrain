import fs from 'node:fs';
import path from 'node:path';

export const APP_VERSION = '0.1.0';

export function getHome(cwd = process.cwd(), env = process.env) {
  return path.resolve(env.PERMABRAIN_HOME || path.join(cwd, '.permabrain'));
}

export function defaultConfig(env = process.env) {
  const baseUrl = env.PERMABRAIN_HYPERBEAM_URL || 'http://localhost:10000';
  const transport = env.PERMABRAIN_TRANSPORT || 'hyperbeam';
  const config = {
    version: APP_VERSION,
    transport,
    gateway: {
      type: transport,
      graphqlUrl: env.PERMABRAIN_GRAPHQL_URL || `${baseUrl}/graphql`,
      dataUrl: env.PERMABRAIN_DATA_URL || baseUrl
    },
    bundler: {
      type: transport,
      uploadUrl: env.PERMABRAIN_UPLOAD_URL || (transport === 'hyperbeam' ? `${baseUrl}/~bundler@1.0/tx?codec-device=ans104@1.0` : baseUrl)
    }
  };
  // AO transport config (optional — only set when transport is 'ao')
  if (transport === 'ao' || env.PERMABRAIN_AO_PROCESS_ID) {
    config.ao = {
      processId: env.PERMABRAIN_AO_PROCESS_ID || '',
      muUrl: env.PERMABRAIN_AO_MU_URL || undefined,
      cuUrl: env.PERMABRAIN_AO_CU_URL || undefined,
      gatewayUrl: env.PERMABRAIN_AO_GATEWAY_URL || undefined,
      graphqlUrl: env.PERMABRAIN_AO_GRAPHQL_URL || undefined
    };
    // When transport is 'ao', default the Arweave gateway for fallback
    if (!config.gateway.dataUrl || config.gateway.dataUrl === baseUrl) {
      config.gateway.dataUrl = env.PERMABRAIN_DATA_URL || 'https://arweave.net';
      config.gateway.graphqlUrl = env.PERMABRAIN_GRAPHQL_URL || 'https://arweave.net/graphql';
    }
  }
  return config;
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function statePaths(home = getHome()) {
  return {
    home,
    configPath: path.join(home, 'config.json'),
    keysPath: path.join(home, 'keys.json'),
    identityInitPath: path.join(home, 'identity-init.json'),
    cacheDir: path.join(home, 'cache'),
    pagesDir: path.join(home, 'cache', 'pages'),
    objectsDir: path.join(home, 'cache', 'objects'),
    logsDir: path.join(home, 'logs'),
    indexPath: path.join(home, 'cache', 'index.json')
  };
}

export function writeJsonIfMissing(file, value, mode) {
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', mode ? { mode } : undefined);
    return true;
  }
  return false;
}

export function loadJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`Failed to read JSON ${file}: ${err.message}`);
  }
}

export function loadConfig(home = getHome()) {
  const paths = statePaths(home);
  if (!fs.existsSync(paths.configPath)) throw new Error(`PermaBrain is not initialized at ${home}. Run 'permabrain init'.`);
  return loadJson(paths.configPath);
}

export function initState({ cwd = process.cwd(), env = process.env } = {}) {
  const home = getHome(cwd, env);
  const paths = statePaths(home);
  ensureDir(paths.home);
  ensureDir(paths.cacheDir);
  ensureDir(paths.pagesDir);
  ensureDir(paths.objectsDir);
  ensureDir(paths.logsDir);
  const createdConfig = writeJsonIfMissing(paths.configPath, defaultConfig(env));
  writeJsonIfMissing(paths.indexPath, { articles: {}, attestations: {}, updatedAt: null });
  return { home, paths, createdConfig };
}
