import { test, expect } from "vitest";

import type { WorkspaceSnapshot } from "@/contracts/modeling/schema";
import type { RenderableEntityRecord } from "@/contracts/render/schema";
import type { PrimitiveRef } from "@/core/editor/schema";
import {
  deriveMeasurementViewModel,
  isMeasureSelectableTarget,
  resolveMeasureSelectionCandidate,
} from "@/core/measure/measurement";
import { RENDER_EXPORT_SCHEMA_VERSION } from "@/contracts/shared/versioning";
import { createStandardPlaneDefinition } from "@/core/modeling/opencascade-kernel-seed";
import { sketchSnapshotRecordForTest } from "@/contracts/sketch/region-record.fixtures";
import type { FaceId } from "@/contracts/shared/ids";
import type { SketchEntityDefinition } from "@/contracts/sketch/schema";
import {
  reconstructSplineAggregate,
  solvedCubicSpans,
  tessellateCubicSpans,
  type SplinePoles,
} from "@/contracts/sketch/spline-geometry";
import { curveLength } from "@/contracts/sketch/region-boundary-curves";
import {
  FIXTURE_SKETCH_ID,
  makeSketchFixture,
} from "@/contracts/sketch/region-extraction.fixtures";
import {
  createIdLabelledMeasurementSnapshotForTest,
  createMeasurementSnapshotForTest,
} from "@/core/measure/measurement.fixtures";

test("src/domain/measure/measurement.spec.ts", () => {
  const snapshot = createMeasurementSnapshotForTest();

  const lineMeasurement = deriveMeasurementViewModel({
    source: "measureTool",
    selection: [
      {
        kind: "sketchEntity",
        sketchId: "sketch_measure",
        entityId: "sketch_entity_line_bottom",
      },
    ],
    snapshot,
  });
  expect(
    lineMeasurement?.rows.some(
      (row) => row.label === "Length" && row.value === "4 mm",
    ),
    "Line measurement should expose intrinsic edge length.",
  ).toBeTruthy();

  const circleMeasurement = deriveMeasurementViewModel({
    source: "measureTool",
    selection: [
      {
        kind: "sketchEntity",
        sketchId: "sketch_measure",
        entityId: "sketch_entity_circle_primary",
      },
    ],
    snapshot,
  });
  expect(
    circleMeasurement?.rows.some(
      (row) => row.label === "Radius" && row.value === "1.25 mm",
    ),
    "Circle measurement should expose radius.",
  ).toBeTruthy();
  expect(
    circleMeasurement?.rows.some(
      (row) => row.label === "Diameter" && row.value === "2.5 mm",
    ),
    "Circle measurement should expose diameter.",
  ).toBeTruthy();
  expect(
    circleMeasurement?.rows.some((row) => row.label === "Circumference"),
    "Circle measurement should expose circumference.",
  ).toBeTruthy();

  // cadara-h026.5: two sketch circles/arcs measure centre to centre.
  const circleArcMeasurement = deriveMeasurementViewModel({
    source: "measureTool",
    selection: [
      {
        kind: "sketchEntity",
        sketchId: "sketch_measure",
        entityId: "sketch_entity_circle_primary",
      },
      {
        kind: "sketchEntity",
        sketchId: "sketch_measure",
        entityId: "sketch_entity_arc_primary",
      },
    ],
    snapshot,
  });
  expect(
    circleArcMeasurement?.rows,
    "A circle and an arc (centres 4 apart) should expose their centre distance.",
  ).toContainEqual({
    id: "center-distance",
    label: "Center Distance",
    value: "4 mm",
  });

  const arcMeasurement = deriveMeasurementViewModel({
    source: "measureTool",
    selection: [
      {
        kind: "sketchEntity",
        sketchId: "sketch_measure",
        entityId: "sketch_entity_arc_primary",
      },
    ],
    snapshot,
  });
  expect(
    arcMeasurement?.rows.some(
      (row) => row.label === "Sweep" && row.value === "90 deg",
    ),
    "Arc measurement should expose sweep angle.",
  ).toBeTruthy();
  expect(
    arcMeasurement?.rows.some(
      (row) => row.label === "Arc Length" && row.value === "1.57 mm",
    ),
    "Arc measurement should expose arc length.",
  ).toBeTruthy();

  const splineMeasurement = deriveMeasurementViewModel({
    source: "measureTool",
    selection: [
      {
        kind: "sketchEntity",
        sketchId: "sketch_measure",
        entityId: "sketch_entity_spline_primary",
      },
    ],
    snapshot,
  });
  expect(
    splineMeasurement?.rows.some(
      (row) => row.label === "Closed" && row.value === "No",
    ),
    "Spline measurement should expose authored closure.",
  ).toBeTruthy();
  expect(
    splineMeasurement?.rows.some(
      (row) => row.label === "Fit Points" && row.value === "3",
    ),
    "Spline measurement should expose fit-point metadata.",
  ).toBeTruthy();

  const regionMeasurement = deriveMeasurementViewModel({
    source: "measureTool",
    selection: [
      {
        kind: "region",
        sketchId: "sketch_measure",
        regionId: "region_measure",
      },
    ],
    snapshot,
  });
  expect(
    regionMeasurement?.rows.some(
      (row) => row.label === "Area" && row.value === "12 mm²",
    ),
    "Region measurement should expose profile area.",
  ).toBeTruthy();
  expect(
    regionMeasurement?.rows.some(
      (row) => row.label === "Perimeter" && row.value === "14 mm",
    ),
    "Region measurement should expose profile perimeter.",
  ).toBeTruthy();

  const faceMeasurement = deriveMeasurementViewModel({
    source: "measureTool",
    selection: [{ kind: "face", bodyId: "body_measure", faceId: "face_top" }],
    snapshot,
  });
  expect(
    faceMeasurement?.rows.some(
      (row) => row.label === "Area" && row.value === "≈ 12 mm²",
    ),
    "Face measurement should expose surface area.",
  ).toBeTruthy();
  expect(
    faceMeasurement?.rows.some(
      (row) => row.label === "Perimeter" && row.value === "≈ 14 mm",
    ),
    "Face measurement should expose perimeter.",
  ).toBeTruthy();

  const bodyMeasurement = deriveMeasurementViewModel({
    source: "measureTool",
    selection: [{ kind: "body", bodyId: "body_measure" }],
    snapshot,
  });
  expect(
    bodyMeasurement?.rows.some(
      (row) => row.label === "Surface Area" && row.value === "≈ 94 mm²",
    ),
    "Body measurement should expose surface area when every face mesh is available.",
  ).toBeTruthy();
  expect(
    bodyMeasurement?.rows.some(
      (row) => row.label === "Volume" && row.value === "≈ 60 mm³",
    ),
    "Body measurement should expose solid volume when the body shell closes.",
  ).toBeTruthy();

  const pairMeasurement = deriveMeasurementViewModel({
    source: "measureTool",
    selection: [
      {
        kind: "vertex",
        bodyId: "body_measure",
        vertexId: "vertex_top_front_left",
      },
      { kind: "face", bodyId: "body_measure", faceId: "face_bottom" },
    ],
    snapshot,
  });
  expect(
    pairMeasurement?.rows.map((row) => [row.label, row.value]),
    "Supported pairwise measurements should expose the minimum distance and its X/Y/Z components (cadara-h026.3), no angle for a point.",
  ).toEqual([
    ["Distance", "≈ 5 mm"],
    ["ΔX", "≈ 0 mm"],
    ["ΔY", "≈ 0 mm"],
    ["ΔZ", "≈ 5 mm"],
  ]);
  expect(
    pairMeasurement?.witnesses.length,
    "Pairwise measurements should retain a witness segment with endpoint markers.",
  ).toBe(3);

  const parallelEdgeMeasurement = deriveMeasurementViewModel({
    source: "measureTool",
    selection: [
      { kind: "edge", bodyId: "body_measure", edgeId: "edge_top_front" },
      { kind: "edge", bodyId: "body_measure", edgeId: "edge_top_back" },
    ],
    snapshot,
  });
  expect(
    parallelEdgeMeasurement?.rows.some(
      (row) => row.label === "Distance" && row.value === "≈ 3 mm",
    ),
    "Parallel edge measurements should expose perpendicular spacing between the two selected edges.",
  ).toBeTruthy();
  expect(
    parallelEdgeMeasurement?.rows.some(
      (row) => row.label === "Angle" && row.value === "0 deg",
    ),
    "Parallel edge measurements should expose zero angle for parallel line-like edges.",
  ).toBeTruthy();
  expect(
    parallelEdgeMeasurement?.witnesses.length,
    "Parallel edge measurements should keep both edge highlights plus a single connector line.",
  ).toBe(3);
  expect(
    parallelEdgeMeasurement?.witnesses.every(
      (witness) => witness.kind !== "marker",
    ),
    "Curve-to-curve pairwise measurements should not add endpoint markers that read like vertex selection.",
  ).toBeTruthy();
  const parallelConnector = parallelEdgeMeasurement?.witnesses.find((witness) =>
    witness.id.includes(":distance"),
  );
  expect(
    parallelConnector?.kind === "polyline" &&
      JSON.stringify(parallelConnector.points) ===
        JSON.stringify([
          [2, 0, 5],
          [2, 3, 5],
        ]),
    "Parallel edge connectors should anchor at representative mid-span closest points rather than arbitrary segment starts.",
  ).toBeTruthy();

  const touchingEdgeMeasurement = deriveMeasurementViewModel({
    source: "measureTool",
    selection: [
      { kind: "edge", bodyId: "body_measure", edgeId: "edge_top_front" },
      { kind: "edge", bodyId: "body_measure", edgeId: "edge_top_left" },
    ],
    snapshot,
  });
  expect(
    touchingEdgeMeasurement?.rows.some(
      (row) => row.label === "Distance" && row.value === "≈ 0 mm",
    ),
    "Intersecting edge measurements should still report zero minimum distance.",
  ).toBeTruthy();
  expect(
    touchingEdgeMeasurement?.rows.some(
      (row) => row.label === "Angle" && row.value === "90 deg",
    ),
    "Intersecting perpendicular edge measurements should also expose the line-to-line angle.",
  ).toBeTruthy();
  expect(
    touchingEdgeMeasurement?.witnesses.length,
    "Zero-distance edge measurements should keep only the two selected edge highlights.",
  ).toBe(2);
  expect(
    touchingEdgeMeasurement?.witnesses.every(
      (witness) =>
        witness.kind === "polyline" && !witness.id.includes(":distance"),
    ),
    "Zero-distance edge measurements should omit collapsed connector and marker feedback.",
  ).toBeTruthy();

  const projectedMeasurement = deriveMeasurementViewModel({
    source: "measureTool",
    selection: [
      {
        kind: "projectedReferenceGeometry",
        referenceId: "ref_projected_circle",
        geometryId: "projected_geometry_circle",
        geometryKind: "circle",
      },
    ],
    snapshot,
  });
  expect(
    projectedMeasurement?.rows.some(
      (row) => row.label === "Radius" && row.value === "1 mm",
    ),
    "Projected circles should expose single-target circular properties.",
  ).toBeTruthy();

  expect(
    isMeasureSelectableTarget(snapshot, {
      kind: "sketchEntity",
      sketchId: "sketch_measure",
      entityId: "sketch_entity_arc_primary",
    }),
    "Supported sketch arcs should be accepted by the measure selection filter.",
  ).toBeTruthy();

  const pairCandidate = resolveMeasureSelectionCandidate(
    snapshot,
    [
      {
        kind: "vertex",
        bodyId: "body_measure",
        vertexId: "vertex_top_front_left",
      },
    ],
    { kind: "face", bodyId: "body_measure", faceId: "face_bottom" },
  );
  expect(
    pairCandidate.accepted && pairCandidate.nextSelection.length === 2,
    "Compatible measure targets should build a pair.",
  ).toBeTruthy();

  // T10e (plan §2.3): point ↔ curve distance is exact on the curve; the
  // closest point is checked against an independent minimisation (own
  // Bernstein evaluator, dense grid plus golden section), far tighter than
  // the 48-segment tessellation's chord error.
  const splineEntity =
    snapshot.document.sketches[0]!.sketch.definition.entities.find(
      (entity) => entity.entityId === "sketch_entity_spline_primary",
    )!;
  const splinePositions = Object.fromEntries(
    snapshot.document.sketches[0]!.sketch.definition.points.map((point) => [
      point.pointId,
      point.position,
    ]),
  );
  const probe = [16.4, 1.3] as const;
  const oracle = closestOnCubicsOracle(
    probe,
    reconstructSplineAggregate(
      splineEntity as Extract<typeof splineEntity, { kind: "spline" }>,
      splinePositions,
    ).spans.map((span) => span.poles),
  );
  const pointToSpline = deriveMeasurementViewModel({
    source: "measureTool",
    selection: [
      {
        kind: "sketchPoint",
        sketchId: "sketch_measure",
        pointId: "sketch_point_probe",
      },
      {
        kind: "sketchEntity",
        sketchId: "sketch_measure",
        entityId: "sketch_entity_spline_primary",
      },
    ],
    snapshot,
  });
  const connector = pointToSpline?.witnesses.find((witness) =>
    witness.id.endsWith(":distance"),
  );
  expect(connector?.kind, "Point ↔ spline keeps its connector.").toBe(
    "polyline",
  );
  if (connector?.kind !== "polyline") {
    throw new Error("Point ↔ spline connector is missing.");
  }
  const onCurve = connector.points[1]!;
  // The distance is stationary at the minimum, so it is compared tightly and
  // the location (determined only to about √ε along the curve) loosely.
  expect(
    Math.abs(
      Math.hypot(onCurve[0]! - probe[0], onCurve[1]! - probe[1]) -
        Math.hypot(oracle[0] - probe[0], oracle[1] - probe[1]),
    ),
    "The point ↔ spline distance is the exact closest distance.",
  ).toBeLessThan(1e-13);
  expect(
    Math.hypot(onCurve[0]! - oracle[0], onCurve[1]! - oracle[1]),
    "The point ↔ spline witness ends at the exact closest point of the spline.",
  ).toBeLessThan(1e-7);
  expect(
    pointToSpline?.rows.find((row) => row.label === "Distance")?.value,
    "An exact point ↔ curve distance is not marked approximate.",
  ).toBe(
    `${Math.hypot(oracle[0] - probe[0], oracle[1] - probe[1]).toFixed(2)} mm`,
  );

  const splineToLine = deriveMeasurementViewModel({
    source: "measureTool",
    selection: [
      {
        kind: "sketchEntity",
        sketchId: "sketch_measure",
        entityId: "sketch_entity_spline_primary",
      },
      {
        kind: "sketchEntity",
        sketchId: "sketch_measure",
        entityId: "sketch_entity_line_bottom",
      },
    ],
    snapshot,
  });
  expect(
    splineToLine?.rows.find((row) => row.label === "Distance")?.value,
    "A curve ↔ curve distance on a tessellated spline is labelled approximate (T-6, R7).",
  ).toMatch(/^≈ /);

  // Review A-3: a probe outside a clockwise arc's sweep measures to the
  // nearer arc end, not to the unclamped circle (1.11 mm here).
  const pointToArc = deriveMeasurementViewModel({
    source: "measureTool",
    selection: [
      {
        kind: "sketchPoint",
        sketchId: "sketch_measure",
        pointId: "sketch_point_arc_probe",
      },
      {
        kind: "sketchEntity",
        sketchId: "sketch_measure",
        entityId: "sketch_entity_arc_clockwise",
      },
    ],
    snapshot,
  });
  expect(
    pointToArc?.rows.find((row) => row.label === "Distance")?.value,
    "Point ↔ clockwise arc clamps to the nearer arc end (√(0.8² + 1.1²)).",
  ).toBe(`${Math.hypot(0.8, 1.1).toFixed(2)} mm`);
  const arcConnector = pointToArc?.witnesses.find((witness) =>
    witness.id.endsWith(":distance"),
  );
  expect(
    arcConnector?.kind === "polyline" && arcConnector.points[1],
    "The witness ends at the arc's end point.",
  ).toEqual([13, 1.5, 0]);

  const replacementCandidate = resolveMeasureSelectionCandidate(
    snapshot,
    [{ kind: "body", bodyId: "body_measure" }],
    { kind: "edge", bodyId: "body_measure", edgeId: "edge_top_front" },
  );
  expect(
    replacementCandidate.accepted &&
      replacementCandidate.nextSelection.length === 1 &&
      replacementCandidate.nextSelection[0]?.kind === "edge",
    "Unsupported second targets should replace the prior selection with a fresh measurement seed.",
  ).toBeTruthy();
});

test("cadara-h026.4: readout target labels name the geometry kind and its owner, never a durable id", () => {
  const snapshot = createIdLabelledMeasurementSnapshotForTest();
  const vertex: PrimitiveRef = {
    kind: "vertex",
    bodyId: "body_measure",
    vertexId: "vertex_top_front_left",
  };
  const face: PrimitiveRef = {
    kind: "face",
    bodyId: "body_measure",
    faceId: "face_bottom",
  };
  const rows: [readonly PrimitiveRef[], readonly string[]][] = [
    [[face], ["Face · Body A"]],
    [
      [{ kind: "edge", bodyId: "body_measure", edgeId: "edge_top_front" }],
      ["Edge · Body A"],
    ],
    [[{ kind: "body", bodyId: "body_measure" }], ["Body A"]],
    [
      [
        {
          kind: "sketchEntity",
          sketchId: "sketch_measure",
          entityId: "sketch_entity_circle_primary",
        },
      ],
      ["Circle 1 · Measure Sketch"],
    ],
    [
      [
        {
          kind: "region",
          sketchId: "sketch_measure",
          regionId: "region_measure",
        },
      ],
      ["Profile region · Measure Sketch"],
    ],
    [
      [
        {
          kind: "projectedReferenceGeometry",
          referenceId: "ref_projected_circle",
          geometryId: "projected_geometry_circle",
          geometryKind: "circle",
        },
      ],
      ["Projected circle · Measure Sketch"],
    ],
    [
      [vertex, face],
      ["Vertex · Body A", "Face · Body A"],
    ],
  ];

  for (const [selection, expected] of rows) {
    const labels = deriveMeasurementViewModel({
      source: "measureTool",
      selection,
      snapshot,
    })?.targetLabels;
    expect(labels, `labels of ${JSON.stringify(selection)}`).toEqual(expected);
    const ids = selection.flatMap((target) =>
      Object.entries(target)
        .filter(([key]) => key !== "kind" && key !== "geometryKind")
        .map(([, id]) => String(id)),
    );
    for (const id of ids) {
      expect(
        labels?.some((label) => label.includes(id)),
        `no readout label shows the durable id ${id}`,
      ).toBe(false);
    }
  }
});

/** Independent closest point on cubic spans: dense grid, then golden section. */
function closestOnCubicsOracle(
  point: readonly [number, number],
  spans: readonly SplinePoles[],
): readonly [number, number] {
  const at = ([p0, p1, p2, p3]: SplinePoles, u: number) => {
    const v = 1 - u;
    const [b0, b1, b2, b3] = [
      v * v * v,
      3 * u * v * v,
      3 * u * u * v,
      u * u * u,
    ];
    return [
      b0 * p0[0] + b1 * p1[0] + b2 * p2[0] + b3 * p3[0],
      b0 * p0[1] + b1 * p1[1] + b2 * p2[1] + b3 * p3[1],
    ] as const;
  };
  const gap = (poles: SplinePoles, u: number) => {
    const [x, y] = at(poles, u);
    return Math.hypot(x - point[0], y - point[1]);
  };
  let best = { poles: spans[0]!, u: 0, d: Infinity };
  for (const poles of spans)
    for (let k = 0; k <= 20000; k += 1) {
      const d = gap(poles, k / 20000);
      if (d < best.d) best = { poles, u: k / 20000, d };
    }
  let [lo, hi] = [Math.max(0, best.u - 1e-4), Math.min(1, best.u + 1e-4)];
  const ratio = (Math.sqrt(5) - 1) / 2;
  for (let step = 0; step < 200; step += 1) {
    const a = hi - ratio * (hi - lo);
    const b = lo + ratio * (hi - lo);
    if (gap(best.poles, a) < gap(best.poles, b)) hi = b;
    else lo = a;
  }
  return at(best.poles, (lo + hi) / 2);
}

// Lane: logic (docs/testing.md). Seam: `deriveMeasurementViewModel` on a
// committed sketch record (T10f review R-1): an entity spline is measured
// along the record's solved spans, never the authored reconstruction.
test("entity splines measure the record's solved spans; no valid solved spline measures nothing", () => {
  const sketch = makeSketchFixture();
  sketch.point("a", 16, 0);
  sketch.point("b", 17.5, 2.5);
  sketch.point("c", 19, 0);
  sketch.point("probe", 17.4, 1.2);
  sketch.spline("arch", ["a", "b", "c"], "open");
  // The solved snapshot holds b at (17.5, 2.5); the definition keeps (17.5, 2).
  const solved = sketch.build().solvedSnapshot;
  sketch.move("b", 17.5, 2);
  const plane = createStandardPlaneDefinition("xy");
  const recordOf = (solvedSnapshot: typeof solved) =>
    sketchSnapshotRecordForTest(
      { ...sketch.build(), solvedSnapshot },
      [],
      plane,
    );
  const measure = (
    record: ReturnType<typeof recordOf>,
    selection: readonly PrimitiveRef[],
  ) =>
    deriveMeasurementViewModel({
      source: "measureTool",
      selection,
      snapshot: { document: { sketches: [record] } } as never,
    });
  const spline = {
    kind: "sketchEntity",
    sketchId: FIXTURE_SKETCH_ID,
    entityId: "sketch_entity_arch",
  } as PrimitiveRef;
  const record = recordOf(solved);
  const spans = solvedCubicSpans(
    solved.solvedEntities.find(
      (entry) => entry.entityId === "sketch_entity_arch",
    )!,
  );
  const length = spans.reduce(
    (sum, span) =>
      sum +
      curveLength({ kind: "cubicBezier", poles: span.poles }, [0, 1]).value,
    0,
  );
  const formatted = `${length
    .toFixed(2)
    .replace(/\.00$/, "")
    .replace(/(\.\d)0$/, "$1")} mm`;
  const measured = measure(record, [spline]);
  expect(
    measured?.rows.find((row) => row.label === "Length")?.value,
    "Length is the solved spans' length.",
  ).toBe(formatted);
  const authoredLength = reconstructSplineAggregate(
    record.sketch.definition.entities[0] as Extract<
      SketchEntityDefinition,
      { kind: "spline" }
    >,
    Object.fromEntries(
      record.sketch.definition.points.map((point) => [
        point.pointId,
        point.position,
      ]),
    ),
  ).spans.reduce(
    (sum, span) =>
      sum +
      curveLength({ kind: "cubicBezier", poles: span.poles }, [0, 1]).value,
    0,
  );
  expect(
    Math.abs(authoredLength - length),
    "premise: the authored reconstruction measures differently",
  ).toBeGreaterThan(0.05);
  const witness = measured?.witnesses.find(
    (entry) => entry.kind === "polyline",
  );
  expect(
    witness?.kind === "polyline" &&
      witness.points.map((point) => [point[0], point[1]]),
    "The witness is the solved spans' display tessellation.",
  ).toEqual(tessellateCubicSpans(spans, 48).map((point) => [...point]));

  const probe = [17.4, 1.2] as const;
  const oracle = closestOnCubicsOracle(
    probe,
    spans.map((span) => span.poles),
  );
  const distance = measure(record, [
    {
      kind: "sketchPoint",
      sketchId: FIXTURE_SKETCH_ID,
      pointId: "sketch_point_probe",
    } as PrimitiveRef,
    spline,
  ])?.witnesses.find((entry) => entry.id.endsWith(":distance"));
  if (distance?.kind !== "polyline") {
    throw new Error("Solved spline distance connector is missing.");
  }
  const onCurve = distance.points[1]!;
  expect(
    Math.abs(
      Math.hypot(onCurve[0]! - probe[0], onCurve[1]! - probe[1]) -
        Math.hypot(oracle[0] - probe[0], oracle[1] - probe[1]),
    ),
    "Point ↔ spline follows the solved spans.",
  ).toBeLessThan(1e-13);

  // Deliberate behaviour change: no solved record, or an invalid one,
  // measures nothing (the authored points are not modeling data).
  const withoutRecord = recordOf({ ...solved, solvedEntities: [] });
  expect(measure(withoutRecord, [spline])).toBeNull();
  const invalid = recordOf({
    ...solved,
    solvedEntities: solved.solvedEntities.map((entry) =>
      entry.kind === "spline"
        ? {
            ...entry,
            reconstruction: { ...entry.reconstruction, validity: "invalid" },
          }
        : entry,
    ) as typeof solved.solvedEntities,
  });
  expect(measure(invalid, [spline])).toBeNull();
});

/**
 * A 6 × 6 × 2 prism with a centred 2 × 2 through hole (volume 64), every
 * face meshed on its own (no shared vertex arrays, as the kernel exports
 * faces). `inwardFaces` lists the faces whose triangles are wound against
 * the outward normal: unoriented meshes are accepted, so the measure must
 * not trust the winding.
 */
function holedPrismSnapshot(input: {
  inwardFaces: readonly string[] | "all";
  dropTriangleOf?: string;
}): WorkspaceSnapshot {
  type P = readonly [number, number, number];
  const outer: [number, number][] = [
    [0, 0],
    [6, 0],
    [6, 6],
    [0, 6],
  ];
  const inner: [number, number][] = [
    [2, 2],
    [4, 2],
    [4, 4],
    [2, 4],
  ];
  const at = ([x, y]: [number, number], z: number): P => [x, y, z];
  /** The annulus between the squares at height z, wound towards +z. */
  const annulus = (z: number) =>
    outer.flatMap((corner, index) => {
      const next = (index + 1) % 4;
      return [
        [at(corner, z), at(outer[next]!, z), at(inner[next]!, z)],
        [at(corner, z), at(inner[next]!, z), at(inner[index]!, z)],
      ] as P[][];
    });
  /** A vertical wall from a to b (0 → 2), wound with a left-hand normal. */
  const wall = (a: [number, number], b: [number, number]) =>
    [
      [at(a, 0), at(b, 0), at(b, 2)],
      [at(a, 0), at(b, 2), at(a, 2)],
    ] as P[][];
  const faces: Record<FaceId, P[][]> = {
    // Wound towards +z: outward on top, inward at the bottom.
    face_top: annulus(2),
    face_bottom: annulus(0),
  };
  outer.forEach((corner, index) => {
    // Counter-clockwise outer square: outward is to the right of a → b.
    faces[`face_outer_${index}`] = wall(outer[(index + 1) % 4]!, corner);
  });
  inner.forEach((corner, index) => {
    // The hole's walls face the hole: outward is to the left of a → b.
    faces[`face_inner_${index}`] = wall(corner, inner[(index + 1) % 4]!);
  });
  // Bring every face to its outward winding, then wind the listed ones in.
  faces.face_bottom = faces.face_bottom!.map(([a, b, c]) => [a!, c!, b!]);
  const records: RenderableEntityRecord[] = (
    Object.entries(faces) as [FaceId, P[][]][]
  ).map(([faceId, triangles]) => {
    const wound =
      input.inwardFaces === "all" || input.inwardFaces.includes(faceId)
        ? triangles.map(([a, b, c]) => [a!, c!, b!])
        : triangles;
    const kept = input.dropTriangleOf === faceId ? wound.slice(1) : wound;
    return {
      id: `renderable_${faceId}`,
      label: faceId,
      ownerBodyId: "body_holed",
      ownerFeatureId: "feature_holed",
      binding: {
        pickId: `pick_${faceId}`,
        pickPriority: 10,
        target: { kind: "face", bodyId: "body_holed", faceId },
        topology: "face",
        semanticClass: "bodyFace",
      },
      geometry: {
        kind: "mesh",
        vertexPositions: kept.flat(),
        vertexNormals: null,
        triangleIndices: kept.map(
          (_, index) => [index * 3, index * 3 + 1, index * 3 + 2] as const,
        ),
      },
    };
  });
  return {
    document: {
      bodies: [
        {
          bodyId: "body_holed",
          label: "Holed body",
          topology: {
            faceIds: Object.keys(faces),
            edgeIds: [],
            vertexIds: [],
          },
        },
      ],
      render: { schemaVersion: RENDER_EXPORT_SCHEMA_VERSION, records },
    },
  } as unknown as WorkspaceSnapshot;
}

const holedVolume = (snapshot: WorkspaceSnapshot) =>
  deriveMeasurementViewModel({
    source: "measureTool",
    selection: [{ kind: "body", bodyId: "body_holed" }],
    snapshot,
  })?.rows.find((row) => row.label === "Volume")?.value ?? null;

// T17h (Category 1 flow, R-6: the Measure tool's Volume readout is the
// acceptance oracle): before T17h each triangle was turned "outward" from the
// vertex centroid, which lies in the hole here, so the hole's walls counted
// with the wrong sign (74.67 mm³ = 2 · (36 + 4/3)).
test("a body with a through hole measures its solid volume, whatever each face's winding; an open shell has no volume", () => {
  expect(
    holedVolume(holedPrismSnapshot({ inwardFaces: [] })),
    "all faces wound outward",
  ).toBe("≈ 64 mm³");
  expect(
    holedVolume(
      holedPrismSnapshot({
        inwardFaces: [
          "face_bottom",
          "face_outer_1",
          "face_inner_0",
          "face_inner_3",
        ],
      }),
    ),
    "mixed windings (unoriented face meshes)",
  ).toBe("≈ 64 mm³");
  expect(
    holedVolume(
      holedPrismSnapshot({
        inwardFaces: "all",
      }),
    ),
    "every face wound inward",
  ).toBe("≈ 64 mm³");
  expect(
    holedVolume(
      holedPrismSnapshot({ inwardFaces: [], dropTriangleOf: "face_inner_2" }),
    ),
    "a shell with a missing triangle encloses no volume",
  ).toBeNull();
});
