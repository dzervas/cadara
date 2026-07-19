import { expect, test } from "vitest";

import type { HistoryProbeTopologySignature } from "@/contracts/import/capabilities";
import type { OnshapeGeometricSignature } from "@/contracts/import/onshape-capture-bundle";
import { matchSignature, type TopologyMatchTolerance } from "@/domain/import/onshape/signature-matcher";
import { normalizeOnshapeTopologySignature } from "@/domain/import/onshape/topology-signature-normalizer";

const tolerance: TopologyMatchTolerance = {
  linear: 0.01,
  angularRadians: 1e-4,
  relative: 1e-6,
  ambiguityMargin: 0.001,
};

const probe = (
  entityClass: HistoryProbeTopologySignature["entityClass"],
  geometryType: string,
  definingData: Record<string, unknown>,
  suffix = "a",
  boundingBox?: HistoryProbeTopologySignature["boundingBox"],
): HistoryProbeTopologySignature => ({
  entityClass,
  geometryType,
  definingData,
  boundingBox,
  reference: entityClass === "body"
    ? { kind: "body", bodyId: `body_${suffix}` as never }
    : entityClass === "face"
      ? { kind: "face", bodyId: "body" as never, faceId: `face_${suffix}` as never }
      : entityClass === "edge"
        ? { kind: "edge", bodyId: "body" as never, edgeId: `edge_${suffix}` as never }
        : { kind: "vertex", bodyId: "body" as never, vertexId: `vertex_${suffix}` as never },
});

test("normalizes all dimensional captured fields and the axis alias", () => {
  const normalized = normalizeOnshapeTopologySignature({
    entityClass: "face",
    geometryType: "cylinder",
    definingData: { axisOrigin: [0.001, 0.002, 0.003], axis: [0, 0, -1], radius: 0.004 },
    boundingBox: { low: [0, 0, 0], high: [0.01, 0.02, 0.03] },
    centroid: [0.005, 0.01, 0.015],
    tessellationSample: [0.001, 0.002, 0.003],
  });
  expect(normalized).toMatchObject({
    definingData: { axisOrigin: [1, 2, 3], axisDirection: [0, 0, -1], radius: 4 },
    boundingBox: { low: [0, 0, 0], high: [10, 20, 30] },
    centroid: [5, 10, 15],
    tessellationSample: [1, 2, 3],
  });
});

test("hard-gates unoriented planes, lines, cylinders, circles, vertices, and bodies", () => {
  const cases: [OnshapeGeometricSignature, HistoryProbeTopologySignature][] = [
    [
      { entityClass: "face", geometryType: "plane", definingData: { origin: [0, 0, 2], normal: [0, 0, 1] } },
      probe("face", "plane", { origin: [1, 1, 2], normal: [0, 0, -1] }),
    ],
    [
      { entityClass: "edge", geometryType: "line", definingData: { origin: [0, 0, 0], direction: [1, 0, 0] } },
      probe("edge", "line", { origin: [5, 0, 0], direction: [-1, 0, 0] }),
    ],
    [
      { entityClass: "face", geometryType: "cylinder", definingData: { axisOrigin: [0, 0, 0], axisDirection: [0, 0, 1], radius: 5 } },
      probe("face", "cylinder", { axisOrigin: [0, 0, 0], axisDirection: [0, 0, -1], radius: 5 }),
    ],
    [
      { entityClass: "edge", geometryType: "circle", definingData: { center: [0, 0, 0], axisDirection: [0, 0, 1], radius: 5 }, boundingBox: { low: [0, -5, 0], high: [5, 5, 0] } },
      probe("edge", "circle", { center: [0, 0, 0], axisDirection: [0, 0, -1], radius: 5 }, "circle", { low: [-5, -5, -5], high: [5, 5, 5] }),
    ],
    [
      { entityClass: "vertex", geometryType: "point", definingData: { point: [1, 2, 3] } },
      probe("vertex", "point", { point: [1, 2, 3] }),
    ],
    [
      { entityClass: "body", geometryType: "unknown", boundingBox: { low: [0, 0, 0], high: [10, 20, 30] } },
      probe("body", "solid", {}, "body", { low: [0, 0, 0], high: [10, 20, 30] }),
    ],
  ];
  for (const [captured, candidate] of cases) {
    expect(matchSignature(captured, [candidate], tolerance).kind).toBe("unique");
  }
});

test("mixed-unit probe (bbox mm, definingData meters) no-matches; full normalization matches uniquely", () => {
  // Regression for W.2: the plan-dump review mock scaled only bbox/centroid to
  // mm while leaving definingData (origin/center/radius) in meters, producing a
  // spurious topology-reference-no-match on off-origin chamfer edges.
  const scale = (p: [number, number, number]): [number, number, number] =>
    [p[0] * 1000, p[1] * 1000, p[2] * 1000];
  const captured: OnshapeGeometricSignature[] = [
    {
      entityClass: "edge",
      geometryType: "line",
      definingData: { origin: [-0.0675, 0.11, 0.191], direction: [1, 0, 0] },
      boundingBox: { low: [-0.0675, 0.11, 0.191], high: [0.0675, 0.11, 0.191] },
      centroid: [0, 0.11, 0.191],
    },
    {
      entityClass: "edge",
      geometryType: "circle",
      definingData: { center: [0.05, 0.05, 0.02], axis: [0, 0, 1], radius: 0.003 },
      boundingBox: { low: [0.047, 0.047, 0.02], high: [0.053, 0.053, 0.02] },
      centroid: [0.05, 0.05, 0.02],
    },
  ];
  for (const sig of captured) {
    // Production always normalizes the captured source to mm before matching.
    const source = normalizeOnshapeTopologySignature(sig);

    // Mixed units, exactly what the old plan-dump mock emitted for the probe:
    // bbox/centroid scaled to mm but definingData left in meters.
    const mixed: HistoryProbeTopologySignature = {
      ...sig,
      centroid: sig.centroid ? scale(sig.centroid) : undefined,
      boundingBox: sig.boundingBox
        ? { low: scale(sig.boundingBox.low), high: scale(sig.boundingBox.high) }
        : undefined,
      reference: { kind: "edge", bodyId: "body" as never, edgeId: "edge_mixed" as never },
    };
    expect(matchSignature(source, [mixed], tolerance).kind).toBe("noMatch");

    // Full normalization (what a real OCC probe emits) resolves uniquely.
    const normalized: HistoryProbeTopologySignature = {
      ...normalizeOnshapeTopologySignature(sig),
      reference: { kind: "edge", bodyId: "body" as never, edgeId: "edge_norm" as never },
    };
    expect(matchSignature(source, [normalized], tolerance).kind).toBe("unique");
  }
});

test("symmetric mirror edges resolve uniquely by analytic data yet stay ambiguous on bbox alone", () => {
  // Two diagonals of the same square face share an identical bounding box and
  // centroid; only the line direction/support (the enriched analytic evidence)
  // tells them apart. This is the W.2 symmetric-part failure mode.
  const squareBox = { low: [0, 0, 0] as const, high: [10, 10, 0] as const };
  const diagonalA: OnshapeGeometricSignature = {
    entityClass: "edge",
    geometryType: "line",
    definingData: { origin: [0, 0, 0], direction: [1, 1, 0] },
    boundingBox: squareBox,
    centroid: [5, 5, 0],
  };
  const diagonalBData = { origin: [0, 10, 0], direction: [1, -1, 0] };
  const probeA = probe("edge", "line", diagonalA.definingData!, "diag_a", squareBox);
  const probeB = probe("edge", "line", diagonalBData, "diag_b", squareBox);

  const enriched = matchSignature(diagonalA, [probeA, probeB], tolerance);
  expect(enriched.kind).toBe("unique");
  if (enriched.kind === "unique") expect(enriched.reference).toMatchObject({ edgeId: "edge_diag_a" });

  // Strip the analytic direction/support and the two mirrors become an honest
  // tie on bbox+centroid alone — never an arbitrary pick.
  const bboxOnly: OnshapeGeometricSignature = { ...diagonalA, definingData: {} };
  const ambiguous = matchSignature(
    bboxOnly,
    [{ ...probeA, definingData: {} }, { ...probeB, definingData: {} }],
    tolerance,
  );
  expect(ambiguous.kind).toBe("ambiguous");
});

test("genuinely coincident edges stay ambiguous even with full analytic evidence", () => {
  const edge: OnshapeGeometricSignature = {
    entityClass: "edge",
    geometryType: "line",
    definingData: { origin: [0, 0, 0], direction: [1, 1, 0] },
    boundingBox: { low: [0, 0, 0], high: [10, 10, 0] },
  };
  const first = probe("edge", "line", edge.definingData!, "coincident_a", edge.boundingBox);
  const second = probe("edge", "line", edge.definingData!, "coincident_b", edge.boundingBox);
  expect(matchSignature(edge, [first, second], tolerance).kind).toBe("ambiguous");
});

test("returns rejection evidence for analytic misses and never guesses symmetric candidates", () => {
  const captured: OnshapeGeometricSignature = {
    entityClass: "edge",
    geometryType: "circle",
    definingData: { center: [0, 0, 0], axisDirection: [0, 0, 1], radius: 5 },
  };
  const miss = matchSignature(captured, [
    probe("edge", "circle", { center: [2, 0, 0], axisDirection: [0, 0, 1], radius: 6 }),
  ], tolerance);
  expect(miss.kind).toBe("noMatch");
  if (miss.kind === "noMatch") {
    expect(miss.rejected[0]?.reasons).toContain("radius-out-of-tolerance");
  }

  const exact = probe("edge", "circle", captured.definingData!, "same");
  const ambiguous = matchSignature(captured, [exact, { ...exact, reference: { kind: "edge", bodyId: "body" as never, edgeId: "edge_other" as never } }], tolerance);
  expect(ambiguous.kind).toBe("ambiguous");
});
