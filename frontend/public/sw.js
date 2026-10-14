/*
 * EduOS AI service worker.
 *
 * It does one thing: when a page cannot be loaded because the device is
 * offline, it shows a branded "You're offline" page instead of the browser's
 * own error. That is what makes the installed app feel like an app rather
 * than a website that broke.
 *
 * It deliberately caches nothing else:
 *
 *   - No pages and no API responses. School records must never be read from a
 *     copy on the device: they go stale, and on a shared phone they would
 *     outlive the sign-out of the person they belong to.
 *   - No scripts or styles. A new deployment is live on the next load, exactly
 *     as it is for the website today, so a release never needs a cache bust.
 *
 * Requests it does not handle (everything except a page load that fails) go to
 * the network untouched, as if there were no service worker.
 *
 * To retire it, deploy a version whose install step calls
 * self.registration.unregister(); browsers check this file on every visit.
 */
const VERSION = 'v1';
const CACHE = `eduos-offline-${VERSION}`;
const OFFLINE_URL = '/offline.html';
const PRECACHE = [OFFLINE_URL, '/icons/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key.startsWith('eduos-offline-') && key !== CACHE).map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  // Only full page loads on this site. API calls, scripts, images and anything
  // on another origin (the API, Razorpay, Google) are left alone.
  if (request.method !== 'GET' || request.mode !== 'navigate') return;
  if (new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(request).catch(async () => (await caches.match(OFFLINE_URL)) ?? Response.error()),
  );
});
