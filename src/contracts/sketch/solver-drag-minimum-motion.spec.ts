import { test, expect } from "vitest";

import type { SketchDefinition } from "@/contracts/sketch/schema";
import {
  compileSketchSolveProgram,
  createCompiledSketchSolveSession,
  sketchDraggedPointHasFreeDof,
  solveSketchDefinitionWithDraggedPointTarget,
  updateCompiledSketchSolveSession,
} from "@/contracts/sketch/solver-core";

// Lane: logic (docs/testing.md). Seam: the interactive dragged-handle solver
// contract in src/contracts/sketch/solver-core.ts. These property tests protect
// the minimum-motion-sketch-drag guarantees (D1-D4) at the exported boundary:
// hard-constraint satisfaction, frame-to-frame continuity (no searched flips),
// no refusal when free DOF remain, and minimum motion of non-dragged geometry.
test("src/contracts/sketch/solver-drag-minimum-motion.spec.ts", () => {
  const tolerances = {
    coincidence: 1e-6,
    angleRadians: 1e-6,
    minimumSegmentLength: 1e-6,
  } as const;

  function point(pointId: string, x: number, y: number) {
    return {
      pointId: pointId as `sketch_point_${string}`,
      label: pointId,
      target: {
        kind: "sketchPoint",
        sketchId: "sketch_primary",
        pointId: pointId as `sketch_point_${string}`,
      } as const,
      position: [x, y] as const,
      isConstruction: false,
    };
  }

  function line(entityId: string, startPointId: string, endPointId: string) {
    return {
      kind: "lineSegment" as const,
      entityId: entityId as `sketch_entity_${string}`,
      label: entityId,
      target: {
        kind: "sketchEntity",
        sketchId: "sketch_primary",
        entityId: entityId as `sketch_entity_${string}`,
      } as const,
      isConstruction: false,
      startPointId: startPointId as `sketch_point_${string}`,
      endPointId: endPointId as `sketch_point_${string}`,
    };
  }

  // A shape-rigid square with free position (translation is its only DOF).
  function freeSquareDefinition(): SketchDefinition {
    const constraints = [
      {
        constraintId: "constraint_h_ab" as const,
        kind: "horizontal" as const,
        label: "AB",
        entityId: "sketch_entity_ab" as const,
      },
      {
        constraintId: "constraint_h_cd" as const,
        kind: "horizontal" as const,
        label: "CD",
        entityId: "sketch_entity_cd" as const,
      },
      {
        constraintId: "constraint_v_bc" as const,
        kind: "vertical" as const,
        label: "BC",
        entityId: "sketch_entity_bc" as const,
      },
      {
        constraintId: "constraint_v_da" as const,
        kind: "vertical" as const,
        label: "DA",
        entityId: "sketch_entity_da" as const,
      },
    ];
    return {
      schemaVersion: "sketch-definition/v1alpha1",
      referenceIds: [],
      references: [],
      pointIds: ["sq_a", "sq_b", "sq_c", "sq_d"],
      points: [
        point("sq_a", 0, 0),
        point("sq_b", 1, 0),
        point("sq_c", 1, 1),
        point("sq_d", 0, 1),
      ],
      entityIds: [
        "sketch_entity_ab",
        "sketch_entity_bc",
        "sketch_entity_cd",
        "sketch_entity_da",
      ],
      entities: [
        line("sketch_entity_ab", "sq_a", "sq_b"),
        line("sketch_entity_bc", "sq_b", "sq_c"),
        line("sketch_entity_cd", "sq_c", "sq_d"),
        line("sketch_entity_da", "sq_d", "sq_a"),
      ],
      constraintIds: constraints.map((constraint) => constraint.constraintId),
      constraints,
      dimensionIds: ["dim_w", "dim_h"],
      dimensions: [
        {
          dimensionId: "dim_w",
          kind: "horizontalDistance",
          label: "W",
          pointIds: ["sq_a", "sq_b"],
          value: 1,
        },
        {
          dimensionId: "dim_h",
          kind: "verticalDistance",
          label: "H",
          pointIds: ["sq_a", "sq_d"],
          value: 1,
        },
      ],
    };
  }

  // A single horizontal line pinned at the origin: the free endpoint may only
  // slide along the x-axis (one remaining degree of freedom).
  function horizontalSliderDefinition(): SketchDefinition {
    return {
      schemaVersion: "sketch-definition/v1alpha1",
      referenceIds: [],
      references: [],
      pointIds: ["sl_a", "sl_b"],
      points: [point("sl_a", 0, 0), point("sl_b", 2, 0)],
      entityIds: ["sketch_entity_slider"],
      entities: [line("sketch_entity_slider", "sl_a", "sl_b")],
      constraintIds: ["constraint_pin_a", "constraint_h_slider"],
      constraints: [
        {
          constraintId: "constraint_pin_a" as const,
          kind: "fixPoint" as const,
          label: "Pin A",
          pointId: "sl_a" as const,
          position: [0, 0] as const,
        },
        {
          constraintId: "constraint_h_slider" as const,
          kind: "horizontal" as const,
          label: "Slider horizontal",
          entityId: "sketch_entity_slider" as const,
        },
      ],
      dimensionIds: [],
      dimensions: [],
    };
  }

  // The free square plus a completely disconnected second line far away.
  function twoIndependentComponentsDefinition(): SketchDefinition {
    const base = freeSquareDefinition();
    return {
      ...base,
      pointIds: [...base.pointIds, "far_p", "far_q"],
      points: [...base.points, point("far_p", 50, 50), point("far_q", 55, 53)],
      entityIds: [...base.entityIds, "sketch_entity_far"],
      entities: [...base.entities, line("sketch_entity_far", "far_p", "far_q")],
    };
  }

  function solvedPoints(
    result: ReturnType<typeof solveSketchDefinitionWithDraggedPointTarget>,
  ) {
    expect(
      result.solvedSnapshot,
      "Every drag result should carry a solved snapshot.",
    ).toBeTruthy();
    return new Map(
      result.solvedSnapshot!.solvedPoints.map((entry) => [
        entry.pointId,
        entry.solvedPosition,
      ]),
    );
  }

  function assertHardConstraintsSatisfied(
    result: ReturnType<typeof solveSketchDefinitionWithDraggedPointTarget>,
    message: string,
  ) {
    const snapshot = result.solvedSnapshot!;
    expect(
      snapshot.constraintStatuses.every(
        (status) => status.status === "satisfied",
      ),
      `${message} All authored constraints must be satisfied.`,
    ).toBeTruthy();
    expect(
      snapshot.dimensionStatuses.every(
        (status) => status.status !== "unsatisfied",
      ),
      `${message} No authored dimension may be unsatisfied.`,
    ).toBeTruthy();
  }

  // (a) Accepted frames always satisfy the hard constraints.
  function testAcceptedFramesSatisfyHardConstraints() {
    const definition = freeSquareDefinition();
    for (const cursor of [
      [4, 3],
      [-2, 5],
      [10, -7],
    ] as const) {
      const result = solveSketchDefinitionWithDraggedPointTarget({
        definition,
        dragTarget: { kind: "sketchPoint", pointId: "sq_b", position: cursor },
        tolerances,
        partialSolvePolicy: "failOnConflict",
        targetTolerance: 1e-4,
      });
      expect(
        result.kind,
        `Free square drag to ${cursor.join(", ")} should be accepted.`,
      ).toBe("solved");
      assertHardConstraintsSatisfied(
        result,
        `Free square drag to ${cursor.join(", ")}:`,
      );
    }
  }

  // (b) Frame-to-frame solution delta is bounded relative to the cursor delta;
  //     a searched flip would violate this by jumping across the manifold.
  function testFrameToFrameContinuityIsBounded() {
    const program = compileSketchSolveProgram({
      definition: freeSquareDefinition(),
      tolerances,
      partialSolvePolicy: "failOnConflict",
    });
    const session = createCompiledSketchSolveSession({
      sessionId: "interactive_sketch_solve_continuity",
      program,
    });

    let previous: readonly [number, number] = [1, 0];
    for (let step = 1; step <= 20; step += 1) {
      const cursor: [number, number] = [1 + step * 0.25, step * 0.15];
      const result = updateCompiledSketchSolveSession(
        session,
        { kind: "sketchPoint", pointId: "sq_b", position: cursor },
        1e-4,
      );
      expect(
        result.kind,
        `Continuity drag step ${step} should stay accepted.`,
      ).toBe("solved");
      const solved = result.solvedSnapshot.solvedPoints.find(
        (entry) => entry.pointId === "sq_b",
      )!.solvedPosition;
      const cursorDelta = Math.hypot(cursor[0] - previous[0], cursor[1] - previous[1]);
      const solvedDelta = Math.hypot(
        solved[0] - previous[0],
        solved[1] - previous[1],
      );
      expect(
        solvedDelta <= 2 * cursorDelta + 1e-6,
        `Continuity drag step ${step}: solved delta ${solvedDelta.toFixed(4)} must stay bounded by cursor delta ${cursorDelta.toFixed(4)} (no discontinuous flip).`,
      ).toBeTruthy();
      previous = [solved[0], solved[1]];
    }
  }

  // (c) A drag is never refused while the grabbed target still has a free DOF:
  //     an off-axis pull slides the endpoint along its remaining DOF.
  function testPartiallyConstrainedDragSlidesInsteadOfBlocking() {
    const result = solveSketchDefinitionWithDraggedPointTarget({
      definition: horizontalSliderDefinition(),
      dragTarget: { kind: "sketchPoint", pointId: "sl_b", position: [5, 4] },
      tolerances,
      partialSolvePolicy: "failOnConflict",
      targetTolerance: 1e-4,
    });
    expect(
      result.kind,
      "A partially constrained endpoint with free DOF must slide, not block.",
    ).toBe("solved");
    assertHardConstraintsSatisfied(result, "Slider drag:");
    const points = solvedPoints(result);
    const solvedB = points.get("sl_b")!;
    expect(
      Math.abs(solvedB[1]) < 1e-4,
      `Slider endpoint must stay on the x-axis; got y=${solvedB[1]}.`,
    ).toBeTruthy();
    expect(
      solvedB[0] > 2,
      `Slider endpoint should slide toward the cursor along x; got x=${solvedB[0]}.`,
    ).toBeTruthy();
  }

  // (d) Minimum motion: geometry not forced by a constraint chain does not move.
  function testUnforcedGeometryStaysPut() {
    const definition = twoIndependentComponentsDefinition();
    const before = new Map(
      definition.points.map((entry) => [entry.pointId, entry.position]),
    );
    const result = solveSketchDefinitionWithDraggedPointTarget({
      definition,
      dragTarget: { kind: "sketchPoint", pointId: "sq_b", position: [6, 5] },
      tolerances,
      partialSolvePolicy: "failOnConflict",
      targetTolerance: 1e-4,
    });
    expect(
      result.kind,
      "Dragging one component should be accepted.",
    ).toBe("solved");
    const points = solvedPoints(result);
    for (const farPointId of ["far_p", "far_q"] as const) {
      const original = before.get(farPointId)!;
      const solved = points.get(farPointId)!;
      const drift = Math.hypot(solved[0] - original[0], solved[1] - original[1]);
      expect(
        drift < 1e-9,
        `Unforced ${farPointId} must not drift during the drag; drifted ${drift}.`,
      ).toBeTruthy();
    }
  }

  // Free-DOF detection is direction-independent: it reflects whether the target
  // can move at all, not whether a particular pull happens to move it. This is
  // the seam D6 feedback keys off, so an endpoint that only slides along x still
  // reports a free DOF (a straight-up pull must not read as "fully constrained").
  function testFreeDofProbeReflectsMobilityNotPullDirection() {
    const sliderProgram = compileSketchSolveProgram({
      definition: horizontalSliderDefinition(),
      tolerances,
      partialSolvePolicy: "failOnConflict",
    });
    const sliderSession = createCompiledSketchSolveSession({
      sessionId: "interactive_sketch_solve_dof_slider",
      program: sliderProgram,
    });
    expect(
      sketchDraggedPointHasFreeDof(sliderSession, "sl_b" as `sketch_point_${string}`),
      "A slider endpoint with an x degree of freedom must report free DOF.",
    ).toBe(true);
    expect(
      sketchDraggedPointHasFreeDof(sliderSession, "sl_a" as `sketch_point_${string}`),
      "A pinned point must report no free DOF.",
    ).toBe(false);

    const squareProgram = compileSketchSolveProgram({
      definition: freeSquareDefinition(),
      tolerances,
      partialSolvePolicy: "failOnConflict",
    });
    const squareSession = createCompiledSketchSolveSession({
      sessionId: "interactive_sketch_solve_dof_square",
      program: squareProgram,
    });
    expect(
      sketchDraggedPointHasFreeDof(squareSession, "sq_b" as `sketch_point_${string}`),
      "A free-position square vertex must report free DOF.",
    ).toBe(true);
  }

  testAcceptedFramesSatisfyHardConstraints();
  testFrameToFrameContinuityIsBounded();
  testPartiallyConstrainedDragSlidesInsteadOfBlocking();
  testUnforcedGeometryStaysPut();
  testFreeDofProbeReflectsMobilityNotPullDirection();
});
