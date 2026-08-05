/* Pipe Laying — app-shell service worker.
 *
 * Purpose: let the app OPEN with no connection. Field crews start their phone in
 * a trench with no signal; without this the WebView has nothing to load and the
 * offline outbox is unreachable.
 *
 * Served from the site root (/plm-sw.js, via the app's www/ folder) but
 * registered with the NARROW scope /pipe-laying/. A script at the root may claim
 * any narrower scope, and narrowing keeps this worker from colliding with other
 * apps on the bench that register their own root-scoped worker.
 *
 * Deliberately NOT cached here: /api/method/*. Those responses are owned by the
 * IndexedDB layer, which knows what is stale and what is still queued. An HTTP
 * cache answering them would hand a field user yesterday's card list with no way
 * to tell the difference.
 */

// Bump this to purge every client's cache on the next launch. The activate
// handler deletes any cache whose name doesn't match.
const CACHE = 'plm-shell-v2';
const ASSET_PREFIX = '/assets/pipe_laying_inhouse/plm/';
const APP_PREFIX = '/pipe-laying';
const SHELL_URL = '/pipe-laying/m';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // Only the shell is pre-cached. The bundle is fetched with a ?v=<build>
      // stamp, so pre-fetching it unstamped would just download it twice.
      .then((cache) => cache.add(SHELL_URL).catch(() => undefined))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;

  // Never touch anything that talks to Frappe, or any page outside this app.
  if (url.pathname.startsWith('/api/')) return;

  const isAppNavigation =
    request.mode === 'navigate' && url.pathname.startsWith(APP_PREFIX);

  // Navigations INTO the app: network first so a fresh deploy and a live session
  // win, cached shell as the offline fallback.
  if (isAppNavigation) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            // Store under the canonical key so the ?v= stamp on a redeploy
            // doesn't orphan the fallback.
            caches.open(CACHE).then((cache) => cache.put(SHELL_URL, copy));
          }
          return response;
        })
        .catch(() =>
          caches.match(SHELL_URL).then(
            (cached) =>
              cached ??
              new Response(
                '<!doctype html><meta charset=utf-8><body style="font-family:system-ui;padding:2rem">' +
                  '<h3>Pipe Laying</h3><p>Offline, and this phone has no cached copy of the app yet. ' +
                  'Open the app once with a connection.</p>',
                { status: 503, headers: { 'Content-Type': 'text/html' } },
              ),
          ),
        ),
    );
    return;
  }

  // Bundle assets: cache-first on the EXACT url, including the ?v=<build>
  // stamp.
  //
  // Matching exactly (not ignoreSearch) is what makes the stamp work: a new
  // deploy changes the query, so it misses the cache and is fetched fresh, while
  // an unchanged build keeps hitting cache and stays instant offline. Matching
  // loosely would serve the previous bundle forever and silently un-deploy every
  // fix.
  if (url.pathname.startsWith(ASSET_PREFIX)) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;

        try {
          const response = await fetch(request);
          if (response && response.ok) {
            await cache.put(request, response.clone());
            // Drop older stamps of this same file so the cache doesn't grow a
            // copy per deploy.
            for (const key of await cache.keys()) {
              const keyUrl = new URL(key.url);
              if (keyUrl.pathname === url.pathname && keyUrl.search !== url.search) {
                await cache.delete(key);
              }
            }
          }
          return response;
        } catch {
          // Offline and not cached under this stamp: fall back to any stamp we
          // do have, so the app still opens with the previous bundle.
          const anyStamp = await cache.match(request, { ignoreSearch: true });
          if (anyStamp) return anyStamp;
          throw new Error('offline and uncached');
        }
      }),
    );
  }

  // Everything else on the origin: untouched.
});
