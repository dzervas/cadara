// Logic lane; seam: the modeling service over a memory document repository.
// Changing a body's colour is one undoable authored action ("Change Body
// Color"): persisted in the authored document, reversed by durable Undo and
// re-applied by Redo, and an invalid colour is refused before any write.
import { expect, test } from "vitest";

import type { AuthoredModelDocument } from "@/contracts/modeling/authored-document";
import type { BodyAppearance } from "@/contracts/modeling/body-appearance";
import { createMemoryDocumentRepository } from "@/domain/modeling/memory-document-repository";
import { MockKernelAdapter } from "@/domain/modeling/mock-kernel-adapter";
import { createModelingService } from "@/domain/modeling/modeling-service";

const documentId = "doc_workspace";
const bodyId = "body_part-1";

const storedAppearance = (document: AuthoredModelDocument | undefined) =>
  document?.bodyAppearances?.find((record) => record.bodyId === bodyId)
    ?.appearance;

test("a body colour change is persisted, undone to the previous colour and redone", async () => {
  const repository = createMemoryDocumentRepository();
  const service = createModelingService(new MockKernelAdapter(), {
    currentDocumentId: documentId,
    documentRepository: repository,
  });
  const liveAppearance = async () =>
    (await service.getCurrentDocumentSnapshot()).document.bodies.find(
      (body) => body.bodyId === bodyId,
    )?.appearance;
  const original: BodyAppearance = { kind: "palette", slot: 0 };
  const custom: BodyAppearance = { kind: "custom", hex: "#336699" };
  try {
    const initial = await service.getCurrentDocumentSnapshot();
    expect(
      await liveAppearance(),
      "premise: the seed body's auto slot",
    ).toEqual(original);

    const set = await service.setBodyAppearance({
      baseRevisionId: initial.document.revisionId,
      bodyId,
      appearance: custom,
    });
    expect(set.isOk() && set.value.revisionState.kind).toBe("accepted");
    await service.waitForPersistence();
    expect(await liveAppearance()).toEqual(custom);
    const history = await repository.getDurableHistoryAvailability(documentId);
    expect(history.undoEntries?.map((entry) => entry.label)).toEqual([
      "Change Body Color",
    ]);

    const undone = await repository.undoDurableHistory(documentId);
    expect(undone?.ok && storedAppearance(undone.document)).toEqual(original);
    expect(await liveAppearance(), "the runtime follows the undo").toEqual(
      original,
    );

    const redone = await repository.redoDurableHistory(documentId);
    expect(redone?.ok && storedAppearance(redone.document)).toEqual(custom);
    expect(await liveAppearance(), "the runtime follows the redo").toEqual(
      custom,
    );

    const current = await service.getCurrentDocumentSnapshot();
    for (const appearance of [
      { kind: "custom", hex: "#33669G" },
      { kind: "custom", hex: "#336699 " },
      { kind: "palette", slot: -1 },
      { kind: "palette", slot: 2.5 },
      { kind: "palette", slot: 0, hex: "#336699" },
    ]) {
      const refused = await service.setBodyAppearance({
        baseRevisionId: current.document.revisionId,
        bodyId,
        appearance: appearance as never,
      });
      expect(refused.isErr(), JSON.stringify(appearance)).toBe(true);
    }
    expect(
      (await repository.getDurableHistoryAvailability(documentId)).undoEntries,
      "refused colours record no action",
    ).toHaveLength(1);
    expect(await liveAppearance()).toEqual(custom);
  } finally {
    service.dispose();
  }
});
