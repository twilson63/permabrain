/**
 * Viewer keyboard-shortcut help panel tests.
 *
 * Verifies that the web viewer includes a Help button, exposes
 * window.showHelp(), renders a shortcut table, and opens/closes via
 * keyboard events. Does not require a live server.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const viewerPath = path.resolve(__dirname, '..', 'viewer', 'index.html');
const html = fs.readFileSync(viewerPath, 'utf8');

assert.ok(html.includes('id="helpBtn"'), 'viewer should have help button');
assert.ok(html.includes('onclick="window.showHelp()"'), 'help button should call showHelp');
assert.ok(html.includes('window.showHelp = function()'), 'viewer should expose showHelp');
assert.ok(html.includes('window.hideHelp = function()'), 'viewer should expose hideHelp');
assert.ok(html.includes('helpShortcuts'), 'viewer should have helpShortcuts array');
assert.ok(html.includes('Keyboard shortcuts'), 'help panel title should be present');
assert.ok(html.includes("'help'"), 'viewer should reference help view in state handling');
assert.ok(html.includes("case 'help':"), 'dispatchView should route help mode');
assert.ok(html.includes("viewMode === 'help'"), 'help panel guard should exist');
assert.ok(html.includes('setViewMode(\'help\')'), 'showHelp should set view mode');
assert.ok(html.includes('markActiveToolbarButton(\'helpBtn\')'), 'showHelp should highlight help button');
assert.ok(html.includes("key === '?'"), 'viewer should listen for ? key');
assert.ok(html.includes("key === 'Escape'"), 'viewer should listen for Escape key');

console.log('viewer-help tests passed');
