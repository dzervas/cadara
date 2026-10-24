// The OCC kernel assets' content hash (sha256 of public/cadara-occ.js, then of
// .wasm; test/static/occ-asset-version.spec.ts). Kept free of browser globals
// so the build config can version the kernel's precache URLs with it
// (service-worker-plugin.ts).
export const OCC_ASSET_VERSION =
  "37acb2fba53ea0334c068bf83481df25ae68e507f5e784902f89f29593a6dd91-4a178cba5a8575576111c0b9a5d5f2e03516eda085422de451926bc34a9e386f";
