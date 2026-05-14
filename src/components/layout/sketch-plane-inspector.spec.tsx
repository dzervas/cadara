import { test, expect } from "vitest";
import { MantineProvider } from "@mantine/core";
import { renderToStaticMarkup } from "react-dom/server";

import { EditorContext } from "@/hooks/editor-context";
import { useEditorState } from "@/hooks/use-editor-state";
import { workbenchTheme } from "@/theme/workbench-theme";
import {
  initialEditorState,
  type EditorViewState,
} from "@/domain/editor/state-machine";
import { createSeedDocumentSnapshot } from "@/domain/modeling/modeling-test-fixtures";
import { hydrateSketchPlaneEditSession } from "@/domain/editor/sketch-plane-editing";
import { SketchPlaneInspector } from "./sketch-plane-inspector";

function InspectorHarness() {
  const {
    state: { activeSketchPlaneEditSession },
  } = useEditorState();

  return (
    <SketchPlaneInspector
      session={activeSketchPlaneEditSession ?? null}
      onCancel={() => undefined}
      onCommit={() => undefined}
      onPatch={() => undefined}
    />
  );
}

test("src/components/layout/sketch-plane-inspector.spec.tsx renders the shared support-plane picker state", async () => {
  const snapshot = await createSeedDocumentSnapshot();
  const session = hydrateSketchPlaneEditSession(
    snapshot,
    snapshot.document.sketches[0]!.sketchId,
  );

  expect(
    session,
    "Sketch-plane inspector coverage needs a committed sketch-plane edit session.",
  ).toBeTruthy();

  const viewState: EditorViewState = {
    mode: "part",
    activeCommand: {
      commandSessionId: "command_sketch_plane-1",
      toolId: "sketchPlaneEdit",
      phase: "editing",
    },
    selection: [{ kind: "sketch", sketchId: session!.sketchId }],
    selectionCatalog: null,
    selectionFilter: null,
    hoverTarget: null,
    preview: null,
    activeEditSession: null,
    activeSketchPlaneEditSession: session,
    activeImportSession: null,
    activeReferencePickerFieldId: "sketch-plane-support",
    sketchSession: null,
    activeSectionView: null,
    snapshot,
    previewRenderables: null,
    history: {
      canUndo: false,
      canRedo: false,
    },
  };

  const markup = renderToStaticMarkup(
    <MantineProvider theme={workbenchTheme} defaultColorScheme="dark">
      <EditorContext.Provider
        value={{
          machineState: initialEditorState,
          state: viewState,
          dispatch: () => undefined,
        }}
      >
        <InspectorHarness />
      </EditorContext.Provider>
    </MantineProvider>,
  );

  expect(
    markup.includes("Support plane") &&
      markup.includes("construction_plane-xy"),
    "Sketch-plane inspector should render the support-plane picker label and the current committed support target.",
  ).toBeTruthy();
  expect(
    markup.includes('aria-pressed="true"'),
    "Sketch-plane inspector should expose the active support-plane picker as pressed when the shared picker state is active.",
  ).toBeTruthy();
});
