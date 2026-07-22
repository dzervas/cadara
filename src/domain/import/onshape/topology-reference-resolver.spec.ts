import { expect, test } from "vitest";

import type { HistoryProbeTopologySignature } from "@/contracts/import/capabilities";
import type { OnshapeResolvedReference } from "@/contracts/import/onshape-capture-bundle";
import { createRollbackTopologyTimeline } from "@/domain/import/onshape/rollback-topology-reader";
import {
  resolveTopologyReferences,
  resolveUniquePrefixBody,
  type ResolveTopologyReferencesInput,
} from "@/domain/import/onshape/topology-reference-resolver";
import type {
  OnshapeTopologyQueryRef,
  TopologyQuerySlot,
} from "@/domain/import/onshape/topology-query-reader";

const tolerance = { linear: 0.01, angularRadians: 1e-4, relative: 1e-6, ambiguityMargin: 0.001 };
const emptyRollback = createRollbackTopologyTimeline({ featureIds: ["consumer"], snapshots: [] });

const edgeQuery = (id = "edge-source"): OnshapeTopologyQueryRef => ({
  consumerFeatureId: "consumer",
  slotKey: "edges",
  parameterId: "entities",
  queryIndex: 0,
  deterministicId: id,
  queryString: null,
  expectedKinds: ["edge"],
});

const edgeSignature = (suffix = "live", x = 0): HistoryProbeTopologySignature => ({
  entityClass: "edge",
  geometryType: "line",
  definingData: { origin: [0, x, 0], direction: [1, 0, 0] },
  boundingBox: { low: [0, 0, 0], high: [10, 0, 0] },
  reference: { kind: "edge", bodyId: "body" as never, edgeId: `edge_${suffix}` as never },
});

const historyEdge = (id = "edge-source"): OnshapeResolvedReference => ({
  deterministicId: id,
  evaluatedAt: "historyPoint",
  consumingFeatureId: "consumer",
  signature: {
    entityClass: "edge",
    geometryType: "line",
    definingData: { origin: [0, 0, 0], direction: [1, 0, 0] },
    boundingBox: { low: [0, 0, 0], high: [0.01, 0, 0] },
  },
});

function input(overrides: Partial<ResolveTopologyReferencesInput> = {}): ResolveTopologyReferencesInput {
  return {
    consumerFeatureId: "consumer",
    queries: [edgeQuery()],
    capturedReferences: [historyEdge()],
    rollback: emptyRollback,
    cadaraSignatures: [edgeSignature()],
    tolerance,
    durableNamingAvailable: true,
    ...overrides,
  };
}

const tessellation = (bodyId: string, faceId: string, high = 0.01) => ({
  bodies: [{ id: bodyId, faces: [{ id: faceId, facets: [{ vertices: [
    { x: 0, y: 0, z: 0 }, { x: high, y: 0, z: 0 }, { x: 0, y: high, z: 0 },
  ] }] }] }],
});

const bodyOnlySlot: TopologyQuerySlot = {
  key: "scope",
  parameterId: "entities",
  role: "body",
  expectedKinds: ["body"],
  cardinality: { min: 1, max: null },
};

const emptyIdBodyFeature = {
  featureId: "consumer",
  featureType: "transform",
  parameters: [{
    parameterId: "entities",
    queries: [{ deterministicIds: [], queryString: "query = body;" }],
  }],
};

const liveBody = (bodyId: string): HistoryProbeTopologySignature => ({
  entityClass: "body",
  geometryType: "solid",
  boundingBox: { low: [0, 0, 0], high: [10, 10, 10] },
  centroid: [5, 5, 5],
  reference: { kind: "body", bodyId: bodyId as never },
});

test("resolves an ID-less body query only when the prefix has exactly one live body", () => {
  const resolved = resolveUniquePrefixBody({
    consumerFeatureId: "consumer",
    feature: emptyIdBodyFeature,
    slots: [bodyOnlySlot],
    cadaraSignatures: [liveBody("body_live")],
    tolerance,
  });
  expect(resolved).toMatchObject({
    kind: "resolved",
    bindings: [{
      sourceEvidence: "uniquePrefixBody",
      reviewReference: { kind: "body", bodyId: "body_live" },
      evidence: ["unique-prefix-body"],
      deferred: { kind: "topologyOf", expectedKind: "body" },
    }],
  });

  expect(resolveUniquePrefixBody({
    consumerFeatureId: "consumer",
    feature: emptyIdBodyFeature,
    slots: [bodyOnlySlot],
    cadaraSignatures: [liveBody("one"), liveBody("two")],
    tolerance,
  })).toMatchObject({ kind: "degraded", reason: "topology-query-unreadable" });
});

test("does not infer ID-less non-body, multi-slot, missing, or malformed queries", () => {
  const edgeSlot = { ...bodyOnlySlot, expectedKinds: ["edge"] as const };
  for (const value of [
    { feature: emptyIdBodyFeature, slots: [edgeSlot] },
    { feature: emptyIdBodyFeature, slots: [bodyOnlySlot, bodyOnlySlot] },
    { feature: { ...emptyIdBodyFeature, parameters: [] }, slots: [bodyOnlySlot] },
    {
      feature: {
        ...emptyIdBodyFeature,
        parameters: [{ parameterId: "entities", queries: [{ deterministicIds: [42] }] }],
      },
      slots: [bodyOnlySlot],
    },
  ]) {
    expect(resolveUniquePrefixBody({
      consumerFeatureId: "consumer",
      feature: value.feature,
      slots: value.slots,
      cadaraSignatures: [liveBody("body_live")],
      tolerance,
    })).toBeNull();
  }
});

test("matches captured ID-less query evidence at the consuming history point", () => {
  const result = resolveTopologyReferences(input({
    queries: [{
      ...edgeQuery("captured-query:consumer:entities:0:0"),
      queryEvidenceIndex: 0,
    }],
    capturedReferences: [],
    capturedQueryReferences: [{
      consumingFeatureId: "consumer",
      parameterId: "entities",
      queryIndex: 0,
      entityIndex: 0,
      evaluatedAt: "historyPoint",
      signature: historyEdge().signature!,
    }],
  }));

  expect(result).toMatchObject({
    kind: "resolved",
    bindings: [{
      sourceEvidence: "queryHistoryPoint",
      reviewReference: { kind: "edge", edgeId: "edge_live" },
    }],
  });
});

test("returns a typed deferred selector only for a unique exact-consumer history match", () => {
  const result = resolveTopologyReferences(input({
    capturedReferences: [
      { ...historyEdge(), consumingFeatureId: "other", signature: { entityClass: "edge", geometryType: "circle" } },
      historyEdge(),
    ],
  }));
  expect(result.kind).toBe("resolved");
  if (result.kind === "resolved") {
    expect(result.bindings[0]).toMatchObject({
      sourceEvidence: "historyPoint",
      reviewReference: { kind: "edge", edgeId: "edge_live" },
      deferred: {
        kind: "topologyOf",
        expectedKind: "edge",
        source: { consumerFeatureId: "consumer", parameterId: "entities", deterministicId: "edge-source" },
      },
    });
  }
});

test("uses the preceding rollback snapshot by exact body/face ID, never the post-consumer state", () => {
  const rollback = createRollbackTopologyTimeline({
    featureIds: ["producer", "consumer"],
    snapshots: [
      { featureId: "producer", tessellationTolerance: 0.0001, tessellatedFaces: tessellation("body-source", "face-before") },
      { featureId: "consumer", tessellationTolerance: 0.0001, tessellatedFaces: tessellation("body-result", "face-after", 0.02) },
    ],
  });
  const bodyQuery: OnshapeTopologyQueryRef = { ...edgeQuery("body-source"), slotKey: "body", expectedKinds: ["body"] };
  const result = resolveTopologyReferences(input({
    queries: [bodyQuery],
    capturedReferences: [],
    rollback,
    cadaraSignatures: [{
      entityClass: "body",
      geometryType: "solid",
      boundingBox: { low: [0, 0, 0], high: [10, 10, 0] },
      reference: { kind: "body", bodyId: "body_live" as never },
    }],
    durableNamingAvailable: false,
  }));
  expect(result.kind).toBe("resolved");
  if (result.kind === "resolved") expect(result.bindings[0]?.sourceEvidence).toBe("rollback");
});

test("maps every resolver failure to its exact reason and keeps the feature all-or-nothing", () => {
  const cases: [string, ResolveTopologyReferencesInput][] = [
    ["topology-query-unreadable", input({ queries: [] })],
    ["topology-history-evidence-missing", input({ capturedReferences: [] })],
    ["topology-source-query-unresolved", input({ capturedReferences: [{ deterministicId: "edge-source", evaluatedAt: "historyPoint", consumingFeatureId: "consumer", unresolved: { reason: "deleted" } }] })],
    ["topology-source-kind-mismatch", input({ queries: [{ ...edgeQuery(), expectedKinds: ["face"] }] })],
    ["topology-durable-naming-unavailable", input({ durableNamingAvailable: false })],
    ["topology-reference-no-match", input({ cadaraSignatures: [edgeSignature("far", 2)] })],
    ["topology-reference-ambiguous", input({ cadaraSignatures: [edgeSignature("one"), edgeSignature("two")] })],
  ];
  for (const [reason, value] of cases) {
    const result = resolveTopologyReferences(value);
    expect(result).toMatchObject({ kind: "degraded", reason });
  }

  const partial = resolveTopologyReferences(input({
    queries: [edgeQuery(), edgeQuery("missing-second")],
    capturedReferences: [historyEdge()],
  }));
  expect(partial).toMatchObject({ kind: "degraded", reason: "topology-history-evidence-missing" });
  expect("bindings" in partial).toBe(false);
});

test("rollback tessellation cannot fabricate edge identity and final-only mutable topology is unsafe", () => {
  const rollback = createRollbackTopologyTimeline({
    featureIds: ["producer", "consumer"],
    snapshots: [{ featureId: "producer", tessellationTolerance: 0.001, tessellatedFaces: tessellation("body", "face") }],
  });
  const result = resolveTopologyReferences(input({
    capturedReferences: [{ deterministicId: "edge-source", evaluatedAt: "finalState", signature: { entityClass: "edge", geometryType: "line", definingData: { origin: [0, 0, 0], direction: [1, 0, 0] } } }],
    rollback,
  }));
  expect(result).toMatchObject({ kind: "degraded", reason: "topology-history-evidence-missing" });
});
