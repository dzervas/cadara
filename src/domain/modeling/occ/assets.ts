export const OCC_ASSET_VERSION =
  "081eaf71df8dbc0b811a243e94aadf8030068e7b28f61baf686e2fdd965a5989-ffcf7fd094d1ac27c4be3dd32fc6b19a43efbf32c312cd51441aa85a48fd7573";

const CUSTOM_OPENCASCADE_ASSET_PATHS = {
  mainJS: "/cadara-occ.js",
  mainWasm: "/cadara-occ.wasm",
} as const;

function getRuntimeAbsoluteAssetUrl(path: string) {
  const locationLike = globalThis.location;

  if (locationLike?.origin) {
    return new URL(path, locationLike.origin).href;
  }

  return path;
}

export function getVersionedOpenCascadeAssetUrl(path: string) {
  const assetUrl = new URL(
    getRuntimeAbsoluteAssetUrl(path),
    globalThis.location?.origin ?? "https://cadara.local",
  );
  assetUrl.searchParams.set("v", OCC_ASSET_VERSION);
  return assetUrl.href;
}

export function getVersionedOpenCascadeRuntimeAssetUrls() {
  return {
    mainJS: getVersionedOpenCascadeAssetUrl(CUSTOM_OPENCASCADE_ASSET_PATHS.mainJS),
    mainWasm: getVersionedOpenCascadeAssetUrl(CUSTOM_OPENCASCADE_ASSET_PATHS.mainWasm),
  };
}
