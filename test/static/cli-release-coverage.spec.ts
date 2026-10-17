import { expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

const root = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

test("release matrix inventories every closed semantic operation, with existing qualification seams", () => {
  const source = ts.createSourceFile(
    "schema.ts",
    read("src/contracts/semantic/schema.ts"),
    ts.ScriptTarget.Latest,
    true,
  );
  const operations = new Set<string>();
  function visit(node: ts.Node) {
    if (
      ts.isPropertySignature(node) &&
      node.name.getText(source) === "operation" &&
      node.type
    ) {
      const collect = (type: ts.TypeNode) => {
        if (ts.isUnionTypeNode(type)) type.types.forEach(collect);
        else if (ts.isLiteralTypeNode(type) && ts.isStringLiteral(type.literal))
          operations.add(type.literal.text);
        else
          throw new Error(
            "Semantic operation is no longer a closed literal union",
          );
      };
      collect(node.type);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  const matrix = read("src/cli/COVERAGE.md");
  const rows = matrix.split("\n").filter((line) => line.startsWith("| "));
  const documented = new Set(
    rows.flatMap((line) =>
      [...line.split("|")[2]!.matchAll(/`([^`]+)`/g)].map((match) => match[1]!),
    ),
  );
  expect(operations.size).toBeGreaterThan(80);
  expect([...documented].sort()).toEqual([...operations].sort());
  for (const match of matrix.matchAll(/`(src\/[^`]+\.spec\.ts)`/g))
    expect(existsSync(resolve(root, match[1]!)), match[1]).toBe(true);
  expect(matrix).toContain("Ticket 37 / Onshape importer changes are deferred");
  expect(matrix).toContain("keepProfileOrientation");
  expect(matrix).toContain("180-second timeout");
});
