import { defineConfig } from "@playwright/test";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";
const shouldStartWebServer = (process.env.PLAYWRIGHT_WEB_SERVER ?? "1") !== "0";
const runRealCaptures = process.env.PLAYWRIGHT_REAL_CAPTURES === "1";
const recordDiagnostics = process.env.PLAYWRIGHT_DIAGNOSTICS === "1";

const realCaptureTests = [
  "**/onshape-import-parametric.spec.ts",
  "**/onshape-variable-rebuild.spec.ts",
];

function findFontconfigFile() {
  if (process.env.FONTCONFIG_FILE) return process.env.FONTCONFIG_FILE;
  const systemConfig = "/etc/fonts/fonts.conf";
  if (existsSync(systemConfig)) return systemConfig;

  const nixStore = "/nix/store";
  if (!existsSync(nixStore)) return null;
  for (const entry of readdirSync(nixStore)) {
    if (!entry.includes("-fontconfig-")) continue;
    const candidate = join(nixStore, entry, "etc/fonts/fonts.conf");
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

const fontconfigFile = findFontconfigFile();
if (fontconfigFile) process.env.FONTCONFIG_FILE = fontconfigFile;

export default defineConfig({
  testDir: "./e2e",
  testMatch: runRealCaptures ? realCaptureTests : undefined,
  testIgnore: runRealCaptures ? undefined : realCaptureTests,
  timeout: 30_000,
  expect: {
    timeout: 1_000,
  },
  fullyParallel: true,
  // Real captures saturate the OCC worker and run serially. The default fast
  // lane keeps enough browser parallelism to stay inside the two-minute budget.
  workers: runRealCaptures ? 1 : 4,
  retries: 0,
  use: {
    baseURL,
    headless: true,
    viewport: { width: 1440, height: 900 },
    trace: recordDiagnostics ? "retain-on-failure" : "off",
    screenshot: "only-on-failure",
    video: recordDiagnostics ? "retain-on-failure" : "off",
  },
  webServer: shouldStartWebServer
    ? {
        command: "bun run dev",
        url: baseURL,
        reuseExistingServer: true,
        stdout: "pipe",
        stderr: "pipe",
        timeout: 120_000,
      }
    : undefined,
});
