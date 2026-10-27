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

test("src/layer-architecture-boundary.spec.ts core stays framework and browser free", () => {
  const offenders: string[] = [];
  const browserDocumentPattern =
    /\bdocument\.(createElement|documentElement|querySelector|getElementById|body|head)\b/;

  for (const filePath of getLayerFiles("src/core")) {
    const source = readFileSync(filePath, "utf8");
    if (
      source.includes("from 'react'") ||
      source.includes('from "react"') ||
      source.includes("@mantine/") ||
      source.includes("from 'three'") ||
      source.includes('from "three"') ||
      source.includes("@react-three/") ||
      /\bwindow\./.test(source) ||
      browserDocumentPattern.test(source) ||
      source.includes("localStorage") ||
      source.includes("indexedDB") ||
      source.includes("BroadcastChannel") ||
      /\bnew Worker\(/.test(source) ||
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
    "src/core/editor/state-machine/document-helpers.ts",
    "src/core/editor/state-machine/effect-emitters.ts",
    "src/core/editor/state-machine/form-traversal.ts",
    "src/core/editor/state-machine/reducer-root.ts",
    "src/core/editor/state-machine/state-creators.ts",
    "src/core/editor/state-machine/transitions-effects.ts",
    "src/core/editor/state-machine/transitions-feature.ts",
    "src/core/editor/state-machine/transitions-sketch.ts",
    "src/core/editor/state-machine/transitions-viewport.ts",
    "src/core/editor/state-machine/types.ts",
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
