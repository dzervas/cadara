// The OCC kernel assets' content hash (sha256 of public/cadara-occ.js, then of
// .wasm; test/static/occ-asset-version.spec.ts). Kept free of browser globals
// so the build config can version the kernel's precache URLs with it
// (service-worker-plugin.ts).
export const OCC_ASSET_VERSION =
  "a1fdc7398e061a0007224e3f4183b2d8f5f37afc79dd1b5dabb80472c7bcf36d-09577f544f1e641616159f17e3fd190f26efefc0a1fca67ebef7df9b51124ad6";

// Decoded size of public/cadara-occ.wasm, the total for download progress: the
// served kernel is compressed without a Content-Length (cadara-5hlf).
export const OCC_WASM_BYTE_LENGTH = 17_069_637;
