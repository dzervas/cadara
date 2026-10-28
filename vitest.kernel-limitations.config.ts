import { configDefaults, defineConfig } from "vitest/config";

import appConfig from "./vite.config.ts";

/**
 * `bun run test:kernel-limitations` only (docs/testing.md "Kernel
 * limitations"): runs the expected-to-fail specs under
 * test/kernel-limitations/<kernel>/ that every other lane excludes.
 */
export default defineConfig({
  ...appConfig,
  test: {
    ...appConfig.test,
    projects: undefined,
    include: ["test/kernel-limitations/**/*.kernel-limitation.spec.ts"],
    exclude: configDefaults.exclude,
  },
});
