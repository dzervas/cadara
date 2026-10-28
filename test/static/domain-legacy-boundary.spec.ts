import { readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

// This inventory only shrinks: migrate existing files, never add legacy source.
const legacyDomainFiles = [
  "src/domain/bug-reporting/report.spec.ts",
  "src/domain/bug-reporting/report.ts",
  "src/domain/extensions/runtime-registry-composition.ts",
  "src/domain/extensions/test-registry-composition.ts",
];

function listFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(directory, entry.name);
    return entry.isDirectory() ? listFiles(entryPath) : [entryPath];
  });
}

test("src/domain contains only the remaining legacy file inventory", () => {
  expect(listFiles("src/domain").sort()).toEqual(legacyDomainFiles);
});
