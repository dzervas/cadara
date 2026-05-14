import { test, expect } from "vitest";
import type { UserConfig } from "vite";

import viteConfig, { getOpenCascadeAssetHeaders } from "../../vite.config";

function collectPluginNames(pluginOption: UserConfig["plugins"]): string[] {
  const names: string[] = [];

  function visit(entry: unknown) {
    if (!entry) {
      return;
    }

    if (Array.isArray(entry)) {
      for (const child of entry) {
        visit(child);
      }
      return;
    }

    if (
      typeof entry === "object" &&
      "name" in entry &&
      typeof entry.name === "string"
    ) {
      names.push(entry.name);
    }
  }

  visit(pluginOption);

  return names;
}

test("test/static/build-config.spec.ts", async () => {
  const config =
    typeof viteConfig === "function"
      ? await viteConfig({
          command: "build",
          mode: "production",
          isSsrBuild: false,
          isPreview: false,
        })
      : viteConfig;

  expect(
    (config as UserConfig).build?.sourcemap === "hidden",
    "Production build should emit hidden JavaScript source maps for private Sentry upload.",
  ).toBeTruthy();
  expect(
    collectPluginNames((config as UserConfig).plugins).some((pluginName) =>
      pluginName.includes("sentry"),
    ),
    "Production build should include the Sentry Vite plugin for release source-map upload.",
  ).toBeTruthy();
  expect(
    getOpenCascadeAssetHeaders("/cadara-occ.wasm")["Content-Type"] ===
      "application/wasm",
    "The custom app-served OpenCascade wasm response should preserve a streaming-compatible MIME type.",
  ).toBeTruthy();
  expect(
    getOpenCascadeAssetHeaders("/cadara-occ.wasm")["Cache-Control"]?.includes(
      "immutable",
    ),
    "The custom OpenCascade wasm asset should be eligible for immutable repeat-load caching.",
  ).toBeTruthy();
  expect(
    getOpenCascadeAssetHeaders("/cadara-occ.js")["Cache-Control"]?.includes(
      "immutable",
    ),
    "The custom OpenCascade bootstrap module should be eligible for immutable repeat-load caching.",
  ).toBeTruthy();
});
