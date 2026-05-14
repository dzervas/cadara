import { test, expect } from "vitest";

import { createObjectExportModalState } from "@/domain/export/object-export-state";
import { MockKernelAdapter } from "@/domain/modeling/mock-kernel-adapter";

test("src/app/object-export-state.spec.ts", async () => {
  const adapter = new MockKernelAdapter();
  const snapshot = (
    await adapter.getDocumentSnapshot({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
    })
  ).snapshot;

  const modalState = createObjectExportModalState(
    snapshot,
    { kind: "body", bodyId: "body_part-1" },
    "Part 1",
  );

  expect(
    modalState,
    "Export should produce modal-opening state for a selected row.",
  ).not.toBe(null);
  expect(
    modalState.label,
    "Export modal state should preserve the selected row label.",
  ).toBe("Part 1");
  expect(
    modalState.baseRevisionId,
    "Export modal state should capture the current revision.",
  ).toBe(snapshot.document.revisionId);
  expect(
    JSON.stringify(modalState).includes("not implemented"),
    "Export should not produce the previous placeholder status message.",
  ).toBeFalsy();
});
