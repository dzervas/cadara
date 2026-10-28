import { expect, test } from "vitest";
import { MantineProvider } from "@mantine/core";
import { renderToStaticMarkup } from "react-dom/server";

import { HistoryTimelineShell } from "@/components/layout/history-timeline-shell";
import type { FeatureId, SketchId } from "@/contracts/shared/ids";
import {
  getEditorViewState,
  initialEditorState,
} from "@/core/editor/state-machine";
import { createSketchSessionFromSnapshot } from "@/core/editor/sketch-session";
import { MockKernelAdapter } from "@/application/modeling/mock-kernel-adapter";
import { OCC_KERNEL_SETTINGS } from "@/core/modeling/opencascade-kernel-seed";
import { EditorContext } from "@/hooks/editor-context";
import { workbenchTheme } from "@/theme/workbench-theme";

test("long feature timelines overflow their scroller instead of widening the shared panel grid", async () => {
  const { snapshot } = await new MockKernelAdapter().getDocumentSnapshot({
    contractVersion: "modeling-contract/v1alpha1",
    documentId: "doc_workspace",
  });
  const feature = snapshot.presentation.documentHistory.find(
    (item) => item.kind === "feature",
  );
  const sketch = snapshot.presentation.documentHistory.find(
    (item) => item.kind === "sketch",
  );
  if (!feature || !sketch) {
    throw new Error("Timeline fixture needs a committed feature and sketch");
  }

  // Match enclosure/model.cadara's 21 sketches and 21 features without loading
  // geometry: later features must remain reachable in a narrow timeline.
  snapshot.presentation.documentHistory = Array.from(
    { length: 21 },
    (_, index) => {
      const featureId = `feature_extrude-${index + 1}` as FeatureId;
      const sketchId = `sketch_timeline-${index + 1}` as SketchId;
      return [
        {
          ...sketch,
          id: `document_history_item_sketch-${index + 1}` as const,
          sketchId,
          label: `Sketch ${index + 1}`,
          target: { kind: "sketch" as const, sketchId },
        },
        {
          ...feature,
          id: `document_history_item_feature-${index + 1}` as const,
          featureId,
          label: `Extrude ${index + 1}`,
          target: { kind: "feature" as const, featureId },
        },
      ];
    },
  ).flat();
  const sketchSession = createSketchSessionFromSnapshot(
    snapshot.document.sketches[0]!,
    OCC_KERNEL_SETTINGS,
  );

  for (const session of [null, sketchSession]) {
    const markup = renderToStaticMarkup(
      <MantineProvider theme={workbenchTheme} defaultColorScheme="dark">
        <EditorContext.Provider
          value={{
            machineState: initialEditorState,
            state: getEditorViewState(initialEditorState),
            dispatch: () => undefined,
            getRuntimeTrace: () => ({
              entries: [],
              maxEntries: 0,
              totalEntries: 0,
              droppedEntries: 0,
            }),
          }}
        >
          <HistoryTimelineShell
            snapshot={snapshot}
            sketchSession={session}
            actionHistory={{
              undo: [{ sequence: 1, label: "Edit feature" }],
              redo: [],
            }}
            historyHighlightFeatureIds={[]}
            visibleSelection={[]}
            onSelectTarget={() => undefined}
            onReopenTarget={() => undefined}
            onDeleteDocumentItem={() => undefined}
            onExportDocumentItem={() => undefined}
            onRenameDocumentItem={() => undefined}
            onSuppressFeature={() => undefined}
          />
        </EditorContext.Provider>
      </MantineProvider>,
    );

    expect(markup).toContain(
      'aria-label="Select Extrude 12. Double-click to reopen."',
    );
    expect(markup).toContain(
      'aria-label="Select Extrude 21. Double-click to reopen."',
    );
    expect(markup).toContain(
      'class="pointer-events-auto mx-4 mb-1 overflow-x-auto"',
    );
    expect(
      markup,
      "The shared grid must use a minmax(0, 1fr) column so long content can overflow the inner scroller rather than expanding an auto-sized column.",
    ).toMatch(
      /class="[^"]*\bgrid-cols-1\b[^"]*"[^>]*data-history-motion="timeline-panel"/,
    );
    expect(
      markup,
      "The feature track must retain its intrinsic width inside a horizontal-only scroller.",
    ).toMatch(
      /class="overflow-x-auto overflow-y-hidden"><div class="relative min-w-full w-max">/,
    );
    for (const panel of session ? ["document", "sketch"] : ["document"]) {
      expect(
        markup,
        `${panel} history must remain in flow in the shared grid cell to preserve shell height across modes.`,
      ).toMatch(
        new RegExp(
          `class="(?=[^"]*col-start-1)(?=[^"]*row-start-1)(?![^"]*absolute)[^"]*"[^>]*data-history-panel="${panel}"`,
        ),
      );
    }
  }
});
