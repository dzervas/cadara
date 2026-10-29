/**
 * UI lane (docs/testing.md: `src/hooks`, render-local wiring). Seam:
 * `useEditorStateSelector` under the store `EditorProvider` publishes, with
 * the toolbar's and the parts tree / timeline's own selectors, in memoized
 * components mounted in a real React reconciler (an R3F root; the probes
 * render nothing, so no DOM is needed). The workbench re-renders on every
 * editor state change; a sketch drag move (a new session object, nothing
 * else) must not re-render the toolbar, the parts tree or the document
 * timeline, while a change of what they show still does.
 */
import { act } from "@react-three/fiber";
import { memo } from "react";
import { expect, test } from "vitest";

import { selectToolbarEditorState } from "@/components/layout/workspace-toolbar-editor-state";
import { createStubR3fRoot } from "@/components/cad/r3f-stub-root.fixtures";
import { enterSketchSession } from "@/core/editor/sketch-entry.fixtures";
import { createNewSketchSessionFromSupport } from "@/core/editor/sketch-session";
import { OCC_KERNEL_SETTINGS } from "@/core/modeling/opencascade-kernel-seed";
import type { EditorContextValue } from "@/hooks/editor-context";
import {
  createEditorStateStore,
  EditorStateStoreContext,
  selectSelectionState,
  shallowEqualRecords,
  useEditorStateSelector,
} from "@/hooks/editor-state-store";

const session = enterSketchSession(
  createNewSketchSessionFromSupport(
    { kind: "construction", constructionId: "construction_plane-xy" },
    OCC_KERNEL_SETTINGS,
  ),
);

const sketchCommand = {
  toolId: "sketch",
  phase: "editing",
} as unknown as NonNullable<EditorContextValue["state"]["activeCommand"]>;
// The machine state keeps its selection array across a drag move.
const unchangedSelection: EditorContextValue["state"]["selection"] = [];

function editorValue(
  state: Partial<EditorContextValue["state"]>,
): EditorContextValue {
  return {
    machineState: null as never,
    state: {
      mode: "sketch",
      activeCommand: sketchCommand,
      selection: unchangedSelection,
      selectionCatalog: null,
      selectionFilter: null,
      activeEditSession: null,
      activeSketchPlaneEditSession: null,
      activeImportSession: null,
      sketchSession: session,
      history: { canUndo: true, canRedo: false },
      ...state,
    } as EditorContextValue["state"],
    dispatch: () => undefined,
    getRuntimeTrace: () => null as never,
  };
}

test("a sketch drag move does not re-render the toolbar or the selection consumers; their own changes do", async () => {
  const renders = { toolbar: 0, selection: 0 };
  const ToolbarProbe = memo(function ToolbarProbe() {
    useEditorStateSelector(selectToolbarEditorState, shallowEqualRecords);
    renders.toolbar += 1;
    return null;
  });
  const SelectionProbe = memo(function SelectionProbe() {
    useEditorStateSelector(selectSelectionState, shallowEqualRecords);
    renders.selection += 1;
    return null;
  });
  const first = editorValue({});
  const store = createEditorStateStore(first);
  const root = await createStubR3fRoot();
  // The workbench re-renders with every value; the probes are its memoized
  // children.
  const renderWorkbench = (value: EditorContextValue) =>
    act(async () => {
      root.render(
        <EditorStateStoreContext.Provider value={store}>
          <ToolbarProbe />
          <SelectionProbe />
        </EditorStateStoreContext.Provider>,
      );
      store.publish(value);
    });

  await renderWorkbench(first);
  expect(renders).toEqual({ toolbar: 1, selection: 1 });

  // A drag move: a new session object (moved geometry), a new command
  // object running the same tool, a new history availability object with
  // the same flags, nothing else.
  await renderWorkbench(
    editorValue({
      sketchSession: { ...session, definition: { ...session.definition } },
      activeCommand: { ...sketchCommand },
      history: { canUndo: true, canRedo: false },
    }),
  );
  expect(renders, "a drag move re-renders neither").toEqual({
    toolbar: 1,
    selection: 1,
  });

  await renderWorkbench(
    editorValue({
      selection: [{ kind: "sketch", sketchId: "sketch_a" as never }],
    }),
  );
  expect(
    renders,
    "a selection change re-renders the selection consumer",
  ).toEqual({ toolbar: 1, selection: 2 });

  await renderWorkbench(
    editorValue({ history: { canUndo: false, canRedo: false } }),
  );
  expect(
    renders.toolbar,
    "an undo availability change re-renders the toolbar",
  ).toBe(2);

  await renderWorkbench(editorValue({ sketchSession: null, mode: "part" }));
  expect(renders.toolbar, "leaving the sketch re-renders the toolbar").toBe(3);
  await act(async () => root.unmount());
});
