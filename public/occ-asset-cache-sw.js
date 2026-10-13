const OCC_ASSET_CACHE_VERSION =
  new URL(self.location.href).searchParams.get("v") || "unversioned";
const OCC_ASSET_CACHE_NAME = `cadara-occ-assets-opencascade-2.0.0-beta.b5ff984-${OCC_ASSET_CACHE_VERSION}`;

// The app's content-hashed worker bundles (`APP_WORKER_ASSET_URLS` in
// `src/infrastructure/occ/asset-cache.ts`), passed in the registration URL.
// They are precached at install, so a worker first spawned after the network
// is gone still loads, and served cache-first. Only same-origin `/assets/`
// files qualify. The cache is named after the list: a build with other
// hashes registers a new script URL, and its activation drops the old cache.
const APP_ASSET_PATHS = (
  new URL(self.location.href).searchParams.get("precache") || ""
)
  .split(",")
  .filter((path) => /^\/assets\/[^/]+$/.test(path));
const APP_ASSET_CACHE_NAME = `cadara-app-assets-${APP_ASSET_PATHS.join(",")}`;

// The kernel runtime as the app requests it (`getVersionedOpenCascadeAssetUrl`
// in `src/domain/modeling/occ/assets.ts`: the path plus the same `v`). It is
// precached at install too: during the first session the page's kernel
// worker loads it before this worker controls the page, so the fetch-time
// cache below never sees it, and a worker spawned offline would need it.
const OCC_ASSET_PRECACHE_URLS = new URL(self.location.href).searchParams.has(
  "v",
)
  ? ["/cadara-occ.js", "/cadara-occ.wasm"].map((path) => {
      const url = new URL(path, self.location.origin);
      url.searchParams.set("v", OCC_ASSET_CACHE_VERSION);
      return url.href;
    })
  : [];

function isOpenCascadeAssetUrl(url) {
  return /cadara-occ\.(?:js|wasm)$/.test(new URL(url).pathname);
}

function isPrecachedAppAssetUrl(url) {
  const parsed = new URL(url);
  return (
    parsed.origin === self.location.origin &&
    APP_ASSET_PATHS.includes(parsed.pathname)
  );
}

/** Adds the kernel URLs the OCC cache lacks (one download per version). */
async function precacheOpenCascadeAssets() {
  const cache = await caches.open(OCC_ASSET_CACHE_NAME);
  for (const url of OCC_ASSET_PRECACHE_URLS) {
    if (!(await cache.match(url))) {
      await cache.add(url);
    }
  }
}

// A failed precache fails the install (the browser retries at the next
// registration): an active worker without these files would leave the
// offline gap silent.
self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    Promise.all([
      precacheOpenCascadeAssets(),
      APP_ASSET_PATHS.length === 0
        ? null
        : caches
            .open(APP_ASSET_CACHE_NAME)
            .then((cache) => cache.addAll(APP_ASSET_PATHS)),
    ]),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames
          .filter(
            (name) =>
              (name.startsWith("cadara-occ-assets-") &&
                name !== OCC_ASSET_CACHE_NAME) ||
              (name.startsWith("cadara-app-assets-") &&
                name !== APP_ASSET_CACHE_NAME),
          )
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

async function cacheFirst(cacheName, request) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) {
    return cached;
  }

  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  if (isOpenCascadeAssetUrl(event.request.url)) {
    event.respondWith(cacheFirst(OCC_ASSET_CACHE_NAME, event.request));
    return;
  }

  if (isPrecachedAppAssetUrl(event.request.url)) {
    event.respondWith(cacheFirst(APP_ASSET_CACHE_NAME, event.request));
  }
});
