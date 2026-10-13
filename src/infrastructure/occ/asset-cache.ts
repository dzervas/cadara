import { OCC_ASSET_VERSION } from "@/domain/modeling/occ/assets";
import occWorkerUrl from "@/domain/modeling/occ/worker.ts?worker&url";
import sketchDerivationWorkerUrl from "@/domain/modeling/occ/sketch-derivation.worker.ts?worker&url";
import documentSyncWorkerUrl from "@/infrastructure/workers/document-sync.worker.ts?worker&url";

const OPENCASCADE_PACKAGE_VERSION = "2.0.0-beta.b5ff984";

export const OCC_ASSET_CACHE_NAME = `cadara-occ-assets-opencascade-${OPENCASCADE_PACKAGE_VERSION}-${OCC_ASSET_VERSION}`;
export const OCC_SERVICE_WORKER_PATH = "/occ-asset-cache-sw.js";

export function isOpenCascadeAssetUrl(value: string) {
  let pathname: string;

  try {
    pathname = new URL(value, "https://cadara.local").pathname;
  } catch {
    pathname = value;
  }

  return /cadara-occ\.(?:js|wasm)$/.test(pathname);
}

export function getOpenCascadeAssetHeaders(pathname: string) {
  if (!isOpenCascadeAssetUrl(pathname)) {
    return {};
  }

  return {
    ...(pathname.endsWith(".wasm")
      ? { "Content-Type": "application/wasm" }
      : {}),
    "Cache-Control": "public, max-age=31536000, immutable",
  };
}

export function getOpenCascadeServiceWorkerRegistrationOptions() {
  return {
    scope: "/",
  };
}

export function getOpenCascadeServiceWorkerVersion() {
  return OCC_ASSET_VERSION;
}

/**
 * The built (content-hashed) bundles of the app's dedicated workers, as the
 * build emits them. A worker may first be spawned after the network is gone
 * (a new or opened document's derivation worker), and hosts serve these
 * files `no-cache`, so the service worker precaches them when the app loads
 * and serves them cache-first. They import no other chunk.
 */
export const APP_WORKER_ASSET_URLS: readonly string[] = [
  occWorkerUrl,
  sketchDerivationWorkerUrl,
  documentSyncWorkerUrl,
];

/**
 * The registration URL carries both caches' identity: the OCC artifact
 * version (`v`) and the worker bundles to precache (`precache`, comma
 * separated; the app registers `APP_WORKER_ASSET_URLS`). A build with other
 * worker hashes registers a new script URL, so the browser installs it
 * (precaching the new bundles) and its activation drops the old bundles'
 * cache.
 */
export function getOpenCascadeServiceWorkerUrl(
  precacheUrls: readonly string[] = [],
) {
  const search = new URLSearchParams({ v: OCC_ASSET_VERSION });
  if (precacheUrls.length > 0) search.set("precache", precacheUrls.join(","));
  return `${OCC_SERVICE_WORKER_PATH}?${search}`;
}

export async function registerOpenCascadeAssetCache(
  navigatorLike: Pick<Navigator, "serviceWorker"> | null = typeof navigator ===
  "undefined"
    ? null
    : navigator,
) {
  if (!navigatorLike || !("serviceWorker" in navigatorLike)) {
    return null;
  }

  return navigatorLike.serviceWorker.register(
    getOpenCascadeServiceWorkerUrl(APP_WORKER_ASSET_URLS),
    getOpenCascadeServiceWorkerRegistrationOptions(),
  );
}
