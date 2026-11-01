// Static lane: protect the lightweight dashboard's transitive runtime boundary.
import { expect, test } from "vitest";
import ts from "typescript";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

test("dashboard runtime imports never reach the editor, geometry kernel or viewport", () => {
  const visited = new Set<string>();
  function visit(file: string) {
    if (visited.has(file)) return;
    visited.add(file);
    const source = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    function dependency(specifier: string) {
      if (!specifier.startsWith(".") && !specifier.startsWith("@/")) {
        expect(specifier).not.toMatch(/^(?:three|@react-three|opencascade)/);
        return;
      }
      const base = specifier.startsWith("@/")
        ? path.resolve("src", specifier.slice(2))
        : path.resolve(path.dirname(file), specifier);
      const resolved = [
        base,
        `${base}.ts`,
        `${base}.tsx`,
        `${base}/index.ts`,
        `${base}/index.tsx`,
      ].find((candidate) => existsSync(candidate));
      if (!resolved || !/\.tsx?$/.test(resolved)) return;
      expect(resolved).not.toMatch(/\/(?:occ|viewport|workbench|cad)\//);
      expect(resolved).not.toMatch(
        /opencascade-kernel|modeling-service|\/App\.tsx$/,
      );
      visit(resolved);
    }
    source.forEachChild((node) => {
      if (
        ts.isImportDeclaration(node) &&
        !node.importClause?.isTypeOnly &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        const bindings = node.importClause?.namedBindings;
        if (
          bindings &&
          ts.isNamedImports(bindings) &&
          bindings.elements.every((entry) => entry.isTypeOnly) &&
          !node.importClause?.name
        )
          return;
        dependency(node.moduleSpecifier.text);
      }
      if (
        ts.isExportDeclaration(node) &&
        !node.isTypeOnly &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      )
        dependency(node.moduleSpecifier.text);
    });
    function dynamic(node: ts.Node) {
      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0])
      )
        dependency(node.arguments[0].text);
      ts.forEachChild(node, dynamic);
    }
    dynamic(source);
  }
  visit(path.resolve("src/dashboard/main.tsx"));
  expect(visited.size).toBeGreaterThan(10);
});
