export const OCC_ASSET_VERSION =
  "bbf678650ca7ea7d8f7a9e35e19f1fd14bf1553db2aedb2e64bda263e52843b2-dcfaa219494850ced274138912126a138728b9a529095a069ef01d8d43b681a7";

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
