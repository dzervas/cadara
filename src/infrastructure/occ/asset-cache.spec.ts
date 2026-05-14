import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "vitest";

import {
  OCC_ASSET_CACHE_NAME,
  getOpenCascadeServiceWorkerRegistrationOptions,
  getOpenCascadeServiceWorkerUrl,
  getOpenCascadeServiceWorkerVersion,
  isOpenCascadeAssetUrl,
} from "@/infrastructure/occ/asset-cache";

test("src/infrastructure/occ/asset-cache.spec.ts", () => {
  expect(
    isOpenCascadeAssetUrl("/cadara-occ.wasm"),
    "OCC wasm URL audit should recognize the custom app-served OpenCascade wasm asset.",
  ).toBeTruthy();
  expect(
    isOpenCascadeAssetUrl("/cadara-occ.js"),
    "OCC asset URL audit should recognize the custom app-served OpenCascade bootstrap module.",
  ).toBeTruthy();
  expect(
    getOpenCascadeServiceWorkerRegistrationOptions().scope,
    "OCC asset service worker registration scope should cover the custom app-served OCC requests from the shell.",
  ).toBe("/");
  expect(
    getOpenCascadeServiceWorkerVersion({
      querySelector(selector) {
        return selector === 'script[type="module"][src]'
          ? {
              getAttribute(name) {
                return name === "src" ? "/assets/index-live-build.js" : null;
              },
            }
          : null;
      },
    }),
    "OCC asset cache registration should derive its cache version from the current build module script URL.",
  ).toBe("/assets/index-live-build.js");
  expect(
    getOpenCascadeServiceWorkerUrl({
      querySelector() {
        return {
          getAttribute(name) {
            return name === "src" ? "/assets/index-live-build.js" : null;
          },
        };
      },
    }),
    "OCC asset cache registration should version the service worker script URL per build.",
  ).toBe("/occ-asset-cache-sw.js?v=%2Fassets%2Findex-live-build.js");

  const serviceWorkerSource = readFileSync(
    join(process.cwd(), "public/occ-asset-cache-sw.js"),
    "utf8",
  );
  expect(
    serviceWorkerSource.includes(OCC_ASSET_CACHE_NAME),
    "The OCC service worker cache should be versioned with the OpenCascade package version and current build identifier.",
  ).toBeTruthy();
});
