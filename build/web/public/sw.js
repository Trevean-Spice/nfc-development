/*
 * Service worker. Registered after the load event, never before.
 *
 * It exists for one acceptance criterion: a graceful branded error if the
 * network is unavailable, never a blank screen (Acceptance criteria, section
 * 6.3). Without it, a customer who taps a jar with no signal gets the browser's
 * own network error page.
 *
 * It is deliberately not a full offline-first shell. The blend page is served
 * from the edge cache and the whole point of decision D2 is that a tap is a
 * cache hit on a file. A worker that starts intercepting and re-serving that
 * file adds a way for a customer to be shown a stale story after a publish, so
 * navigations go to the network first and the cache is only a fallback.
 */

const CACHE = 'trevean-v1';
const OFFLINE = '/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll([OFFLINE]))
      .then(() => self.skipWaiting())
      .catch(() => undefined),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
      .catch(() => undefined),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  if (request.mode !== 'navigate') return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        // Keep the last good copy of whatever the customer actually opened, so
        // an offline repeat visit shows the blend rather than the apology.
        if (response && response.ok) {
          const copy = response.clone();
          caches
            .open(CACHE)
            .then((cache) => cache.put(request, copy))
            .catch(() => undefined);
        }
        return response;
      })
      .catch(() =>
        caches
          .match(request)
          .then((hit) => hit || caches.match(OFFLINE))
          .then((hit) => hit || Response.error()),
      ),
  );
});
