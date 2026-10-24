import { VitePWA } from "vite-plugin-pwa";

import { OCC_ASSET_VERSION } from "./src/domain/modeling/occ/asset-version";

const occKernelFilePattern = /(?:^|\/)cadara-occ\.(?:js|wasm)$/;

/**
 * The production service worker (`src/service-worker.ts`, vite-plugin-pwa
 * `injectManifest`; builds to /service-worker.js). Production only: the dev
 * server serves no service worker. The app registers it through
 * `virtual:pwa-register/react` (src/hooks/use-app-update.ts); the web app
 * manifest is cadara-h13. `srcDir` holds service-worker.ts.
 */
export function createServiceWorkerPlugin(srcDir: string) {
  return VitePWA({
    strategies: "injectManifest",
    srcDir,
    filename: "service-worker.ts",
    registerType: "prompt",
    injectRegister: false,
    manifest: false,
    injectManifest: {
      // The whole offline app shell: HTML entries, every emitted asset
      // (chunks, worker bundles, fonts), public icons and the OCC kernel.
      globPatterns: [
        "*.html",
        "assets/**/*",
        "**/*.{svg,png,ico,woff,woff2,ttf,otf}",
        "cadara-occ.{js,wasm}",
      ],
      globIgnores: ["**/*.map"],
      // cadara-occ.wasm is about 17 MB.
      maximumFileSizeToCacheInBytes: 64 * 1024 * 1024,
      manifestTransforms: [
        // The app requests the kernel as /cadara-occ.{js,wasm}?v=<version>
        // (`getVersionedOpenCascadeAssetUrl`), so it is precached under that
        // exact URL: a worker still active after a deploy then misses for the
        // new version's URL and the page gets the new kernel from the network,
        // never the old one. The version is the content hash
        // (test/static/occ-asset-version.spec.ts), so the URL is the revision;
        // revision null also lets the install reuse the HTTP-cached download.
        async (entries) => ({
          manifest: entries.map((entry) =>
            occKernelFilePattern.test(entry.url)
              ? {
                  ...entry,
                  url: `${entry.url}?v=${OCC_ASSET_VERSION}`,
                  revision: null,
                }
              : entry,
          ),
          warnings: [],
        }),
      ],
    },
  });
}
