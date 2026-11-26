// Service worker: the page is network-first with a cached copy for offline use;
// static files are served from cache and refreshed in the background.
// Cache names start with "vidledger-" because every project on this github.io
// account shares one origin; we only ever delete our own caches.
const CACHE = 'vidledger-v1.0.0';
const SHELL = [
  './', 'index.html', 'styles.css', 'app.js', 'theme-init.js',
  'manifest.webmanifest', 'js/charts.js', 'js/core.js', 'js/dom.js', 'js/exporter.js',
  'js/format.js', 'js/github.js', 'js/links.js', 'js/md.js', 'js/merge.js',
  'js/model.js', 'js/remote.js', 'js/srs.js', 'js/store.js', 'js/ui.js',
  'js/views/activity.js', 'js/views/add.js', 'js/views/common.js', 'js/views/connect.js', 'js/views/decide.js',
  'js/views/guide.js', 'js/views/home.js', 'js/views/library.js', 'js/views/revise.js', 'js/views/settings.js',
  'js/views/stats.js', 'js/views/topics-list.js', 'js/views/topics.js', 'js/views/video.js', 'fonts/ibm-plex-sans-latin-400-normal.woff2',
  'fonts/ibm-plex-sans-latin-500-normal.woff2', 'fonts/ibm-plex-sans-latin-600-normal.woff2', 'fonts/ibm-plex-sans-latin-ext-400-normal.woff2', 'fonts/ibm-plex-sans-latin-ext-500-normal.woff2', 'fonts/ibm-plex-sans-latin-ext-600-normal.woff2',
  'icons/favicon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('vidledger-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  // Never touch GitHub API calls, YouTube or anything from another origin: private data is not cached here.
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    event.respondWith(withTimeout(fetch(req), 4000)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put('index.html', copy));
        return res;
      })
      .catch(() => caches.match('index.html')));
    return;
  }
  event.respondWith(caches.match(req, { ignoreSearch: true }).then((cached) => {
    const fresh = fetch(req).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    }).catch(() => cached);
    return cached || fresh;
  }));
});
