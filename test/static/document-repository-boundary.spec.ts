import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test, expect } from "vitest";

test("test/static/document-repository-boundary.spec.ts", () => {
  const sourceRoot = join(process.cwd(), "src");
  const offenders: string[] = [];

  for (const file of walkTypescriptFiles(sourceRoot)) {
    const relativePath = relative(process.cwd(), file);

    if (relativePath.endsWith(".spec.ts")) {
      continue;
    }

    const source = readFileSync(file, "utf8");
    if (
      source.includes("@automerge/automerge") &&
      !relativePath.includes(
        "src/infrastructure/persistence/indexeddb-automerge-document-repository.ts",
      ) &&
      !relativePath.includes(
        "src/infrastructure/persistence/document-repository-url-store.ts",
      )
    ) {
      offenders.push(relativePath);
    }
  }

  expect(
    offenders.length,
    `Automerge imports must stay inside the repository implementation layer: ${offenders.join(", ")}`,
  ).toBe(0);
});

function walkTypescriptFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      return walkTypescriptFiles(path);
    }
    return path.endsWith(".ts") || path.endsWith(".tsx") ? [path] : [];
  });
}
