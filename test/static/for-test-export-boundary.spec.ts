import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { expect, test } from "vitest";
import ts from "typescript";

/**
 * Architecture guard: test-only exports (`…ForTest`, e.g. the memo-free
 * `solveOffsetFrameWithoutMemoForTest`, the policy-injecting
 * `certifyDeclaredOffsetChainWithPolicyForTest` and the lower-budget /
 * budget-observer certifier factories) bypass production invariants, so
 * production code must never reach one.
 *
 * Production modules are those reachable from the shipped entry points (the
 * app's `index.html` script and the CLI), following static and dynamic
 * imports, re-exports and `new Worker(new URL(…, import.meta.url))` worker
 * entries. Specs, fixtures and test builders are therefore excluded unless
 * production code actually imports them (asserted below).
 *
 * Each `…ForTest` name is owned by the one production module that exports a
 * top-level declaration of it. A `…ForTest` identifier anywhere else in
 * production (an import, a namespace member, a local alias or a same-named
 * wrapper) is an offence, and so is its owner using it outside its own
 * `…ForTest` declarations (e.g. aliasing or re-exporting it under another
 * name). A string literal naming a `…ForTest` (element access, a dynamic
 * key) is an offence in any production module. Comments are ignored.
 */

const ROOT = process.cwd();
const SRC = join(ROOT, "src");
const ENTRY_POINTS = ["src/main.tsx", "src/cli/main.ts"];
const SOURCE_EXTENSIONS = [".ts", ".tsx"];
const TEST_EXPORT = /ForTest$/;
const TEST_EXPORT_TEXT = /ForTest\b/;
const TEST_ONLY_MODULE =
  /(\.spec\.tsx?|\.fixtures\.ts|-test-builder\.ts|\/test-[^/]*\.ts)$/;

function resolveModule(fromFile: string, specifier: string): string | null {
  const bare = specifier.replace(/\?.*$/, "");
  const base = bare.startsWith("@/")
    ? join(SRC, bare.slice(2))
    : bare.startsWith(".")
      ? resolve(dirname(fromFile), bare)
      : null;
  if (!base) return null;
  const candidates = [
    base,
    ...SOURCE_EXTENSIONS.map((extension) => `${base}${extension}`),
    ...SOURCE_EXTENSIONS.map((extension) => join(base, `index${extension}`)),
    base.replace(/\.js$/, ".ts"),
  ];
  return (
    candidates.find(
      (candidate) =>
        SOURCE_EXTENSIONS.some((extension) => candidate.endsWith(extension)) &&
        existsSync(candidate) &&
        statSync(candidate).isFile(),
    ) ?? null
  );
}

interface TestNameReference {
  readonly name: string;
  /** Inside a top-level declaration that is itself named `…ForTest`. */
  readonly inTestDeclaration: boolean;
}

/** One top-level declaration unit (a variable statement splits per declarator). */
function topLevelUnits(source: ts.SourceFile) {
  return source.statements.flatMap((statement) => {
    const exported =
      ts.canHaveModifiers(statement) &&
      (ts.getModifiers(statement) ?? []).some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      );
    if (ts.isVariableStatement(statement))
      return statement.declarationList.declarations.map((declaration) => ({
        node: declaration as ts.Node,
        name: ts.isIdentifier(declaration.name) ? declaration.name.text : null,
        exported,
      }));
    const name =
      (ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isInterfaceDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement) ||
        ts.isEnumDeclaration(statement)) &&
      statement.name
        ? statement.name.text
        : null;
    return [{ node: statement as ts.Node, name, exported }];
  });
}

function scanModule(filePath: string) {
  const source = ts.createSourceFile(
    filePath,
    readFileSync(filePath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const specifiers: string[] = [];
  const testExports: string[] = [];
  const references: TestNameReference[] = [];
  const testNameStrings: string[] = [];

  function visit(node: ts.Node, inTestDeclaration: boolean) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text);
    } else if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "URL" &&
      node.arguments?.[0] &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      node.arguments[1]?.getText(source) === "import.meta.url"
    ) {
      specifiers.push(node.arguments[0].text);
    }
    if (ts.isIdentifier(node) && TEST_EXPORT.test(node.text)) {
      references.push({ name: node.text, inTestDeclaration });
    }
    if (
      (ts.isStringLiteralLike(node) ||
        ts.isTemplateHead(node) ||
        ts.isTemplateMiddle(node) ||
        ts.isTemplateTail(node)) &&
      TEST_EXPORT_TEXT.test(node.text)
    ) {
      testNameStrings.push(node.text);
    }
    ts.forEachChild(node, (child) => visit(child, inTestDeclaration));
  }
  for (const unit of topLevelUnits(source)) {
    const isTestDeclaration = unit.name !== null && TEST_EXPORT.test(unit.name);
    if (isTestDeclaration && unit.exported) testExports.push(unit.name!);
    visit(unit.node, isTestDeclaration);
  }

  return { specifiers, testExports, references, testNameStrings };
}

function collectProductionModules() {
  const reached = new Map<string, ReturnType<typeof scanModule>>();
  const pending = ENTRY_POINTS.map((entry) => join(ROOT, entry));
  while (pending.length > 0) {
    const filePath = pending.pop()!;
    if (reached.has(filePath)) continue;
    const scanned = scanModule(filePath);
    reached.set(filePath, scanned);
    for (const specifier of scanned.specifiers) {
      const target = resolveModule(filePath, specifier);
      if (target && !reached.has(target)) pending.push(target);
    }
  }
  return reached;
}

test("test/static/for-test-export-boundary.spec.ts production modules never reach a *ForTest export", () => {
  const modules = new Map(
    [...collectProductionModules()].map(([filePath, scanned]) => [
      relative(ROOT, filePath),
      scanned,
    ]),
  );

  // The graph must reach the offset owners and the worker entries, and no
  // spec, fixture or test builder.
  for (const required of [
    "src/contracts/sketch/offset-derivation-frame.ts",
    "src/contracts/sketch/offset-chain-topology.ts",
    "src/domain/modeling/neutral-curve-certification/cubic-tube-chain.ts",
    "src/domain/modeling/occ/sketch-derivation.worker.ts",
    "src/domain/modeling/occ/worker.ts",
    "src/infrastructure/workers/document-sync.worker.ts",
  ]) {
    expect(modules.has(required), `${required} is not reached`).toBe(true);
  }
  expect(
    [...modules.keys()].filter((filePath) => TEST_ONLY_MODULE.test(filePath)),
    "Production modules must not import specs, fixtures or test builders.",
  ).toEqual([]);

  const owners = new Map<string, string[]>();
  for (const [filePath, scanned] of modules)
    for (const name of scanned.testExports)
      owners.set(name, [...(owners.get(name) ?? []), filePath]);
  expect(
    owners.size,
    "the owner map finds the known test seams",
  ).toBeGreaterThanOrEqual(3);

  const offenders = [
    ...[...owners]
      .filter(([, files]) => files.length > 1)
      .map(
        ([name, files]) =>
          `${name}: exported by more than one production module (${files.join(", ")})`,
      ),
    ...[...modules].flatMap(([filePath, scanned]) => [
      ...scanned.references.flatMap(({ name, inTestDeclaration }) => {
        const owner = owners.get(name);
        if (owner?.length === 1 && owner[0] === filePath)
          return inTestDeclaration
            ? []
            : [
                `${filePath}: ${name} used by its owner outside a *ForTest declaration`,
              ];
        return [
          `${filePath}: ${name} referenced outside its owner (${owner?.join(", ") ?? "no exported *ForTest declaration"})`,
        ];
      }),
      ...scanned.testNameStrings.map(
        (text) => `${filePath}: string literal naming a *ForTest: "${text}"`,
      ),
    ]),
  ];
  expect(
    [...new Set(offenders)],
    `Production modules must not reach test-only (*ForTest) exports.\n${offenders.join("\n")}`,
  ).toEqual([]);
});
