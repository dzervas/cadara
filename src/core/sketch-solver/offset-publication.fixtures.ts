import { compileSketchSolveProgram } from "./compile-program";
import { solveSketchDefinitionCore } from "./solve-sketch";
import { createCompiledSketchSolveSession } from "./start-session";
import { updateCompiledSketchSolveSession } from "./update-session";
import type { ModelingDocumentSettings } from "@/contracts/modeling/schema";
import type { ConstraintId, DimensionId } from "@/contracts/shared/ids";
import { evaluateSketchDerivations } from "@/contracts/sketch/derived-geometry";
import { publishSketchOffsets } from "@/contracts/sketch/offset-publication";
import { literalAuthoredDefinition } from "@/contracts/sketch/region-extraction.fixtures";
import type { NumericSketchDefinition as SketchDefinition } from "@/contracts/sketch/schema";
import { createNewSketchSessionFromSupport } from "@/domain/editor/sketch-session";
import { rebuildSessionForDefinition } from "@/domain/editor/sketch-session/definition-authoring";
import { createCertifiedCubicTubeChain } from "@/domain/modeling/neutral-curve-certification/cubic-tube-chain";
import { createCertifiedNeutralCurveRequestQuery } from "@/domain/modeling/neutral-curve-certification/query";
import { OCC_KERNEL_SETTINGS } from "@/domain/modeling/opencascade-kernel-seed";

/**
 * A circle offset (seed radius 2, inward distance 1): `deleteSeed` removes
 * the seed circle and keeps the relationship; `seedRadius` drives the seed
 * radius by a dimension; `authoredSeedRadius` / `authoredOutputRadius`
 * replace the authored radii (2 and 1); `outputDiameter` adds a diameter
 * dimension on the offset's output circle.
 */
export function circleOffsetDefinition(options: {
  deleteSeed?: boolean;
  seedRadius?: number;
  authoredSeedRadius?: number;
  authoredOutputRadius?: number;
  outputDiameter?: number;
}): SketchDefinition {
  const point = (id: string) =>
    ({
      pointId: `sketch_point_${id}`,
      label: id,
      target: {
        kind: "sketchPoint",
        sketchId: "sketch_primary",
        pointId: `sketch_point_${id}`,
      },
      position: [0, 0],
      isConstruction: false,
    }) as const;
  const circle = (id: string, radius: number) =>
    ({
      kind: "circle",
      entityId: `sketch_entity_${id}`,
      label: id,
      target: {
        kind: "sketchEntity",
        sketchId: "sketch_primary",
        entityId: `sketch_entity_${id}`,
      },
      isConstruction: false,
      centerPointId: `sketch_point_${id}`,
      radius,
    }) as const;
  const points = [point("seed"), point("output")];
  const entities = [
    ...(options.deleteSeed
      ? []
      : [circle("seed", options.authoredSeedRadius ?? 2)]),
    circle("output", options.authoredOutputRadius ?? 1),
  ];
  const dimensions: SketchDefinition["dimensions"] = [
    ...(options.seedRadius === undefined
      ? []
      : [
          {
            dimensionId: "dimension_seed_radius" as DimensionId,
            kind: "circleRadius" as const,
            label: "Seed radius",
            entityId: "sketch_entity_seed" as const,
            value: options.seedRadius,
          },
        ]),
    ...(options.outputDiameter === undefined
      ? []
      : [
          {
            dimensionId: "dimension_output_diameter" as DimensionId,
            kind: "diameter" as const,
            label: "Output diameter",
            entityId: "sketch_entity_output" as const,
            value: options.outputDiameter,
          },
        ]),
  ];
  return {
    schemaVersion: "sketch-definition/v1alpha2",
    referenceIds: [],
    references: [],
    pointIds: points.map((item) => item.pointId),
    points,
    entityIds: entities.map((item) => item.entityId),
    entities,
    constraintIds: [],
    constraints: [],
    dimensionIds: dimensions.map((dimension) => dimension.dimensionId),
    dimensions,
    derivedRelationships: [
      {
        derivationId: "derivation_offset_circle",
        kind: "offset",
        label: "Circle offset",
        seedEntityIds: ["sketch_entity_seed"],
        distance: 1,
        jointPolicy: "trimExtendArcFallback",
        piecewiseCubicOutputs: [],
        jointOutputs: [],
        outputs: [
          {
            seedEntityId: "sketch_entity_seed",
            outputEntityId: "sketch_entity_output",
            instanceIndex: 1,
            seedPointIds: ["sketch_point_seed"],
            outputPointIds: ["sketch_point_output"],
          },
        ],
      },
    ],
  };
}

/** The core solve, its compiled diagnostics and the sketch session's live solve of one definition. */
export function solveCoreAndLive(definition: SketchDefinition) {
  const input = {
    definition,
    tolerances: {
      coincidence: 1e-6,
      angleRadians: 1e-6,
      minimumSegmentLength: 1e-6,
    },
    modelingTolerance: 1e-3,
    partialSolvePolicy: "bestEffort" as const,
  };
  const session = rebuildSessionForDefinition(
    createNewSketchSessionFromSupport(
      { kind: "construction", constructionId: "construction_plane-xy" },
      { ...OCC_KERNEL_SETTINGS } as ModelingDocumentSettings,
    ),
    // The editor session holds the authored definition.
    { definition: literalAuthoredDefinition(definition) },
  );
  return {
    compiled: compileSketchSolveProgram(input).diagnostics,
    core: solveSketchDefinitionCore(input).solvedSnapshot,
    live: session.liveSolve!.solvedSnapshot,
  };
}

/** The one publication round of a core or live snapshot of `definition`. */
export function publishOnce(
  definition: SketchDefinition,
  snapshot: SolvedSketchSnapshotForTest,
) {
  return publishSketchOffsets({
    definition,
    solvedSnapshot: snapshot,
    modelingTolerance: 1e-3,
    capabilities: {
      query: createCertifiedNeutralCurveRequestQuery(),
      certifier: createCertifiedCubicTubeChain(),
    },
  }).map((publication) => [
    publication.derivationId,
    publication.status,
    publication.diagnostic?.code,
  ]);
}

export type SolvedSketchSnapshotForTest = ReturnType<
  typeof solveSketchDefinitionCore
>["solvedSnapshot"];

export const OFFSET_ROW_TOLERANCES = {
  coincidence: 1e-6,
  angleRadians: 1e-6,
  minimumSegmentLength: 1e-6,
};

export const solvedCircleRadius = (
  snapshot: SolvedSketchSnapshotForTest,
  entityId: string,
) => {
  const entity = snapshot.solvedEntities.find(
    (candidate) => candidate.entityId === entityId,
  );
  return entity?.kind === "circle" ? entity.solvedRadius : null;
};

export const statusOf = (snapshot: SolvedSketchSnapshotForTest, dimensionId: string) =>
  snapshot.dimensionStatuses.find(
    (status) => status.dimensionId === dimensionId,
  )?.status;

/**
 * The circle offset with an output diameter of 2, its seed centre fixed and
 * a free point P on the seed circle at (`seedRadius`, 0), so dragging P
 * changes the seed radius; an interactive session on it.
 */
export function dragSeedRadiusSession(seedRadius: number) {
  const base = circleOffsetDefinition({
    authoredSeedRadius: seedRadius,
    outputDiameter: 2,
  });
  const onSeed = "sketch_point_on_seed" as SketchDefinition["pointIds"][number];
  const definition: SketchDefinition = {
    ...base,
    pointIds: [...base.pointIds, onSeed],
    points: [
      ...base.points,
      {
        pointId: onSeed,
        label: "on seed",
        target: {
          kind: "sketchPoint",
          sketchId: "sketch_primary",
          pointId: onSeed,
        },
        position: [seedRadius, 0],
        isConstruction: false,
      } as SketchDefinition["points"][number],
    ],
    constraintIds: ["constraint_fix_seed_center", "constraint_on_seed"].map(
      (id) => id as ConstraintId,
    ),
    constraints: [
      {
        constraintId: "constraint_fix_seed_center",
        kind: "fixPoint",
        label: "Fix seed centre",
        pointId: "sketch_point_seed",
        position: [0, 0],
      },
      {
        constraintId: "constraint_on_seed",
        kind: "pointOnCurve",
        label: "On seed",
        point: { kind: "localPoint", pointId: onSeed },
        curve: { kind: "localEntity", entityId: "sketch_entity_seed" },
      },
    ] as unknown as SketchDefinition["constraints"],
  };
  const program = compileSketchSolveProgram({
    definition,
    tolerances: OFFSET_ROW_TOLERANCES,
    modelingTolerance: 1e-3,
    partialSolvePolicy: "bestEffort",
  });
  const session = createCompiledSketchSolveSession({
    sessionId: "interactive_sketch_solve_g7b_drag",
    program,
  });
  const drag = (position: readonly [number, number]) =>
    updateCompiledSketchSolveSession(session, {
      kind: "sketchPoint",
      pointId: onSeed,
      position,
    });
  return { session, drag };
}

export const blockedDiagnostics = (snapshot: SolvedSketchSnapshotForTest) =>
  snapshot.diagnostics.filter(
    (diagnostic) => diagnostic.code === "derived-offset-requirement-blocked",
  );

/**
 * The circle offset collapsed at the start (seed radius 0.5) plus one
 * derived dependent of its output circle: a mirror across a fixed
 * construction axis, or a linear pattern instance; a radius dimension of 3
 * on the dependent.
 */
export function collapsedOffsetWithDependent(
  kind: "mirror" | "linearPattern",
): SketchDefinition {
  const base = circleOffsetDefinition({
    authoredSeedRadius: 0.5,
    seedRadius: 0.5,
  });
  const point = (id: string, position: readonly [number, number]) =>
    ({
      pointId: `sketch_point_${id}`,
      label: id,
      target: {
        kind: "sketchPoint",
        sketchId: "sketch_primary",
        pointId: `sketch_point_${id}`,
      },
      position,
      isConstruction: false,
    }) as SketchDefinition["points"][number];
  const points = [
    point("dependent", [10, 0]),
    point("axis_a", [5, -1]),
    point("axis_b", [5, 1]),
  ];
  const entities = [
    {
      kind: "circle",
      entityId: "sketch_entity_dependent",
      label: "dependent",
      target: {
        kind: "sketchEntity",
        sketchId: "sketch_primary",
        entityId: "sketch_entity_dependent",
      },
      isConstruction: false,
      centerPointId: "sketch_point_dependent",
      radius: 1,
    },
    {
      kind: "lineSegment",
      entityId: "sketch_entity_axis",
      label: "axis",
      target: {
        kind: "sketchEntity",
        sketchId: "sketch_primary",
        entityId: "sketch_entity_axis",
      },
      isConstruction: true,
      startPointId: "sketch_point_axis_a",
      endPointId: "sketch_point_axis_b",
    },
  ] as unknown as SketchDefinition["entities"];
  const output = {
    seedEntityId: "sketch_entity_output",
    outputEntityId: "sketch_entity_dependent",
    instanceIndex: 1,
    seedPointIds: ["sketch_point_output"],
    outputPointIds: ["sketch_point_dependent"],
  };
  const dependent = (kind === "mirror"
    ? {
        derivationId: "derivation_dependent",
        kind: "mirror",
        label: "Mirror",
        seedEntityIds: ["sketch_entity_output"],
        mirrorReference: {
          kind: "lineEntity",
          entityId: "sketch_entity_axis",
        },
        outputs: [output],
      }
    : {
        derivationId: "derivation_dependent",
        kind: "linearPattern",
        label: "Pattern",
        seedEntityIds: ["sketch_entity_output"],
        vector: [10, 0],
        instanceCount: 2,
        outputs: [output],
      }) as unknown as NonNullable<
    SketchDefinition["derivedRelationships"]
  >[number];
  return {
    ...base,
    pointIds: [...base.pointIds, ...points.map((item) => item.pointId)],
    points: [...base.points, ...points],
    entityIds: [...base.entityIds, ...entities.map((item) => item.entityId)],
    entities: [...base.entities, ...entities],
    constraintIds: ["constraint_fix_axis_a", "constraint_fix_axis_b"].map(
      (id) => id as ConstraintId,
    ),
    constraints: (["a", "b"] as const).map((end, index) => ({
      constraintId: `constraint_fix_axis_${end}`,
      kind: "fixPoint",
      label: `Fix axis ${end}`,
      pointId: `sketch_point_axis_${end}`,
      position: [5, index === 0 ? -1 : 1],
    })) as unknown as SketchDefinition["constraints"],
    dimensionIds: [
      ...base.dimensionIds,
      "dimension_dependent_radius" as DimensionId,
    ],
    dimensions: [
      ...base.dimensions,
      {
        dimensionId: "dimension_dependent_radius" as DimensionId,
        kind: "circleRadius",
        label: "Dependent radius",
        entityId: "sketch_entity_dependent",
        value: 3,
      },
    ],
    derivedRelationships: [...base.derivedRelationships!, dependent],
  };
}

/**
 * A line offset whose seed line is deleted (unsupported seed at the start)
 * and whose output line is the axis of a mirror of a free circle; a fixPoint
 * on the mirrored circle's centre. `withSeed` keeps the seed line (control).
 */
export function failedOffsetLineAsMirrorAxis(withSeed: boolean): SketchDefinition {
  const point = (id: string, position: readonly [number, number]) =>
    ({
      pointId: `sketch_point_${id}`,
      label: id,
      target: {
        kind: "sketchPoint",
        sketchId: "sketch_primary",
        pointId: `sketch_point_${id}`,
      },
      position,
      isConstruction: false,
    }) as SketchDefinition["points"][number];
  const target = (id: string) => ({
    kind: "sketchEntity",
    sketchId: "sketch_primary",
    entityId: `sketch_entity_${id}`,
  });
  const points = [
    point("seed_a", [5, -1]),
    point("seed_b", [5, 1]),
    point("axis_a", [4, -1]),
    point("axis_b", [4, 1]),
    point("free", [0, 0]),
    point("mirrored", [8, 0]),
  ];
  const line = (id: string, start: string, end: string) => ({
    kind: "lineSegment",
    entityId: `sketch_entity_${id}`,
    label: id,
    target: target(id),
    isConstruction: false,
    startPointId: `sketch_point_${start}`,
    endPointId: `sketch_point_${end}`,
  });
  const circle = (id: string) => ({
    kind: "circle",
    entityId: `sketch_entity_${id}`,
    label: id,
    target: target(id),
    isConstruction: false,
    centerPointId: `sketch_point_${id}`,
    radius: 0.5,
  });
  const entities = [
    ...(withSeed ? [line("seed", "seed_a", "seed_b")] : []),
    line("axis", "axis_a", "axis_b"),
    circle("free"),
    circle("mirrored"),
  ] as unknown as SketchDefinition["entities"];
  return {
    schemaVersion: "sketch-definition/v1alpha2",
    referenceIds: [],
    references: [],
    pointIds: points.map((item) => item.pointId),
    points,
    entityIds: entities.map((item) => item.entityId),
    entities,
    constraintIds: ["constraint_fix_mirrored" as ConstraintId],
    constraints: [
      {
        constraintId: "constraint_fix_mirrored",
        kind: "fixPoint",
        label: "Fix mirrored centre",
        pointId: "sketch_point_mirrored",
        position: [8, 0],
      },
    ] as unknown as SketchDefinition["constraints"],
    dimensionIds: [],
    dimensions: [],
    derivedRelationships: [
      {
        derivationId: "derivation_offset_line",
        kind: "offset",
        label: "Line offset",
        seedEntityIds: ["sketch_entity_seed"],
        distance: 1,
        jointPolicy: "trimExtendArcFallback",
        piecewiseCubicOutputs: [],
        jointOutputs: [],
        outputs: [
          {
            seedEntityId: "sketch_entity_seed",
            outputEntityId: "sketch_entity_axis",
            instanceIndex: 1,
            seedPointIds: ["sketch_point_seed_a", "sketch_point_seed_b"],
            outputPointIds: ["sketch_point_axis_a", "sketch_point_axis_b"],
          },
        ],
      },
      {
        derivationId: "derivation_mirror",
        kind: "mirror",
        label: "Mirror",
        seedEntityIds: ["sketch_entity_free"],
        mirrorReference: { kind: "lineEntity", entityId: "sketch_entity_axis" },
        outputs: [
          {
            seedEntityId: "sketch_entity_free",
            outputEntityId: "sketch_entity_mirrored",
            instanceIndex: 1,
            seedPointIds: ["sketch_point_free"],
            outputPointIds: ["sketch_point_mirrored"],
          },
        ],
      },
    ],
  } as unknown as SketchDefinition;
}

/**
 * A sketch of circles (each centred on its own point at the origin unless
 * placed), extra points, constraints, dimensions and inward circle offsets
 * of distance 1 (`[derivationId, seed, output]` by short id).
 */
export function circleOffsetSketch(parts: {
  circles: readonly (readonly [string, number])[];
  points?: readonly (readonly [string, readonly [number, number]])[];
  constraints?: readonly Record<string, unknown>[];
  dimensions?: readonly (readonly [
    string,
    "circleRadius" | "diameter",
    number,
  ])[];
  offsets: readonly (readonly [string, string, string])[];
  extra?: Pick<
    SketchDefinition,
    "points" | "entities" | "derivedRelationships"
  >;
}): SketchDefinition {
  const point = (id: string, position: readonly [number, number]) => ({
    pointId: `sketch_point_${id}`,
    label: id,
    target: {
      kind: "sketchPoint",
      sketchId: "sketch_primary",
      pointId: `sketch_point_${id}`,
    },
    position,
    isConstruction: false,
  });
  const points = [
    ...parts.circles.map(([id]) => point(id, [0, 0])),
    ...(parts.points ?? []).map(([id, position]) => point(id, position)),
    ...(parts.extra?.points ?? []),
  ];
  const entities = [
    ...parts.circles.map(([id, radius]) => ({
      kind: "circle",
      entityId: `sketch_entity_${id}`,
      label: id,
      target: {
        kind: "sketchEntity",
        sketchId: "sketch_primary",
        entityId: `sketch_entity_${id}`,
      },
      isConstruction: false,
      centerPointId: `sketch_point_${id}`,
      radius,
    })),
    ...(parts.extra?.entities ?? []),
  ];
  const constraints = parts.constraints ?? [];
  const dimensions = (parts.dimensions ?? []).map(([id, kind, value]) => ({
    dimensionId: `dimension_${id}`,
    kind,
    label: id,
    entityId: `sketch_entity_${id}`,
    value,
  }));
  return {
    schemaVersion: "sketch-definition/v1alpha2",
    referenceIds: [],
    references: [],
    pointIds: points.map((item) => item.pointId),
    points,
    entityIds: entities.map((item) => item.entityId),
    entities,
    constraintIds: constraints.map((item) => item.constraintId),
    constraints,
    dimensionIds: dimensions.map((item) => item.dimensionId),
    dimensions,
    derivedRelationships: [
      ...parts.offsets.map(([derivationId, seed, output]) => ({
        derivationId,
        kind: "offset",
        label: derivationId,
        seedEntityIds: [`sketch_entity_${seed}`],
        distance: 1,
        jointPolicy: "trimExtendArcFallback",
        piecewiseCubicOutputs: [],
        jointOutputs: [],
        outputs: [
          {
            seedEntityId: `sketch_entity_${seed}`,
            outputEntityId: `sketch_entity_${output}`,
            instanceIndex: 1,
            seedPointIds: [`sketch_point_${seed}`],
            outputPointIds: [`sketch_point_${output}`],
          },
        ],
      })),
      ...(parts.extra?.derivedRelationships ?? []),
    ],
  } as unknown as SketchDefinition;
}

export const fixPointConstraint = (
  id: string,
  pointId: string,
  position: readonly [number, number],
) => ({
  constraintId: `constraint_${id}`,
  kind: "fixPoint",
  label: id,
  pointId: `sketch_point_${pointId}`,
  position,
});

export const pointOnCircleConstraint = (
  id: string,
  pointId: string,
  circle: string,
) => ({
  constraintId: `constraint_${id}`,
  kind: "pointOnCurve",
  label: id,
  point: { kind: "localPoint", pointId: `sketch_point_${pointId}` },
  curve: { kind: "localEntity", entityId: `sketch_entity_${circle}` },
});

export const offsetFailureIds = (definition: SketchDefinition) =>
  evaluateSketchDerivations({
    definition,
    modelingTolerance: 1e-3,
  }).offsetFailures.map((failure) => [
    failure.derivationId,
    failure.diagnostic.code,
  ]);

export const constraintStatusOf = (
  snapshot: SolvedSketchSnapshotForTest,
  constraintId: string,
) =>
  snapshot.constraintStatuses.find(
    (status) => status.constraintId === constraintId,
  )?.status;

export const pointOf = (snapshot: SolvedSketchSnapshotForTest, pointId: string) =>
  snapshot.solvedPoints.find((point) => point.pointId === pointId)
    ?.solvedPosition;

export const planIds = (snapshot: SolvedSketchSnapshotForTest) =>
  snapshot.offsetFramePlans?.map((plan) => plan.derivationId);
