/**
 * PermaBrain interactive REPL
 *
 * Powers `permabrain shell` and `api.repl()`. Starts a Node.js REPL with the
 * agent API as the evaluation context, persisted command history, and tab
 * completion for `api` / `pb` methods.
 */

import fs from 'node:fs';
import path from 'node:path';
import repl from 'node:repl';
import { Readable, Writable } from 'node:stream';
import { inspect } from 'node:util';

const DEFAULT_HISTORY_SIZE = 1000;

/**
 * Locate or create a default history path.
 * Prefer the PermaBrain home directory, fall back to cwd, then os.homedir().
 */
function defaultHistoryPath(home) {
  if (home) return path.join(home, 'repl-history.jsonl');
  return path.join(process.cwd(), '.permabrain', 'repl-history.jsonl');
}

/**
 * Read persisted REPL history from a JSONL file.
 */
export function readHistory(historyPath, historySize = DEFAULT_HISTORY_SIZE) {
  if (!historyPath || !fs.existsSync(historyPath)) return [];
  try {
    const text = fs.readFileSync(historyPath, 'utf8');
    const lines = text.split('\n').filter(Boolean);
    const entries = [];
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        entries.push(typeof parsed === 'string' ? parsed : String(parsed));
      } catch {
        entries.push(line);
      }
    }
    return entries.slice(-historySize);
  } catch {
    return [];
  }
}

/**
 * Persist REPL history to a JSONL file.
 */
export function writeHistory(historyPath, entries, historySize = DEFAULT_HISTORY_SIZE) {
  if (!historyPath) return false;
  try {
    fs.mkdirSync(path.dirname(historyPath), { recursive: true });
    const recent = entries.slice(-historySize);
    const lines = recent.map(e => JSON.stringify(String(e))).join('\n') + (recent.length ? '\n' : '');
    fs.writeFileSync(historyPath, lines, 'utf8');
    return true;
  } catch {
    return false;
  }
}

/**
 * Build a tab completer that completes `api.` and `pb.` method names.
 *
 * Falls back to Node's default REPL completer for everything else so general
 * JavaScript expressions still get completions.
 */
export function buildApiCompleter(api, fallbackCompleter) {
  const methods = Object.keys(api).filter(k => typeof api[k] === 'function' && !k.startsWith('_'));
  return function apiCompleter(line, callback) {
    const prefixMatch = line.match(/^\s*(api|pb)\.([A-Za-z0-9_]*)$/);
    if (prefixMatch) {
      const prefix = prefixMatch[2];
      const hits = methods.filter(m => m.startsWith(prefix)).map(m => `${prefixMatch[1]}.${m}`);
      return callback(null, [hits, line]);
    }
    if (line.trim() === '') {
      const hits = ['api.', 'pb.'];
      return callback(null, [hits, line]);
    }
    if (fallbackCompleter) {
      return fallbackCompleter(line, callback);
    }
    return callback(null, [[], line]);
  };
}

/**
 * Start a PermaBrain REPL.
 *
 * @param {Object} opts
 * @param {Object} opts.api - The PermaBrain agent API object
 * @param {string} [opts.home] - PermaBrain home directory
 * @param {import('node:stream').Readable} [opts.input]
 * @param {import('node:stream').Writable} [opts.output]
 * @param {string} [opts.historyPath]
 * @param {string} [opts.prompt]
 * @param {boolean} [opts.terminal]
 * @param {boolean} [opts.useColors]
 * @param {number} [opts.historySize]
 * @returns {Promise<void>}
 */
export async function createRepl(opts = {}) {
  const { api, home } = opts;
  const input = opts.input || process.stdin;
  const output = opts.output || process.stdout;
  const historyPath = opts.historyPath || defaultHistoryPath(home);
  const historySize = opts.historySize || DEFAULT_HISTORY_SIZE;
  const isTTY = opts.terminal !== undefined ? opts.terminal : !!(input.isTTY && output.isTTY);
  const useColors = opts.useColors !== undefined ? opts.useColors : isTTY;
  const prompt = opts.prompt || (isTTY ? 'permabrain> ' : '');

  const initialHistory = readHistory(historyPath, historySize);
  // Non-terminal mode does not populate server.history, so we track entries
  // ourselves to persist them on exit.
  const observedHistory = [...initialHistory];

  // Start the REPL. We pass a dummy completer first so we can capture the
  // default REPL completer, then swap in our api-aware wrapper.
  const server = repl.start({
    prompt,
    input,
    output,
    terminal: isTTY,
    useColors,
    useGlobal: true,
    history: initialHistory,
    ignoreUndefined: true,
    writer: (value) => {
      // Show rich output for objects, but avoid printing undefined.
      if (value === undefined) return '';
      return inspect(value, { colors: useColors, depth: 5, breakLength: Infinity });
    },
    completer: () => [[], '']
  });

  server.context.api = api;
  server.context.pb = api;

  // Replace the dummy completer with one that completes api/pb methods and
  // falls back to the REPL's default completion logic.
  const fallback = server.completer;
  server.completer = buildApiCompleter(api, fallback);

  // Observe every input line for non-terminal history recording.
  if (!isTTY) {
    input.on('data', chunk => {
      const text = chunk.toString();
      for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (trimmed) observedHistory.push(trimmed);
      }
    });
  }

  if (isTTY) {
    output.write('PermaBrain interactive shell — type api.<method> or pb.<method>\n');
    output.write('Try: await api.query({ topic: \'ai\' })\n');
    output.write('Use .exit or press Ctrl+D to quit.\n');
  }

  return new Promise((resolve, reject) => {
    server.on('exit', () => {
      // Node only populates server.history in terminal mode. In non-terminal
      // mode we replay the input we observed to keep history consistent.
      const rawHistory = server.history?.length ? server.history : observedHistory;
      const chronological = rawHistory.slice(-historySize).reverse();
      writeHistory(historyPath, chronological, historySize);
      resolve();
    });
    server.on('error', reject);
    input.on('error', reject);
    output.on('error', reject);
  });
}

export { DEFAULT_HISTORY_SIZE };
