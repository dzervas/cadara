import { readFile, rm } from "node:fs/promises";
import path from "node:path";

import { minimal2023Preset } from "@vite-pwa/assets-generator/config";
import type { Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";

import { OCC_ASSET_BASE_PATH } from "./src/infrastructure/occ/asset-version.ts";
import { workbenchColors } from "./src/theme/workbench-theme.ts";

/** The dark shell surface (`--workbench-app-background`, dark-9). */
const shellColor = workbenchColors[9];

// 200 sequential requests cost 60 s at 300 ms RTT, leaving four minutes of
// the browser's five-minute install budget for transfer and cache writes.
const MAX_INSTALL_REQUESTS = 200;

/** Publish one content-addressed kernel, never copies of previous versions. */
function versionedKernelPlugin(): Plugin {
  let root: string;
  let publicDir: string;
  return {
    name: "versioned-occ-kernel",
    configResolved(config) {
      root = config.root;
      publicDir = config.publicDir;
    },
    configureServer(server) {
      server.middlewares.use((request, _response, next) => {
        if (request.url?.startsWith(`${OCC_ASSET_BASE_PATH}/`))
          request.url = request.url.replace(OCC_ASSET_BASE_PATH, "");
        next();
      });
    },
    async generateBundle() {
      for (const extension of ["js", "wasm"]) {
        const name = `cadara-occ.${extension}`;
        const source = await readFile(path.join(publicDir, name));
        if (source.byteLength > 25 * 1024 * 1024)
          this.error(`${name} exceeds Workers' 25 MiB per-file limit.`);
        this.emitFile({
          type: "asset",
          fileName: `${OCC_ASSET_BASE_PATH.slice(1)}/${name}`,
          source,
        });
      }
    },
    async writeBundle(options) {
      // Vite also copies publicDir. Keep the source files there for Node/CLI
      // loaders, but deploy only the content-addressed browser URLs.
      for (const extension of ["js", "wasm"])
        await rm(path.resolve(root, options.dir!, `cadara-occ.${extension}`), {
          force: true,
        });
    },
  };
}

/**
 * The installable PWA: the production service worker (`src/service-worker.ts`,
 * vite-plugin-pwa `injectManifest`; builds to /service-worker.js), the
 * versioned kernel it precaches and the web app manifest
 * (/manifest.webmanifest, linked from every HTML entry). Production only: the
 * dev server serves no service worker. The app registers it through
 * `virtual:pwa-register/react` (src/hooks/use-app-update.ts). `srcDir` holds
 * service-worker.ts. The whole offline application installs atomically;
 * runtime caching is not offline readiness.
 *
 * The manifest icons, favicon.ico and the apple-touch icon are generated at
 * build time from public/favicon.svg by `pwaAssets`
 * (@vite-pwa/assets-generator), which also injects their `<link>`s and the
 * theme-color `<meta>` into the HTML; nothing generated is committed.
 */
export function createServiceWorkerPlugin(srcDir: string) {
  return [
    versionedKernelPlugin(),
    VitePWA({
      strategies: "injectManifest",
      srcDir,
      filename: "service-worker.ts",
      registerType: "prompt",
      injectRegister: false,
      manifest: {
        id: "/app",
        name: "CADara",
        short_name: "CADara",
        description:
          "Open-source parametric CAD in your browser. Work offline and script your modeling workflow with the CLI.",
        // The landing page and the editor share the origin root.
        scope: "/",
        start_url: "/app",
        display: "standalone",
        theme_color: shellColor,
        background_color: shellColor,
        // Opening a .cadara file from the operating system hands it to the
        // app's launch queue (src/workbench/adapters/use-launched-document-files.ts);
        // import formats are not registered. No launch_handler: the default
        // opens a new /app window, which always consumes the launch; focusing
        // an existing window could hand the file to a dashboard or landing
        // window, which has no consumer.
        file_handlers: [
          {
            action: "/app",
            accept: { "application/vnd.cadara+json": [".cadara"] },
          },
        ],
      },
      // The image is the default public/favicon.svg.
      pwaAssets: {
        // The upstream preset, with the opaque (maskable, apple-touch) icons
        // on the shell colour instead of white.
        preset: {
          ...minimal2023Preset,
          maskable: {
            ...minimal2023Preset.maskable,
            resizeOptions: { background: shellColor },
          },
          apple: {
            ...minimal2023Preset.apple,
            resizeOptions: { background: shellColor },
          },
        },
      },
      injectManifest: {
        globPatterns: [
          "*.html",
          "assets/**/*",
          "**/*.{svg,png,ico,woff,woff2,ttf,otf}",
          "kernels/**/*.{js,wasm}",
        ],
        globIgnores: ["**/*.map"],
        // Workers static assets allow at most 25 MiB per file.
        maximumFileSizeToCacheInBytes: 25 * 1024 * 1024,
        manifestTransforms: [
          async (entries) => {
            if (entries.length > MAX_INSTALL_REQUESTS)
              throw new Error(
                `Offline install has ${entries.length} requests; budget is ${MAX_INSTALL_REQUESTS}. Bundle resources rather than expanding the sequential install.`,
              );
            return {
              // Vite assets and the kernel already have content-addressed URLs.
              // Null revisions preserve the page's URL and normal HTTP-cache
              // semantics instead of Workbox's revisioned reload requests.
              manifest: entries.map((entry) =>
                /^(?:assets|kernels)\//.test(entry.url)
                  ? { ...entry, revision: null }
                  : entry,
              ),
              warnings: [],
            };
          },
        ],
      },
    }),
  ];
}
