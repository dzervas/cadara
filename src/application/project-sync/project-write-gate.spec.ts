import { expect, test, vi } from "vitest";
import type { ProjectRole } from "@/contracts/account/account";
import type { DocumentId } from "@/contracts/shared/ids";
import { MemoryDocumentRepository } from "@/application/modeling/memory-document-repository";
import { MockKernelAdapter } from "@/application/modeling/mock-kernel-adapter";
import { createMemoryOperationHistoryStore } from "@/application/modeling/modeling-history-persistence";
import { createSeedAuthoredModelDocument } from "@/application/modeling/modeling-test-fixtures";
import { createModelingService } from "@/application/modeling/modeling-service";
import { isGeometryAssetDocumentRepository } from "@/core/modeling/document-repository";
import {
  canWriteProjectDocument,
  PROJECT_READ_ONLY_MESSAGE,
  projectAccessAllows,
  ProjectWriteGate,
  type ProjectDocumentKind,
} from "./project-write-gate";
import { createProjectWriteGatedDocumentRepository } from "./project-write-gated-document-repository";

// Logic lane. Seams: the project write gate's rule, the part-document
// repository behind it, and the modeling service's mutation path that every
// workbench edit (variables, context menus, timeline, sketches, features)
// funnels through.

const DOCUMENT_ID = "doc_workspace" as DocumentId;
// Every kind, so a new document kind fails to compile here until it is listed.
const ALL_KINDS = Object.keys({
  manifest: true,
  part: true,
  readme: true,
  discussion: true,
  assembly: true,
} satisfies Record<ProjectDocumentKind, true>) as ProjectDocumentKind[];

/** A synced project's gate with `role` (null: no role known yet). */
function gateFor(role: ProjectRole | null) {
  const gate = new ProjectWriteGate();
  gate.setAccess({ linked: true, role });
  const denials: ProjectDocumentKind[] = [];
  gate.subscribeToDenials((kind) => denials.push(kind));
  return { gate, denials };
}

test("viewers write nothing, commenters only the discussion; editors, admins and local projects write everything; a synced project with no known role writes nothing", () => {
  for (const kind of ALL_KINDS) {
    expect(canWriteProjectDocument("viewer", kind), `viewer ${kind}`).toBe(
      false,
    );
    expect(
      canWriteProjectDocument("commenter", kind),
      `commenter ${kind}`,
    ).toBe(kind === "discussion");
    for (const role of ["editor", "admin"] as const)
      expect(canWriteProjectDocument(role, kind), `${role} ${kind}`).toBe(true);
    expect(projectAccessAllows({ linked: false, role: null }, kind)).toBe(true);
    expect(projectAccessAllows({ linked: true, role: null }, kind)).toBe(false);
  }
});

test("each refused write is announced once; allowed writes and plain checks announce nothing", () => {
  const { gate, denials } = gateFor("commenter");
  expect(gate.authorize("part")).toBe(false);
  expect(gate.authorize("manifest")).toBe(false);
  expect(gate.authorize("discussion")).toBe(true);
  expect(gate.allows("readme")).toBe(false);
  expect(denials).toEqual(["part", "manifest"]);
  gate.setAccess({ linked: true, role: "editor" });
  expect(gate.authorize("part")).toBe(true);
  expect(denials).toHaveLength(2);
});

test.each(["viewer", "commenter"] as const)(
  "for a %s the part repository refuses every write kind without reaching storage",
  async (role) => {
    const seed = await createSeedAuthoredModelDocument();
    const inner = new MemoryDocumentRepository([seed]);
    const writes = [
      vi.spyOn(inner, "initialize"),
      vi.spyOn(inner, "mutate"),
      vi.spyOn(inner, "undoDurableHistory"),
      vi.spyOn(inner, "redoDurableHistory"),
      vi.spyOn(inner, "reset"),
    ];
    const { gate, denials } = gateFor(role);
    const repository = createProjectWriteGatedDocumentRepository(inner, gate);
    const heads = inner.getMetadata(DOCUMENT_ID).heads;
    const results = [
      await repository.initialize({ documentId: DOCUMENT_ID, document: seed }),
      await repository.mutate({
        documentId: DOCUMENT_ID,
        document: { ...seed, name: "Edited" },
        expected: seed,
      }),
      await repository.undoDurableHistory(DOCUMENT_ID),
      await repository.redoDurableHistory(DOCUMENT_ID),
    ];
    for (const result of results)
      expect(result).toMatchObject({
        ok: false,
        status: {
          kind: "failed",
          diagnostic: {
            reasonCode: "project-read-only",
            message: PROJECT_READ_ONLY_MESSAGE,
          },
        },
      });
    // Reset would delete this browser's copy of the synced part.
    expect(await repository.reset(DOCUMENT_ID)).toMatchObject({
      kind: "failed",
      diagnostic: { reasonCode: "project-read-only" },
    });
    for (const write of writes) expect(write).not.toHaveBeenCalled();
    expect(denials).toEqual(["part", "part", "part", "part", "part"]);
    expect(inner.getMetadata(DOCUMENT_ID).heads).toEqual(heads);
    // Reads and the repository's other capabilities pass through.
    expect(isGeometryAssetDocumentRepository(repository)).toBe(true);
    expect(
      await repository.load({ documentId: DOCUMENT_ID, seedDocument: seed }),
    ).toMatchObject({ ok: true, document: { name: seed.name } });
  },
);

test("for an editor the part repository writes through", async () => {
  const seed = await createSeedAuthoredModelDocument();
  const inner = new MemoryDocumentRepository([seed]);
  const { gate, denials } = gateFor("editor");
  const repository = createProjectWriteGatedDocumentRepository(inner, gate);
  const written = await repository.mutate({
    documentId: DOCUMENT_ID,
    document: { ...seed, name: "Edited" },
    expected: seed,
  });
  expect(written).toMatchObject({ ok: true, document: { name: "Edited" } });
  expect(denials).toEqual([]);
});

function createGatedService(
  inner: MemoryDocumentRepository,
  gate: ProjectWriteGate,
  operationHistoryStore = createMemoryOperationHistoryStore(),
) {
  return createModelingService(new MockKernelAdapter(), {
    currentDocumentId: DOCUMENT_ID,
    documentRepository: createProjectWriteGatedDocumentRepository(inner, gate),
    operationHistoryStore,
    documentWriteGate: gate,
  });
}

test("a viewer's edits are refused before the kernel applies them; an editor's are stored", async () => {
  const seed = await createSeedAuthoredModelDocument();
  const inner = new MemoryDocumentRepository([seed]);
  const mutate = vi.spyOn(inner, "mutate");
  const { gate, denials } = gateFor("viewer");
  const service = createGatedService(inner, gate);
  try {
    const before = await service.getCurrentDocumentSnapshot();
    const variable = await service.addDocumentVariable({
      baseRevisionId: before.document.revisionId,
      name: "width",
      valueText: "10",
    });
    const renamed = await service.renameBody({
      baseRevisionId: before.document.revisionId,
      bodyId: "body_part-1",
      bodyLabel: "Viewer label",
    });
    for (const result of [variable, renamed]) {
      expect(result.isErr()).toBe(true);
      if (result.isErr())
        expect(result.error).toMatchObject({
          code: "modeling/diagnostic",
          message: PROJECT_READ_ONLY_MESSAGE,
        });
    }
    expect(denials).toEqual(["part", "part"]);
    const after = await service.getCurrentDocumentSnapshot();
    expect(after.document.revisionId).toBe(before.document.revisionId);
    expect(after.document.variables).toEqual(before.document.variables);
    await service.waitForLocalChanges();
    expect(mutate).not.toHaveBeenCalled();

    gate.setAccess({ linked: true, role: "editor" });
    const allowed = await service.addDocumentVariable({
      baseRevisionId: after.document.revisionId,
      name: "width",
      valueText: "10",
    });
    expect(allowed.isOk()).toBe(true);
    await service.waitForLocalChanges();
    expect(mutate).toHaveBeenCalledTimes(1);
  } finally {
    service.dispose();
  }
});

test("opening a stored part read only changes nothing in its document", async () => {
  const seed = await createSeedAuthoredModelDocument();
  const inner = new MemoryDocumentRepository([seed]);
  const heads = inner.getMetadata(DOCUMENT_ID).heads;
  const { gate, denials } = gateFor("viewer");
  const service = createGatedService(inner, gate);
  try {
    const opened = await service.getCurrentDocumentSnapshot();
    expect(opened.document.name).toBe(seed.name);
    await service.waitForLocalChanges();
    expect(inner.getMetadata(DOCUMENT_ID).heads).toEqual(heads);
    expect(denials).toEqual([]);
  } finally {
    service.dispose();
  }
});

test("an edit queued behind another asks the gate again when its turn comes", async () => {
  const seed = await createSeedAuthoredModelDocument();
  const inner = new MemoryDocumentRepository([seed]);
  const mutate = vi.spyOn(inner, "mutate");
  const { gate, denials } = gateFor("editor");
  const service = createGatedService(inner, gate);
  try {
    const before = await service.getCurrentDocumentSnapshot();
    // Both edits are accepted at the call, then the role drops to viewer
    // before either runs.
    const first = service.renameBody({
      baseRevisionId: before.document.revisionId,
      bodyId: "body_part-1",
      bodyLabel: "Queued one",
    });
    const second = service.addDocumentVariable({
      baseRevisionId: before.document.revisionId,
      name: "width",
      valueText: "10",
    });
    gate.setAccess({ linked: true, role: "viewer" });
    for (const result of [await first, await second])
      expect(result.isErr() && result.error.message).toBe(
        PROJECT_READ_ONLY_MESSAGE,
      );
    expect(denials).toEqual(["part", "part"]);
    const after = await service.getCurrentDocumentSnapshot();
    expect(after.document.revisionId).toBe(before.document.revisionId);
    await service.waitForLocalChanges();
    expect(mutate).not.toHaveBeenCalled();
  } finally {
    service.dispose();
  }
});

test("a write the gate refuses after the kernel applied it leaves storage usable once the role allows writes again", async () => {
  const seed = await createSeedAuthoredModelDocument();
  const inner = new MemoryDocumentRepository([seed]);
  // The role drops between the service's checks and the storage write.
  let refuseStorage = false;
  const gate = new ProjectWriteGate();
  const repository = createProjectWriteGatedDocumentRepository(inner, {
    authorize: (kind) => !refuseStorage && gate.authorize(kind),
  });
  const service = createModelingService(new MockKernelAdapter(), {
    currentDocumentId: DOCUMENT_ID,
    documentRepository: repository,
    documentWriteGate: gate,
  });
  try {
    const before = await service.getCurrentDocumentSnapshot();
    refuseStorage = true;
    const refused = await service.renameBody({
      baseRevisionId: before.document.revisionId,
      bodyId: "body_part-1",
      bodyLabel: "Refused by storage",
    });
    expect(refused.isOk()).toBe(true);
    if (refused.isOk())
      expect(refused.value.diagnostics.map((d) => d.code)).toContain(
        "project-read-only",
      );
    refuseStorage = false;
    const current = await service.getCurrentDocumentSnapshot();
    const stored = await service.addDocumentVariable({
      baseRevisionId: current.document.revisionId,
      name: "width",
      valueText: "10",
    });
    expect(stored.isOk()).toBe(true);
    await service.waitForPersistence();
    const reloaded = await inner.load({
      documentId: DOCUMENT_ID,
      seedDocument: seed,
    });
    expect(
      reloaded.ok && reloaded.document.variables.map((v) => v.name),
    ).toEqual(["width"]);
  } finally {
    service.dispose();
  }
});

test("a read-only role neither replays nor discards this browser's unsaved journal; a later editor stores it", async () => {
  const inner = new MemoryDocumentRepository();
  const history = createMemoryOperationHistoryStore();
  // The repository reports a durable storage key, so the journal binds to
  // its basis like a real Automerge copy.
  const load = inner.load.bind(inner);
  vi.spyOn(inner, "load").mockImplementation(async (input) => {
    const result = await load(input);
    return result.ok
      ? {
          ...result,
          metadata: { ...result.metadata, storageKey: "automerge:current" },
        }
      : result;
  });
  // An editor's edit was accepted, but the tab closed before it was stored.
  const editor = createGatedService(inner, gateFor("editor").gate, history);
  const before = await editor.getCurrentDocumentSnapshot();
  const storedLabel = before.document.bodies.find(
    (body) => body.bodyId === "body_part-1",
  )?.label;
  vi.spyOn(inner, "mutate").mockResolvedValueOnce({
    ok: false,
    status: {
      kind: "failed",
      documentId: DOCUMENT_ID,
      diagnostic: { reasonCode: "write-failed", message: "Interrupted write" },
    },
  });
  const renamed = await editor.renameBody({
    baseRevisionId: before.document.revisionId,
    bodyId: "body_part-1",
    bodyLabel: "Unsaved edit",
  });
  expect(renamed.isOk()).toBe(true);
  await editor.waitForPersistence();
  editor.dispose();
  const heads = inner.getMetadata(DOCUMENT_ID).heads;
  const label = (snapshot: Awaited<typeof before>) =>
    snapshot.document.bodies.find((body) => body.bodyId === "body_part-1")
      ?.label;

  // The role is now viewer: the part opens as stored, not failed.
  const viewer = createGatedService(inner, gateFor("viewer").gate, history);
  try {
    expect(label(await viewer.getCurrentDocumentSnapshot())).toBe(storedLabel);
    expect(await viewer.getHistoryRestoreState()).toMatchObject({
      kind: "restored",
      entriesReplayed: 0,
    });
    await viewer.waitForLocalChanges();
    expect(inner.getMetadata(DOCUMENT_ID).heads).toEqual(heads);
    expect(history.load()).toMatchObject({
      ok: true,
      payload: { entries: [{ kind: "renameBody" }] },
    });
  } finally {
    viewer.dispose();
  }

  // An editor opening it later replays and stores the kept edit.
  const later = createGatedService(inner, gateFor("editor").gate, history);
  try {
    expect(label(await later.getCurrentDocumentSnapshot())).toBe(
      "Unsaved edit",
    );
    await later.waitForLocalChanges();
    const stored = await inner.load({
      documentId: DOCUMENT_ID,
      seedDocument: await createSeedAuthoredModelDocument(),
    });
    expect(
      stored.ok &&
        stored.document.bodyLabels.find(
          (record) => record.bodyId === "body_part-1",
        )?.label,
    ).toBe("Unsaved edit");
  } finally {
    later.dispose();
  }
});
