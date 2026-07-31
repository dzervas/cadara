export const OCC_ASSET_VERSION =
  "6b4a9a0ff61cedf0d05a89846f152f50f3b0c14990e1fc27e5d37fd62acc53f1-090183e50960a19165542c198571bccf22cd07ff9812bc1a706323e338eb516a";

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
