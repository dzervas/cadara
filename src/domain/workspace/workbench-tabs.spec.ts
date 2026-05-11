import { describe, expect, it } from "bun:test";

import type { DocumentId } from "@/contracts/shared/ids";

import {
  createInitialWorkbenchTabsState,
  reconcileWorkbenchTabsForActiveDocument,
  reduceWorkbenchTabs,
  workbenchTabsStorageDescriptor,
  type WorkbenchTab,
} from "./workbench-tabs";

const docA = "doc_a" as DocumentId;
const docB = "doc_b" as DocumentId;
const docC = "doc_c" as DocumentId;

function tab(
  documentId: DocumentId,
  title = documentId,
  storageKind: WorkbenchTab["storageKind"] = "browser",
): WorkbenchTab {
  return { documentId, title, storageKind, storageDescriptor: null };
}

describe("reduceWorkbenchTabs", () => {
  describe("open", () => {
    it("appends a new tab without changing the active id by default", () => {
      const state = createInitialWorkbenchTabsState(tab(docA));
      const next = reduceWorkbenchTabs(state, { type: "open", tab: tab(docB) });

      expect(next.tabs.map((entry) => entry.documentId)).toEqual([docA, docB]);
      expect(next.activeDocumentId).toBe(docA);
    });

    it("activates the new tab when activate=true", () => {
      const state = createInitialWorkbenchTabsState(tab(docA));
      const next = reduceWorkbenchTabs(state, {
        type: "open",
        tab: tab(docB),
        activate: true,
      });

      expect(next.activeDocumentId).toBe(docB);
    });

    it("updates an existing tab in place rather than duplicating", () => {
      const state = createInitialWorkbenchTabsState(tab(docA, "Old title"));
      const next = reduceWorkbenchTabs(state, {
        type: "open",
        tab: tab(docA, "New title"),
      });

      expect(next.tabs).toHaveLength(1);
      expect(next.tabs[0].title).toBe("New title");
    });
  });

  describe("close", () => {
    it("refuses to close the only tab", () => {
      const state = createInitialWorkbenchTabsState(tab(docA));
      const next = reduceWorkbenchTabs(state, {
        type: "close",
        documentId: docA,
      });

      expect(next).toBe(state);
    });

    it("promotes the right-hand neighbor when closing the active tab", () => {
      const seeded = reduceWorkbenchTabs(
        reduceWorkbenchTabs(createInitialWorkbenchTabsState(tab(docA)), {
          type: "open",
          tab: tab(docB),
        }),
        { type: "open", tab: tab(docC) },
      );

      const next = reduceWorkbenchTabs(seeded, {
        type: "close",
        documentId: docA,
      });

      expect(next.tabs.map((entry) => entry.documentId)).toEqual([docB, docC]);
      expect(next.activeDocumentId).toBe(docB);
    });

    it("falls back to the left-hand neighbor when closing the rightmost active tab", () => {
      const seeded = reduceWorkbenchTabs(
        reduceWorkbenchTabs(createInitialWorkbenchTabsState(tab(docA)), {
          type: "open",
          tab: tab(docB),
          activate: true,
        }),
        { type: "open", tab: tab(docC), activate: true },
      );

      const next = reduceWorkbenchTabs(seeded, {
        type: "close",
        documentId: docC,
      });

      expect(next.tabs.map((entry) => entry.documentId)).toEqual([docA, docB]);
      expect(next.activeDocumentId).toBe(docB);
    });

    it("keeps the active id when closing a non-active tab", () => {
      const seeded = reduceWorkbenchTabs(
        createInitialWorkbenchTabsState(tab(docA)),
        {
          type: "open",
          tab: tab(docB),
        },
      );

      const next = reduceWorkbenchTabs(seeded, {
        type: "close",
        documentId: docB,
      });

      expect(next.activeDocumentId).toBe(docA);
      expect(next.tabs.map((entry) => entry.documentId)).toEqual([docA]);
    });
  });

  describe("activate", () => {
    it("switches the active id when the target exists", () => {
      const seeded = reduceWorkbenchTabs(
        createInitialWorkbenchTabsState(tab(docA)),
        {
          type: "open",
          tab: tab(docB),
        },
      );

      const next = reduceWorkbenchTabs(seeded, {
        type: "activate",
        documentId: docB,
      });

      expect(next.activeDocumentId).toBe(docB);
    });

    it("is a no-op when the target is not in the tab list", () => {
      const state = createInitialWorkbenchTabsState(tab(docA));
      const next = reduceWorkbenchTabs(state, {
        type: "activate",
        documentId: docB,
      });

      expect(next).toBe(state);
    });
  });

  describe("reorder", () => {
    it("moves the tab to the requested index", () => {
      const seeded = reduceWorkbenchTabs(
        reduceWorkbenchTabs(createInitialWorkbenchTabsState(tab(docA)), {
          type: "open",
          tab: tab(docB),
        }),
        { type: "open", tab: tab(docC) },
      );

      const next = reduceWorkbenchTabs(seeded, {
        type: "reorder",
        documentId: docC,
        toIndex: 0,
      });

      expect(next.tabs.map((entry) => entry.documentId)).toEqual([
        docC,
        docA,
        docB,
      ]);
    });

    it("clamps an out-of-bounds index instead of throwing", () => {
      const seeded = reduceWorkbenchTabs(
        createInitialWorkbenchTabsState(tab(docA)),
        {
          type: "open",
          tab: tab(docB),
        },
      );

      const next = reduceWorkbenchTabs(seeded, {
        type: "reorder",
        documentId: docA,
        toIndex: 999,
      });

      expect(next.tabs.map((entry) => entry.documentId)).toEqual([docB, docA]);
    });
  });

  describe("rename / updateStorage", () => {
    it("renames a tab", () => {
      const state = createInitialWorkbenchTabsState(tab(docA, "Untitled"));
      const next = reduceWorkbenchTabs(state, {
        type: "rename",
        documentId: docA,
        title: "Bracket v3",
      });

      expect(next.tabs[0].title).toBe("Bracket v3");
    });

    it("updates storage kind and descriptor", () => {
      const state = createInitialWorkbenchTabsState(tab(docA));
      const next = reduceWorkbenchTabs(state, {
        type: "updateStorage",
        documentId: docA,
        storageKind: "filesystem",
        storageDescriptor: "bracket.cadara",
      });

      expect(next.tabs[0].storageKind).toBe("filesystem");
      expect(next.tabs[0].storageDescriptor).toBe("bracket.cadara");
    });

    it("syncs the active tab title and storage from the active session snapshot", () => {
      const seeded = reduceWorkbenchTabs(
        createInitialWorkbenchTabsState(tab(docA, "Untitled")),
        {
          type: "open",
          tab: tab(docB, "Bracket v1"),
          activate: true,
        },
      );

      const next = reduceWorkbenchTabs(seeded, {
        type: "syncActive",
        tab: {
          documentId: docB,
          title: "Bracket v2",
          storageKind: "filesystem",
          storageDescriptor: "bracket.cadara",
        },
      });

      expect(next.tabs).toEqual([
        tab(docA, "Untitled"),
        {
          documentId: docB,
          title: "Bracket v2",
          storageKind: "filesystem",
          storageDescriptor: "bracket.cadara",
        },
      ]);
      expect(next.activeDocumentId).toBe(docB);
    });

    it("ignores stale active-session sync for a tab that is no longer active or open", () => {
      const seeded = reduceWorkbenchTabs(
        createInitialWorkbenchTabsState(tab(docA, "Old A")),
        {
          type: "open",
          tab: tab(docB, "Current B"),
          activate: true,
        },
      );

      const next = reduceWorkbenchTabs(seeded, {
        type: "syncActive",
        tab: {
          documentId: docA,
          title: "Stale A",
          storageKind: "filesystem",
          storageDescriptor: "stale-a.cadara",
        },
      });

      expect(next).toEqual(seeded);

      const closed = reduceWorkbenchTabs(seeded, {
        type: "close",
        documentId: docA,
      });
      const afterClosedSync = reduceWorkbenchTabs(closed, {
        type: "syncActive",
        tab: {
          documentId: docA,
          title: "Reopened by stale sync",
          storageKind: "filesystem",
          storageDescriptor: "wrong-target.cadara",
        },
      });

      expect(afterClosedSync).toEqual(closed);
    });
  });
});

describe("reconcileWorkbenchTabsForActiveDocument", () => {
  it("seeds from active when persistence is empty", () => {
    const next = reconcileWorkbenchTabsForActiveDocument(null, tab(docA));
    expect(next.tabs).toHaveLength(1);
    expect(next.activeDocumentId).toBe(docA);
  });

  it("keeps the persisted order and activates the loaded document when present", () => {
    const persisted = {
      tabs: [tab(docA), tab(docB), tab(docC)],
      activeDocumentId: docC,
    };
    const next = reconcileWorkbenchTabsForActiveDocument(persisted, tab(docB));

    expect(next.tabs.map((entry) => entry.documentId)).toEqual([
      docA,
      docB,
      docC,
    ]);
    expect(next.activeDocumentId).toBe(docB);
  });

  it("prepends the loaded document if persistence drifted", () => {
    const persisted = { tabs: [tab(docA), tab(docC)], activeDocumentId: docA };
    const next = reconcileWorkbenchTabsForActiveDocument(persisted, tab(docB));

    expect(next.tabs.map((entry) => entry.documentId)).toEqual([
      docB,
      docA,
      docC,
    ]);
    expect(next.activeDocumentId).toBe(docB);
  });
});

describe("workbenchTabsStorageDescriptor", () => {
  it("describes the storage backend for tooltip copy", () => {
    expect(workbenchTabsStorageDescriptor("browser", null)).toBe(
      "Stored in this browser only",
    );
    expect(workbenchTabsStorageDescriptor("filesystem", "bracket.cadara")).toBe(
      "Synced to bracket.cadara",
    );
    expect(workbenchTabsStorageDescriptor("filesystem", null)).toBe(
      "Synced to a local file",
    );
    expect(workbenchTabsStorageDescriptor("cloud", "Drive")).toBe(
      "Cloud-synced — Drive",
    );
    expect(workbenchTabsStorageDescriptor("cloud", null)).toBe("Cloud-synced");
  });
});
