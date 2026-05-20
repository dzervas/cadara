import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test, expect } from "vitest";

const ROOT = process.cwd();
const LAYER_ROOTS = [
  "src/application",
  "src/components",
  "src/contracts",
  "src/core",
  "src/domain",
  "src/hooks",
  "src/infrastructure",
  "src/workbench",
] as const;

test("workbench architecture keeps src/app out of feature layers", () => {
  const offenders: string[] = [];

  for (const layerRoot of LAYER_ROOTS) {
    for (const filePath of walk(join(ROOT, layerRoot))) {
      if (!/\.(ts|tsx)$/.test(filePath) || /\.spec\.(ts|tsx)$/.test(filePath)) {
        continue;
      }

      const source = readFileSync(filePath, "utf8");
      if (source.includes("from '@/app/") || source.includes('from "@/app/')) {
        offenders.push(relative(ROOT, filePath));
      }
    }
  }

  expect(
    offenders.length,
    `Modules outside src/app must not import app-layer modules.\n${offenders.join("\n")}`,
  ).toBe(0);
});

test("workbench architecture keeps src/app bootstrap-only", () => {
  const appDirectory = join(ROOT, "src/app");
  const files = existsSync(appDirectory)
    ? walk(appDirectory).filter((filePath) => /\.(ts|tsx)$/.test(filePath))
    : [];

  expect(
    files.map((filePath) => relative(ROOT, filePath)),
    "src/app should not contain workbench feature implementation; root src/App.tsx owns browser bootstrap.",
  ).toEqual([]);
});

test("workbench architecture keeps SLOP ownership comments searchable", () => {
  const offenders: string[] = [];

  for (const layerRoot of ["src/workbench", "src/components/cad"] as const) {
    for (const filePath of walk(join(ROOT, layerRoot))) {
      if (!/\.(ts|tsx)$/.test(filePath) || /\.spec\.(ts|tsx)$/.test(filePath)) {
        continue;
      }

      const source = readFileSync(filePath, "utf8");
      if (!source.includes("SLOP:")) {
        continue;
      }

      if (!source.startsWith("// SLOP:")) {
        offenders.push(relative(ROOT, filePath));
      }
    }
  }

  expect(
    offenders,
    `File-level architecture debt comments must start with // SLOP:.\n${offenders.join("\n")}`,
  ).toEqual([]);
});

test("workbench architecture keeps viewport internals off editor providers", () => {
  const offenders: string[] = [];
  const forbiddenImports = [
    "@/hooks/use-editor-state",
    "@/hooks/editor-provider",
    "@/hooks/use-runtime-extension-registry",
    "@/hooks/runtime-extension-registry-provider",
  ];

  for (const filePath of walk(join(ROOT, "src/components/cad"))) {
    if (!/three-cad-viewport.*\.(ts|tsx)$/.test(filePath)) {
      continue;
    }

    const source = readFileSync(filePath, "utf8");
    if (forbiddenImports.some((importPath) => source.includes(importPath))) {
      offenders.push(relative(ROOT, filePath));
    }
  }

  expect(
    offenders,
    `Viewport internals must receive editor/runtime state through the viewport model instead of provider hooks.\n${offenders.join("\n")}`,
  ).toEqual([]);
});

test("workbench architecture preserves tool activation routing", () => {
  const contextSource = readFileSync(
    join(ROOT, "src/hooks/workbench-command-context.ts"),
    "utf8",
  );
  const shortcutSource = readFileSync(
    join(ROOT, "src/workbench/commands/workbench-shortcuts.ts"),
    "utf8",
  );
  const toolButtonSource = readFileSync(
    join(ROOT, "src/components/layout/tool-button.tsx"),
    "utf8",
  );
  const dropdownSource = readFileSync(
    join(ROOT, "src/components/layout/tool-dropdown-button.tsx"),
    "utf8",
  );
  const workbenchSource = readFileSync(
    join(ROOT, "src/workbench/shell/cad-workbench.tsx"),
    "utf8",
  );
  const toolActionsSource = readFileSync(
    join(ROOT, "src/hooks/use-tool-actions.ts"),
    "utf8",
  );

  expect(
    contextSource.includes("activateTool:"),
    "Workbench command context should expose a shared tool activation entrypoint.",
  ).toBeTruthy();
  expect(
    shortcutSource.includes("activateTool") &&
      !shortcutSource.includes("triggerTool: (toolId"),
    "Shortcut handlers should invoke the shared tool activation entrypoint instead of owning a separate trigger function contract.",
  ).toBeTruthy();
  expect(
    toolButtonSource.includes("useWorkbenchCommandHandlers") &&
      !toolButtonSource.includes("useToolActions"),
    "Toolbar tool buttons should use the shared workbench command handlers rather than calling tool hooks directly.",
  ).toBeTruthy();
  expect(
    dropdownSource.includes("useWorkbenchCommandHandlers") &&
      !dropdownSource.includes("useToolActions"),
    "Toolbar dropdown triggers should use the shared workbench command handlers rather than calling tool hooks directly.",
  ).toBeTruthy();
  expect(
    workbenchSource.includes("activateTool: triggerTool"),
    "CadWorkbench should inject the shared tool activation entrypoint from its application composition layer.",
  ).toBeTruthy();
  expect(
    toolActionsSource.includes("getToolCommandBehavior"),
    "Tool activation policy should flow through shared tool metadata helpers instead of duplicating sketch tool classification in the hook layer.",
  ).toBeTruthy();
});

test("workbench architecture preserves document ownership routing", () => {
  const workbenchSource = readFileSync(
    join(ROOT, "src/workbench/shell/cad-workbench.tsx"),
    "utf8",
  );
  const historySource = readFileSync(
    join(ROOT, "src/workbench/adapters/use-workbench-history.ts"),
    "utf8",
  );
  const importSource = readFileSync(
    join(ROOT, "src/workbench/adapters/use-workbench-part-import.ts"),
    "utf8",
  );
  const ownerHookSource = readFileSync(
    join(ROOT, "src/hooks/use-workbench-document-owner.ts"),
    "utf8",
  );
  const ownerServiceSource = readFileSync(
    join(ROOT, "src/workbench/document/document-owner.ts"),
    "utf8",
  );
  const presentationHookSource = readFileSync(
    join(ROOT, "src/workbench/adapters/use-workbench-document-presentation.ts"),
    "utf8",
  );

  expect(
    ownerHookSource.includes("createWorkbenchDocumentOwner") &&
      ownerServiceSource.includes("document.snapshotLoaded") &&
      ownerServiceSource.includes("document.replaced"),
    "Workbench document owner should keep distinct incremental snapshot and whole-document replacement handoffs while the hook remains a thin adapter.",
  ).toBeTruthy();
  expect(
    historySource.includes("useWorkbenchDocumentOwner") &&
      !historySource.includes("modelingService.updateDocumentVariable") &&
      !historySource.includes("modelingService.reorderDocumentHistory") &&
      !historySource.includes("modelingService.getCurrentDocumentSnapshot"),
    "Workbench history controller should delegate variable and reorder ownership to the shared document owner hook.",
  ).toBeTruthy();
  expect(
    importSource.includes("useWorkbenchDocumentOwner") &&
      !importSource.includes("applyImportPreparedActions") &&
      !importSource.includes("prepareImportActions") &&
      !importSource.includes("applyLoadedSnapshot"),
    "Workbench part import controller should delegate accepted import completion through the shared document owner hook.",
  ).toBeTruthy();
  expect(
    workbenchSource.includes(
      "const documentOwner = useWorkbenchDocumentOwner()",
    ) &&
      !workbenchSource.includes("modelingService.deleteTarget") &&
      !workbenchSource.includes("modelingService.updateFeature") &&
      !workbenchSource.includes("modelingService.commitSketch") &&
      !workbenchSource.includes("modelingService.renameBody"),
    "CadWorkbench should not own ordinary document mutation sequencing once the shared document owner hook is in place.",
  ).toBeTruthy();
  expect(
    presentationHookSource.includes("resetForDocumentReplacement") &&
      presentationHookSource.includes("setInvalidVariableValueMessages({})"),
    "Document-scoped shell presentation state should expose one reset path for whole-document replacement flows.",
  ).toBeTruthy();
});

test("workbench architecture preserves extension registry composition ownership", () => {
  const appSource = readFileSync(join(ROOT, "src/App.tsx"), "utf8");
  const workbenchAppSource = readFileSync(
    join(ROOT, "src/workbench/bootstrap/workbench-app.tsx"),
    "utf8",
  );
  const modelingServiceSource = readFileSync(
    join(ROOT, "src/domain/modeling/modeling-service/service.ts"),
    "utf8",
  );
  const importControllerSource = readFileSync(
    join(ROOT, "src/workbench/adapters/use-workbench-part-import.ts"),
    "utf8",
  );
  const specialModeRegistrySource = readFileSync(
    join(ROOT, "src/core/sketch-special-modes/registry.ts"),
    "utf8",
  );
  const specialModePresentationSource = readFileSync(
    join(ROOT, "src/core/sketch-special-modes/presentation.ts"),
    "utf8",
  );

  expect(
    appSource.includes("createBuiltinRuntimeExtensionRegistryComposition") &&
      appSource.includes("<WorkbenchApp") &&
      workbenchAppSource.includes("RuntimeExtensionRegistryProvider") &&
      workbenchAppSource.includes(
        "exportProviders: runtimeExtensionRegistries.exportProviders",
      ),
    "Application bootstrap should own runtime extension registry composition and hand it to the workbench session host for service and UI injection.",
  ).toBeTruthy();
  expect(
    !modelingServiceSource.includes("registerBuiltinExportProviders") &&
      !modelingServiceSource.includes("registerExportProvider("),
    "Modeling service construction must not register built-in export providers as a side effect.",
  ).toBeTruthy();
  expect(
    importControllerSource.includes("importProviders.getAcceptedFileTypes()") &&
      importControllerSource.includes("importProviders.matchProviders("),
    "Import flows should consume explicit import-provider lookup surfaces instead of ambient registry helpers.",
  ).toBeTruthy();
  expect(
    !specialModeRegistrySource.includes("let sketchSpecialModeRegistry"),
    "Sketch special-mode registry composition should be immutable rather than replaced through process-global state.",
  ).toBeTruthy();
  expect(
    specialModePresentationSource.includes(
      "registry: SketchSpecialModeRegistry",
    ) &&
      !specialModePresentationSource.includes(
        "getRegisteredSketchSpecialModeDefinitions()",
      ),
    "Sketch special-mode presentation should consume an explicit registry and avoid registry-owned global discovery.",
  ).toBeTruthy();
});

function walk(directory: string): string[] {
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
}
