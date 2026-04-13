// Odin Service Worker
// Strategy: network-first for all requests.
// Caches shell assets on install so the app opens offline after first load.

var CACHE_NAME = 'odin-v2';
var SHELL_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './favicon.svg',
  './apple-touch-icon-180.png'
];

// Install: cache shell assets
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(SHELL_ASSETS);
    }).then(function() {
      return self.skipWaiting();
    })
  );
});

// Activate: remove old caches
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(key) { return key !== CACHE_NAME; })
            .map(function(key) { return caches.delete(key); })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

// Fetch: network-first, fall back to cache
self.addEventListener('fetch', function(event) {
  // Only handle GET requests for same-origin or shell assets
  if (event.request.method !== 'GET') return;

  // Let Supabase / n8n / external API calls go straight to network
  var url = new URL(event.request.url);
  var isExternal = url.origin !== self.location.origin;
  if (isExternal) return;

  event.respondWith(
    fetch(event.request)
      .then(function(response) {
        // Cache a fresh copy of shell assets as we fetch them
        if (response && response.status === 200) {
          var clone = response.clone();
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put(event.request, clone);
          });
        }
        return response;
      })
      .catch(function() {
        // Offline: serve from cache
        return caches.match(event.request).then(function(cached) {
          return cached || caches.match('./index.html');
        });
      })
  );
});
