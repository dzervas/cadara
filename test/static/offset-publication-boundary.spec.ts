import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { expect, test } from "vitest";
import ts from "typescript";

/**
 * Policy guard (T17o, I2; T08b-g1 review R1). A certified offset publication
 * is a class instance (`CertifiedOffsetFramePublication`) whose protected
 * nominal member makes a literal, a spread (`{ ...publication, frame }`)
 * or a destructured copy fail to type-check as one, and the class is
 * exported as a type only, so only `publishOffsetFrame` constructs it. The
 * one remaining way to spread or rebuild a publication outside
 * `publishOffsetFrame` is to forge the type, which this guard forbids in
 * production code:
 * - `new CertifiedOffsetFramePublication(…)` outside its owner module;
 * - a value export of the class (only `export type { … }`);
 * - a type assertion (`as`, `<T>`) or `satisfies` naming a publication
 *   type (`CertifiedOffsetFramePublication` / `OffsetFramePublication`).
 * Specs are exempt (they forge on purpose to test the brand).
 */

const OWNER = "src/contracts/sketch/offset-derivation-frame.ts";
const CLASS_NAME = "CertifiedOffsetFramePublication";
const PUBLICATION_TYPES = new Set([CLASS_NAME, "OffsetFramePublication"]);

const isSpec = (path: string) => /\.spec\.tsx?$/.test(path);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return [".ts", ".tsx"].includes(extname(path)) ? [path] : [];
  });
}

function namesPublicationType(node: ts.TypeNode): boolean {
  let found = false;
  const visit = (child: ts.Node) => {
    if (
      ts.isTypeReferenceNode(child) &&
      PUBLICATION_TYPES.has(child.typeName.getText())
    )
      found = true;
    ts.forEachChild(child, visit);
  };
  visit(node);
  return found;
}

function offences(path: string, text: string): string[] {
  const source = ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const found: string[] = [];
  const at = (node: ts.Node, what: string) =>
    found.push(
      `${path}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}: ${what}`,
    );
  const visit = (node: ts.Node) => {
    if (
      ts.isNewExpression(node) &&
      node.expression.getText() === CLASS_NAME &&
      path !== OWNER
    )
      at(node, `constructs ${CLASS_NAME} outside publishOffsetFrame`);
    if (
      (ts.isAsExpression(node) ||
        ts.isTypeAssertionExpression(node) ||
        ts.isSatisfiesExpression(node)) &&
      namesPublicationType(node.type)
    )
      at(node, "forges an offset publication with a type assertion");
    if (
      ts.isClassDeclaration(node) &&
      node.name?.text === CLASS_NAME &&
      (ts.getModifiers(node) ?? []).some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      )
    )
      at(node, `exports the ${CLASS_NAME} class as a value`);
    if (
      ts.isExportDeclaration(node) &&
      !node.isTypeOnly &&
      node.exportClause &&
      ts.isNamedExports(node.exportClause) &&
      node.exportClause.elements.some(
        (element) =>
          !element.isTypeOnly &&
          (element.propertyName ?? element.name).text === CLASS_NAME,
      )
    )
      at(node, `exports the ${CLASS_NAME} class as a value`);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

test("test/static/offset-publication-boundary.spec.ts offset publications are never forged, spread or rebuilt outside publishOffsetFrame", () => {
  // The scanner itself.
  expect(
    offences(
      "src/x.ts",
      "const forged = { ...publication, frame } as CertifiedOffsetFramePublication;",
    ),
  ).toEqual(["src/x.ts:1: forges an offset publication with a type assertion"]);
  expect(
    offences(
      "src/x.ts",
      "const forged = <OffsetFramePublication>(<unknown>{ status: 'certified' });",
    ),
  ).toEqual(["src/x.ts:1: forges an offset publication with a type assertion"]);
  expect(
    offences(
      "src/x.ts",
      "const p = new CertifiedOffsetFramePublication(id, frame, certified, plan);",
    ),
  ).toEqual([
    "src/x.ts:1: constructs CertifiedOffsetFramePublication outside publishOffsetFrame",
  ]);
  expect(
    offences(
      OWNER,
      "const p = new CertifiedOffsetFramePublication(a, b, c, d);",
    ),
    "the owner constructs it",
  ).toEqual([]);
  expect(
    offences(OWNER, "export { CertifiedOffsetFramePublication };"),
  ).toEqual([
    `${OWNER}:1: exports the CertifiedOffsetFramePublication class as a value`,
  ]);
  expect(
    offences(OWNER, "export type { CertifiedOffsetFramePublication };"),
  ).toEqual([]);

  const root = process.cwd();
  const files = sourceFiles(join(root, "src"))
    .map((path) => relative(root, path).replaceAll("\\", "/"))
    .filter((path) => !isSpec(path));
  expect(files, "the guard reads the owner").toContain(OWNER);
  expect(
    files.flatMap((path) =>
      offences(path, readFileSync(join(root, path), "utf8")),
    ),
    "Offset publications are constructed only by publishOffsetFrame; never forge, spread or rebuild one.",
  ).toEqual([]);
});
