/**
 * release-notes.mjs — Keep-a-Changelog parser, validator, and release-note builder.
 *
 * Supports:
 *   - parseChangelog(text)            → structured changelog object
 *   - validateChangelog(text)         → { valid, errors[] }
 *   - buildReleaseNotes(opts)         → { markdown, json } for a version or Unreleased
 *   - generateDraftFromGitCommits(opts) → draft Unreleased entry from `git log`
 *   - releaseNotesToMarkdown(release) → markdown string
 *   - releaseNotesToJson(release)     → structured JSON
 */

import { execSync } from 'node:child_process';

const DEFAULT_CHANGELOG_PATH = './CHANGELOG.md';
const HEADING_RE = /^##\s+\[([^\]]+)\]\s*(?:-\s*(\d{4}-\d{2}-\d{2}))?\s*$/;
const SUBSECTION_RE = /^###\s+(Added|Changed|Fixed|Removed|Security)$/;
const KNOWN_SUBSECTIONS = ['Added', 'Changed', 'Fixed', 'Removed', 'Security'];

function stripLinks(text) {
  // Remove markdown reference links and keep plain text.
  return text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1');
}

export function parseChangelog(text) {
  if (typeof text !== 'string') throw new Error('parseChangelog expects a string');
  const lines = text.split('\n');
  const result = {
    title: '',
    intro: [],
    unreleased: null,
    versions: []
  };

  let currentVersion = null;
  let currentSubsection = null;
  let inIntro = true;
  let buffer = [];

  function flushBuffer(target) {
    if (buffer.length === 0 || !target) return;
    const raw = buffer.join('\n').trim();
    if (raw) target.push(stripLinks(raw));
    buffer = [];
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();

    // Title
    if (line.startsWith('# ')) {
      result.title = line.slice(2).trim();
      flushBuffer(result.intro);
      inIntro = false;
      continue;
    }

    // Intro text (before any version heading) - accumulate non-empty lines.
    if (inIntro && line.length > 0 && !line.startsWith('#')) {
      buffer.push(line);
      continue;
    }
    if (inIntro && line.length === 0) {
      flushBuffer(result.intro);
      continue;
    }

    const versionMatch = line.match(HEADING_RE);
    if (versionMatch) {
      flushBuffer(inIntro ? result.intro : currentVersion?.description);
      inIntro = false;
      currentSubsection = null;
      const version = versionMatch[1];
      const date = versionMatch[2] || null;
      const entry = {
        version,
        date,
        description: [],
        subsections: {}
      };
      if (version.toLowerCase() === 'unreleased') {
        result.unreleased = entry;
      } else {
        result.versions.push(entry);
      }
      currentVersion = entry;
      continue;
    }

    const subsectionMatch = line.match(SUBSECTION_RE);
    if (subsectionMatch && currentVersion) {
      flushBuffer(currentVersion.description);
      const name = subsectionMatch[1];
      currentSubsection = name;
      if (!currentVersion.subsections[name]) currentVersion.subsections[name] = [];
      continue;
    }

    // Empty line handling.
    if (line.trim() === '') {
      if (inIntro) {
        flushBuffer(result.intro);
      } else if (currentVersion && !currentSubsection) {
        flushBuffer(currentVersion.description);
      }
      continue;
    }

    // List item under a subsection.
    if (currentSubsection && line.trim().startsWith('- ')) {
      currentVersion.subsections[currentSubsection].push(stripLinks(line.trim().slice(2).trim()));
      continue;
    }

    // Accumulate description text.
    if (inIntro) {
      buffer.push(line);
    } else if (currentVersion && !currentSubsection) {
      buffer.push(line);
    }
  }

  flushBuffer(inIntro ? result.intro : currentVersion?.description);

  // Normalize unreleased presence.
  if (!result.unreleased) {
    result.unreleased = {
      version: 'Unreleased',
      date: null,
      subsections: {}
    };
  }

  return result;
}

export function validateChangelog(text) {
  const errors = [];
  try {
    const parsed = parseChangelog(text);

    if (!parsed.title) errors.push({ path: 'title', message: 'Changelog title missing' });

    const hasKnownSubsection = (entry) =>
      Object.keys(entry.subsections).some((s) => KNOWN_SUBSECTIONS.includes(s));

    if (!hasKnownSubsection(parsed.unreleased) && parsed.unreleased.description?.length === 0) {
      // Unreleased section can be empty; not an error.
    }

    for (let i = 0; i < parsed.versions.length; i++) {
      const v = parsed.versions[i];
      if (!v.date) {
        errors.push({ path: `versions[${i}].date`, message: `Version [${v.version}] is missing an ISO date` });
      } else if (!/^\d{4}-\d{2}-\d{2}$/.test(v.date)) {
        errors.push({ path: `versions[${i}].date`, message: `Version [${v.version}] date is not YYYY-MM-DD` });
      }
      if (!hasKnownSubsection(v)) {
        errors.push({ path: `versions[${i}].subsections`, message: `Version [${v.version}] has no Added/Changed/Fixed/Removed/Security subsections` });
      }
      for (const subsection of Object.keys(v.subsections)) {
        if (!KNOWN_SUBSECTIONS.includes(subsection)) {
          errors.push({ path: `versions[${i}].subsections.${subsection}`, message: `Unknown subsection "${subsection}" in version [${v.version}]` });
        }
      }
    }

    // Keep-a-Changelog recommends newest-first ordering.
    let lastDate = '9999-99-99';
    for (let i = 0; i < parsed.versions.length; i++) {
      const v = parsed.versions[i];
      if (v.date && v.date > lastDate) {
        errors.push({ path: `versions[${i}]`, message: `Versions should be listed newest-first; [${v.version}] (${v.date}) is older than a prior version` });
      }
      lastDate = v.date || lastDate;
    }
  } catch (err) {
    errors.push({ path: 'parse', message: err.message });
  }

  return { valid: errors.length === 0, errors };
}

function pickVersion(parsed, opts = {}) {
  if (opts.unreleased) return parsed.unreleased;
  if (opts.version) {
    const found = parsed.versions.find((v) => v.version === opts.version);
    if (!found) throw new Error(`Version ${opts.version} not found in CHANGELOG`);
    return found;
  }
  // Default: latest released version, falling back to Unreleased.
  return parsed.versions[0] || parsed.unreleased;
}

export function buildReleaseNotes(opts = {}) {
  const text = opts.text ?? (opts.path ? readChangelogSync(opts.path) : readChangelogSync(DEFAULT_CHANGELOG_PATH));
  const parsed = parseChangelog(text);
  const release = pickVersion(parsed, opts);
  return {
    markdown: releaseNotesToMarkdown(release, opts),
    json: releaseNotesToJson(release, opts),
    release,
    parsed
  };
}

export function releaseNotesToMarkdown(release, opts = {}) {
  const versionLine = release.version.toLowerCase() === 'unreleased'
    ? `## [Unreleased]`
    : `## [${release.version}] - ${release.date || 'unknown'}`;
  const sections = [];
  for (const subsection of KNOWN_SUBSECTIONS) {
    const items = release.subsections[subsection];
    if (items?.length) {
      sections.push(`### ${subsection}`, ...items.map((item) => `- ${item}`));
    }
  }
  const description = release.description?.length ? release.description.join('\n\n') : '';
  const parts = [versionLine];
  if (description) parts.push('', description);
  if (sections.length) parts.push('', ...sections);
  return parts.join('\n');
}

export function releaseNotesToJson(release, opts = {}) {
  return {
    version: release.version,
    date: release.date,
    description: release.description || [],
    subsections: KNOWN_SUBSECTIONS.reduce((acc, subsection) => {
      acc[subsection.toLowerCase()] = release.subsections[subsection] || [];
      return acc;
    }, {})
  };
}

import { readFileSync } from 'node:fs';

function readChangelogSync(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch (err) {
    throw new Error(`Failed to read changelog at ${path}: ${err.message}`);
  }
}

const CONVENTIONAL_PREFIX_MAP = {
  feat: 'Added',
  feature: 'Added',
  add: 'Added',
  fix: 'Fixed',
  bugfix: 'Fixed',
  docs: 'Changed',
  doc: 'Changed',
  refactor: 'Changed',
  chore: 'Changed',
  ci: 'Changed',
  build: 'Changed',
  perf: 'Changed',
  style: 'Changed',
  test: 'Changed',
  remove: 'Removed',
  delete: 'Removed',
  rm: 'Removed',
  security: 'Security',
  sec: 'Security',
  breaking: 'Changed'
};

export function categorizeCommitMessage(message) {
  const text = message.trim();
  const match = text.match(/^([a-zA-Z]+)(?:\([^)]+\))?!?:\s*(.+)$/);
  let category = 'Changed';
  let scope = null;
  let body = text;
  if (match) {
    const prefix = match[1].toLowerCase();
    body = match[2];
    const scopeMatch = text.match(/^\w+\(([^)]+)\)/);
    if (scopeMatch) scope = scopeMatch[1];
    category = CONVENTIONAL_PREFIX_MAP[prefix] || 'Changed';
  }
  return { category, scope, body };
}

export function generateDraftFromGitCommits(opts = {}) {
  const limit = opts.limit || 50;
  const since = opts.since;
  const path = opts.path || process.cwd();
  const command = since
    ? `git log --since="${since}" --pretty=format:"%h %s"`
    : `git log -n ${limit} --pretty=format:"%h %s"`;
  let output;
  try {
    output = execSync(command, { cwd: path, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
  } catch (err) {
    throw new Error(`Failed to run git log: ${err.message}`);
  }

  const lines = output.split('\n').filter(Boolean);
  const subsections = {};
  for (const line of lines) {
    const spaceIdx = line.indexOf(' ');
    const subject = spaceIdx === -1 ? line : line.slice(spaceIdx + 1);
    const info = categorizeCommitMessage(subject);
    if (info.body.startsWith('release') || info.body.startsWith('chore(release)')) continue;
    if (!subsections[info.category]) subsections[info.category] = [];
    subsections[info.category].push(`${info.body} (${line.slice(0, spaceIdx)})`);
  }

  // Deduplicate and sort.
  for (const category of Object.keys(subsections)) {
    subsections[category] = [...new Set(subsections[category])];
  }

  const release = {
    version: 'Unreleased',
    date: null,
    description: [],
    subsections
  };

  return {
    markdown: releaseNotesToMarkdown(release, opts),
    json: releaseNotesToJson(release, opts),
    release
  };
}

export function releaseNotesToMarkdownString(release, opts) {
  return releaseNotesToMarkdown(release, opts);
}

export function releaseNotesToJsonObject(release, opts) {
  return releaseNotesToJson(release, opts);
}
