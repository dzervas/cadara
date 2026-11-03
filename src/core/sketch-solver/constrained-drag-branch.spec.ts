import { expect, test } from "vitest";
import {
  chamferCursor,
  chamferedRectangle,
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
  swingingSegment,
  tangentArc,
  tangentSides,
  TAU,
  translate,
} from "./constrained-drag-branch.fixtures";
import type { Point } from "./constrained-drag-branch.fixtures";
import { solveBfgsOver } from "./bfgs";
import {
  BRANCH_BOUNDARY_TOLERANCES,
  deriveDragBranchInvariants,
} from "./constrained-drag-stage";
import {
  materializeDraggedPointCandidate,
  reevaluateDraggedPointCandidate,
} from "./drag-candidates";
import type { SketchDragStep } from "./solve-types";
import { traceSketchSolverForTest } from "./solve-tracing";
import type { ScalarConstraintRecord } from "./system-types";
import { isAcceptedConstraintStatus } from "@/contracts/sketch/schema";

// Logic lane, compiled drag session seam: the constrained drag step's
// boundary rule (policy "block": a frame whose step reaches a branch
// invariant or validity margin is refused; margins derived from the rows, no
// entity guard). The rounded-rectangle gestures are in
// constrained-drag-branch.heavy.spec.ts.

test("a constrained frame whose step reaches a branch invariant is refused and the session keeps the last accepted values", () => {
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
    expect(traced.work.constrainedStepBoundaryRefusals).toBeGreaterThan(0);
    expect(
      traced.work.constrainedStepIterations,
      "a refused frame stops within the accepted frame's outer-iteration budget",
    ).toBeLessThanOrEqual(5);
    expect(
      traced.work.constrainedStepNewtonIterations,
      "a refused frame does not repeatedly correct trials onto an unpublished boundary",
    ).toBeLessThanOrEqual(32);
    expect(traced.work.constrainedStepBoundaryTrialRefusals).toBeGreaterThan(0);
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

test("under the constrained step a re-check refuses values that end on a validity boundary clear at the accepted frame, the end-state view of reaching it", () => {
  // A result with no step path (a projection, a re-check) shows only where
  // it ends: a segment that ends at length τ reached its boundary.
  const session = dragSession(swingingSegment(), "constrained");
  const free = session.program.system.pointRecords.get(pid("p"))!;
  const endingAt = (x: number, y: number) => {
    const values = Float64Array.from(session.values);
    values[free.baseIndex] = x;
    values[free.baseIndex + 1] = y;
    return reevaluateDraggedPointCandidate(session, values).accepted;
  };
  expect(endingAt(TAU, 0), "length τ: on the boundary").toBe(false);
  expect(endingAt(2 * TAU, 0), "length 2τ: clear of it").toBe(true);
  // A re-check sees no path: an end swung round (length 1) is accepted
  // however it got there. A straight move from a known candidate (the
  // exact-reach projection) is read along its way (`refusesMove`).
  expect(endingAt(-1, 0), "swung round, length 1").toBe(true);
});

test("a straight move from a candidate is refused when a validity margin dips below its boundary inside it, though both ends hold", () => {
  // The exact-reach projection's reading (`refusesMove`): the chamfer's lower
  // end moved straight past its fixed upper end folds the chamfer through
  // zero length; a move beside the fixed end does not.
  const session = dragSession(chamferedRectangle(), "constrained");
  const invariants = deriveDragBranchInvariants(
    session.program,
    session.program.system.scalarConstraints,
    session.values,
  );
  const lower = session.program.system.pointRecords.get(pid("ca"))!;
  const endingAt = (x: number, y: number) => {
    const values = Float64Array.from(session.values);
    values[lower.baseIndex] = x;
    values[lower.baseIndex + 1] = y;
    return values;
  };
  const folded = endingAt(2.3, 0.6);
  expect(invariants.refuses(folded), "premise: the end state holds").toBe(
    false,
  );
  expect(invariants.refusesMove(session.values, folded)).toBe(true);
  expect(
    invariants.refusesMove(session.values, endingAt(2.3, 0)),
    "beside the fixed end",
  ).toBe(false);
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

test("chamfer fold under the constrained step: the drag stops at the chamfer's length boundary, a frame across it is refused, and the drag back follows", () => {
  // Past (2, 0.3) the chamfer could only fold back; the step can get there
  // by sliding its free end round the fixed one at length τ (the length row
  // holds the whole way), so the step's path, not its end, decides.
  const session = dragSession(chamferedRectangle(), "constrained");
  const [ca, cb] = [pid("ca"), pid("cb")];
  const along = () => {
    const a = positionOf(session.lastAcceptedSnapshot, ca);
    const b = positionOf(session.lastAcceptedSnapshot, cb);
    return (b[0] - a[0] + (b[1] - a[1])) / Math.SQRT2;
  };
  let lastAcceptedForward = 0;
  const kinds: string[] = [];
  OUT_AND_BACK.forEach((step, index) => {
    const cursor = chamferCursor(step);
    const traced = traceSketchSolverForTest(() => preview(session, ca, cursor));
    kinds.push(traced.result.kind);
    expect(
      along(),
      `step ${step}: the chamfer keeps its direction and length ≥ τ (${kinds.join(",")})`,
    ).toBeGreaterThanOrEqual(TAU);
    if (index < 16 && step >= 8) {
      expect(
        traced.result.kind,
        `step ${step}: a frame at or past the fold is refused`,
      ).toBe("blocked");
      expect(
        traced.work.constrainedStepBoundaryRefusals,
        `step ${step}: refused at the boundary`,
      ).toBeGreaterThan(0);
    }
    if (traced.result.kind === "solved" && index < 16)
      lastAcceptedForward = step;
    if (index >= 16 && step <= lastAcceptedForward) {
      expect(traced.result.kind, `back step ${step} (${kinds.join(",")})`).toBe(
        "solved",
      );
      const at = positionOf(session.lastAcceptedSnapshot, ca);
      expect(
        Math.hypot(at[0] - cursor[0], at[1] - cursor[1]),
        `back step ${step} follows the cursor`,
      ).toBeLessThan(1e-3);
    }
  });
  expect(lastAcceptedForward, "premise: the drag reaches the fold").toBe(7);
});

test("a segment swung round its fixed end in large frames, never near zero length, is accepted every frame", () => {
  // Each frame turns the free end by 120°: the minimum-motion path is the
  // chord, at least 0.5 from the fixed end, so no boundary is reached.
  const session = dragSession(swingingSegment(), "constrained");
  for (let frame = 1; frame <= 6; frame += 1) {
    const angle = (frame * 2 * Math.PI) / 3;
    const cursor: Point = [Math.cos(angle), Math.sin(angle)];
    const traced = traceSketchSolverForTest(() =>
      preview(session, pid("p"), cursor),
    );
    expect(traced.result.kind, `frame ${frame}`).toBe("solved");
    expect(traced.work.constrainedStepBoundaryRefusals).toBe(0);
    const at = positionOf(session.lastAcceptedSnapshot, pid("p"));
    expect(Math.hypot(at[0] - cursor[0], at[1] - cursor[1])).toBeLessThan(1e-3);
  }
});

test("validity margins (segment length, radius ≥ τ): each analytic gradient matches central differences", () => {
  for (const definition of [chamferedRectangle(), tangentArc()]) {
    const session = dragSession(definition, "constrained");
    const validity = session.program.system.inequalities.filter(
      (inequality) => inequality.requirement === undefined,
    );
    expect(validity.length, "premise: validity rows exist").toBeGreaterThan(0);
    for (const inequality of validity) {
      const at = inequality.evaluate(session.values);
      for (const index of inequality.variableIndices) {
        const shifted = (delta: number) => {
          const values = Float64Array.from(session.values);
          values[index] += delta;
          return inequality.evaluate(values).components[0]!;
        };
        expect(at.rows[0]![index], `${inequality.id} ∂/∂x${index}`).toBeCloseTo(
          (shifted(1e-6) - shifted(-1e-6)) / 2e-6,
          5,
        );
      }
    }
  }
});
