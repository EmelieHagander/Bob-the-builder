// Bob needs internet. Only this public, self-contained connection page is
// cached. Never cache app documents, API/auth requests, images or user data.
const APP_BASE = new URL(self.registration.scope);
const CACHE_PREFIX = `bob-connection-${encodeURIComponent(APP_BASE.pathname)}-`;
const CACHE_NAME = `${CACHE_PREFIX}v1`;
const OFFLINE_URL = new URL('offline.html', APP_BASE).href;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.add(OFFLINE_URL)));
  // No skipWaiting: updates wait until the old app windows are closed.
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) => Promise.all(
      names.filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
        .map((name) => caches.delete(name)),
    )).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || request.mode !== 'navigate' ||
      url.origin !== APP_BASE.origin || !url.pathname.startsWith(APP_BASE.pathname) ||
      request.headers.has('Authorization')) return;

  const path = url.pathname.slice(APP_BASE.pathname.length);
  // Auth callbacks always reach the network untouched, including callbacks
  // using the root route. Never queue writes or replay any failed request.
  if (/^(api|auth|rest|functions|storage)(\/|$)/.test(path) ||
      [...url.searchParams.keys()].some((key) => /^(code|token|token_hash|access_token|refresh_token|error|error_description)$/.test(key))) return;

  event.respondWith(fetch(request).catch(async () => {
    const cache = await caches.open(CACHE_NAME);
    return (await cache.match(OFFLINE_URL)) || Response.error();
  }));
});
