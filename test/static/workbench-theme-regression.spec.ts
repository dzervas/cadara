import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { test } from "bun:test";

const allowedFiles = new Set(["src/theme/workbench-theme.ts"]);
const allowedDirectories = ["src/assets/"];
const scannedExtensions = new Set([".css", ".ts", ".tsx"]);
const literalPattern = /#(?:[0-9a-fA-F]{3,8})\b|rgba?\(|hsla?\(/g;

function collectSourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const filePath = join(directory, entry);
    const stats = statSync(filePath);

    if (stats.isDirectory()) {
      return collectSourceFiles(filePath);
    }

    if (!scannedExtensions.has(extname(filePath))) {
      return [];
    }

    if (filePath.includes(".spec.")) {
      return [];
    }

    return [filePath];
  });
}

test("src/theme/workbench-theme-regression.spec.ts", () => {
  const sourceFiles = collectSourceFiles(join(process.cwd(), "src"));
  const violations: string[] = [];

  for (const filePath of sourceFiles) {
    const relativePath = relative(process.cwd(), filePath);

    if (
      allowedFiles.has(relativePath) ||
      allowedDirectories.some((directory) => relativePath.startsWith(directory))
    ) {
      continue;
    }

    const fileContents = readFileSync(filePath, "utf8");
    const matches = fileContents.match(literalPattern);

    if (!matches) {
      continue;
    }

    violations.push(`${relativePath}: ${matches.join(", ")}`);
  }

  if (violations.length > 0) {
    throw new Error(
      `Raw presentation color literals must stay centralized in src/theme/workbench-theme.ts.\n${violations.join("\n")}`,
    );
  }
});
