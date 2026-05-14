import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "vitest";

import { expectTrue } from "@/testing/expect.spec";

const forbiddenRuntimeValidationTerms = [
  "zod",
  "ZodError",
  "ZodIssue",
  "z.infer",
  ".safeParse",
];

test("test/static/runtime-validation-policy.spec.ts", () => {
  const packageFiles = ["package.json"];
  const packageViolations = packageFiles.flatMap((path) =>
    findForbiddenTerms(path, forbiddenRuntimeValidationTerms),
  );

  expectTrue(
    packageViolations.length === 0,
    `Package metadata must not retain direct Zod validation dependencies: ${packageViolations.join(", ")}`,
  );

  const sourceFiles = collectFiles(
    ["src", "test", "e2e"],
    ["test/static/runtime-validation-policy.spec.ts"],
  );
  const sourceViolations = sourceFiles.flatMap((path) =>
    findForbiddenTerms(path, forbiddenRuntimeValidationTerms),
  );

  expectTrue(
    sourceViolations.length === 0,
    `Source and static tests must not retain Zod-shaped validation APIs: ${sourceViolations.join(", ")}`,
  );

  expectTrue(
    readFileSync("bunfig.toml", "utf8").includes("typia-preload.ts"),
    "Bun runtime and test execution should keep the Typia preload wired.",
  );
  expectTrue(
    readFileSync("vite.config.ts", "utf8").includes("UnpluginTypia") &&
      readFileSync("vite.single.config.ts", "utf8").includes("UnpluginTypia"),
    "Both Vite browser build paths should keep Typia transformation wired.",
  );
});

function findForbiddenTerms(path: string, terms: readonly string[]) {
  const content = readFileSync(path, "utf8");
  return terms
    .filter((term) => content.includes(term))
    .map((term) => `${path}:${term}`);
}

function collectFiles(roots: readonly string[], exclude: readonly string[]) {
  const excluded = new Set(exclude);
  const files: string[] = [];

  for (const root of roots) {
    visit(root);
  }

  return files;

  function visit(path: string) {
    const stat = statSync(path);
    if (stat.isDirectory()) {
      for (const child of readdirSync(path)) {
        visit(join(path, child));
      }
      return;
    }

    const relativePath = relative(process.cwd(), path);
    if (
      !excluded.has(relativePath) &&
      (path.endsWith(".ts") || path.endsWith(".tsx"))
    ) {
      files.push(relativePath);
    }
  }
}
