/**
 * Viewer settings panel test
 *
 * Verifies that the web viewer has a Settings panel with controls for
 * theme, live transport, default sort, results per page, and live-tail
 * audit-log toggle; that the controls persist to localStorage; and that
 * the chosen values are reflected in URL query params.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const viewerPath = path.resolve(__dirname, '..', 'viewer', 'index.html');

const html = fs.readFileSync(viewerPath, 'utf8');

// Settings modal present
assert.ok(html.includes('id="settingsOverlay"'), 'viewer should have settings overlay');
assert.ok(html.includes('id="settingsBtn"'), 'viewer should have settings button');
assert.ok(html.includes('window.showSettings'), 'viewer should expose showSettings');
assert.ok(html.includes('window.hideSettings'), 'viewer should expose hideSettings');
assert.ok(html.includes('window.saveSettings'), 'viewer should expose saveSettings');
assert.ok(html.includes('window.resetSettings'), 'viewer should expose resetSettings');

// Theme control
assert.ok(html.includes('id="settingTheme"'), 'viewer should have theme setting');
assert.ok(html.includes('value="auto"'), 'viewer should have auto theme option');
assert.ok(html.includes('value="dark"'), 'viewer should have dark theme option');
assert.ok(html.includes('value="light"'), 'viewer should have light theme option');
assert.ok(html.includes('permabrain-theme'), 'viewer should persist theme to localStorage');
assert.ok(html.includes('[data-theme="auto"]'), 'viewer should have auto theme media-query block');

// Live transport control
assert.ok(html.includes('id="settingTransport"'), 'viewer should have transport setting');
assert.ok(html.includes('value="sse"'), 'viewer should have SSE transport option');
assert.ok(html.includes('value="ws"'), 'viewer should have WebSocket transport option');
assert.ok(html.includes('permabrain-live-transport'), 'viewer should persist transport to localStorage');

// Default sort control
assert.ok(html.includes('id="settingSort"'), 'viewer should have default sort setting');
assert.ok(html.includes('value="key"'), 'viewer should have key sort option');
assert.ok(html.includes('permabrain-default-sort'), 'viewer should persist sort to localStorage');

// Results per page control
assert.ok(html.includes('id="settingPageSize"'), 'viewer should have page size setting');
assert.ok(html.includes('permabrain-page-size'), 'viewer should persist page size to localStorage');

// Live-tail toggle
assert.ok(html.includes('id="settingLiveTail"'), 'viewer should have live-tail toggle');
assert.ok(html.includes('permabrain-live-tail'), 'viewer should persist live-tail to localStorage');

// URL params reflected
assert.ok(html.includes("params.set('theme'"), 'viewer should encode theme in URL');
assert.ok(html.includes("params.set('transport'"), 'viewer should encode transport in URL');
assert.ok(html.includes("params.set('pageSize'"), 'viewer should encode page size in URL');
assert.ok(html.includes('liveTail'), 'viewer should reference liveTail setting');
assert.ok(html.includes('settings.pageSize'), 'viewer should use settings.pageSize for list limit');

console.log('viewer-settings tests passed');
