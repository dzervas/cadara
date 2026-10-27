import { compileSketchSolveProgram } from "./compile-program";
import { sketchDraggedPointHasFreeDof } from "./free-dof";
import {
  solveSketchDefinitionCore,
  validateSketchDefinitionCore,
} from "./solve-sketch";
import {
  assertGradientMatchesFiniteDifference,
  makeLine,
  makePoint,
  tolerances,
} from "./solver-basic.fixtures";
import {
  evaluateSketchScalarConstraintForTest,
  getSketchSolveInitialValuesForTest,
} from "./solver-test-seams";
import { createCompiledSketchSolveSession } from "./start-session";
import { updateCompiledSketchSolveSession } from "./update-session";
import type { NumericSketchDefinition as SketchDefinition } from "@/contracts/sketch/schema";
import { evaluateSplineSpan } from "@/contracts/sketch/spline-geometry";
import { expect } from "vitest";

export async function testOrdinarySplineUsesAnalyticOwnerJacobiansAndAuthoredHandleVariables() {
    const points = [
      makePoint("sketch_point_s0", "S0", 0, 0),
      makePoint("sketch_point_s1", "S1", 1, 1),
      makePoint("sketch_point_s2", "S2", 2, 0),
      makePoint("sketch_point_contact", "Contact", 0.55, 0.8),
    ];
    const spline = {
      kind: "spline" as const,
      entityId: "sketch_entity_spline" as const,
      label: "Spline",
      target: {
        kind: "sketchEntity" as const,
        sketchId: "sketch_primary" as const,
        entityId: "sketch_entity_spline" as const,
      },
      isConstruction: false,
      pointOccurrenceIds: ["occ_s0", "occ_s1", "occ_s2"],
      // Deliberately shuffled: variable identity follows occurrence IDs, not record order.
      pointOccurrences: [
        {
          occurrenceId: "occ_s2",
          pointId: "sketch_point_s2" as const,
          tangent: { kind: "authored" as const, vector: [0.2, -0.1] as const },
        },
        {
          occurrenceId: "occ_s0",
          pointId: "sketch_point_s0" as const,
          tangent: { kind: "authored" as const, vector: [0.3, 0.15] as const },
        },
        {
          occurrenceId: "occ_s1",
          pointId: "sketch_point_s1" as const,
          tangent: { kind: "authored" as const, vector: [0, 0] as const },
        },
      ],
      closure: "open" as const,
      interpolationPolicy: "centripetal-mean-arm-v1" as const,
    };
    const constraints: SketchDefinition["constraints"] = [
      {
        constraintId: "constraint_contact",
        kind: "pointOnCurve",
        label: "Contact on spline",
        point: { kind: "localPoint", pointId: points[3]!.pointId },
        curve: { kind: "localEntity", entityId: spline.entityId },
      },
      ...points.map((point, index) => ({
        constraintId:
          `constraint_fix_spline_${index}` as `constraint_${string}`,
        kind: "fixPoint" as const,
        label: `Fix ${index}`,
        pointId: point.pointId,
        position: point.position,
      })),
    ];
    const definition: SketchDefinition = {
      schemaVersion: "sketch-definition/v1alpha2",
      referenceIds: [],
      references: [],
      pointIds: points.map((point) => point.pointId),
      points,
      entityIds: [spline.entityId],
      entities: [spline],
      constraintIds: constraints.map((constraint) => constraint.constraintId),
      constraints,
      dimensionIds: [],
      dimensions: [],
    };
    const before = structuredClone(definition);
    const initial = getSketchSolveInitialValuesForTest(
      definition,
      tolerances,
      1e-3,
    );

    // Four point pairs plus all three authored tangent-vector pairs.
    expect(initial.length).toBe(14);
    expect([...initial.slice(8)]).toEqual([0.3, 0.15, 0, 0, 0.2, -0.1]);
    const contactEvaluation = evaluateSketchScalarConstraintForTest({
      tolerances,
      modelingTolerance: 1e-3,
      definition,
      constraintId: "constraint_contact",
      values: initial,
    });
    assertGradientMatchesFiniteDifference(
      definition,
      "constraint_contact",
      2e-5,
      2e-6,
    );
    expect(
      [...contactEvaluation.gradient.slice(8, 12)].some(
        (component) => Math.abs(component) > 1e-8,
      ),
      "The contacted span must expose authored handle components to the analytic residual.",
    ).toBeTruthy();
    expect(
      [...contactEvaluation.gradient.slice(12, 14)].every(
        (component) => Math.abs(component) < 1e-12,
      ),
      "A distant authored handle must remain outside this local span residual.",
    ).toBeTruthy();

    const solved = solveSketchDefinitionCore({
      definition,
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "bestEffort",
    });
    const status = solved.solvedSnapshot.constraintStatuses.find(
      (entry) => entry.constraintId === "constraint_contact",
    );
    const solvedSpline = solved.solvedSnapshot.solvedEntities.find(
      (entity) =>
        entity.entityId === spline.entityId && entity.kind === "spline",
    );
    expect(status?.status).toBe("satisfied");
    expect(solvedSpline?.kind).toBe("spline");
    if (solvedSpline?.kind === "spline") {
      expect(solvedSpline.reconstruction.validity).toBe("valid");
      if (solvedSpline.reconstruction.validity === "valid") {
        expect(solvedSpline.reconstruction.handles[1]).not.toEqual([0, 0]);
        const firstEnd = evaluateSplineSpan(
          solvedSpline.reconstruction.spans[0]!,
          {
            kind: "source",
            value: solvedSpline.reconstruction.spans[0]!.interval[1],
          },
        );
        const secondStart = evaluateSplineSpan(
          solvedSpline.reconstruction.spans[1]!,
          {
            kind: "source",
            value: solvedSpline.reconstruction.spans[1]!.interval[0],
          },
        );
        expect(firstEnd.position).toEqual(secondStart.position);
        expect(
          Math.hypot(
            firstEnd.first[0] - secondStart.first[0],
            firstEnd.first[1] - secondStart.first[1],
          ),
        ).toBeLessThan(1e-8);
      }
    }
    expect(definition).toEqual(before);
  }

export async function testOrdinarySplineAliasClosureKeepsAutomaticTangentsDerivedAndExactZeroAuthored() {
    const points = [
      makePoint("sketch_point_a0", "A0", 0, 0),
      makePoint("sketch_point_a1", "A1", 1, 1),
      makePoint("sketch_point_a2", "A2", 2, 0),
    ];
    const baseSpline = {
      kind: "spline" as const,
      entityId: "sketch_entity_alias_spline" as const,
      label: "Alias spline",
      target: {
        kind: "sketchEntity" as const,
        sketchId: "sketch_primary" as const,
        entityId: "sketch_entity_alias_spline" as const,
      },
      isConstruction: false,
      pointOccurrenceIds: ["occ_a0", "occ_a1", "occ_a2", "occ_a0_close"],
      pointOccurrences: [
        {
          occurrenceId: "occ_a0_close",
          pointId: points[0]!.pointId,
          tangent: { kind: "authored" as const, vector: [0, 0] as const },
        },
        {
          occurrenceId: "occ_a1",
          pointId: points[1]!.pointId,
          tangent: { kind: "automatic" as const },
        },
        {
          occurrenceId: "occ_a0",
          pointId: points[0]!.pointId,
          tangent: { kind: "authored" as const, vector: [0.4, 0] as const },
        },
        {
          occurrenceId: "occ_a2",
          pointId: points[2]!.pointId,
          tangent: { kind: "automatic" as const },
        },
      ],
      closure: "positional" as const,
      interpolationPolicy: "centripetal-mean-arm-v1" as const,
    };
    const definition: SketchDefinition = {
      schemaVersion: "sketch-definition/v1alpha2",
      referenceIds: [],
      references: [],
      pointIds: points.map((point) => point.pointId),
      points,
      entityIds: [baseSpline.entityId],
      entities: [baseSpline],
      constraintIds: [],
      constraints: [],
      dimensionIds: [],
      dimensions: [],
    };
    const initial = getSketchSolveInitialValuesForTest(
      definition,
      tolerances,
      1e-3,
    );
    // Shared canonical aliases have one point pair; automatic occurrences add no variables.
    expect(initial.length).toBe(10);
    expect([...initial.slice(6)]).toEqual([0.4, 0, 0, 0]);
    const solved = solveSketchDefinitionCore({
      definition,
      tolerances,
      modelingTolerance: 1e-3,
    });
    const geometry = solved.solvedSnapshot.solvedEntities.find(
      (entity) =>
        entity.entityId === baseSpline.entityId && entity.kind === "spline",
    );
    expect(geometry?.kind).toBe("spline");
    if (
      geometry?.kind === "spline" &&
      geometry.reconstruction.validity === "valid"
    ) {
      expect(geometry.reconstruction.handles[3]).toEqual([0, 0]);
      expect(geometry.reconstruction.handles[1]).not.toEqual([0, 0]);
      expect(geometry.reconstruction.spans.at(-1)?.poles[3]).toEqual(
        geometry.reconstruction.spans[0]?.poles[0],
      );
    }
  }

export async function testProjectedSourceSamplesAreRejectedAsDisplayOnly() {
    const point = makePoint("sketch_point_projected", "Projected", 0.5, 0.5);
    const definition: SketchDefinition = {
      schemaVersion: "sketch-definition/v1alpha2",
      referenceIds: ["ref_spline"],
      references: [
        {
          referenceId: "ref_spline",
          kind: "modelReference",
          label: "External spline",
          source: { kind: "edge", bodyId: "body_1", edgeId: "edge_1" },
          projectionMode: "projectAlongPlaneNormal",
        },
      ],
      pointIds: [point.pointId],
      points: [point],
      entityIds: [],
      entities: [],
      constraintIds: ["constraint_projected_spline"],
      constraints: [
        {
          constraintId: "constraint_projected_spline",
          kind: "pointOnProjectedCurve",
          label: "Point on external spline",
          point: { kind: "localPoint", pointId: point.pointId },
          projectedCurve: {
            kind: "projectedGeometry",
            reference: {
              kind: "projectedSpline",
              referenceId: "ref_spline",
              geometryId: "projected_geometry_spline",
            },
          },
        },
      ],
      dimensionIds: [],
      dimensions: [],
    };
    const projectedReferences = [
      {
        referenceId: "ref_spline" as const,
        status: "projected" as const,
        geometry: [
          {
            geometryId: "projected_geometry_spline" as const,
            kind: "spline" as const,
            representation: {
              kind: "sourceSamples" as const,
              points: [
                [0, 0],
                [1, 1],
              ] as const,
              isClosed: false,
            },
          },
        ],
        diagnostics: [],
      },
    ];
    const validated = validateSketchDefinitionCore({
      definition,
      projectedReferences,
      tolerances,
      modelingTolerance: 1e-3,
    });
    expect(validated.isValid).toBe(false);
    expect(validated.diagnostics).toContainEqual(
      expect.objectContaining({ code: "unsupported-projected-spline-samples" }),
    );
    const solved = solveSketchDefinitionCore({
      definition,
      projectedReferences,
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "failOnConflict",
    });
    expect(solved.status.solveState).toBe("failed");
  }

export async function testDrivenOutputConstraintUsesSourceAndAxisJacobians() {
    const points = [
      makePoint("sketch_point_source", "Source", 1, 1),
      makePoint("sketch_point_output", "Output", 1, -1),
      makePoint("sketch_point_axis_start", "Axis start", 0, 0),
      makePoint("sketch_point_axis_end", "Axis end", 2, 0),
    ];
    const axis = makeLine(
      "sketch_entity_axis",
      "Axis",
      "sketch_point_axis_start",
      "sketch_point_axis_end",
    );
    const source = {
      kind: "point" as const,
      entityId: "sketch_entity_source" as const,
      label: "Source",
      target: {
        kind: "sketchEntity" as const,
        sketchId: "sketch_primary" as const,
        entityId: "sketch_entity_source" as const,
      },
      isConstruction: false,
      pointId: "sketch_point_source" as const,
    };
    const output = {
      ...source,
      entityId: "sketch_entity_output" as const,
      label: "Output",
      target: {
        ...source.target,
        entityId: "sketch_entity_output" as const,
      },
      pointId: "sketch_point_output" as const,
    };
    const constraints: SketchDefinition["constraints"] = [
      {
        constraintId: "constraint_output_position",
        kind: "fixPoint",
        label: "Output position",
        pointId: output.pointId,
        position: [3, -2],
      },
      {
        constraintId: "constraint_axis_start",
        kind: "fixPoint",
        label: "Axis start",
        pointId: axis.startPointId,
        position: [0, 0],
      },
      {
        constraintId: "constraint_axis_end",
        kind: "fixPoint",
        label: "Axis end",
        pointId: axis.endPointId,
        position: [2, 0],
      },
    ];
    const definition: SketchDefinition = {
      schemaVersion: "sketch-definition/v1alpha2",
      referenceIds: [],
      references: [],
      pointIds: points.map((point) => point.pointId),
      points,
      entityIds: [source.entityId, output.entityId, axis.entityId],
      entities: [source, output, axis],
      constraintIds: constraints.map((constraint) => constraint.constraintId),
      constraints,
      dimensionIds: [],
      dimensions: [],
      derivedRelationshipIds: ["derivation_mirror"],
      derivedRelationships: [
        {
          derivationId: "derivation_mirror",
          kind: "mirror",
          label: "Mirror",
          seedEntityIds: [source.entityId],
          mirrorReference: { kind: "lineEntity", entityId: axis.entityId },
          outputs: [
            {
              seedEntityId: source.entityId,
              outputEntityId: output.entityId,
              instanceIndex: 1,
              seedPointIds: [source.pointId],
              outputPointIds: [output.pointId],
            },
          ],
        },
      ],
    };

    assertGradientMatchesFiniteDifference(
      definition,
      "constraint_output_position",
      2e-5,
    );
    const evaluation = evaluateSketchScalarConstraintForTest({
      tolerances,
      modelingTolerance: 1e-3,
      definition,
      constraintId: "constraint_output_position",
      values: getSketchSolveInitialValuesForTest(definition, tolerances, 1e-3),
    });
    expect(
      [...evaluation.gradient.slice(0, 2)].some(
        (component) => Math.abs(component) > 1e-8,
      ),
      "A driven-output requirement must pull back to source point variables.",
    ).toBeTruthy();
    expect(
      [...evaluation.gradient.slice(4, 8)].some(
        (component) => Math.abs(component) > 1e-8,
      ),
      "Mirror output evaluation must include analytic axis dependencies.",
    ).toBeTruthy();
    expect([...evaluation.gradient.slice(2, 4)]).toEqual([0, 0]);
    const constrainedProgram = compileSketchSolveProgram({
      definition,
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "failOnConflict",
    });
    const outputEquation = constrainedProgram.equationMetadata.find(
      (metadata) => metadata.id === "constraint_output_position",
    );
    expect(outputEquation?.variableIndices).toEqual([0, 1, 4, 5, 6, 7]);
    expect(
      constrainedProgram.components[outputEquation!.componentId]
        ?.variableIndices,
    ).toEqual([0, 1, 4, 5, 6, 7]);

    const solved = solveSketchDefinitionCore({
      definition,
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "failOnConflict",
    });
    expect(solved.status.solveState).toBe("solved");
    expect(
      solved.solvedSnapshot.constraintStatuses.find(
        (status) => status.constraintId === "constraint_output_position",
      )?.status,
    ).toBe("satisfied");
    const solvedPoints = new Map(
      solved.solvedSnapshot.solvedPoints.map((point) => [
        point.pointId,
        point.solvedPosition,
      ]),
    );
    expect(solvedPoints.get(source.pointId)?.[0]).toBeCloseTo(3, 5);
    expect(solvedPoints.get(source.pointId)?.[1]).toBeCloseTo(2, 5);
    expect(solvedPoints.get(output.pointId)?.[0]).toBeCloseTo(3, 5);
    expect(solvedPoints.get(output.pointId)?.[1]).toBeCloseTo(-2, 5);

    const dragDefinition: SketchDefinition = {
      ...definition,
      constraintIds: ["constraint_axis_start", "constraint_axis_end"],
      constraints: constraints.slice(1),
    };
    const program = compileSketchSolveProgram({
      definition: dragDefinition,
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "failOnConflict",
    });
    const outputComponent = program.components.find((component) =>
      component.pointIds.includes(output.pointId),
    );
    expect(outputComponent?.variableIndices).toEqual([0, 1, 4, 5, 6, 7]);
    expect(outputComponent?.variableIndices).not.toContain(2);
    expect(outputComponent?.variableIndices).not.toContain(3);
    const initialDragSolve = solveSketchDefinitionCore({
      definition: dragDefinition,
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "failOnConflict",
    });
    const session = createCompiledSketchSolveSession({
      sessionId: "interactive_sketch_solve_driven_output",
      program,
      priorSolvedSnapshot: initialDragSolve.solvedSnapshot,
    });
    expect(sketchDraggedPointHasFreeDof(session, output.pointId)).toBe(true);
    const dragged = updateCompiledSketchSolveSession(session, {
      kind: "sketchPoint",
      pointId: output.pointId,
      position: [3, -2],
    });
    expect(dragged.kind).toBe("solved");
    const draggedPoints = new Map(
      dragged.solvedSnapshot?.solvedPoints.map((point) => [
        point.pointId,
        point.solvedPosition,
      ]),
    );
    expect(draggedPoints.get(source.pointId)?.[0]).toBeCloseTo(3, 3);
    expect(draggedPoints.get(source.pointId)?.[1]).toBeCloseTo(2, 3);
    expect(draggedPoints.get(output.pointId)?.[0]).toBeCloseTo(3, 3);
    expect(draggedPoints.get(output.pointId)?.[1]).toBeCloseTo(-2, 3);

    const lastAccepted = dragged.solvedSnapshot;
    const rejected = updateCompiledSketchSolveSession(session, {
      kind: "sketchPoint",
      pointId: output.pointId,
      position: [Number.NaN, -2],
    });
    expect(rejected.kind).toBe("blocked");
    expect(rejected).toMatchObject({ reason: "nonConvergent" });
    expect(rejected.solvedSnapshot).toEqual(lastAccepted);
  }

export async function testProjectionSupportClosesOverOrderedDerivedChains() {
    const points = [
      makePoint("sketch_point_chain_source", "Source", 1, 0),
      makePoint("sketch_point_chain_middle", "Middle", 1, 0),
      makePoint("sketch_point_chain_output", "Output", 2, 0),
      makePoint("sketch_point_chain_axis_start", "Axis start", 0, 0),
      makePoint("sketch_point_chain_axis_end", "Axis end", 2, 0),
    ];
    const pointEntities = points.slice(0, 3).map((point, index) => ({
      kind: "point" as const,
      entityId: `sketch_entity_chain_${index}` as const,
      label: point.label,
      target: {
        kind: "sketchEntity" as const,
        sketchId: "sketch_primary" as const,
        entityId: `sketch_entity_chain_${index}` as const,
      },
      isConstruction: false,
      pointId: point.pointId,
    }));
    const axis = makeLine(
      "sketch_entity_chain_axis",
      "Axis",
      points[3]!.pointId,
      points[4]!.pointId,
    );
    const constraints: SketchDefinition["constraints"] = [
      {
        constraintId: "constraint_chain_axis_start",
        kind: "fixPoint",
        label: "Fix axis start",
        pointId: points[3]!.pointId,
        position: [0, 0],
      },
      {
        constraintId: "constraint_chain_axis_end",
        kind: "fixPoint",
        label: "Fix axis end",
        pointId: points[4]!.pointId,
        position: [2, 0],
      },
    ];
    const definition: SketchDefinition = {
      schemaVersion: "sketch-definition/v1alpha2",
      referenceIds: [],
      references: [],
      pointIds: points.map((point) => point.pointId),
      points,
      entityIds: [
        ...pointEntities.map((entity) => entity.entityId),
        axis.entityId,
      ],
      entities: [...pointEntities, axis],
      constraintIds: constraints.map((constraint) => constraint.constraintId),
      constraints,
      dimensionIds: [],
      dimensions: [],
      derivedRelationshipIds: [
        "derivation_chain_mirror",
        "derivation_chain_transform",
      ],
      derivedRelationships: [
        {
          derivationId: "derivation_chain_mirror",
          kind: "mirror",
          label: "Mirror source",
          seedEntityIds: [pointEntities[0]!.entityId],
          mirrorReference: { kind: "lineEntity", entityId: axis.entityId },
          outputs: [
            {
              seedEntityId: pointEntities[0]!.entityId,
              outputEntityId: pointEntities[1]!.entityId,
              instanceIndex: 1,
              seedPointIds: [points[0]!.pointId],
              outputPointIds: [points[1]!.pointId],
            },
          ],
        },
        {
          derivationId: "derivation_chain_transform",
          kind: "transform",
          label: "Translate mirror",
          seedEntityIds: [pointEntities[1]!.entityId],
          translation: [1, 0],
          rotationRadians: 0,
          scale: 1,
          origin: [0, 0],
          outputs: [
            {
              seedEntityId: pointEntities[1]!.entityId,
              outputEntityId: pointEntities[2]!.entityId,
              instanceIndex: 1,
              seedPointIds: [points[1]!.pointId],
              outputPointIds: [points[2]!.pointId],
            },
          ],
        },
      ],
    };
    const outputRequirement = {
      constraintId: "constraint_chain_output" as const,
      kind: "fixPoint" as const,
      label: "Fix chained output",
      pointId: points[2]!.pointId,
      position: [4, -2] as const,
    };
    const gradientDefinition: SketchDefinition = {
      ...definition,
      constraintIds: [
        ...definition.constraintIds,
        outputRequirement.constraintId,
      ],
      constraints: [...definition.constraints, outputRequirement],
    };
    assertGradientMatchesFiniteDifference(
      gradientDefinition,
      outputRequirement.constraintId,
      2e-5,
    );
    const gradientProgram = compileSketchSolveProgram({
      definition: gradientDefinition,
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "failOnConflict",
    });
    const outputScalar = gradientProgram.system.scalarConstraints.find(
      (constraint) => constraint.id === outputRequirement.constraintId,
    )!;
    const mutableValues = new Float64Array(
      gradientProgram.system.initialValues,
    );
    const axisGradientAtZeroPose =
      outputScalar.evaluate(mutableValues).gradient;
    mutableValues[1] = 1;
    mutableValues[7] = 0.5;
    const mutatedEvaluation = outputScalar.evaluate(mutableValues);
    const freshEvaluation = evaluateSketchScalarConstraintForTest({
      tolerances,
      modelingTolerance: 1e-3,
      definition: gradientDefinition,
      constraintId: outputRequirement.constraintId,
      values: new Float64Array(mutableValues),
    });
    expect(mutatedEvaluation.residual).toBeCloseTo(
      freshEvaluation.residual,
      12,
    );
    expect([...mutatedEvaluation.gradient]).toEqual([
      ...freshEvaluation.gradient,
    ]);
    expect(
      [...mutatedEvaluation.gradient.slice(6, 10)].some(
        (component, index) =>
          Math.abs(axisGradientAtZeroPose[index + 6]!) < 1e-12 &&
          Math.abs(component) > 1e-8,
      ),
      "Mutating the same candidate array must recompute a mirror-axis gradient component that becomes nonzero in the current frame.",
    ).toBeTruthy();
    assertGradientMatchesFiniteDifference(
      gradientDefinition,
      outputRequirement.constraintId,
      2e-5,
      1e-6,
      mutableValues,
    );

    const program = compileSketchSolveProgram({
      definition,
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "failOnConflict",
    });
    const outputComponent = program.components.find((component) =>
      component.pointIds.includes(points[2]!.pointId),
    );
    expect(outputComponent?.variableIndices).toEqual([0, 1, 6, 7, 8, 9]);
    const initial = solveSketchDefinitionCore({
      definition,
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "failOnConflict",
    });
    const session = createCompiledSketchSolveSession({
      sessionId: "interactive_sketch_solve_derived_chain",
      program,
      priorSolvedSnapshot: initial.solvedSnapshot,
    });
    const dragged = updateCompiledSketchSolveSession(session, {
      kind: "sketchPoint",
      pointId: points[2]!.pointId,
      position: [4, -2],
    });
    expect(dragged.kind).toBe("solved");
    const solvedPoints = new Map(
      dragged.solvedSnapshot?.solvedPoints.map((point) => [
        point.pointId,
        point.solvedPosition,
      ]),
    );
    expect(solvedPoints.get(points[0]!.pointId)?.[0]).toBeCloseTo(3, 3);
    expect(solvedPoints.get(points[0]!.pointId)?.[1]).toBeCloseTo(2, 3);
    expect(solvedPoints.get(points[1]!.pointId)?.[0]).toBeCloseTo(3, 3);
    expect(solvedPoints.get(points[1]!.pointId)?.[1]).toBeCloseTo(-2, 3);
    expect(solvedPoints.get(points[2]!.pointId)?.[0]).toBeCloseTo(4, 3);
    expect(solvedPoints.get(points[2]!.pointId)?.[1]).toBeCloseTo(-2, 3);
  }

export async function testDimensionStatusUsesLinearAndAngularTolerancePolicies() {
    const solveWithTolerance = (
      definition: SketchDefinition,
      policy: typeof tolerances,
    ) =>
      solveSketchDefinitionCore({
        definition,
        tolerances: policy,
        modelingTolerance: 1e-3,
        partialSolvePolicy: "bestEffort",
      });
    const fixedConstraints = (
      points: readonly ReturnType<typeof makePoint>[],
    ) =>
      points.map((point, index) => ({
        constraintId:
          `constraint_policy_fix_${index}` as `constraint_${string}`,
        kind: "fixPoint" as const,
        label: `Fix ${index}`,
        pointId: point.pointId,
        position: point.position,
      }));

    const linearPoints = [
      makePoint("sketch_point_policy_a", "A", 0, 0),
      makePoint("sketch_point_policy_b", "B", 1.01, 0),
    ];
    const linearConstraints = fixedConstraints(linearPoints);
    const linearDimension = {
      dimensionId: "dimension_policy_linear" as const,
      kind: "distance" as const,
      label: "Linear policy boundary",
      pointIds: [linearPoints[0]!.pointId, linearPoints[1]!.pointId] as const,
      axis: "aligned" as const,
      value: 1,
    };
    const linearDefinition: SketchDefinition = {
      schemaVersion: "sketch-definition/v1alpha2",
      referenceIds: [],
      references: [],
      pointIds: linearPoints.map((point) => point.pointId),
      points: linearPoints,
      entityIds: [],
      entities: [],
      constraintIds: linearConstraints.map(
        (constraint) => constraint.constraintId,
      ),
      constraints: linearConstraints,
      dimensionIds: [linearDimension.dimensionId],
      dimensions: [linearDimension],
    };
    const looseLinear = solveWithTolerance(linearDefinition, {
      ...tolerances,
      coincidence: 0.01,
    });
    const strictLinear = solveWithTolerance(linearDefinition, {
      ...tolerances,
      coincidence: 1e-5,
    });
    expect(
      looseLinear.solvedSnapshot.dimensionStatuses[0]?.status,
      "A linear dimension residual inside the supplied linear policy should be driving.",
    ).toBe("driving");
    expect(
      strictLinear.solvedSnapshot.dimensionStatuses[0]?.status,
      "The same linear residual outside a stricter linear policy should be unsatisfied.",
    ).toBe("unsatisfied");

    const anglePoints = [
      makePoint("sketch_point_policy_o", "O", 0, 0),
      makePoint("sketch_point_policy_x", "X", 1, 0),
      makePoint("sketch_point_policy_y", "Y", 0, 1),
    ];
    const angleLines = [
      makeLine(
        "sketch_entity_policy_x",
        "X axis",
        anglePoints[0]!.pointId,
        anglePoints[1]!.pointId,
      ),
      makeLine(
        "sketch_entity_policy_y",
        "Y axis",
        anglePoints[0]!.pointId,
        anglePoints[2]!.pointId,
      ),
    ];
    const angleConstraints = fixedConstraints(anglePoints);
    const angleDimension = {
      dimensionId: "dimension_policy_angle" as const,
      kind: "lineAngle" as const,
      label: "Angular policy boundary",
      lines: angleLines.map((line) => ({
        kind: "localEntity" as const,
        entityId: line.entityId,
      })) as [
        {
          kind: "localEntity";
          entityId: (typeof angleLines)[number]["entityId"];
        },
        {
          kind: "localEntity";
          entityId: (typeof angleLines)[number]["entityId"];
        },
      ],
      valueRadians: Math.PI / 2 + 0.01,
    };
    const angleDefinition: SketchDefinition = {
      schemaVersion: "sketch-definition/v1alpha2",
      referenceIds: [],
      references: [],
      pointIds: anglePoints.map((point) => point.pointId),
      points: anglePoints,
      entityIds: angleLines.map((line) => line.entityId),
      entities: angleLines,
      constraintIds: angleConstraints.map(
        (constraint) => constraint.constraintId,
      ),
      constraints: angleConstraints,
      dimensionIds: [angleDimension.dimensionId],
      dimensions: [angleDimension],
    };
    const looseAngle = solveWithTolerance(angleDefinition, {
      coincidence: 1,
      angleRadians: 0.01,
      minimumSegmentLength: 1e-6,
    });
    const strictAngle = solveWithTolerance(angleDefinition, {
      coincidence: 1,
      angleRadians: 1e-5,
      minimumSegmentLength: 1e-6,
    });
    expect(looseAngle.solvedSnapshot.dimensionStatuses[0]?.status).toBe(
      "driving",
    );
    expect(strictAngle.solvedSnapshot.dimensionStatuses[0]?.status).toBe(
      "unsatisfied",
    );
  }
