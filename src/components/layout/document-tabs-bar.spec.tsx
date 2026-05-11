import { test } from "bun:test";
import { MantineProvider } from "@mantine/core";
import { renderToStaticMarkup } from "react-dom/server";

import { DocumentTabsBar } from "@/components/layout/document-tabs-bar";
import type { DocumentId } from "@/contracts/shared/ids";
import type {
  WorkbenchTab,
  WorkbenchTabsState,
} from "@/domain/workspace/workbench-tabs";
import { workbenchTheme } from "@/theme/workbench-theme";
import { expectTrue } from "@/testing/expect.spec";

const docA = "doc_a" as DocumentId;
const docB = "doc_b" as DocumentId;

function tab(
  documentId: DocumentId,
  overrides: Partial<WorkbenchTab> = {},
): WorkbenchTab {
  return {
    documentId,
    title: documentId,
    storageKind: "browser",
    storageDescriptor: null,
    ...overrides,
  };
}

function renderBar(
  state: WorkbenchTabsState,
  props: Partial<Parameters<typeof DocumentTabsBar>[0]> = {},
) {
  return renderToStaticMarkup(
    <MantineProvider theme={workbenchTheme} defaultColorScheme="dark">
      <DocumentTabsBar
        state={state}
        onActivate={() => undefined}
        onClose={() => undefined}
        onReorder={() => undefined}
        onRename={() => undefined}
        {...props}
      />
    </MantineProvider>,
  );
}

test("document-tabs-bar renders one tab per document with role=tab and the tablist landmark", () => {
  const state: WorkbenchTabsState = {
    tabs: [
      tab(docA, { title: "Bracket v3" }),
      tab(docB, { title: "shaft.cadara" }),
    ],
    activeDocumentId: docA,
  };

  const markup = renderBar(state);

  expectTrue(
    markup.includes('aria-label="Open documents"'),
    "tablist should expose accessible label.",
  );
  expectTrue(
    markup.includes('role="tablist"'),
    "strip should declare role=tablist.",
  );
  expectTrue(
    markup.split('role="tab"').length - 1 === 2,
    "one role=tab element per open document.",
  );
  expectTrue(
    markup.includes("Bracket v3"),
    "tab labels should render verbatim.",
  );
  expectTrue(
    markup.includes("shaft.cadara"),
    "second tab label should render verbatim.",
  );
});

test("document-tabs-bar marks the active tab with aria-selected=true and the active hairline", () => {
  const state: WorkbenchTabsState = {
    tabs: [tab(docA), tab(docB)],
    activeDocumentId: docB,
  };

  const markup = renderBar(state);

  expectTrue(
    markup.includes('aria-selected="true"'),
    "active tab should advertise aria-selected=true.",
  );
  expectTrue(
    markup.includes('data-tab-hairline="active"'),
    "active tab should render the static active hairline.",
  );
  expectTrue(
    !markup.includes('data-tab-hairline="pending"'),
    "no pending sweep should render when no document is mid-recompute.",
  );
});

test("document-tabs-bar replaces the active hairline with the loading sweep while pending", () => {
  const state: WorkbenchTabsState = {
    tabs: [tab(docA), tab(docB)],
    activeDocumentId: docA,
  };

  const markup = renderBar(state, { pendingDocumentId: docA });

  expectTrue(
    markup.includes('data-tab-hairline="pending"'),
    "pending tab should render the loading sweep.",
  );
  expectTrue(
    !markup.includes('data-tab-hairline="active"'),
    "pending sweep should replace the static active hairline rather than coexist.",
  );
});

test("document-tabs-bar surfaces the error hairline when an activation failed", () => {
  const state: WorkbenchTabsState = {
    tabs: [tab(docA), tab(docB)],
    activeDocumentId: docA,
  };

  const markup = renderBar(state, { errorDocumentId: docA });

  expectTrue(
    markup.includes('data-tab-hairline="error"'),
    "error state should swap the hairline to the error variant.",
  );
});

test("document-tabs-bar hides the close affordance when only one tab is open", () => {
  const state: WorkbenchTabsState = {
    tabs: [tab(docA, { title: "Untitled" })],
    activeDocumentId: docA,
  };

  const markup = renderBar(state);

  expectTrue(
    !markup.includes("Close Untitled"),
    "close button should be omitted when closing would leave the strip empty.",
  );
});

test("document-tabs-bar renders the storage glyph corresponding to each tab", () => {
  const state: WorkbenchTabsState = {
    tabs: [
      tab(docA, { storageKind: "browser" }),
      tab(docB, {
        storageKind: "filesystem",
        storageDescriptor: "shaft.cadara",
      }),
    ],
    activeDocumentId: docA,
  };

  const markup = renderBar(state);

  expectTrue(
    markup.includes('data-storage-glyph="browser"'),
    "browser storage glyph should render for browser-only tabs.",
  );
  expectTrue(
    markup.includes('data-storage-glyph="filesystem"'),
    "filesystem storage glyph should render for filesystem-bound tabs.",
  );
});

test("document-tabs-bar surfaces the storage descriptor in the accessible label", () => {
  const state: WorkbenchTabsState = {
    tabs: [
      tab(docA, {
        storageKind: "filesystem",
        title: "shaft",
        storageDescriptor: "shaft.cadara",
      }),
    ],
    activeDocumentId: docA,
  };

  const markup = renderBar(state);

  expectTrue(
    markup.includes('aria-label="shaft (Synced to shaft.cadara)"'),
    "tab aria-label should include the storage descriptor for screen readers.",
  );
});

test("document-tabs-bar marks tabs draggable when more than one tab is open", () => {
  const state: WorkbenchTabsState = {
    tabs: [tab(docA), tab(docB)],
    activeDocumentId: docA,
  };

  const markup = renderBar(state);

  expectTrue(
    markup.includes('draggable="true"'),
    "multi-tab strips should let users drag to reorder.",
  );
});

test("document-tabs-bar does not let the only tab be dragged or closed", () => {
  const state: WorkbenchTabsState = {
    tabs: [tab(docA)],
    activeDocumentId: docA,
  };

  const markup = renderBar(state);

  expectTrue(
    !markup.includes('draggable="true"'),
    "single tab should not be draggable.",
  );
  expectTrue(
    !markup.includes("data-document-tab-close"),
    "single tab should not show close.",
  );
});

test("document-tabs-bar exposes a title-editing seam for double-click rename", () => {
  const state: WorkbenchTabsState = {
    tabs: [tab(docA, { title: "Bracket v3" })],
    activeDocumentId: docA,
  };

  const markup = renderBar(state);

  expectTrue(
    markup.includes("data-document-tab-title"),
    "tab title should expose a stable hook the rename interaction can attach to.",
  );
});
