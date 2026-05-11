const OCC_ASSET_CACHE_VERSION =
  new URL(self.location.href).searchParams.get("v") || "unversioned";
const OCC_ASSET_CACHE_NAME = `cadara-occ-assets-opencascade-2.0.0-beta.b5ff984-${OCC_ASSET_CACHE_VERSION}`;

function isOpenCascadeAssetUrl(url) {
  return /cadara-occ\.(?:js|wasm)$/.test(new URL(url).pathname);
}

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames
          .filter(
            (name) =>
              name.startsWith("cadara-occ-assets-") &&
              name !== OCC_ASSET_CACHE_NAME,
          )
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  if (
    event.request.method !== "GET" ||
    !isOpenCascadeAssetUrl(event.request.url)
  ) {
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(OCC_ASSET_CACHE_NAME);
      const cached = await cache.match(event.request);
      if (cached) {
        return cached;
      }

      const response = await fetch(event.request);
      if (response.ok) {
        await cache.put(event.request, response.clone());
      }
      return response;
    })(),
  );
});
