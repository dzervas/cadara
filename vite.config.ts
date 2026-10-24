import { defineConfig } from "vite";
import { configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import UnpluginTypia from "@typia/unplugin/vite";
import path from "node:path";

import {
  createBuildMetadataDefines,
  readBuildMetadata,
} from "./build-metadata";
import { createTypiaPluginOptions } from "./typia-plugin-options";
import { createServiceWorkerPlugin } from "./service-worker-plugin";

export function getBuildSourcemap(uploadToSentry: boolean) {
  return uploadToSentry ? ("hidden" as const) : false;
}

export function getOpenCascadeAssetHeaders(
  value: string,
): Record<string, string> {
  const pathname = new URL(value, "https://cadara.local").pathname;

  if (!/cadara-occ\.(?:js|wasm)$/.test(pathname)) {
    return {};
  }

  const headers: Record<string, string> = {
    "Cache-Control": "public, max-age=31536000, immutable",
  };

  if (pathname.endsWith(".wasm")) {
    headers["Content-Type"] = "application/wasm";
  }

  return headers;
}

function createOpenCascadeAssetHeadersPlugin() {
  return {
    name: "cadara-opencascade-asset-headers",
    configureServer(server: {
      middlewares: {
        use: (
          middleware: (
            request: { url?: string },
            response: { setHeader: (name: string, value: string) => void },
            next: () => void,
          ) => void,
        ) => void;
      };
    }) {
      server.middlewares.use((request, response, next) => {
        for (const [name, value] of Object.entries(
          getOpenCascadeAssetHeaders(request.url ?? ""),
        )) {
          response.setHeader(name, value);
        }
        next();
      });
    },
    configurePreviewServer(server: {
      middlewares: {
        use: (
          middleware: (
            request: { url?: string },
            response: { setHeader: (name: string, value: string) => void },
            next: () => void,
          ) => void,
        ) => void;
      };
    }) {
      server.middlewares.use((request, response, next) => {
        for (const [name, value] of Object.entries(
          getOpenCascadeAssetHeaders(request.url ?? ""),
        )) {
          response.setHeader(name, value);
        }
        next();
      });
    },
  };
}

const buildMetadata = readBuildMetadata(__dirname);
const shouldUploadSentrySourceMaps = Boolean(
  process.env.SENTRY_AUTH_TOKEN && buildMetadata.sentryRelease,
);

// https://vite.dev/config/
export default defineConfig({
  // The editor route is /app; shared assets remain at the origin root.
  base: "/",
  define: createBuildMetadataDefines(buildMetadata),
  test: {
    // Kernel-limitation specs are expected to fail (docs/testing.md "Kernel
    // limitations"); only vitest.kernel-limitations.config.ts runs them.
    exclude: [
      ...configDefaults.exclude,
      "**/test/kernel-limitations/**",
      ...(process.env.CADARA_VITEST_INCLUDE_SCRATCH === "1"
        ? []
        : ["**/.scratch/**"]),
    ],
    testTimeout: 15_000,
    // Tiers (docs/testing.md "Tiers"): `fast` is the everyday loop and shares
    // one module registry per worker (`isolate: false`); specs whose `vi.mock`
    // factories need a fresh module instance are `*.isolated.spec.ts`; specs
    // that need minutes of OCC/certification work, and the CLI subprocess
    // specs, are `heavy` and run only in the final pass.
    projects: [
      {
        extends: true,
        test: {
          name: "fast",
          isolate: false,
          include: ["src/**/*.spec.{ts,tsx}", "test/**/*.spec.ts"],
          exclude: [
            "**/*.heavy.spec.*",
            "**/*.isolated.spec.*",
            "**/src/cli/**",
          ],
        },
      },
      {
        extends: true,
        test: {
          name: "isolated",
          include: [
            "src/**/*.isolated.spec.{ts,tsx}",
            "test/**/*.isolated.spec.ts",
          ],
        },
      },
      {
        extends: true,
        test: {
          name: "heavy",
          include: [
            "src/**/*.heavy.spec.{ts,tsx}",
            "test/**/*.heavy.spec.ts",
            "src/cli/**/*.spec.ts",
          ],
          globalSetup: ["./test/helpers/cli-bundle-global-setup.ts"],
        },
      },
    ],
  },
  worker: {
    plugins: () => [UnpluginTypia(createTypiaPluginOptions(__dirname))],
  },
  plugins: [
    createOpenCascadeAssetHeadersPlugin(),
    createServiceWorkerPlugin(path.resolve(__dirname, "src")),
    UnpluginTypia(createTypiaPluginOptions(__dirname)),
    react(),
    tailwindcss(),
    sentryVitePlugin({
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      disable: !shouldUploadSentrySourceMaps,
      sourcemaps: {
        filesToDeleteAfterUpload: ["dist/**/*.map"],
      },
      release: {
        name: buildMetadata.sentryRelease ?? undefined,
        dist: buildMetadata.sentryDist ?? undefined,
        inject: true,
        create: true,
        finalize: true,
        setCommits: {
          auto: true,
          ignoreMissing: true,
        },
        deploy: {
          env: buildMetadata.sentryEnvironment,
          url: process.env.CF_PAGES_URL,
        },
      },
    }),
  ],
  assetsInclude: ["**/*.wasm"],
  resolve: {
    alias: [
      {
        find: "@",
        replacement: path.resolve(__dirname, "./src"),
      },
      {
        find: /^@automerge\/automerge$/,
        replacement: path.resolve(
          __dirname,
          "./node_modules/@automerge/automerge/dist/mjs/entrypoints/fullfat_base64.js",
        ),
      },
    ],
  },
  optimizeDeps: {
    // Pre-scan worker entrypoints up front so Vite does not discover their
    // package dependencies after the browser session has already started.
    entries: [
      "index.html",
      "app.html",
      "404.html",
      "src/infrastructure/workers/document-sync.worker.ts",
      "src/domain/modeling/occ/worker.ts",
      "src/domain/modeling/occ/sketch-derivation.worker.ts",
    ],
    // Typia's generated validators import these runtime helpers from deep
    // package paths after the transformer runs. Include them explicitly so
    // the dev server does not trigger a dependency-optimization reload during
    // Playwright startup.
    include: [
      "typia/lib/internal/_accessExpressionAsString",
      "typia/lib/internal/_createStandardSchema",
      "typia/lib/internal/_validateReport",
    ],
    // The browser OCC runtime is served from /public as a versioned custom
    // asset pair and should not be pulled into dependency optimization.
    exclude: [
      "opencascade.js",
      "opencascade.js/dist/node.js",
      "opencascade.js/dist/opencascade.full",
    ],
  },
  build: {
    sourcemap: getBuildSourcemap(shouldUploadSentrySourceMaps),
    reportCompressedSize: false,
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      input: {
        landing: path.resolve(__dirname, "index.html"),
        editor: path.resolve(__dirname, "app.html"),
        notFound: path.resolve(__dirname, "404.html"),
      },
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) {
            return undefined;
          }

          if (id.includes("/three/")) {
            return "three";
          }

          if (id.includes("/@radix-ui/")) {
            return "radix";
          }

          if (id.includes("/react/") || id.includes("/react-dom/")) {
            return "react-vendor";
          }

          return "vendor";
        },
      },
    },
  },
  server: {
    host: "0.0.0.0",
    port: 3000,
    allowedHosts: ["frontend"],
    watch: {
      ignored: [
        "/e2e/**",
        "/tmp-*",
        "/.tmp*",
        "**/Dockerfile*",
        "**/.*",
        "/openspec/**",
        "**/*.spec.ts",
        "**/*.cadara",
      ],
    },
  },
});
