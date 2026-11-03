import { expect, test } from "vitest";
import {
  dragSession,
  forcedCursor,
  onBranch,
  OUT_AND_BACK,
  positionOf,
  preview,
  R1_GRABBED,
  r1Cursor,
  roundedRectangle,
  tangentSides,
} from "./constrained-drag-branch.fixtures";
import type { Point } from "./constrained-drag-branch.fixtures";
import { traceSketchSolverForTest } from "./solve-tracing";

// Logic lane, compiled drag session seam: the rounded-rectangle gestures of
// the constrained drag step's branch rule (policy "block", invariants derived
// from the rows, no entity guard), 16 frames out and 16 back. Heavy tier:
// several seconds per gesture.

test("R-1 under the constrained step: a fillet never collapses or flips, the forward drag is refused before it would, and the drag back follows the cursor", () => {
  const session = dragSession(roundedRectangle(), "constrained");
  const start = tangentSides(session);
  let lastAcceptedForward = 0;
  const trace: string[] = [];
  OUT_AND_BACK.forEach((step, index) => {
    const cursor = r1Cursor(step);
    const { result, work } = traceSketchSolverForTest(() =>
      preview(session, R1_GRABBED, cursor),
    );
    if (result.kind === "blocked") {
      expect(
        work.constrainedStepIterations,
        `frame ${index + 1}: refusal costs no more outer iterations than an accepted frame`,
      ).toBeLessThanOrEqual(5);
      expect(
        work.constrainedStepNewtonIterations,
        `frame ${index + 1}: refusal does not repeatedly land on the boundary`,
      ).toBeLessThanOrEqual(32);
    }
    trace.push(`${step}:${result.kind}`);
    expect(
      onBranch(tangentSides(session), start),
      `frame ${index + 1}: the accepted fillets keep their sides and radius ≥ τ (${trace.join(" ")})`,
    ).toBe(true);
    if (result.kind === "solved" && index < 16) lastAcceptedForward = step;
    if (index >= 16 && step <= lastAcceptedForward) {
      expect(result.kind, `back frame ${index + 1} (${trace.join(" ")})`).toBe(
        "solved",
      );
      const at = positionOf(session.lastAcceptedSnapshot, R1_GRABBED);
      expect(
        Math.hypot(at[0] - cursor[0], at[1] - cursor[1]),
        `back frame ${index + 1} follows the cursor`,
      ).toBeLessThan(1e-3);
    }
  });
  expect(
    lastAcceptedForward,
    `premise: the forward drag is refused before its end (${trace.join(" ")})`,
  ).toBeLessThan(16);
  expect(lastAcceptedForward).toBeGreaterThan(1);
});

test("forced collapse under the constrained step: no accepted frame collapses or flips a fillet, a frame before the forced boundary is refused, and the drag back follows the cursor", () => {
  // Every point at y ≥ 0.5 fixed: past y ≈ 0.6 only the mirrored fillets
  // solve, so the forward drag must be refused there.
  const session = dragSession(roundedRectangle(true), "constrained");
  const start = tangentSides(session);
  let lastAcceptedForward = 0;
  const kinds: string[] = [];
  OUT_AND_BACK.forEach((step, index) => {
    const cursor = forcedCursor(step);
    const { result, work } = traceSketchSolverForTest(() =>
      preview(session, R1_GRABBED, cursor),
    );
    if (result.kind === "blocked") {
      expect(
        work.constrainedStepIterations,
        `frame ${index + 1}: refusal costs no more outer iterations than an accepted frame`,
      ).toBeLessThanOrEqual(5);
      expect(
        work.constrainedStepNewtonIterations,
        `frame ${index + 1}: refusal does not repeatedly land on the boundary`,
      ).toBeLessThanOrEqual(32);
    }
    kinds.push(result.kind);
    expect(
      onBranch(tangentSides(session), start),
      `step ${step}: the accepted fillets keep their sides and radius ≥ τ (${kinds.join(",")})`,
    ).toBe(true);
    if (result.kind === "solved" && index < 16) lastAcceptedForward = step;
    if (index >= 16 && step <= lastAcceptedForward) {
      expect(result.kind, `back frame ${index + 1} (${kinds.join(",")})`).toBe(
        "solved",
      );
      const at = positionOf(session.lastAcceptedSnapshot, R1_GRABBED);
      expect(
        Math.hypot(at[0] - cursor[0], at[1] - cursor[1]),
        `back frame ${index + 1} follows the cursor`,
      ).toBeLessThan(1e-3);
    }
  });
  expect(
    lastAcceptedForward,
    `premise: a forward frame is refused (${kinds.join(",")})`,
  ).toBeLessThan(16);
});

test("R-1 under the constrained step does not depend on where the sketch sits: translated by (1e4, 1e4) every frame has the same verdict", () => {
  const verdicts = (origin: Point) => {
    const session = dragSession(roundedRectangle(false, origin), "constrained");
    const grabbed = session.program.definition.points.find(
      (point) => point.pointId === R1_GRABBED,
    )!.position;
    return OUT_AND_BACK.map((step) => {
      const cursor = r1Cursor(step);
      return preview(session, R1_GRABBED, [
        grabbed[0] + cursor[0] - 0.2,
        grabbed[1] + cursor[1],
      ]).kind;
    });
  };
  const atOrigin = verdicts([0, 0]);
  expect(atOrigin, "premise: a forward frame is refused").toContain("blocked");
  expect(verdicts([1e4, 1e4])).toEqual(atOrigin);
}, 60_000);
