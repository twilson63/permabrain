/* PermaBrain service worker: offline cache for viewer shell. */

const CACHE_NAME = 'permabrain-viewer-v1';
const STATIC_ASSETS = [
  './index.html',
  './crypto.mjs',
  './manifest.json',
  './service-worker.mjs'
];
const EXTERNAL_ASSETS = [
  'https://cdn.jsdelivr.net/npm/marked/marked.min.js'
];

self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(STATIC_ASSETS);
    }).then(function() {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(key) { return key !== CACHE_NAME; }).map(function(key) {
          return caches.delete(key);
        })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function(event) {
  var request = event.request;
  var url = new URL(request.url);

  // Network-first for API calls so live data is always fresh.
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  event.respondWith(
    caches.match(request).then(function(cached) {
      var fetchPromise = fetch(request).then(function(networkResponse) {
        if (networkResponse && networkResponse.status === 200) {
          var clone = networkResponse.clone();
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put(request, clone);
          });
        }
        return networkResponse;
      }).catch(function() {
        return cached;
      });
      return cached || fetchPromise;
    })
  );
});
