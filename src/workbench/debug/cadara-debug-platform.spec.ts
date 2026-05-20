import { test, expect } from "vitest";

import {
  createCadaraDebugNamespace,
  installCadaraDebugNamespace,
  isCadaraDebugPlatformEnabled,
} from "@/workbench/debug/cadara-debug-bridge";
import {
  resolveCadaraDebugTarget,
  selectCadaraDebugTarget,
} from "@/workbench/debug/cadara-debug-actions";
import { createCadaraDebugSession } from "@/workbench/debug/cadara-debug-session";
import { defaultSelectionFilter } from "@/core/editor/schema";
import type { WorkspaceSnapshot } from "@/contracts/modeling/schema";
import type { EditorEvent } from "@/domain/editor/state-machine";
import type {
  EditorRuntimeTraceSnapshot,
  WorkbenchDebugState,
} from "@/domain/debug/debug-platform";

test("src/app/cadara-debug-platform.spec.ts installs the formal dev namespace and exports state plus trace accessors", () => {
  const trace: EditorRuntimeTraceSnapshot = {
    maxEntries: 200,
    totalEntries: 2,
    droppedEntries: 0,
    entries: [],
  };
  const state: WorkbenchDebugState = {
    activeMode: "part",
    machineState: "idle",
    command: "none",
    phase: "idle",
    selectionCount: 0,
    selectionTargets: "Nothing selected",
    revision: "rev_1",
    snapshotDiagnosticsCount: 0,
    sketchSession: "none",
    sketchPlane: "none",
    featureSession: "none",
    previewState: "No active preview",
    selectionFilterLabel: "All selectable geometry",
    activeTargetRule: "No active target rule",
    selectableTargets: ["body_feature_extrude-1"],
    featureIds: [],
    previewDiagnostics: "",
    requirements: [],
    selectionDetail: {
      label: "none",
      kindLabel: "none",
      ownerLabel: "n/a",
      relatedLabels: [],
      targetLabel: "none",
    },
    hoverTarget: "none",
    topologyDebug: {
      bodyCount: 0,
      liveTopologyReferences: 0,
      invalidatedTopologyReferences: 0,
      bodies: [],
      invalidations: [],
    },
  };
  const targetWindow: {
    __cadaraDebug?: ReturnType<typeof createCadaraDebugNamespace>;
  } = {};
  let clearedSelections = 0;
  let refreshedDocuments = 0;
  const namespace = createCadaraDebugNamespace({
    getState: () => state,
    getTrace: () => trace,
    selectTarget: (targetId) => targetId === "body_feature_extrude-1",
    clearSelection: () => {
      clearedSelections += 1;
    },
    refreshDocument: () => {
      refreshedDocuments += 1;
    },
    exportSession: () =>
      createCadaraDebugSession({
        build: { version: "1.0.0", commit: "abc123", mode: "development" },
        state,
        trace,
        location: {
          origin: "http://localhost:3000",
          pathname: "/",
          search: "?cadTestMode",
          hash: "#debug",
        },
      }),
  });
  const dispose = installCadaraDebugNamespace(
    namespace,
    targetWindow as Window,
  );

  expect(
    targetWindow.__cadaraDebug?.version,
    "Debug namespace installation should publish the formal window contract.",
  ).toBe(1);
  expect(
    targetWindow.__cadaraDebug?.getState()?.revision,
    "Debug namespace should expose structured workbench state.",
  ).toBe("rev_1");
  expect(
    targetWindow.__cadaraDebug?.getTrace().totalEntries,
    "Debug namespace should expose bounded trace snapshots.",
  ).toBe(2);
  expect(
    targetWindow.__cadaraDebug?.selectTarget("body_feature_extrude-1"),
    "Debug namespace should route supported actions through the provided bridge callbacks.",
  ).toBeTruthy();
  targetWindow.__cadaraDebug?.clearSelection();
  targetWindow.__cadaraDebug?.refreshDocument();
  expect(
    clearedSelections,
    "Debug namespace should expose documented selection clearing through the same event contract.",
  ).toBe(1);
  expect(
    refreshedDocuments,
    "Debug namespace should expose documented refresh requests through the same event contract.",
  ).toBe(1);
  expect(
    targetWindow.__cadaraDebug?.exportSession().replay.unsupportedSteps[0]
      ?.code,
    "Session exports should mark unsupported replay steps explicitly.",
  ).toBe("browser-coordination-not-captured");

  dispose();
  expect(
    targetWindow.__cadaraDebug,
    "Disposing the namespace should remove the dev-only window surface.",
  ).toBe(undefined);
});

test("src/app/cadara-debug-platform.spec.ts gates the namespace to dev or test builds", () => {
  expect(
    isCadaraDebugPlatformEnabled({ dev: true }),
    "Development builds should enable the debug namespace.",
  ).toBeTruthy();
  expect(
    isCadaraDebugPlatformEnabled({ dev: false, test: true }),
    "Test builds should enable the debug namespace.",
  ).toBeTruthy();
  expect(
    isCadaraDebugPlatformEnabled({ dev: false, test: "true" }),
    "Stringified test flags should enable the debug namespace.",
  ).toBeTruthy();
  expect(
    isCadaraDebugPlatformEnabled({ dev: false, test: false }),
    "Production-like flags should keep the debug namespace disabled.",
  ).toBeFalsy();
});

test("src/app/cadara-debug-platform.spec.ts resolves and dispatches target selection through the editor contract", () => {
  const snapshot = {
    presentation: {
      entities: [
        {
          target: { kind: "body", bodyId: "body_feature_extrude-1" },
        },
      ],
    },
  } as WorkspaceSnapshot;
  const events: EditorEvent[] = [];
  const selected = selectCadaraDebugTarget({
    targetId: "body_feature_extrude-1",
    snapshot,
    selection: [],
    selectionFilter: defaultSelectionFilter,
    selectionCatalog: {
      selectableTargetKeys: ["body:body_feature_extrude-1"],
      existingSketchKeys: [],
      constructionPlaneKeys: [],
      planarFaceKeys: [],
    },
    dispatch: (event) => {
      events.push(event);
    },
  });

  expect(
    resolveCadaraDebugTarget(snapshot, "body_feature_extrude-1")?.kind,
    "Debug selection helpers should resolve target ids against the visible snapshot.",
  ).toBe("body");
  expect(
    selected,
    "Debug selection helpers should accept selectable targets.",
  ).toBeTruthy();
  expect(
    events[0]?.type,
    "Debug selection helpers should dispatch through the editor event contract.",
  ).toBe("viewport.selectionRequested");
});
