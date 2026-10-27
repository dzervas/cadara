import { test, expect, assert } from "vitest";

import type {
  SketchDefinition,
  SketchPoint2D,
} from "@/contracts/sketch/schema";
import type { SketchEntityId, SketchPointId } from "@/contracts/shared/ids";
import type { ProjectedSketchReferenceRecord } from "@/contracts/solver/schema";
import {
  collectSketchSnapGeometries,
  getSketchExactIntersections,
  getSketchSnapIntersectionTargets,
  resolveSketchSnap,
  type SketchSnapGeometry,
} from "@/domain/sketch-snapping/snap-candidates";
import type { NeutralCurveQueryCapability } from "@/contracts/modeling/neutral-curve-query";
import {
  querySketchEditIntersections,
  querySketchSnapIntersections,
} from "@/contracts/sketch/edit-intersections";
import { createCertifiedNeutralCurveQueryCapabilityForTest } from "@/core/modeling/neutral-curve-certification/query";
import { SKETCH_CURVE_RADII_PX } from "@/core/sketch-interaction/screen-radii";
import {
  literalResolvedDefinition,
  makeSketchFixture,
  neutralSpan,
  projectedSpline,
} from "@/contracts/sketch/region-extraction.fixtures";
import { sketchSnapshotRecordForTest } from "@/contracts/sketch/region-record.fixtures";
import type { SketchEntityDefinition } from "@/contracts/sketch/schema";
import {
  createSketchSessionFromSnapshot
} from "@/domain/editor/sketch-session";
import { getSketchSessionDisplayRenderables } from "@/domain/editor/sketch-session/display";
import { withLiveSolveBasis } from "@/domain/editor/sketch-session/session-live-solve";
import {
  createStandardPlaneDefinition,
  OCC_KERNEL_SETTINGS,
} from "@/core/modeling/opencascade-kernel-seed";
import {
  closestSplineSpanLocation,
  reconstructSplineAggregate,
  solvedCubicSpans,
  tessellateCubicSpans,
  type SolvedCubicSpan,
  type SplineVector,
} from "@/contracts/sketch/spline-geometry";

/**
 * The screen scale these rows use (T13-D13): a 10 px curve radius covers
 * 0.2 sketch units, the sketch-unit tolerance they were written for (points
 * reach 0.24, alignments 0.16).
 */
const UNITS_PER_PIXEL_02 = 0.2 / SKETCH_CURVE_RADII_PX.enter;

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
      sketchUnitsPerPixel: UNITS_PER_PIXEL_02,
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
      sketchUnitsPerPixel: UNITS_PER_PIXEL_02,
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
      sketchUnitsPerPixel: UNITS_PER_PIXEL_02,
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
      sketchUnitsPerPixel: UNITS_PER_PIXEL_02,
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
      sketchUnitsPerPixel: UNITS_PER_PIXEL_02,
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
      sketchUnitsPerPixel: UNITS_PER_PIXEL_02,
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
      sketchUnitsPerPixel: UNITS_PER_PIXEL_02,
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
      sketchUnitsPerPixel: UNITS_PER_PIXEL_02,
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
    // The anchor sits off the datum axes: an axis under the pointer is an
    // on-curve snap, which outranks alignment (T13-D14, row below).
    const horizontal = resolveSketchSnap({
      pointer: [2.5, 0.54],
      geometries,
      activeAnchor: [0.5, 0.5],
      sketchUnitsPerPixel: UNITS_PER_PIXEL_02,
    });
    expect(
      horizontal.activeCandidate?.kind,
      "Line drawing should infer horizontal alignment from the active start.",
    ).toBe("horizontalAlignment");
    assertClosePoint(
      horizontal.snappedPoint,
      [2.5, 0.5],
      "Horizontal alignment should lock the pointer y coordinate.",
    );

    const vertical = resolveSketchSnap({
      pointer: [0.54, 2.5],
      geometries,
      activeAnchor: [0.5, 0.5],
      sketchUnitsPerPixel: UNITS_PER_PIXEL_02,
    });
    expect(
      vertical.activeCandidate?.kind,
      "Line drawing should infer vertical alignment from the active start.",
    ).toBe("verticalAlignment");
    assertClosePoint(
      vertical.snappedPoint,
      [0.5, 2.5],
      "Vertical alignment should lock the pointer x coordinate.",
    );

    const tangent = resolveSketchSnap({
      pointer: [3.5, 0.8660254037844386],
      geometries,
      activeAnchor: [2, 0],
      sketchUnitsPerPixel: UNITS_PER_PIXEL_02,
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
      sketchUnitsPerPixel: UNITS_PER_PIXEL_02,
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
      sketchUnitsPerPixel: UNITS_PER_PIXEL_02,
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
      sketchUnitsPerPixel: UNITS_PER_PIXEL_02,
    });
    expect(
      intersections.candidates.some(
        (candidate) => candidate.kind === "intersection",
      ),
      "Candidate list should include curve intersections within tolerance.",
    ).toBeTruthy();
  }

  testCenterCandidates();
  testLineMidpointCandidate();
  testProjectedGeometryCandidate();
  testSketchDatumCandidates();
  testCurveCandidates();
  testAlignmentAndTangentCandidates();
  testPerpendicularFootCandidates();
  testIntersectionsAndHysteresis();
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
      sketchUnitsPerPixel: UNITS_PER_PIXEL_02,
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
    sketchUnitsPerPixel: UNITS_PER_PIXEL_02,
  }).candidates.filter((candidate) => candidate.kind === "endpoint");
  const atEnd = resolveSketchSnap({
    pointer: [9.95, 3.05],
    geometries: [spline],
    sketchUnitsPerPixel: UNITS_PER_PIXEL_02,
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
      sketchUnitsPerPixel: UNITS_PER_PIXEL_02,
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
    sketchUnitsPerPixel: UNITS_PER_PIXEL_02 / 2,
  }).candidates.filter((candidate) => candidate.kind === "endpoint");
  expect(ends).toHaveLength(1);
  expect(
    Math.hypot(ends[0]!.point[0] - start[0], ends[0]!.point[1] - start[1]),
  ).toBeLessThan(1e-15);
  expect(
    resolveSketchSnap({
      pointer: [0, 0],
      geometries: [geometry],
      sketchUnitsPerPixel: UNITS_PER_PIXEL_02 / 2,
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
      sketchUnitsPerPixel: UNITS_PER_PIXEL_02,
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

// Lane: logic (docs/testing.md). Seam: `resolveSketchSnap` (T13f): snap
// tolerances in screen pixels (T13-D13) and class-first ordering (T13-D14).
function pointSnap(id: string, point: SketchPoint2D): SketchSnapGeometry {
  return {
    kind: "point",
    source: { kind: "localPoint", pointId: id as SketchPointId },
    point,
    label: id,
  };
}

function lineSnap(
  id: string,
  start: SketchPoint2D,
  end: SketchPoint2D,
): SketchSnapGeometry {
  return {
    kind: "lineSegment",
    source: {
      kind: "localEntity",
      entityId: id as SketchEntityId,
      geometryKind: "lineSegment",
    },
    start,
    end,
    label: id,
  };
}

/** The datum origin and axes (no local geometry). */
function datumSnaps() {
  return collectSketchSnapGeometries({
    definition: makeSketchFixture().definition(),
  });
}

test("snap tolerances are screen pixels: the same screen offset decides the same at two zoom levels (T13-D13)", () => {
  const point = pointSnap("sketch_point_p", [5, 5]);
  for (const unitsPerPixel of [0.01, 0.5]) {
    const at = (px: number) =>
      resolveSketchSnap({
        pointer: [5 + px * unitsPerPixel, 5],
        geometries: [point],
        sketchUnitsPerPixel: unitsPerPixel,
      }).activeCandidate;
    expect(at(11)?.kind, `11 px snaps at ${unitsPerPixel} units/px`).toBe(
      "endpoint",
    );
    expect(at(13), `13 px does not snap at ${unitsPerPixel} units/px`).toBe(
      null,
    );
  }

  // One sketch-space offset of 0.5 units: 10 px zoomed out, 50 px zoomed in.
  const pointer: SketchPoint2D = [5.5, 5];
  expect(
    resolveSketchSnap({
      pointer,
      geometries: [point],
      sketchUnitsPerPixel: 0.05,
    }).activeCandidate?.kind,
    "0.5 units at 0.05 units/px (10 px) snaps",
  ).toBe("endpoint");
  expect(
    resolveSketchSnap({
      pointer,
      geometries: [point],
      sketchUnitsPerPixel: 0.01,
    }).activeCandidate,
    "0.5 units at 0.01 units/px (50 px) does not",
  ).toBe(null);
});

test("without a measured screen scale nothing snaps (T13-D13)", () => {
  const result = resolveSketchSnap({
    pointer: [5, 5],
    geometries: [pointSnap("sketch_point_p", [5, 5]), ...datumSnaps()],
    activeAnchor: [0, 5],
    sketchUnitsPerPixel: null,
  });
  expect(result.activeCandidate).toBe(null);
  expect(result.candidates).toEqual([]);
  expect(result.snappedPoint).toEqual([5, 5]);
});

test("each snap class enters at its pixel radius and an active candidate stays until its exit radius (T13-D13 hysteresis, as pick)", () => {
  const unitsPerPixel = 0.01;
  const rows: {
    kind: string;
    enter: number;
    exit: number;
    geometries: SketchSnapGeometry[];
    anchor: SketchPoint2D | null;
    pointerAt: (px: number) => SketchPoint2D;
  }[] = [
    {
      kind: "endpoint",
      enter: 12,
      exit: 16,
      geometries: [pointSnap("sketch_point_p", [10, 10])],
      anchor: null,
      pointerAt: (px) => [10 + px * unitsPerPixel, 10],
    },
    {
      kind: "nearestOnLine",
      enter: 10,
      exit: 14,
      geometries: [lineSnap("sketch_entity_l", [5, 10], [15, 10])],
      anchor: null,
      pointerAt: (px) => [13, 10 + px * unitsPerPixel],
    },
    {
      // The foot from (13, 0) onto the line is (13, 10); the pointer slides
      // along the line, so on-line stays at distance 0 below it.
      kind: "perpendicularFoot",
      enter: 10,
      exit: 14,
      geometries: [lineSnap("sketch_entity_l", [5, 10], [15, 10])],
      anchor: [13, 0],
      pointerAt: (px) => [13 + px * unitsPerPixel, 10],
    },
    {
      kind: "horizontalAlignment",
      enter: 8,
      exit: 12,
      geometries: [],
      anchor: [0, 3],
      pointerAt: (px) => [10, 3 + px * unitsPerPixel],
    },
  ];

  for (const row of rows) {
    const resolve = (px: number, activeCandidateKey: string | null = null) =>
      resolveSketchSnap({
        pointer: row.pointerAt(px),
        geometries: row.geometries,
        activeAnchor: row.anchor,
        sketchUnitsPerPixel: unitsPerPixel,
        activeCandidateKey,
      }).activeCandidate;
    const entered = resolve(row.enter - 1);
    expect(entered?.kind, `${row.kind} enters inside ${row.enter} px`).toBe(
      row.kind,
    );
    const between = (row.enter + row.exit) / 2;
    expect(
      resolve(between)?.kind,
      `${row.kind} does not enter at ${between} px`,
    ).not.toBe(row.kind);
    expect(
      resolve(between, entered!.key)?.key,
      `an active ${row.kind} stays at ${between} px`,
    ).toBe(entered!.key);
    expect(
      resolve(row.exit + 1, entered!.key)?.kind,
      `an active ${row.kind} leaves beyond ${row.exit} px`,
    ).not.toBe(row.kind);
  }

  // Staying eligible is all hysteresis does: a nearer point still wins.
  const a = pointSnap("sketch_point_a", [0, 0]);
  const b = pointSnap("sketch_point_b", [0.2, 0]);
  const activeA = resolveSketchSnap({
    pointer: [0.05, 0],
    geometries: [a, b],
    sketchUnitsPerPixel: unitsPerPixel,
  }).activeCandidate;
  expect(activeA?.point).toEqual([0, 0]);
  expect(
    resolveSketchSnap({
      pointer: [0.13, 0],
      geometries: [a, b],
      sketchUnitsPerPixel: unitsPerPixel,
      activeCandidateKey: activeA!.key,
    }).activeCandidate?.point,
    "the active point (13 px) yields to a nearer point (7 px)",
  ).toEqual([0.2, 0]);
});

test("snap classes rank before distance: point-like > constructed > on-curve > alignment (T13-D14)", () => {
  const unitsPerPixel = 0.01;
  const resolve = (
    pointer: SketchPoint2D,
    geometries: SketchSnapGeometry[],
    activeAnchor: SketchPoint2D | null = null,
  ) =>
    resolveSketchSnap({
      pointer,
      geometries,
      activeAnchor,
      sketchUnitsPerPixel: unitsPerPixel,
    }).activeCandidate;

  // T11a offset corner: the line under the pointer is nearer than its end.
  const corner = resolve(
    [9.95, 0.02],
    [lineSnap("sketch_entity_l", [0, 0], [10, 0])],
  );
  expect(corner?.kind, "an endpoint beats a nearer on-line snap").toBe(
    "endpoint",
  );
  expect(corner?.point).toEqual([10, 0]);

  // On a side of a closing rectangle the side beats a nearer alignment.
  const side = resolve(
    [3, 1.03],
    [lineSnap("sketch_entity_side", [0, 1], [10, 1])],
    [0, 1.05],
  );
  expect(side?.kind, "on-curve beats a nearer alignment").toBe("nearestOnLine");
  expect(side?.point).toEqual([3, 1]);

  // A tangent or perpendicular foot beats a nearer curve.
  const foot = resolve(
    [3.05, 1],
    [lineSnap("sketch_entity_side", [0, 1], [10, 1])],
    [3, 0],
  );
  expect(foot?.kind, "a constructed point beats a nearer on-line snap").toBe(
    "perpendicularFoot",
  );

  // Datums: a local point beats the nearer X axis; the origin beats a nearer
  // local line (the datum filter is gone, class order does both).
  const nearAxis = resolve(
    [3.02, 0.01],
    [pointSnap("sketch_point_p", [3, 0.06]), ...datumSnaps()],
  );
  expect(nearAxis?.kind, "a point beats a nearer datum axis").toBe("endpoint");
  expect(nearAxis?.point).toEqual([3, 0.06]);
  const nearOrigin = resolve(
    [0.03, 0.012],
    // The origin alone: the axes would cross the line near it.
    [
      lineSnap("sketch_entity_l", [-5, 0.01], [3, 0.01]),
      ...datumSnaps().filter((geometry) => geometry.kind === "point"),
    ],
  );
  expect(nearOrigin?.kind, "the origin beats a nearer local line").toBe(
    "endpoint",
  );
  expect(
    nearOrigin?.sources.some(
      (source) => source.kind === "sketchDatum" && source.datumId === "origin",
    ),
  ).toBe(true);

  // A datum axis is an unbounded line: its drawn end (the display extent,
  // 10 units here) is no endpoint, so it cannot outrank the axis itself.
  const axisEnd = resolve([10.01, 0.01], datumSnaps());
  expect(axisEnd?.kind, "the drawn end of a datum axis is on-line").toBe(
    "nearestOnLine",
  );
  expect(axisEnd?.sources).toEqual([
    { kind: "sketchDatum", datumId: "xAxis", geometryKind: "lineSegment" },
  ]);

  // Within a class: distance, then source (a local point over the origin).
  const shared = resolve(
    [0.02, 0.02],
    [pointSnap("sketch_point_o", [0, 0]), ...datumSnaps()],
  );
  expect(shared?.sources).toEqual([
    { kind: "localPoint", pointId: "sketch_point_o" },
  ]);
});

// T13i review R-1 / A-3 (logic lane, seam: the snap batch
// `querySketchSnapIntersections` and `getSketchExactIntersections`): the
// staged batch (spline × line/circle/arc, then spline × spline) offers the
// same candidates, bitwise, as one unstaged intersect per target, and each
// spline pair is computed in one direction only.
test("T13i R-1/A-3: the staged snap batch computes each spline pair once and offers today's candidates bitwise", async () => {
  const sketch = makeSketchFixture();
  sketch.point("a0", 0, 0);
  sketch.point("a1", 2, 3);
  sketch.point("a2", 4, 0);
  sketch.spline("a", ["a0", "a1", "a2"], "open");
  sketch.point("b0", -1, 1);
  sketch.point("b1", 2, 1.2);
  sketch.point("b2", 5, 1);
  sketch.spline("b", ["b0", "b1", "b2"], "open");
  sketch.point("l0", 2.5, -1);
  sketch.point("l1", 2.5, 4);
  sketch.line("line", "l0", "l1");
  const input = sketch.build();
  const basis = {
    // T17p2 (F-2): the queries carry the resolved definition.
    definition: literalResolvedDefinition(input.definition),
    solvedSnapshot: input.solvedSnapshot,
    projectedReferences: [],
    modelingTolerance: input.modelingTolerance,
  };
  const [a, b, line] = ["a", "b", "line"].map(
    (name) => `sketch_entity_${name}` as SketchEntityId,
  );
  const splineIds = new Set<string>([a!, b!]);
  const certified = createCertifiedNeutralCurveQueryCapabilityForTest();
  const splinePairs: string[] = [];
  const spied: NeutralCurveQueryCapability = {
    queryNeutralCurves: (request) => {
      const first = request.first.provenance.sourceEntityId;
      const second = request.second.provenance.sourceEntityId;
      if (splineIds.has(first) && splineIds.has(second))
        splinePairs.push(`${first}→${second}`);
      return certified.queryNeutralCurves(request);
    },
    queryNeutralCurveSelfIntersections: (request) =>
      certified.queryNeutralCurveSelfIntersections(request),
    queryNeutralCurveJoin: (request) =>
      certified.queryNeutralCurveJoin(request),
  };
  expect(
    getSketchSnapIntersectionTargets(
      input.definition,
      input.solvedSnapshot,
      input.modelingTolerance,
      "curves",
    ).sort(),
  ).toEqual([a, b]);

  const curves = await querySketchSnapIntersections(
    { ...basis, targetEntityIds: [b!, a!], cutters: "curves" },
    spied,
  );
  expect(splinePairs, "the curves stage asks no spline pair").toEqual([]);
  const splines = await querySketchSnapIntersections(
    { ...basis, targetEntityIds: [b!, a!], cutters: "splines" },
    spied,
  );
  expect(
    [...new Set(splinePairs)],
    "the spline pair is queried in one direction only",
  ).toHaveLength(1);
  const staged = [
    ...getSketchExactIntersections(input.definition, curves),
    ...getSketchExactIntersections(input.definition, splines),
  ];

  // Today's unstaged batch: one plain intersect per target, every cutter.
  const unstaged = getSketchExactIntersections(
    input.definition,
    await Promise.all(
      [a!, b!].map(async (targetEntityId) => ({
        targetEntityId,
        result: await querySketchEditIntersections(
          { ...basis, operation: { kind: "intersect", targetEntityId } },
          certified,
        ),
      })),
    ),
  );
  const key = (intersection: { point: readonly number[]; sources: unknown }) =>
    JSON.stringify(intersection);
  expect(staged.map(key).sort(), "the same candidates, bitwise").toEqual(
    unstaged.map(key).sort(),
  );
  expect(
    staged.filter(({ sources }) =>
      sources.some(
        (source) => source.kind === "localEntity" && source.entityId === line,
      ),
    ),
    "the line crosses each spline once (curves stage)",
  ).toHaveLength(2);
  expect(staged.length, "and the splines cross twice").toBe(4);
}, 120_000);
