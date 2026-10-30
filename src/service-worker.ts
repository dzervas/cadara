// The production service worker (vite-plugin-pwa `injectManifest`; builds to
// /service-worker.js). Workbox precaches the build output listed in
// `service-worker-plugin.ts`: HTML entries, every /assets/ chunk (including the
// dedicated worker bundles, which may first be spawned offline), fonts, icons
// and the OCC kernel. Content-addressed assets use their URL as revision;
// mutable HTML/icons carry a content revision. A new deploy therefore
// downloads only the files whose content changed. The new worker then waits
// until the user accepts the update prompt (`registerType: "prompt"`).
import { clientsClaim } from "workbox-core";
import {
  addPlugins,
  cleanupOutdatedCaches,
  matchPrecache,
  precacheAndRoute,
} from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { NetworkOnly } from "workbox-strategies";

import { createServiceWorkerInstallTelemetry } from "./infrastructure/workers/service-worker-install-telemetry";

declare let self: ServiceWorkerGlobalScope;
declare const __CADARA_APP_VERSION__: string;
declare const __CADARA_GIT_COMMIT__: string;

/** The label the update prompt shows for this (waiting) build. */
const BUILD_VERSION_LABEL = `v${__CADARA_APP_VERSION__} ${__CADARA_GIT_COMMIT__}`;

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") void self.skipWaiting();
  if (event.data?.type === "GET_VERSION")
    event.ports[0]?.postMessage(BUILD_VERSION_LABEL);
});

// The first install controls the open page at once (offline right after the
// first full load); updates still wait for SKIP_WAITING.
clientsClaim();
cleanupOutdatedCaches();

// Migration from the pre-Workbox worker (/occ-asset-cache-sw.js, same scope):
// registering this script replaced it in the registration; its caches are
// dropped once this worker activates.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => /^cadara-(?:occ|app)-assets-/.test(name))
            .map((name) => caches.delete(name)),
        ),
      ),
  );
});

// Navigations go to the network first, so an online reload gets the newest
// HTML. Offline, the host's rewrites are mirrored onto the precached HTML:
// /app -> app.html, / -> index.html, any other path -> itself. Registered
// before the precache route, which would otherwise answer /app.html and
// /index.html (cleanURLs/directoryIndex) cache-first.
registerRoute(
  new NavigationRoute(
    new NetworkOnly({
      plugins: [
        {
          handlerDidError: async ({ request }) => {
            const { pathname } = new URL(request.url);
            const shellPath = /^\/app\/?$/.test(pathname)
              ? "/app.html"
              : pathname === "/"
                ? "/index.html"
                : pathname;
            return matchPrecache(shellPath);
          },
        },
      ],
    }),
  ),
);

// Install progress and explicit precache failures reach every window, which
// reports them to Sentry (src/hooks/use-app-update.ts).
addPlugins([
  createServiceWorkerInstallTelemetry(async (diagnostic) => {
    const clients = await self.clients.matchAll({
      type: "window",
      includeUncontrolled: true,
    });
    for (const client of clients) client.postMessage(diagnostic);
  }),
]);
// The kernel entries are its exact versioned URLs
// (/kernels/<content-version>/cadara-occ.{js,wasm}, service-worker-plugin.ts), so
// a request for another version is not answered from this precache.
precacheAndRoute(self.__WB_MANIFEST);
