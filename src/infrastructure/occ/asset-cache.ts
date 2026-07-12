import { OCC_ASSET_VERSION } from "@/domain/modeling/occ/assets";

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

export function getOpenCascadeServiceWorkerUrl() {
  return `${OCC_SERVICE_WORKER_PATH}?v=${encodeURIComponent(OCC_ASSET_VERSION)}`;
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
    getOpenCascadeServiceWorkerUrl(),
    getOpenCascadeServiceWorkerRegistrationOptions(),
  );
}
