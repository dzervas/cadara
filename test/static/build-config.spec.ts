import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { test, expect } from "vitest";
import type { UserConfig } from "vite";
import { parseConfigFileTextToJson } from "typescript";

import { OCC_ASSET_BASE_PATH } from "../../src/infrastructure/occ/asset-version";
import { shouldTransformWithTypia } from "../../typia-plugin-options";
import viteConfig, {
  getBuildSourcemap,
  getOpenCascadeAssetHeaders,
} from "../../vite.config";

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(entryPath) : [entryPath];
  });
}

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

test("every Typia call site is inside the cached transform scope", () => {
  const uncovered = sourceFiles(path.resolve("src"))
    .filter((filePath) => /\.tsx?$/.test(filePath))
    .filter((filePath) => /\btypia\.create[A-Z]/.test(readFileSync(filePath, "utf8")))
    .filter((filePath) => !shouldTransformWithTypia(filePath));

  expect(
    uncovered,
    "A Typia call outside the narrowed plugin scope would reach runtime untransformed.",
  ).toEqual([]);
});

test("test/static/build-config.spec.ts", async () => {
  expect(
    getBuildSourcemap(true) === "hidden" && getBuildSourcemap(false) === false,
    "Builds should emit hidden source maps only when private Sentry upload is active.",
  ).toBeTruthy();
  expect(
    collectPluginNames((viteConfig as UserConfig).plugins).some((pluginName) =>
      pluginName.includes("sentry"),
    ),
    "Production build should include the Sentry Vite plugin for release source-map upload.",
  ).toBeTruthy();
  const kernelPath = `${OCC_ASSET_BASE_PATH}/cadara-occ`;
  expect(
    getOpenCascadeAssetHeaders(`${kernelPath}.wasm`)["Content-Type"] ===
      "application/wasm",
    "The custom app-served OpenCascade wasm response should preserve a streaming-compatible MIME type.",
  ).toBeTruthy();
  for (const extension of ["js", "wasm"])
    expect(
      getOpenCascadeAssetHeaders(`${kernelPath}.${extension}`)[
        "Cache-Control"
      ]?.includes("immutable"),
      "The content-versioned OpenCascade kernel should be eligible for immutable repeat-load caching.",
    ).toBeTruthy();
  expect(
    getOpenCascadeAssetHeaders("/cadara-occ.wasm")["Cache-Control"],
    "An unversioned kernel path names no fixed content, so it is never immutable.",
  ).toBeUndefined();
});

test("Cloudflare builds distinct landing/editor entries and a landing 404 page", () => {
  const config = viteConfig as UserConfig;
  expect(config.base).toBe("/");
  expect(config.build?.rollupOptions?.input).toEqual({
    landing: path.resolve("index.html"),
    editor: path.resolve("app.html"),
    notFound: path.resolve("404.html"),
  });
  for (const file of ["index.html", "404.html"]) {
    expect(readFileSync(file, "utf8")).toContain('src="/landing/main.tsx"');
  }
  expect(readFileSync("app.html", "utf8")).toContain('src="/src/main.tsx"');
  const parsed = parseConfigFileTextToJson(
    "wrangler.jsonc",
    readFileSync("wrangler.jsonc", "utf8"),
  );
  expect(parsed.error).toBeUndefined();
  const cloudflare = parsed.config as {
    build: { command: string };
    assets: {
      directory: string;
      html_handling: string;
      not_found_handling: string;
    };
  };
  expect(cloudflare.build.command).toBe("bun run build");
  expect(cloudflare.assets).toMatchObject({
    directory: "./dist",
    html_handling: "drop-trailing-slash",
    not_found_handling: "404-page",
  });
});

test("served example folders contain only native files, manifests and referenced meshes", () => {
  expect(readdirSync("landing/examples").sort()).toEqual([
    "bracket",
    "enclosure",
    "wheel",
  ]);
  for (const id of ["bracket", "wheel", "enclosure"]) {
    const directory = path.join("landing/examples", id);
    const manifest = JSON.parse(
      readFileSync(path.join(directory, "model.json"), "utf8"),
    ) as { parts: { file: string }[] };
    expect(readdirSync(directory).sort()).toEqual(
      [
        "model.cadara",
        "model.json",
        ...manifest.parts.map((part) => part.file),
      ].sort(),
    );
    expect(new Set(manifest.parts.map((part) => part.file)).size).toBe(
      manifest.parts.length,
    );
  }
});
