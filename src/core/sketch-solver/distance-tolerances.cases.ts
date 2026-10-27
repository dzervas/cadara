import { compileSketchSolveProgram } from "./compile-program";
import { solveSketchDefinitionCore } from "./solve-sketch";
import type { SketchSolveTolerancePolicy } from "./solve-types";
import {
  assertClose,
  assertGradientMatchesFiniteDifference,
  makeCircle,
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
import { createDocumentSolverTolerances } from "@/contracts/solver/schema";
import { expect } from "vitest";

export async function testFixPoint() {
    const definition: SketchDefinition = {
      schemaVersion: "sketch-definition/v1alpha2",
      referenceIds: [],
      references: [],
      pointIds: ["sketch_point_a"],
      points: [makePoint("sketch_point_a", "A", 1, 0)],
      entityIds: [],
      entities: [],
      constraintIds: ["constraint_fix_a"],
      constraints: [
        {
          constraintId: "constraint_fix_a",
          kind: "fixPoint",
          label: "Fix A",
          pointId: "sketch_point_a",
          position: [1, 1],
        },
      ],
      dimensionIds: [],
      dimensions: [],
    };

    const solved = solveSketchDefinitionCore({
      definition,
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "bestEffort",
    });

    const point = solved.solvedSnapshot.solvedPoints[0];
    expect(point, "Expected one solved point.").not.toBe(undefined);
    expect(
      Math.abs(point.solvedPosition[0] - 1) < 1e-6,
      "Fix point should preserve x.",
    ).toBeTruthy();
    expect(
      Math.abs(point.solvedPosition[1] - 1) < 1e-6,
      "Fix point should solve y to 1.",
    ).toBeTruthy();
    assertGradientMatchesFiniteDifference(definition, "constraint_fix_a", 1e-6);
  }

export async function testEuclideanDistance() {
    const definition: SketchDefinition = {
      schemaVersion: "sketch-definition/v1alpha2",
      referenceIds: [],
      references: [],
      pointIds: ["sketch_point_a", "sketch_point_b"],
      points: [
        makePoint("sketch_point_a", "A", 1, 0),
        makePoint("sketch_point_b", "B", 0, 1),
      ],
      entityIds: [],
      entities: [],
      constraintIds: [],
      constraints: [],
      dimensionIds: ["dimension_distance"],
      dimensions: [
        {
          dimensionId: "dimension_distance",
          kind: "distance",
          label: "Distance",
          axis: "aligned",
          pointIds: ["sketch_point_a", "sketch_point_b"],
          value: 3,
        },
      ],
    };

    const solved = solveSketchDefinitionCore({
      definition,
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "bestEffort",
    });

    const [a, b] = solved.solvedSnapshot.solvedPoints;
    expect(
      a !== undefined && b !== undefined,
      "Expected solved point pair.",
    ).toBeTruthy();
    const distance = Math.hypot(
      a.solvedPosition[0] - b.solvedPosition[0],
      a.solvedPosition[1] - b.solvedPosition[1],
    );
    expect(
      Math.abs(distance - 3) < 1e-4,
      "Aligned distance should solve to 3.",
    ).toBeTruthy();
    assertGradientMatchesFiniteDifference(
      definition,
      "dimension_distance",
      1e-6,
    );
  }

export async function testHorizontalDistance() {
    const definition: SketchDefinition = {
      schemaVersion: "sketch-definition/v1alpha2",
      referenceIds: [],
      references: [],
      pointIds: ["sketch_point_a", "sketch_point_b"],
      points: [
        makePoint("sketch_point_a", "A", 1, 0),
        makePoint("sketch_point_b", "B", 0, 1),
      ],
      entityIds: [],
      entities: [],
      constraintIds: [],
      constraints: [],
      dimensionIds: ["dimension_horizontal_distance"],
      dimensions: [
        {
          dimensionId: "dimension_horizontal_distance",
          kind: "horizontalDistance",
          label: "Horizontal distance",
          pointIds: ["sketch_point_a", "sketch_point_b"],
          value: -3,
        },
      ],
    };

    const solved = solveSketchDefinitionCore({
      definition,
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "bestEffort",
    });

    const [a, b] = solved.solvedSnapshot.solvedPoints;
    expect(
      a !== undefined && b !== undefined,
      "Expected solved point pair.",
    ).toBeTruthy();
    expect(
      Math.abs(b.solvedPosition[0] - a.solvedPosition[0] + 3) < 1e-4,
      "Horizontal distance should solve to -3.",
    ).toBeTruthy();
    assertGradientMatchesFiniteDifference(
      definition,
      "dimension_horizontal_distance",
      1e-6,
    );
  }

export async function testVerticalDistance() {
    const definition: SketchDefinition = {
      schemaVersion: "sketch-definition/v1alpha2",
      referenceIds: [],
      references: [],
      pointIds: ["sketch_point_a", "sketch_point_b"],
      points: [
        makePoint("sketch_point_a", "A", 1, 0),
        makePoint("sketch_point_b", "B", 0, 1),
      ],
      entityIds: [],
      entities: [],
      constraintIds: [],
      constraints: [],
      dimensionIds: ["dimension_vertical_distance"],
      dimensions: [
        {
          dimensionId: "dimension_vertical_distance",
          kind: "verticalDistance",
          label: "Vertical distance",
          pointIds: ["sketch_point_a", "sketch_point_b"],
          value: 3,
        },
      ],
    };

    const solved = solveSketchDefinitionCore({
      definition,
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "bestEffort",
    });

    const [a, b] = solved.solvedSnapshot.solvedPoints;
    expect(
      a !== undefined && b !== undefined,
      "Expected solved point pair.",
    ).toBeTruthy();
    expect(
      Math.abs(b.solvedPosition[1] - a.solvedPosition[1] - 3) < 1e-4,
      "Vertical distance should solve to 3.",
    ).toBeTruthy();
    assertGradientMatchesFiniteDifference(
      definition,
      "dimension_vertical_distance",
      1e-6,
    );
  }

export async function testEditedParallelLineDistanceConverges() {
    const points = [
      makePoint("sketch_point_a", "A", -4.5, 50),
      makePoint("sketch_point_b", "B", -4.5, -50),
      makePoint("sketch_point_c", "C", 4.5, 50),
      makePoint("sketch_point_d", "D", 4.5, -50),
    ];
    const entities = [
      makeLine(
        "sketch_entity_left",
        "Left",
        points[0]!.pointId,
        points[1]!.pointId,
      ),
      makeLine(
        "sketch_entity_right",
        "Right",
        points[2]!.pointId,
        points[3]!.pointId,
      ),
    ];
    const definition: SketchDefinition = {
      schemaVersion: "sketch-definition/v1alpha2",
      referenceIds: [],
      references: [],
      points,
      pointIds: points.map((point) => point.pointId),
      entities,
      entityIds: entities.map((entity) => entity.entityId),
      constraintIds: [],
      constraints: [],
      dimensionIds: ["dimension_gap"],
      dimensions: [
        {
          dimensionId: "dimension_gap",
          kind: "lineDistance",
          label: "Gap",
          lines: [
            { kind: "localEntity", entityId: entities[0]!.entityId },
            { kind: "localEntity", entityId: entities[1]!.entityId },
          ],
          value: 12,
        },
      ],
      styleIds: [],
      styles: [],
      svgRenderingEnabled: true,
    };
    const solved = solveSketchDefinitionCore({
      definition,
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "failOnConflict",
    });
    expect(
      solved.status.solveState,
      "An edited distance must not stall when initially parallel lines rotate during iteration.",
    ).toBe("solved");
    assertClose(
      solved.solvedSnapshot.dimensionStatuses[0]!.solvedValue!,
      12,
      1e-4,
      "The edited line gap must reach its authored distance.",
    );
  }

export async function testLineDistanceAdmissionAndStatusShareAngularTolerance() {
    const makeDefinition = (
      angle: number,
      pinned: boolean,
    ): SketchDefinition => {
      const points = [
        makePoint("sketch_point_base_start", "Base start", 0, 0),
        makePoint("sketch_point_base_end", "Base end", 10, 0),
        makePoint("sketch_point_tilted_start", "Tilted start", 0, 2),
        makePoint(
          "sketch_point_tilted_end",
          "Tilted end",
          10 * Math.cos(angle),
          2 + 10 * Math.sin(angle),
        ),
      ];
      const entities = [
        makeLine(
          "sketch_entity_base",
          "Base",
          points[0]!.pointId,
          points[1]!.pointId,
        ),
        makeLine(
          "sketch_entity_tilted",
          "Tilted",
          points[2]!.pointId,
          points[3]!.pointId,
        ),
      ];
      return {
        schemaVersion: "sketch-definition/v1alpha2",
        referenceIds: [],
        references: [],
        points,
        pointIds: points.map((point) => point.pointId),
        entities,
        entityIds: entities.map((entity) => entity.entityId),
        // Pinned endpoints keep the initial angle, so the solved status sees
        // the same non-parallel lines the admission gate saw.
        constraintIds: pinned
          ? points.map((point) => `constraint_pin_${point.pointId}` as const)
          : [],
        constraints: pinned
          ? points.map((point) => ({
              constraintId: `constraint_pin_${point.pointId}` as const,
              kind: "fixPoint" as const,
              label: `Pin ${point.label}`,
              pointId: point.pointId,
              position: point.position,
            }))
          : [],
        dimensionIds: ["dimension_gap"],
        dimensions: [
          {
            dimensionId: "dimension_gap",
            kind: "lineDistance",
            label: "Gap",
            lines: [
              { kind: "localEntity", entityId: entities[0]!.entityId },
              { kind: "localEntity", entityId: entities[1]!.entityId },
            ],
            value: pinned ? 2 : 3,
          },
        ],
      };
    };
    const judge = (
      angle: number,
      policy: SketchSolveTolerancePolicy,
      pinned = false,
    ) => {
      const definition = makeDefinition(angle, pinned);
      let admitted = true;
      try {
        evaluateSketchScalarConstraintForTest({
          tolerances: policy,
          modelingTolerance: 1e-3,
          definition,
          constraintId: "dimension_gap",
          values: getSketchSolveInitialValuesForTest(definition, policy, 1e-3),
        });
      } catch (error) {
        // Only a non-admitted dimension is expected; anything else bubbles.
        if (
          !(error instanceof Error) ||
          error.message !== "Unknown scalar constraint dimension_gap."
        ) {
          throw error;
        }
        admitted = false;
      }
      const status = solveSketchDefinitionCore({
        definition,
        tolerances: policy,
        modelingTolerance: 1e-3,
        partialSolvePolicy: "bestEffort",
      }).solvedSnapshot.dimensionStatuses[0]!;
      return {
        admitted,
        status: status.status,
        solvedValue:
          status.solvedValue === null
            ? null
            : Math.round(status.solvedValue * 1e3) / 1e3,
      };
    };
    // A non-default document policy looser than the former hard-coded 1e-4.
    const documentPolicy = { ...tolerances, angleRadians: 0.01 };
    const loosePolicy = { ...documentPolicy, coincidence: 0.01 };

    expect(
      judge(0.005, documentPolicy),
      "Lines parallel within the policy angle are admitted and driven to the authored distance.",
    ).toEqual({ admitted: true, status: "driving", solvedValue: 3 });
    expect(
      judge(0.005, tolerances),
      "The same lines fall outside a tighter policy angle for both admission and status.",
    ).toEqual({ admitted: false, status: "unsatisfied", solvedValue: null });
    expect(
      judge(0.03, documentPolicy),
      "Lines skewed beyond the policy angle are neither admitted nor reported as driving.",
    ).toEqual({ admitted: false, status: "unsatisfied", solvedValue: null });
    expect(
      judge(0.005, loosePolicy, true),
      "Status keeps measuring lines that stay within the policy angle but beyond 1e-4.",
    ).toEqual({ admitted: true, status: "driving", solvedValue: 2 });
    expect(
      judge(0.03, loosePolicy, true),
      "Pinned lines beyond the policy angle are neither admitted nor measured.",
    ).toEqual({ admitted: false, status: "unsatisfied", solvedValue: null });
  }

export async function testRequirementStatusesUseDocumentLinearAndAngularTolerance() {
    // Default document settings: 1e-3 mm linear, 1e-4 rad angular. Residuals
    // are 0.5·r², so a requirement holds iff |r| ≤ its own tolerance.
    const documentPolicy = createDocumentSolverTolerances({
      modelingTolerance: 1e-3,
      angularToleranceRadians: 1e-4,
    });
    const tau = documentPolicy.coincidence;
    const pin = (pointId: string, position: readonly [number, number]) => ({
      constraintId: `constraint_pin_${pointId}` as const,
      kind: "fixPoint" as const,
      label: `Pin ${pointId}`,
      pointId: pointId as `sketch_point_${string}`,
      position,
    });
    const solve = (
      points: ReturnType<typeof makePoint>[],
      entities: SketchDefinition["entities"],
      requirement: SketchDefinition["constraints"][number],
      dimensions: SketchDefinition["dimensions"] = [],
    ) => {
      const constraints = [
        ...points.map((point) => pin(point.pointId, point.position)),
        requirement,
      ];
      const solved = solveSketchDefinitionCore({
        definition: {
          schemaVersion: "sketch-definition/v1alpha2",
          referenceIds: [],
          references: [],
          points,
          pointIds: points.map((point) => point.pointId),
          entities,
          entityIds: entities.map((entity) => entity.entityId),
          constraints,
          constraintIds: constraints.map((item) => item.constraintId),
          dimensions,
          dimensionIds: dimensions.map((item) => item.dimensionId),
        },
        tolerances: documentPolicy,
        modelingTolerance: 1e-3,
        partialSolvePolicy: "bestEffort",
      }).solvedSnapshot;
      return {
        solveState: solved.status.solveState,
        requirement: solved.constraintStatuses.find(
          (status) => status.constraintId === requirement.constraintId,
        )!.status,
      };
    };

    // Fully pinned lines keep (almost all of) their initial angular error;
    // at length 10 a 1e-3 rad skew solves to ~9.6e-4 rad, inside the linear
    // tolerance but ~10x the angular one. 5e-5 rad solves to ~4.8e-5 rad.
    const pinnedAngular = (
      kind: "parallel" | "perpendicular" | "angle",
      skew: number,
    ) => {
      const base =
        kind === "parallel" ? 0 : kind === "perpendicular" ? Math.PI / 2 : 1;
      const direction = base + skew;
      const origin = kind === "angle" ? [0, 0] : [0, 5];
      const points = [
        makePoint("sketch_point_a0", "A0", 0, 0),
        makePoint("sketch_point_a1", "A1", 10, 0),
        ...(kind === "angle"
          ? []
          : [makePoint("sketch_point_b0", "B0", origin[0]!, origin[1]!)]),
        makePoint(
          "sketch_point_b1",
          "B1",
          origin[0]! + 10 * Math.cos(direction),
          origin[1]! + 10 * Math.sin(direction),
        ),
      ];
      const entities = [
        makeLine("sketch_entity_a", "A", "sketch_point_a0", "sketch_point_a1"),
        makeLine(
          "sketch_entity_b",
          "B",
          kind === "angle" ? "sketch_point_a0" : "sketch_point_b0",
          "sketch_point_b1",
        ),
      ];
      return solve(
        points,
        entities,
        kind === "angle"
          ? {
              constraintId: "constraint_angular",
              kind: "angle",
              label: "Angle",
              pointIds: [
                "sketch_point_a1",
                "sketch_point_b1",
                "sketch_point_a0",
              ],
              valueRadians: base,
            }
          : {
              constraintId: "constraint_angular",
              kind,
              label: kind,
              entityIds: ["sketch_entity_a", "sketch_entity_b"],
            },
      );
    };
    for (const kind of ["parallel", "perpendicular", "angle"] as const) {
      expect(
        pinnedAngular(kind, 1e-3),
        `The ${kind} constraint ~1e-3 rad off is judged against the angular tolerance, not the linear one.`,
      ).toEqual({ solveState: "partiallySolved", requirement: "unsatisfied" });
      expect(
        pinnedAngular(kind, 5e-5),
        `The ${kind} constraint within the angular tolerance stays solved.`,
      ).toEqual({ solveState: "solved", requirement: "satisfied" });
    }

    // Two pinned points joined by a coincidence settle at a third of their
    // initial gap, as does each pin: 3.6·τ apart leaves 1.2·τ everywhere,
    // which is outside |r| ≤ τ but inside the former √2·τ slack.
    const pinnedCoincidence = (gap: number) =>
      solve(
        [
          makePoint("sketch_point_a0", "A0", -10, 0),
          makePoint("sketch_point_a1", "A1", 0, 0),
          makePoint("sketch_point_b0", "B0", 3 * gap, 0),
          makePoint("sketch_point_b1", "B1", 3 * gap, 10),
        ],
        [
          makeLine(
            "sketch_entity_a",
            "A",
            "sketch_point_a0",
            "sketch_point_a1",
          ),
          makeLine(
            "sketch_entity_b",
            "B",
            "sketch_point_b0",
            "sketch_point_b1",
          ),
        ],
        {
          constraintId: "constraint_coincident",
          kind: "coincident",
          label: "Coincident",
          pointIds: ["sketch_point_a1", "sketch_point_b0"],
        },
      );
    expect(
      pinnedCoincidence(1.2 * tau),
      "A coincidence left 1.2·τ apart is outside the linear tolerance.",
    ).toEqual({ solveState: "partiallySolved", requirement: "unsatisfied" });
    expect(
      pinnedCoincidence(0.9 * tau),
      "A coincidence left 0.9·τ apart is within the linear tolerance.",
    ).toEqual({ solveState: "solved", requirement: "satisfied" });

    // Normal: the contact point is the line start, so the contact term is
    // zero. A skewed pinned line leaves only the direction sine (angular);
    // a pinned radius mismatch of 4·g leaves g on the curve term and on each
    // of the pins and the radius dimension (linear).
    const pinnedNormal = (skew: number, radialGap: number) =>
      solve(
        [
          makePoint("sketch_point_center", "Center", 0, 0),
          makePoint("sketch_point_contact", "Contact", 5 + 4 * radialGap, 0),
          makePoint(
            "sketch_point_far",
            "Far",
            5 + 4 * radialGap + 10 * Math.cos(skew),
            10 * Math.sin(skew),
          ),
        ],
        [
          makeCircle(
            "sketch_entity_circle",
            "Circle",
            "sketch_point_center",
            5,
          ),
          makeLine(
            "sketch_entity_normal",
            "Normal",
            "sketch_point_contact",
            "sketch_point_far",
          ),
        ],
        {
          constraintId: "constraint_normal",
          kind: "normal",
          label: "Normal",
          line: { kind: "localEntity", entityId: "sketch_entity_normal" },
          curve: { kind: "localEntity", entityId: "sketch_entity_circle" },
          point: { kind: "localPoint", pointId: "sketch_point_contact" },
        },
        [
          {
            dimensionId: "dimension_radius",
            kind: "circleRadius",
            label: "Radius",
            entityId: "sketch_entity_circle",
            value: 5,
          },
        ],
      );
    expect(
      pinnedNormal(1e-3, 0),
      "A normal line ~1e-3 rad off radial is judged against the angular tolerance.",
    ).toEqual({ solveState: "partiallySolved", requirement: "unsatisfied" });
    expect(
      pinnedNormal(5e-5, 0),
      "A normal line within the angular tolerance stays solved.",
    ).toEqual({ solveState: "solved", requirement: "satisfied" });
    expect(
      pinnedNormal(0, 0.9 * tau),
      "A normal contact 0.9·τ off the curve is judged against the linear tolerance.",
    ).toEqual({ solveState: "solved", requirement: "satisfied" });
    expect(
      pinnedNormal(0, 1.2 * tau),
      "A normal contact 1.2·τ off the curve is outside the linear tolerance.",
    ).toEqual({ solveState: "partiallySolved", requirement: "unsatisfied" });
  }

export async function testLowLossStartsStillSolveUntilEveryRequirementHolds() {
    // A total loss below the solver's 1e-8 short-circuit (or BFGS's 1e-12
    // floor) is not acceptance: one requirement can still be outside its
    // document tolerance, so the solve must continue instead of stopping.
    const twoFreeLines = (
      secondStart: readonly [number, number],
      secondDirection: number,
      requirement: SketchDefinition["constraints"][number],
    ): SketchDefinition => {
      const points = [
        makePoint("sketch_point_a0", "A0", 0, 0),
        makePoint("sketch_point_a1", "A1", 10, 0),
        makePoint("sketch_point_b0", "B0", ...secondStart),
        makePoint(
          "sketch_point_b1",
          "B1",
          secondStart[0] + 10 * Math.cos(secondDirection),
          secondStart[1] + 10 * Math.sin(secondDirection),
        ),
      ];
      const entities = [
        makeLine("sketch_entity_a", "A", "sketch_point_a0", "sketch_point_a1"),
        makeLine("sketch_entity_b", "B", "sketch_point_b0", "sketch_point_b1"),
      ];
      return {
        schemaVersion: "sketch-definition/v1alpha2",
        referenceIds: [],
        references: [],
        points,
        pointIds: points.map((point) => point.pointId),
        entities,
        entityIds: entities.map((entity) => entity.entityId),
        constraints: [requirement],
        constraintIds: [requirement.constraintId],
        dimensions: [],
        dimensionIds: [],
      };
    };
    const parallel: SketchDefinition["constraints"][number] = {
      constraintId: "constraint_parallel",
      kind: "parallel",
      label: "Parallel",
      entityIds: ["sketch_entity_a", "sketch_entity_b"],
    };
    const coincident: SketchDefinition["constraints"][number] = {
      constraintId: "constraint_coincident",
      kind: "coincident",
      label: "Coincident",
      pointIds: ["sketch_point_a1", "sketch_point_b0"],
    };
    const startSession = (
      definition: SketchDefinition,
      policy: SketchSolveTolerancePolicy,
    ) => {
      const snapshot = createCompiledSketchSolveSession({
        sessionId: "interactive_sketch_solve_low_loss_start",
        program: compileSketchSolveProgram({
          definition,
          tolerances: policy,
          modelingTolerance: 1e-3,
          partialSolvePolicy: "failOnConflict",
        }),
      }).lastAcceptedSnapshot;
      return {
        solveState: snapshot.status.solveState,
        requirement: snapshot.constraintStatuses[0]!.status,
      };
    };
    const defaultPolicy = createDocumentSolverTolerances({
      modelingTolerance: 1e-3,
      angularToleranceRadians: 1e-4,
    });
    const tightPolicy = createDocumentSolverTolerances({
      modelingTolerance: 1e-5,
      angularToleranceRadians: 1e-6,
    });

    // 0.5·(1.2e-4)² = 7.2e-9 < 1e-8, but 1.2e-4 rad > the 1e-4 rad policy.
    expect
      .soft(
        startSession(twoFreeLines([0, 5], 1.2e-4, parallel), defaultPolicy),
        "An interactive session starting 1.2e-4 rad off parallel solves instead of short-circuiting.",
      )
      .toEqual({ solveState: "solved", requirement: "satisfied" });
    // 0.5·(1e-4)² = 5e-9 < 1e-8, but a 1e-4 gap > the 1e-5 linear policy.
    expect
      .soft(
        startSession(twoFreeLines([10 + 1e-4, 0], 1, coincident), tightPolicy),
        "An interactive session starting 1e-4 apart solves under a 1e-5 linear policy.",
      )
      .toEqual({ solveState: "solved", requirement: "satisfied" });

    // BFGS stops at loss < 1e-12 here with ~1.25e-6 rad left, above the
    // 1e-6 rad policy; the Gauss-Newton fallback must still run.
    const fallback = solveSketchDefinitionCore({
      definition: twoFreeLines([0, 5], 0.1, parallel),
      tolerances: tightPolicy,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "bestEffort",
    }).solvedSnapshot;
    expect
      .soft(
        {
          solveState: fallback.status.solveState,
          requirement: fallback.constraintStatuses[0]!.status,
        },
        "A low-loss BFGS result that misses a requirement falls back to Gauss-Newton.",
      )
      .toEqual({ solveState: "solved", requirement: "satisfied" });
  }

export async function testNeverAdmittedLineDimensionsAreUnsatisfied() {
    // Line-distance and line-angle admission is judged at the initial values
    // while status is judged at the solved values; another requirement can
    // close that gap, so a dimension that never entered the solver must not
    // report "driving" against geometry it never drove.
    const solveTwoLines = (input: {
      secondEnd: readonly [number, number];
      constraints: SketchDefinition["constraints"];
      dimension: SketchDefinition["dimensions"][number];
    }) => {
      const points = [
        makePoint("sketch_point_a_start", "A start", 0, 0),
        makePoint("sketch_point_a_end", "A end", 10, 0),
        makePoint("sketch_point_b_start", "B start", 0, 2),
        makePoint("sketch_point_b_end", "B end", ...input.secondEnd),
      ];
      const entities = [
        makeLine(
          "sketch_entity_a",
          "A",
          "sketch_point_a_start",
          "sketch_point_a_end",
        ),
        makeLine(
          "sketch_entity_b",
          "B",
          "sketch_point_b_start",
          "sketch_point_b_end",
        ),
      ];
      const solved = solveSketchDefinitionCore({
        definition: {
          schemaVersion: "sketch-definition/v1alpha2",
          referenceIds: [],
          references: [],
          points,
          pointIds: points.map((point) => point.pointId),
          entities,
          entityIds: entities.map((entity) => entity.entityId),
          constraints: input.constraints,
          constraintIds: input.constraints.map(
            (constraint) => constraint.constraintId,
          ),
          dimensions: [input.dimension],
          dimensionIds: [input.dimension.dimensionId],
        },
        tolerances,
        modelingTolerance: 1e-3,
        partialSolvePolicy: "bestEffort",
      }).solvedSnapshot;
      return {
        solveState: solved.status.solveState,
        constraints: solved.constraintStatuses.map((status) => status.status),
        dimension: solved.dimensionStatuses[0]!.status,
        solvedValue: solved.dimensionStatuses[0]!.solvedValue,
      };
    };
    const lines = [
      { kind: "localEntity", entityId: "sketch_entity_a" },
      { kind: "localEntity", entityId: "sketch_entity_b" },
    ] as const;
    const parallel: SketchDefinition["constraints"] = [
      {
        constraintId: "constraint_parallel",
        kind: "parallel",
        label: "Parallel",
        entityIds: ["sketch_entity_a", "sketch_entity_b"],
      },
    ];
    const gap: SketchDefinition["dimensions"][number] = {
      dimensionId: "dimension_gap",
      kind: "lineDistance",
      label: "Gap",
      lines: [...lines],
      value: 3,
    };

    const admittedGap = solveTwoLines({
      secondEnd: [10, 2],
      constraints: parallel,
      dimension: gap,
    });
    expect(
      admittedGap,
      "Lines that start parallel admit the gap, which drives them to its value.",
    ).toMatchObject({
      solveState: "solved",
      constraints: ["satisfied"],
      dimension: "driving",
    });
    assertClose(
      admittedGap.solvedValue!,
      3,
      1e-6,
      "An admitted line gap must reach its authored distance.",
    );

    const skewAngle = 0.03;
    const skewedGap = solveTwoLines({
      secondEnd: [10 * Math.cos(skewAngle), 2 + 10 * Math.sin(skewAngle)],
      constraints: parallel,
      dimension: gap,
    });
    expect(
      skewedGap,
      "Lines that start skewed never admit the gap; a parallel constraint making them parallel must not turn it into a driving dimension.",
    ).toMatchObject({
      solveState: "partiallySolved",
      constraints: ["satisfied"],
      dimension: "unsatisfied",
    });
    expect(
      Math.abs(skewedGap.solvedValue! - 3),
      "The never-enforced gap keeps its measured value, which differs from the authored one.",
    ).toBeGreaterThan(0.1);

    // Lines that start parallel never admit an angle dimension; pinning the
    // second line vertical must not make the pi/4 angle read as driving at pi/2.
    const pinnedVertical: SketchDefinition["constraints"] = (
      [
        ["sketch_point_b_start", [0, 2]],
        ["sketch_point_b_end", [0, 12]],
      ] as const
    ).map(([pointId, position]) => ({
      constraintId: `constraint_pin_${pointId}` as const,
      kind: "fixPoint" as const,
      label: `Pin ${pointId}`,
      pointId,
      position,
    }));
    const parallelAngle = solveTwoLines({
      secondEnd: [10, 2],
      constraints: pinnedVertical,
      dimension: {
        dimensionId: "dimension_angle",
        kind: "lineAngle",
        label: "Angle",
        lines: [...lines],
        valueRadians: Math.PI / 4,
      },
    });
    expect(
      parallelAngle,
      "An angle dimension that was never admitted must be unsatisfied even when other requirements rotate the lines apart.",
    ).toMatchObject({
      solveState: "partiallySolved",
      constraints: ["satisfied", "satisfied"],
      dimension: "unsatisfied",
    });
    assertClose(
      parallelAngle.solvedValue!,
      Math.PI / 2,
      1e-9,
      "The never-enforced angle keeps its measured value.",
    );
  }
