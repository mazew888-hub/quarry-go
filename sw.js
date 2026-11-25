// Offline: the app's own files are cached on install and served from the cache.
// Keep VERSION equal to VERSION in js/app.js (a test checks): changing it changes this file,
// which is how an installed copy finds out there's an update.
const VERSION = '0.6.4';
const CACHE = `quarry-go-${VERSION}`;
const FILES = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/drive.js', 'js/draw.js', 'js/overlay.js', 'js/phone.js', 'js/ui.js', 'js/sort.js', 'js/library.js', 'js/export.js', 'js/frames.js', 'js/gif.js', 'js/player.js', 'js/retime.js', 'js/reviews.js', 'js/store.js', 'js/zip.js', 'js/mp4.js', 'js/warp.js', 'js/days.js', 'js/names.js', 'js/handback.js', 'js/render.js', 'js/pack.js', 'maya/maya_drop.py',
  'fonts/rubik-400.woff2', 'fonts/rubik-500.woff2', 'fonts/rubik-600.woff2', 'fonts/rubik-800.woff2',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', e => {
  // cache: 'reload' skips the browser's own copy (GitHub Pages lets it keep files 10 minutes), so a new
  // version never stores yesterday's files.
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()));
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
