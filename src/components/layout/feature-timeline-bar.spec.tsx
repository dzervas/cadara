import { test, expect } from "vitest";
import { MantineProvider } from "@mantine/core";
import { renderToStaticMarkup } from "react-dom/server";

import { FeatureSidebar } from "@/components/layout/feature-sidebar";
import { shouldStartVariableKeyboardEdit } from "@/components/layout/feature-sidebar.a11y";
import { FeatureTimelineBar } from "@/components/layout/feature-timeline-bar";
import { FloatingPartsTree } from "@/components/layout/floating-parts-tree";
import { getNextHistoryTreeFocusIndex } from "@/components/layout/feature-timeline-bar.a11y";
import { HistoryTimelineShell } from "@/components/layout/history-timeline-shell";
import {
  HISTORY_TIMELINE_COLLAPSED_STORAGE_KEY,
  getHistoryTimelinePanelMotionState,
  readHistoryTimelineCollapsedPreference,
  writeHistoryTimelineCollapsedPreference,
} from "@/components/layout/history-timeline-shell-state";
import { getPartsObjectMenuEntries } from "@/components/layout/parts-object-menu.helpers";
import {
  getDocumentHistoryMenuEntryDescriptors,
  getNearestTimelineAnchorIndex,
  resolveTimelineReorderDrop,
} from "@/components/layout/feature-timeline-bar.helpers";
import {
  getEditorViewState,
  initialEditorState,
} from "@/domain/editor/state-machine";
import { getPrimitiveRefKey } from "@/core/editor/schema";
import { MockKernelAdapter } from "@/domain/modeling/mock-kernel-adapter";
import { createSketchSessionFromSnapshot } from "@/domain/editor/sketch-session";
import { EditorContext } from "@/hooks/editor-context";
import { workbenchTheme } from "@/theme/workbench-theme";
import type { FeatureId, RegionId, SketchId } from "@/contracts/shared/ids";

function createTimelinePreferenceStorage() {
  const map = new Map<string, string>();
  return {
    getItem(key: string) {
      return map.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      map.set(key, value);
    },
  };
}

test("src/components/layout/feature-timeline-bar.spec.tsx", async () => {
  const adapter = new MockKernelAdapter();
  const response = await adapter.getDocumentSnapshot({
    contractVersion: "modeling-contract/v1alpha1",
    documentId: "doc_workspace",
  });
  const snapshot = response.snapshot;
  const editorValue = {
    machineState: initialEditorState,
    state: {
      ...getEditorViewState(initialEditorState),
      selectionCatalog: {
        selectableTargetKeys: snapshot.presentation.entities.map((entity) =>
          getPrimitiveRefKey(entity.target),
        ),
        existingSketchKeys: snapshot.presentation.entities
          .filter((entity) =>
            entity.selectionSemantics.includes("existingSketch"),
          )
          .map((entity) => getPrimitiveRefKey(entity.target)),
        constructionPlaneKeys: [],
        planarFaceKeys: [],
      },
    },
    dispatch: () => undefined,
  };

  const sidebarMarkup = renderToStaticMarkup(
    <MantineProvider theme={workbenchTheme} defaultColorScheme="dark">
      <EditorContext.Provider value={editorValue}>
        <FeatureSidebar
          snapshot={snapshot}
          hiddenTargetKeys={{}}
          invalidVariableValueIds={{}}
          objectLabelOverrides={{
            [getPrimitiveRefKey(snapshot.presentation.objects[0]!.target)]:
              "Renamed Object",
          }}
          visibleSelection={[]}
          onAddVariable={() => undefined}
          onInspectDiagnostic={() => undefined}
          onObjectDelete={() => undefined}
          onObjectExport={() => undefined}
          onRenameTarget={() => undefined}
          onReopenTarget={() => undefined}
          onSelectTarget={() => undefined}
          onToggleTargetVisibility={() => undefined}
          onUpdateVariable={() => undefined}
        />
      </EditorContext.Provider>
    </MantineProvider>,
  );

  expect(
    sidebarMarkup.includes("Feature Tree"),
    "Sidebar should not render the feature tree section.",
  ).toBeFalsy();
  expect(
    sidebarMarkup.includes("Parts &amp; Objects"),
    "Sidebar should keep the parts and objects section.",
  ).toBeTruthy();
  expect(
    sidebarMarkup.includes("Renamed Object"),
    "Sidebar parts and objects should render rename overrides.",
  ).toBeTruthy();
  expect(
    sidebarMarkup.includes("Sketch 1"),
    "Sidebar parts and objects should include committed sketches.",
  ).toBeTruthy();
  expect(
    sidebarMarkup.includes("/icons/new-sketch.svg"),
    "Sidebar sketch rows should use shared sketch tool icons.",
  ).toBeTruthy();
  expect(
    sidebarMarkup.includes("/icons/c-plane.svg"),
    "Sidebar construction rows should use shared plane tool icons.",
  ).toBeTruthy();
  expect(
    sidebarMarkup.includes("Double-click to reopen authoring in place"),
    "Sidebar sketch rows should expose double-click reopen behavior.",
  ).toBeTruthy();
  expect(
    sidebarMarkup.includes("Variables"),
    "Sidebar should render the variables section.",
  ).toBeTruthy();
  expect(
    sidebarMarkup.includes("Snapshot References"),
    "Sidebar should not render snapshot references as the standard middle section.",
  ).toBeFalsy();
  expect(
    sidebarMarkup.includes('aria-label="Add variable"'),
    "Sidebar variables should expose an add button.",
  ).toBeTruthy();
  expect(
    sidebarMarkup.includes("Document Diagnostics"),
    "Sidebar should keep document diagnostics.",
  ).toBeTruthy();
  expect(
    /data-accordion="true"/.test(sidebarMarkup),
    "Sidebar should render its sections inside a Mantine accordion shell.",
  ).toBeTruthy();
  expect(
    (sidebarMarkup.match(/data-accordion-control="true"/g) ?? []).length,
    "Sidebar should expose three accordion controls for objects, variables, and diagnostics.",
  ).toBe(3);
  expect(
    sidebarMarkup.includes("grid-rows-[minmax(0,1.1fr)_minmax(0,0.9fr)]") &&
      !sidebarMarkup.includes("max-h-56 flex-[0.85]"),
    "Sidebar should remove the old stacked split-pane sizing once the accordion shell owns section layout.",
  ).toBeFalsy();
  expect(
    sidebarMarkup.includes('aria-haspopup="menu"'),
    "Sidebar rows should expose custom context menu affordances.",
  ).toBeTruthy();
  expect(
    sidebarMarkup.includes(
      "hover:bg-[var(--workbench-shell-sidebar-item-hover)]",
    ),
    "Sidebar object rows should use the dedicated hover graphite step instead of sharing the selected-state surface.",
  ).toBeTruthy();

  const floatingPartsTreeMarkup = renderToStaticMarkup(
    <MantineProvider theme={workbenchTheme} defaultColorScheme="dark">
      <EditorContext.Provider value={editorValue}>
        <FloatingPartsTree
          snapshot={snapshot}
          hiddenTargetKeys={{}}
          objectLabelOverrides={{}}
          visibleSelection={[]}
          onObjectDelete={() => undefined}
          onObjectExport={() => undefined}
          onRenameTarget={() => undefined}
          onReopenTarget={() => undefined}
          onSelectTarget={() => undefined}
          onToggleTargetVisibility={() => undefined}
        />
      </EditorContext.Provider>
    </MantineProvider>,
  );

  expect(
    floatingPartsTreeMarkup.includes('data-parts-tree-row="true"') &&
      floatingPartsTreeMarkup.includes('aria-haspopup="menu"'),
    "Floating parts tree rows should forward the custom context menu affordance to the DOM row.",
  ).toBeTruthy();

  const selectedSidebarMarkup = renderToStaticMarkup(
    <MantineProvider theme={workbenchTheme} defaultColorScheme="dark">
      <EditorContext.Provider value={editorValue}>
        <FeatureSidebar
          snapshot={snapshot}
          hiddenTargetKeys={{}}
          invalidVariableValueIds={{}}
          objectLabelOverrides={{}}
          visibleSelection={[snapshot.presentation.objects[0]!.target]}
          onAddVariable={() => undefined}
          onInspectDiagnostic={() => undefined}
          onObjectDelete={() => undefined}
          onObjectExport={() => undefined}
          onRenameTarget={() => undefined}
          onReopenTarget={() => undefined}
          onSelectTarget={() => undefined}
          onToggleTargetVisibility={() => undefined}
          onUpdateVariable={() => undefined}
        />
      </EditorContext.Provider>
    </MantineProvider>,
  );

  expect(
    selectedSidebarMarkup.includes(
      "bg-[var(--workbench-shell-sidebar-item-selected)]",
    ),
    "Selected sidebar object rows should use the dedicated selected graphite step.",
  ).toBeTruthy();
  expect(
    selectedSidebarMarkup.includes("font-semibold"),
    "Selected sidebar object rows should add a stronger label weight cue.",
  ).toBeTruthy();
  expect(
    selectedSidebarMarkup.includes(
      "var(--workbench-shell-sidebar-item-selected-icon)",
    ),
    "Selected sidebar object rows should brighten the leading icon as a selection cue.",
  ).toBeTruthy();

  const variableResultSnapshot = {
    ...snapshot,
    document: {
      ...snapshot.document,
      variables: [
        {
          variableId: "variable_width" as const,
          name: "width",
          valueText: "10 + 2",
        },
        {
          variableId: "variable_depth" as const,
          name: "depth",
          valueText: "width * 3",
        },
      ],
    },
    variables: [
      {
        variableId: "variable_width" as const,
        name: "width",
        valueText: "10 + 2",
      },
      {
        variableId: "variable_depth" as const,
        name: "depth",
        valueText: "width * 3",
      },
    ],
  };
  const variableSidebarMarkup = renderToStaticMarkup(
    <MantineProvider theme={workbenchTheme} defaultColorScheme="dark">
      <EditorContext.Provider value={editorValue}>
        <FeatureSidebar
          snapshot={variableResultSnapshot}
          hiddenTargetKeys={{}}
          invalidVariableValueIds={{}}
          objectLabelOverrides={{}}
          visibleSelection={[]}
          onAddVariable={() => undefined}
          onInspectDiagnostic={() => undefined}
          onObjectDelete={() => undefined}
          onObjectExport={() => undefined}
          onRenameTarget={() => undefined}
          onReopenTarget={() => undefined}
          onSelectTarget={() => undefined}
          onToggleTargetVisibility={() => undefined}
          onUpdateVariable={() => undefined}
        />
      </EditorContext.Provider>
    </MantineProvider>,
  );

  expect(
    variableSidebarMarkup.includes('aria-label="Edit variable width"'),
    "Existing variables should expose a double-click row edit control using the authored variable name.",
  ).toBeTruthy();
  expect(
    variableSidebarMarkup.includes('aria-keyshortcuts="Enter Space F2"'),
    "Existing variables should advertise the keyboard shortcuts that enter edit mode.",
  ).toBeTruthy();
  expect(
    variableSidebarMarkup.includes('aria-label="Variable name variable_width"'),
    "Existing variables should render read-only rows until edited.",
  ).toBeFalsy();
  expect(
    variableSidebarMarkup.includes(
      'data-variable-expression="variable_width"',
    ) && variableSidebarMarkup.includes("10 + 2"),
    "Read-only variable rows should keep the authored expression visible.",
  ).toBeTruthy();
  expect(
    /data-variable-expression="variable_width"[\s\S]*aria-hidden="true"[\s\S]*>=<\/span>[\s\S]*aria-label="Variable result: 12"/.test(
      variableSidebarMarkup,
    ),
    "Read-only variable rows should separate expressions and results with an equals sign before the computed result chip.",
  ).toBeTruthy();
  expect(
    variableSidebarMarkup.includes("font-mono") &&
      variableSidebarMarkup.includes(">12</span>"),
    "Variable expression results should render in a monospace value chip.",
  ).toBeTruthy();
  expect(
    variableSidebarMarkup.includes(
      "inline-block max-w-full shrink-0 truncate rounded border px-2 py-1 text-right font-mono",
    ),
    "Variable expression results should size to their text instead of using a fixed minimum width.",
  ).toBeTruthy();
  expect(
    variableSidebarMarkup.includes("var(--workbench-shell-success-surface)"),
    "Successful variable results should use the shared success background.",
  ).toBeTruthy();
  expect(
    variableSidebarMarkup.includes('data-result-state="success"'),
    "Successful variable results should expose success state metadata.",
  ).toBeTruthy();

  const invalidVariableSidebarMarkup = renderToStaticMarkup(
    <MantineProvider theme={workbenchTheme} defaultColorScheme="dark">
      <EditorContext.Provider value={editorValue}>
        <FeatureSidebar
          snapshot={variableResultSnapshot}
          hiddenTargetKeys={{}}
          invalidVariableValueMessages={{
            variable_width: "Width expression failed.",
          }}
          objectLabelOverrides={{}}
          visibleSelection={[]}
          onAddVariable={() => undefined}
          onInspectDiagnostic={() => undefined}
          onObjectDelete={() => undefined}
          onObjectExport={() => undefined}
          onRenameTarget={() => undefined}
          onReopenTarget={() => undefined}
          onSelectTarget={() => undefined}
          onToggleTargetVisibility={() => undefined}
          onUpdateVariable={() => undefined}
        />
      </EditorContext.Provider>
    </MantineProvider>,
  );

  expect(
    invalidVariableSidebarMarkup.includes(">???</span>"),
    "Invalid variable results should render the placeholder result.",
  ).toBeTruthy();
  expect(
    invalidVariableSidebarMarkup.includes('data-result-state="error"'),
    "Invalid variable results should expose error state metadata.",
  ).toBeTruthy();
  expect(
    invalidVariableSidebarMarkup.includes("var(--workbench-shell-danger-text)"),
    "Invalid variable results should use the shared danger color.",
  ).toBeTruthy();
  expect(
    invalidVariableSidebarMarkup.includes(
      "Variable result error: Width expression failed.",
    ),
    "Invalid variable results should expose the same error message used by the persistent tooltip.",
  ).toBeTruthy();
  expect(
    invalidVariableSidebarMarkup.includes('data-invalid-value="true"'),
    "Runtime invalid variable state should render danger styling.",
  ).toBeTruthy();

  const multipleInvalidVariablesMarkup = renderToStaticMarkup(
    <MantineProvider theme={workbenchTheme} defaultColorScheme="dark">
      <EditorContext.Provider value={editorValue}>
        <FeatureSidebar
          snapshot={variableResultSnapshot}
          hiddenTargetKeys={{}}
          invalidVariableValueMessages={{
            variable_width: "Width expression failed.",
            variable_depth: "Depth expression failed.",
          }}
          objectLabelOverrides={{}}
          visibleSelection={[]}
          onAddVariable={() => undefined}
          onInspectDiagnostic={() => undefined}
          onObjectDelete={() => undefined}
          onObjectExport={() => undefined}
          onRenameTarget={() => undefined}
          onReopenTarget={() => undefined}
          onSelectTarget={() => undefined}
          onToggleTargetVisibility={() => undefined}
          onUpdateVariable={() => undefined}
        />
      </EditorContext.Provider>
    </MantineProvider>,
  );

  expect(
    multipleInvalidVariablesMarkup.split("aria-describedby=").length - 1,
    "Variable result tooltips should auto-open at most one invalid row at a time.",
  ).toBe(1);

  const blankVariableSnapshot = {
    ...snapshot,
    document: {
      ...snapshot.document,
      variables: [
        { variableId: "variable_depth" as const, name: "depth", valueText: "" },
      ],
    },
    variables: [
      { variableId: "variable_depth" as const, name: "depth", valueText: "" },
    ],
  };
  const blankVariableSidebarMarkup = renderToStaticMarkup(
    <MantineProvider theme={workbenchTheme} defaultColorScheme="dark">
      <EditorContext.Provider value={editorValue}>
        <FeatureSidebar
          snapshot={blankVariableSnapshot}
          hiddenTargetKeys={{}}
          invalidVariableValueIds={{}}
          objectLabelOverrides={{}}
          visibleSelection={[]}
          onAddVariable={() => undefined}
          onInspectDiagnostic={() => undefined}
          onObjectDelete={() => undefined}
          onObjectExport={() => undefined}
          onRenameTarget={() => undefined}
          onReopenTarget={() => undefined}
          onSelectTarget={() => undefined}
          onToggleTargetVisibility={() => undefined}
          onUpdateVariable={() => undefined}
        />
      </EditorContext.Provider>
    </MantineProvider>,
  );

  expect(
    blankVariableSidebarMarkup.includes(
      'aria-label="Variable name variable_depth"',
    ),
    "New blank variables should render name text inputs.",
  ).toBeTruthy();
  expect(
    blankVariableSidebarMarkup.includes(
      'aria-label="Variable value variable_depth"',
    ),
    "New blank variables should render value text inputs.",
  ).toBeTruthy();

  const hiddenObjectMarkup = renderToStaticMarkup(
    <MantineProvider theme={workbenchTheme} defaultColorScheme="dark">
      <EditorContext.Provider value={editorValue}>
        <FeatureSidebar
          snapshot={snapshot}
          hiddenTargetKeys={{
            [getPrimitiveRefKey(snapshot.presentation.objects[0]!.target)]:
              true,
          }}
          invalidVariableValueIds={{}}
          objectLabelOverrides={{}}
          visibleSelection={[]}
          onAddVariable={() => undefined}
          onInspectDiagnostic={() => undefined}
          onObjectDelete={() => undefined}
          onObjectExport={() => undefined}
          onRenameTarget={() => undefined}
          onReopenTarget={() => undefined}
          onSelectTarget={() => undefined}
          onToggleTargetVisibility={() => undefined}
          onUpdateVariable={() => undefined}
        />
      </EditorContext.Provider>
    </MantineProvider>,
  );

  expect(
    hiddenObjectMarkup.includes(">Hidden<"),
    "Hidden sidebar objects should not render a separate hidden status label.",
  ).toBeFalsy();

  const hiddenSketchKey = getPrimitiveRefKey({
    kind: "sketch",
    sketchId: "sketch_primary",
  });
  const hiddenSketchMarkup = renderToStaticMarkup(
    <MantineProvider theme={workbenchTheme} defaultColorScheme="dark">
      <EditorContext.Provider value={editorValue}>
        <FeatureSidebar
          snapshot={snapshot}
          hiddenTargetKeys={{ [hiddenSketchKey]: true }}
          invalidVariableValueIds={{}}
          objectLabelOverrides={{}}
          visibleSelection={[]}
          onAddVariable={() => undefined}
          onInspectDiagnostic={() => undefined}
          onObjectDelete={() => undefined}
          onObjectExport={() => undefined}
          onRenameTarget={() => undefined}
          onReopenTarget={() => undefined}
          onSelectTarget={() => undefined}
          onToggleTargetVisibility={() => undefined}
          onUpdateVariable={() => undefined}
        />
      </EditorContext.Provider>
    </MantineProvider>,
  );

  expect(
    hiddenSketchMarkup.includes('aria-label="Show Sketch 1"'),
    "Consumed sketch rows should keep a show action available from Parts & Objects while hidden.",
  ).toBeTruthy();
  expect(
    hiddenSketchMarkup.includes("Hidden in the viewport"),
    "Hidden sketch rows should present the same hidden-state treatment used by the viewport filter.",
  ).toBeTruthy();

  const timelineMarkup = renderToStaticMarkup(
    <MantineProvider theme={workbenchTheme} defaultColorScheme="dark">
      <EditorContext.Provider value={editorValue}>
        <FeatureTimelineBar
          snapshot={snapshot}
          historyHighlightFeatureIds={[]}
          visibleSelection={[
            { kind: "feature", featureId: "feature_extrude-1" },
          ]}
          onSelectTarget={() => undefined}
          onReopenTarget={() => undefined}
          onCursorRequested={() => undefined}
          onDeleteItem={() => undefined}
          onExportItem={() => undefined}
          onRenameItem={() => undefined}
          onSuppressFeature={() => undefined}
        />
      </EditorContext.Provider>
    </MantineProvider>,
  );

  expect(
    timelineMarkup.includes('aria-label="Feature timeline"'),
    "Timeline should expose a region label.",
  ).toBeTruthy();
  expect(
    timelineMarkup.includes('role="tree"') &&
      timelineMarkup.includes('aria-orientation="horizontal"') &&
      timelineMarkup.includes('role="treeitem"'),
    "Timeline history items should expose tree semantics for assistive technologies.",
  ).toBeTruthy();
  expect(
    timelineMarkup.includes(
      'aria-label="Select Sketch 1. Double-click to reopen."',
    ),
    "Timeline should expose committed sketch selection labels.",
  ).toBeTruthy();
  expect(
    timelineMarkup.includes(
      'aria-label="Select Extrude 1. Double-click to reopen."',
    ),
    "Timeline should expose feature selection labels.",
  ).toBeTruthy();
  expect(
    timelineMarkup.includes("/icons/new-sketch.svg"),
    "Timeline sketch entries should use shared sketch tool icons.",
  ).toBeTruthy();
  expect(
    timelineMarkup.includes("/icons/extrude.svg"),
    "Timeline feature entries should use shared feature tool icons.",
  ).toBeTruthy();
  expect(
    timelineMarkup.includes('aria-current="step"'),
    "Timeline should expose the current cursor position.",
  ).toBeTruthy();
  expect(
    timelineMarkup.includes('aria-label="Timeline cursor'),
    "Timeline should render a draggable cursor handle.",
  ).toBeTruthy();
  expect(
    timelineMarkup.includes('aria-haspopup="menu"'),
    "Timeline history items should expose custom context menu affordances.",
  ).toBeTruthy();
  expect(
    timelineMarkup.includes("Hide Fillet 1") &&
      !timelineMarkup.includes("Show Fillet 1"),
    "Timeline should not render per-feature hide controls.",
  ).toBeFalsy();

  const featureHistoryItem = snapshot.presentation.documentHistory.find(
    (item) => item.kind === "feature",
  );
  const sketchHistoryItem = snapshot.presentation.documentHistory.find(
    (item) => item.kind === "sketch",
  );
  expect(
    featureHistoryItem,
    "Timeline menu tests need a committed feature history item.",
  ).toBeTruthy();
  expect(
    sketchHistoryItem,
    "Timeline menu tests need a committed sketch history item.",
  ).toBeTruthy();

  const featureMenuDescriptors = getDocumentHistoryMenuEntryDescriptors({
    item: featureHistoryItem,
    cursorDisabled: false,
    cursorIndex: 0,
    historyLength: snapshot.presentation.documentHistory.length,
  });
  const suppressedFeatureMenuDescriptors =
    getDocumentHistoryMenuEntryDescriptors({
      item: {
        ...featureHistoryItem,
        suppressed: true,
      },
      cursorDisabled: false,
      cursorIndex: 0,
      historyLength: snapshot.presentation.documentHistory.length,
    });
  const sketchMenuDescriptors = getDocumentHistoryMenuEntryDescriptors({
    item: sketchHistoryItem,
    cursorDisabled: false,
    cursorIndex: 0,
    historyLength: snapshot.presentation.documentHistory.length,
  });
  const tailMenuDescriptors = getDocumentHistoryMenuEntryDescriptors({
    item: featureHistoryItem,
    cursorDisabled: false,
    cursorIndex: snapshot.presentation.documentHistory.length - 1,
    historyLength: snapshot.presentation.documentHistory.length,
  });
  const pendingCursorMenuDescriptors = getDocumentHistoryMenuEntryDescriptors({
    item: featureHistoryItem,
    cursorDisabled: true,
    cursorIndex: 0,
    historyLength: snapshot.presentation.documentHistory.length,
  });

  expect(
    featureMenuDescriptors
      .filter((entry) => entry.kind === "item")
      .map((entry) => entry.label)
      .join("|"),
    "Feature history menus should expose the shared actions plus feature-only suppress.",
  ).toBe("Edit|Rename|Suppress|Roll History Here|Roll To End|Delete");
  expect(
    suppressedFeatureMenuDescriptors
      .filter((entry) => entry.kind === "item")
      .map((entry) => entry.label)
      .join("|"),
    "Suppressed feature history menus should expose Unsuppress instead of the placeholder Suppress action.",
  ).toBe("Edit|Rename|Unsuppress|Roll History Here|Roll To End|Delete");
  expect(
    sketchMenuDescriptors
      .filter((entry) => entry.kind === "item")
      .map((entry) => entry.label)
      .join("|"),
    "Sketch history menus should keep the shared committed-history actions when plane reassignment is unavailable.",
  ).toBe("Edit|Rename|Export|Roll History Here|Roll To End|Delete");
  expect(
    getDocumentHistoryMenuEntryDescriptors({
      item: sketchHistoryItem,
      cursorDisabled: false,
      cursorIndex: 0,
      historyLength: snapshot.presentation.documentHistory.length,
      canChangeSketchPlane: true,
    })
      .filter((entry) => entry.kind === "item")
      .map((entry) => entry.label)
      .join("|"),
    "Sketch history menus should insert Change Sketch Plane without affecting the feature-only actions.",
  ).toBe(
    "Edit|Rename|Export|Change Sketch Plane|Roll History Here|Roll To End|Delete",
  );
  expect(
    tailMenuDescriptors.find((entry) => entry.id === "roll-to-end")?.disabled,
    "Timeline menus should disable Roll To End when the document cursor is already at the authored-history tail.",
  ).toBeTruthy();
  expect(
    pendingCursorMenuDescriptors.find(
      (entry) => entry.id === "roll-history-here",
    )?.disabled === true &&
      pendingCursorMenuDescriptors.find((entry) => entry.id === "roll-to-end")
        ?.disabled === true,
    "Timeline menus should disable cursor actions while a cursor mutation or refresh is pending.",
  ).toBeTruthy();

  const sidebarSketchMenuLabels = getPartsObjectMenuEntries({
    canChangeSketchPlane: true,
    label: "Sketch 1",
    onChangeSketchPlaneTarget: () => undefined,
    onObjectDelete: () => undefined,
    onObjectExport: () => undefined,
    onRenameTarget: () => undefined,
    target: { kind: "sketch", sketchId: sketchHistoryItem.sketchId },
  })
    .filter((entry) => entry.kind === "item")
    .map((entry) => entry.label)
    .join("|");
  const sidebarObjectMenuLabels = getPartsObjectMenuEntries({
    canChangeSketchPlane: false,
    label: "Body 1",
    onChangeSketchPlaneTarget: () => undefined,
    onObjectDelete: () => undefined,
    onObjectExport: () => undefined,
    onRenameTarget: () => undefined,
    target: snapshot.presentation.objects[0]!.target,
  })
    .filter((entry) => entry.kind === "item")
    .map((entry) => entry.label)
    .join("|");

  expect(
    sidebarSketchMenuLabels === "Rename|Change Sketch Plane|Delete|Export" &&
      sidebarObjectMenuLabels === "Rename|Delete|Export",
    "Parts and objects menus should expose Change Sketch Plane only for eligible sketch rows.",
  ).toBeTruthy();

  const erroredTimelineSnapshot = structuredClone(snapshot);
  erroredTimelineSnapshot.document.diagnostics = [
    {
      code: "occ-missing-reference",
      severity: "error",
      message: "Extrude 1 profile selection is incorrect.",
      featureId: "feature_extrude-1" as FeatureId,
      fieldId: "profiles",
      fieldPath: ["parameters", "profiles"],
      repairGuidance: "Edit Extrude 1 and choose a valid profile selection.",
      target: {
        kind: "region",
        sketchId: "sketch_deleted" as SketchId,
        regionId: "region_deleted" as RegionId,
      },
      detail: null,
    },
    {
      code: "feature-dependency-blocked",
      severity: "error",
      message: "Fillet 1 is blocked by an earlier feature error.",
      featureId: "feature_fillet-1" as FeatureId,
      fieldId: "dependency",
      fieldPath: ["dependency"],
      repairGuidance: "Repair Extrude 1, then rebuild Fillet 1.",
      target: { kind: "feature", featureId: "feature_fillet-1" as FeatureId },
      detail: null,
    },
  ];
  const erroredTimelineMarkup = renderToStaticMarkup(
    <MantineProvider theme={workbenchTheme} defaultColorScheme="dark">
      <EditorContext.Provider value={editorValue}>
        <FeatureTimelineBar
          snapshot={erroredTimelineSnapshot}
          historyHighlightFeatureIds={[]}
          visibleSelection={[]}
          onSelectTarget={() => undefined}
          onReopenTarget={() => undefined}
          onCursorRequested={() => undefined}
          onDeleteItem={() => undefined}
          onExportItem={() => undefined}
          onRenameItem={() => undefined}
          onSuppressFeature={() => undefined}
        />
      </EditorContext.Provider>
    </MantineProvider>,
  );

  expect(
    erroredTimelineMarkup.match(/data-feature-error="true"/g)?.length,
    "Timeline should mark every feature with a feature-scoped diagnostic as errored.",
  ).toBe(2);
  expect(
    erroredTimelineMarkup.includes(
      'aria-label="Repair Extrude 1. Edit Extrude 1 and choose a valid profile selection."',
    ),
    "Erroneous feature items should activate the repair context instead of normal selection.",
  ).toBeTruthy();
  expect(
    erroredTimelineMarkup.includes("Repair Extrude 1, then rebuild Fillet 1."),
    "Multiple feature errors should keep repair guidance available from the timeline control.",
  ).toBeTruthy();
  expect(
    erroredTimelineMarkup.includes("data-repair-guidance="),
    "Timeline repair guidance should be available for hover and focus tooltips.",
  ).toBeTruthy();
  expect(
    erroredTimelineMarkup.includes("overflow-x-auto overflow-y-hidden"),
    "Timeline repair guidance should not expand the horizontal scroller height.",
  ).toBeTruthy();
  expect(
    erroredTimelineMarkup.includes('role="tooltip"'),
    "Timeline repair guidance should not render inside the bar until hover or focus.",
  ).toBeFalsy();
  expect(
    erroredTimelineMarkup.includes("region_deleted"),
    "Timeline error copy should not expose raw durable ids.",
  ).toBeFalsy();
  expect(
    erroredTimelineMarkup.match(/data-delete-supported="true"/g)?.length,
    "Recoverable feature errors and sketch rows should still expose delete support.",
  ).toBe(erroredTimelineSnapshot.presentation.documentHistory.length);

  expect(
    getNearestTimelineAnchorIndex([100, 160, 220, 280], 208),
    "Timeline cursor dragging should snap to the nearest earlier valid anchor when dragged near it.",
  ).toBe(1);
  expect(
    getNearestTimelineAnchorIndex([100, 160, 220, 280], 266),
    "Timeline cursor dragging should snap to the nearest later valid anchor when dragged near it.",
  ).toBe(2);
  const moveFeatureBeforeSketch = resolveTimelineReorderDrop(
    snapshot.presentation.documentHistory,
    featureHistoryItem,
    -1,
  );
  expect(
    moveFeatureBeforeSketch?.item.kind === "feature" &&
      moveFeatureBeforeSketch.beforeItem?.kind === "sketch",
    "Timeline feature drops should resolve to durable document history anchors.",
  ).toBeTruthy();
  const moveSketchAfterFeature = resolveTimelineReorderDrop(
    snapshot.presentation.documentHistory,
    sketchHistoryItem,
    snapshot.presentation.documentHistory.length - 1,
  );
  expect(
    moveSketchAfterFeature?.item.kind === "sketch" &&
      moveSketchAfterFeature.beforeItem === null,
    "Timeline sketch drops should support tail insertion after feature items.",
  ).toBeTruthy();
  expect(
    resolveTimelineReorderDrop(
      snapshot.presentation.documentHistory,
      sketchHistoryItem,
      snapshot.presentation.documentHistory.indexOf(sketchHistoryItem) - 1,
    ),
    "Timeline drops at the existing effective position should be ignored.",
  ).toBe(null);

  const reorderDisabledMarkup = renderToStaticMarkup(
    <MantineProvider theme={workbenchTheme} defaultColorScheme="dark">
      <EditorContext.Provider value={editorValue}>
        <FeatureTimelineBar
          snapshot={snapshot}
          historyHighlightFeatureIds={[]}
          visibleSelection={[]}
          onSelectTarget={() => undefined}
          onReopenTarget={() => undefined}
          onCursorRequested={() => undefined}
          reorderDisabled
          onDeleteItem={() => undefined}
          onExportItem={() => undefined}
          onRenameItem={() => undefined}
          onSuppressFeature={() => undefined}
        />
      </EditorContext.Provider>
    </MantineProvider>,
  );
  expect(
    reorderDisabledMarkup.includes('data-reorder-disabled="true"'),
    "Timeline should expose pending-state reorder disablement.",
  ).toBeTruthy();
  expect(
    getNextHistoryTreeFocusIndex(0, "ArrowLeft", 4) === 0 &&
      getNextHistoryTreeFocusIndex(0, "ArrowRight", 4) === 1 &&
      getNextHistoryTreeFocusIndex(1, "ArrowDown", 4) === 2 &&
      getNextHistoryTreeFocusIndex(3, "End", 4) === 3 &&
      getNextHistoryTreeFocusIndex(2, "Home", 4) === 0 &&
      getNextHistoryTreeFocusIndex(1, "Escape", 4) === null,
    "Timeline tree navigation should clamp roving focus within the available history items.",
  ).toBeTruthy();
  expect(
    shouldStartVariableKeyboardEdit("Enter") &&
      shouldStartVariableKeyboardEdit(" ") &&
      shouldStartVariableKeyboardEdit("F2") &&
      !shouldStartVariableKeyboardEdit("Escape"),
    "Variable rows should only enter edit mode from the supported keyboard shortcuts.",
  ).toBeTruthy();

  const sketchCursorSnapshot = {
    ...snapshot,
    document: {
      ...snapshot.document,
      cursor: { kind: "sketch" as const, sketchId: "sketch_primary" as const },
    },
    cursor: { kind: "sketch" as const, sketchId: "sketch_primary" as const },
  };
  const sketchCursorMarkup = renderToStaticMarkup(
    <MantineProvider theme={workbenchTheme} defaultColorScheme="dark">
      <EditorContext.Provider value={editorValue}>
        <FeatureTimelineBar
          snapshot={sketchCursorSnapshot}
          historyHighlightFeatureIds={[]}
          visibleSelection={[{ kind: "sketch", sketchId: "sketch_primary" }]}
          onSelectTarget={() => undefined}
          onReopenTarget={() => undefined}
          onCursorRequested={() => undefined}
          onDeleteItem={() => undefined}
          onExportItem={() => undefined}
          onRenameItem={() => undefined}
          onSuppressFeature={() => undefined}
        />
      </EditorContext.Provider>
    </MantineProvider>,
  );

  expect(
    sketchCursorMarkup.includes("opacity-45"),
    "Timeline should mark feature items after a sketch cursor as after the current cursor.",
  ).toBeTruthy();

  const sketchSession = createSketchSessionFromSnapshot(
    snapshot.document.sketches[0]!,
  );
  const sketchHistoryMarkup = renderToStaticMarkup(
    <MantineProvider theme={workbenchTheme} defaultColorScheme="dark">
      <EditorContext.Provider value={editorValue}>
        <HistoryTimelineShell
          snapshot={snapshot}
          sketchSession={sketchSession}
          historyHighlightFeatureIds={[]}
          visibleSelection={[]}
          onSelectTarget={() => undefined}
          onReopenTarget={() => undefined}
          onDocumentCursorRequested={() => undefined}
          onSketchCursorRequested={() => undefined}
          onDeleteDocumentItem={() => undefined}
          onExportDocumentItem={() => undefined}
          onRenameDocumentItem={() => undefined}
          onSuppressFeature={() => undefined}
        />
      </EditorContext.Provider>
    </MantineProvider>,
  );

  expect(
    sketchHistoryMarkup.includes('data-history-mode="sketch"'),
    "History shell should switch to sketch mode during sketch edit sessions.",
  ).toBeTruthy();
  expect(
    sketchHistoryMarkup.includes('aria-label="Sketch history"'),
    "Sketch edit sessions should render sketch-local history.",
  ).toBeTruthy();
  expect(
    sketchHistoryMarkup.includes("/icons/sketch-line-segment.svg"),
    "Sketch history entity entries should use shared drawing tool icons.",
  ).toBeTruthy();
  expect(
    sketchHistoryMarkup.includes("/icons/sketch-dimension.svg"),
    "Sketch history dimension entries should use shared dimension tool icons.",
  ).toBeTruthy();
  expect(
    sketchHistoryMarkup.includes('aria-haspopup="menu"'),
    "Sketch history items should expose custom context menu affordances.",
  ).toBeTruthy();
  expect(
    sketchHistoryMarkup.includes('data-delete-supported="true"'),
    "Sketch history items should expose delete support from their context menu.",
  ).toBeTruthy();
  expect(
    sketchHistoryMarkup.includes('data-transition-state="leaving-down"'),
    "Document history should expose a reduced-motion-friendly leaving state while sketch history is active.",
  ).toBeTruthy();

  const collapsedMotion = getHistoryTimelinePanelMotionState(true);
  expect(
    collapsedMotion.transitionState === "collapsed-down" &&
      collapsedMotion.style.transform === "translateY(calc(100% + 12px))",
    "Hidden history timeline should use a vertical-only slide-down transform.",
  ).toBeTruthy();

  const visibleMotion = getHistoryTimelinePanelMotionState(false);
  expect(
    visibleMotion.transitionState === "active" &&
      visibleMotion.style.transform === "translateY(0)",
    "Shown history timeline should slide back up into its final vertical position.",
  ).toBeTruthy();

  const preferenceStorage = createTimelinePreferenceStorage();
  writeHistoryTimelineCollapsedPreference(true, preferenceStorage);
  expect(
    preferenceStorage.getItem(HISTORY_TIMELINE_COLLAPSED_STORAGE_KEY) ===
      "true" &&
      readHistoryTimelineCollapsedPreference(preferenceStorage) === true,
    "Hidden history timeline state should persist so refreshes restore the collapsed bar.",
  ).toBeTruthy();

  writeHistoryTimelineCollapsedPreference(false, preferenceStorage);
  expect(
    preferenceStorage.getItem(HISTORY_TIMELINE_COLLAPSED_STORAGE_KEY) ===
      "false" &&
      readHistoryTimelineCollapsedPreference(preferenceStorage) === false,
    "Shown history timeline state should persist so refreshes restore the visible bar.",
  ).toBeTruthy();
});
