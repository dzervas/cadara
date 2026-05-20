import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "vitest";

const ROOT = process.cwd();

test("test/static/debug-platform-boundary.spec.ts legacy debug globals stay removed", () => {
  const sourceFiles = [
    "src/workbench/shell/cad-workbench.tsx",
    "src/workbench/debug/cadara-debug-bridge.ts",
    "src/workbench/debug/use-cadara-debug-platform.ts",
    "src/vite-env.d.ts",
    "e2e/helpers/feature-workbench.ts",
    "e2e/helpers/sketch-workbench.ts",
  ];
  const offenders: string[] = [];

  for (const relativePath of sourceFiles) {
    const source = readFileSync(join(ROOT, relativePath), "utf8");
    if (
      source.includes("__cadTestState") ||
      source.includes("__cadSelectTarget")
    ) {
      offenders.push(relativePath);
    }
  }

  expect(
    offenders.length === 0,
    `Legacy debug globals must stay removed from the formal debug platform.\n${offenders.join("\n")}`,
  ).toBeTruthy();
});
