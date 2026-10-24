export const OCC_ASSET_VERSION =
  "37acb2fba53ea0334c068bf83481df25ae68e507f5e784902f89f29593a6dd91-4a178cba5a8575576111c0b9a5d5f2e03516eda085422de451926bc34a9e386f";

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
