import fs from 'node:fs';
import path from 'node:path';
import { publishArticle } from './article.mjs';
import { deriveKey, deriveTitleFromFile, slugify, validateKind } from './tags.mjs';
import { logAction } from './log.mjs';
import { parseFrontmatter } from './template.mjs';

export function deriveKeyFromPath(filePath, baseDir, fallbackKind, fallbackTopic, relativeOverride) {
  const rel = relativeOverride ?? path.relative(baseDir, filePath);
  const ext = path.extname(rel);
  const base = ext ? rel.slice(0, -ext.length) : rel;
  // Parse frontmatter if present to honor explicit metadata.
  let frontmatter = {};
  if (fs.existsSync(filePath)) {
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = parseFrontmatter(raw);
      frontmatter = parsed.frontmatter || {};
    } catch {
      // ignore
    }
  }

  if (frontmatter.key) return { key: frontmatter.key, kind: validateKind(frontmatter.kind || fallbackKind), topic: frontmatter.topic || fallbackTopic, title: frontmatter.title };

  const segments = base.split(path.sep).filter(Boolean);
  const fileName = segments.pop() || 'article';

  // If the relative path includes subdirectories, treat the first segment as topic
  // and the rest as kind/title, unless overridden by options.
  const topic = frontmatter.topic || fallbackTopic || (segments[0] || 'general');
  const kind = validateKind(frontmatter.kind || fallbackKind);

  // Derive a clean slug from the remaining path or the file name.
  const slugParts = segments.length >= 1 ? segments.slice(1).concat(fileName) : [fileName];
  const slug = slugify(slugParts.join('-'));
  const title = frontmatter.title || deriveTitleFromFile(fileName);
  const key = `${kind}/${slug}`;
  return { key, kind, topic, title };
}

export function findMarkdownFiles(dir, recursive = false) {
  const files = [];
  if (!fs.existsSync(dir)) return files;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && recursive) {
      files.push(...findMarkdownFiles(full, recursive));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(full);
    }
  }
  return files;
}

export async function publishDirectory(dir, options = {}) {
  const home = options.home;
  const recursive = options.recursive ?? false;
  const dryRun = options.dryRun ?? false;
  const topic = options.topic;
  const kind = options.kind;
  const title = options.title;
  const sourceUrl = options.sourceUrl;
  const sourceName = options.sourceName;
  const sourceLicense = options.sourceLicense || '';
  const language = options.language || 'en';
  const useHyperbeam = options.useHyperbeam ?? false;
  const useHyperbeamReference = options.useHyperbeamReference ?? false;
  const encryptedFor = options.encryptedFor ?? [];
  const visibility = options.visibility || (encryptedFor.length ? 'encrypted' : 'public');

  const files = findMarkdownFiles(dir, recursive);
  const results = [];
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;

  for (const file of files) {
    const meta = deriveKeyFromPath(file, dir, kind || 'subject', topic || 'general');
    const finalTopic = topic || meta.topic;
    const finalKind = kind || meta.kind;
    const finalTitle = title || meta.title;
    const finalKey = options.key ? options.key(file, meta) : meta.key;
    const finalSourceUrl = sourceUrl || `file://${path.resolve(file)}`;
    const finalSourceName = sourceName || 'Directory Publish';

    if (dryRun) {
      results.push({
        file,
        key: finalKey,
        kind: finalKind,
        topic: finalTopic,
        title: finalTitle,
        status: 'dry-run',
      });
      continue;
    }

    try {
      const result = await publishArticle({
        file,
        content: undefined,
        key: finalKey,
        kind: finalKind,
        topic: finalTopic,
        title: finalTitle,
        sourceUrl: finalSourceUrl,
        sourceName: finalSourceName,
        sourceLicense,
        language,
        useHyperbeam,
        useHyperbeamReference,
        visibility,
        encryptedFor,
      });
      results.push({
        file,
        key: result.summary.key,
        id: result.summary.id,
        version: result.summary.version,
        status: 'ok',
        encrypted: result.encrypted,
      });
      succeeded++;
    } catch (err) {
      results.push({ file, key: finalKey, status: 'error', error: err.message });
      failed++;
    }
  }

  if (!dryRun) {
    try {
      logAction({
        home,
        action: 'publish-directory',
        status: failed ? (succeeded ? 'partial' : 'error') : 'ok',
        message: `Published directory ${dir}: ${succeeded} succeeded, ${failed} failed, ${skipped} skipped`,
        details: { dir, recursive, succeeded, failed, skipped, count: files.length },
      });
    } catch {
      // best-effort audit logging
    }
  }

  return {
    dir,
    recursive,
    dryRun,
    count: files.length,
    succeeded,
    failed,
    skipped,
    results,
  };
}

export function publishDirectoryToMarkdown(report) {
  const lines = [];
  lines.push(`# Directory Publish: ${report.dir}`);
  lines.push(`Recursive: ${report.recursive ? 'yes' : 'no'}`);
  lines.push(`Mode: ${report.dryRun ? 'dry-run' : 'live'}`);
  lines.push(`Files: ${report.count} | Succeeded: ${report.succeeded} | Failed: ${report.failed} | Skipped: ${report.skipped}`);
  lines.push('');
  for (const r of report.results) {
    if (r.status === 'ok') {
      lines.push(`- ✓ ${r.key} (${r.id}) — ${path.basename(r.file)}`);
    } else if (r.status === 'dry-run') {
      lines.push(`- ~ ${r.key} [${r.kind}/${r.topic}] — ${path.basename(r.file)}`);
    } else {
      lines.push(`- ✗ ${r.key || '(no key)'}: ${r.error} — ${path.basename(r.file)}`);
    }
  }
  return lines.join('\n') + '\n';
}
