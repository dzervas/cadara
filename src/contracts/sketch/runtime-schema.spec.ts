import { expect, test } from "vitest";

import { validateSketchRecord } from "@/contracts/sketch/runtime-schema";
import { MockKernelAdapter } from "@/domain/modeling/mock-kernel-adapter";

// Lane: logic. Seam: strict current sketch-record runtime contract.
test("invalid and stale sketch derivations cannot carry consumable regions", async () => {
  const snapshot = await new MockKernelAdapter().getDocumentSnapshot({
    contractVersion: "modeling-contract/v1alpha1",
    documentId: "doc_workspace",
  });
  const current = snapshot.snapshot.document.sketches[0]!.sketch;
  expect(validateSketchRecord(current).success).toBe(true);

  const invalidWithCachedRegions = structuredClone(current);
  invalidWithCachedRegions.derivedValidity = {
    state: "invalid",
    diagnostics: [
      {
        code: "missing-geometry",
        severity: "error",
        message: "Missing geometry.",
        target: null,
      },
    ],
  };
  expect(validateSketchRecord(invalidWithCachedRegions).success).toBe(false);

  const staleWithCachedRegions = structuredClone(current);
  staleWithCachedRegions.derivedValidity = {
    state: "stale",
    diagnostics: [],
  };
  expect(validateSketchRecord(staleWithCachedRegions).success).toBe(false);
});
