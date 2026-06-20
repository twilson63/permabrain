/**
 * PermaBrain watch-files — file-system watcher that auto-publishes markdown articles.
 *
 * Watches a directory (recursively by default) for added or changed `.md` files
 * and publishes them via the local transport after a short debounce. Useful for
 * live authoring workflows where saving a file in an editor should immediately
 * publish a new article version.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { publishArticle } from './article.mjs';
import { deriveKeyFromPath, findMarkdownFiles } from './publish-dir.mjs';
import { parseFrontmatter } from './template.mjs';
import { loadConfig, getHome } from './config.mjs';
import { loadIdentity } from './keys.mjs';
import { validateKind } from './tags.mjs';

const DEFAULT_DEBOUNCE_MS = 300;
const DEFAULT_STABLE_MS = 100;

function normalizeDir(dir) {
  if (dir?.startsWith('file://')) return fileURLToPath(dir);
  return path.resolve(dir || process.cwd());
}

function isWithin(base, target) {
  const rel = path.relative(base, target);
  return !rel.startsWith('..') && !path.isAbsolute(rel);
}

function isIgnored(file, patterns) {
  if (!patterns || patterns.length === 0) return false;
  const base = path.basename(file);
  const rel = path.relative(process.cwd(), file);
  for (const p of patterns) {
    if (typeof p === 'string') {
      if (base === p || rel === p || rel.startsWith(p + path.sep)) return true;
      continue;
    }
    if (p instanceof RegExp && p.test(rel)) return true;
  }
  return false;
}

function mergeFrontmatterDefaults(filePath, defaults = {}) {
  let frontmatter = {};
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = parseFrontmatter(raw);
    frontmatter = parsed.frontmatter || {};
  } catch {
    // ignore parse errors; publishArticle will read the file itself
  }
  return {
    topic: frontmatter.topic ?? defaults.topic,
    kind: frontmatter.kind ?? defaults.kind,
    title: frontmatter.title ?? defaults.title,
    sourceUrl: frontmatter.sourceUrl ?? frontmatter.url ?? defaults.sourceUrl,
    sourceName: frontmatter.sourceName ?? defaults.sourceName,
    sourceLicense: frontmatter.sourceLicense ?? defaults.sourceLicense,
    language: frontmatter.language ?? defaults.language,
    visibility: frontmatter.visibility ?? defaults.visibility,
    encryptedFor: frontmatter.encryptedFor ?? defaults.encryptedFor,
  };
}

function resolvePublishOptions(filePath, baseDir, overrides) {
  const meta = deriveKeyFromPath(filePath, baseDir, validateKind(overrides.kind || 'subject'), overrides.topic || 'general');
  const fm = mergeFrontmatterDefaults(filePath, overrides);
  const finalTopic = fm.topic ?? meta.topic ?? 'general';
  const finalKind = validateKind(fm.kind ?? meta.kind ?? 'subject');
  const finalTitle = fm.title ?? meta.title;
  const finalSourceUrl = fm.sourceUrl ?? overrides.sourceUrl ?? `file://${path.resolve(filePath)}`;
  const finalSourceName = fm.sourceName ?? overrides.sourceName ?? 'File Watch';
  const finalSourceLicense = fm.sourceLicense ?? overrides.sourceLicense ?? '';
  const finalLanguage = fm.language ?? overrides.language ?? 'en';
  const isEncrypted = (fm.visibility === 'encrypted' || fm.visibility === 'private' || (fm.encryptedFor?.length > 0) || (overrides.visibility === 'encrypted') || (overrides.visibility === 'private') || (overrides.encryptedFor?.length > 0));
  const encryptedFor = [...new Set([...(fm.encryptedFor || []), ...(overrides.encryptedFor || [])])];
  const visibility = isEncrypted ? 'encrypted' : (overrides.visibility || fm.visibility || 'public');

  return {
    file: filePath,
    key: meta.key,
    kind: finalKind,
    topic: finalTopic,
    title: finalTitle,
    sourceUrl: finalSourceUrl,
    sourceName: finalSourceName,
    sourceLicense: finalSourceLicense,
    language: finalLanguage,
    visibility,
    encryptedFor,
    useHyperbeam: overrides.useHyperbeam ?? false,
    useHyperbeamReference: overrides.useHyperbeamReference ?? false,
  };
}

async function stableFileSize(filePath, stableMs) {
  let last = -1;
  for (let i = 0; i < 20; i++) {
    try {
      const stat = fs.statSync(filePath);
      const size = stat.size;
      const mtime = stat.mtimeMs;
      if (size === last && Date.now() - mtime > stableMs) return true;
      last = size;
    } catch {
      return false;
    }
    await delay(stableMs);
  }
  return true;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Watch a directory and auto-publish markdown files on change.
 *
 * @param {Object} [opts]
 * @param {string} [opts.dir] - Directory to watch (default cwd)
 * @param {boolean} [opts.recursive=true] - Watch subdirectories
 * @param {number} [opts.debounceMs=300] - Debounce window for change events
 * @param {number} [opts.stableMs=100] - Wait until file size is stable
 * @param {boolean} [opts.dryRun=false] - Print what would be published without publishing
 * @param {string} [opts.topic] - Default topic for path-derived metadata
 * @param {string} [opts.kind] - Default kind for path-derived metadata
 * @param {string} [opts.sourceUrl] - Default source URL
 * @param {string} [opts.sourceName] - Default source name
 * @param {string} [opts.sourceLicense] - Default source license
 * @param {string} [opts.language='en'] - Default language
 * @param {string} [opts.visibility='public'] - public|encrypted|private
 * @param {string[]} [opts.encryptedFor] - Recipient public keys for encrypted publishes
 * @param {boolean} [opts.useHyperbeam=false] - Publish via HyperBEAM
 * @param {boolean} [opts.useHyperbeamReference=false] - Maintain HB references
 * @param {Array<string|RegExp>} [opts.ignore] - Ignore patterns
 * @param {Function} [opts.onEvent] - Called with each event object
 * @param {boolean} [opts.json=false] - Emit JSON events to console when no onEvent
 * @returns {Promise<{cancel: Function, watched: string[]}>}
 */
export async function watchFiles(opts = {}) {
  const dir = normalizeDir(opts.dir);
  const recursive = opts.recursive !== false;
  const debounceMs = Number(opts.debounceMs ?? DEFAULT_DEBOUNCE_MS);
  const stableMs = Number(opts.stableMs ?? DEFAULT_STABLE_MS);
  const dryRun = opts.dryRun === true || opts.dryRun === 'true';
  const ignore = opts.ignore || ['node_modules', '.git', 'dist', 'cache', 'logs'];
  const home = opts.home || getHome();
  const config = opts.config || loadConfig(home);
  const identity = opts.identity || loadIdentity(home);

  const defaults = {
    topic: opts.topic,
    kind: validateKind(opts.kind || 'subject'),
    sourceUrl: opts.sourceUrl,
    sourceName: opts.sourceName || 'File Watch',
    sourceLicense: opts.sourceLicense || '',
    language: opts.language || 'en',
    visibility: opts.visibility || 'public',
    encryptedFor: opts.encryptedFor || [],
    useHyperbeam: opts.useHyperbeam ?? false,
    useHyperbeamReference: opts.useHyperbeamReference ?? false,
  };

  if (!fs.existsSync(dir)) {
    throw new Error(`Watch directory does not exist: ${dir}`);
  }

  const pending = new Map();
  const watchers = new Map();
  let running = true;

  function emit(event) {
    if (opts.onEvent) {
      opts.onEvent(event);
      return;
    }
    if (opts.json) {
      console.log(JSON.stringify(event));
    } else {
      if (event.type === 'publish') {
        console.log(`[publish] ${event.key}${event.dryRun ? ' (dry-run)' : ''} — ${event.file}`);
      } else if (event.type === 'error') {
        console.log(`[error] ${event.file}: ${event.message}`);
      } else if (event.type === 'ready') {
        console.log(`[watch-files] ready — watching ${event.watched} path(s) in ${event.dir}`);
      } else if (event.type === 'ignore') {
        console.log(`[ignore] ${event.file}`);
      }
    }
  }

  async function publishFile(filePath) {
    if (!filePath.endsWith('.md')) return;
    if (isIgnored(filePath, ignore)) {
      emit({ type: 'ignore', file: filePath });
      return;
    }
    const options = resolvePublishOptions(filePath, dir, defaults);
    if (dryRun) {
      emit({ type: 'publish', file: filePath, key: options.key, dryRun: true, options });
      return;
    }
    try {
      await stableFileSize(filePath, stableMs);
      const result = await publishArticle({ ...options, home });
      emit({ type: 'publish', file: filePath, key: result.summary.key, id: result.summary.id, version: result.summary.version, encrypted: result.encrypted });
    } catch (err) {
      emit({ type: 'error', file: filePath, message: err.message });
    }
  }

  function schedule(filePath) {
    if (!filePath.endsWith('.md')) return;
    const existing = pending.get(filePath);
    if (existing) clearTimeout(existing);
    pending.set(filePath, setTimeout(() => {
      pending.delete(filePath);
      if (!running) return;
      publishFile(filePath).catch(() => {});
    }, debounceMs));
  }

  function handleEvent(eventType, fileNameOrPath) {
    if (!running) return;
    let filePath;
    if (path.isAbsolute(fileNameOrPath)) {
      filePath = fileNameOrPath;
    } else {
      filePath = path.join(this.base, fileNameOrPath);
    }
    if (!isWithin(dir, filePath)) return;
    if (eventType === 'rename') {
      // New files often surface as rename events.
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        schedule(filePath);
      }
    } else if (eventType === 'change') {
      schedule(filePath);
    }
  }

  async function addWatcher(target) {
    if (isIgnored(target, ignore)) return;
    if (watchers.has(target)) return;
    try {
      const watcher = fs.watch(target, { persistent: true, recursive: false }, handleEvent.bind({ base: target }));
      watchers.set(target, watcher);
    } catch {
      // ignore directories we cannot watch
    }
  }

  async function scanAndWatch() {
    if (recursive) {
      for (const file of findMarkdownFiles(dir, true)) {
        const parent = path.dirname(file);
        await addWatcher(parent);
      }
      // Also watch empty intermediate directories by walking the tree.
      await watchDirectories(dir);
    }
    await addWatcher(dir);
  }

  async function watchDirectories(current) {
    if (!fs.existsSync(current)) return;
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const full = path.join(current, entry.name);
      if (isIgnored(full, ignore)) continue;
      await addWatcher(full);
      await watchDirectories(full);
    }
  }

  // On platforms that support recursive fs.watch (Linux does), a single watcher covers everything.
  let rootWatcher = null;
  try {
    rootWatcher = fs.watch(dir, { persistent: true, recursive: true }, (eventType, fileName) => {
      if (!running || !fileName) return;
      const filePath = path.join(dir, fileName);
      handleEvent.call({ base: dir }, eventType, filePath);
      // If a new directory is created, ensure it is watched in non-recursive fallback mode.
      if (recursive && eventType === 'rename' && fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
        addWatcher(filePath);
      }
    });
    watchers.set(dir, rootWatcher);
  } catch {
    // Fallback to per-directory watchers.
    await scanAndWatch();
  }

  // Seed initial publishes for existing files if requested.
  if (opts.initialPublish) {
    for (const file of findMarkdownFiles(dir, recursive)) {
      schedule(file);
    }
  }

  const watched = [...watchers.keys()];
  emit({ type: 'ready', dir, watched: watched.length });

  return {
    watched,
    cancel: () => {
      running = false;
      for (const [key, timeoutId] of pending) {
        clearTimeout(timeoutId);
        pending.delete(key);
      }
      for (const watcher of watchers.values()) {
        try { watcher.close(); } catch {}
      }
      watchers.clear();
    }
  };
}

/**
 * Run a one-shot scan and publish of markdown files in a directory.
 */
export async function publishFilesOnce(opts = {}) {
  const dir = normalizeDir(opts.dir);
  const recursive = opts.recursive !== false;
  const dryRun = opts.dryRun === true || opts.dryRun === 'true';
  const home = opts.home || getHome();
  const defaults = {
    topic: opts.topic,
    kind: validateKind(opts.kind || 'subject'),
    sourceUrl: opts.sourceUrl,
    sourceName: opts.sourceName || 'File Watch',
    sourceLicense: opts.sourceLicense || '',
    language: opts.language || 'en',
    visibility: opts.visibility || 'public',
    encryptedFor: opts.encryptedFor || [],
    useHyperbeam: opts.useHyperbeam ?? false,
    useHyperbeamReference: opts.useHyperbeamReference ?? false,
  };

  const results = [];
  for (const file of findMarkdownFiles(dir, recursive)) {
    const options = resolvePublishOptions(file, dir, defaults);
    if (dryRun) {
      results.push({ file, key: options.key, status: 'dry-run' });
      continue;
    }
    try {
      const result = await publishArticle({ ...options, home });
      results.push({ file, key: result.summary.key, id: result.summary.id, status: 'published', version: result.summary.version });
    } catch (err) {
      results.push({ file, key: options.key, status: 'error', error: err.message });
    }
  }
  return results;
}

/**
 * Format a watch-files event or result list as markdown.
 */
export function watchFilesToMarkdown(result) {
  if (!result || !Array.isArray(result)) {
    return '# Watch-files result\n\nNo results.';
  }
  const lines = ['# Auto-published files\n'];
  for (const r of result) {
    const status = r.status === 'published' ? '✓' : r.status === 'dry-run' ? '⊘' : '✗';
    lines.push(`- ${status} \`${r.file}\` → ${r.key}${r.id ? ` (${r.id})` : ''}${r.error ? `: ${r.error}` : ''}`);
  }
  return lines.join('\n') + '\n';
}
