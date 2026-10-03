import { test, expect, assert } from "vitest";

import type { ProjectedSketchReferenceRecord } from "@/contracts/solver/schema";
import type {
  SketchDefinition,
  SketchPoint2D,
} from "@/contracts/sketch/schema";
import type {
  ProjectedGeometryId,
  ReferenceId,
  SketchEntityId,
  SketchId,
  SketchPointId,
} from "@/contracts/shared/ids";
import {
  createStandardPlaneDefinition,
  OCC_KERNEL_SETTINGS,
} from "@/domain/modeling/opencascade-kernel-seed";
import {
  createArcEntityDefinition,
  createBezierCurveEntityDefinition,
  createCircleEntityDefinition,
  createConicEntityDefinition,
  createEllipseEntityDefinition,
  createEllipticalArcEntityDefinition,
  createLineEntityDefinition,
  createPointDefinition,
  createProfileTextEntityDefinition,
  createSplineEntityDefinition,
} from "@/domain/editor/sketch-session/internals";
import { createNewSketchSession } from "@/domain/editor/sketch-session";
import {
  closestPointOnSketchInteractionCurve,
  collectSketchInteractionGeometry,
  isSketchInteractionCurveGeometry,
  type SketchInteractionCurveGeometry,
} from "@/domain/sketch-interaction/geometry";
import { getSketchSessionDisplaySolvedSnapshot } from "@/domain/editor/sketch-session/display";
import {
  createSketchSessionFromSnapshot,
  getSketchSessionDisplayRenderables,
} from "@/domain/editor/sketch-session";
import { withLiveSolveBasis } from "@/domain/editor/sketch-session/internals";
import { makeSketchFixture } from "@/contracts/sketch/region-extraction.fixtures";
import { sketchSnapshotRecordForTest } from "@/contracts/sketch/region-record.fixtures";
import type { SketchEntityDefinition } from "@/contracts/sketch/schema";
import {
  closestSplineSpanLocation,
  reconstructSplineAggregate,
  solvedCubicSpanPoint,
  tessellateCubicSpans,
  solvedCubicSpans,
  type SplinePoles,
} from "@/contracts/sketch/spline-geometry";

test("collectSketchInteractionGeometry preserves local, projected, datum, and advanced sketch targets", () => {
  const sketchId = "sketch_primary" as SketchId;
  const point = (suffix: string, position: SketchPoint2D) =>
    createPointDefinition(
      sketchId,
      `sketch_point_${suffix}` as SketchPointId,
      suffix,
      position,
    );
  const points = [
    point("line_a", [-3, 0]),
    point("line_b", [-1, 0]),
    point("center", [0, 0]),
    point("arc_start", [2, 0]),
    point("arc_end", [0, 2]),
    point("spline_a", [0, -2]),
    point("spline_b", [1, -1]),
    point("spline_c", [2, -2]),
    point("ellipse_center", [4, 0]),
    point("ellipse_major", [6, 0]),
    point("elliptical_arc_center", [7, 0]),
    point("elliptical_arc_major", [9, 0]),
    point("elliptical_arc_start", [9, 0]),
    point("elliptical_arc_end", [7, 1]),
    point("conic_start", [0, 3]),
    point("conic_control", [1, 4]),
    point("conic_end", [2, 3]),
    point("bezier_a", [3, 3]),
    point("bezier_b", [4, 4]),
    point("bezier_c", [5, 4]),
    point("bezier_d", [6, 3]),
    point("text_anchor", [0, 5]),
  ];
  const entities = [
    createLineEntityDefinition(
      sketchId,
      "sketch_entity_line" as SketchEntityId,
      "Line",
      points[0]!.pointId,
      points[1]!.pointId,
    ),
    createCircleEntityDefinition(
      sketchId,
      "sketch_entity_circle" as SketchEntityId,
      "Circle",
      points[2]!.pointId,
      1.5,
    ),
    createArcEntityDefinition(
      sketchId,
      "sketch_entity_arc" as SketchEntityId,
      "Arc",
      points[2]!.pointId,
      points[3]!.pointId,
      points[4]!.pointId,
      "counterClockwise",
    ),
    createSplineEntityDefinition(
      sketchId,
      "sketch_entity_spline" as SketchEntityId,
      "Spline",
      [points[5]!.pointId, points[6]!.pointId, points[7]!.pointId],
    ),
    createEllipseEntityDefinition(
      sketchId,
      "sketch_entity_ellipse" as SketchEntityId,
      "Ellipse",
      points[8]!.pointId,
      points[9]!.pointId,
      1,
    ),
    createEllipticalArcEntityDefinition(
      sketchId,
      "sketch_entity_elliptical_arc" as SketchEntityId,
      "Elliptical arc",
      points[10]!.pointId,
      points[11]!.pointId,
      points[12]!.pointId,
      points[13]!.pointId,
      1,
      "counterClockwise",
    ),
    createConicEntityDefinition(
      sketchId,
      "sketch_entity_conic" as SketchEntityId,
      "Conic",
      points[14]!.pointId,
      points[15]!.pointId,
      points[16]!.pointId,
      0.5,
    ),
    createBezierCurveEntityDefinition(
      sketchId,
      "sketch_entity_bezier" as SketchEntityId,
      "Bezier",
      [
        points[17]!.pointId,
        points[18]!.pointId,
        points[19]!.pointId,
        points[20]!.pointId,
      ],
      3,
    ),
    createProfileTextEntityDefinition(
      sketchId,
      "sketch_entity_text" as SketchEntityId,
      "Text",
      points[21]!.pointId,
      "CAD",
      1,
      0,
      "left",
      "baseline",
    ),
  ];
  const projectedReference = makeProjectedReference();
  const definition: SketchDefinition = {
    ...createNewSketchSession(
      createStandardPlaneDefinition("xy"),
      OCC_KERNEL_SETTINGS,
    ).definition,
    pointIds: points.map((entry) => entry.pointId),
    points,
    entityIds: entities.map((entity) => entity.entityId),
    entities,
  };
  const session = {
    ...createNewSketchSession(
      createStandardPlaneDefinition("xy"),
      OCC_KERNEL_SETTINGS,
    ),
    sketchId,
    definition,
    projectedReferences: [projectedReference],
  };

  const geometry = collectSketchInteractionGeometry(session);
  const byKind = new Set(geometry.map((entry) => entry.kind));

  expect(
    byKind.has("point"),
    "Local point definitions and datum origin should be available as semantic interaction points.",
  ).toBeTruthy();
  expect(
    byKind.has("lineSegment"),
    "Local lines, projected lines, and datum axes should be available as semantic line segments.",
  ).toBeTruthy();
  expect(
    byKind.has("circle"),
    "Local and projected circles should be available as semantic circles.",
  ).toBeTruthy();
  expect(
    byKind.has("arc"),
    "Local and projected arcs should be available as semantic arcs.",
  ).toBeTruthy();
  expect(
    byKind.has("spline"),
    "No interaction consumer should retain a private spline interpretation.",
  ).toBeFalsy();
  expect(
    byKind.has("sampledCurve"),
    "Owner-produced spline display output and advanced curves should be sampled semantic curves.",
  ).toBeTruthy();
  expect(
    geometry.some((entry) => entry.target === points[0]!.target),
    "Local point interaction geometry must preserve the authored point target object.",
  ).toBeTruthy();
  expect(
    geometry.some((entry) => entry.target === entities[0]!.target),
    "Local entity interaction geometry must preserve the authored entity target object.",
  ).toBeTruthy();
  expect(
    geometry.some(
      (entry) =>
        entry.target.kind === "projectedReferenceGeometry" &&
        entry.target.referenceId === projectedReference.referenceId &&
        entry.target.geometryId === projectedReference.geometry[0]!.geometryId,
    ),
    "Projected interaction geometry must use the projectedReferenceGeometry target.",
  ).toBeTruthy();
  expect(
    geometry.some(
      (entry) =>
        entry.target.kind === "sketchDatumReference" &&
        entry.target.sketchId === sketchId &&
        entry.target.datumId === "xAxis",
    ),
    "Datum axes should use durable sketchDatumReference targets for the active sketch.",
  ).toBeTruthy();
});

test("closestPointOnSketchInteractionCurve respects arc sweeps and covers whole circles", () => {
  const sketchId = "sketch_primary" as SketchId;
  const point = (suffix: string, position: SketchPoint2D) =>
    createPointDefinition(
      sketchId,
      `sketch_point_${suffix}` as SketchPointId,
      suffix,
      position,
    );
  const center = point("center", [0, 0]);
  const start = point("start", [2, 0]);
  const end = point("end", [0, 2]);
  const points = [center, start, end];
  const arc = createArcEntityDefinition(
    sketchId,
    "sketch_entity_arc" as SketchEntityId,
    "Arc",
    center.pointId,
    start.pointId,
    end.pointId,
    "counterClockwise",
  );
  const circle = createCircleEntityDefinition(
    sketchId,
    "sketch_entity_circle" as SketchEntityId,
    "Circle",
    center.pointId,
    2,
  );
  const missingLine = createLineEntityDefinition(
    sketchId,
    "sketch_entity_missing_line" as SketchEntityId,
    "Missing line",
    start.pointId,
    "sketch_point_missing" as SketchPointId,
  );
  const definition: SketchDefinition = {
    ...createNewSketchSession(
      createStandardPlaneDefinition("xy"),
      OCC_KERNEL_SETTINGS,
    ).definition,
    pointIds: points.map((entry) => entry.pointId),
    points,
    entityIds: [arc.entityId, circle.entityId, missingLine.entityId],
    entities: [arc, circle, missingLine],
  };
  const session = {
    ...createNewSketchSession(
      createStandardPlaneDefinition("xy"),
      OCC_KERNEL_SETTINGS,
    ),
    sketchId,
    definition,
  };
  const geometry = collectSketchInteractionGeometry(session);
  const arcGeometry = geometry.find((entry) => entry.target === arc.target);
  const circleGeometry = geometry.find(
    (entry) => entry.target === circle.target,
  );

  assert(arcGeometry !== undefined, "arcGeometry should not be undefined.");
  expect(
    isSketchInteractionCurveGeometry(arcGeometry),
    "The authored arc should produce curve geometry.",
  ).toBeTruthy();
  expect(
    circleGeometry !== undefined &&
      isSketchInteractionCurveGeometry(circleGeometry),
    "The authored circle should produce curve geometry.",
  ).toBeTruthy();

  const closestOnArc = (point: SketchPoint2D) =>
    closestPointOnSketchInteractionCurve(
      arcGeometry as SketchInteractionCurveGeometry,
      point,
    )!;
  expect(
    nearestDistance(
      [closestOnArc([Math.SQRT2, Math.SQRT2])],
      [Math.SQRT2, Math.SQRT2],
    ) < 1e-12,
    "A point inside the authored sweep is its own closest arc point.",
  ).toBeTruthy();
  expect(
    nearestDistance([closestOnArc([-2, 0])], [-2, 0]) > 2,
    "The opposite side outside the authored sweep is not on the arc: its closest point is an authored end.",
  ).toBeTruthy();
  expect(closestOnArc([0.5, -2])).toBe(start.position);
  expect(closestOnArc([-2, 0.5])).toBe(end.position);

  for (const angle of [0, 1, 2.5, 4, 6]) {
    const probe: SketchPoint2D = [3 * Math.cos(angle), 3 * Math.sin(angle)];
    const closest = closestPointOnSketchInteractionCurve(
      circleGeometry as SketchInteractionCurveGeometry,
      probe,
    )!;
    expect(
      Math.abs(Math.hypot(...closest) - 2) < 1e-12 &&
        nearestDistance([closest], probe) - 1 < 1e-12,
      "Every direction of a whole circle is covered (closed curves have no gap).",
    ).toBeTruthy();
  }
  expect(
    geometry.some((entry) => entry.target === missingLine.target),
    "Entities with missing defining points should be excluded instead of receiving fallback targets.",
  ).toBeFalsy();
});

function makeProjectedReference(): ProjectedSketchReferenceRecord {
  return {
    referenceId: "reference_projected" as ReferenceId,
    status: "projected",
    geometry: [
      {
        kind: "lineSegment",
        geometryId: "projected_geometry_line" as ProjectedGeometryId,
        startPosition: [-1, -1],
        endPosition: [1, -1],
      },
      {
        kind: "circle",
        geometryId: "projected_geometry_circle" as ProjectedGeometryId,
        centerPosition: [0, 0],
        radius: 1,
      },
      {
        kind: "arc",
        geometryId: "projected_geometry_arc" as ProjectedGeometryId,
        centerPosition: [0, 0],
        startPosition: [1, 0],
        endPosition: [0, 1],
        sweepDirection: "counterClockwise",
      },
      {
        kind: "spline",
        geometryId: "projected_geometry_spline" as ProjectedGeometryId,
        representation: {
          kind: "sourceSamples",
          points: [
            [0, 0],
            [1, 1],
            [2, 0],
          ],
          isClosed: false,
        },
      },
    ],
    diagnostics: [],
  };
}

function nearestDistance(
  points: readonly SketchPoint2D[],
  target: SketchPoint2D,
) {
  return points.reduce(
    (nearest, point) =>
      Math.min(nearest, Math.hypot(point[0] - target[0], point[1] - target[1])),
    Number.POSITIVE_INFINITY,
  );
}

// Lane: logic (docs/testing.md). Seam: `collectSketchInteractionGeometry` /
// `closestPointOnSketchInteractionCurve` (T10f): splines pick along the
// display solved snapshot's spans; authored Béziers are exact cubic spans.
test("splines, projected neutral splines and authored Béziers are exact cubic spans with the owner's closest point", () => {
  const sketchId = "sketch_primary" as SketchId;
  const point = (suffix: string, position: SketchPoint2D) =>
    createPointDefinition(
      sketchId,
      `sketch_point_${suffix}` as SketchPointId,
      suffix,
      position,
    );
  const points = [
    point("s0", [0, 0]),
    point("s1", [2, 3]),
    point("s2", [5, -1]),
    point("s3", [8, 2]),
    point("q0", [0, 6]),
    point("q1", [3, 10]),
    point("q2", [6, 6]),
    point("c0", [10, 0]),
    point("c1", [11, 3]),
    point("c2", [13, 3]),
    point("c3", [14, 0]),
  ];
  const id = (index: number) => points[index]!.pointId;
  const spline = createSplineEntityDefinition(
    sketchId,
    "sketch_entity_spline" as SketchEntityId,
    "Spline",
    [id(0), id(1), id(2), id(3)],
  );
  const quadratic = createBezierCurveEntityDefinition(
    sketchId,
    "sketch_entity_quadratic" as SketchEntityId,
    "Quadratic",
    [id(4), id(5), id(6)],
    2,
  );
  const cubic = createBezierCurveEntityDefinition(
    sketchId,
    "sketch_entity_cubic" as SketchEntityId,
    "Cubic",
    [id(7), id(8), id(9), id(10)],
    3,
  );
  const base = createNewSketchSession(
    createStandardPlaneDefinition("xy"),
    OCC_KERNEL_SETTINGS,
  );
  const projected = makeProjectedReference();
  const neutralSpans = [
    {
      interval: [0, 1] as const,
      poles: [
        [20, 0],
        [21, 2],
        [23, 2],
        [24, 0],
      ] as SplinePoles,
      differential: {
        interval: [0, 0] as const,
        poles: [
          [0, 0],
          [0, 0],
          [0, 0],
          [0, 0],
        ] as SplinePoles,
      },
    },
  ];
  const session = {
    ...base,
    sketchId,
    definition: {
      ...base.definition,
      pointIds: points.map((entry) => entry.pointId),
      points,
      entityIds: [spline.entityId, quadratic.entityId, cubic.entityId],
      entities: [spline, quadratic, cubic],
    },
    projectedReferences: [
      {
        ...projected,
        geometry: [
          ...projected.geometry,
          {
            kind: "spline" as const,
            geometryId: "projected_geometry_neutral" as ProjectedGeometryId,
            representation: {
              kind: "neutralCubicSpans" as const,
              spans: neutralSpans,
            },
          },
        ],
      },
    ],
  };
  const geometry = collectSketchInteractionGeometry(session);
  const byTarget = (target: unknown) =>
    geometry.find((entry) => entry.target === target);

  const record = getSketchSessionDisplaySolvedSnapshot(
    session,
  ).solvedEntities.find((entry) => entry.entityId === spline.entityId)!;
  const splineGeometry = byTarget(spline.target);
  expect(
    splineGeometry?.kind === "cubicSpans" && splineGeometry.spans,
    "A spline picks along the display solved snapshot's spans.",
  ).toEqual(solvedCubicSpans(record));
  expect(solvedCubicSpans(record)).toHaveLength(3);

  const projectedGeometry = geometry.find(
    (entry) =>
      entry.id ===
      `projected:${projected.referenceId}:projected_geometry_neutral`,
  );
  expect(
    projectedGeometry?.kind === "cubicSpans" && projectedGeometry.spans,
    "A projected neutral spline picks along its own spans.",
  ).toBe(neutralSpans);
  expect(
    geometry.find(
      (entry) =>
        entry.id ===
        `projected:${projected.referenceId}:projected_geometry_spline`,
    )?.kind,
    "Projected source samples stay their polyline.",
  ).toBe("sampledCurve");

  const cubicGeometry = byTarget(cubic.target);
  expect(
    cubicGeometry?.kind === "cubicSpans" && cubicGeometry.spans,
    "A cubic Bézier is its own poles.",
  ).toEqual([
    {
      interval: [0, 1],
      poles: [
        [10, 0],
        [11, 3],
        [13, 3],
        [14, 0],
      ],
    },
  ]);
  const quadraticGeometry = byTarget(quadratic.target);
  expect(
    quadraticGeometry?.kind === "cubicSpans" && quadraticGeometry.spans,
    "A quadratic Bézier is degree-elevated exactly: P0, P0 + 2/3(P1 - P0), P2 + 2/3(P1 - P2), P2.",
  ).toEqual([
    {
      interval: [0, 1],
      poles: [
        [0, 6],
        [2, 6 + 8 / 3],
        [4, 6 + 8 / 3],
        [6, 6],
      ],
    },
  ]);

  // The closest point of the elevated cubic lies on the authored quadratic
  // (independent Bernstein form) and is its closest point (dense oracle).
  const onQuadratic = (t: number): SketchPoint2D => [
    6 * t,
    (1 - t) ** 2 * 6 + 2 * (1 - t) * t * 10 + t * t * 6,
  ];
  for (const probe of [
    [1, 9],
    [3, 5],
    [5.5, 8.5],
    [-1, 5],
  ] satisfies SketchPoint2D[]) {
    const closest = closestPointOnSketchInteractionCurve(
      quadraticGeometry as SketchInteractionCurveGeometry,
      probe,
    )!;
    // x = 6t on this quadratic, so t = x / 6 is its exact parameter.
    expect(
      nearestDistance([onQuadratic(closest[0] / 6)], closest),
    ).toBeLessThan(1e-12);
    let best = Number.POSITIVE_INFINITY;
    for (let k = 0; k <= 200000; k += 1)
      best = Math.min(best, nearestDistance([onQuadratic(k / 200000)], probe));
    expect(Math.abs(nearestDistance([closest], probe) - best)).toBeLessThan(
      1e-9,
    );
  }

  // The spline's closest point is the owner's (same spans, same domains).
  const spans = solvedCubicSpans(record);
  const probe: SketchPoint2D = [4, 2];
  const located = closestSplineSpanLocation(
    probe,
    spans.map((span) => ({
      ...span,
      differential: neutralSpans[0]!.differential,
    })),
  )!;
  expect(
    closestPointOnSketchInteractionCurve(
      splineGeometry as SketchInteractionCurveGeometry,
      probe,
    ),
  ).toEqual(solvedCubicSpanPoint(spans[located.spanIndex]!, located.u));
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

// Lane: logic (docs/testing.md). Seam: `collectSketchInteractionGeometry`
// with a not-accepted live solve (T10f review R-2): pick follows the drawn
// (authored) spline, not the best-effort solved spans.
test("with a not-accepted solve a spline picks along the authored reconstruction the display draws", () => {
  const { session, authored, drawn } = nonAcceptedSplineSession();
  const pick = collectSketchInteractionGeometry(session).find(
    (entry) => entry.id === "sketch-entity:sketch_entity_wave",
  );
  expect(pick?.kind === "cubicSpans" && pick.spans).toEqual(authored);
  expect(
    pick?.kind === "cubicSpans" &&
      tessellateCubicSpans(pick.spans).map((point) => [...point]),
    "Pick's spans draw exactly the displayed polyline.",
  ).toEqual(drawn);
});

// Lane: logic (docs/testing.md). Seam: `closestPointOnSketchInteractionCurve`
// for a closed sampled curve (T10f review A-6): the closing segment (last
// sample back to the first) is part of the curve.
test("a closed sampled curve's closing segment is searched", () => {
  const sketchId = "sketch_primary" as SketchId;
  const center = createPointDefinition(
    sketchId,
    "sketch_point_center" as SketchPointId,
    "center",
    [0, 0],
  );
  const major = createPointDefinition(
    sketchId,
    "sketch_point_major" as SketchPointId,
    "major",
    [4, 0],
  );
  const ellipse = createEllipseEntityDefinition(
    sketchId,
    "sketch_entity_ellipse" as SketchEntityId,
    "Ellipse",
    center.pointId,
    major.pointId,
    2,
  );
  const base = createNewSketchSession(
    createStandardPlaneDefinition("xy"),
    OCC_KERNEL_SETTINGS,
  );
  const geometry = collectSketchInteractionGeometry({
    ...base,
    sketchId,
    definition: {
      ...base.definition,
      pointIds: [center.pointId, major.pointId],
      points: [center, major],
      entityIds: [ellipse.entityId],
      entities: [ellipse],
    },
  }).find((entry) => entry.target === ellipse.target);
  assert(
    geometry?.kind === "sampledCurve" && geometry.isClosed,
    "the ellipse is a closed sampled curve",
  );
  const first = geometry.points[0]!;
  const last = geometry.points.at(-1)!;
  expect(
    nearestDistance([first], last) > 0.1,
    "premise: the samples do not repeat the start",
  ).toBeTruthy();
  // The midpoint of the closing chord, nudged outward.
  const probe: SketchPoint2D = [
    (first[0] + last[0]) / 2 + 1e-3,
    (first[1] + last[1]) / 2,
  ];
  const closest = closestPointOnSketchInteractionCurve(geometry, probe)!;
  expect(
    nearestDistance([closest], probe),
    "the closing segment is the nearest part",
  ).toBeLessThan(1.1e-3);
});
