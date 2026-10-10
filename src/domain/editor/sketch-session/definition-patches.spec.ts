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

/** A snapshot whose spline records carry `handles` per entity (a real solve's shape). */
function solvedSnapshot(
  handlesByEntity: Readonly<
    Record<string, readonly (readonly [number, number])[]>
  >,
  extra: Partial<SolvedSketchSnapshot> = {},
): SolvedSketchSnapshot {
  return {
    schemaVersion: "solved-sketch/v1alpha2",
    status: { solveState: "solved", constraintState: "satisfied" },
    solvedEntities: Object.entries(handlesByEntity).map(
      ([entityId, handles]) => ({
        entityId: entityId as `sketch_entity_${string}`,
        kind: "spline" as const,
        reconstruction: {
          validity: "valid" as const,
          diagnostics: [],
          spans: [],
          handles,
          handleDifferentials: handles.map(() => [0, 0] as const),
        },
      }),
    ),
    solvedPoints: [],
    constraintStatuses: [],
    dimensionStatuses: [],
    diagnostics: [],
    ...extra,
  };
}

const solvedPoint = (
  id: `sketch_point_${string}`,
  solvedPosition: readonly [number, number],
) => ({
  pointId: id,
  target: {
    kind: "sketchPoint" as const,
    sketchId: "sketch_primary" as const,
    pointId: id,
  },
  solvedPosition,
});

const axisLine = {
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

/** A seed spline over a, b, c, b (aliased) mirrored about y = 0. */
function aliasedMirrorDefinition(): SketchDefinition {
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
  return {
    schemaVersion: "sketch-definition/v1alpha2",
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
      axisLine,
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
}

// T15d re-pin (was: "solved seed handles derive outputs coherently across
// aliases and repeated updates", whose snapshot carried only seed handles
// and whose copy handles were re-derived after the solve, the forward
// overwrite deleted by [TECH] T-3). A real solve's snapshot carries the
// copy's handles too: they are written from it, and coherently with the
// seed (both reflections hold), across aliases and repeated updates.
test("T15d: solved seed and copy handles are both written from the snapshot, coherently across aliases and repeated updates", () => {
  const definition = aliasedMirrorDefinition();
  const reflected = (handles: readonly (readonly [number, number])[]) =>
    handles.map(([x, y]) => [x, -y] as const);
  const firstHandles = [
    [4, 1],
    [5, 2],
    [6, 3],
    [7, 4],
  ] as const;
  const first = applySolvedSketchToDefinition(
    definition,
    solvedSnapshot({
      sketch_entity_seed: firstHandles,
      sketch_entity_output: reflected(firstHandles),
    }),
    { modelingTolerance: 1e-3 },
  );
  const secondHandles = [
    [8, -1],
    [9, -2],
    [10, -3],
    [11, -4],
  ] as const;
  const second = applySolvedSketchToDefinition(
    first,
    solvedSnapshot({
      sketch_entity_seed: secondHandles,
      sketch_entity_output: reflected(secondHandles),
    }),
    { modelingTolerance: 1e-3 },
  );
  const tangents = (entityId: string) => {
    const entity = second.entities.find((entry) => entry.entityId === entityId);
    if (entity?.kind !== "spline") throw new Error("spline");
    return entity.pointOccurrences.map((occurrence) => occurrence.tangent);
  };
  expect(tangents("sketch_entity_seed")).toEqual(
    secondHandles.map((vector) => ({ kind: "authored", vector })),
  );
  expect(tangents("sketch_entity_output")).toEqual(
    secondHandles.map(([x, y]) => ({ kind: "authored", vector: [x, -y] })),
  );
  const output = second.entities.find(
    (entity) => entity.entityId === "sketch_entity_output",
  );
  if (output?.kind !== "spline") throw new Error("spline");
  expect(output.pointOccurrences[1]?.pointId).toBe("sketch_point_mb");
  expect(output.pointOccurrences[3]?.pointId).toBe("sketch_point_mb");
});

// T15d ([TECH] T-3, review R-1a): the snapshot is the only value owner. A
// copy value that is not R(seed) in the snapshot is written as it is: the
// mirror is never re-derived after a solve (copy points, circle radius and
// authored copy handles alike).
test("T15d: a copy value that differs from R(seed) in the snapshot is written as-is (no post-solve re-derivation)", () => {
  const base = aliasedMirrorDefinition();
  const circlePoints = [
    point("sketch_point_c0", [5, 3]),
    point("sketch_point_mc0", [5, -3]),
  ];
  const circle = (
    entityId: `sketch_entity_${string}`,
    center: `sketch_point_${string}`,
  ) => ({
    kind: "circle" as const,
    entityId,
    label: entityId,
    target: {
      kind: "sketchEntity" as const,
      sketchId: "sketch_primary" as const,
      entityId,
    },
    isConstruction: false,
    centerPointId: center,
    radius: 1,
  });
  const mirror = base.derivedRelationships![0]!;
  if (mirror.kind !== "mirror") throw new Error("mirror");
  const definition: SketchDefinition = {
    ...base,
    pointIds: [...base.pointIds, ...circlePoints.map((entry) => entry.pointId)],
    points: [...base.points, ...circlePoints],
    entityIds: [...base.entityIds, "sketch_entity_c", "sketch_entity_mc"],
    entities: [
      ...base.entities,
      circle("sketch_entity_c", "sketch_point_c0"),
      circle("sketch_entity_mc", "sketch_point_mc0"),
    ],
    derivedRelationships: [
      {
        ...mirror,
        seedEntityIds: [...mirror.seedEntityIds, "sketch_entity_c"],
        outputs: [
          ...mirror.outputs,
          {
            seedEntityId: "sketch_entity_c",
            outputEntityId: "sketch_entity_mc",
            instanceIndex: 1,
            seedPointIds: ["sketch_point_c0"],
            outputPointIds: ["sketch_point_mc0"],
          },
        ],
      },
    ],
  };
  const seedHandles = [
    [4, 1],
    [5, 2],
    [6, 3],
    [7, 4],
  ] as const;
  // Not the reflection of the seed's values: the snapshot decides.
  const outputHandles = [
    [0.25, 0.5],
    [0.75, 1],
    [1.25, 1.5],
    [1.75, 2],
  ] as const;
  const snapshot = solvedSnapshot(
    {
      sketch_entity_seed: seedHandles,
      sketch_entity_output: outputHandles,
    },
    {
      solvedPoints: [
        solvedPoint("sketch_point_a", [0, 1]),
        solvedPoint("sketch_point_ma", [0.125, -0.875]),
        solvedPoint("sketch_point_c0", [5, 3]),
        solvedPoint("sketch_point_mc0", [5.5, -2.5]),
      ],
    },
  );
  snapshot.solvedEntities.push(
    {
      entityId: "sketch_entity_c",
      kind: "circle",
      centerPosition: [5, 3],
      solvedRadius: 2,
    },
    {
      entityId: "sketch_entity_mc",
      kind: "circle",
      centerPosition: [5.5, -2.5],
      solvedRadius: 2.5,
    },
  );
  const applied = applySolvedSketchToDefinition(definition, snapshot, {
    modelingTolerance: 1e-3,
  });
  const position = (pointId: string) =>
    applied.points.find((entry) => entry.pointId === pointId)!.position;
  expect(position("sketch_point_ma")).toEqual([0.125, -0.875]);
  expect(position("sketch_point_mc0")).toEqual([5.5, -2.5]);
  const radius = (entityId: string) => {
    const entity = applied.entities.find(
      (entry) => entry.entityId === entityId,
    );
    return entity?.kind === "circle" ? entity.radius : null;
  };
  expect(radius("sketch_entity_c")).toBe(2);
  expect(radius("sketch_entity_mc")).toBe(2.5);
  const output = applied.entities.find(
    (entity) => entity.entityId === "sketch_entity_output",
  );
  if (output?.kind !== "spline") throw new Error("spline");
  expect(
    output.pointOccurrences.map((occurrence) => occurrence.tangent),
  ).toEqual(outputHandles.map((vector) => ({ kind: "authored", vector })));
});

/** A seed spline/arc mirrored about y = 0, its copy's structure stale. */
function staleStructureDefinition(): SketchDefinition {
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
  const seed = {
    ...spline("sketch_entity_seed", seedPointIds, "seed-occ"),
    endSpanParameterLengths: { start: 2 },
  };
  seed.pointOccurrences = [
    {
      ...seed.pointOccurrences[0]!,
      tangent: { kind: "authored", vector: [1, 0.5] },
    },
    {
      ...seed.pointOccurrences[1]!,
      tangent: { kind: "authored", vector: [0, 0] },
    },
    { ...seed.pointOccurrences[2]!, tangent: { kind: "automatic" } },
  ] as never;
  const output = spline("sketch_entity_output", outputPointIds, "output-occ");
  output.pointOccurrences = [
    { ...output.pointOccurrences[0]!, tangent: { kind: "automatic" } },
    {
      ...output.pointOccurrences[1]!,
      tangent: { kind: "authored", vector: [3, 3] },
    },
    {
      ...output.pointOccurrences[2]!,
      tangent: { kind: "authored", vector: [2, 2] },
    },
  ] as never;
  const arc = (
    entityId: `sketch_entity_${string}`,
    [c, s, e]: readonly `sketch_point_${string}`[],
  ) => ({
    kind: "arc" as const,
    entityId,
    label: entityId,
    target: {
      kind: "sketchEntity" as const,
      sketchId: "sketch_primary" as const,
      entityId,
    },
    isConstruction: false,
    centerPointId: c!,
    startPointId: s!,
    endPointId: e!,
    sweepDirection: "counterClockwise" as const,
  });
  const points = [
    point("sketch_point_a", [0, 1]),
    point("sketch_point_b", [1, 2]),
    point("sketch_point_c", [2, 1]),
    point("sketch_point_ma", [0, -1]),
    point("sketch_point_mb", [1, -2]),
    point("sketch_point_mc", [2, -1]),
    point("sketch_point_ac", [6, 3]),
    point("sketch_point_as", [7, 3]),
    point("sketch_point_ae", [6, 4]),
    point("sketch_point_mac", [6, -3]),
    point("sketch_point_mas", [7, -3]),
    point("sketch_point_mae", [6, -4]),
    point("sketch_point_axis_a", [-1, 0]),
    point("sketch_point_axis_b", [9, 0]),
  ];
  return {
    schemaVersion: "sketch-definition/v1alpha2",
    referenceIds: [],
    references: [],
    pointIds: points.map((entry) => entry.pointId),
    points,
    entityIds: [
      "sketch_entity_seed",
      "sketch_entity_output",
      "sketch_entity_arc",
      "sketch_entity_marc",
      "sketch_entity_axis",
    ],
    entities: [
      seed,
      output,
      arc("sketch_entity_arc", [
        "sketch_point_ac",
        "sketch_point_as",
        "sketch_point_ae",
      ]),
      // Stale: the copy's sweep should be the seed's, flipped.
      arc("sketch_entity_marc", [
        "sketch_point_mac",
        "sketch_point_mas",
        "sketch_point_mae",
      ]),
      axisLine,
    ],
    constraintIds: [],
    constraints: [],
    dimensionIds: [],
    dimensions: [],
    derivedRelationships: [
      {
        derivationId: "mirror-structure",
        kind: "mirror",
        label: "Mirror structure",
        seedEntityIds: ["sketch_entity_seed", "sketch_entity_arc"],
        mirrorReference: { kind: "lineEntity", entityId: "sketch_entity_axis" },
        outputs: [
          {
            seedEntityId: "sketch_entity_seed",
            outputEntityId: "sketch_entity_output",
            instanceIndex: 1,
            seedPointIds,
            outputPointIds,
          },
          {
            seedEntityId: "sketch_entity_arc",
            outputEntityId: "sketch_entity_marc",
            instanceIndex: 1,
            seedPointIds: [
              "sketch_point_ac",
              "sketch_point_as",
              "sketch_point_ae",
            ],
            outputPointIds: [
              "sketch_point_mac",
              "sketch_point_mas",
              "sketch_point_mae",
            ],
          },
        ],
      },
    ],
  };
}

// T15d (review R-1a): the owner's structural sync runs in the patch,
// without touching a value: tangent kinds (exact zero included), sweep and
// `endSpanParameterLengths` follow the seed, and an occurrence that becomes
// authored takes the snapshot's vector, not R(seed).
test("T15d: the patch applies the owner's structural sync to copies; a newly authored copy occurrence takes the snapshot's vector", () => {
  const definition = staleStructureDefinition();
  const snapshotOutput = [
    [0.3, 0.7],
    [0, 0],
    [9, 9],
  ] as const;
  const applied = applySolvedSketchToDefinition(
    definition,
    solvedSnapshot({
      sketch_entity_seed: [
        [1, 0.5],
        [0, 0],
        [5, 5],
      ],
      sketch_entity_output: snapshotOutput,
    }),
    { modelingTolerance: 1e-3 },
  );
  const output = applied.entities.find(
    (entity) => entity.entityId === "sketch_entity_output",
  );
  if (output?.kind !== "spline") throw new Error("spline");
  expect(
    output.pointOccurrences.map((occurrence) => occurrence.tangent),
  ).toEqual([
    { kind: "authored", vector: [0.3, 0.7] },
    { kind: "authored", vector: [0, 0] },
    { kind: "automatic" },
  ]);
  expect(output.endSpanParameterLengths).toEqual({ start: 2 });
  const copyArc = applied.entities.find(
    (entity) => entity.entityId === "sketch_entity_marc",
  );
  expect(copyArc?.kind === "arc" && copyArc.sweepDirection).toBe("clockwise");
});

// T15d (review R-1b): a failed (held) mirror keeps its stored copies: no
// structural sync, and the snapshot holds their stored positions.
test("T15d: a failed mirror (snapshot failedDerivationIds) keeps its stored copies untouched", () => {
  const definition = staleStructureDefinition();
  const applied = applySolvedSketchToDefinition(
    definition,
    solvedSnapshot(
      {},
      {
        solvedPoints: definition.points.map((entry) =>
          solvedPoint(
            entry.pointId as `sketch_point_${string}`,
            entry.position,
          ),
        ),
        failedDerivationIds: ["mirror-structure"],
      },
    ),
    { modelingTolerance: 1e-3 },
  );
  for (const entityId of ["sketch_entity_output", "sketch_entity_marc"])
    expect(
      applied.entities.find((entity) => entity.entityId === entityId),
    ).toEqual(
      definition.entities.find((entity) => entity.entityId === entityId),
    );
  expect(applied.points).toEqual(definition.points);
});

// T15d ([TECH] T-3): non-mirror relationships keep today's behaviour: a
// pattern is re-evaluated from the written geometry, including a pattern
// of a mirror copy (which reads the copy as the snapshot wrote it).
test("T15d: pattern outputs are still re-evaluated after the solve, from the snapshot's copy", () => {
  const base = aliasedMirrorDefinition();
  const definition: SketchDefinition = {
    ...base,
    pointIds: [
      ...base.pointIds,
      "sketch_point_pa",
      "sketch_point_pb",
      "sketch_point_pc",
    ],
    points: [
      ...base.points,
      point("sketch_point_pa", [100, 100]),
      point("sketch_point_pb", [100, 100]),
      point("sketch_point_pc", [100, 100]),
    ],
    entityIds: [...base.entityIds, "sketch_entity_pattern"],
    entities: [
      ...base.entities,
      spline(
        "sketch_entity_pattern",
        [
          "sketch_point_pa",
          "sketch_point_pb",
          "sketch_point_pc",
          "sketch_point_pb",
        ],
        "pattern-occ",
      ),
    ],
    derivedRelationships: [
      // Definition order puts the pattern first: dependency order applies.
      {
        derivationId: "pattern-of-copy",
        kind: "linearPattern",
        label: "Pattern",
        seedEntityIds: ["sketch_entity_output"],
        vector: [10, 0],
        instanceCount: 2,
        outputs: [
          {
            seedEntityId: "sketch_entity_output",
            outputEntityId: "sketch_entity_pattern",
            instanceIndex: 1,
            seedPointIds: [
              "sketch_point_ma",
              "sketch_point_mb",
              "sketch_point_mc",
              "sketch_point_mb",
            ],
            outputPointIds: [
              "sketch_point_pa",
              "sketch_point_pb",
              "sketch_point_pc",
              "sketch_point_pb",
            ],
          },
        ],
      },
      ...base.derivedRelationships!,
    ],
  };
  const applied = applySolvedSketchToDefinition(
    definition,
    solvedSnapshot(
      {},
      {
        solvedPoints: [
          solvedPoint("sketch_point_ma", [0.5, -1.5]),
          solvedPoint("sketch_point_pa", [-50, -50]),
        ],
      },
    ),
    { modelingTolerance: 1e-3 },
  );
  const position = (pointId: string) =>
    applied.points.find((entry) => entry.pointId === pointId)!.position;
  expect(
    position("sketch_point_ma"),
    "the copy as the snapshot holds it",
  ).toEqual([0.5, -1.5]);
  expect(
    position("sketch_point_pa"),
    "the pattern re-evaluated from it",
  ).toEqual([10.5, -1.5]);
  expect(applied.derivedRelationships).toBe(definition.derivedRelationships);
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
    schemaVersion: "sketch-definition/v1alpha2",
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
    definition: {
      ...base,
      entities: [desiredSeed, output, axis],
    },
    modelingTolerance: 1e-3,
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
    modelingTolerance: 1e-3,
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
    { modelingTolerance: 1e-3 },
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
    modelingTolerance: 1e-3,
    partialSolvePolicy: "failOnConflict",
  });
  expect(fresh.status.solveState).toBe("solved");
  expect(
    fresh.solvedSnapshot.constraintStatuses.find(
      (status) => status.constraintId === "constraint_output_contact",
    )?.status,
  ).toBe("satisfied");
});
