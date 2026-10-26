import { defineConfig } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";
const shouldStartWebServer = (process.env.PLAYWRIGHT_WEB_SERVER ?? "1") !== "0";
const runRealCaptures = process.env.PLAYWRIGHT_REAL_CAPTURES === "1";
const recordDiagnostics = process.env.PLAYWRIGHT_DIAGNOSTICS === "1";

const realCaptureTests = [
  "**/onshape-import-parametric.spec.ts",
  "**/onshape-variable-rebuild.spec.ts",
];

export default defineConfig({
  globalSetup: "./e2e/global-setup.ts",
  testDir: "./e2e",
  testMatch: runRealCaptures ? realCaptureTests : undefined,
  // `e2e/offline/` runs only in its own sub-lane on a production preview
  // (`playwright.offline.config.ts`, `bun run test:e2e:offline`).
  testIgnore: runRealCaptures
    ? undefined
    : [...realCaptureTests, "**/e2e/offline/**", "**/e2e/production/**"],
  timeout: 30_000,
  expect: {
    timeout: 1_000,
  },
  fullyParallel: true,
  // Real captures saturate the OCC worker and run serially. The default fast
  // lane runs four browsers in parallel (about 14 minutes for 190 rows, T17b).
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
