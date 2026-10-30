import { defineConfig } from "@playwright/test";
import appConfig from "./playwright.config";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:4175";

// Exercise the actual Workers Static Assets router, not Vite's SPA fallback.
export default defineConfig({
  ...appConfig,
  // Production assets are already built and do not expose the dev debug platform.
  globalSetup: undefined,
  testDir: "./e2e/production",
  testMatch: "landing-routing.spec.ts",
  testIgnore: [],
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  use: {
    ...appConfig.use,
    baseURL,
    launchOptions: {
      args: [
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
        "--host-resolver-rules=MAP *.sentry.io ~NOTFOUND",
      ],
    },
  },
  webServer: {
    command: `bunx wrangler dev --local --ip 127.0.0.1 --port ${new URL(baseURL).port} --show-interactive-dev-session=false`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 300_000,
    env: { WRANGLER_SEND_METRICS: "false", SENTRY_AUTH_TOKEN: "" },
    stdout: "pipe",
    stderr: "pipe",
  },
});
