import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import ts from "typescript";
import { test, expect } from "vitest";

const ROOT = process.cwd();

function walk(directory: string): string[] {
  try {
    const entries = readdirSync(directory);
    const files: string[] = [];

    for (const entry of entries) {
      const entryPath = join(directory, entry);
      const entryStat = statSync(entryPath);

      if (entryStat.isDirectory()) {
        files.push(...walk(entryPath));
        continue;
      }

      files.push(entryPath);
    }

    return files;
  } catch {
    return [];
  }
}

function isTestSupport(filePath: string) {
  return /\.(?:spec\.(?:ts|tsx)|fixtures\.ts|cases\.ts)$/.test(filePath);
}

function getLayerFiles(layerRoot: string) {
  return walk(join(ROOT, layerRoot)).filter(
    (filePath) => /\.(ts|tsx)$/.test(filePath) && !isTestSupport(filePath),
  );
}

test("production source does not import test-support modules", () => {
  const offenders: string[] = [];
  for (const filePath of getLayerFiles("src")) {
    const source = ts.createSourceFile(
      filePath,
      readFileSync(filePath, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    function visit(node: ts.Node) {
      let specifier: string | undefined;
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        specifier = node.moduleSpecifier.text;
      } else if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0])
      ) {
        specifier = node.arguments[0].text;
      } else if (
        ts.isImportTypeNode(node) &&
        ts.isLiteralTypeNode(node.argument) &&
        ts.isStringLiteral(node.argument.literal)
      ) {
        specifier = node.argument.literal.text;
      }
      if (specifier) {
        const target = specifier.startsWith("@/")
          ? join(ROOT, "src", specifier.slice(2))
          : resolve(dirname(filePath), specifier);
        if (/\.(?:fixtures|cases)(?:\.ts)?$/.test(target)) {
          offenders.push(`${relative(ROOT, filePath)} -> ${specifier}`);
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  expect(offenders, "Production source must not import test support").toEqual(
    [],
  );
});

function browserGlobalReferences(filePath: string, text: string): string[] {
  const source = ts.createSourceFile(
    filePath,
    text,
    ts.ScriptTarget.Latest,
    true,
  );
  // Resolve local bindings without loading imported modules or ambient DOM declarations.
  const program = ts.createProgram(
    [filePath],
    { noLib: true, noResolve: true },
    {
      ...ts.createCompilerHost({}),
      getSourceFile: (name) => (name === filePath ? source : undefined),
    },
  );
  const checker = program.getTypeChecker();
  const browserGlobals = new Set([
    "window",
    "document",
    "self",
    "localStorage",
    "sessionStorage",
    "navigator",
    "indexedDB",
    "BroadcastChannel",
    "Worker",
  ]);
  const references: string[] = [];
  function isGlobal(node: ts.Identifier) {
    const symbol = ts.isShorthandPropertyAssignment(node.parent)
      ? checker.getShorthandAssignmentValueSymbol(node.parent)
      : checker.getSymbolAtLocation(node);
    return !symbol?.declarations?.some(
      (declaration) => declaration.getSourceFile() === source,
    );
  }
  function globalObjectName(expression: ts.Expression): string | undefined {
    while (
      ts.isParenthesizedExpression(expression) ||
      ts.isAsExpression(expression) ||
      ts.isTypeAssertionExpression(expression) ||
      ts.isNonNullExpression(expression) ||
      ts.isSatisfiesExpression(expression)
    ) {
      expression = expression.expression;
    }
    return ts.isIdentifier(expression) &&
      (expression.text === "globalThis" || expression.text === "self") &&
      isGlobal(expression)
      ? expression.text
      : undefined;
  }
  function propertyName(name: ts.PropertyName): string | undefined {
    if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
    if (
      ts.isComputedPropertyName(name) &&
      ts.isStringLiteral(name.expression)
    ) {
      return name.expression.text;
    }
    return undefined;
  }
  function visit(node: ts.Node) {
    if (ts.isTypeNode(node)) return;
    if (
      ts.isIdentifier(node) &&
      browserGlobals.has(node.text) &&
      !(
        (ts.isPropertyAccessExpression(node.parent) &&
          node.parent.name === node) ||
        (ts.isBindingElement(node.parent) && node.parent.propertyName === node)
      ) &&
      isGlobal(node)
    ) {
      references.push(node.text);
    }
    if (
      ts.isPropertyAccessExpression(node) ||
      ts.isElementAccessExpression(node)
    ) {
      const receiver = globalObjectName(node.expression);
      const name = ts.isPropertyAccessExpression(node)
        ? node.name.text
        : node.argumentExpression && ts.isStringLiteral(node.argumentExpression)
          ? node.argumentExpression.text
          : undefined;
      if (receiver && name && browserGlobals.has(name)) {
        references.push(`${receiver}.${name}`);
      }
    }
    if (
      (ts.isVariableDeclaration(node) ||
        ts.isParameter(node) ||
        ts.isBindingElement(node)) &&
      ts.isObjectBindingPattern(node.name) &&
      node.initializer
    ) {
      const receiver = globalObjectName(node.initializer);
      if (receiver) {
        for (const element of node.name.elements) {
          const name = element.propertyName
            ? propertyName(element.propertyName)
            : ts.isIdentifier(element.name)
              ? element.name.text
              : undefined;
          if (!element.dotDotDotToken && name && browserGlobals.has(name)) {
            references.push(`${receiver}.${name}`);
          }
        }
      }
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isObjectLiteralExpression(node.left)
    ) {
      const receiver = globalObjectName(node.right);
      if (receiver) {
        for (const property of node.left.properties) {
          const name = property.name && propertyName(property.name);
          if (name && browserGlobals.has(name))
            references.push(`${receiver}.${name}`);
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return references;
}

test("browser-global guard resolves runtime references rather than local names", () => {
  for (const text of [
    "window.foo",
    "const x = { [window.name]: 1 };",
    "document.body",
    "navigator.platform",
    "sessionStorage.getItem('key')",
    "globalThis.navigator.platform",
    "globalThis.sessionStorage.getItem('key')",
    "globalThis.window",
    "const { document } = globalThis; document.body;",
    "let document; ({ document } = globalThis); document.body;",
    "let storage; ({ localStorage: storage } = globalThis);",
    "function f({ document } = globalThis) { return document.body; }",

    "const { localStorage: storage } = globalThis; storage.getItem('key');",
    "const { ['window']: browser } = (globalThis); browser.location;",
    "(globalThis).window.location;",
    "(globalThis as typeof globalThis).window.location;",
    "globalThis!.window.location;",
    "(globalThis satisfies unknown).window.location;",
    "(<typeof globalThis>globalThis).window.location;",
    "self.window",
    "globalThis['document'].body",
    "new Worker('worker.js')",
    "const value = { window };",
    "function f() { return window.foo; }",
    "function f() { const window = { foo: 1 }; } window.foo;",
  ]) {
    expect(browserGlobalReferences("control.ts", text), text).not.toEqual([]);
  }
  for (const text of [
    "const window = { coneHigh: 1 }; window.coneHigh;",
    "const navigator = { platform: 'MacIntel' }; navigator.platform;",
    "function f(navigator: { platform: string }) { return navigator.platform; }",
    "const sessionStorage = { getItem: () => null }; sessionStorage.getItem('key');",
    "function f(window: { coneHigh: number }) { return window.coneHigh; }",
    "const x = { window: 1 }; x.window;",
    "const { window: value } = input;",
    "type WindowValue = typeof window; interface Shape { window: string }",
    "const window = 1; const value = { window };",
    "function f() { const globalThis = { window: 1 }; return globalThis.window; }",
    "function f(globalThis: { document: unknown }) { const { document } = globalThis; return document; }",
    "function f(globalThis: { localStorage: unknown }) { const { localStorage: storage } = globalThis; return storage; }",
    "function f(globalThis: { window: unknown }) { return (globalThis).window; }",
    "const local = { window: 1 }; (local).window;",
    "function f(globalThis: { document: unknown }) { let document; ({ document } = globalThis); return document; }",

    "function f() { const window = { foo: 1 }; return { window }; }",
    "function f() { const window = { foo: 1 }; return window.foo; }",
  ]) {
    expect(browserGlobalReferences("control.ts", text), text).toEqual([]);
  }
});

test("src/layer-architecture-boundary.spec.ts core stays framework and browser free", () => {
  const offenders: string[] = [];

  for (const filePath of getLayerFiles("src/core")) {
    const source = readFileSync(filePath, "utf8");
    if (
      source.includes("from 'react'") ||
      source.includes('from "react"') ||
      source.includes("@mantine/") ||
      source.includes("from 'three'") ||
      source.includes('from "three"') ||
      source.includes("@react-three/") ||
      browserGlobalReferences(filePath, source).length > 0 ||
      source.includes("from '@/app/") ||
      source.includes('from "@/app/') ||
      source.includes("from '@/hooks/") ||
      source.includes('from "@/hooks/') ||
      source.includes("from '@/components/") ||
      source.includes('from "@/components/') ||
      source.includes("from '@/application/") ||
      source.includes('from "@/application/') ||
      source.includes("from '@/infrastructure/") ||
      source.includes('from "@/infrastructure/')
    ) {
      offenders.push(relative(ROOT, filePath));
    }
  }

  expect(
    offenders.length,
    `Core modules must remain framework-, browser-, and adapter-free.\n${offenders.join("\n")}`,
  ).toBe(0);
});

test("src/layer-architecture-boundary.spec.ts application stays React free", () => {
  const offenders: string[] = [];

  for (const filePath of getLayerFiles("src/application")) {
    const source = readFileSync(filePath, "utf8");
    if (
      source.includes("from 'react'") ||
      source.includes('from "react"') ||
      source.includes("from '@/hooks/") ||
      source.includes('from "@/hooks/') ||
      source.includes("from '@/components/") ||
      source.includes('from "@/components/')
    ) {
      offenders.push(relative(ROOT, filePath));
    }
  }

  expect(
    offenders.length,
    `Application modules must not depend on React hooks or UI components.\n${offenders.join("\n")}`,
  ).toBe(0);
});

test("src/layer-architecture-boundary.spec.ts infrastructure stays outside UI composition", () => {
  const offenders: string[] = [];

  for (const filePath of getLayerFiles("src/infrastructure")) {
    const source = readFileSync(filePath, "utf8");
    if (
      source.includes("from '@/app/") ||
      source.includes('from "@/app/') ||
      source.includes("from '@/hooks/") ||
      source.includes('from "@/hooks/') ||
      source.includes("from '@/components/") ||
      source.includes('from "@/components/')
    ) {
      offenders.push(relative(ROOT, filePath));
    }
  }

  expect(
    offenders.length,
    `Infrastructure modules must not depend on React hooks or UI components.\n${offenders.join("\n")}`,
  ).toBe(0);
});

test("src/layer-architecture-boundary.spec.ts migrated compatibility entrypoints stay deleted", () => {
  const removedEntrypoints = [
    "src/domain/tools/index.ts",
    "src/domain/shortcuts/index.ts",
    "src/domain/workspace/index.ts",
    "src/domain/section-view/index.ts",
    "src/domain/sketch-special-modes/index.ts",
  ];
  const offenders = removedEntrypoints.filter((filePath) => {
    try {
      statSync(join(ROOT, filePath));
      return true;
    } catch {
      return false;
    }
  });

  expect(
    offenders.length,
    `Migrated compatibility entrypoints must be deleted.\n${offenders.join("\n")}`,
  ).toBe(0);
});

test("src/layer-architecture-boundary.spec.ts core domain dependency debt stays explicit", () => {
  const allowedCoreDomainImports = new Set([
    "src/core/editor/state-machine/dependencies.ts",
  ]);
  const offenders: string[] = [];

  for (const filePath of getLayerFiles("src/core")) {
    const relativePath = relative(ROOT, filePath);
    const source = readFileSync(filePath, "utf8");
    const importsDomain =
      source.includes("from '@/domain/") ||
      source.includes('from "@/domain/') ||
      source.includes("import('@/domain/") ||
      source.includes('import("@/domain/');

    if (importsDomain && !allowedCoreDomainImports.has(relativePath)) {
      offenders.push(relativePath);
    }
  }

  expect(
    offenders.length,
    `New core modules must not depend on domain. Move the dependency to core/application, or explicitly retire existing debt first.\n${offenders.join("\n")}`,
  ).toBe(0);
});
