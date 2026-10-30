import { defineConfig } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";
const shouldStartWebServer = (process.env.PLAYWRIGHT_WEB_SERVER ?? "1") !== "0";
const runRealCaptures = process.env.PLAYWRIGHT_REAL_CAPTURES === "1";
const isCI = Boolean(process.env.CI);
const recordDiagnostics = process.env.PLAYWRIGHT_DIAGNOSTICS === "1";
const useGPU = process.env.PLAYWRIGHT_GPU === "1";

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
  // Leave time for the runner to upload diagnostics before its job deadline.
  globalTimeout: isCI && !runRealCaptures ? 50 * 60_000 : undefined,
  reporter: isCI ? [["line"], ["html", { open: "never" }]] : undefined,
  fullyParallel: true,
  // CI shards across runners instead of competing for software-rendering CPU.
  // Real captures also saturate the OCC worker and always run serially.
  workers: runRealCaptures || isCI ? 1 : 4,
  retries: 0,
  use: {
    baseURL,
    headless: true,
    ...(useGPU
      ? {
          channel: "chromium",
          launchOptions: {
            args: [
              "--use-angle=vulkan",
              "--enable-features=Vulkan",
              "--ignore-gpu-blocklist",
            ],
          },
        }
      : {}),
    viewport: { width: 1440, height: 900 },
    trace: isCI || recordDiagnostics ? "retain-on-failure" : "off",
    screenshot: "only-on-failure",
    video: recordDiagnostics ? "retain-on-failure" : "off",
  },
  webServer: shouldStartWebServer
    ? {
        command: "bun run dev",
        url: baseURL,
        reuseExistingServer: !isCI,
        stdout: "pipe",
        stderr: "pipe",
        timeout: 120_000,
      }
    : undefined,
});
