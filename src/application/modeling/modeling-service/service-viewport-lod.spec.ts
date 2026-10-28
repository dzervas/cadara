import { expect, test } from "vitest";

import type { OccTessellationTierId } from "@/contracts/modeling/tessellation";
import { MockKernelAdapter } from "@/application/modeling/mock-kernel-adapter";
import { createModelingService } from "./service";

class RefiningAdapter extends MockKernelAdapter {
  readonly refinedTiers: OccTessellationTierId[] = [];
  outcome: "refined" | "fail" | "dropped" = "refined";

  async refineSnapshotLod(
    _request: unknown,
    tierId: OccTessellationTierId,
  ): Promise<boolean> {
    this.refinedTiers.push(tierId);
    if (this.outcome === "fail") throw new Error("refinement failed");
    return this.outcome === "refined";
  }
}

test("cadara-se2: a failed or dropped viewport LOD refinement is retried at the same tier", async () => {
  const adapter = new RefiningAdapter();
  const service = createModelingService(adapter, {
    currentDocumentId: "doc_workspace",
  });

  adapter.outcome = "fail";
  expect(service.setViewportLodTier("fine")).toBe(true);
  await expect(service.refineViewportLod()).rejects.toThrow(
    "refinement failed",
  );

  adapter.outcome = "dropped";
  expect(service.setViewportLodTier("fine")).toBe(true);
  await expect(service.refineViewportLod()).resolves.toBe(false);

  adapter.outcome = "refined";
  expect(service.setViewportLodTier("fine")).toBe(true);
  await expect(service.refineViewportLod()).resolves.toBe(true);
  expect(service.setViewportLodTier("fine")).toBe(false);
  expect(adapter.refinedTiers).toEqual(["fine", "fine", "fine"]);

  service.dispose();
});

test("cadara-se2: a superseded viewport LOD refinement keeps the newer requested tier", async () => {
  const adapter = new RefiningAdapter();
  const service = createModelingService(adapter, {
    currentDocumentId: "doc_workspace",
  });

  adapter.outcome = "dropped";
  expect(service.setViewportLodTier("fine")).toBe(true);
  const superseded = service.refineViewportLod();
  expect(service.setViewportLodTier("normal")).toBe(true);
  await expect(superseded).resolves.toBe(false);
  expect(service.setViewportLodTier("normal")).toBe(false);

  service.dispose();
});
