import { Buffer } from "node:buffer";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import UnpluginTypia from "@typia/unplugin/vite";
import { defineConfig, type Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";

import {
  createBuildMetadataDefines,
  readBuildMetadata,
} from "./build-metadata";
import { createTypiaPluginOptions } from "./typia-plugin-options";

const rootDir = fileURLToPath(new URL(".", import.meta.url));
const buildMetadata = readBuildMetadata(rootDir);
const singleHtmlFileName = "cadara-single.html";
const wasmDataUrlPattern =
  /(['"`])data:application\/wasm;base64,[A-Za-z0-9+/=]+\1/;

function assetSourceToString(source: string | Uint8Array) {
  return typeof source === "string"
    ? source
    : Buffer.from(source).toString("utf8");
}

function svgToDataUrl(svg: string) {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function escapeInlineScript(source: string) {
  return source.replaceAll("</script", "<\\/script");
}

function escapeInlineStyle(source: string) {
  return source.replaceAll("</style", "<\\/style");
}

function createSingleAssetsScript() {
  // Icon SVG sources are bundled inline by the shared UI renderer.
  return `window.__CADARA_SINGLE_ASSETS__ = {};
Object.defineProperty(window.__CADARA_SINGLE_ASSETS__, 'wasm', {
  configurable: true,
  get() {
    return document.getElementById('cadara-single-wasm')?.textContent ?? '';
  },
});`;
}

function toDomReadyScript(source: string) {
  return `(() => {
  function startCadara() {
    "use strict";
${source}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startCadara, { once: true });
  } else {
    startCadara();
  }
})();`;
}

function cadaraSingleHtmlPlugin(): Plugin {
  return {
    name: "cadara-single-html",
    apply: "build",
    async writeBundle(options, bundle) {
      const outputs = Object.values(bundle);
      const entryChunk = outputs.find(
        (output) => output.type === "chunk" && output.isEntry,
      );

      if (!entryChunk || entryChunk.type !== "chunk") {
        this.error(
          "Unable to find the Vite entry chunk for the single-file build.",
        );
        return;
      }

      const styles = outputs
        .flatMap((output) => {
          if (output.type !== "asset" || !output.fileName.endsWith(".css")) {
            return [];
          }

          return [assetSourceToString(output.source)];
        })
        .join("\n");
      const favicon = svgToDataUrl(
        await readFile(path.join(rootDir, "public/favicon.svg"), "utf8"),
      );
      const wasmDataUrlMatch = entryChunk.code.match(wasmDataUrlPattern);
      const wasmDataUrl = wasmDataUrlMatch?.[0].slice(1, -1) ?? null;
      const appCode = wasmDataUrl
        ? entryChunk.code.replace(
            wasmDataUrlPattern,
            "globalThis.__CADARA_SINGLE_ASSETS__.wasm",
          )
        : entryChunk.code;
      const wasmDataScript = wasmDataUrl
        ? `\n    <script id="cadara-single-wasm" type="application/octet-stream">${wasmDataUrl}</script>`
        : "";
      const assetScript = createSingleAssetsScript();
      const outDir = path.resolve(rootDir, options.dir ?? "dist");

      let html = await readFile(path.join(outDir, "app.html"), "utf8");
      html = html.replace(
        /<link\b(?=[^>]*\brel=["']icon["'])[^>]*\bhref=["'][^"']+["'][^>]*>/,
        () => `<link rel="icon" type="image/svg+xml" href="${favicon}" />`,
      );
      html = html.replace(
        /<link\b(?=[^>]*\brel=["']stylesheet["'])[^>]*>/g,
        () => "",
      );
      html = html.replace(
        /<script\b(?=[^>]*\btype=["']module["'])(?=[^>]*\bsrc=["'][^"']+["'])[^>]*><\/script>/,
        () =>
          `<style>\n${escapeInlineStyle(styles)}\n</style>${wasmDataScript}\n    <script>\n${escapeInlineScript(assetScript)}\n</script>\n    <script>\n${escapeInlineScript(toDomReadyScript(appCode))}\n</script>`,
      );

      await writeFile(path.join(outDir, singleHtmlFileName), html);

      for (const fileName of await readdir(outDir)) {
        if (fileName !== singleHtmlFileName) {
          await rm(path.join(outDir, fileName), {
            recursive: true,
            force: true,
          });
        }
      }
    },
  };
}

export default defineConfig({
  define: createBuildMetadataDefines(buildMetadata),
  publicDir: false,
  worker: {
    plugins: () => [UnpluginTypia(createTypiaPluginOptions(rootDir))],
  },
  plugins: [
    UnpluginTypia(createTypiaPluginOptions(rootDir)),
    react(),
    tailwindcss(),
    cadaraSingleHtmlPlugin(),
    // A single HTML file registers no service worker: disabled, the plugin
    // resolves `virtual:pwa-register/react` (src/hooks/use-app-update.ts) to
    // its no-op stub and emits nothing.
    VitePWA({ disable: true, injectRegister: false, manifest: false }),
  ],
  assetsInclude: ["**/*.wasm"],
  resolve: {
    alias: {
      "@": path.resolve(rootDir, "./src"),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    modulePreload: false,
    cssCodeSplit: false,
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    reportCompressedSize: false,
    chunkSizeWarningLimit: 60000,
    rolldownOptions: {
      input: path.resolve(rootDir, "app.html"),
      output: {
        codeSplitting: false,
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
});
