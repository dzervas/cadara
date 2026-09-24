import { expect, test } from "vitest";

import {
  validateSketchDefinition,
  validateSketchRecord,
} from "@/contracts/sketch/runtime-schema";
import { MockKernelAdapter } from "@/domain/modeling/mock-kernel-adapter";

// Lane: logic. Seam: strict current sketch-record runtime contract.
test("invalid and stale sketch derivations cannot carry consumable regions", async () => {
  const snapshot = await new MockKernelAdapter().getDocumentSnapshot({
    contractVersion: "modeling-contract/v1alpha1",
    documentId: "doc_workspace",
  });
  const current = snapshot.snapshot.document.sketches[0]!.sketch;
  expect(validateSketchRecord(current).success).toBe(true);

  const invalidWithCachedRegions = structuredClone(current);
  invalidWithCachedRegions.derivedValidity = {
    state: "invalid",
    diagnostics: [
      {
        code: "missing-geometry",
        severity: "error",
        message: "Missing geometry.",
        target: null,
      },
    ],
  };
  expect(validateSketchRecord(invalidWithCachedRegions).success).toBe(false);

  const staleWithCachedRegions = structuredClone(current);
  staleWithCachedRegions.derivedValidity = {
    state: "stale",
    diagnostics: [],
  };
  expect(validateSketchRecord(staleWithCachedRegions).success).toBe(false);
});

test("equal-offset persists as a strict normal constraint", () => {
  const point = (index: number, x: number, y: number) => ({
    pointId: `sketch_point_equal_offset_${index}`,
    label: `Point ${index}`,
    target: {
      kind: "sketchPoint",
      sketchId: "sketch_equal_offset",
      pointId: `sketch_point_equal_offset_${index}`,
    },
    position: [x, y],
    isConstruction: false,
  });
  const points = [
    point(0, 0, 0),
    point(1, 4, 0),
    point(2, 0, 2),
    point(3, 4, 2),
    point(4, 0, 6),
    point(5, 4, 6),
    point(6, 0, 8),
    point(7, 4, 8),
  ];
  const entities = [0, 1, 2, 3].map((index) => ({
    kind: "lineSegment",
    entityId: `sketch_entity_equal_offset_${index}`,
    label: `Line ${index}`,
    target: {
      kind: "sketchEntity",
      sketchId: "sketch_equal_offset",
      entityId: `sketch_entity_equal_offset_${index}`,
    },
    isConstruction: false,
    startPointId: points[index * 2]!.pointId,
    endPointId: points[index * 2 + 1]!.pointId,
  }));
  const constraint = {
    constraintId: "constraint_equal_offset",
    kind: "equalOffset",
    label: "Equal offsets",
    pairs: [
      {
        seedEntityId: entities[0]!.entityId,
        offsetEntityId: entities[1]!.entityId,
        side: "left",
      },
      {
        seedEntityId: entities[2]!.entityId,
        offsetEntityId: entities[3]!.entityId,
        side: "right",
      },
    ],
  };
  const definition = {
    schemaVersion: "sketch-definition/v1alpha1",
    referenceIds: [],
    references: [],
    pointIds: points.map((entry) => entry.pointId),
    points,
    entityIds: entities.map((entry) => entry.entityId),
    entities,
    constraintIds: [constraint.constraintId],
    constraints: [constraint],
    dimensionIds: [],
    dimensions: [],
  };

  const persisted = JSON.parse(JSON.stringify(definition));
  expect(validateSketchDefinition(persisted).success).toBe(true);
  expect(persisted.constraints).toEqual([constraint]);

  const unknown = structuredClone(persisted);
  unknown.constraints[0].kind = "offsetRelationship";
  expect(validateSketchDefinition(unknown).success).toBe(false);

  const malformed = structuredClone(persisted);
  malformed.constraints[0].pairs = [malformed.constraints[0].pairs[0]];
  expect(validateSketchDefinition(malformed).success).toBe(false);

  const invalidSide = structuredClone(persisted);
  invalidSide.constraints[0].pairs[1].side = "outside";
  expect(validateSketchDefinition(invalidSide).success).toBe(false);
});

test("ordinary splines round-trip only in the current aggregate format", async () => {
  const snapshot = await new MockKernelAdapter().getDocumentSnapshot({
    contractVersion: "modeling-contract/v1alpha1",
    documentId: "doc_workspace",
  });
  const definition = structuredClone(
    snapshot.snapshot.document.sketches[0]!.sketch.definition,
  );
  const [first, second] = definition.pointIds;
  expect(first).toBeDefined();
  expect(second).toBeDefined();
  definition.entityIds.push("sketch_entity_spline_contract");
  definition.entities.push({
    kind: "spline",
    entityId: "sketch_entity_spline_contract",
    label: "Spline contract",
    target: {
      kind: "sketchEntity",
      sketchId: definition.points[0]!.target.sketchId,
      entityId: "sketch_entity_spline_contract",
    },
    isConstruction: false,
    pointOccurrenceIds: ["occurrence-a", "occurrence-b"],
    pointOccurrences: [
      {
        occurrenceId: "occurrence-a",
        pointId: first!,
        tangent: { kind: "automatic" },
      },
      {
        occurrenceId: "occurrence-b",
        pointId: second!,
        tangent: { kind: "authored", vector: [0, 0] },
      },
    ],
    closure: "open",
    interpolationPolicy: "centripetal-mean-arm-v1",
  });

  const roundTrip = JSON.parse(JSON.stringify(definition));
  expect(validateSketchDefinition(roundTrip).success).toBe(true);

  const oldFormat = structuredClone(roundTrip) as Record<string, unknown>;
  const oldEntity = (oldFormat.entities as Array<Record<string, unknown>>).at(
    -1,
  )!;
  delete oldEntity.pointOccurrenceIds;
  delete oldEntity.pointOccurrences;
  delete oldEntity.closure;
  delete oldEntity.interpolationPolicy;
  oldEntity.fitPointIds = [first, second];
  oldEntity.degree = 3;
  expect(validateSketchDefinition(oldFormat).success).toBe(false);
});
