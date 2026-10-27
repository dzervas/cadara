import { compileSketchSolveProgram } from "./compile-program";
import { solveSketchDefinitionCore } from "./solve-sketch";
import {
  assertGradientMatchesFiniteDifference,
  makeArc,
  makeCircle,
  makeLine,
  makePoint,
  tolerances,
} from "./solver-basic.fixtures";
import { createCompiledSketchSolveSession } from "./start-session";
import { updateCompiledSketchSolveSession } from "./update-session";
import { evaluateSketchDerivations } from "@/contracts/sketch/derived-geometry";
import { OFFSET_DIAGNOSTIC_CODES } from "@/contracts/sketch/offset-geometry";
import { publishSketchOffsets } from "@/contracts/sketch/offset-publication";
import type { NumericSketchDefinition as SketchDefinition } from "@/contracts/sketch/schema";
import { createCertifiedCubicTubeChain } from "@/core/modeling/neutral-curve-certification/cubic-tube-chain";
import { createCertifiedNeutralCurveRequestQuery } from "@/core/modeling/neutral-curve-certification/query";
import { expect } from "vitest";

export async function testOffsetOutputRequirementDrivesSourceAuthority() {
    const points = [
      makePoint("sketch_point_offset_a", "A", 0, 0),
      makePoint("sketch_point_offset_b", "B", 4, 0),
      makePoint("sketch_point_offset_c", "C", 4, 4),
      makePoint("sketch_point_offset_o1s", "O1S", 0, 0),
      makePoint("sketch_point_offset_o1e", "O1E", 0, 0),
      makePoint("sketch_point_offset_o2s", "O2S", 0, 0),
      makePoint("sketch_point_offset_o2e", "O2E", 0, 0),
      makePoint("sketch_point_offset_joint", "Joint center", 0, 0),
    ];
    const entities = [
      makeLine(
        "sketch_entity_offset_ab",
        "AB",
        points[0]!.pointId,
        points[1]!.pointId,
      ),
      makeLine(
        "sketch_entity_offset_bc",
        "BC",
        points[1]!.pointId,
        points[2]!.pointId,
      ),
      makeLine(
        "sketch_entity_offset_o1",
        "O1",
        points[3]!.pointId,
        points[4]!.pointId,
      ),
      makeLine(
        "sketch_entity_offset_o2",
        "O2",
        points[5]!.pointId,
        points[6]!.pointId,
      ),
      makeArc(
        "sketch_entity_offset_joint",
        "Joint",
        points[7]!.pointId,
        points[4]!.pointId,
        points[5]!.pointId,
      ),
    ];
    const constraint = {
      constraintId: "constraint_fix_offset_output" as const,
      kind: "fixPoint" as const,
      label: "Near offset output",
      pointId: points[3]!.pointId,
      position: [0, -1.00001] as const,
    };
    const jointConstraint = {
      constraintId: "constraint_fix_offset_joint" as const,
      kind: "fixPoint" as const,
      label: "Drive committed joint center",
      pointId: points[7]!.pointId,
      position: [5, 0] as const,
    };
    const unrelatedSourceConstraint = {
      constraintId: "constraint_move_offset_source" as const,
      kind: "fixPoint" as const,
      label: "Move unrelated source coordinate",
      pointId: points[1]!.pointId,
      position: [5, 0] as const,
    };
    const definition: SketchDefinition = {
      schemaVersion: "sketch-definition/v1alpha2",
      referenceIds: [],
      references: [],
      pointIds: points.map((point) => point.pointId),
      points,
      entityIds: entities.map((entity) => entity.entityId),
      entities,
      constraintIds: [
        constraint.constraintId,
        jointConstraint.constraintId,
        unrelatedSourceConstraint.constraintId,
      ],
      constraints: [constraint, jointConstraint, unrelatedSourceConstraint],
      dimensionIds: [],
      dimensions: [],
      derivedRelationshipIds: ["derivation_offset"],
      derivedRelationships: [
        {
          derivationId: "derivation_offset",
          kind: "offset",
          label: "Offset",
          seedEntityIds: [entities[0]!.entityId, entities[1]!.entityId],
          distance: -1,
          jointPolicy: "trimExtendArcFallback",
          piecewiseCubicOutputs: [],
          jointOutputs: [
            {
              firstSeedEntityId: entities[0]!.entityId,
              secondSeedEntityId: entities[1]!.entityId,
              outputEntityId: entities[4]!.entityId,
              centerPointId: points[7]!.pointId,
              startPointId: points[4]!.pointId,
              endPointId: points[5]!.pointId,
            },
          ],
          outputs: [
            {
              seedEntityId: entities[0]!.entityId,
              outputEntityId: entities[2]!.entityId,
              instanceIndex: 1,
              seedPointIds: [points[0]!.pointId, points[1]!.pointId],
              outputPointIds: [points[3]!.pointId, points[4]!.pointId],
            },
            {
              seedEntityId: entities[1]!.entityId,
              outputEntityId: entities[3]!.entityId,
              instanceIndex: 1,
              seedPointIds: [points[1]!.pointId, points[2]!.pointId],
              outputPointIds: [points[5]!.pointId, points[6]!.pointId],
            },
          ],
        },
      ],
    };
    assertGradientMatchesFiniteDifference(
      definition,
      constraint.constraintId,
      1e-5,
    );
    const result = solveSketchDefinitionCore({
      definition,
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "failOnConflict",
    });
    expect(result.status.solveState).toBe("solved");
    expect(result.solvedSnapshot.constraintStatuses).toContainEqual({
      constraintId: constraint.constraintId,
      status: "satisfied",
    });
    expect(result.solvedSnapshot.constraintStatuses).toContainEqual({
      constraintId: jointConstraint.constraintId,
      status: "satisfied",
    });
    expect(result.solvedSnapshot.constraintStatuses).toContainEqual({
      constraintId: unrelatedSourceConstraint.constraintId,
      status: "satisfied",
    });
    const solvedPositions = new Map(
      result.solvedSnapshot.solvedPoints.map((point) => [
        point.pointId,
        point.solvedPosition,
      ]),
    );
    expect(solvedPositions.get(points[1]!.pointId)![0]).toBeCloseTo(5, 6);
    expect(solvedPositions.get(points[1]!.pointId)![1]).toBeCloseTo(0, 6);
    expect(
      Math.abs(solvedPositions.get(points[0]!.pointId)![1]) > 1e-7,
      "The offset-output requirement should move seed authority rather than an output slot.",
    ).toBeTruthy();
    const freshlyDerived = evaluateSketchDerivations({
      definition: {
        ...definition,
        points: definition.points.map((point) => ({
          ...point,
          position: solvedPositions.get(point.pointId) ?? point.position,
        })),
      },
      modelingTolerance: 1e-3,
    }).definition;
    const freshOutput = freshlyDerived.points.find(
      (point) => point.pointId === points[3]!.pointId,
    )!.position;
    expect(solvedPositions.get(points[3]!.pointId)![0]).toBeCloseTo(
      freshOutput[0],
      8,
    );
    expect(solvedPositions.get(points[3]!.pointId)![1]).toBeCloseTo(
      freshOutput[1],
      8,
    );

    const anchorConstraints = (
      bPosition: readonly [number, number],
    ): SketchDefinition["constraints"] => [
      {
        constraintId: "constraint_offset_topology_a",
        kind: "fixPoint",
        label: "Anchor A",
        pointId: points[0]!.pointId,
        position: [0, 0],
      },
      {
        constraintId: "constraint_offset_topology_b",
        kind: "fixPoint",
        label: "Force topology frame",
        pointId: points[1]!.pointId,
        position: bPosition,
      },
      {
        constraintId: "constraint_offset_topology_c",
        kind: "fixPoint",
        label: "Anchor C",
        pointId: points[2]!.pointId,
        position: [4, 4],
      },
    ];
    const definitionWithAnchors = (
      bPosition: readonly [number, number],
    ): SketchDefinition => {
      const constraints = anchorConstraints(bPosition);
      return {
        ...definition,
        constraintIds: constraints.map((candidate) => candidate.constraintId),
        constraints,
      };
    };
    const accepted = solveSketchDefinitionCore({
      definition: definitionWithAnchors([4, 0]),
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "failOnConflict",
    });
    const topologyProgram = compileSketchSolveProgram({
      definition: definitionWithAnchors([4, 5]),
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "failOnConflict",
    });
    const topologySession = createCompiledSketchSolveSession({
      sessionId: "interactive_offset_topology_change",
      program: topologyProgram,
      priorSolvedSnapshot: accepted.solvedSnapshot,
    });
    const dragged = updateCompiledSketchSolveSession(topologySession, {
      kind: "sketchPoint",
      pointId: points[1]!.pointId,
      position: [4, 5],
    });
    // [TECH] G16′ (U-G9, U-A): the offset's failure is relationship-scoped.
    // The rest of the sketch follows the drag (every requirement here is on
    // a seed), and the offset's outputs are held at the last accepted
    // positions (the prior solved snapshot).
    expect(dragged.kind).toBe("solved");
    if (dragged.kind !== "solved") throw new Error("not solved");
    expect(dragged.solvedSnapshot.status).toEqual({
      solveState: "solved",
      constraintState: "wellConstrained",
    });
    const draggedPositions = new Map(
      dragged.solvedSnapshot.solvedPoints.map((point) => [
        point.pointId,
        point.solvedPosition,
      ]),
    );
    const priorPositions = new Map(
      accepted.solvedSnapshot.solvedPoints.map((point) => [
        point.pointId,
        point.solvedPosition,
      ]),
    );
    expect(draggedPositions.get(points[1]!.pointId)![1]).toBeCloseTo(5, 6);
    for (const output of [3, 4, 5, 6, 7])
      expect(
        draggedPositions.get(points[output]!.pointId),
        `output point ${points[output]!.pointId} is frozen at its prior solved position`,
      ).toEqual(priorPositions.get(points[output]!.pointId));
    expect(
      dragged.solvedSnapshot.offsetFramePlans,
      "the failed relationship ran no plan",
    ).toEqual([]);
    expect(
      dragged.solvedSnapshot.diagnostics,
      "an accepted solve never carries the relationship's failure (G16)",
    ).toEqual([]);
    const publications = publishSketchOffsets({
      definition: definitionWithAnchors([4, 5]),
      solvedSnapshot: dragged.solvedSnapshot,
      modelingTolerance: 1e-3,
      capabilities: {
        query: createCertifiedNeutralCurveRequestQuery(),
        certifier: createCertifiedCubicTubeChain(),
      },
    });
    expect(
      publications.map((publication) => [
        publication.derivationId,
        publication.status,
        publication.diagnostic?.code,
        publication.diagnostic?.severity,
        publication.diagnostic?.target?.kind,
      ]),
      // T08b-g5 ([TECH] G6): arc presence is authored intent, so a corner
      // that can no longer hold its authored arc is `topologyChanged`.
      "The publication round reports the relationship's one targeted topologyChanged.",
    ).toEqual([
      [
        "derivation_offset",
        "failed",
        OFFSET_DIAGNOSTIC_CODES.topologyChanged,
        "error",
        "entity",
      ],
    ]);
  }

export async function testOffsetCircleScalarAuthorityMovesTheSource() {
    const points = [
      makePoint("sketch_point_offset_circle_seed", "Seed center", 0, 0),
      makePoint("sketch_point_offset_circle_output", "Output center", 0, 0),
    ];
    const entities = [
      makeCircle(
        "sketch_entity_offset_circle_seed",
        "Seed circle",
        points[0]!.pointId,
        2,
      ),
      makeCircle(
        "sketch_entity_offset_circle_output",
        "Offset circle",
        points[1]!.pointId,
        1,
      ),
    ];
    const definition: SketchDefinition = {
      schemaVersion: "sketch-definition/v1alpha2",
      referenceIds: [],
      references: [],
      pointIds: points.map((point) => point.pointId),
      points,
      entityIds: entities.map((entity) => entity.entityId),
      entities,
      constraintIds: [],
      constraints: [],
      dimensionIds: ["dimension_offset_circle_radius"],
      dimensions: [
        {
          dimensionId: "dimension_offset_circle_radius",
          kind: "circleRadius",
          label: "Derived radius",
          entityId: entities[1]!.entityId,
          value: 1.2,
        },
      ],
      derivedRelationshipIds: ["derivation_offset_circle"],
      derivedRelationships: [
        {
          derivationId: "derivation_offset_circle",
          kind: "offset",
          label: "Circle offset",
          seedEntityIds: [entities[0]!.entityId],
          distance: 1,
          jointPolicy: "trimExtendArcFallback",
          piecewiseCubicOutputs: [],
          jointOutputs: [],
          outputs: [
            {
              seedEntityId: entities[0]!.entityId,
              outputEntityId: entities[1]!.entityId,
              instanceIndex: 1,
              seedPointIds: [points[0]!.pointId],
              outputPointIds: [points[1]!.pointId],
            },
          ],
        },
      ],
    };

    const program = compileSketchSolveProgram({
      definition,
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "failOnConflict",
    });
    const seedState = program.system.entityStates.get(entities[0]!.entityId)!;
    const outputState = program.system.entityStates.get(entities[1]!.entityId)!;
    expect(seedState.kind).toBe("circle");
    expect(outputState.kind).toBe("circle");
    expect(
      program.system.parameterProjection.authorityVariableIndices,
    ).toContain(seedState.baseIndex);
    expect(
      program.system.parameterProjection.authorityVariableIndices,
      "A derived output radius must not remain an independent solver variable.",
    ).not.toContain(outputState.baseIndex);
    assertGradientMatchesFiniteDifference(
      definition,
      "dimension_offset_circle_radius",
      1e-5,
    );

    const solved = solveSketchDefinitionCore({
      definition,
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "failOnConflict",
    });
    expect(solved.status.solveState).toBe("solved");
    expect(solved.solvedSnapshot.dimensionStatuses[0]?.status).toBe("driving");
    expect(solved.solvedSnapshot.dimensionStatuses[0]?.solvedValue).toBeCloseTo(
      1.2,
      10,
    );
    const solvedCircles = new Map(
      solved.solvedSnapshot.solvedEntities
        .filter((entity) => entity.kind === "circle")
        .map((entity) => [entity.entityId, entity] as const),
    );
    const solvedSeed = solvedCircles.get(entities[0]!.entityId)!;
    const solvedOutput = solvedCircles.get(entities[1]!.entityId)!;
    expect(solvedSeed.solvedRadius).toBeCloseTo(2.2, 6);
    expect(solvedOutput.solvedRadius).toBeCloseTo(1.2, 8);
    expect(solvedSeed.solvedRadius).not.toBeCloseTo(2, 6);

    const fresh = evaluateSketchDerivations({
      definition: {
        ...definition,
        entities: definition.entities.map((entity) =>
          entity.entityId === solvedSeed.entityId && entity.kind === "circle"
            ? { ...entity, radius: solvedSeed.solvedRadius }
            : entity,
        ),
      },
      modelingTolerance: 1e-3,
    }).definition;
    const freshOutput = fresh.entities.find(
      (entity) => entity.entityId === solvedOutput.entityId,
    );
    expect(freshOutput?.kind).toBe("circle");
    if (freshOutput?.kind === "circle") {
      expect(solvedOutput.solvedRadius).toBeCloseTo(freshOutput.radius, 10);
    }
  }

export async function testOffsetArcScalarStateFollowsDefiningPoints() {
    const points = [
      makePoint("sketch_point_offset_arc_c", "Seed center", 0, 0),
      makePoint("sketch_point_offset_arc_s", "Seed start", 2, 0),
      makePoint("sketch_point_offset_arc_e", "Seed end", 0, 2),
      makePoint("sketch_point_offset_arc_oc", "Output center", 0, 0),
      makePoint("sketch_point_offset_arc_os", "Output start", 1, 0),
      makePoint("sketch_point_offset_arc_oe", "Output end", 0, 1),
    ];
    const entities = [
      makeArc(
        "sketch_entity_offset_arc_seed",
        "Seed arc",
        points[0]!.pointId,
        points[1]!.pointId,
        points[2]!.pointId,
      ),
      makeArc(
        "sketch_entity_offset_arc_output",
        "Output arc",
        points[3]!.pointId,
        points[4]!.pointId,
        points[5]!.pointId,
      ),
    ];
    const definition: SketchDefinition = {
      schemaVersion: "sketch-definition/v1alpha2",
      referenceIds: [],
      references: [],
      pointIds: points.map((point) => point.pointId),
      points,
      entityIds: entities.map((entity) => entity.entityId),
      entities,
      constraintIds: [],
      constraints: [],
      dimensionIds: ["dimension_offset_arc_diameter"],
      dimensions: [
        {
          dimensionId: "dimension_offset_arc_diameter",
          kind: "diameter",
          label: "Derived arc diameter",
          entityId: entities[1]!.entityId,
          value: 2.4,
        },
      ],
      derivedRelationshipIds: ["derivation_offset_arc"],
      derivedRelationships: [
        {
          derivationId: "derivation_offset_arc",
          kind: "offset",
          label: "Arc offset",
          seedEntityIds: [entities[0]!.entityId],
          distance: 1,
          jointPolicy: "trimExtendArcFallback",
          piecewiseCubicOutputs: [],
          jointOutputs: [],
          outputs: [
            {
              seedEntityId: entities[0]!.entityId,
              outputEntityId: entities[1]!.entityId,
              instanceIndex: 1,
              seedPointIds: points.slice(0, 3).map((point) => point.pointId),
              outputPointIds: points.slice(3).map((point) => point.pointId),
            },
          ],
        },
      ],
    };
    const program = compileSketchSolveProgram({
      definition,
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "failOnConflict",
    });
    const seedState = program.system.entityStates.get(entities[0]!.entityId)!;
    const outputState = program.system.entityStates.get(entities[1]!.entityId)!;
    expect(seedState.kind).toBe("arc");
    expect(outputState.kind).toBe("arc");
    if (seedState.kind !== "arc" || outputState.kind !== "arc") return;
    for (const scalarIndex of [
      seedState.baseIndex,
      seedState.baseIndex + 1,
      seedState.baseIndex + 2,
      outputState.baseIndex,
      outputState.baseIndex + 1,
      outputState.baseIndex + 2,
    ]) {
      expect(
        program.system.parameterProjection.authorityVariableIndices,
        "Offset source/output arc scalars must follow their authoritative defining points.",
      ).not.toContain(scalarIndex);
    }
    const commonRadiusValues = new Float64Array(program.system.initialValues);
    const seedEndRecord = program.system.pointRecords.get(points[2]!.pointId)!;
    commonRadiusValues[seedEndRecord.baseIndex] += 0.2;
    assertGradientMatchesFiniteDifference(
      definition,
      `constraint_internal_arc_common_radius_${entities[0]!.entityId}`,
      1e-5,
      1e-6,
      commonRadiusValues,
    );
    assertGradientMatchesFiniteDifference(
      definition,
      "dimension_offset_arc_diameter",
      1e-5,
    );
    const sourceDimensionDefinition: SketchDefinition = {
      ...definition,
      dimensionIds: ["dimension_offset_arc_source_diameter"],
      dimensions: [
        {
          ...definition.dimensions[0]!,
          dimensionId: "dimension_offset_arc_source_diameter",
          label: "Source arc diameter",
          entityId: entities[0]!.entityId,
          value: 4.4,
        },
      ],
    };
    assertGradientMatchesFiniteDifference(
      sourceDimensionDefinition,
      "dimension_offset_arc_source_diameter",
      1e-5,
    );
    const solved = solveSketchDefinitionCore({
      definition,
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "failOnConflict",
    });
    expect(solved.status.solveState).toBe("solved");
    const dimensionStatus = solved.solvedSnapshot.dimensionStatuses[0];
    expect(dimensionStatus?.status).toBe("driving");
    expect(dimensionStatus?.solvedValue).toBeCloseTo(2.4, 6);
    const seed = solved.solvedSnapshot.solvedEntities.find(
      (entity) => entity.entityId === entities[0]!.entityId,
    );
    const output = solved.solvedSnapshot.solvedEntities.find(
      (entity) => entity.entityId === entities[1]!.entityId,
    );
    expect(seed?.kind).toBe("arc");
    expect(output?.kind).toBe("arc");
    if (seed?.kind !== "arc" || output?.kind !== "arc") return;
    const solvedPoints = new Map(
      solved.solvedSnapshot.solvedPoints.map((point) => [
        point.pointId,
        point.solvedPosition,
      ]),
    );
    const seedCenter = solvedPoints.get(points[0]!.pointId)!;
    const seedStart = solvedPoints.get(points[1]!.pointId)!;
    const seedEnd = solvedPoints.get(points[2]!.pointId)!;
    const center = solvedPoints.get(points[3]!.pointId)!;
    const start = solvedPoints.get(points[4]!.pointId)!;
    const end = solvedPoints.get(points[5]!.pointId)!;
    expect(
      Math.hypot(
        seedStart[0] - points[1]!.position[0],
        seedStart[1] - points[1]!.position[1],
      ),
      "The output diameter must move source defining points rather than private output state.",
    ).toBeGreaterThan(0.09);
    const seedStartRadius = Math.hypot(
      seedStart[0] - seedCenter[0],
      seedStart[1] - seedCenter[1],
    );
    const seedEndRadius = Math.hypot(
      seedEnd[0] - seedCenter[0],
      seedEnd[1] - seedCenter[1],
    );
    expect(Math.abs(seedStartRadius - 2.2)).toBeLessThan(
      tolerances.coincidence,
    );
    expect(Math.abs(seedEndRadius - 2.2)).toBeLessThan(tolerances.coincidence);
    expect(Math.abs(seedEndRadius - seedStartRadius)).toBeLessThan(
      tolerances.coincidence,
    );
    expect(seed.centerPosition[0]).toBeCloseTo(seedCenter[0], 10);
    expect(seed.centerPosition[1]).toBeCloseTo(seedCenter[1], 10);
    expect(seed.startPosition[0]).toBeCloseTo(seedStart[0], 10);
    expect(seed.startPosition[1]).toBeCloseTo(seedStart[1], 10);
    expect(seed.endPosition[0]).toBeCloseTo(seedEnd[0], 10);
    expect(seed.endPosition[1]).toBeCloseTo(seedEnd[1], 10);
    expect(output.centerPosition[0]).toBeCloseTo(center[0], 10);
    expect(output.centerPosition[1]).toBeCloseTo(center[1], 10);
    expect(output.startPosition[0]).toBeCloseTo(start[0], 10);
    expect(output.startPosition[1]).toBeCloseTo(start[1], 10);
    expect(output.endPosition[0]).toBeCloseTo(end[0], 10);
    expect(output.endPosition[1]).toBeCloseTo(end[1], 10);
    expect(
      Math.hypot(
        output.startPosition[0] - output.centerPosition[0],
        output.startPosition[1] - output.centerPosition[1],
      ),
    ).toBeCloseTo(Math.hypot(start[0] - center[0], start[1] - center[1]), 10);
    expect(
      Math.atan2(
        output.startPosition[1] - output.centerPosition[1],
        output.startPosition[0] - output.centerPosition[0],
      ),
    ).toBeCloseTo(Math.atan2(start[1] - center[1], start[0] - center[0]), 10);
    expect(
      Math.atan2(
        output.endPosition[1] - output.centerPosition[1],
        output.endPosition[0] - output.centerPosition[0],
      ),
    ).toBeCloseTo(Math.atan2(end[1] - center[1], end[0] - center[0]), 10);

    const fresh = evaluateSketchDerivations({
      definition: {
        ...definition,
        points: definition.points.map((point) => ({
          ...point,
          position: solvedPoints.get(point.pointId) ?? point.position,
        })),
      },
      modelingTolerance: 1e-3,
    }).definition;
    for (const pointId of [
      points[3]!.pointId,
      points[4]!.pointId,
      points[5]!.pointId,
    ]) {
      const solvedPosition = solvedPoints.get(pointId)!;
      const freshPosition = fresh.points.find(
        (point) => point.pointId === pointId,
      )!.position;
      expect(solvedPosition[0]).toBeCloseTo(freshPosition[0], 10);
      expect(solvedPosition[1]).toBeCloseTo(freshPosition[1], 10);
    }
    const outputStartRadius = Math.hypot(
      start[0] - center[0],
      start[1] - center[1],
    );
    const outputEndRadius = Math.hypot(end[0] - center[0], end[1] - center[1]);
    expect(Math.abs(outputStartRadius - 1.2)).toBeLessThan(
      tolerances.coincidence,
    );
    expect(Math.abs(outputEndRadius - outputStartRadius)).toBeLessThan(
      tolerances.coincidence,
    );

    const radialGap = 1e-5;
    const mismatchedDefinition: SketchDefinition = {
      ...definition,
      points: definition.points.map((point) =>
        point.pointId === points[2]!.pointId
          ? { ...point, position: [0, 2 + radialGap] }
          : point,
      ),
      dimensionIds: [],
      dimensions: [],
    };
    const mismatched = solveSketchDefinitionCore({
      definition: mismatchedDefinition,
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "failOnConflict",
      strategy: "gaussNewton",
    });
    expect(0.5 * radialGap * radialGap).toBeLessThan(1e-8);
    expect(radialGap).toBeGreaterThan(tolerances.coincidence);
    expect(mismatched.status.solveState).toBe("failed");
    expect(mismatched.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "offset-arc-common-circle-unsatisfied",
        severity: "error",
        target: { kind: "entity", entityId: entities[0]!.entityId },
      }),
    );
    expect(
      () =>
        createCompiledSketchSolveSession({
          sessionId: "interactive_sketch_solve_offset_arc_invalid_initial",
          program: compileSketchSolveProgram({
            definition: mismatchedDefinition,
            tolerances,
            modelingTolerance: 1e-3,
            partialSolvePolicy: "failOnConflict",
            strategy: "gaussNewton",
          }),
        }),
      "An invalid initial common-circle snapshot must not become lastAcceptedSnapshot.",
    ).toThrow(/common-circle snapshot.*radial gap/);

    const dragProgram = compileSketchSolveProgram({
      definition,
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "failOnConflict",
      strategy: "gaussNewton",
    });
    const dragSession = createCompiledSketchSolveSession({
      sessionId: "interactive_sketch_solve_offset_arc_radial_gap",
      program: dragProgram,
      priorSolvedSnapshot: solved.solvedSnapshot,
    });
    const acceptedBeforeDrag = dragSession.lastAcceptedSnapshot;
    const dragEndRecord = dragProgram.system.pointRecords.get(
      points[2]!.pointId,
    )!;
    const acceptedEnd = acceptedBeforeDrag.solvedPoints.find(
      (point) => point.pointId === points[2]!.pointId,
    )!.solvedPosition;
    const acceptedCenter = acceptedBeforeDrag.solvedPoints.find(
      (point) => point.pointId === points[0]!.pointId,
    )!.solvedPosition;
    const acceptedRadius = Math.hypot(
      acceptedEnd[0] - acceptedCenter[0],
      acceptedEnd[1] - acceptedCenter[1],
    );
    const radialScale = (acceptedRadius + radialGap) / acceptedRadius;
    const invalidDragEnd = [
      acceptedCenter[0] + (acceptedEnd[0] - acceptedCenter[0]) * radialScale,
      acceptedCenter[1] + (acceptedEnd[1] - acceptedCenter[1]) * radialScale,
    ] as const;
    dragSession.values[dragEndRecord.baseIndex] = invalidDragEnd[0];
    dragSession.values[dragEndRecord.baseIndex + 1] = invalidDragEnd[1];
    const dragged = updateCompiledSketchSolveSession(dragSession, {
      kind: "sketchPoint",
      pointId: points[2]!.pointId,
      position: invalidDragEnd,
    });
    expect(dragged.kind).toBe("blocked");
    expect(dragged.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "offset-arc-common-circle-unsatisfied",
        severity: "error",
      }),
    );
    expect(dragged.solvedSnapshot).toBe(acceptedBeforeDrag);
    expect(dragSession.lastAcceptedSnapshot).toBe(acceptedBeforeDrag);
  }
