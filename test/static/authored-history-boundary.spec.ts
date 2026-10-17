import { expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const read = (file: string) => readFileSync(resolve(root, file), "utf8");

it("shared history orchestration depends on contracts, not React, CLI, or concrete repositories", () => {
  for (const file of readdirSync(
    resolve(root, "src/application/history"),
  ).filter((f) => f.endsWith(".ts") && !f.endsWith(".spec.ts"))) {
    const source = read(`src/application/history/${file}`);
    expect(source).not.toMatch(
      /(?:from|import\()\s*["'](?:react|@\/cli|@\/workbench|@\/domain|@\/infrastructure)/,
    );
  }
});

it("browser history and headless history both use the shared private-first routing and handoff owner", () => {
  const browser = read("src/workbench/adapters/use-workbench-history.ts");
  const adapter = read("src/infrastructure/modeling/semantic-history-port.ts");
  for (const source of [browser, adapter])
    expect(source).toContain("createAuthoredHistoryOperation");
  expect(browser).not.toMatch(/durableHistory\s*\.\s*(?:undo|redo)\s*\(/);
  expect(browser).not.toMatch(
    /dispatch\(\{\s*type:\s*["']history\.(?:undo|redo)Requested/,
  );
  expect(adapter).not.toMatch(
    /new\s+AuthoredActionHistory|undoDurableHistory\s*\(|redoDurableHistory\s*\(/,
  );
});
