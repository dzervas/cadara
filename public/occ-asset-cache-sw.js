const OCC_ASSET_CACHE_VERSION =
  new URL(self.location.href).searchParams.get("v") || "unversioned";
const OCC_ASSET_CACHE_NAME = `cadara-occ-assets-opencascade-2.0.0-beta.b5ff984-${OCC_ASSET_CACHE_VERSION}`;

// The production build fills this from its actual output, including HTML,
// fonts and public icons. Its content digest changes this script and cache
// identity even when the OCC version and worker bundle URLs stay unchanged.
const APP_SHELL_PRECACHE = /* APP_SHELL_PRECACHE */ null;
// Keep accepting the content-hashed worker URLs from the registration URL.
// Deduplicate them against the generated shell list: cache.addAll rejects
// duplicate requests. Workers first spawned offline still load cache-first.
const APP_ASSET_PATHS = [
  ...new Set([
    ...(APP_SHELL_PRECACHE?.paths || []),
    ...(new URL(self.location.href).searchParams.get("precache") || "")
      .split(",")
      .filter((path) => /^\/assets\/[^/]+$/.test(path)),
  ]),
];
const APP_ASSET_CACHE_NAME = `cadara-app-assets-${APP_SHELL_PRECACHE?.version || APP_ASSET_PATHS.join(",")}`;

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
  // These same-origin build/kernel files have one representation. Preview
  // hosts may send Vary: Origin: install-time fetches lack the Origin header
  // that module/worker requests carry, but must still hit the precache.
  const cached = await cache.match(request, { ignoreVary: true });
  if (cached) {
    return cached;
  }

  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
  }
  return response;
}

// Editor URLs are rewritten to app.html by the host. Cache the canonical
// HTML at install so /app (including a first offline navigation) can boot.
async function navigationNetworkFirst(request) {
  try {
    return await fetch(request);
  } catch (error) {
    const pathname = new URL(request.url).pathname;
    const shellPath = /^\/app\/?$/.test(pathname)
      ? "/app.html"
      : pathname === "/"
        ? "/index.html"
        : pathname;
    const cache = await caches.open(APP_ASSET_CACHE_NAME);
    const cached = await cache.match(shellPath);
    if (cached) return cached;
    throw error;
  }
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  if (
    APP_SHELL_PRECACHE &&
    event.request.mode === "navigate" &&
    new URL(event.request.url).origin === self.location.origin
  ) {
    event.respondWith(navigationNetworkFirst(event.request));
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
