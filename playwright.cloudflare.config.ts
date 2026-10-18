import { defineConfig } from "@playwright/test";
import appConfig from "./playwright.config";

// Exercise the actual Workers Static Assets router, not Vite's SPA fallback.
export default defineConfig({
  ...appConfig,
  testDir: "./e2e/production",
  testMatch: "landing-routing.spec.ts",
  testIgnore: [],
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  use: {
    ...appConfig.use,
    baseURL: "http://127.0.0.1:4175",
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
    command: "bun run preview:cf",
    url: "http://127.0.0.1:4175",
    reuseExistingServer: false,
    timeout: 300_000,
    env: { WRANGLER_SEND_METRICS: "false", SENTRY_AUTH_TOKEN: "" },
    stdout: "pipe",
    stderr: "pipe",
  },
});
