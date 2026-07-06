import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test, expect } from "vitest";

const ROOT = process.cwd();
const CLI_ROOT = join(ROOT, "src/cli");

// Browser-bound module roots CLI subcommands must never import: they run under
// Bun/Node and share only contracts and domain code with the app.
const FORBIDDEN_IMPORT_ROOTS = [
  "@/components/",
  "@/workbench/",
  "@/app/",
  "@/hooks/",
  "@/infrastructure/viewport/",
  "@/infrastructure/occ/",
  "@/infrastructure/section-view/",
];

const FORBIDDEN_PACKAGES = [
  "react",
  "react-dom",
  "@react-three/",
  "@mantine/",
  "three",
];

test("test/static/cli-browser-boundary.spec.ts CLI stays free of browser-bound code", () => {
  const offenders: string[] = [];

  for (const filePath of walk(CLI_ROOT)) {
    if (!/\.(ts|tsx)$/.test(filePath) || /\.spec\.(ts|tsx)$/.test(filePath)) {
      continue;
    }

    const source = readFileSync(filePath, "utf8");
    const relativePath = relative(ROOT, filePath);

    for (const importRoot of FORBIDDEN_IMPORT_ROOTS) {
      if (
        source.includes(`from "${importRoot}`) ||
        source.includes(`from '${importRoot}`)
      ) {
        offenders.push(`${relativePath} imports ${importRoot}`);
      }
    }

    for (const pkg of FORBIDDEN_PACKAGES) {
      if (
        source.includes(`from "${pkg}"`) ||
        source.includes(`from '${pkg}'`) ||
        source.includes(`from "${pkg}/`) ||
        source.includes(`from '${pkg}/`)
      ) {
        offenders.push(`${relativePath} imports ${pkg}`);
      }
    }
  }

  expect(
    offenders.length,
    `CLI modules must not import browser-bound code.\n${offenders.join("\n")}`,
  ).toBe(0);
});

function walk(directory: string): string[] {
  try {
    const files: string[] = [];
    for (const entry of readdirSync(directory)) {
      const entryPath = join(directory, entry);
      if (statSync(entryPath).isDirectory()) {
        files.push(...walk(entryPath));
        continue;
      }
      files.push(entryPath);
    }
    return files;
  } catch {
    return [];
  }
}
