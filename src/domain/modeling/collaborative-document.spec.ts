import { test, expect } from "vitest";
import { literalResolvedDefinition } from "@/contracts/sketch/region-extraction.fixtures";
import { expectNoInternalIds } from "@/contracts/sketch/user-text.fixtures";
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
import { OCC_KERNEL_SETTINGS } from "@/domain/modeling/opencascade-kernel-seed";
import { createLiteralAuthoredValue } from "@/contracts/modeling/authored-values";
import { parseAuthoredModelDocument } from "@/contracts/modeling/authored-document.runtime-schema";
import {
  isReferenceDimension,
  type SketchDefinition,
} from "@/contracts/sketch/schema";
import { validateSketchDefinitionCore } from "@/core/sketch-solver";
import { createDocumentSolverTolerances } from "@/contracts/solver/schema";
import { mirroredSession } from "@/domain/editor/sketch-mirror.fixtures";
import { rebuildSessionForDefinition } from "@/domain/editor/sketch-session/internals";
import { removeMirrorRelationship } from "@/domain/sketch-editing/mirror-repair";
import {
  makeReferenceDimensionCases,
  makeReferenceDimensionSketch,
  withDimensions,
} from "@/contracts/sketch/reference-dimension.fixtures";
import {
  makeReferenceDimensionInDefinition,
  updateAnnotationValueInDefinition,
} from "@/domain/editor/sketch-session/annotations";

async function fixture() {
  const seed = await createSeedAuthoredModelDocument();
  const plane = createStandardPlaneDefinition("xy");
  const definition = createNewSketchSession(
    plane,
    OCC_KERNEL_SETTINGS,
  ).definition;
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
  const lineage = (topologyToken: string) => [
    {
      featureId: "feature_shared" as const,
      outputs: [
        {
          outputSlot: "body_shared" as const,
          topologyToken,
          topology: { faceIds: [], edgeIds: [], vertexIds: [] },
          sourceTargets: [],
          unsupportedSourceKeys: [],
        },
      ],
    },
  ];
  seed.topologyLineage = lineage("original");
  const base = Automerge.from(createCollaborativeDocument(seed));
  const peer = structuredClone(seed);
  peer.topologyLineage = lineage("peer");
  const current = Automerge.change(base, (storage) =>
    updateDocumentProvenance(storage, peer, seed),
  );
  const local = structuredClone(seed);
  local.topologyLineage = [
    ...lineage("local"),
    { featureId: "feature_not_written", outputs: [] },
  ];
  expect(() =>
    Automerge.change(current, (storage) => {
      storage.authored.name = "Must not persist";
      updateDocumentProvenance(storage, local, seed);
    }),
  ).toThrow(/recompute against the current document/);
  const after = materializeCollaborativeDocument(current);
  expect(after.name).toBe(seed.name);
  expect(after.topologyLineage).toEqual(peer.topologyLineage);
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

// T13d review A-2 (D9′), collaborative seam: one peer's Make reference and
// another peer's concurrent value edit of the same dimension merge into a
// document that opens, with the dimension a reference (the reference wins;
// the merged value is kept and ignored).
test("T13d D9′: concurrent Make reference and value edit merge into an openable document whose dimension is a reference", async () => {
  const seed = await fixture();
  const diameter = makeReferenceDimensionCases().find(
    (entry) => entry.name === "diameter (circle)",
  )!.driving;
  seed.sketches[0]!.definition = withDimensions(
    makeReferenceDimensionSketch(),
    [diameter],
  );
  expect(parseAuthoredModelDocument(structuredClone(seed)).ok, "premise").toBe(
    true,
  );
  const target = {
    kind: "dimension",
    sketchId: "sketch_merge",
    dimensionId: diameter.dimensionId,
  } as const;
  const base = Automerge.from(createCollaborativeDocument(seed));
  const a = change(Automerge.clone(base), seed, (document) => {
    document.sketches[0]!.definition = makeReferenceDimensionInDefinition(
      document.sketches[0]!.definition,
      target,
    );
  });
  const b = change(Automerge.clone(base), seed, (document) => {
    document.sketches[0]!.definition = updateAnnotationValueInDefinition(
      document.sketches[0]!.definition,
      target,
      createLiteralAuthoredValue(7),
    );
  });
  const merged = materializeCollaborativeDocument(Automerge.merge(a, b));
  const parsed = parseAuthoredModelDocument(structuredClone(merged));
  expect(parsed.ok, "the merged document opens").toBe(true);
  const dimension = merged.sketches[0]!.definition.dimensions[0]!;
  expect(isReferenceDimension(dimension), "the reference wins").toBe(true);
  expect(dimension).toMatchObject({ value: createLiteralAuthoredValue(7) });
});

// T16g (T16-plan review A-13), collaborative seam: one author removes a
// mirror (its copies go with it, one action), while a peer concurrently
// dimensions one of those copies. The real Automerge merge keeps the peer's
// dimension (an authored record is never deleted silently) still naming the
// removed copy (never retargeted to the original); the merged document
// opens, and the sketch reports the missing entity as an explicit error.
test("T16g A-13: a peer's concurrent dimension on a copy removed with its mirror merges into an explicit missing-entity error (kept, not retargeted)", async () => {
  const seed = await fixture();
  const { session, relationship, outputOf } = mirroredSession("free");
  seed.sketches[0]!.definition = structuredClone(session.definition);
  expect(parseAuthoredModelDocument(structuredClone(seed)).ok, "premise").toBe(
    true,
  );
  const copy = outputOf("ab").outputEntityId;
  const base = Automerge.from(createCollaborativeDocument(seed));
  const removing = change(Automerge.clone(base), seed, (document) => {
    document.sketches[0]!.definition = removeMirrorRelationship(
      document.sketches[0]!.definition,
      relationship.derivationId,
    )!.definition;
  });
  const dimension = {
    dimensionId: "dimension_peer_copy",
    kind: "lineLength",
    label: "Peer length",
    entityId: copy,
    value: createLiteralAuthoredValue(3),
  } as SketchDefinition["dimensions"][number];
  const peer = change(Automerge.clone(base), seed, (document) => {
    const definition = document.sketches[0]!.definition;
    definition.dimensionIds = [
      ...definition.dimensionIds,
      dimension.dimensionId,
    ];
    definition.dimensions = [...definition.dimensions, dimension];
  });
  const merged = materializeCollaborativeDocument(
    Automerge.merge(removing, peer),
  );
  expect(
    parseAuthoredModelDocument(structuredClone(merged)).ok,
    "the merged document opens",
  ).toBe(true);
  const definition = merged.sketches[0]!.definition;
  expect(definition.derivedRelationships ?? [], "the mirror is gone").toEqual(
    [],
  );
  expect(definition.entityIds, "the copy is gone").not.toContain(copy);
  expect(
    definition.dimensions,
    "the peer's dimension is kept, still naming the removed copy",
  ).toEqual([dimension]);
  const validation = validateSketchDefinitionCore({
    definition: literalResolvedDefinition(definition),
    tolerances: createDocumentSolverTolerances(OCC_KERNEL_SETTINGS),
    modelingTolerance: OCC_KERNEL_SETTINGS.modelingTolerance,
  });
  expect(validation.isValid).toBe(false);
  expect(
    validation.diagnostics
      .filter((diagnostic) => diagnostic.severity === "error")
      .map((diagnostic) => [diagnostic.code, diagnostic.target]),
  ).toEqual([
    [
      "missing-dimension-entity",
      { kind: "dimension", dimensionId: "dimension_peer_copy" },
    ],
  ]);
  const reopened = rebuildSessionForDefinition(
    createNewSketchSession(
      createStandardPlaneDefinition("xy"),
      OCC_KERNEL_SETTINGS,
    ),
    { definition },
  );
  // Opened for editing: the dimension is named, with its line gone, and
  // the sketch's profiles are blocked; deleting it (or Undo) is the
  // recovery. T17e (O-1): by label, saying what is missing, never an id.
  expect(reopened.validationMessage).toBe(
    "‘Peer length’ references a line that no longer exists. The sketch is invalid; profiles from it are blocked. Delete ‘Peer length’, or Undo.",
  );
  expect(
    validation.diagnostics
      .filter((diagnostic) => diagnostic.severity === "error")
      .map((diagnostic) => diagnostic.message),
  ).toEqual(["‘Peer length’ references a line that no longer exists."]);
  expectNoInternalIds([
    reopened.validationMessage,
    ...reopened.liveSolve!.solvedSnapshot.diagnostics.map(
      (diagnostic) => diagnostic.message,
    ),
  ]);
  expect(reopened.liveRegions.status).toBe("unavailable");
  expect(
    reopened.liveSolve!.solvedSnapshot.diagnostics.map((diagnostic) => [
      diagnostic.code,
      diagnostic.severity,
    ]),
  ).toEqual([["missing-dimension-entity", "error"]]);
});
test("variables materialize in creation (id ordinal) order, also after a delete is undone (cadara-1ui8)", async () => {
  const seed = await fixture();
  seed.variables = ["1", "2", "3", "10"].map((ordinal) => ({
    variableId: `variable_${ordinal}` as const,
    name: `v${ordinal}`,
    valueText: ordinal,
  }));
  const ids = (storage: CollaborativeDocument) =>
    materializeCollaborativeDocument(storage).variables.map(
      (variable) => variable.variableId,
    );
  const order = ["variable_1", "variable_2", "variable_3", "variable_10"];
  const loaded = Automerge.from(createCollaborativeDocument(seed));
  expect(ids(loaded), "Automerge sorts map keys as text on load").toEqual(
    order,
  );

  const history = new AuthoredActionHistory();
  const identity = {
    actorId: Automerge.getActorId(loaded),
    documentId: seed.documentId,
    context: { kind: "document" as const },
  };
  const current = () =>
    documentActionState(materializeCollaborativeDocument(stored));
  let stored = loaded;
  const apply = (result: ReturnType<AuthoredActionHistory["undo"]>) => {
    expect(result.status).toBe("applied");
    stored = Automerge.change(stored, (storage) => {
      if (result.status === "applied")
        applyCollaborativeWrites(storage, result.writes);
    });
  };
  const without = structuredClone(seed);
  without.variables.splice(1, 1);
  apply(
    history.commit(
      identity,
      current(),
      documentActionState(without),
      "Delete Variable",
      current(),
    ),
  );
  expect(ids(stored)).toEqual(order.filter((id) => id !== "variable_2"));
  apply(history.undo(identity, current()));
  expect(ids(stored), "Undo puts the variable back in place").toEqual(order);
});
