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
  ProjectWriteGate,
  type ProjectDocumentKind,
} from "./project-write-gate";
import { createProjectWriteGatedDocumentRepository } from "./project-write-gated-document-repository";

// Logic lane. Seams: the project write gate's rule, the part-document
// repository behind it, and the modeling service's mutation path that every
// workbench edit (variables, context menus, timeline, sketches, features)
// funnels through.

const DOCUMENT_ID = "doc_workspace" as DocumentId;
const ALL_KINDS: ProjectDocumentKind[] = [
  "manifest",
  "part",
  "readme",
  "discussion",
  "assembly",
];

function gateFor(role: ProjectRole | null) {
  const gate = new ProjectWriteGate();
  gate.setRole(role);
  const denials: ProjectDocumentKind[] = [];
  gate.subscribeToDenials((kind) => denials.push(kind));
  return { gate, denials };
}

test("viewers write nothing, commenters only the discussion; editors, admins and unsynced projects write everything", () => {
  for (const kind of ALL_KINDS) {
    expect(canWriteProjectDocument("viewer", kind), `viewer ${kind}`).toBe(
      false,
    );
    expect(
      canWriteProjectDocument("commenter", kind),
      `commenter ${kind}`,
    ).toBe(kind === "discussion");
    for (const role of ["editor", "admin", null] as const)
      expect(canWriteProjectDocument(role, kind), `${role} ${kind}`).toBe(true);
  }
});

test("each refused write is announced once; allowed writes and plain checks announce nothing", () => {
  const { gate, denials } = gateFor("commenter");
  expect(gate.authorize("part")).toBe(false);
  expect(gate.authorize("manifest")).toBe(false);
  expect(gate.authorize("discussion")).toBe(true);
  expect(gate.allows("readme")).toBe(false);
  expect(denials).toEqual(["part", "manifest"]);
  gate.setRole("editor");
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
    for (const write of writes) expect(write).not.toHaveBeenCalled();
    expect(denials).toEqual(["part", "part", "part", "part"]);
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
    projectWriteGate: gate,
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

    gate.setRole("editor");
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

test("an unsaved local journal is not replayed into the document for a read-only role; it is kept for a later editor", async () => {
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

  // The role is now viewer: opening the part must not store that edit.
  const viewer = createGatedService(inner, gateFor("viewer").gate, history);
  try {
    await viewer.getCurrentDocumentSnapshot();
    await viewer.waitForLocalChanges();
    expect(inner.getMetadata(DOCUMENT_ID).heads).toEqual(heads);
    expect(history.load()).toMatchObject({
      ok: true,
      payload: { entries: [{ kind: "renameBody" }] },
    });
  } finally {
    viewer.dispose();
  }
});
