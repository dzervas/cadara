import { expect, test } from "vitest";

import type { OnshapeRollbackSnapshot } from "@/contracts/import/onshape-capture-bundle";
import {
  planBakeSegments,
  unreachableFeatureDependencies,
  type BakeSegmentFeature,
} from "@/domain/import/onshape/bake-segment-planner";

type Bounds = readonly [
  readonly [number, number, number],
  readonly [number, number, number],
];

const DEFAULT_BOUNDS: Bounds = [[0, 0, 0], [1, 1, 1]];

test("declared reachability isolates independent branches and accepts checkpoint body lineage", () => {
  const dependencies = [
    { kind: "sketch" as const, featureId: "S_PROFILE" },
    { kind: "body" as const, featureId: "E_BASE" },
  ];

  expect(unreachableFeatureDependencies(dependencies, {
    reachableSketchFeatureIds: new Set(["S_PROFILE"]),
    reachableBodyFeatureIds: new Set(["E_BASE"]),
  })).toEqual([]);
  expect(unreachableFeatureDependencies(dependencies, {
    reachableSketchFeatureIds: new Set(),
    // A checkpoint represents E_BASE's body lineage even though E_BASE itself baked.
    reachableBodyFeatureIds: new Set(["E_BASE"]),
  })).toEqual([{ kind: "sketch", featureId: "S_PROFILE" }]);
});

function snapshot(
  featureId: string,
  bodies: Readonly<Record<string, Bounds>>,
): OnshapeRollbackSnapshot {
  return {
    featureId,
    tessellationTolerance: 0.0001,
    tessellatedFaces: {
      bodies: Object.entries(bodies).map(([id, [low, high]]) => ({
        id,
        faces: [{
          id: `${id}-face`,
          facets: [{
            vertices: [
              { x: low[0], y: low[1], z: low[2] },
              { x: high[0], y: low[1], z: low[2] },
              { x: high[0], y: high[1], z: high[2] },
            ],
          }],
        }],
      })),
    },
  };
}

function parametric(
  featureId: string,
  producedBodyDeterministicIds: readonly string[],
  consumedBodyDeterministicIds: readonly string[] = [],
): BakeSegmentFeature {
  return {
    featureId,
    kind: "parametricBody",
    transition: {
      consumedBodyDeterministicIds,
      producedBodyDeterministicIds,
    },
  };
}

function plan(
  features: readonly BakeSegmentFeature[],
  rollbackSnapshots: readonly OnshapeRollbackSnapshot[],
) {
  return planBakeSegments({
    captureFormatVersion: 2,
    historyProbeAvailable: true,
    features,
    rollbackSnapshots,
  });
}

test("collapses consecutive baked body changes into one checkpoint and restarts the parametric ledger", () => {
  const features: BakeSegmentFeature[] = [
    parametric("P1", ["A"]),
    { featureId: "sketch-baked", kind: "bakedDependency" },
    { featureId: "variable", kind: "passThrough" },
    { featureId: "B1", kind: "bakedBody" },
    { featureId: "suppressed", kind: "suppressed" },
    { featureId: "B2", kind: "bakedBody" },
    parametric("P2", ["C"], ["A"]),
  ];
  const result = plan(features, [
    snapshot("P1", { A: DEFAULT_BOUNDS }),
    snapshot("B1", { A: [[1, 0, 0], [2, 1, 1]] }),
    snapshot("B2", { A: [[2, 0, 0], [3, 1, 1]] }),
    snapshot("P2", { C: [[2, 0, 0], [4, 1, 1]] }),
  ]);

  expect(result.strategy).toMatchObject({ kind: "segments" });
  if (result.strategy.kind !== "segments") throw new Error("Expected segmented strategy.");
  expect(result.strategy.segments).toHaveLength(1);
  expect(result.strategy.segments[0]).toMatchObject({
    segmentId: "bake-segment-1",
    fromFeatureId: "sketch-baked",
    toFeatureId: "B2",
    featureIds: ["sketch-baked", "B1", "B2"],
    boundaryFeatureId: "B2",
    checkpointBodyDeterministicIds: ["A"],
    directlyAffectedBodyDeterministicIds: ["A"],
    consumedBodyDeterministicIds: ["A"],
    carriedBodyDeterministicIds: [],
    replacementProducerFeatureIds: ["P1"],
  });
  expect(result.strategy.segments[0]?.bodyBindings[0]).toMatchObject({
    deterministicId: "A",
    sourceComponentKey: "onshape-body:A",
    capturedSignature: {
      entityClass: "body",
      geometryType: "tessellated-body",
      boundingBox: { low: [2, 0, 0], high: [3, 1, 1] },
    },
  });
  expect(result.finalBodyProducers).toEqual([{
    producerFeatureId: "P2",
    producerKind: "parametric",
    bodyDeterministicIds: ["C"],
  }]);
});

test("carries live siblings from a replaced producer while preserving independent producers", () => {
  const result = plan([
    parametric("P1", ["A", "B"]),
    parametric("independent", ["Z"]),
    { featureId: "B1", kind: "bakedBody" },
  ], [
    snapshot("P1", { A: DEFAULT_BOUNDS, B: [[2, 0, 0], [3, 1, 1]] }),
    snapshot("independent", {
      A: DEFAULT_BOUNDS,
      B: [[2, 0, 0], [3, 1, 1]],
      Z: [[5, 0, 0], [6, 1, 1]],
    }),
    snapshot("B1", {
      A: [[0, 0, 0], [1.5, 1, 1]],
      B: [[2, 0, 0], [3, 1, 1]],
      Z: [[5, 0, 0], [6, 1, 1]],
    }),
  ]);

  if (result.strategy.kind !== "segments") throw new Error("Expected segmented strategy.");
  expect(result.strategy.segments[0]).toMatchObject({
    checkpointBodyDeterministicIds: ["A", "B"],
    consumedBodyDeterministicIds: ["A"],
    carriedBodyDeterministicIds: ["B"],
    replacementProducerFeatureIds: ["P1"],
  });
  expect(result.finalBodyProducers).toEqual([
    {
      producerFeatureId: "independent",
      producerKind: "parametric",
      bodyDeterministicIds: ["Z"],
    },
    {
      producerFeatureId: "B1",
      producerKind: "checkpoint",
      segmentId: "bake-segment-1",
      bodyDeterministicIds: ["A", "B"],
    },
  ]);
});

test("closes replacement transitively over an earlier multi-body checkpoint", () => {
  const result = plan([
    parametric("P1", ["A", "B"]),
    { featureId: "B1", kind: "bakedBody" },
    parametric("P2", ["C"]),
    { featureId: "B2", kind: "bakedBody" },
  ], [
    snapshot("P1", { A: DEFAULT_BOUNDS, B: [[2, 0, 0], [3, 1, 1]] }),
    snapshot("B1", {
      A: [[0, 0, 0], [1.5, 1, 1]],
      B: [[2, 0, 0], [3, 1, 1]],
    }),
    snapshot("P2", {
      A: [[0, 0, 0], [1.5, 1, 1]],
      B: [[2, 0, 0], [3, 1, 1]],
      C: [[5, 0, 0], [6, 1, 1]],
    }),
    snapshot("B2", {
      A: [[0, 0, 0], [1.5, 1, 1]],
      B: [[2, 0, 0], [3.5, 1, 1]],
      C: [[5, 0, 0], [6, 1, 1]],
    }),
  ]);

  if (result.strategy.kind !== "segments") throw new Error("Expected segmented strategy.");
  expect(result.strategy.segments).toHaveLength(2);
  expect(result.strategy.segments[1]).toMatchObject({
    checkpointBodyDeterministicIds: ["A", "B"],
    consumedBodyDeterministicIds: ["B"],
    carriedBodyDeterministicIds: ["A"],
    replacementProducerFeatureIds: ["B1"],
  });
  expect(result.finalBodyProducers).toEqual([
    {
      producerFeatureId: "P2",
      producerKind: "parametric",
      bodyDeterministicIds: ["C"],
    },
    {
      producerFeatureId: "B2",
      producerKind: "checkpoint",
      segmentId: "bake-segment-2",
      bodyDeterministicIds: ["A", "B"],
    },
  ]);
});

test("refuses a deletion-only segment instead of carrying an unrelated body", () => {
  const result = plan([
    parametric("P1", ["A"]),
    parametric("independent", ["Z"]),
    { featureId: "delete", kind: "bakedBody" },
  ], [
    snapshot("P1", { A: DEFAULT_BOUNDS }),
    snapshot("independent", {
      A: DEFAULT_BOUNDS,
      Z: [[5, 0, 0], [6, 1, 1]],
    }),
    snapshot("delete", { Z: [[5, 0, 0], [6, 1, 1]] }),
  ]);

  expect(result).toEqual({
    strategy: { kind: "wholeStudioLegacy", reason: "segment-preflight-failed" },
    diagnostics: [{
      code: "bake-segment-empty-output-unsupported",
      segmentId: "bake-segment-1",
      featureId: "delete",
      message: "Bake segment bake-segment-1 only removes bodies and cannot be represented by bakedBody.",
    }],
    finalBodyProducers: [],
  });
});

test("keeps a parametric-only studio in no-bake mode while retaining its body ledger", () => {
  const result = planBakeSegments({
    captureFormatVersion: 1,
    historyProbeAvailable: false,
    features: [parametric("P1", ["A", "B"])],
    rollbackSnapshots: null,
  });

  expect(result).toEqual({
    strategy: { kind: "none" },
    diagnostics: [],
    finalBodyProducers: [{
      producerFeatureId: "P1",
      producerKind: "parametric",
      bodyDeterministicIds: ["A", "B"],
    }],
  });
});

test("returns exact legacy gates and discards partial segments on a missing boundary", () => {
  const features: BakeSegmentFeature[] = [
    parametric("P1", ["A"]),
    { featureId: "B1", kind: "bakedBody" },
  ];
  const common = {
    features,
    historyProbeAvailable: true,
    rollbackSnapshots: [snapshot("P1", { A: DEFAULT_BOUNDS })],
  } as const;

  expect(planBakeSegments({ ...common, captureFormatVersion: 1 }).strategy).toEqual({
    kind: "wholeStudioLegacy",
    reason: "capture-v1",
  });
  expect(planBakeSegments({
    ...common,
    captureFormatVersion: 2,
    rollbackSnapshots: null,
  }).strategy).toEqual({
    kind: "wholeStudioLegacy",
    reason: "rollback-snapshots-absent",
  });
  expect(planBakeSegments({
    ...common,
    captureFormatVersion: 2,
    historyProbeAvailable: false,
  }).strategy).toEqual({
    kind: "wholeStudioLegacy",
    reason: "history-probe-unavailable",
  });

  const missing = planBakeSegments({ ...common, captureFormatVersion: 2 });
  expect(missing.strategy).toEqual({
    kind: "wholeStudioLegacy",
    reason: "segment-preflight-failed",
  });
  expect(missing.diagnostics[0]).toMatchObject({
    code: "bake-segment-boundary-snapshot-missing",
    featureId: "B1",
  });
});
