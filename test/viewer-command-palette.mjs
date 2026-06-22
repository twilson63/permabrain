/**
 * Viewer command palette tests.
 *
 * Verifies that the web viewer includes a command palette button and overlay,
 * exposes window.showCommandPalette/hideCommandPalette/filterCommandPalette/
 * onCommandPaletteKey/runCommandByIndex, maintains commandPaletteState, and
 * supports opening via toolbar click, Ctrl+K / Cmd+K, and ?view=command-palette.
 * Does not require a live server.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const viewerPath = path.resolve(__dirname, '..', 'viewer', 'index.html');
const html = fs.readFileSync(viewerPath, 'utf8');

assert.ok(html.includes('id="commandPaletteBtn"'), 'viewer should have command palette button');
assert.ok(html.includes('onclick="window.showCommandPalette()"'), 'command palette button should call showCommandPalette');
assert.ok(html.includes('id="commandPaletteOverlay"'), 'viewer should have command palette overlay');
assert.ok(html.includes('id="commandPaletteInput"'), 'viewer should have command palette input');
assert.ok(html.includes('id="commandPaletteList"'), 'viewer should have command palette list');
assert.ok(html.includes('class="command-palette"'), 'viewer should include command palette CSS');
assert.ok(html.includes('window.showCommandPalette = function()'), 'viewer should expose showCommandPalette');
assert.ok(html.includes('window.hideCommandPalette = function()'), 'viewer should expose hideCommandPalette');
assert.ok(html.includes('window.filterCommandPalette = function()'), 'viewer should expose filterCommandPalette');
assert.ok(html.includes('window.onCommandPaletteKey = function('), 'viewer should expose onCommandPaletteKey');
assert.ok(html.includes('window.runCommandByIndex = function('), 'viewer should expose runCommandByIndex');
assert.ok(html.includes('var commandPaletteState'), 'viewer should define commandPaletteState');
assert.ok(html.includes("case 'command-palette':"), 'dispatchView should route command-palette mode');
assert.ok(html.includes("viewMode === 'command-palette'"), 'command palette guard should exist');
assert.ok(html.includes("'command-palette'"), 'command palette should be referenced in view whitelist');
assert.ok(html.includes("Ctrl+K / Cmd+K"), 'help panel should mention command palette shortcut');
assert.ok(html.includes("Ctrl+K") || html.includes("Cmd+K"), 'key listener should mention command palette shortcut');
assert.ok(html.includes('e.ctrlKey || e.metaKey') && html.includes("key === 'k' || key === 'K'"), 'key listener should open command palette on Ctrl+K / Cmd+K');
assert.ok(html.includes('window.hideCommandPalette()') && html.includes("key === 'Escape'"), 'key listener should close command palette on Escape');

console.log('viewer-command-palette tests passed');
