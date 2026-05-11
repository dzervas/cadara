import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { test } from "bun:test";

const allowedVendorImportFiles = new Set([
  "src/contracts/errors/sentry-client.ts",
  "src/contracts/errors/sentry-reporter.ts",
]);
const scannedExtensions = new Set([".ts", ".tsx"]);

function collectSourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const filePath = join(directory, entry);
    const stats = statSync(filePath);

    if (stats.isDirectory()) {
      return collectSourceFiles(filePath);
    }

    return scannedExtensions.has(extname(filePath)) ? [filePath] : [];
  });
}

test("src/contracts/errors/vendor-isolation.spec.ts", () => {
  const violations = collectSourceFiles(join(process.cwd(), "src"))
    .map((filePath) => relative(process.cwd(), filePath))
    .filter(
      (filePath) =>
        !filePath.endsWith(".spec.ts") && !filePath.endsWith(".spec.tsx"),
    )
    .filter((filePath) => !allowedVendorImportFiles.has(filePath))
    .filter((filePath) =>
      readFileSync(filePath, "utf8").includes("@sentry/browser"),
    );

  if (violations.length > 0) {
    throw new Error(
      `Sentry browser SDK imports must stay isolated in the reporter adapter.\n${violations.join("\n")}`,
    );
  }
});
