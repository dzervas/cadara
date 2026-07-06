import { test, expect } from "vitest";

import type { SketchEntityId } from "@/contracts/shared/ids";
import type { SketchPoint2D } from "@/contracts/sketch/schema";
import {
  OFFSET_DIAGNOSTIC_CODES,
  OFFSET_SPLINE_RELATIVE_TOLERANCE,
  computeOffsetChain,
  offsetSplineFitPoints,
  type OffsetSeedCurve,
} from "@/contracts/sketch/offset-geometry";

test("src/contracts/sketch/offset-geometry.spec.ts", () => {
  const id = (value: string) => value as SketchEntityId;

  function line(
    seed: string,
    start: SketchPoint2D,
    end: SketchPoint2D,
  ): OffsetSeedCurve {
    return { kind: "lineSegment", seedEntityId: id(seed), start, end };
  }

  function arc(
    seed: string,
    center: SketchPoint2D,
    start: SketchPoint2D,
    end: SketchPoint2D,
    sweepDirection: "clockwise" | "counterClockwise",
  ): OffsetSeedCurve {
    return { kind: "arc", seedEntityId: id(seed), center, start, end, sweepDirection };
  }

  function expectClose(
    actual: SketchPoint2D | undefined,
    expected: SketchPoint2D,
    label: string,
  ) {
    expect(actual, `${label} should exist.`).toBeTruthy();
    expect(actual![0], `${label} x`).toBeCloseTo(expected[0], 6);
    expect(actual![1], `${label} y`).toBeCloseTo(expected[1], 6);
  }

  function testAnalyticCurvesOffsetExactly() {
    const leftLine = computeOffsetChain({
      curves: [line("seed_line", [0, 0], [4, 0])],
      distance: 1,
    });
    expect(leftLine.ok, "Positive line offset should succeed.").toBeTruthy();
    if (leftLine.ok) {
      const segment = leftLine.segments[0]!;
      expect(segment.kind, "Line offsets stay lines.").toBe("lineSegment");
      if (segment.kind === "lineSegment") {
        expectClose(segment.start, [0, 1], "Left line offset start");
        expectClose(segment.end, [4, 1], "Left line offset end");
      }
    }

    const rightLine = computeOffsetChain({
      curves: [line("seed_line", [0, 0], [4, 0])],
      distance: -1,
    });
    if (rightLine.ok && rightLine.segments[0]!.kind === "lineSegment") {
      expectClose(
        (rightLine.segments[0] as { start: SketchPoint2D }).start,
        [0, -1],
        "Negative line offset start",
      );
    }

    const shrunkCircle = computeOffsetChain({
      curves: [
        { kind: "circle", seedEntityId: id("seed_circle"), center: [1, 1], radius: 2 },
      ],
      distance: 0.5,
    });
    expect(shrunkCircle.ok, "Circle offset should succeed.").toBeTruthy();
    if (shrunkCircle.ok && shrunkCircle.segments[0]!.kind === "circle") {
      expect(
        (shrunkCircle.segments[0] as { radius: number }).radius,
        "Positive distance offsets left of ccw travel and shrinks the circle.",
      ).toBeCloseTo(1.5, 9);
    }

    const grownCircle = computeOffsetChain({
      curves: [
        { kind: "circle", seedEntityId: id("seed_circle"), center: [1, 1], radius: 2 },
      ],
      distance: -1,
    });
    if (grownCircle.ok && grownCircle.segments[0]!.kind === "circle") {
      expect(
        (grownCircle.segments[0] as { radius: number }).radius,
        "Negative distance grows the circle.",
      ).toBeCloseTo(3, 9);
    }

    const shrunkArc = computeOffsetChain({
      curves: [arc("seed_arc", [0, 0], [2, 0], [0, 2], "counterClockwise")],
      distance: 0.5,
    });
    expect(shrunkArc.ok, "Arc offset should succeed.").toBeTruthy();
    if (shrunkArc.ok && shrunkArc.segments[0]!.kind === "arc") {
      const segment = shrunkArc.segments[0] as {
        start: SketchPoint2D;
        end: SketchPoint2D;
        sweepDirection: string;
      };
      expectClose(segment.start, [1.5, 0], "Shrunk ccw arc start");
      expectClose(segment.end, [0, 1.5], "Shrunk ccw arc end");
      expect(
        segment.sweepDirection,
        "Offset arcs keep the seed sweep direction.",
      ).toBe("counterClockwise");
    }

    const grownCwArc = computeOffsetChain({
      curves: [arc("seed_arc", [0, 0], [2, 0], [0, 2], "clockwise")],
      distance: 0.5,
    });
    if (grownCwArc.ok && grownCwArc.segments[0]!.kind === "arc") {
      expectClose(
        (grownCwArc.segments[0] as { start: SketchPoint2D }).start,
        [2.5, 0],
        "Grown cw arc start",
      );
    }
  }

  function testDegeneracyDiagnostics() {
    const collapsedCircle = computeOffsetChain({
      curves: [
        { kind: "circle", seedEntityId: id("seed_circle"), center: [0, 0], radius: 2 },
      ],
      distance: 2,
    });
    expect(
      !collapsedCircle.ok && collapsedCircle.code,
      "Circle collapse should report the arc-collapse diagnostic.",
    ).toBe(OFFSET_DIAGNOSTIC_CODES.arcCollapse);
    expect(
      !collapsedCircle.ok && collapsedCircle.seedEntityId,
      "Circle collapse should name the failing seed.",
    ).toBe(id("seed_circle"));

    const collapsedArc = computeOffsetChain({
      curves: [arc("seed_arc", [0, 0], [2, 0], [0, 2], "counterClockwise")],
      distance: 2,
    });
    expect(
      !collapsedArc.ok && collapsedArc.code,
      "Arc collapse should report the arc-collapse diagnostic.",
    ).toBe(OFFSET_DIAGNOSTIC_CODES.arcCollapse);

    const zeroDistance = computeOffsetChain({
      curves: [line("seed_line", [0, 0], [4, 0])],
      distance: 0,
    });
    expect(
      !zeroDistance.ok && zeroDistance.code,
      "Zero distance should report the unresolved-distance diagnostic.",
    ).toBe(OFFSET_DIAGNOSTIC_CODES.unresolvedDistance);

    const disconnected = computeOffsetChain({
      curves: [line("seed_a", [0, 0], [1, 0]), line("seed_b", [5, 5], [6, 5])],
      distance: 1,
    });
    expect(
      !disconnected.ok && disconnected.code,
      "Disconnected selections should report the disconnected-chain diagnostic.",
    ).toBe(OFFSET_DIAGNOSTIC_CODES.disconnectedChain);

    const circleInChain = computeOffsetChain({
      curves: [
        line("seed_a", [0, 0], [1, 0]),
        { kind: "circle", seedEntityId: id("seed_circle"), center: [2, 0], radius: 1 },
      ],
      distance: 0.25,
    });
    expect(
      !circleInChain.ok && circleInChain.code,
      "A circle mixed into a chain should report the disconnected-chain diagnostic.",
    ).toBe(OFFSET_DIAGNOSTIC_CODES.disconnectedChain);

    const branching = computeOffsetChain({
      curves: [
        line("seed_a", [0, 0], [2, 0]),
        line("seed_b", [2, 0], [4, 0]),
        line("seed_c", [2, 0], [2, 2]),
      ],
      distance: 0.25,
    });
    expect(
      !branching.ok && branching.code,
      "Branching selections should report the disconnected-chain diagnostic.",
    ).toBe(OFFSET_DIAGNOSTIC_CODES.disconnectedChain);

    const inverted = computeOffsetChain({
      curves: [
        line("seed_up", [0, 0], [0, 4]),
        line("seed_top", [0, 4], [2, 4]),
        line("seed_down", [2, 4], [2, 0]),
      ],
      distance: -1.5,
    });
    expect(
      !inverted.ok && inverted.code,
      "An offset inverting a trimmed segment should report self-intersection.",
    ).toBe(OFFSET_DIAGNOSTIC_CODES.selfIntersection);
  }

  function testJointResolution() {
    const trimmed = computeOffsetChain({
      curves: [
        line("seed_ab", [0, 0], [4, 0]),
        line("seed_cb", [4, 4], [4, 0]),
      ],
      distance: 1,
    });
    expect(trimmed.ok, "Inside corner offset should succeed.").toBeTruthy();
    if (trimmed.ok) {
      expect(
        trimmed.joints.length,
        "Inside corners trim instead of adding joint arcs.",
      ).toBe(0);
      const first = trimmed.segments.find(
        (segment) => segment.seedEntityId === id("seed_ab"),
      );
      const second = trimmed.segments.find(
        (segment) => segment.seedEntityId === id("seed_cb"),
      );
      if (first?.kind === "lineSegment" && second?.kind === "lineSegment") {
        expectClose(first.start, [0, 1], "Trimmed chain start");
        expectClose(first.end, [3, 1], "Trimmed corner on first segment");
        expectClose(
          second.end,
          [3, 1],
          "Second segment keeps its natural direction and trims its natural end",
        );
        expectClose(second.start, [3, 4], "Trimmed chain natural start");
      }
    }

    const arcJoined = computeOffsetChain({
      curves: [
        line("seed_ab", [0, 0], [4, 0]),
        line("seed_bc", [4, 0], [4, 4]),
      ],
      distance: -1,
    });
    expect(arcJoined.ok, "Convex corner offset should succeed.").toBeTruthy();
    if (arcJoined.ok) {
      expect(
        arcJoined.joints.length,
        "Convex corners get an arc join.",
      ).toBe(1);
      const joint = arcJoined.joints[0]!;
      expect(joint.firstSeedEntityId, "Joint first seed identity").toBe(
        id("seed_ab"),
      );
      expect(joint.secondSeedEntityId, "Joint second seed identity").toBe(
        id("seed_bc"),
      );
      expectClose(joint.center, [4, 0], "Joint arc centers on the seed vertex");
      expectClose(joint.start, [4, -1], "Joint arc starts at the first offset end");
      expectClose(joint.end, [5, 0], "Joint arc ends at the second offset start");
      expect(
        Math.hypot(joint.start[0] - joint.center[0], joint.start[1] - joint.center[1]),
        "Joint arc radius equals |distance|.",
      ).toBeCloseTo(1, 9);
      expect(joint.sweepDirection, "Joint sweeps the short way").toBe(
        "counterClockwise",
      );
    }

    const tangent = computeOffsetChain({
      curves: [
        line("seed_line", [0, 0], [4, 0]),
        arc("seed_arc", [4, 1], [4, 0], [5, 1], "counterClockwise"),
      ],
      distance: -1,
    });
    expect(tangent.ok, "Tangent chain offset should succeed.").toBeTruthy();
    if (tangent.ok) {
      expect(
        tangent.joints.length,
        "Tangent-continuous joints need no arc join.",
      ).toBe(0);
      const lineSegment = tangent.segments.find(
        (segment) => segment.seedEntityId === id("seed_line"),
      );
      const arcSegment = tangent.segments.find(
        (segment) => segment.seedEntityId === id("seed_arc"),
      );
      if (lineSegment?.kind === "lineSegment" && arcSegment?.kind === "arc") {
        expectClose(
          arcSegment.start,
          lineSegment.end,
          "Tangent joint keeps offsets coincident",
        );
      }
    }

    const lineArcTrim = computeOffsetChain({
      curves: [
        line("seed_line", [0, 0], [4, 0]),
        arc("seed_arc", [2, -2], [4, 0], [2 + Math.sqrt(8), -2], "clockwise"),
      ],
      distance: -1,
    });
    expect(lineArcTrim.ok, "Line-arc inside corner should trim.").toBeTruthy();
    if (lineArcTrim.ok) {
      expect(
        lineArcTrim.joints.length,
        "Trimmed line-arc corner adds no joint arc.",
      ).toBe(0);
      const lineSegment = lineArcTrim.segments.find(
        (segment) => segment.seedEntityId === id("seed_line"),
      );
      const arcSegment = lineArcTrim.segments.find(
        (segment) => segment.seedEntityId === id("seed_arc"),
      );
      if (lineSegment?.kind === "lineSegment" && arcSegment?.kind === "arc") {
        expectClose(
          arcSegment.start,
          lineSegment.end,
          "Line-arc trim moves both endpoints to the intersection",
        );
        expect(
          lineSegment.end[1],
          "Line stays on its offset height after the trim.",
        ).toBeCloseTo(-1, 9);
        expect(
          Math.hypot(
            arcSegment.start[0] - arcSegment.center[0],
            arcSegment.start[1] - arcSegment.center[1],
          ),
          "Arc endpoint stays on the offset radius after the trim.",
        ).toBeCloseTo(Math.sqrt(8) - 1, 9);
      }
    }
  }

  function testClosedLoops() {
    const square = [
      line("seed_ab", [0, 0], [4, 0]),
      line("seed_bc", [4, 0], [4, 4]),
      line("seed_cd", [4, 4], [0, 4]),
      line("seed_da", [0, 4], [0, 0]),
    ];

    const inward = computeOffsetChain({ curves: square, distance: 1 });
    expect(inward.ok, "Inward square offset should succeed.").toBeTruthy();
    if (inward.ok) {
      expect(inward.closed, "Square chain should close.").toBeTruthy();
      expect(inward.joints.length, "Inward square corners all trim.").toBe(0);
      const first = inward.segments[0]!;
      if (first.kind === "lineSegment") {
        expectClose(first.start, [1, 1], "Inward square corner");
        expectClose(first.end, [3, 1], "Inward square corner");
      }
    }

    const outward = computeOffsetChain({ curves: square, distance: -1 });
    expect(outward.ok, "Outward square offset should succeed.").toBeTruthy();
    if (outward.ok) {
      expect(
        outward.joints.length,
        "Outward square gets an arc join at every corner.",
      ).toBe(4);
      const first = outward.segments[0]!;
      if (first.kind === "lineSegment") {
        expectClose(first.start, [0, -1], "Outward square segment start");
        expectClose(first.end, [4, -1], "Outward square segment end");
      }
    }

    const overshoot = computeOffsetChain({ curves: square, distance: 2.5 });
    expect(
      !overshoot.ok && overshoot.code,
      "Collapsing a closed loop should report self-intersection.",
    ).toBe(OFFSET_DIAGNOSTIC_CODES.selfIntersection);
  }

  function testSplineToleranceConformance() {
    const seedPoints: SketchPoint2D[] = Array.from({ length: 9 }, (_, index) => {
      const angle = (Math.PI / 2) * (index / 8);
      return [Math.cos(angle) * 4, Math.sin(angle) * 4];
    });

    function distanceToPolyline(
      point: SketchPoint2D,
      polyline: readonly SketchPoint2D[],
    ) {
      let best = Number.POSITIVE_INFINITY;
      for (let index = 0; index + 1 < polyline.length; index += 1) {
        const [sx, sy] = polyline[index]!;
        const [ex, ey] = polyline[index + 1]!;
        const dx = ex - sx;
        const dy = ey - sy;
        const lengthSquared = dx * dx + dy * dy;
        const t =
          lengthSquared === 0
            ? 0
            : Math.max(
                0,
                Math.min(
                  1,
                  ((point[0] - sx) * dx + (point[1] - sy) * dy) / lengthSquared,
                ),
              );
        best = Math.min(
          best,
          Math.hypot(point[0] - (sx + dx * t), point[1] - (sy + dy * t)),
        );
      }
      return best;
    }

    const offset = offsetSplineFitPoints({ points: seedPoints, distance: 0.5 });
    expect(offset.ok, "Smooth spline offset should conform.").toBeTruthy();
    if (offset.ok) {
      const tolerance = 0.5 * OFFSET_SPLINE_RELATIVE_TOLERANCE;
      for (const point of offset.points) {
        const separation = distanceToPolyline(point, seedPoints);
        expect(
          Math.abs(separation - 0.5) <= tolerance + 1e-6,
          `Offset spline point should stay within tolerance of the true offset (separation ${separation}).`,
        ).toBeTruthy();
      }
    }

    const zigzag: SketchPoint2D[] = [
      [0, 0],
      [1, 2],
      [2, -1],
      [3, 2.5],
      [4, -0.5],
      [5, 2],
    ];
    const frozen = offsetSplineFitPoints({
      points: zigzag,
      distance: 1,
      targetPointCount: 3,
    });
    expect(
      !frozen.ok,
      "A frozen fit-point count too small for the seed should fail instead of returning an out-of-tolerance result.",
    ).toBeTruthy();

    const chainWithFrozenSpline = computeOffsetChain({
      curves: [
        {
          kind: "spline",
          seedEntityId: id("seed_spline"),
          points: zigzag,
        },
      ],
      distance: 1,
      splineFitPointCounts: new Map([[id("seed_spline"), 3]]),
    });
    expect(
      !chainWithFrozenSpline.ok && chainWithFrozenSpline.code,
      "Spline fit failure should surface the spline-fit diagnostic.",
    ).toBe(OFFSET_DIAGNOSTIC_CODES.splineFitFailure);

    const adaptive = computeOffsetChain({
      curves: [
        { kind: "spline", seedEntityId: id("seed_spline"), points: seedPoints },
      ],
      distance: 0.5,
    });
    expect(adaptive.ok, "Adaptive spline offset should succeed.").toBeTruthy();
    if (adaptive.ok && adaptive.segments[0]!.kind === "spline") {
      expect(
        (adaptive.segments[0] as { points: readonly SketchPoint2D[] }).points
          .length >= 3,
        "Offset splines keep a valid fit-point count.",
      ).toBeTruthy();
    }
  }

  function testTraversalAnchoring() {
    const anchoredForward = computeOffsetChain({
      curves: [
        line("seed_ab", [0, 0], [4, 0]),
        line("seed_bc", [4, 0], [4, 4]),
      ],
      distance: 1,
    });
    const anchoredMidChain = computeOffsetChain({
      curves: [
        line("seed_bc", [4, 0], [4, 4]),
        line("seed_ab", [0, 0], [4, 0]),
      ],
      distance: 1,
    });
    expect(
      anchoredForward.ok && anchoredMidChain.ok,
      "Both selection orders should offset.",
    ).toBeTruthy();
    if (anchoredForward.ok && anchoredMidChain.ok) {
      const forwardBc = anchoredForward.segments.find(
        (segment) => segment.seedEntityId === id("seed_bc"),
      );
      const midBc = anchoredMidChain.segments.find(
        (segment) => segment.seedEntityId === id("seed_bc"),
      );
      if (forwardBc?.kind === "lineSegment" && midBc?.kind === "lineSegment") {
        expectClose(
          midBc.end,
          forwardBc.end,
          "Anchoring to the first seed's natural direction keeps the same side for the same traversal",
        );
      }
    }
  }

  testAnalyticCurvesOffsetExactly();
  testDegeneracyDiagnostics();
  testJointResolution();
  testClosedLoops();
  testSplineToleranceConformance();
  testTraversalAnchoring();
});
