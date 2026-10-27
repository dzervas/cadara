import { compileSketchSolveProgram } from "./compile-program";
import { sketchDraggedPointHasFreeDof } from "./free-dof";
import {
  solveSketchDefinitionCore,
  validateSketchDefinitionCore,
} from "./solve-sketch";
import {
  assertGradientMatchesFiniteDifference,
  makeEqualOffsetDefinition,
  makeLine,
  makePoint,
  tolerances,
} from "./solver-basic.fixtures";
import {
  evaluateSketchScalarConstraintForTest,
  getSketchSolveInitialValuesForTest,
} from "./solver-test-seams";
import { createCompiledSketchSolveSession } from "./start-session";
import type { NumericSketchDefinition as SketchDefinition } from "@/contracts/sketch/schema";
import { expect } from "vitest";

export async function testEqualOffsetFreeMagnitudeAndComponentCoupling() {
    const definition = makeEqualOffsetDefinition();
    const solved = solveSketchDefinitionCore({
      definition,
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "failOnConflict",
    });
    expect(solved.status.solveState).toBe("solved");
    expect(solved.solvedSnapshot.constraintStatuses).toEqual([
      { constraintId: "constraint_equal_offset", status: "satisfied" },
    ]);
    expect(definition.derivedRelationships).toBeUndefined();
    expect(solved.solvedSnapshot.solvedEntities).toHaveLength(4);

    const program = compileSketchSolveProgram({
      definition,
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "failOnConflict",
    });
    const metadata = program.equationMetadata.find(
      (entry) => entry.id === "constraint_equal_offset",
    );
    expect(metadata?.variableIndices).toHaveLength(16);
    expect(program.components).toHaveLength(1);
    expect(program.components[0]?.entityIds).toEqual(definition.entityIds);
    const session = createCompiledSketchSolveSession({
      sessionId: "interactive_sketch_solve_equal_offset",
      program,
      priorSolvedSnapshot: solved.solvedSnapshot,
    });
    expect(sketchDraggedPointHasFreeDof(session, definition.pointIds[0]!)).toBe(
      true,
    );
  }

export async function testEqualOffsetUsesSeparateMagnitudeDriver() {
    const definition = makeEqualOffsetDefinition({
      points: [
        [0, 0],
        [4, 0],
        [0, 3],
        [4, 3],
        [0, 6],
        [4, 6],
        [0, 9],
        [4, 9],
      ],
      drivenDistance: 3,
    });
    const solved = solveSketchDefinitionCore({
      definition,
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "failOnConflict",
      strategy: "levenbergMarquardt",
    });
    expect(solved.status.solveState).toBe("solved");
    expect(solved.solvedSnapshot.constraintStatuses[0]?.status).toBe(
      "satisfied",
    );
    expect(solved.solvedSnapshot.dimensionStatuses[0]).toMatchObject({
      dimensionId: "dimension_equal_offset_magnitude",
      status: "driving",
      solvedValue: 3,
    });
  }

export async function testEqualOffsetOrientationSideObliqueAndGradient() {
    const angle = 0.63;
    const axis = [Math.cos(angle), Math.sin(angle)] as const;
    const normal = [-axis[1], axis[0]] as const;
    const point = (
      along: number,
      across: number,
    ): readonly [number, number] => [
      axis[0] * along + normal[0] * across,
      axis[1] * along + normal[1] * across,
    ];
    const definition = makeEqualOffsetDefinition({
      points: [
        point(0, 0),
        point(5, 0),
        point(0, 2),
        point(5, 2),
        point(1, 7),
        point(6, 7),
        point(1, 5),
        point(6, 5),
      ],
      sides: ["right", "right"],
      reverseEntities: [
        "sketch_entity_equal_offset_0",
        "sketch_entity_equal_offset_3",
      ],
    });
    const initial = evaluateSketchScalarConstraintForTest({
      tolerances,
      modelingTolerance: 1e-3,
      definition,
      constraintId: "constraint_equal_offset",
      values: getSketchSolveInitialValuesForTest(definition, tolerances, 1e-3),
    });
    expect(initial.residual).toBeLessThan(1e-20);

    const perturbed = getSketchSolveInitialValuesForTest(
      definition,
      tolerances,
      1e-3,
    );
    perturbed[5] += 0.37;
    perturbed[10] -= 0.21;
    assertGradientMatchesFiniteDifference(
      definition,
      "constraint_equal_offset",
      2e-6,
      1e-6,
      perturbed,
    );
  }

export async function testEqualOffsetClassifiesAngularAndLinearToleranceSeparately() {
    const makeFixedDefinition = (
      points: readonly (readonly [number, number])[],
    ) => {
      const definition = makeEqualOffsetDefinition({ points });
      const fixed = definition.points.map((point, index) => ({
        constraintId: `constraint_equal_offset_fix_${index}`,
        kind: "fixPoint" as const,
        label: `Fix equal-offset point ${index}`,
        pointId: point.pointId,
        position: point.position,
      }));
      definition.constraints.push(...fixed);
      definition.constraintIds.push(
        ...fixed.map((constraint) => constraint.constraintId),
      );
      return definition;
    };
    const angularViolation = makeFixedDefinition([
      [0, 0],
      [4, 0],
      [0, 2],
      [4, 2 + 4e-5],
      [0, 6],
      [4, 6],
      [0, 8],
      [4, 8 + 4e-5],
    ]);
    const angularSolve = solveSketchDefinitionCore({
      definition: angularViolation,
      tolerances: {
        ...tolerances,
        coincidence: 1e-3,
        angleRadians: 1e-6,
      },
      modelingTolerance: 1e-3,
      partialSolvePolicy: "failOnConflict",
    });
    expect(angularSolve.status.solveState).toBe("failed");
    expect(angularSolve.solvedSnapshot.constraintStatuses[0]).toEqual({
      constraintId: "constraint_equal_offset",
      status: "unsatisfied",
    });

    const linearViolation = makeFixedDefinition([
      [0, 0],
      [4, 0],
      [0, 2],
      [4, 2],
      [0, 6],
      [4, 6],
      [0, 8 + 1e-5],
      [4, 8 + 1e-5],
    ]);
    const linearSolve = solveSketchDefinitionCore({
      definition: linearViolation,
      tolerances: {
        ...tolerances,
        coincidence: 1e-6,
        angleRadians: 1e-3,
      },
      modelingTolerance: 1e-3,
      partialSolvePolicy: "failOnConflict",
    });
    expect(linearSolve.status.solveState).toBe("failed");
    expect(linearSolve.solvedSnapshot.constraintStatuses[0]).toEqual({
      constraintId: "constraint_equal_offset",
      status: "unsatisfied",
    });

    const angularGap = 1e-7;
    const angularAccepted = makeFixedDefinition([
      [0, 0],
      [4, 0],
      [0, 2],
      [4 * Math.cos(angularGap), 2 + 4 * Math.sin(angularGap)],
      [0, 6],
      [4, 6],
      [0, 8],
      [4 * Math.cos(angularGap), 8 + 4 * Math.sin(angularGap)],
    ]);
    const angularBoundary = Math.asin(
      Math.abs(
        Math.sin(angularGap) /
          Math.hypot(Math.cos(angularGap), Math.sin(angularGap)),
      ),
    );
    for (const angleRadians of [angularBoundary, angularBoundary + 1e-9]) {
      const accepted = solveSketchDefinitionCore({
        definition: angularAccepted,
        tolerances: { ...tolerances, coincidence: 1e-3, angleRadians },
        modelingTolerance: 1e-3,
        partialSolvePolicy: "failOnConflict",
      });
      expect(accepted.status.solveState).toBe("solved");
      expect(accepted.solvedSnapshot.constraintStatuses[0]?.status).toBe(
        "satisfied",
      );
      expect(
        accepted.solvedSnapshot.solvedPoints.map((point) =>
          point.solvedPosition,
        ),
      ).toEqual(angularAccepted.points.map((point) => point.position));
    }

    const linearGap = 1e-7;
    const linearAccepted = makeFixedDefinition([
      [0, 0],
      [4, 0],
      [0, 2],
      [4, 2],
      [0, 6],
      [4, 6],
      [0, 8 + linearGap],
      [4, 8 + linearGap],
    ]);
    const linearBoundary = Math.abs(2 - (8 + linearGap - 6));
    for (const coincidence of [linearBoundary, linearBoundary + 1e-9]) {
      const accepted = solveSketchDefinitionCore({
        definition: linearAccepted,
        tolerances: { ...tolerances, coincidence, angleRadians: 1e-3 },
        modelingTolerance: 1e-3,
        partialSolvePolicy: "failOnConflict",
      });
      expect(accepted.status.solveState).toBe("solved");
      expect(accepted.solvedSnapshot.constraintStatuses[0]?.status).toBe(
        "satisfied",
      );
      expect(
        accepted.solvedSnapshot.solvedPoints.map((point) =>
          point.solvedPosition,
        ),
      ).toEqual(linearAccepted.points.map((point) => point.position));
    }
  }

export async function testEqualOffsetRejectsIncompatibleAndDegeneratePairs() {
    const incompatible = makeEqualOffsetDefinition();
    incompatible.entities[3] = {
      kind: "circle",
      entityId: incompatible.entities[3]!.entityId,
      label: "Not a line",
      target: incompatible.entities[3]!.target,
      isConstruction: false,
      centerPointId: incompatible.points[6]!.pointId,
      radius: 2,
    };
    const incompatibleValidation = validateSketchDefinitionCore({
      definition: incompatible,
      tolerances,
      modelingTolerance: 1e-3,
    });
    expect(incompatibleValidation.isValid).toBe(false);
    expect(incompatibleValidation.diagnostics).toContainEqual(
      expect.objectContaining({ code: "invalid-equal-offset-line-pair" }),
    );

    const selfPaired = makeEqualOffsetDefinition();
    const equalOffset = selfPaired.constraints[0];
    if (equalOffset?.kind !== "equalOffset") {
      throw new Error("Expected equal-offset fixture constraint.");
    }
    equalOffset.pairs[0].offsetEntityId = equalOffset.pairs[0].seedEntityId;
    const selfPairedProgram = compileSketchSolveProgram({
      definition: selfPaired,
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "failOnConflict",
    });
    expect(
      selfPairedProgram.equationMetadata.some(
        (metadata) => metadata.id === "constraint_equal_offset",
      ),
    ).toBe(false);
    const selfPairedSolve = solveSketchDefinitionCore({
      definition: selfPaired,
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "failOnConflict",
    });
    expect(selfPairedSolve.status.solveState).toBe("failed");
    expect(selfPairedSolve.solvedSnapshot.constraintStatuses[0]).toEqual({
      constraintId: "constraint_equal_offset",
      status: "conflicting",
    });

    const validPrior = solveSketchDefinitionCore({
      definition: makeEqualOffsetDefinition(),
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "failOnConflict",
    }).solvedSnapshot;
    for (const nonFiniteCoordinate of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const nonFinite = makeEqualOffsetDefinition();
      nonFinite.points[1]!.position = [nonFiniteCoordinate, 0];
      const nonFiniteEvaluation = evaluateSketchScalarConstraintForTest({
        tolerances,
        modelingTolerance: 1e-3,
        definition: nonFinite,
        constraintId: "constraint_equal_offset",
        values: getSketchSolveInitialValuesForTest(nonFinite, tolerances, 1e-3),
      });
      expect(nonFiniteEvaluation.residual).toBe(Number.POSITIVE_INFINITY);
      expect(
        [...nonFiniteEvaluation.gradient].every(
          (component) => Number.isFinite(component) && component === 0,
        ),
      ).toBe(true);
      const nonFiniteSolve = solveSketchDefinitionCore({
        definition: nonFinite,
        tolerances,
        modelingTolerance: 1e-3,
        partialSolvePolicy: "failOnConflict",
      });
      expect(nonFiniteSolve.status.solveState).toBe("failed");
      expect(nonFiniteSolve.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "non-finite-equal-offset-geometry",
          severity: "error",
        }),
      );
      expect(nonFiniteSolve.solvedSnapshot.constraintStatuses[0]).toEqual({
        constraintId: "constraint_equal_offset",
        status: "conflicting",
      });

      const nonFiniteProgram = compileSketchSolveProgram({
        definition: nonFinite,
        tolerances,
        modelingTolerance: 1e-3,
        partialSolvePolicy: "failOnConflict",
      });
      expect(() =>
        createCompiledSketchSolveSession({
          sessionId: "interactive_sketch_solve_equal_offset_non_finite",
          program: nonFiniteProgram,
        }),
      ).toThrow(/without an acceptable solved snapshot/);
      expect(() =>
        createCompiledSketchSolveSession({
          sessionId: "interactive_sketch_solve_equal_offset_failed_prior",
          program: nonFiniteProgram,
          priorSolvedSnapshot: nonFiniteSolve.solvedSnapshot,
        }),
      ).toThrow(/without an acceptable solved snapshot/);

      const sessionWithValidPrior = createCompiledSketchSolveSession({
        sessionId: "interactive_sketch_solve_equal_offset_valid_prior",
        program: nonFiniteProgram,
        priorSolvedSnapshot: validPrior,
      });
      expect(sessionWithValidPrior.lastAcceptedSnapshot).toBe(validPrior);
    }

    const sharedPoint = makePoint(
      "sketch_point_equal_offset_0",
      "Only shared point",
      0,
      0,
    );
    const oldPoint = makePoint("sketch_point_old", "Old point", 1, 0);
    const oldLine = makeLine(
      "sketch_entity_old",
      "Old line",
      sharedPoint.pointId,
      oldPoint.pointId,
    );
    const unrelatedDefinition: SketchDefinition = {
      schemaVersion: "sketch-definition/v1alpha2",
      referenceIds: [],
      references: [],
      pointIds: [sharedPoint.pointId, oldPoint.pointId],
      points: [sharedPoint, oldPoint],
      entityIds: [oldLine.entityId],
      entities: [oldLine],
      constraintIds: [],
      constraints: [],
      dimensionIds: [],
      dimensions: [],
    };
    const unrelatedPrior = solveSketchDefinitionCore({
      definition: unrelatedDefinition,
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "failOnConflict",
    }).solvedSnapshot;
    expect(unrelatedPrior.status.solveState).toBe("solved");
    const invalidForUnrelatedPrior = makeEqualOffsetDefinition();
    invalidForUnrelatedPrior.points[1]!.position = [Number.NaN, 0];
    expect(() =>
      createCompiledSketchSolveSession({
        sessionId: "interactive_sketch_solve_equal_offset_unrelated_prior",
        program: compileSketchSolveProgram({
          definition: invalidForUnrelatedPrior,
          tolerances,
          modelingTolerance: 1e-3,
          partialSolvePolicy: "failOnConflict",
        }),
        priorSolvedSnapshot: unrelatedPrior,
      }),
    ).toThrow(/without an acceptable solved snapshot/);

    const degenerate = makeEqualOffsetDefinition();
    degenerate.points[1]!.position = degenerate.points[0]!.position;
    const degenerateValidation = validateSketchDefinitionCore({
      definition: degenerate,
      tolerances,
      modelingTolerance: 1e-3,
    });
    expect(degenerateValidation.isValid).toBe(false);
    expect(degenerateValidation.diagnostics).toContainEqual(
      expect.objectContaining({ code: "degenerate-line-segment" }),
    );
  }
