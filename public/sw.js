/* Golf OS service worker.
 * - App pages a golfer has opened (bookings, scorecards, courses, profile) are cached as they load,
 *   so the scorecard opens with no signal on the course. Scores entered offline are already queued
 *   by the scorecard and sent when the connection returns.
 * - Build assets are immutable and served cache-first.
 * - Nothing else is cached: no payments, admin, caddie or API traffic.
 */
const VERSION = "v1";
const PAGES = `golfos-pages-${VERSION}`;
const ASSETS = `golfos-assets-${VERSION}`;
const OFFLINE_URL = "/offline.html";
const CACHEABLE_PAGES = [/^\/rounds\/[^/]+\/score$/, /^\/bookings(\/[^/]+)?$/, /^\/courses(\/.*)?$/, /^\/golfers\/[^/]+$/];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(ASSETS)
      .then((cache) => cache.addAll([OFFLINE_URL, "/icons/icon-192.png"]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("golfos-") && k !== PAGES && k !== ASSETS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  // Sent on sign-out so the next person on this phone cannot read cached pages.
  if (event.data === "clear-pages") event.waitUntil(caches.delete(PAGES));
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(ASSETS).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
    return;
  }

  if (request.mode !== "navigate") return;
  const cacheable = CACHEABLE_PAGES.some((pattern) => pattern.test(url.pathname));
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (cacheable && response.ok && !response.redirected) {
          const copy = response.clone();
          caches.open(PAGES).then((cache) => cache.put(url.pathname + url.search, copy));
        }
        return response;
      })
      .catch(async () => {
        const hit = (await caches.match(url.pathname + url.search, { cacheName: PAGES })) || (await caches.match(url.pathname, { cacheName: PAGES, ignoreSearch: true }));
        return hit || (await caches.match(OFFLINE_URL)) || Response.error();
      }),
  );
});
