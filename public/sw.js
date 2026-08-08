/* Browser extensions / PWA probes request /sw.js — serve a no-op instead of a slow 404 compile. */
self.addEventListener('install', (event) => {
  self.skipWaiting();
});
