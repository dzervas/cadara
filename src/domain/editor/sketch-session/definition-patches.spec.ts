import { expect, test } from "vitest";

import type {
  SketchDefinition,
  SolvedSketchSnapshot,
} from "@/contracts/sketch/schema";
import { solveSketchDefinitionCore } from "@/contracts/sketch/solver-core";
import { evaluateSketchDerivations } from "@/contracts/sketch/derived-geometry";
import {
  evaluateSplineSpan,
  reconstructSplineAggregate,
} from "@/contracts/sketch/spline-geometry";
import { applySolvedSketchToDefinition } from "./definition-patches";

const point = (
  id: `sketch_point_${string}`,
  position: readonly [number, number],
) => ({
  pointId: id,
  label: id,
  target: {
    kind: "sketchPoint" as const,
    sketchId: "sketch_primary" as const,
    pointId: id,
  },
  position,
  isConstruction: false,
});

const spline = (
  entityId: `sketch_entity_${string}`,
  pointIds: readonly `sketch_point_${string}`[],
  prefix: string,
) => ({
  kind: "spline" as const,
  entityId,
  label: entityId,
  target: {
    kind: "sketchEntity" as const,
    sketchId: "sketch_primary" as const,
    entityId,
  },
  isConstruction: false,
  pointOccurrenceIds: pointIds.map((_, index) => `${prefix}-${index}`),
  pointOccurrences: pointIds.map((pointId, index) => ({
    occurrenceId: `${prefix}-${index}`,
    pointId,
    tangent: {
      kind: "authored" as const,
      vector: [index + 1, index + 0.5] as const,
    },
  })),
  closure: "open" as const,
  interpolationPolicy: "centripetal-mean-arm-v1" as const,
});

function solvedSnapshot(
  handles: readonly (readonly [number, number])[],
): SolvedSketchSnapshot {
  return {
    schemaVersion: "solved-sketch/v1alpha1",
    status: { solveState: "solved", constraintState: "satisfied" },
    solvedEntities: [
      {
        entityId: "sketch_entity_seed",
        kind: "spline",
        reconstruction: {
          validity: "valid",
          diagnostics: [],
          spans: [],
          handles,
          handleDifferentials: handles.map(() => [0, 0] as const),
        },
      },
    ],
    solvedPoints: [],
    constraintStatuses: [],
    dimensionStatuses: [],
    diagnostics: [],
  };
}

test("solved seed handles derive outputs coherently across aliases and repeated updates", () => {
  const seedPointIds = [
    "sketch_point_a",
    "sketch_point_b",
    "sketch_point_c",
    "sketch_point_b",
  ] as const;
  const outputPointIds = [
    "sketch_point_ma",
    "sketch_point_mb",
    "sketch_point_mc",
    "sketch_point_mb",
  ] as const;
  const axis = {
    kind: "lineSegment" as const,
    entityId: "sketch_entity_axis" as const,
    label: "Axis",
    target: {
      kind: "sketchEntity" as const,
      sketchId: "sketch_primary" as const,
      entityId: "sketch_entity_axis" as const,
    },
    isConstruction: true,
    startPointId: "sketch_point_axis_a" as const,
    endPointId: "sketch_point_axis_b" as const,
  };
  const definition: SketchDefinition = {
    schemaVersion: "sketch-definition/v1alpha1",
    referenceIds: [],
    references: [],
    pointIds: [
      "sketch_point_a",
      "sketch_point_b",
      "sketch_point_c",
      "sketch_point_ma",
      "sketch_point_mb",
      "sketch_point_mc",
      "sketch_point_axis_a",
      "sketch_point_axis_b",
    ],
    points: [
      point("sketch_point_a", [0, 1]),
      point("sketch_point_b", [1, 2]),
      point("sketch_point_c", [2, 1]),
      point("sketch_point_ma", [0, -1]),
      point("sketch_point_mb", [1, -2]),
      point("sketch_point_mc", [2, -1]),
      point("sketch_point_axis_a", [-1, 0]),
      point("sketch_point_axis_b", [3, 0]),
    ],
    entityIds: [
      "sketch_entity_seed",
      "sketch_entity_output",
      "sketch_entity_axis",
    ],
    entities: [
      spline("sketch_entity_seed", seedPointIds, "seed-occ"),
      spline("sketch_entity_output", outputPointIds, "output-occ"),
      axis,
    ],
    constraintIds: [],
    constraints: [],
    dimensionIds: [],
    dimensions: [],
    derivedRelationships: [
      {
        derivationId: "mirror-spline",
        kind: "mirror",
        label: "Mirror spline",
        seedEntityIds: ["sketch_entity_seed"],
        mirrorReference: { kind: "lineEntity", entityId: "sketch_entity_axis" },
        outputs: [
          {
            seedEntityId: "sketch_entity_seed",
            outputEntityId: "sketch_entity_output",
            instanceIndex: 1,
            seedPointIds,
            outputPointIds,
          },
        ],
      },
    ],
  };

  const firstHandles = [
    [4, 1],
    [5, 2],
    [6, 3],
    [7, 4],
  ] as const;
  const first = applySolvedSketchToDefinition(
    definition,
    solvedSnapshot(firstHandles),
  );
  const secondHandles = [
    [8, -1],
    [9, -2],
    [10, -3],
    [11, -4],
  ] as const;
  const second = applySolvedSketchToDefinition(
    first,
    solvedSnapshot(secondHandles),
  );
  const output = second.entities.find(
    (entity) => entity.entityId === "sketch_entity_output",
  );
  expect(output?.kind).toBe("spline");
  if (output?.kind !== "spline") return;
  expect(
    output.pointOccurrences.map((occurrence) => occurrence.tangent),
  ).toEqual(
    secondHandles.map(([x, y]) => ({ kind: "authored", vector: [x, -y] })),
  );
  expect(output.pointOccurrences[1]?.pointId).toBe("sketch_point_mb");
  expect(output.pointOccurrences[3]?.pointId).toBe("sketch_point_mb");
});

test("driven spline constraints keep snapshot, applied definition, and fresh solve coherent", () => {
  const seedPointIds = [
    "sketch_point_a",
    "sketch_point_b",
    "sketch_point_c",
  ] as const;
  const outputPointIds = [
    "sketch_point_ma",
    "sketch_point_mb",
    "sketch_point_mc",
  ] as const;
  const axis = {
    kind: "lineSegment" as const,
    entityId: "sketch_entity_axis" as const,
    label: "Axis",
    target: {
      kind: "sketchEntity" as const,
      sketchId: "sketch_primary" as const,
      entityId: "sketch_entity_axis" as const,
    },
    isConstruction: true,
    startPointId: "sketch_point_axis_a" as const,
    endPointId: "sketch_point_axis_b" as const,
  };
  const seed = spline("sketch_entity_seed", seedPointIds, "seed-occ");
  const output = spline("sketch_entity_output", outputPointIds, "output-occ");
  const points = [
    point("sketch_point_a", [0, 1]),
    point("sketch_point_b", [1, 2]),
    point("sketch_point_c", [2, 1]),
    point("sketch_point_ma", [0, -1]),
    point("sketch_point_mb", [1, -2]),
    point("sketch_point_mc", [2, -1]),
    point("sketch_point_axis_a", [-1, 0]),
    point("sketch_point_axis_b", [3, 0]),
    point("sketch_point_contact", [0, 0]),
  ];
  const base: SketchDefinition = {
    schemaVersion: "sketch-definition/v1alpha1",
    referenceIds: [],
    references: [],
    pointIds: points.map((entry) => entry.pointId),
    points,
    entityIds: [seed.entityId, output.entityId, axis.entityId],
    entities: [seed, output, axis],
    constraintIds: [],
    constraints: [],
    dimensionIds: [],
    dimensions: [],
    derivedRelationshipIds: ["derivation_mirror"],
    derivedRelationships: [
      {
        derivationId: "derivation_mirror",
        kind: "mirror",
        label: "Mirror spline",
        seedEntityIds: [seed.entityId],
        mirrorReference: { kind: "lineEntity", entityId: axis.entityId },
        outputs: [
          {
            seedEntityId: seed.entityId,
            outputEntityId: output.entityId,
            instanceIndex: 1,
            seedPointIds,
            outputPointIds,
          },
        ],
      },
    ],
  };
  const desiredSeed = {
    ...seed,
    pointOccurrences: seed.pointOccurrences.map((occurrence, index) =>
      index === 1
        ? {
            ...occurrence,
            tangent: { kind: "authored" as const, vector: [0, 3] as const },
          }
        : occurrence,
    ),
  };
  const desiredDefinition = evaluateSketchDerivations({
    ...base,
    entities: [desiredSeed, output, axis],
  }).definition;
  const desiredOutput = desiredDefinition.entities.find(
    (entity) => entity.entityId === output.entityId,
  );
  expect(desiredOutput?.kind).toBe("spline");
  if (desiredOutput?.kind !== "spline") return;
  const desiredGeometry = reconstructSplineAggregate(
    desiredOutput,
    Object.fromEntries(
      desiredDefinition.points.map((entry) => [entry.pointId, entry.position]),
    ),
  );
  expect(desiredGeometry.validity).toBe("valid");
  if (desiredGeometry.validity !== "valid") return;
  const contact = evaluateSplineSpan(desiredGeometry.spans[0]!, {
    kind: "local",
    value: 0.5,
  }).position;
  const fixedPointIds = [
    ...seedPointIds,
    axis.startPointId,
    axis.endPointId,
    "sketch_point_contact" as const,
  ];
  const constraints: SketchDefinition["constraints"] = [
    {
      constraintId: "constraint_output_contact",
      kind: "pointOnCurve",
      label: "Output contact",
      point: { kind: "localPoint", pointId: "sketch_point_contact" },
      curve: { kind: "localEntity", entityId: output.entityId },
    },
    ...fixedPointIds.map((pointId, index) => ({
      constraintId: `constraint_fix_${index}` as const,
      kind: "fixPoint" as const,
      label: `Fix ${pointId}`,
      pointId,
      position:
        pointId === "sketch_point_contact"
          ? contact
          : base.points.find((entry) => entry.pointId === pointId)!.position,
    })),
  ];
  const definition: SketchDefinition = {
    ...base,
    points: base.points.map((entry) =>
      entry.pointId === "sketch_point_contact"
        ? { ...entry, position: contact }
        : entry,
    ),
    constraintIds: constraints.map((constraint) => constraint.constraintId),
    constraints,
  };
  const tolerances = {
    coincidence: 1e-6,
    angleRadians: 1e-6,
    minimumSegmentLength: 1e-6,
  } as const;
  const solved = solveSketchDefinitionCore({
    definition,
    tolerances,
    partialSolvePolicy: "failOnConflict",
  });
  expect(solved.status.solveState).toBe("solved");
  expect(
    solved.solvedSnapshot.constraintStatuses.find(
      (status) => status.constraintId === "constraint_output_contact",
    )?.status,
  ).toBe("satisfied");

  const applied = applySolvedSketchToDefinition(
    definition,
    solved.solvedSnapshot,
  );
  const solvedOutput = solved.solvedSnapshot.solvedEntities.find(
    (entity) => entity.entityId === output.entityId && entity.kind === "spline",
  );
  const appliedOutput = applied.entities.find(
    (entity) => entity.entityId === output.entityId,
  );
  expect(solvedOutput?.kind).toBe("spline");
  expect(appliedOutput?.kind).toBe("spline");
  if (
    solvedOutput?.kind !== "spline" ||
    solvedOutput.reconstruction.validity !== "valid" ||
    appliedOutput?.kind !== "spline"
  )
    return;
  expect(
    appliedOutput.pointOccurrences.map((occurrence) => occurrence.tangent),
  ).toEqual(
    solvedOutput.reconstruction.handles.map((vector) => ({
      kind: "authored",
      vector,
    })),
  );

  const fresh = solveSketchDefinitionCore({
    definition: applied,
    tolerances,
    partialSolvePolicy: "failOnConflict",
  });
  expect(fresh.status.solveState).toBe("solved");
  expect(
    fresh.solvedSnapshot.constraintStatuses.find(
      (status) => status.constraintId === "constraint_output_contact",
    )?.status,
  ).toBe("satisfied");
});
