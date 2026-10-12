import { describe, expect, it } from "vitest";
import ts from "typescript";
import {
  readFileSync,
  existsSync,
  statSync,
  mkdtempSync,
  writeFileSync,
  rmSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname, relative } from "node:path";

const root = resolve(import.meta.dirname, "../..");
function runtimeImports(file: string): string[] {
  const ast = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const imports: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isImportTypeNode(node)) return;
    if (
      ts.isImportDeclaration(node) &&
      !node.importClause?.isTypeOnly &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      if (
        !node.importClause?.namedBindings ||
        !ts.isNamedImports(node.importClause.namedBindings) ||
        node.importClause.name ||
        node.importClause.namedBindings.elements.some((e) => !e.isTypeOnly)
      )
        imports.push(node.moduleSpecifier.text);
    }
    if (
      ts.isExportDeclaration(node) &&
      !node.isTypeOnly &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      (!node.exportClause ||
        !ts.isNamedExports(node.exportClause) ||
        node.exportClause.elements.some((e) => !e.isTypeOnly))
    )
      imports.push(node.moduleSpecifier.text);
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    )
      imports.push(node.arguments[0].text);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return imports;
}
function target(file: string, specifier: string) {
  if (!specifier.startsWith(".") && !specifier.startsWith("@/")) return null;
  const path = specifier.startsWith("@/")
    ? resolve(root, "src", specifier.slice(2))
    : resolve(dirname(file), specifier);
  return (
    [
      path,
      `${path}.ts`,
      `${path}.tsx`,
      `${path}/index.ts`,
      `${path}/index.tsx`,
    ].find((p) => existsSync(p) && statSync(p).isFile()) ?? null
  );
}
function violations(entry: string) {
  const pending = [resolve(root, entry)];
  const seen = new Set<string>();
  const failures: string[] = [];
  while (pending.length) {
    const file = pending.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const from = relative(root, file);
    const source = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    function checkGlobals(node: ts.Node) {
      if (ts.isTypeNode(node)) return;
      if (
        ts.isPropertyAccessExpression(node) &&
        ts.isIdentifier(node.expression) &&
        ["globalThis", "window", "self"].includes(node.expression.text) &&
        [
          "document",
          "indexedDB",
          "localStorage",
          "sessionStorage",
          "Worker",
        ].includes(node.name.text)
      )
        failures.push(`${from} -> browser global ${node.getText(source)}`);
      if (
        ts.isPropertyAccessExpression(node) &&
        ts.isIdentifier(node.expression) &&
        (["indexedDB", "localStorage", "sessionStorage"].includes(
          node.expression.text,
        ) ||
          (node.expression.text === "document" &&
            [
              "createElement",
              "createElementNS",
              "getElementById",
              "querySelector",
              "querySelectorAll",
              "createTextNode",
            ].includes(node.name.text)))
      )
        failures.push(`${from} -> browser API ${node.getText(source)}`);
      if (
        ts.isNewExpression(node) &&
        ts.isIdentifier(node.expression) &&
        ["Worker", "SharedWorker", "OffscreenCanvas"].includes(
          node.expression.text,
        )
      )
        failures.push(`${from} -> browser bootstrap ${node.expression.text}`);
      ts.forEachChild(node, checkGlobals);
    }
    checkGlobals(source);
    for (const specifier of runtimeImports(file)) {
      const resolved = target(file, specifier);
      const to = resolved ? relative(root, resolved) : specifier;
      if (
        !resolved &&
        (specifier.startsWith(".") || specifier.startsWith("@/"))
      )
        failures.push(`${from} -> unresolved ${specifier}`);
      if (
        /^(react(?:-dom)?(?:\/|$)|three(?:\/|$)|@react-three\/|@mantine\/)/.test(
          to,
        ) ||
        /(?:^|\/)node_modules\/(?:react|react-dom|three|@react-three|@mantine)(?:\/|$)/.test(
          to,
        ) ||
        /^src\/(app|hooks|components|workbench|infrastructure\/(viewport|workers|section-view))\//.test(
          to,
        ) ||
        /browser-|local-file-system-access|indexeddb/i.test(to)
      )
        failures.push(`${from} -> ${to}`);
      if (
        /^src\/(application|core|domain|contracts|infrastructure)\//.test(
          from,
        ) &&
        /^src\/cli\//.test(to)
      )
        failures.push(`${from} -> ${to}`);
      if (
        /^src\/application\/semantic\//.test(from) &&
        /^src\/(domain|infrastructure|composition|cli)\//.test(to)
      )
        failures.push(`${from} -> ${to}`);
      if (
        /^src\/cli\/commands\//.test(from) &&
        /^src\/(domain|infrastructure|application\/editor)\//.test(to)
      )
        failures.push(`${from} -> ${to}`);
      if (resolved) pending.push(resolved);
    }
  }
  return failures;
}
describe("headless transitive runtime boundary", () => {
  it("forbids shared production modules from importing CLI policy", () => {
    const offenders: string[] = [];
    function walk(directory: string) {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = resolve(directory, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (
          /\.tsx?$/.test(path) &&
          !/\.(spec|fixtures)\.tsx?$/.test(path)
        ) {
          for (const specifier of runtimeImports(path)) {
            const resolved = target(path, specifier);
            if (resolved && relative(root, resolved).startsWith("src/cli/"))
              offenders.push(`${relative(root, path)} -> ${specifier}`);
          }
        }
      }
    }
    for (const layer of [
      "contracts",
      "core",
      "application",
      "domain",
      "infrastructure",
    ])
      walk(resolve(root, "src", layer));
    expect(offenders).toEqual([]);
  });
  it("follows reexports and runtime dynamic imports, but excludes type-query edges", () => {
    const directory = mkdtempSync(resolve(tmpdir(), "cadara-boundary-"));
    try {
      const entry = resolve(directory, "entry.ts");
      writeFileSync(
        entry,
        'export * from "./leaf"; type T = import("three").Vector2; import type { ReactNode } from "react";',
      );
      writeFileSync(
        resolve(directory, "leaf.ts"),
        'void import("react"); void import("react-dom/client");',
      );
      expect(runtimeImports(entry)).toEqual(["./leaf"]);
      expect(violations(entry)).toHaveLength(2);
      expect(violations(entry)[0]).toContain("leaf.ts -> react");
      expect(target(entry, "@/contracts/shared/ids")).toBe(
        resolve(root, "src/contracts/shared/ids.ts"),
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it.each([
    "src/application/editor/editor-event-loop.ts",
    "src/composition/headless.ts",
    "src/cli/commands/document-recipes.ts",
  ])(
    "keeps %s transitively browser independent with command/composition layering",
    (entry) => {
      expect(violations(entry)).toEqual([]);
    },
  );
});
