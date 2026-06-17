/**
 * PermaBrain Backup Manager
 *
 * Manages multiple timestamped full-home archive snapshots in a dedicated
 * backups directory. Each backup is an encrypted archive object (the same
 * format produced by archive.mjs) stored as a JSON file.
 *
 * Provides:
 *   - createBackup(home, opts)  -> create and store a new backup
 *   - listBackups(home)         -> list stored backups with metadata
 *   - restoreBackup(home, opts) -> restore from a stored backup by name/index
 *   - pruneBackups(home, opts)  -> delete old backups by keep-count or max-age
 *
 * Default backup directory: PERMABRAIN_HOME/backups
 */

import fs from 'node:fs';
import path from 'node:path';
import { archive, restore } from './archive.mjs';
import { getHome } from './config.mjs';

const BACKUP_DIR_NAME = 'backups';

function backupDir(home) {
  return path.join(home, BACKUP_DIR_NAME);
}

function ensureBackupDir(home) {
  const dir = backupDir(home);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function timestampName() {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  const hh = String(now.getUTCHours()).padStart(2, '0');
  const mi = String(now.getUTCMinutes()).padStart(2, '0');
  const ss = String(now.getUTCSeconds()).padStart(2, '0');
  return `backup-${yyyy}${mm}${dd}-${hh}${mi}${ss}.json`;
}

function readBackupMeta(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const obj = JSON.parse(raw);
  return {
    name: path.basename(filePath),
    path: filePath,
    createdAt: obj.createdAt || new Date(fs.statSync(filePath).mtime).toISOString(),
    agentId: obj.agentId || null,
    version: obj.version || null,
    entries: Array.isArray(obj.entries) ? obj.entries.length : 0,
    hasPassphrase: obj.encryption?.hasPassphrase || false,
    recipientCount: obj.encryption?.recipientCount || 0,
    size: raw.length
  };
}

/**
 * Create a new timestamped backup of a PermaBrain home and store it.
 *
 * @param {string} [home] - PermaBrain home directory (default PERMABRAIN_HOME)
 * @param {Object} [opts]
 * @param {string} [opts.passphrase] - Passphrase for self-contained restore
 * @param {string[]} [opts.recipients] - Extra X25519 public keys to encrypt for
 * @param {string} [opts.name] - Override backup filename (must end in .json)
 * @param {string} [opts.dir] - Override backup directory
 * @returns {Promise<Object>} Backup report with name, path, archive, meta
 */
export async function createBackup(home, opts = {}) {
  const targetHome = home || getHome();
  const dir = opts.dir || ensureBackupDir(targetHome);
  fs.mkdirSync(dir, { recursive: true });
  const name = opts.name || timestampName();
  if (!name.endsWith('.json')) throw new Error('Backup name must end in .json');

  const ar = await archive({ home: targetHome, passphrase: opts.passphrase, recipients: opts.recipients });
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, JSON.stringify(ar, null, 2) + '\n');

  return {
    name,
    path: filePath,
    home: targetHome,
    archive: ar,
    meta: {
      createdAt: ar.createdAt,
      agentId: ar.agentId,
      version: ar.version,
      entries: ar.entries.length,
      hasPassphrase: ar.encryption.hasPassphrase,
      recipientCount: ar.encryption.recipientCount,
      size: fs.statSync(filePath).size
    }
  };
}

/**
 * List stored backups for a PermaBrain home, newest first.
 *
 * @param {string} [home]
 * @returns {Array<Object>} Backup metadata
 */
export function listBackups(home) {
  const targetHome = home || getHome();
  const dir = backupDir(targetHome);
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir)
    .filter((n) => n.endsWith('.json'))
    .map((n) => readBackupMeta(path.join(dir, n)));
  entries.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return entries;
}

function resolveBackupFile(home, selector) {
  const dir = backupDir(home);
  if (!fs.existsSync(dir)) throw new Error(`No backups directory at ${dir}`);

  // Selector is a full filename
  const directPath = path.join(dir, selector);
  if (fs.existsSync(directPath)) return directPath;

  // Selector is a 1-based index in newest-first order
  const idx = Number(selector);
  if (!Number.isNaN(idx) && idx > 0) {
    const backups = listBackups(home);
    const selected = backups[idx - 1];
    if (!selected) throw new Error(`Backup index ${idx} not found (only ${backups.length} backup(s))`);
    return selected.path;
  }

  // Selector without .json suffix
  const withSuffix = path.join(dir, `${selector}.json`);
  if (fs.existsSync(withSuffix)) return withSuffix;

  throw new Error(`Backup not found: ${selector}`);
}

/**
 * Restore a PermaBrain home from a stored backup.
 *
 * @param {string} home - PermaBrain home directory
 * @param {Object} opts
 * @param {string} opts.backup - Backup filename or 1-based index
 * @param {string} [opts.passphrase]
 * @param {string|Buffer} [opts.seed]
 * @param {boolean} [opts.dryRun=false]
 * @returns {Promise<Object>} Restore report
 */
export async function restoreBackup(home, opts = {}) {
  const targetHome = home || getHome();
  if (!opts.backup) throw new Error('restoreBackup requires opts.backup (filename or index)');
  const filePath = resolveBackupFile(targetHome, opts.backup);
  const raw = fs.readFileSync(filePath, 'utf8');
  const ar = JSON.parse(raw);
  const result = await restore(ar, {
    home: targetHome,
    passphrase: opts.passphrase,
    seed: opts.seed,
    dryRun: opts.dryRun === true || opts.dryRun === 'true'
  });
  return { ...result, backup: path.basename(filePath), backupPath: filePath };
}

/**
 * Delete old backups, keeping the newest N or deleting older than a max age.
 *
 * @param {string} [home]
 * @param {Object} [opts]
 * @param {number} [opts.keep=10] - Keep the newest N backups
 * @param {number} [opts.maxAgeDays] - Also delete backups older than this many days
 * @param {boolean} [opts.dryRun=false]
 * @returns {{kept: Array<Object>, removed: Array<Object>}}
 */
export function pruneBackups(home, opts = {}) {
  const targetHome = home || getHome();
  const backups = listBackups(targetHome);
  if (backups.length === 0) return { kept: [], removed: [] };

  const keep = opts.keep ?? 10;
  const maxAgeMs = opts.maxAgeDays ? opts.maxAgeDays * 24 * 60 * 60 * 1000 : null;
  const now = Date.now();

  const kept = [];
  const removed = [];
  for (let i = 0; i < backups.length; i++) {
    const b = backups[i];
    const age = now - new Date(b.createdAt).getTime();
    const tooOld = maxAgeMs ? age > maxAgeMs : false;
    const beyondKeep = i >= keep;
    if (tooOld || beyondKeep) {
      removed.push(b);
    } else {
      kept.push(b);
    }
  }

  if (!opts.dryRun) {
    for (const b of removed) {
      try { fs.rmSync(b.path, { force: true }); } catch { /* ignore */ }
    }
  }

  return { kept, removed };
}

/**
 * Render a markdown summary of stored backups.
 */
export function backupsToMarkdown(backups, opts = {}) {
  const lines = ['# PermaBrain Backups'];
  lines.push('');
  if (backups.length === 0) {
    lines.push('No backups found.');
    return lines.join('\n');
  }
  lines.push(`| # | Name | Created | Agent | Files | Passphrase | Recipients | Size |`);
  lines.push(`|---|------|---------|-------|-------|------------|------------|------|`);
  for (let i = 0; i < backups.length; i++) {
    const b = backups[i];
    const sizeKb = (b.size / 1024).toFixed(1);
    lines.push(`| ${i + 1} | ${b.name} | ${b.createdAt} | ${b.agentId || '-'} | ${b.entries} | ${b.hasPassphrase ? 'yes' : 'no'} | ${b.recipientCount} | ${sizeKb} KB |`);
  }
  if (opts.home) lines.push('', `Home: ${opts.home}/backups`);
  return lines.join('\n');
}
