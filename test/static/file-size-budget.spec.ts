import { readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { expect, test } from "vitest";

// Agents read files through tools that truncate at about 2000 lines or 50 KB,
// so new authored text files must fit one read. Files that were already over
// budget when this guard landed are listed by path in the baseline: they may
// change freely, and leave the list once they fit. Shrink them by splitting
// along real responsibilities, never by compressing code to meet a number.

const maxLines = 2000;
const maxBytes = 50_000;
const baselinePath = "test/static/file-size-budget.baseline.json";

const scannedRoots = [
  "src",
  "e2e",
  "test",
  "scripts",
  "landing",
  "docs",
  ".agents",
  "evaluations",
];
const scannedExtensions = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".css",
  ".md",
  ".sh",
  ".py",
]);
const skippedDirectories = new Set(["node_modules", "dist", "coverage"]);

function collectFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      return skippedDirectories.has(entry.name) ? [] : collectFiles(filePath);
    }
    return entry.isFile() && scannedExtensions.has(extname(entry.name))
      ? [filePath]
      : [];
  });
}

function overBudget(filePath: string) {
  const text = readFileSync(filePath);
  let lines = 0;
  for (const byte of text) if (byte === 0x0a) lines += 1;
  return lines > maxLines || text.byteLength > maxBytes;
}

const rootFiles = readdirSync(".", { withFileTypes: true })
  .filter(
    (entry) => entry.isFile() && scannedExtensions.has(extname(entry.name)),
  )
  .map((entry) => entry.name);
const files = [...rootFiles, ...scannedRoots.flatMap(collectFiles)];
const oversized = new Set(files.filter(overBudget));
const baseline = new Set(
  JSON.parse(readFileSync(baselinePath, "utf8")) as string[],
);

test("new authored text files fit one agent read (file-size budget guard)", () => {
  const violations = [...oversized].filter(
    (filePath) => !baseline.has(filePath),
  );

  expect(
    violations,
    `Over ${maxLines} lines or ${maxBytes} B; split by responsibility: ${violations.join(", ")}`,
  ).toEqual([]);
});

test("the file-size baseline only lists files that still exceed the budget", () => {
  const stale = [...baseline].filter((filePath) => !oversized.has(filePath));

  expect(
    stale,
    `Remove these entries from ${baselinePath}: ${stale.join(", ")}`,
  ).toEqual([]);
});
