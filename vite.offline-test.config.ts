import { mergeConfig, type UserConfig } from "vite";

import appConfig from "./vite.config";

/**
 * The offline E2E sub-lane's build (`bun run test:e2e:offline` only; never
 * `build`, `build:single` or a deploy): the shipped app build with
 * `import.meta.env.TEST = "true"`, which turns on the debug platform the
 * Playwright harness reads (`isCadaraDebugPlatformEnabled`). Its output goes
 * to `.tmp-offline-dist/`, never `dist/`, and `vite preview` with this config
 * serves it.
 */
export default mergeConfig(appConfig as UserConfig, {
  define: { "import.meta.env.TEST": JSON.stringify("true") },
  build: { outDir: ".tmp-offline-dist", emptyOutDir: true },
});
