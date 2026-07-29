import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "vitest";

const ROOT = process.cwd();
const INSPECTOR_SOURCES = [
  "src/components/layout/feature-inspector.tsx",
  "src/components/layout/feature-inspector-sections.ts",
] as const;

test("feature inspector presentation stays generic across result body types", () => {
  const forbiddenTokens = [
    "resultBodyType",
    "bodyKind",
    '"extrude"',
    '"revolve"',
    "extrude-result-body-type",
    "revolve-result-body-type",
  ] as const;
  const offenders: string[] = [];

  for (const relativePath of INSPECTOR_SOURCES) {
    const source = readFileSync(join(ROOT, relativePath), "utf8");

    for (const token of forbiddenTokens) {
      if (source.includes(token)) {
        offenders.push(`${relativePath}: ${token}`);
      }
    }
  }

  expect(
    offenders,
    `Feature inspector presentation must render form schemas generically instead of branching on feature kind or surface/solid result body type.\n${offenders.join("\n")}`,
  ).toEqual([]);
});

test("feature inspector presentation does not import modeling kernel modules", () => {
  const forbiddenImports = [
    "@/domain/modeling/occ",
    "opencascade.js",
    "@/domain/modeling/occ/topology",
  ] as const;
  const offenders: string[] = [];

  for (const relativePath of INSPECTOR_SOURCES) {
    const source = readFileSync(join(ROOT, relativePath), "utf8");

    for (const importPath of forbiddenImports) {
      if (source.includes(importPath)) {
        offenders.push(`${relativePath}: ${importPath}`);
      }
    }
  }

  expect(
    offenders,
    `Feature inspector presentation must stay out of the OCC kernel layer.\n${offenders.join("\n")}`,
  ).toEqual([]);
});
