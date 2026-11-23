// Offline: the app's own files are cached on install and served from the cache.
// The cache name carries the app version (passed as ?v= when the app registers this worker).
const VERSION = new URL(self.location).searchParams.get('v') || 'dev';
const CACHE = `quarry-go-${VERSION}`;
const FILES = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/export.js', 'js/frames.js', 'js/gif.js', 'js/player.js', 'js/retime.js', 'js/reviews.js', 'js/store.js',
  'fonts/rubik-400.woff2', 'fonts/rubik-500.woff2', 'fonts/rubik-600.woff2', 'fonts/rubik-800.woff2',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('quarry-go-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith(caches.match('index.html').then(r => r || fetch(req)));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(r => r || fetch(req)));
});
