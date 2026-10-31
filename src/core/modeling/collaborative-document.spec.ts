import { test, expect } from "vitest";
import { literalResolvedDefinition } from "@/contracts/sketch/region-extraction.fixtures";
import { expectNoInternalIds } from "@/contracts/sketch/user-text.fixtures";
import * as Automerge from "@automerge/automerge";
import { createSeedAuthoredModelDocument } from "../../application/modeling/modeling-test-fixtures";
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
import type { AuthoredActionState } from "@/contracts/modeling/authored-actions";
import { authoredModelDocumentsEqual } from "@/contracts/modeling/authored-document-equality";
import { createNewSketchSession } from "@/core/editor/sketch-session";
import { createStandardPlaneDefinition } from "./opencascade-kernel-seed";
import { OCC_KERNEL_SETTINGS } from "@/core/modeling/opencascade-kernel-seed";
import { createLiteralAuthoredValue } from "@/contracts/modeling/authored-values";
import { parseAuthoredModelDocument } from "@/contracts/modeling/authored-document.runtime-schema";
import {
  isReferenceDimension,
  type SketchDefinition,
} from "@/contracts/sketch/schema";
import { validateSketchDefinitionCore } from "@/core/sketch-solver";
import { createDocumentSolverTolerances } from "@/contracts/solver/schema";
import { mirroredSession } from "@/core/editor/sketch-mirror.fixtures";
import { rebuildSessionForDefinition } from "@/core/editor/sketch-session/definition-authoring";
import { removeMirrorRelationship } from "@/core/sketch-editing/mirror-repair";
import {
  makeReferenceDimensionCases,
  makeReferenceDimensionSketch,
  withDimensions,
} from "@/contracts/sketch/reference-dimension.fixtures";
import {
  makeReferenceDimensionInDefinition,
  updateAnnotationValueInDefinition,
} from "@/core/editor/sketch-session/annotation-editing";

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
    if (result.status === "applied") applyCollaborativeWrites(storage, result);
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
    if (result.status === "applied") applyCollaborativeWrites(storage, result);
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
  expect(
    ids(loaded),
    "a new document lists variables in creation order",
  ).toEqual(order);

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
        applyCollaborativeWrites(storage, result);
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

// Seam: the collaborative codec over a real Automerge document.
// Records are stored as maps keyed by id, and Automerge does not keep map key
// order: a map created in one change lists its keys in code-unit order, a key
// added to an existing map is appended (a deleted key re-created too), a clone
// keeps the live order, and a loaded document lists its keys in code-unit
// order again. The codec persists each collection's order beside its records,
// so every one of those copies returns the authored order.
type PointId = SketchDefinition["pointIds"][number];
/** `Automerge.from` types plain records only. */
const automergeFrom = (
  storage: Omit<CollaborativeDocument, "collectionOrder">,
) =>
  Automerge.from(
    storage as unknown as Record<string, unknown>,
  ) as unknown as Automerge.Doc<CollaborativeDocument>;
const pointRecord = (pointId: PointId) => ({
  pointId,
  label: pointId,
  target: {
    kind: "sketchPoint" as const,
    sketchId: "sketch_merge" as const,
    pointId,
  },
  position: [1, 2] as [number, number],
  isConstruction: false,
});
async function outOfIdOrderFixture() {
  const seed = await fixture();
  const definition = seed.sketches[0]!.definition;
  definition.pointIds = ["sketch_point_q", "sketch_point_p"];
  definition.points = definition.pointIds.map(pointRecord);
  // Not in id ordinal order either, which is the variables' fallback.
  seed.variables = ["3", "1"].map((ordinal) => ({
    variableId: `variable_${ordinal}` as const,
    name: `v${ordinal}`,
    valueText: ordinal,
  }));
  const feature = (await createSeedAuthoredModelDocument()).features[0]!;
  seed.features = ["b", "a"].map((id) => ({
    ...structuredClone(feature),
    featureId: `feature_${id}` as const,
  }));
  seed.featureOrder = seed.features.map((f) => f.featureId);
  seed.historyOrder = [
    { kind: "sketch", sketchId: "sketch_merge" },
    ...seed.featureOrder.map((featureId) => ({
      kind: "feature" as const,
      featureId,
    })),
  ];
  return seed;
}
/** `document` with `pointId` inserted into its sketch before `before` (else last). */
function withPoint(
  document: AuthoredModelDocument,
  pointId: PointId,
  before?: PointId,
) {
  const next = structuredClone(document);
  const definition = next.sketches[0]!.definition;
  const index = before ? definition.pointIds.indexOf(before) : -1;
  const at = index < 0 ? definition.points.length : index;
  definition.points.splice(at, 0, pointRecord(pointId));
  definition.pointIds.splice(at, 0, pointId);
  return next;
}
function withoutPoint(document: AuthoredModelDocument, pointId: PointId) {
  const next = structuredClone(document);
  const definition = next.sketches[0]!.definition;
  definition.points = definition.points.filter((p) => p.pointId !== pointId);
  definition.pointIds = definition.pointIds.filter((id) => id !== pointId);
  return next;
}
const pointIdsOf = (document: AuthoredModelDocument) =>
  document.sketches[0]!.definition.points.map((point) => point.pointId);
/** The stored document in a live copy, a clone and after save/load. */
const copies = (stored: Automerge.Doc<CollaborativeDocument>) =>
  Object.entries({
    live: stored,
    clone: Automerge.clone(stored),
    reload: Automerge.load<CollaborativeDocument>(Automerge.save(stored)),
  }).map(
    ([copy, doc]) => [copy, materializeCollaborativeDocument(doc)] as const,
  );
function expectStoredAs(
  stored: Automerge.Doc<CollaborativeDocument>,
  expected: AuthoredModelDocument,
  step: string,
) {
  for (const [copy, document] of copies(stored))
    expect(
      authoredModelDocumentsEqual(document, expected),
      `${step}: the ${copy} copy returns the authored document, records in order`,
    ).toBe(true);
}
/** One actor's ledger over a stored Automerge document. */
function storedActions(initial: Automerge.Doc<CollaborativeDocument>) {
  const history = new AuthoredActionHistory();
  const identity = {
    actorId: Automerge.getActorId(initial),
    documentId: materializeCollaborativeDocument(initial).documentId,
    context: { kind: "document" as const },
  };
  let stored = initial;
  const run = (
    act: (
      current: AuthoredActionState,
    ) => ReturnType<AuthoredActionHistory["undo"]>,
  ) => {
    const snapshot = stored;
    const current = documentActionState(
      materializeCollaborativeDocument(snapshot),
    );
    const result = act(current);
    if (result.status !== "applied")
      throw new Error(`Action not applied: ${JSON.stringify(result)}`);
    stored = Automerge.change(snapshot, (storage) =>
      applyCollaborativeWrites(storage, result, snapshot),
    );
    // The ledger holds authored fields only.
    const { revisionId, topologyLineage } =
      materializeCollaborativeDocument(stored);
    return {
      ...(result.state.data as AuthoredModelDocument),
      revisionId,
      topologyLineage,
    };
  };
  return {
    get stored() {
      return stored;
    },
    set stored(next) {
      stored = next;
    },
    commit: (candidate: AuthoredModelDocument) =>
      run((current) =>
        history.commit(
          identity,
          current,
          documentActionState(candidate),
          "Edit",
          current,
        ),
      ),
    undo: () => run((current) => history.undo(identity, current)),
    redo: () => run((current) => history.redo(identity, current)),
  };
}

test("record collections keep their authored order through a new map, keys added to it, delete and re-create, clone and save/load (cadara-yt1)", async () => {
  const seed = await outOfIdOrderFixture();
  const actions = storedActions(
    automergeFrom(createCollaborativeDocument(seed)),
  );
  expectStoredAs(actions.stored, seed, "a map created in one change");

  // "…_a" sorts first and "…_zz" last in code-unit order; both are authored
  // elsewhere, added to the existing points map.
  const added = withPoint(
    withPoint(seed, "sketch_point_a", "sketch_point_p"),
    "sketch_point_zz",
  );
  actions.commit(added);
  expectStoredAs(actions.stored, added, "keys added to an existing map");
  const withVariable = {
    ...added,
    variables: [
      ...added.variables,
      { variableId: "variable_2" as const, name: "v2", valueText: "2" },
    ],
  };
  actions.commit(withVariable);
  expectStoredAs(actions.stored, withVariable, "a variable added last");

  actions.commit(withoutPoint(withVariable, "sketch_point_q"));
  expect(
    pointIdsOf(actions.undo()),
    "premise: Undo puts the deleted first point back first",
  ).toEqual([
    "sketch_point_q",
    "sketch_point_a",
    "sketch_point_p",
    "sketch_point_zz",
  ]);
  expectStoredAs(actions.stored, withVariable, "a deleted key re-created");
});

test("a document stored without record orders opens in a deterministic order and keeps it from its next write (cadara-yt1)", async () => {
  const seed = await outOfIdOrderFixture();
  const { collectionOrder, ...legacy } = createCollaborativeDocument(seed);
  expect(collectionOrder, "premise: orders are stored").toBeDefined();
  // A live copy whose map key order differs from the loaded one.
  const live = Automerge.change(automergeFrom(legacy), (storage) => {
    const points = (
      (storage.authored.sketches as Record<string, Record<string, unknown>>)
        .sketch_merge!.definition as Record<string, Record<string, unknown>>
    ).points!;
    const record = points.sketch_point_q;
    delete points.sketch_point_q;
    points.sketch_point_q = JSON.parse(JSON.stringify(record));
  });
  const opened = copies(live).map(([copy, document]) => {
    expect(
      parseAuthoredModelDocument(structuredClone(document)).ok,
      `${copy} opens`,
    ).toBe(true);
    return {
      points: pointIdsOf(document),
      pointIds: document.sketches[0]!.definition.pointIds,
      variables: document.variables.map((variable) => variable.variableId),
      features: document.features.map((f) => f.featureId),
    };
  });
  const fallback = {
    points: ["sketch_point_p", "sketch_point_q"],
    pointIds: ["sketch_point_p", "sketch_point_q"],
    variables: ["variable_1", "variable_3"],
    features: ["feature_a", "feature_b"],
  };
  expect(
    opened,
    "every record, once; variables by id ordinal, others by id; live, clone and reload agree",
  ).toEqual([fallback, fallback, fallback]);

  const actions = storedActions(live);
  const renamed = actions.commit({
    ...materializeCollaborativeDocument(live),
    name: "Renamed",
  });
  const appended = withPoint(renamed, "sketch_point_a");
  actions.commit(appended);
  expectStoredAs(
    actions.stored,
    appended,
    "the next writes store the opened order and the new record's place",
  );
});

test("concurrent record additions and deletions merge every live record once, in one order on every peer, and Undo/Redo keep it (cadara-yt1)", async () => {
  const seed = await outOfIdOrderFixture();
  const base = automergeFrom(createCollaborativeDocument(seed));
  const a = storedActions(Automerge.clone(base));
  const b = storedActions(Automerge.clone(base));
  a.commit(withPoint(seed, "sketch_point_z"));
  b.commit(
    withoutPoint(
      withPoint(seed, "sketch_point_m", "sketch_point_p"),
      "sketch_point_q",
    ),
  );
  const ab = Automerge.merge(Automerge.clone(a.stored), b.stored);
  const ba = Automerge.merge(Automerge.clone(b.stored), a.stored);
  const merged = materializeCollaborativeDocument(ab);
  expect(pointIdsOf(merged).toSorted(), "each live record once").toEqual([
    "sketch_point_m",
    "sketch_point_p",
    "sketch_point_z",
  ]);
  expect(merged.sketches[0]!.definition.pointIds).toEqual(pointIdsOf(merged));
  expect(
    pointIdsOf(materializeCollaborativeDocument(ba)),
    "both peers materialize one order",
  ).toEqual(pointIdsOf(merged));
  expectStoredAs(ab, merged, "the merged order");

  a.stored = ab;
  const undone = a.undo();
  expect(pointIdsOf(undone), "Undo removes only this actor's record").toEqual(
    pointIdsOf(merged).filter((id) => id !== "sketch_point_z"),
  );
  expectStoredAs(a.stored, undone, "after Undo");
  const redone = a.redo();
  expect(
    pointIdsOf(redone).toSorted(),
    "Redo restores the record once",
  ).toEqual(["sketch_point_m", "sketch_point_p", "sketch_point_z"]);
  expect(
    pointIdsOf(redone).indexOf("sketch_point_z"),
    "after its predecessor",
  ).toBeGreaterThan(pointIdsOf(redone).indexOf("sketch_point_p"));
  expectStoredAs(a.stored, redone, "after Redo");
});

test("stale, repeated and missing order entries never change membership, and the next write converges without later order-only changes (cadara-yt1)", async () => {
  const seed = await outOfIdOrderFixture();
  // An order naming a removed record twice and a record named twice, and a
  // record added by a writer that stores no order.
  const stored = Automerge.change(
    automergeFrom(createCollaborativeDocument(seed)),
    (storage) => {
      const address = JSON.stringify([
        "sketches",
        "sketch_merge",
        "definition",
        "points",
      ]);
      storage.collectionOrder![address]!.unshift(
        "sketch_point_gone",
        "sketch_point_p",
      );
      storage.collectionOrder![address]!.push("sketch_point_gone");
      const points = (
        (storage.authored.sketches as Record<string, Record<string, unknown>>)
          .sketch_merge!.definition as Record<string, Record<string, unknown>>
      ).points!;
      points.sketch_point_b = pointRecord("sketch_point_b");
    },
  );
  const opened = copies(stored).map(([, document]) => pointIdsOf(document));
  expect(
    opened,
    "listed live records first, once, then unlisted ones; every copy agrees",
  ).toEqual([
    ["sketch_point_p", "sketch_point_q", "sketch_point_b"],
    ["sketch_point_p", "sketch_point_q", "sketch_point_b"],
    ["sketch_point_p", "sketch_point_q", "sketch_point_b"],
  ]);

  const actions = storedActions(stored);
  const renamed = actions.commit({
    ...materializeCollaborativeDocument(stored),
    name: "Renamed",
  });
  expectStoredAs(actions.stored, renamed, "the converged order");
  const converged = actions.stored;
  const again = Automerge.change(converged, (storage) =>
    applyCollaborativeWrites(
      storage,
      { writes: [], state: documentActionState(renamed) },
      converged,
    ),
  );
  expect(
    Automerge.getHeads(again),
    "materializing and writing the same records again changes nothing",
  ).toEqual(Automerge.getHeads(converged));
});
