import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { expect, test } from "vitest";
import ts from "typescript";

const scannedDirectories = ["src", "e2e", "scripts"];
const scannedExtensions = new Set([".ts", ".tsx"]);

function collectSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filePath = join(directory, entry.name);

    if (
      entry.isDirectory() ||
      (entry.isSymbolicLink() && statSync(filePath).isDirectory())
    ) {
      return collectSourceFiles(filePath);
    }

    return scannedExtensions.has(extname(filePath)) ? [filePath] : [];
  });
}

function findEmptyCatchBlocks(sourceText: string, filePath: string) {
  // Skip AST work for catch-free files, not a syntax regex: comments can occur
  // between catch tokens. Keep Unicode escapes for TS's keyword recovery too.
  if (!sourceText.includes("catch") && !sourceText.includes("\\u")) return [];

  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.TSX,
  );
  const violations: string[] = [];

  function visit(node: ts.Node) {
    if (ts.isCatchClause(node) && node.block.statements.length === 0) {
      const position = sourceFile.getLineAndCharacterOfPosition(
        node.getStart(sourceFile),
      );
      violations.push(
        `${filePath}:${position.line + 1}:${position.character + 1}`,
      );
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return violations;
}

test.each([
  "try {} catch {}",
  "try {} catch (error) {}",
  "try {} catch /* comment */ {}",
  "try {} catch /* comment */ (error) /* comment */ {}",
  "try {} catch ({ message = (() => 1)() }) {}",
  "try {} catch { /* not handling the error */ }",
  "try {} c\\u0061tch {}",
])("reports empty catch fixtures: %s", (sourceText) => {
  expect(findEmptyCatchBlocks(sourceText, "fixture.ts")).toEqual([
    "fixture.ts:1:8",
  ]);
});

test.each([
  "export const value = 1;",
  "// try {} catch {}",
  'const example = "try {} catch {}";',
  "try {} catch (error) { throw error; }",
])("ignores sources without empty catch clauses: %s", (sourceText) => {
  expect(findEmptyCatchBlocks(sourceText, "fixture.ts")).toEqual([]);
});

test("src/contracts/errors/no-empty-catch.spec.ts", () => {
  const fixtureViolations = findEmptyCatchBlocks(
    "try { throw new Error() } catch (_error) {}",
    "fixture.ts",
  );
  if (fixtureViolations.length !== 1) {
    throw new Error("Empty catch fixture should fail the static guard.");
  }

  const violations = scannedDirectories.flatMap((directory) =>
    collectSourceFiles(join(process.cwd(), directory)).flatMap((filePath) =>
      findEmptyCatchBlocks(
        readFileSync(filePath, "utf8"),
        relative(process.cwd(), filePath),
      ),
    ),
  );

  if (violations.length > 0) {
    throw new Error(
      `Caught errors must be handled, reported, converted, or rethrown; empty catch blocks are prohibited.\n${violations.join("\n")}`,
    );
  }
});
