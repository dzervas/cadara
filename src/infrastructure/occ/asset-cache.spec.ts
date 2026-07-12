import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "vitest";

import { OCC_ASSET_VERSION } from "@/domain/modeling/occ/assets";
  import {
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
    getOpenCascadeServiceWorkerVersion(),
    "OCC asset cache registration should use the generated artifact version rather than the shell build URL.",
  ).toBe(OCC_ASSET_VERSION);
  expect(
    getOpenCascadeServiceWorkerUrl(),
    "OCC asset cache registration should version the service worker script with the paired artifact version.",
  ).toBe(`/occ-asset-cache-sw.js?v=${OCC_ASSET_VERSION}`);

  const serviceWorkerSource = readFileSync(
    join(process.cwd(), "public/occ-asset-cache-sw.js"),
    "utf8",
  );
  expect(
    serviceWorkerSource.includes("new URL(self.location.href).searchParams.get(\"v\")"),
    "The service worker cache should derive its cache namespace from the same versioned registration URL.",
  ).toBeTruthy();
});
