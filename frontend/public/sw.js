/*
 * EduOS service worker: app-shell caching only, so the pages that work
 * offline (attendance, lab issue/return, gate and bus scans, sanitation
 * checks, PTM and class check-in) can open without a connection. Their
 * writes are queued by the page itself (src/lib/offline-queue.ts) in
 * IndexedDB, not here.
 *
 * Never cached: anything under /api/ (personal data and sessions), any
 * request that is not a same-origin GET, and any response that is not a
 * plain 200. Built static assets are cache-first (their names change with
 * every build); pages are network-first with the cached shell as fallback.
 */
const CACHE = 'eduos-shell-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('eduos-shell-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch { return; }
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads')) return;

  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok && res.status === 200) cache.put(req, res.clone()).catch(() => {});
      return res;
    })());
    return;
  }

  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const res = await fetch(req);
        if (res.ok && res.status === 200 && !res.headers.get('set-cookie')) cache.put(req, res.clone()).catch(() => {});
        return res;
      } catch {
        const hit = await cache.match(req);
        if (hit) return hit;
        return new Response('<!doctype html><meta charset="utf-8"><title>Offline</title><p style="font-family:sans-serif;padding:24px">You are offline. Open a page you have used before on this device; changes you make there are kept and sent when you are back online.</p>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }
    })());
  }
});
