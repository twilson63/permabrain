import fs from 'node:fs';
import path from 'node:path';
import { getHome, statePaths, defaultConfig, loadConfig, VALID_TRANSPORTS, validateHyperbeamConfig } from './config.mjs';
import { loadIdentity, publicIdentity, identityInitEvent } from './keys.mjs';
import { loadIndex, writeIndex, latestByArticleKey, summarizeArticle, summarizeAttestation } from './cache.mjs';
import { tagsToObject } from './tags.mjs';
import { checkDev } from './deploy-dev.mjs';

export function doctorReportToMarkdown(report) {
  const lines = [
    `# PermaBrain Doctor Report`,
    '',
    `- Home: ${report.home}`,
    `- Overall: ${report.ok ? 'healthy' : 'issues detected'}`,
    `- Issues: ${report.issues}`,
    report.fixed > 0 ? `- Fixed: ${report.fixed}` : null,
    ''
  ].filter(Boolean);

  for (const check of report.checks) {
    const icon = check.ok ? '✅' : '❌';
    lines.push(`## ${icon} ${check.name}`);
    if (check.message) lines.push(check.message);
    if (check.fixes && check.fixes.length) {
      lines.push('');
      lines.push('Fixes applied:');
      for (const fix of check.fixes) lines.push(`- ${fix}`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push(`Run with --fix to repair auto-fixable issues.`);
  return lines.join('\n').trim() + '\n';
}

function safeReadJson(file) {
  try {
    return { ok: true, data: JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function listObjectItems(home) {
  const { objectsDir } = statePaths(home);
  if (!fs.existsSync(objectsDir)) return [];
  const files = fs.readdirSync(objectsDir).filter((name) => name.endsWith('.json') && !name.startsWith('.'));
  const items = [];
  for (const file of files) {
    const res = safeReadJson(path.join(objectsDir, file));
    if (res.ok) items.push(res.data);
  }
  return items;
}

export function rebuildIndexFromObjects(home) {
  const items = listObjectItems(home);
  const articles = items.filter((item) => tagsToObject(item.tags || [])['PermaBrain-Type'] === 'article');
  const attestations = items.filter((item) => tagsToObject(item.tags || [])['PermaBrain-Type'] === 'attestation');

  const latest = latestByArticleKey(articles);
  const newIndex = { articles: {}, attestations: {}, updatedAt: new Date().toISOString() };
  for (const [, item] of latest) {
    const summary = summarizeArticle(item);
    newIndex.articles[summary.key] = summary;
  }
  for (const item of attestations) {
    const summary = summarizeAttestation(item);
    if (!newIndex.attestations[summary.targetKey]) newIndex.attestations[summary.targetKey] = [];
    if (!newIndex.attestations[summary.targetKey].some((a) => a.id === summary.id)) {
      newIndex.attestations[summary.targetKey].push(summary);
    }
  }
  return writeIndex(home, newIndex);
}

function computeCacheDetails(home, index) {
  const { objectsDir } = statePaths(home);
  const result = {
    articlesCount: 0,
    attestationsCount: 0,
    missingObjects: [],
    duplicateKeys: [],
    orphanAttestations: [],
    brokenChains: [],
    staleIndexKeys: [],
    missingKeys: []
  };
  if (!index || typeof index.articles !== 'object' || index.articles === null) return result;

  const articles = Object.values(index.articles);
  const attestations = Object.values(index.attestations || {}).flat();
  result.articlesCount = articles.length;
  result.attestationsCount = attestations.length;

  for (const summary of articles) {
    if (!fs.existsSync(path.join(objectsDir, encodeURIComponent(summary.id) + '.json'))) {
      result.missingObjects.push({ type: 'article', key: summary.key, id: summary.id, note: 'object missing from local store' });
    }
    if (summary.previousId && !fs.existsSync(path.join(objectsDir, encodeURIComponent(summary.previousId) + '.json'))) {
      result.brokenChains.push({ key: summary.key, previousId: summary.previousId });
    }
  }
  for (const summary of attestations) {
    if (!fs.existsSync(path.join(objectsDir, encodeURIComponent(summary.id) + '.json'))) {
      result.missingObjects.push({ type: 'attestation', targetKey: summary.targetKey, id: summary.id, note: 'object missing from local store' });
    }
    if (!index.articles[summary.targetKey]) {
      result.orphanAttestations.push(summary);
    }
  }

  const objectItems = listObjectItems(home);
  const articleItems = objectItems.filter((item) => tagsToObject(item.tags || [])['PermaBrain-Type'] === 'article');
  const latest = latestByArticleKey(articleItems);
  for (const [key, item] of latest) {
    const summary = summarizeArticle(item);
    const indexed = index.articles[key];
    if (!indexed) {
      result.missingKeys.push(key);
    } else if (indexed.id !== summary.id) {
      const indexedVersion = Number(indexed.version || 0);
      const objectVersion = Number(summary.version || 0);
      if (objectVersion > indexedVersion) {
        result.staleIndexKeys.push({ key, indexedId: indexed.id, latestId: summary.id, indexedVersion, latestVersion: objectVersion });
      }
    }
  }
  for (const key of Object.keys(index.articles)) {
    if (!latest.has(key)) {
      result.missingObjects.push({ type: 'article', key, id: index.articles[key].id, note: 'object missing from local store' });
    }
  }
  return result;
}

export async function runDoctor(homeOrOpts, opts = {}) {
  const home = typeof homeOrOpts === 'string' ? homeOrOpts : (homeOrOpts?.home || getHome());
  const fix = opts.fix === true;
  const report = { ok: true, home, checks: [], issues: 0, fixed: 0, details: {} };
  // Support passing options as the first argument for tests/mocks.
  const firstArgIsOpts = typeof homeOrOpts === 'object' && homeOrOpts !== null;
  const dev = firstArgIsOpts ? homeOrOpts.dev === true : opts.dev === true;
  const devProjectDir = firstArgIsOpts ? homeOrOpts.devProjectDir : opts.devProjectDir;
  const spawnFn = firstArgIsOpts ? homeOrOpts.spawnFn : opts.spawnFn;
  const fetchFn = firstArgIsOpts ? homeOrOpts.fetchFn : opts.fetchFn;

  function addCheck(name, ok, message, fixes = []) {
    const check = { name, ok, message, fixes };
    report.checks.push(check);
    if (!ok) {
      report.issues++;
      report.ok = false;
    }
    if (fixes.length) report.fixed += fixes.length;
    return check;
  }

  const paths = statePaths(home);

  // Home directory
  {
    const exists = fs.existsSync(home);
    const readable = exists ? (() => { try { fs.accessSync(home, fs.constants.R_OK | fs.constants.W_OK); return true; } catch { return false; } })() : false;
    if (fix && !exists) {
      fs.mkdirSync(home, { recursive: true });
      fs.mkdirSync(paths.cacheDir, { recursive: true });
      fs.mkdirSync(paths.pagesDir, { recursive: true });
      fs.mkdirSync(paths.objectsDir, { recursive: true });
      fs.mkdirSync(paths.logsDir, { recursive: true });
    }
    addCheck('home-directory', exists && readable, exists ? (readable ? `Home is readable and writable: ${home}` : `Home exists but is not accessible: ${home}`) : `Home directory does not exist: ${home}`,
      fix && !exists ? ['Created home directory structure'] : []);
  }

  // Config
  {
    const result = { exists: false, readable: false, valid: false, transport: null, errors: [] };
    if (fs.existsSync(paths.configPath)) {
      result.exists = true;
      const read = safeReadJson(paths.configPath);
      if (read.ok) {
        result.readable = true;
        const cfg = read.data;
        if (!cfg.version) result.errors.push('missing version');
        if (!cfg.transport) result.errors.push('missing transport');
        else if (!VALID_TRANSPORTS.includes(cfg.transport)) result.errors.push(`invalid transport '${cfg.transport}'`);
        else result.transport = cfg.transport;
        if (cfg.transport === 'hyperbeam') {
          try { validateHyperbeamConfig(cfg); } catch (err) { result.errors.push(`hyperbeam config invalid: ${err.message}`); }
        }
        if (cfg.gateway && cfg.bundler && cfg.gateway.type !== cfg.transport) result.errors.push(`gateway type '${cfg.gateway.type}' does not match transport '${cfg.transport}'`);
        result.valid = result.errors.length === 0;
      } else {
        result.errors.push(`not valid JSON: ${read.error}`);
      }
    } else {
      result.errors.push('config.json missing');
    }
    report.details.config = result;

    const fixes = [];
    if (fix && (!result.exists || !result.readable || !result.valid)) {
      const newConfig = defaultConfig();
      fs.writeFileSync(paths.configPath, JSON.stringify(newConfig, null, 2) + '\n');
      result.exists = true;
      result.readable = true;
      result.valid = true;
      result.transport = newConfig.transport;
      result.errors = [];
      fixes.push('Wrote default config.json');
    }
    addCheck('config', result.exists && result.readable && result.valid,
      result.exists && result.readable ? `config.json ${result.valid ? 'valid' : 'invalid'}${result.errors.length ? ': ' + result.errors.join('; ') : ''} (transport=${result.transport || 'unknown'})` : result.errors.join('; '),
      fixes);
  }

  // Identity
  {
    const result = { keysExists: false, keysReadable: false, keysValid: false, identityInitExists: false, identityInitReadable: false, identityInitValid: false, keyType: null, agentId: null, errors: [] };
    let identity = null;
    if (fs.existsSync(paths.keysPath)) {
      result.keysExists = true;
      const read = safeReadJson(paths.keysPath);
      if (read.ok) {
        result.keysReadable = true;
        identity = read.data;
        if (!identity.type) result.errors.push('keys.json missing type');
        else if (!['arweave-rsa4096', 'ed25519'].includes(identity.type)) result.errors.push(`unsupported key type '${identity.type}'`);
        else result.keyType = identity.type;
        if (identity.type === 'arweave-rsa4096') {
          if (!identity.jwk) result.errors.push('arweave keys missing jwk');
          else if (!identity.agentId) result.errors.push('arweave keys missing agentId');
        } else if (identity.type === 'ed25519') {
          if (!identity.publicKey) result.errors.push('ed25519 keys missing publicKey');
          if (!identity.secretKey) result.errors.push('ed25519 keys missing secretKey');
        }
        if (identity.agentId) result.agentId = identity.agentId;
        result.keysValid = result.errors.length === 0;
      } else {
        result.errors.push(`keys.json not valid JSON: ${read.error}`);
      }
    } else {
      result.errors.push('keys.json missing');
    }

    if (fs.existsSync(paths.identityInitPath)) {
      result.identityInitExists = true;
      const read = safeReadJson(paths.identityInitPath);
      if (read.ok) {
        result.identityInitReadable = true;
        const init = read.data;
        if (init.type !== 'identity-init') result.errors.push('identity-init.json wrong type');
        if (identity && init.agentId && init.agentId !== identity.agentId) result.errors.push('identity-init agentId does not match keys.json');
        result.identityInitValid = result.errors.filter((e) => e.includes('identity-init')).length === 0;
      } else {
        result.errors.push(`identity-init.json not valid JSON: ${read.error}`);
      }
    } else {
      result.errors.push('identity-init.json missing');
    }
    report.details.identity = result;

    const fixes = [];
    if (fix && result.keysValid && !result.identityInitExists) {
      fs.writeFileSync(paths.identityInitPath, JSON.stringify(identityInitEvent(identity), null, 2) + '\n');
      result.identityInitExists = true;
      result.identityInitReadable = true;
      result.identityInitValid = true;
      fixes.push('Recreated identity-init.json from keys.json');
    }
    addCheck('identity', result.keysExists && result.keysReadable && result.keysValid && result.identityInitExists && result.identityInitReadable && result.identityInitValid,
      result.errors.length ? result.errors.join('; ') : `Identity OK (${result.keyType}, ${result.agentId || 'unknown'})`,
      fixes);
  }

  // Cache index
  {
    const result = { indexExists: false, indexReadable: false, indexValid: false, errors: [] };
    let index = null;
    if (fs.existsSync(paths.indexPath)) {
      result.indexExists = true;
      const read = safeReadJson(paths.indexPath);
      if (read.ok) {
        result.indexReadable = true;
        index = read.data;
        if (typeof index.articles !== 'object' || index.articles === null) result.errors.push('index.articles is not an object');
        if (typeof index.attestations !== 'object' || index.attestations === null) result.errors.push('index.attestations is not an object');
        result.indexValid = result.errors.length === 0;
      } else {
        result.errors.push(`index.json not valid JSON: ${read.error}`);
      }
    } else {
      result.errors.push('index.json missing');
    }

    let cacheDetails = index && result.indexValid ? computeCacheDetails(home, index) : { articlesCount: 0, attestationsCount: 0, missingObjects: [], duplicateKeys: [], orphanAttestations: [], brokenChains: [], staleIndexKeys: [], missingKeys: [] };
    Object.assign(result, cacheDetails);

    const needsRebuild = result.missingKeys.length || result.staleIndexKeys.length || result.missingObjects.some((m) => m.type === 'article' && m.note?.includes('object missing'));
    const fixes = [];
    let indexRecreated = false;
    if (fix) {
      if (!result.indexExists || !result.indexReadable || !result.indexValid) {
        index = { articles: {}, attestations: {}, updatedAt: new Date().toISOString() };
        fs.writeFileSync(paths.indexPath, JSON.stringify(index, null, 2) + '\n');
        result.indexExists = true;
        result.indexReadable = true;
        result.indexValid = true;
        result.errors = [];
        indexRecreated = true;
      }
      if (needsRebuild || indexRecreated) {
        rebuildIndexFromObjects(home);
        index = loadIndex(home);
        cacheDetails = computeCacheDetails(home, index);
        Object.assign(result, cacheDetails);
        fixes.push('Rebuilt index.json from cache/objects');
      }
    }
    report.details.cache = result;

    const cacheOk = result.indexExists && result.indexReadable && result.indexValid && !result.missingObjects.length && !result.missingKeys.length && !result.staleIndexKeys.length;
    addCheck('cache-index', cacheOk,
      result.indexExists && result.indexReadable ? `index.json ${result.indexValid ? 'valid' : 'invalid'}: ${result.articlesCount} articles, ${result.attestationsCount} attestations${result.errors.length ? '; ' + result.errors.join('; ') : ''}${result.missingObjects.length ? '; ' + result.missingObjects.length + ' missing object(s)' : ''}${result.missingKeys.length ? '; ' + result.missingKeys.length + ' key(s) missing from index' : ''}${result.staleIndexKeys.length ? '; ' + result.staleIndexKeys.length + ' stale key(s)' : ''}${result.orphanAttestations.length ? '; ' + result.orphanAttestations.length + ' orphan attestation(s)' : ''}${result.brokenChains.length ? '; ' + result.brokenChains.length + ' broken chain link(s)' : ''}` : result.errors.join('; '),
      fixes);
  }

  // Dev-container readiness (optional; requested with --dev)
  if (dev) {
    let devResult;
    try {
      devResult = await checkDev(
        { 'project-dir': devProjectDir, 'exit-code': true },
        { spawnFn, fetchFn, log: { log: () => {}, error: () => {} } }
      );
    } catch (err) {
      devResult = { ok: false, ready: false, summary: err.message, checks: [], warnings: [] };
    }
    const devOk = devResult.ok === true;
    const failedRequired = devResult.checks?.filter((c) => c.required && !c.ok).map((c) => c.name).join(', ');
    const failedOptional = devResult.warnings?.map((w) => w.name).join(', ');
    const message = devOk
      ? 'Dev-container environment is ready.'
      : [
          devResult.summary || 'Dev-container environment is not ready.',
          failedRequired && `Missing required: ${failedRequired}`,
          failedOptional && `Missing optional: ${failedOptional}`,
        ].filter(Boolean).join(' ');
    report.details.devContainer = devResult;
    addCheck('dev-container', devOk, message, []);
  }

  return report;
}
