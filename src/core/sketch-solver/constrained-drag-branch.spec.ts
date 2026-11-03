import { expect, test } from "vitest";
import {
  dragSession,
  onBranch,
  OUT_AND_BACK,
  pid,
  positionOf,
  preview,
  R1_GRABBED,
  r1Cursor,
  release,
  roundedRectangle,
  slot,
  tangentArc,
  tangentSides,
  TAU,
  translate,
} from "./constrained-drag-branch.fixtures";
import type { Point } from "./constrained-drag-branch.fixtures";
import { solveBfgsOver } from "./bfgs";
import { BRANCH_BOUNDARY_TOLERANCES } from "./constrained-drag-stage";
import {
  materializeDraggedPointCandidate,
  reevaluateDraggedPointCandidate,
} from "./drag-candidates";
import type { SketchDragStep } from "./solve-types";
import { traceSketchSolverForTest } from "./solve-tracing";
import type { ScalarConstraintRecord } from "./system-types";
import { isAcceptedConstraintStatus } from "@/contracts/sketch/schema";

// Logic lane, compiled drag session seam: the constrained drag step's
// branch rule (policy "block", invariants derived from the rows, no entity
// guard). The rounded-rectangle gestures are in
// constrained-drag-branch.heavy.spec.ts.

test("a constrained frame stopped on a branch invariant is refused and the session keeps the last accepted values", () => {
  const session = dragSession(roundedRectangle(), "constrained");
  for (let step = 1; step <= 16; step += 1) {
    const values = session.values;
    const snapshot = session.lastAcceptedSnapshot;
    const traced = traceSketchSolverForTest(() =>
      preview(session, R1_GRABBED, r1Cursor(step)),
    );
    if (traced.result.kind === "solved") {
      // A fillet's invariant floor is τ: a step held there (within the
      // boundary band) is refused, so no accepted frame parks a fillet on it.
      expect(
        Math.min(...tangentSides(session).map(Math.abs)),
        `frame ${step}: no accepted fillet sits on its boundary`,
      ).toBeGreaterThan(TAU * (1 + BRANCH_BOUNDARY_TOLERANCES));
      continue;
    }
    expect(traced.result.kind, `frame ${step}`).toBe("blocked");
    expect(
      traced.work.constrainedStepStages,
      "premise: the constrained step ran (no phase A/B fallback)",
    ).toBeGreaterThan(0);
    expect(traced.work.constrainedStepJacobianUnavailable).toBe(0);
    expect(traced.work.constrainedStepStartNotCorrectable).toBe(0);
    expect(
      traced.work.constrainedStepStalledStops,
      "premise: the step moved (the refusal is the invariant's)",
    ).toBe(0);
    expect(session.values, "the accepted values are kept").toBe(values);
    expect(session.lastAcceptedSnapshot, "the accepted snapshot is kept").toBe(
      snapshot,
    );
    expect(traced.result.solvedSnapshot).toBe(snapshot);
    return;
  }
  throw new Error("premise: a forward frame is refused");
});

test("the exact-reach release under the constrained step cannot cross a branch invariant", () => {
  // The centre of an arc tangent to a fixed line, released at its mirror
  // image across the line: the step finds no same-branch motion toward it
  // (accepted where it is), and the release's projection with the centre
  // pinned at the cursor is satisfied only by the mirrored branch.
  const session = dragSession(tangentArc(), "constrained");
  const start = tangentSides(session);
  const centre = pid("c");
  const traced = traceSketchSolverForTest(() =>
    release(session, centre, [1, -0.5]),
  );
  expect(traced.result.kind).toBe("solved");
  // The constrained step ran (no phase A/B fallback), so every BFGS
  // iteration is the exact-reach projection's.
  expect(traced.work.constrainedStepStages).toBeGreaterThan(0);
  expect(traced.work.constrainedStepJacobianUnavailable).toBe(0);
  expect(traced.work.constrainedStepStartNotCorrectable).toBe(0);
  expect(
    traced.work.bfgsIterations,
    "premise: the exact-reach projection ran",
  ).toBeGreaterThan(0);
  expect(
    onBranch(tangentSides(session), start),
    "the arc stays on its side of the line",
  ).toBe(true);
  const [x, y] = positionOf(session.lastAcceptedSnapshot, centre);
  expect(
    Math.hypot(x - 1, y - 0.5),
    "the release keeps the accepted centre",
  ).toBeLessThan(1e-9);
});

test("the arc flip guard decides drag acceptance only without the constrained step", () => {
  const guardEvaluations = (dragStep: SketchDragStep) => {
    const session = dragSession(roundedRectangle(), dragStep);
    return traceSketchSolverForTest(() => {
      for (let step = 1; step <= 3; step += 1)
        preview(session, R1_GRABBED, r1Cursor(step));
      return release(session, R1_GRABBED, r1Cursor(3));
    }).work.dragArcGuardEvaluations;
  };
  expect(
    guardEvaluations("penalty"),
    "premise: the counter sees the guard",
  ).toBeGreaterThan(0);
  expect(guardEvaluations("constrained")).toBe(0);
});

test("slot resize under the constrained step: the straight sides never reverse, and dragging back restores the slot", () => {
  const session = dragSession(slot(), "constrained");
  const endArc = [pid("e"), pid("le"), pid("re")];
  const sideLengths = () => {
    const at = (name: string) =>
      positionOf(session.lastAcceptedSnapshot, pid(name));
    return [at("le")[0] - at("ls")[0], at("rs")[0] - at("re")[0]];
  };
  const kinds: string[] = [];
  let cursor: Point = [4, 0];
  for (const step of OUT_AND_BACK) {
    cursor = [4 - (6 * step) / 16, 0];
    kinds.push(translate(session, endArc, cursor).kind);
    const [left, right] = sideLengths();
    expect(
      [left! > 0, right! < 0],
      `step ${step}: the sides keep their direction (${kinds.join(",")})`,
    ).toEqual([true, true]);
  }
  expect(kinds.slice(0, 16), "premise: a forward frame is refused").toContain(
    "blocked",
  );
  expect(translate(session, endArc, cursor, 1e-4).kind).toBe("solved");
  const [left] = sideLengths();
  expect(left, "the drag back restores the slot's length").toBeCloseTo(4, 3);
});

test("under the constrained step every re-check of a candidate refuses values off the accepted branch, so an offset rebuild cannot revive a refused frame", () => {
  // The re-checks (an offset rebuilt at a frame's end values, a zeroed
  // tangent) re-judge values through the frame acceptance alone. The
  // mirrored tangent arc satisfies every authored row; only the branch
  // invariant of the accepted frame refuses it.
  const session = dragSession(tangentArc(), "constrained");
  const centre = session.program.system.pointRecords.get(pid("c"))!;
  const pinned = Float64Array.from(session.values);
  pinned[centre.baseIndex] = 1;
  pinned[centre.baseIndex + 1] = -0.5;
  const mirrored = solveBfgsOver(
    pinned,
    session.program.system.scalarConstraints,
    {
      variableIndices:
        session.program.system.parameterProjection.authorityVariableIndices.filter(
          (index) =>
            index !== centre.baseIndex && index !== centre.baseIndex + 1,
        ),
    },
  ).values;
  const { materialized } = materializeDraggedPointCandidate(session, mirrored);
  expect(
    materialized.solvedSnapshot.constraintStatuses.every((status) =>
      isAcceptedConstraintStatus(status.status),
    ),
    "premise: the mirrored arc satisfies the authored rows",
  ).toBe(true);
  expect(reevaluateDraggedPointCandidate(session, mirrored).accepted).toBe(
    false,
  );
  expect(
    reevaluateDraggedPointCandidate(session, Float64Array.from(session.values))
      .accepted,
    "the accepted frame itself is accepted",
  ).toBe(true);
});

test("a constrained step that accepts no move yields no candidate: the frame is refused, not solved without motion", () => {
  // The tangency row gains a component satisfied only at the accepted values
  // with no gradient to correct along, so every trial of the step fails.
  const session = dragSession(tangentArc(), "constrained");
  const accepted = Float64Array.from(session.values);
  const atAccepted = (values: Float64Array) =>
    values.every((value, index) => value === accepted[index]);
  const rows = session.program.system.scalarConstraints;
  const tangency = rows.findIndex((row) => row.id.includes("tangent"));
  const original = rows[tangency]!;
  const stuck: ScalarConstraintRecord = {
    ...original,
    evaluateComponents: (values) => [
      ...original.evaluateComponents(values),
      atAccepted(values) ? 0 : 1,
    ],
    evaluateComponentJacobian: (values) => {
      const jacobian = original.evaluateComponentJacobian(values);
      return {
        ...jacobian,
        components: [...jacobian.components, atAccepted(values) ? 0 : 1],
        rows: [
          ...jacobian.rows,
          new Float64Array(session.program.system.parameterCount),
        ],
      };
    },
  };
  session.program = {
    ...session.program,
    system: {
      ...session.program.system,
      scalarConstraints: rows.map((row, index) =>
        index === tangency ? stuck : row,
      ),
    },
  };
  const traced = traceSketchSolverForTest(() =>
    release(session, pid("c"), [1.5, 0.5]),
  );
  expect(traced.work.constrainedStepStalledStops).toBe(1);
  expect(traced.result.kind).toBe("blocked");
  expect(session.values).toEqual(accepted);
});
