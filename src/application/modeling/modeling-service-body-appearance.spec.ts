// Logic lane; seam: the modeling service over a memory document repository.
// Changing a body's colour is one undoable authored action ("Change Body
// Color"): persisted in the authored document, reversed by durable Undo and
// re-applied by Redo, and an invalid colour is refused before any write.
import { expect, test } from "vitest";

import type { AuthoredModelDocument } from "@/contracts/modeling/authored-document";
import type { BodyAppearance } from "@/contracts/modeling/body-appearance";
import { createMemoryDocumentRepository } from "@/application/modeling/memory-document-repository";
import { MockKernelAdapter } from "@/application/modeling/mock-kernel-adapter";
import { createModelingService } from "@/application/modeling/modeling-service";
import { createSeedAuthoredModelDocument } from "@/application/modeling/modeling-test-fixtures";

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

// cadara-qj6. Seam: `exportCurrentDocument`, which the workbench's Download a
// copy / Save linked file (no receipt) and the semantic native save (with a
// receipt) call, issued while a colour change it follows is still in flight
// under the workbench's background persistence.
test.each([
  ["a download copy", false],
  ["a native save", true],
])("%s requested right after a colour change includes it", async (_, native) => {
  const repository = createMemoryDocumentRepository();
  const service = createModelingService(new MockKernelAdapter(), {
    currentDocumentId: documentId,
    documentRepository: repository,
    documentRepositoryPersistence: "background",
  });
  const custom: BodyAppearance = { kind: "custom", hex: "#336699" };
  try {
    const initial = await service.getCurrentDocumentSnapshot();
    const set = service.setBodyAppearance({
      baseRevisionId: initial.document.revisionId,
      bodyId,
      appearance: custom,
    });
    let receiptOk: boolean | null = null;
    const saved = await service.exportCurrentDocument(
      native ? { observe: (receipt) => (receiptOk = receipt.ok) } : undefined,
    );
    expect((await set).isOk()).toBe(true);
    expect(
      storedAppearance(JSON.parse(saved.payload as string)),
      "the saved file holds the colour change requested before the save",
    ).toEqual(custom);
    if (native) expect(receiptOk).toBe(true);
    await service.waitForPersistence();
    expect(
      (await repository.getDurableHistoryAvailability(documentId)).undoEntries?.map(
        (entry) => entry.label,
      ),
    ).toEqual(["Change Body Color"]);
    expect((await service.getHistoryRestoreState()).kind).not.toBe("failed");
  } finally {
    service.dispose();
  }
});

// cadara-vk96. Seam: `waitForLocalChanges`, which the app update prompt's
// Reload awaits before reloading: a colour change requested just before it,
// still queued under background persistence, is stored when it settles.
class SlowBodyAppearanceAdapter extends MockKernelAdapter {
  override async setBodyAppearance(
    ...input: Parameters<MockKernelAdapter["setBodyAppearance"]>
  ) {
    // The kernel still works on the change when the wait starts.
    await new Promise((resolve) => setTimeout(resolve, 50));
    return super.setBodyAppearance(...input);
  }
}

test("waitForLocalChanges settles only after a local change requested before it is stored", async () => {
  const repository = createMemoryDocumentRepository();
  const service = createModelingService(new SlowBodyAppearanceAdapter(), {
    currentDocumentId: documentId,
    documentRepository: repository,
    documentRepositoryPersistence: "background",
  });
  const custom: BodyAppearance = { kind: "custom", hex: "#336699" };
  try {
    const initial = await service.getCurrentDocumentSnapshot();
    const set = service.setBodyAppearance({
      baseRevisionId: initial.document.revisionId,
      bodyId,
      appearance: custom,
    });
    await service.waitForLocalChanges();
    const stored = await repository.load({
      documentId,
      seedDocument: await createSeedAuthoredModelDocument(documentId),
    });
    expect(
      stored.ok && storedAppearance(stored.document),
      "the repository holds the change requested before the wait",
    ).toEqual(custom);
    expect((await set).isOk()).toBe(true);
  } finally {
    service.dispose();
  }
});

test("waitForLocalChanges resolves for a document that failed to open: it has nothing to save", async () => {
  const repository = createMemoryDocumentRepository();
  repository.load = () => Promise.reject(new Error("storage unreadable"));
  const service = createModelingService(new MockKernelAdapter(), {
    currentDocumentId: documentId,
    documentRepository: repository,
    documentRepositoryPersistence: "background",
  });
  try {
    await expect(
      service.waitForPersistence(),
      "premise: the document failed to initialize",
    ).rejects.toThrow("storage unreadable");
    await expect(service.waitForLocalChanges()).resolves.toBeUndefined();
  } finally {
    service.dispose();
  }
});

test("waitForLocalChanges rejects with the reason when an accepted local change could not be stored", async () => {
  const repository = createMemoryDocumentRepository();
  const service = createModelingService(new MockKernelAdapter(), {
    currentDocumentId: documentId,
    documentRepository: repository,
    documentRepositoryPersistence: "background",
  });
  try {
    const initial = await service.getCurrentDocumentSnapshot();
    repository.mutate = () => Promise.reject(new Error("quota exceeded"));
    const set = await service.setBodyAppearance({
      baseRevisionId: initial.document.revisionId,
      bodyId,
      appearance: { kind: "custom", hex: "#336699" },
    });
    expect(
      set.isOk() && set.value.revisionState.kind,
      "premise: the change was accepted in memory",
    ).toBe("accepted");
    await expect(service.waitForLocalChanges()).rejects.toThrow(
      "Local changes could not be saved, so reloading would lose them: quota exceeded",
    );
  } finally {
    service.dispose();
  }
});

// cadara-01k.1 follow-up. Seam: the workbench "Open a copy" entry point
// (`openDocumentCopyAsTab`: `repository.initialize` with the parsed file, then
// the tab's service restores it) for a document saved before body colours.
// Its bodies have kernel auto slots but the stored document has no
// `bodyAppearances`: the first colour change and the first feature action
// persist them as undoable actions, and a first timeline cursor move persists
// them without becoming an undo entry.
async function openOldDocumentCopy() {
  const document = await createSeedAuthoredModelDocument(documentId);
  delete document.bodyAppearances;
  const repository = createMemoryDocumentRepository();
  expect((await repository.initialize({ documentId, document })).ok).toBe(true);
  const service = createModelingService(new MockKernelAdapter(), {
    currentDocumentId: documentId,
    documentRepository: repository,
    documentRepositoryPersistence: "background",
  });
  const snapshot = await service.getCurrentDocumentSnapshot();
  const stored = async () => {
    await service.waitForPersistence();
    const loaded = await repository.load({
      documentId,
      seedDocument: document,
    });
    if (!loaded.ok) throw new Error("The stored document must load.");
    return loaded.document;
  };
  const undoLabels = async () =>
    (
      await repository.getDurableHistoryAvailability(documentId)
    ).undoEntries?.map((entry) => entry.label);
  return { service, repository, snapshot, stored, undoLabels };
}

test("an old document's first colour change through the workbench open path persists and undoes", async () => {
  const { service, repository, snapshot, stored, undoLabels } =
    await openOldDocumentCopy();
  try {
    expect(await stored(), "premise: opening wrote nothing").not.toHaveProperty(
      "bodyAppearances",
    );
    const set = await service.setBodyAppearance({
      baseRevisionId: snapshot.document.revisionId,
      bodyId,
      appearance: { kind: "palette", slot: 4 },
    });
    expect(set.isOk() && set.value.revisionState.kind).toBe("accepted");
    expect(storedAppearance(await stored())).toEqual({
      kind: "palette",
      slot: 4,
    });
    expect(await undoLabels()).toEqual(["Change Body Color"]);
    expect((await service.getHistoryRestoreState()).kind).not.toBe("failed");

    const undone = await repository.undoDurableHistory(documentId);
    expect(undone?.ok && undone.document).not.toHaveProperty("bodyAppearances");
    expect(
      (await service.getCurrentDocumentSnapshot()).document.bodies[0]
        ?.appearance,
    ).toEqual({ kind: "palette", slot: 0 });
  } finally {
    service.dispose();
  }
});

test("an old document's first feature action persists its auto slots; a first cursor move persists them without an undo entry", async () => {
  const feature = await openOldDocumentCopy();
  try {
    const seed = feature.snapshot.document.features[0]!;
    const created = await feature.service.createFeature({
      baseRevisionId: feature.snapshot.document.revisionId,
      definition: seed.definition,
    });
    expect(created.isOk() && created.value.revisionState.kind).toBe("accepted");
    expect(storedAppearance(await feature.stored())).toEqual({
      kind: "palette",
      slot: 0,
    });
    expect(await feature.undoLabels()).toHaveLength(1);
  } finally {
    feature.service.dispose();
  }

  const cursor = await openOldDocumentCopy();
  try {
    const moved = await cursor.service.setFeatureCursor({
      baseRevisionId: cursor.snapshot.document.revisionId,
      cursor: { kind: "empty" },
    });
    expect(moved.isOk() && moved.value.revisionState.kind).toBe("accepted");
    expect(storedAppearance(await cursor.stored())).toEqual({
      kind: "palette",
      slot: 0,
    });
    expect(
      await cursor.undoLabels(),
      "a timeline cursor move is never an undo entry",
    ).toEqual([]);
  } finally {
    cursor.service.dispose();
  }
});
