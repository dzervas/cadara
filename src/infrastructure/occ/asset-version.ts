// The OCC kernel assets' content hash (sha256 of public/cadara-occ.js, then of
// .wasm; test/static/occ-asset-version.spec.ts). Kept free of browser globals
// so the build config can version the kernel's precache URLs with it
// (service-worker-plugin.ts).
export const OCC_ASSET_VERSION =
  "54348f82ec4e50448964febd9f72a7eb555095f0c9d524b621ad42485eaf774d-84c9c25c168b94a2ef85c2681f27dca35c7bdbe61862f884334634773b636587";

// Each deployment publishes exactly this kernel directory; older versions
// remain available only in already-installed clients' offline caches.
export const OCC_ASSET_BASE_PATH = `/kernels/${OCC_ASSET_VERSION}`;

// Decoded size of public/cadara-occ.wasm, the total for download progress: the
// served kernel is compressed without a Content-Length (cadara-5hlf).
export const OCC_WASM_BYTE_LENGTH = 17_087_048;
