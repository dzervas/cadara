import { test, expect, assert } from "vitest";

import type { SketchDefinition } from "@/contracts/sketch/schema";
import type { ProjectedSketchReferenceRecord } from "@/contracts/solver/schema";
import {
  collectSketchSnapGeometries,
  resolveSketchSnap,
  type SketchSnapGeometry,
} from "@/domain/sketch-snapping/snap-candidates";
import {
  makeSketchFixture,
  neutralSpan,
  projectedSpline,
} from "@/contracts/sketch/region-extraction.fixtures";
import { sketchSnapshotRecordForTest } from "@/contracts/sketch/region-record.fixtures";
import type { SketchEntityDefinition } from "@/contracts/sketch/schema";
import {
  createSketchSessionFromSnapshot,
  getSketchSessionDisplayRenderables,
} from "@/domain/editor/sketch-session";
import { withLiveSolveBasis } from "@/domain/editor/sketch-session/internals";
import {
  createStandardPlaneDefinition,
  OCC_KERNEL_SETTINGS,
} from "@/domain/modeling/opencascade-kernel-seed";
import {
  closestSplineSpanLocation,
  reconstructSplineAggregate,
  solvedCubicSpans,
  tessellateCubicSpans,
  type SolvedCubicSpan,
  type SplineVector,
} from "@/contracts/sketch/spline-geometry";

test("src/domain/sketch-snapping/snap-candidates.spec.ts", () => {
  function assertClosePoint(
    actual: readonly [number, number] | undefined,
    expected: readonly [number, number],
    message: string,
  ) {
    assert(actual, `${message} Missing point.`);
    const distance = Math.hypot(
      actual[0] - expected[0],
      actual[1] - expected[1],
    );
    expect(
      distance < 1e-6,
      `${message} Expected ${expected.join(", ")}, received ${actual.join(", ")}.`,
    ).toBeTruthy();
  }

  const definition: SketchDefinition = {
    schemaVersion: "sketch-definition/v1alpha2",
    referenceIds: [],
    references: [],
    pointIds: [
      "sketch_point_a",
      "sketch_point_b",
      "sketch_point_c",
      "sketch_point_d",
      "sketch_point_e",
      "sketch_point_f",
    ],
    points: [
      {
        pointId: "sketch_point_a",
        label: "A",
        target: {
          kind: "sketchPoint",
          sketchId: "sketch_primary",
          pointId: "sketch_point_a",
        },
        position: [0, 0],
        isConstruction: false,
      },
      {
        pointId: "sketch_point_b",
        label: "B",
        target: {
          kind: "sketchPoint",
          sketchId: "sketch_primary",
          pointId: "sketch_point_b",
        },
        position: [2, 0],
        isConstruction: false,
      },
      {
        pointId: "sketch_point_c",
        label: "C",
        target: {
          kind: "sketchPoint",
          sketchId: "sketch_primary",
          pointId: "sketch_point_c",
        },
        position: [4, 0],
        isConstruction: false,
      },
      {
        pointId: "sketch_point_d",
        label: "D",
        target: {
          kind: "sketchPoint",
          sketchId: "sketch_primary",
          pointId: "sketch_point_d",
        },
        position: [8, 0],
        isConstruction: false,
      },
      {
        pointId: "sketch_point_e",
        label: "E",
        target: {
          kind: "sketchPoint",
          sketchId: "sketch_primary",
          pointId: "sketch_point_e",
        },
        position: [9, 0],
        isConstruction: false,
      },
      {
        pointId: "sketch_point_f",
        label: "F",
        target: {
          kind: "sketchPoint",
          sketchId: "sketch_primary",
          pointId: "sketch_point_f",
        },
        position: [8, 1],
        isConstruction: false,
      },
    ],
    entityIds: [
      "sketch_entity_ab",
      "sketch_entity_circle",
      "sketch_entity_arc",
    ],
    entities: [
      {
        kind: "lineSegment",
        entityId: "sketch_entity_ab",
        label: "AB",
        target: {
          kind: "sketchEntity",
          sketchId: "sketch_primary",
          entityId: "sketch_entity_ab",
        },
        isConstruction: false,
        startPointId: "sketch_point_a",
        endPointId: "sketch_point_b",
      },
      {
        kind: "circle",
        entityId: "sketch_entity_circle",
        label: "Circle",
        target: {
          kind: "sketchEntity",
          sketchId: "sketch_primary",
          entityId: "sketch_entity_circle",
        },
        isConstruction: false,
        centerPointId: "sketch_point_c",
        radius: 1,
      },
      {
        kind: "arc",
        entityId: "sketch_entity_arc",
        label: "Arc",
        target: {
          kind: "sketchEntity",
          sketchId: "sketch_primary",
          entityId: "sketch_entity_arc",
        },
        isConstruction: false,
        centerPointId: "sketch_point_d",
        startPointId: "sketch_point_e",
        endPointId: "sketch_point_f",
        sweepDirection: "counterClockwise",
      },
    ],
    constraintIds: [],
    constraints: [],
    dimensionIds: [],
    dimensions: [],
  };
  const projectedReferences: ProjectedSketchReferenceRecord[] = [
    {
      referenceId: "ref_projected_line",
      status: "projected",
      geometry: [
        {
          geometryId: "projected_geometry_line",
          kind: "lineSegment",
          startPosition: [1, -1],
          endPosition: [1, 1],
        },
        {
          geometryId: "projected_geometry_arc",
          kind: "arc",
          centerPosition: [6, 0],
          startPosition: [7, 0],
          endPosition: [6, 1],
          sweepDirection: "counterClockwise",
        },
      ],
      diagnostics: [],
    },
  ];
  const localGeometries = collectSketchSnapGeometries({ definition });
  const geometries = collectSketchSnapGeometries({
    definition,
    projectedReferences,
  });

  function testCenterCandidates() {
    const circleCenter = resolveSketchSnap({
      pointer: [4, 0.03],
      geometries: localGeometries,
      tolerance: 0.2,
      activeTool: "line",
    });
    expect(
      circleCenter.activeCandidate?.kind,
      "Pointer near a circle center should prefer a center snap.",
    ).toBe("center");
    expect(
      circleCenter.activeCandidate?.preview.label,
      "Circle center snap should expose center preview metadata.",
    ).toBe("Center");
    expect(
      circleCenter.activeCandidate?.preview.glyph,
      "Circle center snap should expose the center glyph.",
    ).toBe("center");
    assertClosePoint(
      circleCenter.snappedPoint,
      [4, 0],
      "Circle center snap should use the exact center point.",
    );

    const arcCenter = resolveSketchSnap({
      pointer: [8.03, 0],
      geometries: localGeometries,
      tolerance: 0.2,
      activeTool: "line",
    });
    expect(
      arcCenter.activeCandidate?.kind,
      "Pointer near an arc center should prefer a center snap.",
    ).toBe("center");
    assertClosePoint(
      arcCenter.snappedPoint,
      [8, 0],
      "Arc center snap should use the exact center point.",
    );
  }

  function testLineMidpointCandidate() {
    const result = resolveSketchSnap({
      pointer: [1, 0.04],
      geometries: localGeometries,
      tolerance: 0.2,
      activeTool: "line",
    });

    expect(
      result.activeCandidate?.kind,
      "Pointer near a line midpoint should prefer midpoint snap.",
    ).toBe("midpoint");
    assertClosePoint(
      result.snappedPoint,
      [1, 0],
      "Midpoint snap should return the exact line midpoint.",
    );
    expect(
      result.activeCandidate?.sources.some(
        (source) => source.kind === "localEntity",
      ),
      "Midpoint snap should carry the source line reference.",
    ).toBeTruthy();
  }

  function testProjectedGeometryCandidate() {
    const result = resolveSketchSnap({
      pointer: [1.1, 0.5],
      geometries,
      tolerance: 0.2,
      activeTool: "line",
    });

    expect(
      result.activeCandidate?.kind,
      "Pointer near a projected line should snap onto it.",
    ).toBe("nearestOnLine");
    assertClosePoint(
      result.snappedPoint,
      [1, 0.5],
      "Projected line snap should use derived projected coordinates.",
    );
    expect(
      result.activeCandidate?.sources.some(
        (source) => source.kind === "projectedGeometry",
      ),
      "Projected snap should reference projected geometry without creating local geometry.",
    ).toBeTruthy();
  }

  function testSketchDatumCandidates() {
    const datumOnlyGeometries = collectSketchSnapGeometries({
      definition: {
        ...definition,
        pointIds: [],
        points: [],
        entityIds: [],
        entities: [],
      },
    });
    const origin = resolveSketchSnap({
      pointer: [0.04, 0.03],
      geometries: datumOnlyGeometries,
      tolerance: 0.2,
      activeTool: "line",
    });
    expect(
      origin.activeCandidate?.kind,
      "Pointer near the sketch origin should snap to the datum origin.",
    ).toBe("endpoint");
    assertClosePoint(
      origin.snappedPoint,
      [0, 0],
      "Datum origin snap should use exact local origin coordinates.",
    );
    expect(
      origin.activeCandidate?.sources.some(
        (source) =>
          source.kind === "sketchDatum" && source.datumId === "origin",
      ),
      "Datum origin snap should carry a sketch-datum source.",
    ).toBeTruthy();

    const axis = resolveSketchSnap({
      pointer: [3, 0.04],
      geometries: datumOnlyGeometries,
      tolerance: 0.2,
      activeTool: "line",
    });
    expect(
      axis.activeCandidate?.kind,
      "Pointer near a datum axis should snap onto that axis.",
    ).toBe("nearestOnLine");
    assertClosePoint(
      axis.snappedPoint,
      [3, 0],
      "Datum axis snap should project to the nearest axis point.",
    );
    expect(
      axis.activeCandidate?.sources.some(
        (source) => source.kind === "sketchDatum" && source.datumId === "xAxis",
      ),
      "Datum axis snap should carry a sketch-datum source.",
    ).toBeTruthy();
  }

  function testCurveCandidates() {
    const circle = resolveSketchSnap({
      pointer: [4.05, 1.12],
      geometries: localGeometries,
      tolerance: 0.2,
      activeTool: "line",
    });
    expect(
      circle.activeCandidate?.kind,
      "Pointer near a circle should snap onto the circle.",
    ).toBe("nearestOnCircle");
    assertClosePoint(
      circle.snappedPoint,
      [4.044598829122584, 0.9990057739466971],
      "Nearest-on-circle snap should use the radial circle point.",
    );

    const arc = resolveSketchSnap({
      pointer: [6.72, 0.72],
      geometries,
      tolerance: 0.2,
      activeTool: "line",
    });
    expect(
      arc.activeCandidate?.kind,
      "Pointer near an arc should snap onto the finite arc.",
    ).toBe("nearestOnArc");
    assertClosePoint(
      arc.snappedPoint,
      [6.707106781186548, 0.7071067811865475],
      "Nearest-on-arc snap should use the radial point when it lies on the arc sweep.",
    );
  }

  function testAlignmentAndTangentCandidates() {
    const horizontal = resolveSketchSnap({
      pointer: [2.5, 0.04],
      geometries,
      activeAnchor: [0, 0],
      activeTool: "line",
      tolerance: 0.2,
    });
    expect(
      horizontal.activeCandidate?.kind,
      "Line drawing should infer horizontal alignment from the active start.",
    ).toBe("horizontalAlignment");
    assertClosePoint(
      horizontal.snappedPoint,
      [2.5, 0],
      "Horizontal alignment should lock the pointer y coordinate.",
    );

    const vertical = resolveSketchSnap({
      pointer: [0.04, 2.5],
      geometries,
      activeAnchor: [0, 0],
      activeTool: "line",
      tolerance: 0.2,
    });
    expect(
      vertical.activeCandidate?.kind,
      "Line drawing should infer vertical alignment from the active start.",
    ).toBe("verticalAlignment");
    assertClosePoint(
      vertical.snappedPoint,
      [0, 2.5],
      "Vertical alignment should lock the pointer x coordinate.",
    );

    const tangent = resolveSketchSnap({
      pointer: [3.5, 0.8660254037844386],
      geometries,
      activeAnchor: [2, 0],
      activeTool: "line",
      tolerance: 0.2,
    });
    expect(
      tangent.activeCandidate?.kind,
      "Line drawing should expose deterministic circle tangent candidates.",
    ).toBe("tangent");
    assertClosePoint(
      tangent.snappedPoint,
      [3.5, 0.8660254037844387],
      "Tangent snap should use the nearest tangent point.",
    );
  }

  function testPerpendicularFootCandidates() {
    const lineGeometry: SketchSnapGeometry = {
      kind: "lineSegment",
      source: {
        kind: "localEntity",
        entityId: "sketch_entity_perpendicular",
        geometryKind: "lineSegment",
      },
      start: [0, 0],
      end: [4, 4],
      label: "Long line",
    };
    const valid = resolveSketchSnap({
      pointer: [1, 1],
      geometries: [lineGeometry],
      activeAnchor: [0, 2],
      activeTool: "line",
      tolerance: 0.2,
    });
    expect(
      valid.activeCandidate?.kind,
      "True finite-segment perpendicular foot should be emitted.",
    ).toBe("perpendicularFoot");
    assertClosePoint(
      valid.snappedPoint,
      [1, 1],
      "Perpendicular foot should use the unclamped projection point.",
    );

    const outside = resolveSketchSnap({
      pointer: [4, 4],
      geometries: [lineGeometry],
      activeAnchor: [7, 5],
      activeTool: "line",
      tolerance: 0.2,
    });
    expect(
      outside.candidates.every(
        (candidate) => candidate.kind !== "perpendicularFoot",
      ),
      "Out-of-segment perpendicular projections should not be labeled as perpendicular-foot snaps.",
    ).toBeTruthy();
  }

  function testIntersectionsAndHysteresis() {
    const intersections = resolveSketchSnap({
      pointer: [1, 0.04],
      geometries,
      tolerance: 0.2,
      activeTool: "line",
    });
    expect(
      intersections.candidates.some(
        (candidate) => candidate.kind === "intersection",
      ),
      "Candidate list should include curve intersections within tolerance.",
    ).toBeTruthy();
  }

  function testHysteresisKeepsNearbyPreviousCandidate() {
    const competingPoints: SketchSnapGeometry[] = [
      {
        kind: "point",
        source: {
          kind: "localPoint",
          pointId: "sketch_point_hysteresis_a",
        },
        point: [0, 0],
        label: "Hysteresis A",
      },
      {
        kind: "point",
        source: {
          kind: "localPoint",
          pointId: "sketch_point_hysteresis_b",
        },
        point: [0.1, 0],
        label: "Hysteresis B",
      },
    ];
    const baseline = resolveSketchSnap({
      pointer: [0.04, 0],
      geometries: competingPoints,
      tolerance: 0.2,
      activeTool: "line",
    });
    assertClosePoint(
      baseline.snappedPoint,
      [0, 0],
      "Baseline snap should choose the closest point without hysteresis.",
    );

    const previous = baseline.candidates.find(
      (candidate) => candidate.point[0] === 0.1,
    );
    expect(
      previous,
      "Expected a nearby previous candidate for hysteresis.",
    ).toBeTruthy();

    const hysteresis = resolveSketchSnap({
      pointer: [0.04, 0],
      geometries: competingPoints,
      tolerance: 0.2,
      activeTool: "line",
      activeCandidateKey: previous?.key,
    });
    expect(
      hysteresis.activeCandidate?.key,
      "Active candidate hysteresis should keep a nearby previous candidate stable.",
    ).toBe(previous?.key);
  }

  testCenterCandidates();
  testLineMidpointCandidate();
  testProjectedGeometryCandidate();
  testSketchDatumCandidates();
  testCurveCandidates();
  testAlignmentAndTangentCandidates();
  testPerpendicularFootCandidates();
  testIntersectionsAndHysteresis();
  testHysteresisKeepsNearbyPreviousCandidate();
});

// Lane: logic (docs/testing.md). Seam: `collectSketchSnapGeometries` +
// `resolveSketchSnap` (T10f): a snapped spline position becomes authored
// data, so it must be a point of the solved spans; end points are the exact
// span ends; datum extents come from pole boxes.
const ZERO_DIFFERENTIAL = {
  interval: [0, 0] as const,
  poles: [
    [0, 0],
    [0, 0],
    [0, 0],
    [0, 0],
  ] as const,
};

/** Independent cubic Bézier evaluation (Bernstein form). */
function bernstein(poles: SolvedCubicSpan["poles"], t: number): SplineVector {
  const s = 1 - t;
  const weights = [s * s * s, 3 * s * s * t, 3 * s * t * t, t * t * t];
  return [0, 1].map((axis) =>
    poles.reduce((sum, pole, index) => sum + weights[index]! * pole[axis]!, 0),
  ) as unknown as SplineVector;
}

/** Independent closest distance: dense grid, then golden-section refinement. */
function oracleDistance(
  spans: readonly SolvedCubicSpan[],
  point: SplineVector,
) {
  const distanceAt = (span: SolvedCubicSpan, t: number) => {
    const at = bernstein(span.poles, t);
    return Math.hypot(at[0] - point[0], at[1] - point[1]);
  };
  let best = Number.POSITIVE_INFINITY;
  for (const span of spans) {
    const grid = 2000;
    let k0 = 0;
    for (let k = 0; k <= grid; k += 1)
      if (distanceAt(span, k / grid) < distanceAt(span, k0 / grid)) k0 = k;
    let low = Math.max(0, (k0 - 1) / grid);
    let high = Math.min(1, (k0 + 1) / grid);
    const ratio = (Math.sqrt(5) - 1) / 2;
    for (let iteration = 0; iteration < 200; iteration += 1) {
      const a = high - ratio * (high - low);
      const b = low + ratio * (high - low);
      if (distanceAt(span, a) < distanceAt(span, b)) high = b;
      else low = a;
    }
    best = Math.min(best, distanceAt(span, (low + high) / 2));
  }
  return best;
}

function ownerDistance(spans: readonly SolvedCubicSpan[], point: SplineVector) {
  const located = closestSplineSpanLocation(
    point,
    spans.map((span) => ({ ...span, differential: ZERO_DIFFERENTIAL })),
  );
  return Math.sqrt(located!.distanceSquared);
}

test("nearest-on-spline snaps lie on the solved spans and are the exact closest point; end points are the exact span ends", () => {
  const sketch = makeSketchFixture();
  sketch.point("a", 0, 0);
  sketch.point("b", 3, 4);
  sketch.point("c", 6, -1);
  sketch.point("d", 10, 3);
  sketch.spline("wave", ["a", "b", "c", "d"], "open");
  const committed = sketch.build();
  // A stale authored definition: the snapshot still holds the committed
  // spans, which snapping must follow (modeling-grade, not authored data).
  sketch.move("b", 3, 5);
  const geometries = collectSketchSnapGeometries({
    definition: sketch.definition(),
    solvedSnapshot: committed.solvedSnapshot,
  });
  const spline = geometries.find(
    (geometry) =>
      geometry.source.kind === "localEntity" &&
      geometry.source.entityId === "sketch_entity_wave",
  );
  assert(spline?.kind === "spline", "the spline snaps along spans");
  const spans = solvedCubicSpans(committed.solvedSnapshot.solvedEntities[0]!);
  expect(spline.spans, "snap reads the solved snapshot's spans").toEqual(spans);
  expect(spans).toHaveLength(3);

  const scale = 10;
  for (const pointer of [
    [3.05, 4.08],
    [1.4, 2.5],
    [6.02, -1.1],
    ...spans.map((span, index): SplineVector => {
      const on = bernstein(span.poles, 0.37 + 0.2 * index);
      return [on[0] + 0.06, on[1] - 0.08];
    }),
  ] satisfies SplineVector[]) {
    const snap = resolveSketchSnap({
      pointer,
      geometries: [spline],
      tolerance: 0.2,
    });
    const nearest = snap.candidates.find(
      (candidate) => candidate.kind === "nearestOnSpline",
    );
    assert(nearest, `a nearest-on-spline candidate at ${pointer}`);
    expect(
      ownerDistance(spans, nearest.point),
      "the snapped point lies on the curve",
    ).toBeLessThanOrEqual(1e-12 * scale);
    expect(
      Math.abs(nearest.distance - oracleDistance(spans, pointer)),
      "it is the closest point of the curve (independent oracle)",
    ).toBeLessThan(1e-9);
  }

  const atStart = resolveSketchSnap({
    pointer: [0.05, 0.05],
    geometries: [spline],
    tolerance: 0.2,
  }).candidates.filter((candidate) => candidate.kind === "endpoint");
  const atEnd = resolveSketchSnap({
    pointer: [9.95, 3.05],
    geometries: [spline],
    tolerance: 0.2,
  }).candidates.filter((candidate) => candidate.kind === "endpoint");
  expect(atStart.map((candidate) => candidate.point)).toEqual([
    spans[0]!.poles[0],
  ]);
  expect(atEnd.map((candidate) => candidate.point)).toEqual([
    spans[2]!.poles[3],
  ]);

  expect(
    resolveSketchSnap({
      pointer: [5, 20],
      geometries: [spline],
      tolerance: 0.2,
    }).candidates,
    "a pointer beyond the tolerance of every pole box snaps to nothing",
  ).toEqual([]);
});

test("a trimmed derived shell's end points are its drawn domain ends", () => {
  const poles: SolvedCubicSpan["poles"] = [
    [0, 0],
    [1, 2],
    [3, 2],
    [4, 0],
  ];
  const spans: SolvedCubicSpan[] = [
    { interval: [0, 1], poles, queryDomain: [0.25, 0.75] },
  ];
  const geometry: SketchSnapGeometry = {
    kind: "spline",
    source: {
      kind: "localEntity",
      entityId: "sketch_entity_shell",
      geometryKind: "spline",
    } as never,
    spans,
    isClosed: false,
    label: "Shell",
  };
  const start = bernstein(poles, 0.25);
  const ends = resolveSketchSnap({
    pointer: start,
    geometries: [geometry],
    tolerance: 0.1,
  }).candidates.filter((candidate) => candidate.kind === "endpoint");
  expect(ends).toHaveLength(1);
  expect(
    Math.hypot(ends[0]!.point[0] - start[0], ends[0]!.point[1] - start[1]),
  ).toBeLessThan(1e-15);
  expect(
    resolveSketchSnap({
      pointer: [0, 0],
      geometries: [geometry],
      tolerance: 0.1,
    }).candidates,
    "the trimmed-off tail gives no end point and no nearest point",
  ).toEqual([]);
});

test("projected splines snap along their neutral spans (or source samples); datum axes extend over the pole box", () => {
  const sketch = makeSketchFixture();
  const spans = [
    neutralSpan(
      [
        [0, 0],
        [2, 9],
        [4, 9],
        [6, 0],
      ],
      0,
      ["o0", "o1"],
      0,
    ),
  ];
  sketch.project("curve", [
    projectedSpline("projected_geometry_curve", spans),
    {
      geometryId: "projected_geometry_samples",
      kind: "spline",
      representation: {
        kind: "sourceSamples",
        points: [
          [-2, 0],
          [-1, 1],
          [0, 1],
        ],
        isClosed: false,
      },
    },
  ]);
  const input = sketch.build();
  const geometries = collectSketchSnapGeometries({
    definition: input.definition,
    projectedReferences: input.projectedReferences,
    solvedSnapshot: input.solvedSnapshot,
  });
  const neutral = geometries.find(
    (geometry) =>
      geometry.source.kind === "projectedGeometry" &&
      geometry.source.geometryId === "projected_geometry_curve",
  );
  expect(neutral?.kind === "spline" && neutral.spans).toBe(spans);
  const samples = geometries.find(
    (geometry) =>
      geometry.source.kind === "projectedGeometry" &&
      geometry.source.geometryId === "projected_geometry_samples",
  );
  expect(samples?.kind).toBe("sampledSpline");
  expect(
    resolveSketchSnap({
      pointer: [-0.5, 1.05],
      geometries: [samples!],
      tolerance: 0.2,
    }).activeCandidate?.point,
    "source samples are their own polyline",
  ).toEqual([-0.5, 1]);
  const xAxis = geometries.find(
    (geometry) =>
      geometry.source.kind === "sketchDatum" &&
      geometry.source.datumId === "xAxis",
  );
  // The curve peaks at y = 6.75; its pole box reaches 9 (exact, conservative).
  expect(xAxis?.kind === "lineSegment" && xAxis.end).toEqual([9 * 1.35, 0]);
});

/** A spline whose fit point b is tied to a line with two conflicting lengths: a not-accepted live solve that moves b (review R-2 setup). */
function nonAcceptedSplineSession() {
  const sketch = makeSketchFixture();
  sketch.point("a", 0, 0);
  sketch.point("b", 3, 4);
  sketch.point("c", 6, -1);
  sketch.point("d", 10, 3);
  sketch.spline("wave", ["a", "b", "c", "d"], "open");
  sketch.point("e", 3, 4);
  sketch.point("f", 3, 10);
  sketch.line("l", "e", "f");
  sketch.coincident("b", "e");
  sketch.lineLength("l", 2);
  sketch.lineLength("l", 9);
  const record = sketchSnapshotRecordForTest(
    sketch.build(),
    [],
    createStandardPlaneDefinition("xy"),
  );
  const opened = createSketchSessionFromSnapshot(record, OCC_KERNEL_SETTINGS);
  const session = withLiveSolveBasis(opened, opened.definition);
  const solvedB = session.liveSolve!.solvedSnapshot.solvedPoints.find(
    (point) => point.pointId === "sketch_point_b",
  )!.solvedPosition;
  expect(session.liveSolve!.accepted, "premise: not accepted").toBe(false);
  expect(
    Math.hypot(solvedB[0] - 3, solvedB[1] - 4),
    "premise: the best-effort solve moves b off its authored position",
  ).toBeGreaterThan(0.1);
  const entity = session.definition.entities.find(
    (candidate) => candidate.entityId === "sketch_entity_wave",
  ) as Extract<SketchEntityDefinition, { kind: "spline" }>;
  const authored = reconstructSplineAggregate(
    entity,
    Object.fromEntries(
      session.definition.points.map((point) => [point.pointId, point.position]),
    ),
  ).spans.map((span) => ({ interval: span.interval, poles: span.poles }));
  const display = getSketchSessionDisplayRenderables(session).find(
    (renderable) =>
      renderable.target?.kind === "sketchEntity" &&
      renderable.target.entityId === "sketch_entity_wave" &&
      renderable.geometry.kind === "polyline",
  );
  const drawn =
    display?.geometry.kind === "polyline"
      ? display.geometry.points.map((point) => [point[0], point[1]])
      : null;
  return { session, authored, drawn };
}

// Lane: logic (docs/testing.md). Seam: `collectSketchSnapGeometries` with a
// not-accepted live solve (T10f review R-2): snapped positions become
// authored data, so they must lie on the drawn (authored) spline.
test("with a not-accepted solve a spline snaps along the authored reconstruction the display draws", () => {
  const { session, authored, drawn } = nonAcceptedSplineSession();
  const snap = collectSketchSnapGeometries({
    definition: session.definition,
    solvedSnapshot: session.liveSolve!.solvedSnapshot,
  }).find(
    (geometry) =>
      geometry.source.kind === "localEntity" &&
      geometry.source.entityId === "sketch_entity_wave",
  );
  expect(snap?.kind === "spline" && snap.spans).toEqual(authored);
  expect(
    snap?.kind === "spline" &&
      tessellateCubicSpans(snap.spans).map((point) => [...point]),
    "Snap's spans draw exactly the displayed polyline.",
  ).toEqual(drawn);
});
