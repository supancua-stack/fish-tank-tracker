/* Guppy Farm Tracker — PWA service worker
 * Caches the app shell and selected app assets for basic offline reopening.
 * Fish records remain in the existing localStorage key used by index.html.
 * This service worker does not upload, sync, clear, or migrate user records.
 */
const CACHE_NAME = 'guppy-farm-shell-v1';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './fish-tank-tracker-icon.png'
];
const CDN_HOSTS = new Set([
  'cdn.tailwindcss.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com'
]);

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key.startsWith('guppy-farm-shell-') && key !== CACHE_NAME)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;

  // Cache approved third-party styles/scripts/fonts after they are first used.
  if (!sameOrigin) {
    if (!CDN_HOSTS.has(url.hostname)) return;
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const response = await fetch(request);
        if (response && (response.ok || response.type === 'opaque')) {
          await cache.put(request, response.clone());
        }
        return response;
      } catch (error) {
        const cached = await cache.match(request);
        if (cached) return cached;
        throw error;
      }
    })());
    return;
  }

  // Network-first for the app document so GitHub Pages updates are picked up.
  if (request.mode === 'navigate' || url.pathname.endsWith('/index.html')) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const response = await fetch(request);
        if (response && response.ok) {
          await cache.put('./index.html', response.clone());
        }
        return response;
      } catch (error) {
        const cached = await cache.match('./index.html') || await cache.match('./');
        if (cached) return cached;
        throw error;
      }
    })());
    return;
  }

  // Cache-first for the app manifest and logo.
  if (url.pathname.endsWith('/manifest.json') || url.pathname.endsWith('/fish-tank-tracker-icon.png')) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response && response.ok) await cache.put(request, response.clone());
      return response;
    })());
  }
});

