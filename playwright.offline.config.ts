import { defineConfig } from "@playwright/test";

import appConfig from "./playwright.config";

// The offline E2E sub-lane (`bun run test:e2e:offline`, outside `test:all`):
// one project against `vite preview` of the debug-enabled production build
// (`vite.offline-test.config.ts`), because only a production build has the
// service worker that keeps a loaded app working offline. The script builds
// first; the spec starts the preview on the base URL's port itself and
// stops it to cut the network (Chromium's offline emulation does not cover
// a dedicated worker's script fetch), so there is no `webServer` here.
const OFFLINE_PREVIEW_PORT = 4180;

export default defineConfig({
  ...appConfig,
  // The production preview is started by the spec, not before global setup.
  globalSetup: undefined,
  testDir: "./e2e/offline",
  testMatch: undefined,
  testIgnore: undefined,
  outputDir: "test-results/offline",
  workers: 1,
  use: {
    ...appConfig.use,
    baseURL: `http://127.0.0.1:${OFFLINE_PREVIEW_PORT}`,
    // A production build reports to Sentry; keep test runs off the real
    // project without `route` (routing disables the HTTP cache).
    launchOptions: {
      args: ["--host-resolver-rules=MAP *.sentry.io ~NOTFOUND"],
    },
  },
  projects: [{ name: "offline-production-preview" }],
  webServer: undefined,
});
