import { expect, test } from "vitest";
import { MantineProvider } from "@mantine/core";
import { renderToStaticMarkup } from "react-dom/server";

import { FloatingPartsTree } from "@/components/layout/floating-parts-tree";
import { HistoryTimelineShell } from "@/components/layout/history-timeline-shell";
import { getPrimitiveRefKey } from "@/core/editor/schema";
import {
  getEditorViewState,
  initialEditorState,
} from "@/domain/editor/state-machine";
import { MockKernelAdapter } from "@/domain/modeling/mock-kernel-adapter";
import { EditorContext } from "@/hooks/editor-context";
import { workbenchTheme } from "@/theme/workbench-theme";

test.each([
  ["parts", "body"],
  ["parts", "sketch"],
  ["history", "feature"],
  ["history", "sketch"],
] as const)(
  "%s replaces only the renamed %s label with an inline Title input",
  async (surface, kind) => {
    const { snapshot } = await new MockKernelAdapter().getDocumentSnapshot({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
    });
    const items =
      surface === "parts"
        ? snapshot.presentation.objects
        : snapshot.presentation.documentHistory;
    const item = items.find((item) => item.target.kind === kind)!;
    const renameSession = {
      targetKey: getPrimitiveRefKey(item.target),
      onCommit: () => undefined,
      onCancel: () => undefined,
    };
    const shared = {
      snapshot,
      visibleSelection: [],
      onSelectTarget: () => undefined,
      onReopenTarget: () => undefined,
      renameSession,
    };
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
          {surface === "parts" ? (
            <FloatingPartsTree
              {...shared}
              hiddenTargetKeys={{}}
              objectLabelOverrides={{}}
              onObjectDelete={() => undefined}
              onObjectExport={() => undefined}
              onRenameTarget={() => undefined}
              onToggleTargetVisibility={() => undefined}
            />
          ) : (
            <HistoryTimelineShell
              {...shared}
              sketchSession={null}
              historyHighlightFeatureIds={[]}
              onDeleteDocumentItem={() => undefined}
              onExportDocumentItem={() => undefined}
              onRenameDocumentItem={() => undefined}
              onSuppressFeature={() => undefined}
            />
          )}
        </EditorContext.Provider>
      </MantineProvider>,
    );
    const inputs = markup.match(/<input\b[^>]*>/g);
    expect(inputs).toHaveLength(1);
    expect(inputs![0]).toContain(`aria-label="Rename ${item.label}"`);
    expect(inputs![0]).toContain(`value="${item.label}"`);
    expect(inputs![0]).toContain("autofocus");
    expect(inputs![0]).toContain("text-[13px] font-medium");
    expect(markup).not.toContain('role="dialog"');
    // History inputs must replace the button, not become invalid nested controls.
    expect(markup).not.toMatch(/<button\b[^>]*>(?:(?!<\/button>).)*<input/s);
  },
);
