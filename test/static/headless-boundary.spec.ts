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
type RuntimeImport =
  | { kind: "literal"; specifier: string }
  | { kind: "computed"; call: ts.CallExpression };
function runtimeImports(file: string): RuntimeImport[] {
  const ast = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const imports: RuntimeImport[] = [];
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
        imports.push({ kind: "literal", specifier: node.moduleSpecifier.text });
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
      imports.push({ kind: "literal", specifier: node.moduleSpecifier.text });
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0]
    ) {
      const argument = node.arguments[0];
      imports.push(
        ts.isStringLiteralLike(argument)
          ? { kind: "literal", specifier: argument.text }
          : { kind: "computed", call: node },
      );
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return imports;
}
// Computed edges remain visible. Only the two existing production artifact
// loaders may cross this boundary, with their URL binding and validation intact.
function qualifiedAssetImport(file: string, call: ts.CallExpression): boolean {
  let scope: ts.Node | undefined = call.parent;
  while (scope && !ts.isFunctionLike(scope)) scope = scope.parent;
  if (!scope || !ts.isFunctionDeclaration(scope) || !scope.body) return false;
  const nodes: ts.Node[] = [];
  function visit(node: ts.Node) {
    nodes.push(node);
    ts.forEachChild(node, visit);
  }
  visit(scope.body);
  const constants = new Map<string, ts.Expression>();
  for (const statement of scope.body.statements) {
    if (
      !ts.isVariableStatement(statement) ||
      !(statement.declarationList.flags & ts.NodeFlags.Const)
    )
      continue;
    for (const declaration of statement.declarationList.declarations)
      if (ts.isIdentifier(declaration.name) && declaration.initializer)
        constants.set(declaration.name.text, declaration.initializer);
  }
  const identifier = (node: ts.Node | undefined, name: string) =>
    !!node && ts.isIdentifier(node) && node.text === name;
  function namedCall(node: ts.Node | undefined, name: string, args: string[]) {
    return (
      !!node &&
      ts.isCallExpression(node) &&
      identifier(node.expression, name) &&
      node.arguments.length === args.length &&
      node.arguments.every(
        (arg, i) =>
          (ts.isStringLiteralLike(arg)
            ? JSON.stringify(arg.text)
            : arg.getText()) === args[i],
      )
    );
  }
  function property(
    node: ts.Node | undefined,
    name: string,
  ): node is ts.PropertyAccessExpression {
    return (
      !!node && ts.isPropertyAccessExpression(node) && node.name.text === name
    );
  }
  const validated = (name: string) =>
    nodes.some((node) => {
      if (!ts.isIfStatement(node) || !ts.isBinaryExpression(node.expression))
        return false;
      const check = node.expression;
      return (
        check.operatorToken.kind ===
          ts.SyntaxKind.ExclamationEqualsEqualsToken &&
        ts.isTypeOfExpression(check.left) &&
        identifier(check.left.expression, name) &&
        ts.isStringLiteral(check.right) &&
        check.right.text === "function" &&
        nodes.some(
          (child) =>
            ts.isThrowStatement(child) && child.parent === node.thenStatement,
        )
      );
    });
  const wrapped = (name: string) =>
    nodes.some(
      (node) =>
        ts.isCallExpression(node) &&
        identifier(
          node.expression,
          "createProductionOpenCascadeInitializerFromMainJS",
        ) &&
        identifier(node.arguments[0], name),
    );
  const argument = call.arguments[0];
  const from = relative(root, file);
  if (
    from === "src/infrastructure/occ/filesystem-kernel-runtime.ts" &&
    scope.name?.text === "loadFilesystemOpenCascadeFactory" &&
    identifier(argument, "mainJSUrl")
  ) {
    const url = constants.get("mainJSUrl");
    const tuple = nodes.find(
      (node) =>
        ts.isVariableDeclaration(node) &&
        ts.isArrayBindingPattern(node.name) &&
        node.name.getText().replace(/\s/g, "") ===
          "[{default:mainJS},wasmBinary]",
    ) as ts.VariableDeclaration | undefined;
    const paired =
      tuple?.initializer &&
      ts.isAwaitExpression(tuple.initializer) &&
      ts.isCallExpression(tuple.initializer.expression)
        ? tuple.initializer.expression
        : undefined;
    const inputs = paired?.arguments[0];
    return (
      namedCall(constants.get("mainJSPath"), "resolve", [
        "assetDirectory",
        '"cadara-occ.js"',
      ]) &&
      namedCall(constants.get("mainWasmPath"), "resolve", [
        "assetDirectory",
        '"cadara-occ.wasm"',
      ]) &&
      property(url, "href") &&
      namedCall(url.expression, "pathToFileURL", ["mainJSPath"]) &&
      !!paired &&
      paired.expression.getText() === "Promise.all" &&
      !!inputs &&
      ts.isArrayLiteralExpression(inputs) &&
      inputs.elements[0] === call &&
      namedCall(inputs.elements[1], "readFile", ["mainWasmPath"]) &&
      validated("mainJS") &&
      wrapped("mainJS")
    );
  }
  if (
    from === "src/infrastructure/occ/runtime.ts" &&
    scope.name?.text === "loadBrowserOpenCascadeModule" &&
    identifier(argument, "customMainJSImportUrl")
  ) {
    const url = constants.get("customMainJSImportUrl");
    const value = constants.get("customMainJS");
    const module = constants.get("customMainJSModule");
    return (
      property(url, "mainJS") &&
      namedCall(
        url.expression,
        "getVersionedOpenCascadeRuntimeAssetUrls",
        [],
      ) &&
      property(value, "default") &&
      identifier(value.expression, "customMainJSModule") &&
      !!module &&
      ts.isAsExpression(module) &&
      ts.isParenthesizedExpression(module.expression) &&
      ts.isAwaitExpression(module.expression.expression) &&
      module.expression.expression.expression === call &&
      validated("customMainJS") &&
      wrapped("customMainJS")
    );
  }
  return false;
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
  const resolver =
    resolve(root, entry) ===
    resolve(root, "src/application/semantic/target-resolution.ts");
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
    for (const edge of runtimeImports(file)) {
      if (edge.kind === "computed") {
        if (!qualifiedAssetImport(file, edge.call))
          failures.push(
            `${from} -> unqualified computed import ${edge.call.getText()}`,
          );
        continue;
      }
      const specifier = edge.specifier;
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
      if (nativeFilePolicyViolation(from, specifier))
        failures.push(`${from} -> filesystem adapter ${specifier}`);
      if (terminalPolicyViolation(from, specifier, resolver))
        failures.push(`${from} -> terminal adapter ${specifier}`);
      if (resolved) pending.push(resolved);
    }
  }
  return failures;
}
function terminalPolicyViolation(
  from: string,
  specifier: string,
  resolver: boolean,
): boolean {
  return (
    (resolver || /^src\/application\/semantic\//.test(from)) &&
    /^(?:node:)?(?:readline|tty|console|process)(?:\/|$)/.test(specifier)
  );
}
function nativeFilePolicyViolation(from: string, specifier: string): boolean {
  return (
    /^src\/application\/semantic\//.test(from) &&
    /^(?:node:)?fs(?:\/|$)/.test(specifier)
  );
}
function sharedCliViolations(file: string) {
  return runtimeImports(file).flatMap((edge) => {
    if (edge.kind === "computed")
      return qualifiedAssetImport(file, edge.call)
        ? []
        : [
            `${relative(root, file)} -> unqualified computed import ${edge.call.getText()}`,
          ];
    const resolved = target(file, edge.specifier);
    return resolved && relative(root, resolved).startsWith("src/cli/")
      ? [`${relative(root, file)} -> ${edge.specifier}`]
      : [];
  });
}
describe("headless transitive runtime boundary", () => {
  it.each(["readline", "readline/promises", "tty", "console", "process"])(
    "keeps semantic selection and its transitive dependencies independent of %s",
    (specifier) => {
      for (const terminal of [specifier, `node:${specifier}`]) {
        expect(
          terminalPolicyViolation("src/application/semantic/target-resolution.ts", terminal, false),
        ).toBe(true);
        expect(
          terminalPolicyViolation("src/contracts/selection.ts", terminal, true),
        ).toBe(true);
        expect(
          terminalPolicyViolation("src/cli/main.ts", terminal, false),
        ).toBe(false);
      }
      expect(
        terminalPolicyViolation("src/application/semantic/target-resolution.ts", "./selection-error", true),
      ).toBe(false);
    },
  );
  it("keeps filesystem bytes and operations in adapters, not semantic application owners", () => {
    const directory = mkdtempSync(
      resolve(root, "src/application/semantic/.native-file-policy-"),
    );
    try {
      const file = resolve(directory, "files.ts");
      writeFileSync(
        file,
        'import { readFile } from "node:fs/promises"; export { open } from "fs/promises";',
      );
      expect(violations(file)).toEqual([
        expect.stringContaining("filesystem adapter node:fs/promises"),
        expect.stringContaining("filesystem adapter fs/promises"),
      ]);
      expect(violations(resolve(root, "src/composition/headless.ts"))).toEqual(
        [],
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it.each([
    [
      "src/infrastructure/occ/filesystem-kernel-runtime.ts",
      '"cadara-occ.js"',
      '"arbitrary.js"',
    ],
    [
      "src/infrastructure/occ/filesystem-kernel-runtime.ts",
      'typeof mainJS !== "function"',
      'typeof mainJS !== "object"',
    ],
    ["src/infrastructure/occ/runtime.ts", ".mainJS;", ".arbitrary;"],
  ])(
    "qualifies only the intact validated production asset loader %s",
    (path, original, changed) => {
      const file = resolve(root, path);
      const text = readFileSync(file, "utf8");
      function computed(source: string) {
        const ast = ts.createSourceFile(
          file,
          source,
          ts.ScriptTarget.Latest,
          true,
        );
        let call: ts.CallExpression | undefined;
        function visit(node: ts.Node) {
          if (ts.isImportTypeNode(node)) return;
          if (
            ts.isCallExpression(node) &&
            node.expression.kind === ts.SyntaxKind.ImportKeyword &&
            node.arguments[0] &&
            !ts.isStringLiteralLike(node.arguments[0])
          )
            call = node;
          ts.forEachChild(node, visit);
        }
        visit(ast);
        if (!call)
          throw new Error("Expected the production computed asset edge");
        return call;
      }
      expect(qualifiedAssetImport(file, computed(text))).toBe(true);
      expect(text).toContain(original);
      expect(
        qualifiedAssetImport(file, computed(text.replace(original, changed))),
      ).toBe(false);
      expect(
        qualifiedAssetImport(
          resolve(root, "src/infrastructure/other-loader.ts"),
          computed(text),
        ),
      ).toBe(false);
    },
  );
  it.each(["browser template", "shared CLI template", "unknown computed"])(
    "qualifies %s runtime imports without counting type queries",
    (kind) => {
      const directory = mkdtempSync(
        resolve(tmpdir(), "cadara-template-boundary-"),
      );
      try {
        const browser = resolve(directory, "browser.ts");
        writeFileSync(
          browser,
          'void import(`react-dom/client`); type T = import("three").Vector2;',
        );
        if (kind === "browser template")
          expect(violations(browser)).toEqual([
            expect.stringContaining("react-dom/client"),
          ]);
        const shared = resolve(directory, "shared.ts");
        writeFileSync(
          shared,
          'type T = typeof import("@/cli/main"); void import(`@/cli/main`);',
        );
        if (kind === "shared CLI template")
          expect(sharedCliViolations(shared)).toEqual([
            expect.stringContaining("@/cli/main"),
          ]);
        const computed = resolve(directory, "computed.ts");
        writeFileSync(
          computed,
          "const candidate = getModule(); void import(candidate);",
        );
        if (kind === "unknown computed")
          expect(violations(computed)).toEqual([
            expect.stringContaining("unqualified computed import"),
          ]);
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
  );
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
          offenders.push(...sharedCliViolations(path));
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
      expect(runtimeImports(entry)).toEqual([
        { kind: "literal", specifier: "./leaf" },
      ]);
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
    "src/application/semantic/target-resolution.ts",
    "src/composition/headless.ts",
    "src/cli/commands/document-recipes.ts",
  ])(
    "keeps %s transitively browser independent with command/composition layering",
    (entry) => {
      expect(violations(entry)).toEqual([]);
    },
  );
});
