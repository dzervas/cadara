// The OCC kernel assets' content hash (sha256 of public/cadara-occ.js, then of
// .wasm; test/static/occ-asset-version.spec.ts). Kept free of browser globals
// so the build config can version the kernel's precache URLs with it
// (service-worker-plugin.ts).
export const OCC_ASSET_VERSION =
  "ff0254c174227c6b5a6ad56848a275c70bd2affa07d75587ddeee8d8d5fbd998-c2e84ab815656f3bcef5a54c2d8514acff98e0e2594b0448229d37457b30c7b0";

// Each deployment publishes exactly this kernel directory; older versions
// remain available only in already-installed clients' offline caches.
export const OCC_ASSET_BASE_PATH = `/kernels/${OCC_ASSET_VERSION}`;

// Decoded size of public/cadara-occ.wasm, the total for download progress: the
// served kernel is compressed without a Content-Length (cadara-5hlf).
export const OCC_WASM_BYTE_LENGTH = 17_125_172;
