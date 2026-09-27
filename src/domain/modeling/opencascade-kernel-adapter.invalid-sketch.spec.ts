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
  getSketchSessionPreviewLabel,
} from "@/domain/editor/sketch-session";
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
    new SketchConstraintSolverAdapter({ revisionId });
  return new OpenCascadeKernelAdapter({
    solverAdapter: createSolver(null),
    solverAdapterFactory: createSolver,
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
