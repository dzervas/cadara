import { defineConfig } from "@playwright/test";

import appConfig from "./playwright.config";

// The single-file E2E sub-lane (`bun run test:e2e:single-file`, outside
// `test:all`): the script runs `bun run build:single` first and the spec opens
// dist/cadara-single.html from disk, so there is no server, base URL or
// global setup (which warms a dev server).
export default defineConfig({
  ...appConfig,
  globalSetup: undefined,
  testDir: "./e2e/single-file",
  testMatch: undefined,
  testIgnore: undefined,
  outputDir: "test-results/single-file",
  workers: 1,
  use: { ...appConfig.use, baseURL: undefined },
  projects: [{ name: "single-file-from-disk" }],
  webServer: undefined,
});
