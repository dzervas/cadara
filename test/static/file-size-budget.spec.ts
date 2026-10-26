import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { expect, test } from "vitest";

// Agents read files through tools that truncate at about 2000 lines or 50 KB,
// so every authored text file must fit one read. Files that were already over
// budget when this guard landed are listed in the baseline with their size at
// the time; they may shrink but never grow, and leave the list once they fit.
// Regenerate the baseline only to remove entries: UPDATE_FILE_SIZE_BASELINE=1.

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

type Size = { lines: number; bytes: number };

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

function measure(filePath: string): Size {
  const text = readFileSync(filePath);
  let lines = 0;
  for (const byte of text) if (byte === 0x0a) lines += 1;
  return { lines, bytes: text.byteLength };
}

function overBudget(size: Size) {
  return size.lines > maxLines || size.bytes > maxBytes;
}

const rootFiles = readdirSync(".", { withFileTypes: true })
  .filter(
    (entry) => entry.isFile() && scannedExtensions.has(extname(entry.name)),
  )
  .map((entry) => entry.name);
const sizes = new Map(
  [...rootFiles, ...scannedRoots.flatMap(collectFiles)].map((filePath) => [
    filePath,
    measure(filePath),
  ]),
);
const baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as Record<
  string,
  Size
>;

if (process.env.UPDATE_FILE_SIZE_BASELINE === "1") {
  const shrunk = Object.fromEntries(
    Object.entries(baseline)
      .filter(([filePath]) => {
        const size = sizes.get(filePath);
        return size !== undefined && overBudget(size);
      })
      .map(([filePath, recorded]) => {
        const size = sizes.get(filePath)!;
        return [
          filePath,
          {
            lines: Math.min(recorded.lines, size.lines),
            bytes: Math.min(recorded.bytes, size.bytes),
          },
        ];
      }),
  );
  writeFileSync(baselinePath, JSON.stringify(shrunk, null, 2) + "\n");
}

test("authored text files fit one agent read (file-size budget guard)", () => {
  const violations = [...sizes]
    .filter(([filePath, size]) => {
      if (!overBudget(size)) return false;
      const recorded = baseline[filePath];
      return (
        recorded === undefined ||
        size.lines > recorded.lines ||
        size.bytes > recorded.bytes
      );
    })
    .map(([filePath, size]) => {
      const recorded = baseline[filePath];
      return recorded
        ? `${filePath}: grew to ${size.lines} lines / ${size.bytes} B (baseline ${recorded.lines} / ${recorded.bytes}); split it instead`
        : `${filePath}: ${size.lines} lines / ${size.bytes} B exceeds ${maxLines} lines / ${maxBytes} B; split it by responsibility`;
    });

  expect(violations, violations.join("\n")).toEqual([]);
});

test("the file-size baseline only lists files that still exceed the budget", () => {
  const stale = Object.keys(baseline).filter((filePath) => {
    const size = sizes.get(filePath);
    return size === undefined || !overBudget(size);
  });

  expect(
    stale,
    `Remove these entries from ${baselinePath} (or run with UPDATE_FILE_SIZE_BASELINE=1): ${stale.join(", ")}`,
  ).toEqual([]);
});
