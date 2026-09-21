import { test, expect } from "vitest";
import * as Automerge from "@automerge/automerge";
import { createSeedAuthoredModelDocument } from "./modeling-test-fixtures";
import { AuthoredActionHistory } from "./authored-action-history";
import {
  createCollaborativeDocument,
  materializeCollaborativeDocument,
  applyCollaborativeWrites,
  updateDocumentProvenance,
  documentActionState,
  type CollaborativeDocument,
} from "./collaborative-document";
import type { AuthoredModelDocument } from "@/contracts/modeling/authored-document";
import { createNewSketchSession } from "@/domain/editor/sketch-session";
import { createStandardPlaneDefinition } from "./opencascade-kernel-seed";

async function fixture() {
  const seed = await createSeedAuthoredModelDocument();
  const plane = createStandardPlaneDefinition("xy");
  const definition = createNewSketchSession(plane).definition;
  definition.points = ["p", "q"].map((pointId) => ({
    pointId,
    label: pointId,
    target: { kind: "sketchPoint" as const, sketchId: "sketch_merge", pointId },
    position: { x: 1, y: 2 },
    isConstruction: false,
  }));
  definition.pointIds = ["p", "q"];
  seed.sketches = [
    { sketchId: "sketch_merge", label: "Merge", plane, definition },
  ];
  seed.features = [];
  seed.featureOrder = [];
  seed.historyOrder = [{ kind: "sketch", sketchId: "sketch_merge" }];
  seed.cursor = { kind: "sketch", sketchId: "sketch_merge" };
  seed.bodyLabels = [];
  return seed;
}
function change(
  base: Automerge.Doc<CollaborativeDocument>,
  expected: AuthoredModelDocument,
  edit: (document: AuthoredModelDocument) => void,
) {
  const candidate = structuredClone(expected);
  edit(candidate);
  return Automerge.change(base, (storage) => {
    const current = materializeCollaborativeDocument(storage);
    const result = new AuthoredActionHistory().commit(
      {
        actorId: Automerge.getActorId(base),
        documentId: current.documentId,
        context: { kind: "document" },
      },
      documentActionState(current),
      documentActionState(candidate),
      "Test edit",
      documentActionState(expected),
    );
    expect(result.status).toBe("applied");
    if (result.status === "applied")
      applyCollaborativeWrites(storage, result.writes);
  });
}
test("separated list deletions retain interior CRDT identities across a peer deletion", async () => {
  const seed = await fixture();
  const feature = (await createSeedAuthoredModelDocument()).features[0]!;
  seed.features = ["a", "b", "c", "d", "e"].map((id) => ({
    ...structuredClone(feature),
    featureId: `feature_${id}` as const,
  }));
  seed.featureOrder = seed.features.map((f) => f.featureId);
  seed.historyOrder = seed.features.map((f) => ({
    kind: "feature",
    featureId: f.featureId,
  }));
  seed.cursor = { kind: "empty" };
  const base = Automerge.from(createCollaborativeDocument(seed));
  const remove = (document: AuthoredModelDocument, ids: string[]) => {
    document.features = document.features.filter(
      (f) => !ids.includes(f.featureId),
    );
    document.featureOrder = document.featureOrder.filter(
      (id) => !ids.includes(id),
    );
    document.historyOrder = document.historyOrder.filter(
      (item) => item.kind !== "feature" || !ids.includes(item.featureId),
    );
  };
  const a = change(Automerge.clone(base), seed, (d) =>
    remove(d, ["feature_a", "feature_e"]),
  );
  const b = change(Automerge.clone(base), seed, (d) =>
    remove(d, ["feature_c"]),
  );
  const merged = materializeCollaborativeDocument(Automerge.merge(a, b));
  expect(merged.featureOrder).toEqual(["feature_b", "feature_d"]);
  expect(merged.features.map((f) => f.featureId).sort()).toEqual([
    "feature_b",
    "feature_d",
  ]);
  expect(merged.historyOrder).toEqual([
    { kind: "feature", featureId: "feature_b" },
    { kind: "feature", featureId: "feature_d" },
  ]);
});

test("stale-base provenance writes preserve peer lineage records and untouched sketch fields", async () => {
  const seed = await fixture();
  seed.sketches[0]!.regionSlots = [];
  seed.sketches[0]!.definition.svgRenderingEnabled = false;
  const base = Automerge.from(createCollaborativeDocument(seed));
  const peer = structuredClone(seed);
  peer.topologyLineage = [{ featureId: "feature_peer", outputs: [] }];
  peer.sketches[0]!.definition.svgRenderingEnabled = true;
  const authoredPeer = change(Automerge.clone(base), seed, (d) => {
    d.sketches[0]!.definition.svgRenderingEnabled = true;
  });
  const current = Automerge.change(authoredPeer, (storage) =>
    updateDocumentProvenance(storage, peer, seed),
  );
  const local = structuredClone(seed);
  local.topologyLineage = [{ featureId: "feature_local", outputs: [] }];
  local.sketches[0]!.regionSlots = [
    { regionId: "region_local", boundaryWitnesses: ["local-witness"] },
  ];
  const after = Automerge.change(current, (storage) =>
    updateDocumentProvenance(storage, local, seed),
  );
  const materialized = materializeCollaborativeDocument(after);
  expect(
    materialized.topologyLineage?.map((record) => record.featureId).sort(),
  ).toEqual(["feature_local", "feature_peer"]);
  expect(materialized.sketches[0]!.definition.svgRenderingEnabled).toEqual(
    peer.sketches[0]!.definition.svgRenderingEnabled,
  );
  expect(materialized.sketches[0]!.regionSlots).toEqual(
    local.sketches[0]!.regionSlots,
  );
  // The same disjoint metadata also survives genuine concurrent branch merging.
  const branch = Automerge.change(Automerge.clone(base), (storage) =>
    updateDocumentProvenance(storage, local, seed),
  );
  const merged = materializeCollaborativeDocument(
    Automerge.merge(branch, after),
  );
  expect(
    merged.topologyLineage?.map((record) => record.featureId).sort(),
  ).toEqual(["feature_local", "feature_peer"]);
});

test("conflicting provenance requires recomputation and aborts all authored and metadata writes", async () => {
  const seed = await fixture();
  seed.sketches[0]!.regionSlots = [
    { regionId: "region_shared", boundaryWitnesses: ["original"] },
  ];
  const base = Automerge.from(createCollaborativeDocument(seed));
  const peer = structuredClone(seed);
  peer.sketches[0]!.regionSlots![0]!.boundaryWitnesses = ["peer"];
  const current = Automerge.change(base, (storage) =>
    updateDocumentProvenance(storage, peer, seed),
  );
  const local = structuredClone(seed);
  local.sketches[0]!.regionSlots![0]!.boundaryWitnesses = ["local"];
  local.topologyLineage = [{ featureId: "feature_not_written", outputs: [] }];
  expect(() =>
    Automerge.change(current, (storage) => {
      storage.authored.name = "Must not persist";
      updateDocumentProvenance(storage, local, seed);
    }),
  ).toThrow(/recompute against the current document/);
  const after = materializeCollaborativeDocument(current);
  expect(after.name).toBe(seed.name);
  expect(after.topologyLineage).toEqual([]);
  expect(after.sketches[0]!.regionSlots).toEqual(peer.sketches[0]!.regionSlots);
});

test("real Automerge merges disjoint fields on the same point and independent records", async () => {
  const seed = await fixture(),
    base = Automerge.from(createCollaborativeDocument(seed));
  const a = change(Automerge.clone(base), seed, (d) => {
    d.sketches[0]!.definition.points[0]!.position.x = 10;
  });
  const b = change(Automerge.clone(base), seed, (d) => {
    d.sketches[0]!.definition.points[0]!.position.y = 20;
    d.sketches[0]!.definition.points[1]!.label = "Peer q";
  });
  const merged = materializeCollaborativeDocument(Automerge.merge(a, b));
  const points = merged.sketches[0]!.definition.points;
  expect(points.find((p) => p.pointId === "p")!.position).toEqual({
    x: 10,
    y: 20,
  });
  expect(points.find((p) => p.pointId === "q")!.label).toBe("Peer q");
  expect(merged.sketches[0]!.definition.pointIds.sort()).toEqual(["p", "q"]);
});
test("real Automerge delete/edit does not resurrect the deleted record or lose unrelated edits", async () => {
  const seed = await fixture(),
    base = Automerge.from(createCollaborativeDocument(seed));
  const a = change(Automerge.clone(base), seed, (d) => {
    d.sketches[0]!.definition.points.shift();
    d.sketches[0]!.definition.pointIds.shift();
  });
  const b = change(Automerge.clone(base), seed, (d) => {
    d.sketches[0]!.definition.points[0]!.position.x = 99;
    d.sketches[0]!.definition.points[1]!.position.y = 42;
  });
  const merged = materializeCollaborativeDocument(Automerge.merge(a, b));
  expect(merged.sketches[0]!.definition.points.map((p) => p.pointId)).toEqual([
    "q",
  ]);
  expect(merged.sketches[0]!.definition.points[0]!.position.y).toBe(42);
});
test("real Automerge concurrent meaningful sequence insertions retain both insertions", async () => {
  const seed = await fixture(),
    base = Automerge.from(createCollaborativeDocument(seed));
  const a = change(Automerge.clone(base), seed, (d) => {
    d.featureOrder.push("feature_a");
  });
  const b = change(Automerge.clone(base), seed, (d) => {
    d.featureOrder.push("feature_b");
  });
  const merged = materializeCollaborativeDocument(Automerge.merge(a, b));
  expect(merged.featureOrder.toSorted()).toEqual(["feature_a", "feature_b"]);
  expect(
    Automerge.getConflicts(
      Automerge.merge(Automerge.clone(a), b).authored,
      "featureOrder",
    ),
  ).toBeUndefined();
});
test("stale candidate field conflict applies none of its writes inside an Automerge transaction", async () => {
  const seed = await fixture(),
    base = Automerge.from(createCollaborativeDocument(seed));
  const peer = change(Automerge.clone(base), seed, (d) => {
    d.sketches[0]!.definition.points[0]!.position.x = 50;
  });
  const candidate = structuredClone(seed);
  candidate.sketches[0]!.definition.points[0]!.position = { x: 9, y: 9 };
  const after = Automerge.change(peer, (storage) => {
    const result = new AuthoredActionHistory().commit(
      {
        actorId: Automerge.getActorId(peer),
        documentId: seed.documentId,
        context: { kind: "document" },
      },
      documentActionState(materializeCollaborativeDocument(storage)),
      documentActionState(candidate),
      "Stale",
      documentActionState(seed),
    );
    expect(result.status).toBe("blocked");
    if (result.status === "applied")
      applyCollaborativeWrites(storage, result.writes);
  });
  expect(Automerge.getHeads(after)).toEqual(Automerge.getHeads(peer));
  expect(
    materializeCollaborativeDocument(after).sketches[0]!.definition.points[0]!
      .position,
  ).toEqual({ x: 50, y: 2 });
});
