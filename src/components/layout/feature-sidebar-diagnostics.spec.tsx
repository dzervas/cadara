// T17e (review R-3). UI lane; seam: the sidebar's Diagnostics list render
// (static markup). A committed sketch's diagnostic shows its message, the
// detail by feature label and its code, never a target id line, an
// address or a revision id.
import { test, expect } from "vitest";
import { MantineProvider } from "@mantine/core";
import { renderToStaticMarkup } from "react-dom/server";
import { FeatureSidebar } from "@/components/layout/feature-sidebar";
import type { ModelingDiagnostic } from "@/contracts/modeling/schema";
import { expectNoInternalIds } from "@/contracts/sketch/user-text.fixtures";
import { getPrimitiveRefKey } from "@/core/editor/schema";
import {
  getEditorViewState,
  initialEditorState,
} from "@/core/editor/state-machine";
import { MockKernelAdapter } from "@/domain/modeling/mock-kernel-adapter";
import { EditorContext } from "@/hooks/editor-context";
import { workbenchTheme } from "@/theme/workbench-theme";

test("T17e: the Diagnostics list shows no target id, address or revision id", async () => {
  const adapter = new MockKernelAdapter();
  const { snapshot } = await adapter.getDocumentSnapshot({
    contractVersion: "modeling-contract/v1alpha1",
    documentId: "doc_workspace",
  });
  const sketchId = snapshot.document.sketches[0]!.sketchId;
  const feature = snapshot.document.features[0]!;
  const diagnostics = [
    {
      code: "occ-solver:degenerate-line-segment",
      severity: "error",
      message: "‘Line 1’ is shorter than the minimum segment length tolerance.",
      target: {
        kind: "sketchEntity",
        sketchId,
        entityId: "sketch_entity_1_line_t17e",
      },
    },
    {
      code: "rebuild-failed",
      severity: "error",
      message: "The rebuild failed.",
      target: null,
      detail: {
        kind: "rebuildFailure",
        affectedFeatureIds: [feature.featureId],
        affectedTargets: [{ kind: "sketch", sketchId }],
      },
    },
    {
      code: "revision-conflict",
      severity: "warning",
      message: "The document changed meanwhile.",
      target: null,
      detail: {
        kind: "revisionConflict",
        expectedRevisionId: "rev_0001",
        actualRevisionId: "rev_0002",
      },
    },
  ] as unknown as ModelingDiagnostic[];
  const markup = renderToStaticMarkup(
    <MantineProvider theme={workbenchTheme} defaultColorScheme="dark">
      <EditorContext.Provider
        value={{
          machineState: initialEditorState,
          state: {
            ...getEditorViewState(initialEditorState),
            selectionCatalog: {
              selectableTargetKeys: snapshot.presentation.entities.map(
                (entity) => getPrimitiveRefKey(entity.target),
              ),
              existingSketchKeys: [],
              constructionPlaneKeys: [],
              planarFaceKeys: [],
            },
          },
          dispatch: () => undefined,
          getRuntimeTrace: () => ({
            entries: [],
            maxEntries: 0,
            totalEntries: 0,
            droppedEntries: 0,
          }),
        }}
      >
        <FeatureSidebar
          snapshot={{
            ...snapshot,
            document: { ...snapshot.document, diagnostics },
          }}
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
  const panel = markup.slice(markup.indexOf("Document Diagnostics"));
  expect(panel).toContain(
    "‘Line 1’ is shorter than the minimum segment length tolerance.",
  );
  expect(panel).toContain(`Affected features: ‘${feature.label}’`);
  expect(panel).not.toContain("Target ");
  expect(panel).not.toContain("rev_0001");
  const texts = panel
    .replace(/<[^>]*>/g, "\n")
    .split("\n")
    .map((text) => text.trim())
    .filter((text) => text.length > 0);
  expectNoInternalIds(texts, [sketchId, feature.featureId]);
});
