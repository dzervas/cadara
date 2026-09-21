import { describe, expect, test } from "vitest";
import { AuthoredActionHistory } from "./authored-action-history";
import type {
  AuthoredActionIdentity,
  AuthoredActionResult,
  AuthoredActionState,
} from "@/contracts/modeling/authored-actions";
import { createNewSketchSession } from "@/domain/editor/sketch-session";
import { createAuthoredModelDocumentFromSnapshot } from "@/contracts/modeling/authored-document";
import { MockKernelAdapter } from "@/domain/modeling/mock-kernel-adapter";
import { CONTRACT_VERSION } from "@/contracts/shared/versioning";
import { createStandardPlaneDefinition } from "@/domain/modeling/opencascade-kernel-seed";

const identity: AuthoredActionIdentity = {
  actorId: "actor-a",
  documentId: "doc-a",
  context: { kind: "sketch", sketchId: "sketch-a" },
};
function seed(): AuthoredActionState {
  const plane = createStandardPlaneDefinition("xy");
  const session = createNewSketchSession(plane);
  return {
    documentId: "doc-a",
    context: { kind: "sketch", sketchId: "sketch-a" },
    data: {
      sketchId: "sketch-a",
      label: "Sketch",
      plane,
      definition: session.definition,
    },
  };
}
function changed(
  state: AuthoredActionState,
  edit: (
    data: NonNullable<
      Extract<AuthoredActionState, { context: { kind: "sketch" } }>["data"]
    >,
  ) => void,
): AuthoredActionState {
  const next = structuredClone(state);
  if (next.context.kind !== "sketch" || !next.data)
    throw new Error("Expected sketch");
  if (!("sketchId" in next.data)) throw new Error("Expected sketch record");
  edit(next.data);
  return next;
}
function applied(result: AuthoredActionResult): AuthoredActionState {
  expect(result.status).toBe("applied");
  if (result.status !== "applied") throw new Error(JSON.stringify(result));
  return result.state;
}
function point(state: AuthoredActionState, id = "p") {
  return changed(state, (data) => {
    data.definition.pointIds.push(id);
    data.definition.points.push({
      pointId: id,
      label: id,
      target: { kind: "sketchPoint", sketchId: "sketch-a", pointId: id },
      position: { x: 1, y: 2 },
      isConstruction: false,
    });
  });
}

describe("authored action boundary", () => {
  test("constraint identity is its collection key, not the entity it references", () => {
    const history = new AuthoredActionHistory();
    const before = changed(point(point(seed(), "p"), "q"), (data) => {
      data.definition.entityIds = ["L"];
      data.definition.entities = [
        {
          kind: "lineSegment",
          entityId: "L",
          label: "Line",
          target: { kind: "sketchEntity", sketchId: "sketch-a", entityId: "L" },
          isConstruction: false,
          startPointId: "p",
          endPointId: "q",
        },
      ];
    });
    const candidate = changed(before, (data) => {
      data.definition.constraintIds.push("c");
      data.definition.constraints.push({
        kind: "horizontal",
        constraintId: "c",
        entityId: "L",
        label: "Local",
      });
    });
    const committed = applied(
      history.commit(identity, before, candidate, "Horizontal", before),
    );
    expect(
      history.entries(identity).undo[0].dependencies.map((item) => item.id),
    ).toEqual(["c"]);
    const peer = changed(committed, (data) => {
      data.definition.constraintIds.push("peer-c");
      data.definition.constraints.push({
        kind: "vertical",
        constraintId: "peer-c",
        entityId: "L",
        label: "Peer",
      });
    });
    const undone = applied(history.undo(identity, peer));
    expect(undone.data).toMatchObject({
      definition: { constraintIds: ["peer-c"], entityIds: ["L"] },
    });
    expect(applied(history.redo(identity, undone)).data).toMatchObject({
      definition: { constraintIds: expect.arrayContaining(["c", "peer-c"]) },
    });
  });
  test("explicit older selection preserves a blocked newest action and coherent default Undo/Redo", () => {
    const history = new AuthoredActionHistory(),
      before = point(seed());
    const moved = changed(before, (data) => {
      data.definition.points[0].position.x = 4;
    });
    const afterA = applied(
      history.commit(identity, before, moved, "A drag", before),
    );
    const renamed = changed(afterA, (data) => {
      data.label = "B";
    });
    const afterB = applied(
      history.commit(identity, afterA, renamed, "B rename", afterA),
    );
    const [a, b] = history.entries(identity).undo;
    const peer = changed(afterB, (data) => {
      data.label = "Peer";
    });
    expect(history.undo(identity, peer)).toMatchObject({
      status: "blocked",
      reason: "expected-state-changed",
    });
    const undone = applied(history.undo(identity, peer, a.sequence));
    expect(undone.data).toMatchObject({
      label: "Peer",
      definition: { points: [{ position: { x: 1, y: 2 } }] },
    });
    expect(
      history.entries(identity).undo.map((entry) => entry.sequence),
    ).toEqual([b.sequence]);
    expect(
      history.entries(identity).redo.map((entry) => entry.sequence),
    ).toEqual([a.sequence]);
    expect(history.undo(identity, undone)).toMatchObject({ status: "blocked" });
    const conflicting = changed(undone, (data) => {
      data.definition.points[0].position.x = 10;
    });
    expect(history.redo(identity, conflicting, a.sequence)).toMatchObject({
      status: "blocked",
      reason: "expected-state-changed",
    });
    const restored = applied(history.redo(identity, undone, a.sequence));
    expect(restored.data).toMatchObject({
      label: "Peer",
      definition: { points: [{ position: { x: 4, y: 2 } }] },
    });
    expect(
      history.entries(identity).undo.map((entry) => entry.sequence),
    ).toEqual([a.sequence, b.sequence]);
    expect(history.undo(identity, restored)).toMatchObject({
      status: "blocked",
    });
    expect(history.undo(identity, restored, 9999)).toMatchObject({
      status: "blocked",
      reason: "action-not-found",
    });
  });
  test("selected older actions cannot overwrite later overlapping work even after ABA values", () => {
    const history = new AuthoredActionHistory();
    let state = point(seed());
    for (const x of [2, 3, 2]) {
      const next = changed(state, (data) => {
        data.definition.points[0].position.x = x;
      });
      state = applied(history.commit(identity, state, next, "Drag", state));
    }
    const [a] = history.entries(identity).undo;
    expect(history.undo(identity, state, a.sequence)).toMatchObject({
      status: "blocked",
      reason: "later-action-overlap",
    });
    expect(history.entries(identity).undo).toHaveLength(3);
    state = applied(history.undo(identity, state));
    state = applied(history.undo(identity, state));
    state = applied(history.undo(identity, state, a.sequence));
    expect(state.data).toMatchObject({
      definition: { points: [{ position: { x: 1, y: 2 } }] },
    });
    state = applied(history.redo(identity, state));
    state = applied(history.redo(identity, state));
    state = applied(history.redo(identity, state));
    expect(state.data).toMatchObject({
      definition: { points: [{ position: { x: 2, y: 2 } }] },
    });
  });
  test("selected older record creation cannot strand a newer dependent record", () => {
    const history = new AuthoredActionHistory(),
      before = seed();
    const created = applied(
      history.commit(identity, before, point(before), "Point", before),
    );
    const a = history.entries(identity).undo[0];
    const constrained = changed(created, (data) => {
      data.definition.constraintIds.push("fix");
      data.definition.constraints.push({
        kind: "fixPoint",
        constraintId: "fix",
        pointId: "p",
        position: { x: 1, y: 2 },
        label: "Fix",
      });
    });
    const state = applied(
      history.commit(identity, created, constrained, "Fix", created),
    );
    expect(history.undo(identity, state, a.sequence)).toMatchObject({
      status: "blocked",
      reason: "dependent-record-changed",
    });
    expect(history.entries(identity).undo).toHaveLength(2);
    expect(history.entries(identity).redo).toHaveLength(0);
  });
  test("failed repository transactions can discard staged ledger changes", () => {
    const history = new AuthoredActionHistory(),
      before = seed();
    const staged = history.fork();
    applied(staged.commit(identity, before, point(before), "Point", before));
    expect(history.entries(identity).undo).toHaveLength(0);
    expect(staged.entries(identity).undo).toHaveLength(1);
    const exposed = staged.entries(identity);
    (exposed.undo[0].writes[0].address as string[]).push("corrupt");
    expect(staged.entries(identity).undo[0].writes[0].address).not.toContain(
      "corrupt",
    );
  });
  test("automatic stable fields preserve unrelated peer edits and compensate both directions", () => {
    const history = new AuthoredActionHistory();
    const before = point(seed());
    const candidate = changed(before, (data) => {
      data.definition.points[0].position.x = 3;
    });
    const committed = applied(
      history.commit(identity, before, candidate, "Drag", before),
    );
    const peer = changed(committed, (data) => {
      data.definition.points[0].position.y = 9;
      data.label = "Peer";
    });
    const undone = applied(history.undo(identity, peer));
    expect(undone.data).toMatchObject({
      label: "Peer",
      definition: { points: [{ position: { x: 1, y: 9 } }] },
    });
    expect(applied(history.redo(identity, undone)).data).toMatchObject({
      definition: { points: [{ position: { x: 3, y: 9 } }] },
    });
    expect(
      history.entries(identity).undo[0].writes.map((w) => w.address),
    ).toEqual([["definition", "points", "p", "position", "x"]]);
  });
  test("same-field conflicts block all writes and keep history; Redo also checks", () => {
    const history = new AuthoredActionHistory(),
      before = point(seed());
    const candidate = changed(before, (data) => {
      data.label = "Local";
      data.definition.points[0].position.x = 4;
    });
    const committed = applied(
      history.commit(identity, before, candidate, "Edit", before),
    );
    const peer = changed(committed, (data) => {
      data.definition.points[0].position.x = 8;
    });
    expect(history.undo(identity, peer)).toMatchObject({
      status: "blocked",
      reason: "expected-state-changed",
    });
    expect(peer.data?.label).toBe("Local");
    expect(history.entries(identity).undo).toHaveLength(1);
    const undone = applied(history.undo(identity, committed));
    expect(
      history.redo(
        identity,
        changed(undone, (data) => {
          data.label = "Peer";
        }),
      ),
    ).toMatchObject({ status: "blocked" });
  });
  test("insert/delete preserve peer records, and new dependent records block deletion", () => {
    const history = new AuthoredActionHistory(),
      before = seed();
    const committed = applied(
      history.commit(identity, before, point(before), "Point", before),
    );
    const peer = point(committed, "peer");
    const undone = applied(history.undo(identity, peer));
    expect(undone.data).toMatchObject({ definition: { pointIds: ["peer"] } });
    const restored = applied(history.redo(identity, undone));
    const dependent = changed(restored, (data) => {
      data.definition.constraintIds.push("c");
      data.definition.constraints.push({
        constraintId: "c",
        kind: "fixPoint",
        label: "Peer constraint",
        pointId: "p",
        position: { x: 1, y: 2 },
      });
    });
    expect(history.undo(identity, dependent)).toMatchObject({
      status: "blocked",
      reason: "dependent-record-changed",
    });
    const removal = changed(restored, (data) => {
      data.definition.points = data.definition.points.filter(
        (p) => p.pointId !== "p",
      );
      data.definition.pointIds = ["peer"];
    });
    applied(history.commit(identity, restored, removal, "Delete", restored));
    expect(applied(history.undo(identity, removal)).data).toMatchObject({
      definition: { pointIds: expect.arrayContaining(["p", "peer"]) },
    });
  });
  test("meaningful fit-point sequences are ordered atomic fields", () => {
    const history = new AuthoredActionHistory();
    const before = changed(point(point(seed(), "p"), "q"), (data) => {
      data.definition.entityIds = ["spline"];
      data.definition.entities = [
        {
          entityId: "spline",
          kind: "spline",
          label: "Spline",
          target: {
            kind: "sketchEntity",
            sketchId: "sketch-a",
            entityId: "spline",
          },
          isConstruction: false,
          degree: 3,
          fitPointIds: ["p", "q"],
        },
      ];
    });
    const candidate = changed(before, (data) => {
      const entity = data.definition.entities[0];
      if (entity.kind === "spline") entity.fitPointIds = ["q", "p"];
    });
    applied(history.commit(identity, before, candidate, "Reverse", before));
    expect(applied(history.undo(identity, candidate)).data).toMatchObject({
      definition: { entities: [{ fitPointIds: ["p", "q"] }] },
    });
  });
  test("250 compact entries, no-op retains Redo, real new action clears it", () => {
    const history = new AuthoredActionHistory();
    let state = seed();
    for (let i = 0; i < 251; i++)
      state = applied(
        history.commit(
          identity,
          state,
          changed(state, (data) => {
            data.label = String(i);
          }),
          "Rename",
          state,
        ),
      );
    expect(history.entries(identity).undo).toHaveLength(250);
    expect(history.entries(identity).undo[0].sequence).toBe(2);
    state = applied(history.undo(identity, state));
    expect(history.commit(identity, state, state, "No motion", state)).toEqual({
      status: "unchanged",
    });
    expect(history.entries(identity).redo).toHaveLength(1);
    applied(
      history.commit(
        identity,
        state,
        changed(state, (data) => {
          data.label = "New";
        }),
        "Rename",
        state,
      ),
    );
    expect(history.entries(identity).redo).toHaveLength(0);
  });
  test("stale completed intents check their base atomically and preserve disjoint current fields", () => {
    const history = new AuthoredActionHistory(),
      before = point(seed());
    const candidate = changed(before, (data) => {
      data.definition.points[0].position.x = 4;
    });
    const peer = changed(before, (data) => {
      data.label = "Peer";
    });
    expect(
      applied(history.commit(identity, peer, candidate, "Drag", before)).data
        ?.label,
    ).toBe("Peer");
    const conflicting = changed(before, (data) => {
      data.definition.points[0].position.x = 9;
    });
    expect(
      history.commit(identity, conflicting, candidate, "Stale", before),
    ).toMatchObject({ status: "blocked", reason: "expected-state-changed" });
    expect(history.entries(identity).undo).toHaveLength(1);
  });
  test("document actions preserve feature sequence semantics and isolate their ledger", async () => {
    const adapter = new MockKernelAdapter();
    const document = createAuthoredModelDocumentFromSnapshot(
      (
        await adapter.getDocumentSnapshot({
          contractVersion: CONTRACT_VERSION,
          documentId: "doc_workspace",
        })
      ).snapshot,
    );
    const documentIdentity: AuthoredActionIdentity = {
      ...identity,
      documentId: document.documentId,
      context: { kind: "document" },
    };
    const before: AuthoredActionState = {
      documentId: document.documentId,
      context: { kind: "document" },
      data: document,
    };
    const candidate = structuredClone(before);
    candidate.data.name = "Renamed";
    candidate.data.featureOrder = ["f2", "f1"];
    const history = new AuthoredActionHistory();
    const result = history.commit(
      documentIdentity,
      before,
      candidate,
      "Order",
      before,
    );
    const committed = applied(result);
    expect(result).toMatchObject({
      writes: expect.arrayContaining([
        expect.objectContaining({ address: ["featureOrder"] }),
      ]),
    });
    const undone = applied(history.undo(documentIdentity, committed));
    expect(undone.data).toMatchObject({
      name: document.name,
      featureOrder: document.featureOrder,
    });
    expect(undone.data).not.toHaveProperty("revisionId");
    expect(history.undo(identity, seed())).toEqual({ status: "unchanged" });
  });
  test("record recreation, record modification, missing parents and optional-field presence are checked", () => {
    const history = new AuthoredActionHistory(),
      before = point(seed());
    const candidate = changed(before, (data) => {
      data.definition.points[0].style = { strokeColor: "red" };
    });
    const committed = applied(
      history.commit(identity, before, candidate, "Style", before),
    );
    const absent = changed(committed, (data) => {
      data.definition.points = [];
      data.definition.pointIds = [];
    });
    expect(history.undo(identity, absent)).toMatchObject({ status: "blocked" });
    const undone = applied(history.undo(identity, committed));
    const deleted = changed(undone, (data) => {
      data.definition.points = [];
      data.definition.pointIds = [];
    });
    expect(history.redo(identity, deleted)).toMatchObject({
      status: "blocked",
    });
    expect(
      history.redo(
        identity,
        changed(undone, (data) => {
          data.definition.points[0].style = { strokeColor: "blue" };
        }),
      ),
    ).toMatchObject({ status: "blocked" });
    const removal = new AuthoredActionHistory();
    applied(removal.commit(identity, before, deleted, "Delete", before));
    expect(removal.undo(identity, before)).toMatchObject({ status: "blocked" });
  });
  test("publication remaps draft context and semantic target identities without changing authored UUIDs", () => {
    const history = new AuthoredActionHistory();
    const before = seed();
    const candidate = changed(before, (data) => {
      data.definition.pointIds = ["point-retained"];
      data.definition.points = [
        {
          pointId: "point-retained",
          label: "Point",
          target: {
            kind: "sketchPoint",
            sketchId: "sketch_draft",
            pointId: "point-retained",
          },
          position: { x: 1, y: 2 },
          isConstruction: false,
        },
      ];
    });
    applied(
      history.commit(identity, before, candidate, "Create Point", before),
    );
    const publishedIdentity = history.remapSketchContext(
      identity,
      "sketch-published",
      ["sketch_draft"],
    );
    const entry = history.entries(publishedIdentity).undo[0]!;
    expect(entry.identity.context).toEqual({
      kind: "sketch",
      sketchId: "sketch-published",
    });
    expect(JSON.stringify(entry.writes)).toContain("sketch-published");
    expect(JSON.stringify(entry.writes)).not.toContain("sketch_draft");
    expect(JSON.stringify(entry.writes)).toContain("point-retained");

    const sameIdentityHistory = new AuthoredActionHistory();
    applied(
      sameIdentityHistory.commit(
        identity,
        before,
        candidate,
        "Create Point",
        before,
      ),
    );
    sameIdentityHistory.remapSketchContext(identity, "sketch-a", [
      "sketch_draft",
    ]);
    expect(
      JSON.stringify(sameIdentityHistory.entries(identity).undo[0]!.writes),
    ).not.toContain("sketch_draft");
  });

  test("publication preserves arbitrary strings and keys that equal draft aliases", () => {
    const history = new AuthoredActionHistory();
    const before = changed(seed(), (data) => {
      data.label = "sketch_draft";
    });
    const renamed = changed(before, (data) => {
      data.label = "Renamed";
    });
    applied(history.commit(identity, before, renamed, "Rename", before));
    const publishedIdentity = history.remapSketchContext(
      identity,
      "sketch-published",
      ["sketch_draft"],
    );
    const published = changed(renamed, (data) => {
      data.sketchId = "sketch-published";
    });
    published.context = publishedIdentity.context;
    const undone = applied(history.undo(publishedIdentity, published));
    expect(undone.data).toMatchObject({ label: "sketch_draft" });

    const keyedHistory = new AuthoredActionHistory();
    const keyedCandidate = changed(seed(), (data) => {
      (data as unknown as Record<string, unknown>).sketch_draft = "user value";
    });
    applied(
      keyedHistory.commit(
        identity,
        seed(),
        keyedCandidate,
        "Set user key",
        seed(),
      ),
    );
    keyedHistory.remapSketchContext(identity, "sketch-published", [
      "sketch_draft",
    ]);
    expect(
      keyedHistory.entries({
        ...identity,
        context: { kind: "sketch", sketchId: "sketch-published" },
      }).undo[0]?.writes[0]?.address,
    ).toEqual(["sketch_draft"]);
  });

  test("a fresh UUID context remains independent from a deleted sketch ledger and its Redo", () => {
    const history = new AuthoredActionHistory();
    const originalIdentity = {
      ...identity,
      context: { kind: "sketch" as const, sketchId: "sketch_primary" },
    };
    const originalBefore = changed(seed(), (data) => {
      data.sketchId = "sketch_primary";
    });
    originalBefore.context = originalIdentity.context;
    const originalAfter = changed(originalBefore, (data) => {
      data.label = "Original renamed";
    });
    const committedOriginal = applied(
      history.commit(
        originalIdentity,
        originalBefore,
        originalAfter,
        "Rename original",
        originalBefore,
      ),
    );
    const deletedOriginal = applied(
      history.undo(originalIdentity, committedOriginal),
    );

    const freshIdentity = {
      ...identity,
      context: { kind: "sketch" as const, sketchId: "sketch_private_new" },
    };
    const freshBefore = changed(seed(), (data) => {
      data.sketchId = "sketch_private_new";
    });
    freshBefore.context = freshIdentity.context;
    const freshAfter = changed(freshBefore, (data) => {
      data.label = "Fresh renamed";
    });
    applied(
      history.commit(
        freshIdentity,
        freshBefore,
        freshAfter,
        "Rename fresh",
        freshBefore,
      ),
    );
    const publishedFresh = history.remapSketchContext(
      freshIdentity,
      "sketch_12345678-1234-4234-8234-123456789abc",
      ["sketch_draft"],
    );
    expect(history.entries(publishedFresh).undo).toHaveLength(1);
    expect(history.entries(originalIdentity).redo).toHaveLength(1);
    expect(
      applied(history.redo(originalIdentity, deletedOriginal)).data,
    ).toMatchObject({ label: "Original renamed", sketchId: "sketch_primary" });
  });

  test("actor/document/context isolation and deleted contexts", () => {
    const history = new AuthoredActionHistory(),
      before = seed();
    const state = applied(
      history.commit(identity, before, point(before), "Point", before),
    );
    expect(history.undo({ ...identity, actorId: "peer" }, state)).toEqual({
      status: "unchanged",
    });
    expect(
      history.undo({ ...identity, documentId: "other" }, state),
    ).toMatchObject({ status: "blocked", reason: "identity-mismatch" });
    expect(
      history.undo({ ...identity, context: { kind: "document" } }, state),
    ).toMatchObject({ status: "blocked", reason: "identity-mismatch" });
    expect(
      history.undo(identity, { ...state, data: null } as AuthoredActionState),
    ).toMatchObject({ status: "blocked", reason: "context-missing" });
  });
});
