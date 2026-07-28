export const OCC_ASSET_VERSION =
  "fe40f6cdb36005f3d746aa2f893136bc280f1ced6f03a325d78a279a0e352c54-206fe898a684c6322a69eb892b0ff207cc2deb3815a219bf432be0307e439368";

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
