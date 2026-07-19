import { expect, test } from "vitest";

import type { HistoryProbeTopologySignature } from "@/contracts/import/capabilities";
import type {
  OnshapeGeometricSignature,
  OnshapeResolvedReference,
} from "@/contracts/import/onshape-capture-bundle";
import { createRollbackTopologyTimeline } from "@/domain/import/onshape/rollback-topology-reader";
import { matchSignature, type TopologyMatchTolerance } from "@/domain/import/onshape/signature-matcher";
import {
  resolveTopologyReferences,
  type ResolveTopologyReferencesInput,
} from "@/domain/import/onshape/topology-reference-resolver";
import { computeCaptureFrameToWorld } from "@/domain/import/onshape/capture-frame";
import type { OnshapeFeatureNode } from "@/domain/import/onshape/bundle-reader";
import type { OnshapeTopologyQueryRef } from "@/domain/import/onshape/topology-query-reader";

// Real-kernel acceptance-gate pins (Phase W follow-up, step 3 of 4).
//
// The mock plan-dump (scripts/onshape-plan-dump.ts) echoes captured Onshape
// signatures back as the "probe" signatures, so every topology consumer is a
// guaranteed self-match after unit normalization. That proves matcher + units
// ONLY — not that the real OCC probe prefix exposes matching faces/edges.
//
// The diagnosis (see the W-realkernel note in
// docs/onshape-importer-completion-plan.md) captured the *real* OCC
// signatures for the two consumers the mock over-promotes. These specs feed
// those real-shaped signatures through the matcher/resolver so the logic lane
// fails honestly where the real kernel fails — the mock can no longer
// green-light a real acceptance-gate failure without this suite going red too.

const tolerance: TopologyMatchTolerance = {
  linear: 0.01,
  angularRadians: 1e-4,
  relative: 1e-6,
  ambiguityMargin: 0.001,
};

// ── Root cause B — captured edge signature is in a feature-local frame ────────
// Mounts Chamfer 1. Extrude 1/2 ARE parametric, so the real probe returns 57
// real face/edge signatures — but the captured target edge was recorded in the
// construction-plane (feature-local) frame, not the document world frame. All
// values below are already unit-normalized to document millimetres (the frame
// the matcher/resolver operate in), exactly as reported by the diagnosis.

// Captured edge as it comes off the bundle (feature-local frame): a circle at
// y=9, which lies OUTSIDE the body's y-range [0,4] — it cannot be an edge on
// the body in world coordinates.
const capturedChamferEdge: OnshapeGeometricSignature = {
  entityClass: "edge",
  geometryType: "circle",
  definingData: { center: [-4, 9, 0], axisDirection: [0, 0, 1], radius: 2.05 },
};

// The two real OCC hole edges the chamfer actually lands on (world frame):
// same radius, but centred at z=5 with a ±Y axis (the hole is drilled through
// the Y faces of the extrude, from the translated construction-plane sketch).
const realHoleEdge = (
  suffix: string,
  center: [number, number, number],
): HistoryProbeTopologySignature => ({
  entityClass: "edge",
  geometryType: "circle",
  definingData: { center, axisDirection: [0, -1, 0], radius: 2.05 },
  reference: { kind: "edge", bodyId: "body_feature_extrude-1" as never, edgeId: `edge_${suffix}` as never },
});

test("root cause B: captured feature-local chamfer edge no-matches the real world-frame OCC edges", () => {
  const outcome = matchSignature(
    capturedChamferEdge,
    [realHoleEdge("hole_lo", [-4, 0, 5]), realHoleEdge("hole_hi", [-4, 4, 5])],
    tolerance,
  );

  // The mock self-matches this edge (it echoes capturedChamferEdge as the
  // probe). The real kernel cannot: orientation + position disagree.
  expect(outcome.kind).toBe("noMatch");
  if (outcome.kind === "noMatch") {
    for (const rejection of outcome.rejected) {
      expect(rejection.reasons).toContain("axisDirection-angle-out-of-tolerance");
      expect(rejection.reasons).toContain("center-out-of-tolerance");
      // Radius matches exactly — this is a frame mismatch, NOT a units bug.
      expect(rejection.reasons).not.toContain("radius-out-of-tolerance");
    }
  }
});

test("root cause B: re-expressing the captured edge into the world frame resolves it uniquely", () => {
  // Positive control pinning the required fix (step 4 / diagnosis fix #2): once
  // center/axis are re-expressed from the capture frame into the world frame,
  // the same edge matches the real OCC edge exactly. This is the only thing
  // missing — proving unit normalization (step 2) is necessary but insufficient.
  const worldFrameEdge: OnshapeGeometricSignature = {
    entityClass: "edge",
    geometryType: "circle",
    definingData: { center: [-4, 0, 5], axisDirection: [0, -1, 0], radius: 2.05 },
  };
  const outcome = matchSignature(worldFrameEdge, [realHoleEdge("hole_lo", [-4, 0, 5])], tolerance);
  expect(outcome.kind).toBe("unique");
});

// ── Root cause A — the real probe prefix contains no matchable topology ───────
// Part Studio 1. Every body-producing extrude bakes (needs-region-resolution),
// so the probe prefix has no solid bodies and returns zero signatures. The mock
// masks this by echoing captured face/edge signatures the real prefix never
// builds.

test("root cause A: any consumer against an empty probe prefix no-matches with an empty rejection list", () => {
  const outcome = matchSignature(capturedChamferEdge, [], tolerance);
  expect(outcome.kind).toBe("noMatch");
  // Empty rejected list is the PS1 real-kernel fingerprint (probeCount 0): the
  // matcher never even sees a candidate, so there is nothing to reject.
  if (outcome.kind === "noMatch") expect(outcome.rejected).toHaveLength(0);
});

test("root cause A: a baked body-only-mesh exposes no faces/edges, so face/edge consumers stay honestly baked", () => {
  // A baked body is a bodyOnlyMesh: it exposes a single body-identity signature
  // and no face/edge topology. A captured face/edge consumer over it cannot be
  // recovered by echoing the captured signature — the frame the mock relies on
  // does not exist in the prefix.
  const bakedBodyOnly: HistoryProbeTopologySignature = {
    entityClass: "body",
    geometryType: "solid",
    boundingBox: { low: [-9, 0, 0], high: [9, 4, 10] },
    reference: { kind: "body", bodyId: "body_feature_bakedBody-1" as never },
  };
  const outcome = matchSignature(capturedChamferEdge, [bakedBodyOnly], tolerance);
  expect(outcome.kind).toBe("noMatch");
  if (outcome.kind === "noMatch") {
    expect(outcome.rejected[0]?.reasons).toContain("entity-class-mismatch");
  }
});

// ── Resolver-seam pins — the acceptance-gate reason code end to end ───────────

const chamferQuery: OnshapeTopologyQueryRef = {
  consumerFeatureId: "FqXExmahcCNDI8A_1",
  slotKey: "edges",
  parameterId: "entities",
  queryIndex: 0,
  deterministicId: "chamfer-edge",
  queryString: null,
  expectedKinds: ["edge"],
};

// Captured as it appears in the bundle: meters, feature-local frame. The
// resolver unit-normalizes it (×1000) but does NOT re-express the frame.
const capturedChamferReference: OnshapeResolvedReference = {
  deterministicId: "chamfer-edge",
  evaluatedAt: "historyPoint",
  consumingFeatureId: "FqXExmahcCNDI8A_1",
  signature: {
    entityClass: "edge",
    geometryType: "circle",
    definingData: { center: [-0.004, 0.009, 0], axis: [0, 0, 1], radius: 0.00205 },
  },
};

function resolverInput(
  cadaraSignatures: readonly HistoryProbeTopologySignature[],
): ResolveTopologyReferencesInput {
  return {
    consumerFeatureId: "FqXExmahcCNDI8A_1",
    queries: [chamferQuery],
    capturedReferences: [capturedChamferReference],
    rollback: createRollbackTopologyTimeline({ featureIds: ["FqXExmahcCNDI8A_1"], snapshots: [] }),
    cadaraSignatures,
    tolerance,
    durableNamingAvailable: true,
  };
}

test("resolver: real world-frame OCC edges degrade Chamfer 1 to topology-reference-no-match (root cause B)", () => {
  const result = resolveTopologyReferences(
    resolverInput([realHoleEdge("hole_lo", [-4, 0, 5]), realHoleEdge("hole_hi", [-4, 4, 5])]),
  );
  expect(result).toMatchObject({ kind: "degraded", reason: "topology-reference-no-match" });
});

test("resolver: an empty probe prefix degrades to topology-reference-no-match (root cause A)", () => {
  const result = resolveTopologyReferences(resolverInput([]));
  expect(result).toMatchObject({ kind: "degraded", reason: "topology-reference-no-match" });
});

// Capture-frame MECHANISM control (not an end-to-end recovery): the captured
// edge sits in the frame AFTER a baked ROTATION transform (Transform 1) that
// Cadara's probe skips. Re-expressing the captured signature by the inverse of
// that transform lands it on a synthetic world-frame OCC *edge* signature.
//
// This proves the reframe math is correct, but it does NOT mean Chamfer 1 is
// recoverable end to end: at apply, the body preceding the chamfer is the
// tessellation-backed Transform 1 checkpoint, which exposes only body identity
// (see the "baked body-only-mesh" pin above) — never the hole edge. Matching a
// probe prefix that omits the bake would therefore promote a consumer apply
// cannot rebuild, so the provider keeps such face/edge-over-baked-body
// consumers honestly baked (`topology-upstream-baked`), gated on W.3 making the
// transform parametric. The transform is derived exactly as the provider does.
const transformFeatureId = "FKFj5KgXfGGLv7N_1";
const captureFrameFeatures: readonly OnshapeFeatureNode[] = [
  {
    featureId: transformFeatureId,
    featureType: "transform",
    parameters: [
      { parameterId: "transformType", value: "ROTATION" },
      { parameterId: "angle", value: 0, expression: "90 deg" },
      { parameterId: "makeCopy", value: false },
      { parameterId: "oppositeDirection", value: false },
      { parameterId: "transformAxis", queries: [{ deterministicIds: ["axis-edge"] }] },
    ] as unknown as OnshapeFeatureNode["parameters"],
  },
  { featureId: "FqXExmahcCNDI8A_1", featureType: "chamfer" },
];
// Rotation axis as captured at the transform's history point: the X-parallel
// line through [9,4,0] mm (metres in the bundle), direction −X.
const axisReference: OnshapeResolvedReference = {
  deterministicId: "axis-edge",
  evaluatedAt: "historyPoint",
  consumingFeatureId: transformFeatureId,
  signature: {
    entityClass: "edge",
    geometryType: "line",
    definingData: { origin: [0.009, 0.004, 0], direction: [-1, 0, 0] },
  },
};

test("capture-frame: a baked rotation before the consumer yields a world-from-capture transform", () => {
  const transform = computeCaptureFrameToWorld({
    features: captureFrameFeatures,
    consumerFeatureId: "FqXExmahcCNDI8A_1",
    isParametric: () => false,
    resolvedReferences: [axisReference],
  });
  expect(transform).not.toBeNull();
});

test("capture-frame: no transform is derived when the rotation is parametric (no divergence)", () => {
  const transform = computeCaptureFrameToWorld({
    features: captureFrameFeatures,
    consumerFeatureId: "FqXExmahcCNDI8A_1",
    isParametric: (featureId) => featureId === transformFeatureId,
    resolvedReferences: [axisReference],
  });
  expect(transform).toBeNull();
});

test("resolver: reframing the captured edge onto a synthetic world-frame edge resolves (capture-frame mechanism control only; apply keeps Chamfer 1 baked)", () => {
  const captureFrameToWorld = computeCaptureFrameToWorld({
    features: captureFrameFeatures,
    consumerFeatureId: "FqXExmahcCNDI8A_1",
    isParametric: () => false,
    resolvedReferences: [axisReference],
  });
  expect(captureFrameToWorld).not.toBeNull();
  const result = resolveTopologyReferences({
    ...resolverInput([realHoleEdge("hole_hi", [-4, 4, 5])]),
    captureFrameToWorld: captureFrameToWorld ?? undefined,
  });
  expect(result.kind).toBe("resolved");
});
