import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { glob } from "node:fs/promises";

/**
 * Tier guard (docs/testing.md "Tiers"): the `fast` project shares one module
 * registry per worker, so a `vi.mock` factory there may be ignored when an
 * earlier file already evaluated the mocked module (and, e.g., a mocked
 * `node:fs` then writes to the real disk). Specs that mock modules must be
 * `*.isolated.spec.ts` so they run in the isolated project (the heavy
 * project is isolated as well).
 */
test("module mocks only appear in isolated specs", async () => {
  const offenders: string[] = [];
  for await (const file of glob([
    "src/**/*.spec.{ts,tsx}",
    "test/**/*.spec.ts",
  ])) {
    if (/\.(isolated|heavy)\.spec\.tsx?$/.test(file)) continue;
    const source = readFileSync(file, "utf8");
    if (/\bvi\.(mock|doMock|unmock|doUnmock|resetModules)\s*\(/.test(source))
      offenders.push(file);
  }
  expect(
    offenders,
    "Rename these to *.isolated.spec.ts (or stop mocking modules).",
  ).toEqual([]);
});

// Only the release workflow deliberately pays Bun's source Typia startup cost.
// Other process probes must use the heavy project's injected CLI bundle too.
test("CLI source-entry subprocess coverage stays in the release workflow", async () => {
  const offenders: string[] = [];
  for await (const file of glob("src/cli/**/*.spec.ts")) {
    if (file === "src/cli/workflow-recipes.spec.ts") continue;
    if (/src\/cli\/main\.ts/.test(readFileSync(file, "utf8")))
      offenders.push(file);
  }
  expect(
    offenders,
    "Use cliEntry() for CLI subprocesses; source/release smoke lives in workflow-recipes.spec.ts.",
  ).toEqual([]);
});
