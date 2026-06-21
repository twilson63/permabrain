/**
 * Viewer Bookmarks / Saved queries panel tests.
 *
 * Verifies that the web viewer includes a bookmarks panel for saving,
 * restoring, exporting, and importing named view states via localStorage.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const viewerPath = path.resolve(__dirname, '..', 'viewer', 'index.html');
const html = fs.readFileSync(viewerPath, 'utf8');

// --- viewer/index.html contains bookmarks toolbar wiring ---
{
  assert.ok(html.includes('id="bookmarkViewBtn"'), 'viewer should have bookmark current view button');
  assert.ok(html.includes('id="bookmarksBtn"'), 'viewer should have bookmarks panel button');
  assert.ok(html.includes('window.saveBookmarkPrompt()'), 'bookmark button should call saveBookmarkPrompt');
  assert.ok(html.includes('window.showBookmarks()'), 'bookmarks button should call showBookmarks');
}

// --- viewer/index.html exposes bookmark state and functions ---
{
  assert.ok(html.includes('bookmarksState'), 'viewer should track bookmarksState');
  assert.ok(html.includes("BOOKMARKS_STORAGE_KEY = 'permabrain-bookmarks'"), 'bookmarks should use permabrain-bookmarks localStorage key');
  assert.ok(html.includes('window.saveBookmark'), 'viewer should expose saveBookmark');
  assert.ok(html.includes('window.saveBookmarkPrompt'), 'viewer should expose saveBookmarkPrompt');
  assert.ok(html.includes('window.deleteBookmark'), 'viewer should expose deleteBookmark');
  assert.ok(html.includes('window.loadBookmark'), 'viewer should expose loadBookmark');
  assert.ok(html.includes('window.showBookmarks'), 'viewer should expose showBookmarks');
  assert.ok(html.includes('window.refreshBookmarks'), 'viewer should expose refreshBookmarks');
  assert.ok(html.includes('window.exportBookmarks'), 'viewer should expose exportBookmarks');
  assert.ok(html.includes('window.importBookmarks'), 'viewer should expose importBookmarks');
  assert.ok(html.includes('window.renderBookmarks'), 'viewer should expose renderBookmarks');
}

// --- Bookmark state is captured, persisted, and restored ---
{
  assert.ok(html.includes('function readBookmarks'), 'viewer should have readBookmarks helper');
  assert.ok(html.includes('function writeBookmarks'), 'viewer should have writeBookmarks helper');
  assert.ok(html.includes('localStorage.setItem(BOOKMARKS_STORAGE_KEY'), 'saveBookmark should persist to localStorage');
  assert.ok(html.includes('localStorage.getItem(BOOKMARKS_STORAGE_KEY'), 'readBookmarks should read from localStorage');
  assert.ok(html.includes('state: readUrlState()'), 'bookmarks should capture current URL state');
  assert.ok(html.includes('applyUrlState(record.state)'), 'loadBookmark should restore captured state');
}

// --- URL state encodes/decodes bookmarks view and selected bookmark ---
{
  assert.ok(html.includes("viewMode === 'bookmarks'"), 'buildUrlState should handle bookmarks view');
  assert.ok(html.includes("params.set('bookmark', bookmarksState.selectedName)"), 'buildUrlState should encode selected bookmark');
  assert.ok(html.includes("bookmark: params.get('bookmark') || ''"), 'readUrlState should decode bookmark param');
  assert.ok(html.includes("state.view === 'bookmarks'"), 'applyUrlState should handle bookmarks view');
  assert.ok(html.includes("?view=bookmarks"), 'viewer should reference bookmarks deep-link');
  assert.ok(html.includes("'bookmarks'"), 'applyUrlState view whitelist should include bookmarks');
}

// --- Boot dispatch and pre-render handle bookmarks ---
{
  assert.ok(html.includes("bootState.view === 'bookmarks'"), 'boot dispatch should include bookmarks view');
  assert.ok(html.includes("else if (viewMode === 'bookmarks') window.showBookmarks()"), 'pre-render should handle bookmarks mode');
}

// --- Bookmarks panel supports import/export JSON ---
{
  assert.ok(html.includes('bookmarksImportText'), 'bookmarks panel should have import textarea');
  assert.ok(html.includes('window.importBookmarks(document.getElementById'), 'import should call importBookmarks');
  assert.ok(html.includes('window.exportBookmarks()'), 'export action should call exportBookmarks');
  assert.ok(html.includes('window.downloadText'), 'bookmarks panel should use downloadText helper');
  assert.ok(html.includes('window.copyText'), 'bookmarks panel should use copyText helper');
}

console.log('viewer-bookmarks tests passed');
