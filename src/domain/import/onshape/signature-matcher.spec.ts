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
