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
