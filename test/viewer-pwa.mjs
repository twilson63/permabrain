/**
 * Mobile PWA viewer tests.
 *
 * Verifies that the viewer ships a web app manifest, a service worker,
 * and that index.html registers the service worker and links the manifest.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const viewerDir = path.resolve(__dirname, '..', 'viewer');
const indexPath = path.join(viewerDir, 'index.html');
const manifestPath = path.join(viewerDir, 'manifest.json');
const swPath = path.join(viewerDir, 'service-worker.mjs');

const html = fs.readFileSync(indexPath, 'utf8');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const sw = fs.readFileSync(swPath, 'utf8');

// --- manifest.json is a valid PWA manifest ---
{
  assert.equal(manifest.name, 'PermaBrain Viewer');
  assert.equal(manifest.short_name, 'PermaBrain');
  assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.start_url, 'manifest should have start_url');
  assert.ok(manifest.scope, 'manifest should have scope');
  assert.ok(manifest.icons, 'manifest should have icons');
  assert.ok(manifest.icons.length >= 1, 'manifest should have at least one icon');
  assert.ok(manifest.theme_color, 'manifest should have theme_color');
  assert.ok(manifest.background_color, 'manifest should have background_color');
}

// --- service-worker.mjs defines install/activate/fetch lifecycle ---
{
  assert.ok(sw.includes("addEventListener('install'"), 'SW should listen for install');
  assert.ok(sw.includes("addEventListener('activate'"), 'SW should listen for activate');
  assert.ok(sw.includes("addEventListener('fetch'"), 'SW should listen for fetch');
  assert.ok(sw.includes('caches.open'), 'SW should open caches');
  assert.ok(sw.includes('CACHE_NAME'), 'SW should define a cache name');
  assert.ok(sw.includes('skipWaiting'), 'SW should call skipWaiting');
  assert.ok(sw.includes('clients.claim'), 'SW should claim clients');
}

// --- index.html links manifest and registers service worker ---
{
  assert.ok(html.includes('rel="manifest"'), 'index.html should link manifest');
  assert.ok(html.includes('./manifest.json'), 'index.html should reference manifest.json');
  assert.ok(html.includes('serviceWorker.register'), 'index.html should register a service worker');
  assert.ok(html.includes('./service-worker.mjs'), 'index.html should reference service-worker.mjs');
  assert.ok(html.includes('name="theme-color"'), 'index.html should set theme-color meta');
}

console.log('viewer-pwa tests passed');
