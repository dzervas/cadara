import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "bun:test";

import { expectTrue } from "@/testing/expect.spec";
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

function getLayerFiles(layerRoot: string) {
  return walk(join(ROOT, layerRoot)).filter(
    (filePath) =>
      /\.(ts|tsx)$/.test(filePath) && !/\.spec\.(ts|tsx)$/.test(filePath),
  );
}

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

  expectTrue(
    offenders.length === 0,
    `Core modules must remain framework-, browser-, and adapter-free.\n${offenders.join("\n")}`,
  );
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

  expectTrue(
    offenders.length === 0,
    `Application modules must not depend on React hooks or UI components.\n${offenders.join("\n")}`,
  );
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

  expectTrue(
    offenders.length === 0,
    `Infrastructure modules must not depend on UI composition layers.\n${offenders.join("\n")}`,
  );
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

  expectTrue(
    offenders.length === 0,
    `Migrated compatibility entrypoints must stay deleted.\n${offenders.join("\n")}`,
  );
});

test("src/layer-architecture-boundary.spec.ts core domain dependency debt stays explicit", () => {
  const allowedCoreDomainImports = new Set([
    "src/core/editor/state-machine/dependencies.ts",
    "src/core/editor/state-machine/document-helpers.ts",
    "src/core/editor/state-machine/effect-emitters.ts",
    "src/core/editor/state-machine/form-traversal.ts",
    "src/core/editor/state-machine/reducer-root.ts",
    "src/core/editor/state-machine/reducer-sketch.ts",
    "src/core/editor/state-machine/selection-helpers.ts",
    "src/core/editor/state-machine/selectors.ts",
    "src/core/editor/state-machine/state-creators.ts",
    "src/core/editor/state-machine/transitions-effects.ts",
    "src/core/editor/state-machine/transitions-feature.ts",
    "src/core/editor/state-machine/transitions-sketch.ts",
    "src/core/editor/state-machine/transitions-viewport.ts",
    "src/core/editor/state-machine/types.ts",
    "src/core/editor/state-machine/utility-helpers.ts",
    "src/core/feature-authoring/form-adapter.ts",
    "src/core/sketch-constraints/registry.ts",
    "src/core/sketch-special-modes/presentation.ts",
    "src/core/sketch-special-modes/schema.ts",
    "src/core/sketch-tools/definition.ts",
    "src/core/sketch-tools/editor-schema.ts",
    "src/core/sketch-tools/shared.ts",
    "src/core/sketch-tools/tools/tangent-arc.ts",
    "src/core/workspace/viewport-renderables.ts",
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

  expectTrue(
    offenders.length === 0,
    `New core modules must not depend on domain. Move the dependency to core/application, or explicitly retire existing debt first.\n${offenders.join("\n")}`,
  );
});
