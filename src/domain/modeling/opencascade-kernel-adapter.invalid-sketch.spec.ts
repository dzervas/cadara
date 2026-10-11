import { createCertifiedNeutralCurveQueryCapabilityForTest } from "@/domain/modeling/neutral-curve-certification/query";
import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";

import type { CommitSketchRequest } from "@/contracts/modeling/schema";
import { EXTRUDE_FEATURE_SCHEMA_VERSION } from "@/contracts/shared/versioning";
import type { SketchDefinition } from "@/contracts/sketch/schema";
import type { OpenCascadeInstance } from "@/domain/modeling/occ/runtime";
import { MockKernelAdapter } from "@/domain/modeling/mock-kernel-adapter";
import { SketchConstraintSolverAdapter } from "@/domain/solver/sketch-constraint-solver-adapter";
import { OpenCascadeKernelAdapter } from "@/domain/modeling/opencascade-kernel-adapter";
import {
  createSketchSessionFromSnapshot,
  deleteSelectedSketchGeometry,
  getSketchSessionPreviewLabel,
} from "@/domain/editor/sketch-session";
import { getConsumableSketchRegions } from "@/contracts/sketch/derived-validity";
import {
  eid,
  entityRef,
  mirroredSession,
} from "@/domain/editor/sketch-mirror.fixtures";
import { removeMirrorRelationship } from "@/domain/sketch-editing/mirror-repair";
import { OCC_KERNEL_SETTINGS } from "@/domain/modeling/opencascade-kernel-seed";

type OpenCascadeModule = new (
  module: Record<string, unknown>,
) => Promise<OpenCascadeInstance>;

async function loadOcc() {
  const module = (await import("../../../public/cadara-occ.js")) as {
    default: OpenCascadeModule;
  };
  const wasmBinary = new Uint8Array(
    await readFile(new URL("../../../public/cadara-occ.wasm", import.meta.url)),
  );
  return new module.default({ wasmBinary });
}

function createAdapter(oc: OpenCascadeInstance) {
  const createSolver = (revisionId: string | null) =>
    new SketchConstraintSolverAdapter({
      neutralCurveQueries: createCertifiedNeutralCurveQueryCapabilityForTest(),
      revisionId,
    });
  return new OpenCascadeKernelAdapter({
    createSolverAdapter: createSolver,
    getOpenCascadeInstance: async () => oc,
  });
}

function correlation(label: string): CommitSketchRequest["solverCorrelation"] {
  return {
    requestId: `request_${label}`,
    projectionRequestId: `request_${label}:project`,
    validationRequestId: `request_${label}:validate`,
    solveRequestId: `request_${label}:solve`,
    regionRequestId: `request_${label}:regions`,
  };
}

function withConflictingKnownPoint(
  definition: SketchDefinition,
): SketchDefinition {
  const point = definition.points[0]!;
  return {
    ...structuredClone(definition),
    constraintIds: [
      ...definition.constraintIds,
      "constraint_conflict_a",
      "constraint_conflict_b",
    ],
    constraints: [
      ...definition.constraints,
      {
        constraintId: "constraint_conflict_a",
        kind: "fixPoint",
        label: "Fix known point at origin",
        pointId: point.pointId,
        position: [0, 0],
      },
      {
        constraintId: "constraint_conflict_b",
        kind: "fixPoint",
        label: "Fix known point elsewhere",
        pointId: point.pointId,
        position: [100, 0],
      },
    ],
  };
}

function withDegenerateKnownGeometry(
  definition: SketchDefinition,
): SketchDefinition {
  const next = structuredClone(definition);
  const line = next.entities.find((entity) => entity.kind === "lineSegment");
  if (!line || line.kind !== "lineSegment") {
    throw new Error("Expected the seed sketch to contain a line.");
  }
  line.endPointId = line.startPointId;
  return next;
}

function withMissingGeometryReference(
  definition: SketchDefinition,
): SketchDefinition {
  return {
    ...structuredClone(definition),
    constraintIds: [
      ...definition.constraintIds,
      "constraint_missing_entity",
    ],
    constraints: [
      ...definition.constraints,
      {
        constraintId: "constraint_missing_entity",
        kind: "horizontal",
        label: "Missing line requirement",
        entityId: "sketch_entity_missing",
      },
    ],
  };
}

// Lane: logic. Seam: production OCC adapter authored persistence and recomputed
// solve/profile validity; this is adapter conformance, not UI behavior.
test("OCC persists invalid authored intent, restores equivalent diagnostics, and recovers without blocking another sketch", async () => {
  const oc = await loadOcc();
  const seed = await new MockKernelAdapter().getDocumentSnapshot({
    contractVersion: "modeling-contract/v1alpha1",
    documentId: "doc_workspace",
  });
  const source = seed.snapshot.document.sketches[0]!;
  const invalidDefinition = withMissingGeometryReference(
    source.sketch.definition,
  );
  const adapter = createAdapter(oc);
  const initial = await adapter.getDocumentSnapshot({
    contractVersion: "modeling-contract/v1alpha1",
    documentId: "doc_workspace",
  });

  const invalidCommit = await adapter.commitSketch({
    contractVersion: "modeling-contract/v1alpha1",
    documentId: "doc_workspace",
    baseRevisionId: initial.snapshot.document.revisionId,
    solverCorrelation: correlation("invalid_commit"),
    sketchId: null,
    sketchLabel: "Recoverable invalid sketch",
    plane: source.plane,
    definition: invalidDefinition,
  });
  expect(invalidCommit.revisionState.kind).toBe("accepted");
  const invalidSnapshot = await adapter.getDocumentSnapshot({
    contractVersion: "modeling-contract/v1alpha1",
    documentId: "doc_workspace",
  });
  const invalidSketch = invalidSnapshot.snapshot.document.sketches.find(
    (entry) => entry.sketchId === invalidCommit.sketchId,
  )!;
  expect(invalidSketch.sketch.definition.constraints).toContainEqual(
    expect.objectContaining({ constraintId: "constraint_missing_entity" }),
  );
  expect(invalidSketch.sketch.derivedValidity.state).toBe("invalid");
  expect(invalidSketch.sketch.derivedValidity.diagnostics.length).toBeGreaterThan(0);
  expect(invalidSketch.sketch.regions).toEqual([]);
  expect(
    invalidSnapshot.snapshot.presentation.entities.some(
      (entry) =>
        entry.target.kind === "region" &&
        entry.target.sketchId === invalidCommit.sketchId,
    ),
  ).toBe(false);

  const unrelatedEdit = await adapter.addDocumentVariable({
    contractVersion: "modeling-contract/v1alpha1",
    documentId: "doc_workspace",
    baseRevisionId: invalidCommit.revisionId,
    variableId: "variable_unrelated",
    name: "unrelated",
    valueText: "42",
  });
  expect(unrelatedEdit.revisionState.kind).toBe("accepted");

  const validPeer = await adapter.commitSketch({
    contractVersion: "modeling-contract/v1alpha1",
    documentId: "doc_workspace",
    baseRevisionId: unrelatedEdit.revisionId,
    solverCorrelation: correlation("valid_peer"),
    sketchId: null,
    sketchLabel: "Unaffected valid sketch",
    plane: source.plane,
    definition: source.sketch.definition,
  });
  expect(validPeer.revisionState.kind).toBe("accepted");

  const authored = await adapter.exportAuthoredModelDocument("doc_workspace");
  adapter.dispose();
  const reopened = createAdapter(oc);
  await reopened.restoreAuthoredModelDocument(authored);
  const restored = await reopened.getDocumentSnapshot({
    contractVersion: "modeling-contract/v1alpha1",
    documentId: "doc_workspace",
  });
  const restoredInvalid = restored.snapshot.document.sketches.find(
    (entry) => entry.sketchId === invalidCommit.sketchId,
  )!;
  const restoredPeer = restored.snapshot.document.sketches.find(
    (entry) => entry.sketchId === validPeer.sketchId,
  )!;
  expect(restoredInvalid.sketch.definition).toEqual(invalidSketch.sketch.definition);
  expect(restoredInvalid.sketch.derivedValidity.state).toBe("invalid");
  expect(
    restoredInvalid.sketch.derivedValidity.diagnostics.map((entry) => entry.code),
  ).toEqual(
    invalidSketch.sketch.derivedValidity.diagnostics.map((entry) => entry.code),
  );
  expect(restoredPeer.sketch.derivedValidity.state).toBe("current");
  expect(restoredPeer.sketch.regions.length).toBeGreaterThan(0);

  const correctedDefinition = structuredClone(restoredInvalid.sketch.definition);
  correctedDefinition.constraintIds = correctedDefinition.constraintIds.filter(
    (id) => id !== "constraint_missing_entity",
  );
  correctedDefinition.constraints = correctedDefinition.constraints.filter(
    (constraint) => constraint.constraintId !== "constraint_missing_entity",
  );
  const corrected = await reopened.commitSketch({
    contractVersion: "modeling-contract/v1alpha1",
    documentId: "doc_workspace",
    baseRevisionId: restored.snapshot.document.revisionId,
    solverCorrelation: correlation("corrected"),
    sketchId: restoredInvalid.sketchId,
    sketchLabel: restoredInvalid.label,
    plane: restoredInvalid.plane,
    definition: correctedDefinition,
  });
  expect(corrected.revisionState.kind).toBe("accepted");
  const correctedSnapshot = await reopened.getDocumentSnapshot({
    contractVersion: "modeling-contract/v1alpha1",
    documentId: "doc_workspace",
  });
  expect(
    correctedSnapshot.snapshot.document.sketches.find(
      (entry) => entry.sketchId === restoredInvalid.sketchId,
    )?.sketch.derivedValidity.state,
  ).toBe("current");

  const compensated = await reopened.commitSketch({
    contractVersion: "modeling-contract/v1alpha1",
    documentId: "doc_workspace",
    baseRevisionId: corrected.revisionId,
    solverCorrelation: correlation("compensated"),
    sketchId: restoredInvalid.sketchId,
    sketchLabel: restoredInvalid.label,
    plane: restoredInvalid.plane,
    definition: invalidDefinition,
  });
  expect(compensated.revisionState.kind).toBe("accepted");
  const compensatedSnapshot = await reopened.getDocumentSnapshot({
    contractVersion: "modeling-contract/v1alpha1",
    documentId: "doc_workspace",
  });
  expect(
    compensatedSnapshot.snapshot.document.sketches.find(
      (entry) => entry.sketchId === restoredInvalid.sketchId,
    )?.sketch.derivedValidity.state,
  ).toBe("invalid");
  reopened.dispose();
});

test("OCC retains nonconverged and degenerate known geometry but rejects every feature use of its derived output", async () => {
  const oc = await loadOcc();
  const seed = await new MockKernelAdapter().getDocumentSnapshot({
    contractVersion: "modeling-contract/v1alpha1",
    documentId: "doc_workspace",
  });
  const source = seed.snapshot.document.sketches[0]!;
  const adapter = createAdapter(oc);
  const initial = await adapter.getDocumentSnapshot({
    contractVersion: "modeling-contract/v1alpha1",
    documentId: "doc_workspace",
  });
  const conflictingDefinition = withConflictingKnownPoint(source.sketch.definition);
  const conflictingCommit = await adapter.commitSketch({
    contractVersion: "modeling-contract/v1alpha1",
    documentId: "doc_workspace",
    baseRevisionId: initial.snapshot.document.revisionId,
    solverCorrelation: correlation("conflicting_known_geometry"),
    sketchId: null,
    sketchLabel: "Conflicting known geometry",
    plane: source.plane,
    definition: conflictingDefinition,
  });
  expect(conflictingCommit.revisionState.kind).toBe("accepted");
  const afterConflict = await adapter.getDocumentSnapshot({
    contractVersion: "modeling-contract/v1alpha1",
    documentId: "doc_workspace",
  });
  const conflicting = afterConflict.snapshot.document.sketches.find(
    (entry) => entry.sketchId === conflictingCommit.sketchId,
  )!;
  expect(conflicting.sketch.solvedSnapshot.status.solveState).toBe(
    "partiallySolved",
  );
  expect(conflicting.sketch.derivedValidity.state).toBe("invalid");
  expect(
    conflicting.sketch.derivedValidity.diagnostics.some(
      (diagnostic) => diagnostic.code === "solver-residual-too-large",
    ),
  ).toBe(true);
  expect(conflicting.sketch.regions).toEqual([]);
  const conflictingSession = createSketchSessionFromSnapshot(
    conflicting,
    OCC_KERNEL_SETTINGS,
  );
  expect(getSketchSessionPreviewLabel(conflictingSession)).toBe(
    conflicting.sketch.derivedValidity.diagnostics.find(
      (diagnostic) => diagnostic.severity !== "info",
    )?.message,
  );

  const profileEntities = conflicting.sketch.definition.entities
    .filter((entity) => entity.kind === "lineSegment")
    .slice(0, 2);
  const rejectedOpenProfile = await adapter.createFeature({
    contractVersion: "modeling-contract/v1alpha1",
    documentId: "doc_workspace",
    baseRevisionId: conflictingCommit.revisionId,
    definition: {
      kind: "extrude",
      featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
      parameters: {
        resultBodyType: "surface",
        profiles: profileEntities.map((entity) => ({
          kind: "sketchEntity" as const,
          sketchId: conflicting.sketchId,
          entityId: entity.entityId,
        })),
        startExtent: { kind: "profilePlane" },
        extent: {
          mode: "oneSide",
          end: { kind: "blind", direction: "positive", distance: 2 },
        },
      },
    },
  });
  expect(rejectedOpenProfile.revisionState.kind).toBe("rejected");
  expect(rejectedOpenProfile.changedTargets).toEqual([]);

  const rejectedClosedProfile = await adapter.createFeature({
    contractVersion: "modeling-contract/v1alpha1",
    documentId: "doc_workspace",
    baseRevisionId: conflictingCommit.revisionId,
    definition: {
      kind: "extrude",
      featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
      parameters: {
        resultBodyType: "solid",
        profiles: [
          {
            kind: "region",
            sketchId: conflicting.sketchId,
            regionId: source.sketch.regions[0]!.regionId,
          },
        ],
        startExtent: { kind: "profilePlane" },
        extent: {
          mode: "oneSide",
          end: { kind: "blind", direction: "positive", distance: 2 },
        },
        operation: "newBody",
        booleanScope: { kind: "standalone" },
      },
    },
  });
  expect(rejectedClosedProfile.revisionState.kind).toBe("rejected");
  expect(rejectedClosedProfile.changedTargets).toEqual([]);

  const degenerateCommit = await adapter.commitSketch({
    contractVersion: "modeling-contract/v1alpha1",
    documentId: "doc_workspace",
    baseRevisionId: conflictingCommit.revisionId,
    solverCorrelation: correlation("degenerate_known_geometry"),
    sketchId: conflicting.sketchId,
    sketchLabel: conflicting.label,
    plane: conflicting.plane,
    definition: withDegenerateKnownGeometry(source.sketch.definition),
  });
  expect(degenerateCommit.revisionState.kind).toBe("accepted");
  const beforeDegenerateRestore = await adapter.getDocumentSnapshot({
    contractVersion: "modeling-contract/v1alpha1",
    documentId: "doc_workspace",
  });
  const committedDegenerate = beforeDegenerateRestore.snapshot.document.sketches.find(
    (entry) => entry.sketchId === conflicting.sketchId,
  )!;
  expect(committedDegenerate.sketch.derivedValidity.state).toBe("invalid");
  const authored = await adapter.exportAuthoredModelDocument("doc_workspace");
  adapter.dispose();

  const reopened = createAdapter(oc);
  await reopened.restoreAuthoredModelDocument(authored);
  const restored = await reopened.getDocumentSnapshot({
    contractVersion: "modeling-contract/v1alpha1",
    documentId: "doc_workspace",
  });
  const restoredDegenerate = restored.snapshot.document.sketches.find(
    (entry) => entry.sketchId === conflicting.sketchId,
  )!;
  expect(restoredDegenerate.sketch.derivedValidity.state).toBe("invalid");
  expect(restoredDegenerate.sketch.definition).toEqual(
    committedDegenerate.sketch.definition,
  );
  expect(restoredDegenerate.sketch.derivedValidity.diagnostics).toEqual(
    committedDegenerate.sketch.derivedValidity.diagnostics,
  );

  const corrected = await reopened.commitSketch({
    contractVersion: "modeling-contract/v1alpha1",
    documentId: "doc_workspace",
    baseRevisionId: restored.snapshot.document.revisionId,
    solverCorrelation: correlation("known_geometry_corrected"),
    sketchId: restoredDegenerate.sketchId,
    sketchLabel: restoredDegenerate.label,
    plane: restoredDegenerate.plane,
    definition: source.sketch.definition,
  });
  expect(corrected.revisionState.kind).toBe("accepted");
  const correctedSnapshot = await reopened.getDocumentSnapshot({
    contractVersion: "modeling-contract/v1alpha1",
    documentId: "doc_workspace",
  });
  expect(
    correctedSnapshot.snapshot.document.sketches.find(
      (entry) => entry.sketchId === restoredDegenerate.sketchId,
    )?.sketch.derivedValidity.state,
  ).toBe("current");
  reopened.dispose();
});

test("OCC rejects structurally malformed sketch values instead of classifying them as recoverable derivation failures", async () => {
  const oc = await loadOcc();
  const source = (
    await new MockKernelAdapter().getDocumentSnapshot({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
    })
  ).snapshot.document.sketches[0]!;
  const malformed = structuredClone(source.sketch.definition);
  const malformedEntityId = "sketch_entity_malformed_circle";
  malformed.entityIds.push(malformedEntityId);
  malformed.entities.push({
    kind: "circle",
    entityId: malformedEntityId,
    label: "Malformed circle",
    target: {
      kind: "sketchEntity",
      sketchId: source.sketchId,
      entityId: malformedEntityId,
    },
    isConstruction: false,
    centerPointId: malformed.pointIds[0]!,
    radius: -1,
  });
  const adapter = createAdapter(oc);
  const initial = await adapter.getDocumentSnapshot({
    contractVersion: "modeling-contract/v1alpha1",
    documentId: "doc_workspace",
  });
  const rejected = await adapter.commitSketch({
    contractVersion: "modeling-contract/v1alpha1",
    documentId: "doc_workspace",
    baseRevisionId: initial.snapshot.document.revisionId,
    solverCorrelation: correlation("malformed"),
    sketchId: null,
    sketchLabel: "Malformed",
    plane: source.plane,
    definition: malformed,
  });
  expect(rejected.revisionState.kind).toBe("rejected");
  expect(rejected.diagnostics[0]?.message).toContain("positive");
  adapter.dispose();
});

// T16b (A4, B14, B16, B17/[TECH] T16-18, issue 15 "Invalid state and
// recovery"; lane: logic, seam: production OCC adapter conformance). A
// sketch whose mirror axis was deleted is retained across Finish and
// save/reopen, every profile of it is blocked (sketch-wide gate), an
// unrelated sketch in the same document stays current and extrudes; removal
// repairs it and the Undo-equivalent compensating commit breaks it again.
// Validity is compared on `derivedValidity` (the `solvedSnapshot.diagnostics`
// commit/rebuild asymmetry is recorded, not fixed).
test("OCC retains a broken mirror across Finish and save/reopen, blocks all of its sketch's profiles, keeps a peer sketch usable, and recovers by removal", async () => {
  const oc = await loadOcc();
  const request = {
    contractVersion: "modeling-contract/v1alpha1",
    documentId: "doc_workspace",
  } as const;
  const seedDocument =
    await new MockKernelAdapter().exportAuthoredModelDocument("doc_workspace");
  const peerSketch = seedDocument.sketches[0]!;
  const seedFeature = seedDocument.features.find(
    (feature) => feature.featureId === "feature_extrude-1",
  )!.definition;
  if (seedFeature.kind !== "extrude") throw new Error("premise: Extrude 1");
  const seedExtrude = seedFeature;
  const { session, relationship } = mirroredSession("free");
  const broken = deleteSelectedSketchGeometry(session, [
    entityRef(session, eid("axis")),
  ]).definition;
  const adapter = createAdapter(oc);
  await adapter.restoreAuthoredModelDocument(seedDocument);
  const sketchOf = async (
    kernel: OpenCascadeKernelAdapter,
    sketchId: string,
  ) => {
    const { snapshot } = await kernel.getDocumentSnapshot(request);
    return {
      snapshot,
      record: snapshot.document.sketches.find(
        (entry) => entry.sketchId === sketchId,
      )!,
    };
  };
  const extrude = (
    kernel: OpenCascadeKernelAdapter,
    baseRevisionId: string,
    sketchId: string,
    regionId: string,
  ) =>
    kernel.createFeature({
      ...request,
      baseRevisionId: baseRevisionId as never,
      // The seed's Extrude 1 (a persistable definition) on another region.
      definition: {
        ...seedExtrude,
        parameters: {
          ...seedExtrude.parameters,
          profiles: [
            {
              kind: "region",
              sketchId: sketchId as never,
              regionId: regionId as never,
            },
          ],
        },
      },
    });
  const commit = (
    kernel: OpenCascadeKernelAdapter,
    baseRevisionId: string,
    sketchId: string | null,
    definition: SketchDefinition,
    label: string,
  ) =>
    kernel.commitSketch({
      ...request,
      baseRevisionId: baseRevisionId as never,
      solverCorrelation: correlation(label),
      sketchId: sketchId as never,
      sketchLabel: "Mirrored",
      plane: peerSketch.plane,
      definition,
    });
  const featureCodes = (
    snapshot: Awaited<ReturnType<typeof sketchOf>>["snapshot"],
    featureId: string,
  ) =>
    snapshot.document.diagnostics
      .filter((diagnostic) => diagnostic.featureId === featureId)
      .map((diagnostic) => diagnostic.code);
  const hasBody = (
    snapshot: Awaited<ReturnType<typeof sketchOf>>["snapshot"],
    featureId: string,
  ) =>
    snapshot.document.bodies.some((body) => body.ownerFeatureId === featureId);
  const validityOf = (
    record: Awaited<ReturnType<typeof sketchOf>>["record"],
  ) => ({
    state: record.sketch.derivedValidity.state,
    codes: record.sketch.derivedValidity.diagnostics.map((entry) => entry.code),
    failed: record.sketch.solvedSnapshot.failedDerivationIds ?? [],
    regions: record.sketch.regions.length,
    consumable: getConsumableSketchRegions(record.sketch).length,
  });
  const BROKEN = {
    state: "invalid",
    codes: [
      "derived-mirror-axis-missing",
      "regions-unavailable",
      "sketch-validation-failed",
    ],
    failed: [relationship.derivationId],
    regions: 0,
    consumable: 0,
  };
  const MESSAGE =
    "Mirror ‘mirror 1’ is broken: its mirror line was deleted. Its copies stay where they were last solved and can't be used; profiles from this sketch are blocked. Undo, or remove the mirror from the Mirror panel.";

  // A healthy mirrored sketch, extruded on its original circle's region.
  const restored = await adapter.getDocumentSnapshot(request);
  const healthyCommit = await commit(
    adapter,
    restored.snapshot.document.revisionId,
    null,
    session.definition,
    "t16b_healthy",
  );
  expect(healthyCommit.revisionState.kind).toBe("accepted");
  const sketchId = healthyCommit.sketchId!;
  const healthy = await sketchOf(adapter, sketchId);
  expect(healthy.record.sketch.derivedValidity.state).toBe("current");
  const seedRegion = healthy.record.sketch.regions.find((region) =>
    JSON.stringify(region.loops).includes(`"${eid("c")}"`),
  );
  expect(seedRegion, "premise: the original circle has a region").toBeDefined();
  const built = await extrude(
    adapter,
    healthyCommit.revisionId,
    sketchId,
    seedRegion!.regionId,
  );
  expect(built.revisionState.kind).toBe("accepted");
  const featureId = (
    await sketchOf(adapter, sketchId)
  ).snapshot.document.features.at(-1)!.featureId;
  expect(hasBody((await sketchOf(adapter, sketchId)).snapshot, featureId)).toBe(
    true,
  );

  // Finish with the mirror axis deleted: accepted and retained, invalid.
  const brokenCommit = await commit(
    adapter,
    built.revisionId,
    sketchId,
    broken,
    "t16b_broken",
  );
  expect(brokenCommit.revisionState.kind).toBe("accepted");
  const finished = await sketchOf(adapter, sketchId);
  expect(validityOf(finished.record)).toEqual(BROKEN);
  expect(
    finished.record.sketch.derivedValidity.diagnostics[0]!.message,
    "the label-based message",
  ).toBe(MESSAGE);
  expect(
    featureCodes(finished.snapshot, featureId),
    "the built extrude keeps its selection and waits for the sketch",
  ).toEqual(["profile-region-sketch-not-current"]);
  expect(hasBody(finished.snapshot, featureId)).toBe(false);
  // The unrelated sketch of the same document stays current and its Extrude 1
  // keeps building.
  const peer = finished.snapshot.document.sketches.find(
    (entry) => entry.sketchId === peerSketch.sketchId,
  )!;
  expect(peer.sketch.derivedValidity.state).toBe("current");
  expect(getConsumableSketchRegions(peer.sketch).length).toBeGreaterThan(0);
  expect(featureCodes(finished.snapshot, "feature_extrude-1")).toEqual([]);
  expect(hasBody(finished.snapshot, "feature_extrude-1")).toBe(true);

  // Save and reopen: same definition, same validity, still blocked.
  const authored = await adapter.exportAuthoredModelDocument("doc_workspace");
  adapter.dispose();
  const reopened = createAdapter(oc);
  await reopened.restoreAuthoredModelDocument(authored);
  const reopenedSketch = await sketchOf(reopened, sketchId);
  expect(JSON.stringify(reopenedSketch.record.sketch.definition)).toBe(
    JSON.stringify(finished.record.sketch.definition),
  );
  expect(validityOf(reopenedSketch.record)).toEqual(BROKEN);
  expect(reopenedSketch.record.sketch.derivedValidity.diagnostics).toEqual(
    finished.record.sketch.derivedValidity.diagnostics,
  );
  expect(featureCodes(reopenedSketch.snapshot, featureId)).toEqual([
    "profile-region-sketch-not-current",
  ]);
  const reopenedPeer = reopenedSketch.snapshot.document.sketches.find(
    (entry) => entry.sketchId === peerSketch.sketchId,
  )!;
  expect(reopenedPeer.sketch.derivedValidity.state).toBe("current");
  // T16c (T16b review A-4): the peer's consumable regions survive reopen.
  expect(getConsumableSketchRegions(reopenedPeer.sketch).length).toBe(
    getConsumableSketchRegions(peer.sketch).length,
  );
  expect(hasBody(reopenedSketch.snapshot, "feature_extrude-1")).toBe(true);

  // Repair by removal (the T16a write set): current, regions back, and the
  // kept selection reconnects by identity.
  const removal = removeMirrorRelationship(
    reopenedSketch.record.sketch.definition,
    relationship.derivationId,
  )!;
  const repaired = await commit(
    reopened,
    reopenedSketch.snapshot.document.revisionId,
    sketchId,
    removal.definition,
    "t16b_repaired",
  );
  expect(repaired.revisionState.kind).toBe("accepted");
  const afterRepair = await sketchOf(reopened, sketchId);
  expect(afterRepair.record.sketch.derivedValidity.state).toBe("current");
  expect(
    afterRepair.record.sketch.regions.map((region) => region.regionId),
  ).toContain(seedRegion!.regionId);
  expect(featureCodes(afterRepair.snapshot, featureId)).toEqual([]);
  expect(hasBody(afterRepair.snapshot, featureId)).toBe(true);

  // The Undo-equivalent compensating commit: invalid again, same validity.
  const compensated = await commit(
    reopened,
    repaired.revisionId,
    sketchId,
    reopenedSketch.record.sketch.definition,
    "t16b_compensated",
  );
  expect(compensated.revisionState.kind).toBe("accepted");
  const afterUndo = await sketchOf(reopened, sketchId);
  expect(validityOf(afterUndo.record)).toEqual(BROKEN);
  // T16c (T16b review A-4): the same diagnostics (messages included).
  expect(afterUndo.record.sketch.derivedValidity.diagnostics).toEqual(
    finished.record.sketch.derivedValidity.diagnostics,
  );
  expect(featureCodes(afterUndo.snapshot, featureId)).toEqual([
    "profile-region-sketch-not-current",
  ]);
  reopened.dispose();
});
