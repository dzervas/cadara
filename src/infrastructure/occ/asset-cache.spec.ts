import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "bun:test";

import { expectTrue } from "@/testing/expect.spec";
import {
  OCC_ASSET_CACHE_NAME,
  getOpenCascadeServiceWorkerRegistrationOptions,
  getOpenCascadeServiceWorkerUrl,
  getOpenCascadeServiceWorkerVersion,
  isOpenCascadeAssetUrl,
} from "@/infrastructure/occ/asset-cache";

test("src/infrastructure/occ/asset-cache.spec.ts", () => {
  expectTrue(
    isOpenCascadeAssetUrl("/cadara-occ.wasm"),
    "OCC wasm URL audit should recognize the custom app-served OpenCascade wasm asset.",
  );
  expectTrue(
    isOpenCascadeAssetUrl("/cadara-occ.js"),
    "OCC asset URL audit should recognize the custom app-served OpenCascade bootstrap module.",
  );
  expectTrue(
    getOpenCascadeServiceWorkerRegistrationOptions().scope === "/",
    "OCC asset service worker registration scope should cover the custom app-served OCC requests from the shell.",
  );
  expectTrue(
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
    }) === "/assets/index-live-build.js",
    "OCC asset cache registration should derive its cache version from the current build module script URL.",
  );
  expectTrue(
    getOpenCascadeServiceWorkerUrl({
      querySelector() {
        return {
          getAttribute(name) {
            return name === "src" ? "/assets/index-live-build.js" : null;
          },
        };
      },
    }) === "/occ-asset-cache-sw.js?v=%2Fassets%2Findex-live-build.js",
    "OCC asset cache registration should version the service worker script URL per build.",
  );

  const serviceWorkerSource = readFileSync(
    join(process.cwd(), "public/occ-asset-cache-sw.js"),
    "utf8",
  );
  expectTrue(
    serviceWorkerSource.includes(OCC_ASSET_CACHE_NAME),
    "The OCC service worker cache should be versioned with the OpenCascade package version and current build identifier.",
  );
});
