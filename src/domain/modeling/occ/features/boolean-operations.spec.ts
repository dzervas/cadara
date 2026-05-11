import { test } from "bun:test";
import { readFile } from "node:fs/promises";
import { expectTrue } from "@/testing/expect.spec";
import type { BodyId, FeatureId } from "@/contracts/shared/ids";
import type { DurableRef } from "@/contracts/shared/references";
import { createOccAuthoringState } from "@/domain/modeling/occ/authoring-state";
import {
  applyBooleanPolicy,
  resolveNativeFeatureTransactionReplacement,
  resolveReplacementBodies,
} from "@/domain/modeling/occ/features/boolean-operations";
import type { OpenCascadeNativeTopologyKernelHost } from "@/domain/modeling/occ/native-topology-payload";
import { toGpPnt } from "@/domain/modeling/occ/planes";
import {
  getDefaultOpenCascadeInstance,
  type OpenCascadeInstance,
} from "@/domain/modeling/occ/runtime";
import { OpenCascadeKernelAdapter } from "@/domain/modeling/opencascade-kernel-adapter";
import {
  getOccDurableRefKey,
  OCC_REFERENCE_INVALIDATION_REASONS,
  trackNewSolidBody,
  type OccTrackedBody,
} from "@/domain/modeling/occ/topology";

type CustomOpenCascadeMainJSForTest = new (
  module: Record<string, unknown>,
) => Promise<OpenCascadeInstance>;

async function loadCustomOpenCascadeForTest() {
  const module = (await import("../../../../../public/cadara-occ.js")) as {
    default: CustomOpenCascadeMainJSForTest;
  };
  const wasmBinary = new Uint8Array(
    await readFile(
      new URL("../../../../../public/cadara-occ.wasm", import.meta.url),
    ),
  );

  return new module.default({ wasmBinary });
}

function makeTrackedBox(
  oc: OpenCascadeInstance,
  bodyId: BodyId,
  ownerFeatureId: FeatureId,
  dimensions: readonly [number, number, number],
) {
  const box = new oc.BRepPrimAPI_MakeBox_3(
    toGpPnt(oc, [0, 0, 0]),
    dimensions[0],
    dimensions[1],
    dimensions[2],
  );
  box.Build(new oc.Message_ProgressRange_1());
  expectTrue(box.IsDone(), `Expected ${bodyId} box to build.`);

  return trackNewSolidBody(oc, {
    bodyId,
    label: bodyId,
    ownerFeatureId,
    shape: box.Shape(),
  });
}

function makeBoxShape(
  oc: OpenCascadeInstance,
  dimensions: readonly [number, number, number],
) {
  const box = new oc.BRepPrimAPI_MakeBox_3(
    toGpPnt(oc, [0, 0, 0]),
    dimensions[0],
    dimensions[1],
    dimensions[2],
  );
  box.Build(new oc.Message_ProgressRange_1());
  expectTrue(box.IsDone(), "Expected replacement box to build.");

  return box.Shape();
}

function topologyTargets(body: OccTrackedBody): DurableRef[] {
  return [
    ...body.topology.faceIds.map((faceId) => ({
      kind: "face" as const,
      bodyId: body.bodyId,
      faceId,
    })),
    ...body.topology.edgeIds.map((edgeId) => ({
      kind: "edge" as const,
      bodyId: body.bodyId,
      edgeId,
    })),
    ...body.topology.vertexIds.map((vertexId) => ({
      kind: "vertex" as const,
      bodyId: body.bodyId,
      vertexId,
    })),
  ];
}

test("resolveReplacementBodies invalidates topology explicitly when replacement history is unavailable", async () => {
  const oc = await getDefaultOpenCascadeInstance();
  const body = makeTrackedBox(
    oc,
    "body_unsupported_history_seed" as BodyId,
    "feature_unsupported_history_seed" as FeatureId,
    [1, 1, 1],
  );
  const context = createOccAuthoringState(oc, { bodies: [body] });
  const replacementShape = makeBoxShape(oc, [2, 1, 1]);

  const result = resolveReplacementBodies(
    context,
    body.bodyId,
    replacementShape,
    "feature_unsupported_history_replace" as FeatureId,
    { allowEmpty: false },
  );

  const expectedTargets = topologyTargets(body);
  expectTrue(
    result.replacements.length === 1,
    "Expected one replacement body.",
  );
  expectTrue(
    result.historyInvalidations.size === expectedTargets.length,
    "Expected every previous face, edge, and vertex to receive an unsupported-history invalidation.",
  );

  for (const target of expectedTargets) {
    const invalidation = result.historyInvalidations.get(
      getOccDurableRefKey(target),
    );
    expectTrue(
      invalidation?.reason ===
        OCC_REFERENCE_INVALIDATION_REASONS.topologyUnsupportedHistory,
      `Expected ${getOccDurableRefKey(target)} to be invalidated as unsupported history.`,
    );
    expectTrue(
      invalidation.sourceTarget?.kind === "body" &&
        invalidation.sourceTarget.bodyId === body.bodyId,
      `Expected ${getOccDurableRefKey(target)} to identify its owning body as the invalidation source.`,
    );
  }
});

test("resolveNativeFeatureTransactionReplacement rejects committed shapes with native validation errors", async () => {
  const oc = await getDefaultOpenCascadeInstance();
  const body = makeTrackedBox(
    oc,
    "body_native_validation_gate_seed" as BodyId,
    "feature_native_validation_gate_seed" as FeatureId,
    [1, 1, 1],
  );
  const context = createOccAuthoringState(oc, { bodies: [body] });
  const transaction = {
    IsDone: () => true,
    Shape: () => body.shape,
    PayloadJson: () =>
      JSON.stringify({
        schemaVersion: "occ-native-topology-payload/v1alpha1",
        source: "occt7-shim",
        topology: [],
        edgeVertices: [],
        diagnostics: [
          {
            code: "occ-native-topology-invalid-shape",
            severity: "error",
            message: "Native validation rejected test shape.",
            target: { kind: "body", bodyId: body.bodyId },
            detail: { kind: "shapeValidation" },
          },
        ],
      }),
    HistoryJson: () =>
      JSON.stringify({
        schemaVersion: "occ-native-history-payload/v1alpha1",
        source: "occt7-shim",
        status: "available",
        records: [],
        diagnostics: [],
      }),
  };

  try {
    resolveNativeFeatureTransactionReplacement(
      context,
      body,
      transaction,
      "validation-gate",
      "feature_native_validation_gate_replace" as FeatureId,
    );
    expectTrue(
      false,
      "Native transaction validation diagnostics should reject committed state.",
    );
  } catch (error) {
    expectTrue(
      error instanceof Error &&
        error.message.includes("Native validation rejected test shape."),
      "Native transaction rejection should surface the native validation diagnostic message.",
    );
  }
});

test("resolveNativeFeatureTransactionReplacement consumes native replacement topology ids", async () => {
  const oc = await getDefaultOpenCascadeInstance();
  const body = makeTrackedBox(
    oc,
    "body_native_payload_identity_seed" as BodyId,
    "feature_native_payload_identity_seed" as FeatureId,
    [1, 1, 1],
  );
  const context = createOccAuthoringState(oc, { bodies: [body] });
  const nativeFaceId = `face_${body.bodyId}_native_payload_1`;
  const nativeEdgeId = `edge_${body.bodyId}_native_payload_1`;
  const nativeVertexId = `vertex_${body.bodyId}_native_payload_1`;
  const transactionPayload = {
    schemaVersion: "occ-native-topology-payload/v1alpha1",
    source: "occt7-shim",
    topology: [
      ...body.topology.faceIds.map((_, index) => ({
        id: `face_${body.bodyId}_native_payload_${index + 1}`,
        kind: "face",
        bodyId: body.bodyId,
        index: index + 1,
      })),
      ...body.topology.edgeIds.map((_, index) => ({
        id: `edge_${body.bodyId}_native_payload_${index + 1}`,
        kind: "edge",
        bodyId: body.bodyId,
        index: index + 1,
      })),
      ...body.topology.vertexIds.map((_, index) => ({
        id: `vertex_${body.bodyId}_native_payload_${index + 1}`,
        kind: "vertex",
        bodyId: body.bodyId,
        index: index + 1,
      })),
    ],
    edgeVertices: [],
    diagnostics: [],
  };
  const transaction = {
    IsDone: () => true,
    Shape: () => body.shape,
    PayloadJson: () => JSON.stringify(transactionPayload),
    HistoryJson: () =>
      JSON.stringify({
        schemaVersion: "occ-native-history-payload/v1alpha1",
        source: "occt7-shim",
        status: "available",
        records: [],
        diagnostics: [],
      }),
  };

  const result = resolveNativeFeatureTransactionReplacement(
    context,
    body,
    transaction,
    "native-payload-identity",
    "feature_native_payload_identity_replace" as FeatureId,
  );

  expectTrue(
    result.replacements[0]?.topology.faceIds[0] === nativeFaceId,
    "Native transaction replacement faces should come from native payload ids, not a second TS enumeration pass.",
  );
  expectTrue(
    result.replacements[0]?.topology.edgeIds[0] === nativeEdgeId,
    "Native transaction replacement edges should come from native payload ids, not a second TS enumeration pass.",
  );
  expectTrue(
    result.replacements[0]?.topology.vertexIds[0] === nativeVertexId,
    "Native transaction replacement vertices should come from native payload ids, not a second TS enumeration pass.",
  );
  expectTrue(
    result.replacements[0]?.nativeTopologyPayload?.topology[0]?.id ===
      transactionPayload.topology[0]?.id,
    "Native transaction replacements should retain their native payload when history reconciliation leaves payload ids intact.",
  );
});

test("committed native topology snapshots reuse body-owned transaction payloads", async () => {
  const oc = await loadCustomOpenCascadeForTest();
  const body = makeTrackedBox(
    oc,
    "body_committed_payload_reuse" as BodyId,
    "feature_committed_payload_reuse" as FeatureId,
    [1, 1, 1],
  );
  expectTrue(
    body.nativeTopologyPayload != null,
    "Tracked OCC body should carry the native topology payload that established its ids.",
  );
  const nativeHost = oc as unknown as OpenCascadeNativeTopologyKernelHost;
  const originalBuildCommittedShapePayload =
    nativeHost.CadaraExecuteNativeFeatureTransaction
      ?.BuildCommittedShapePayload;
  expectTrue(
    typeof originalBuildCommittedShapePayload === "function",
    "Expected custom OCC runtime to expose committed shape payload extraction.",
  );
  nativeHost.CadaraExecuteNativeFeatureTransaction!.BuildCommittedShapePayload =
    () => {
      throw new Error(
        "Committed payload extraction should not be called when a body-owned native payload is available.",
      );
    };
  const adapter = new OpenCascadeKernelAdapter({
    solverAdapter: {} as never,
    getOpenCascadeInstance: async () => oc,
  });
  const state = createOccAuthoringState(oc, { bodies: [body] });
  const buildCommittedSnapshot = (
    adapter as unknown as {
      buildNativeTopologyPayloadForState(
        state: typeof state,
        lodTierId: undefined,
        options: { useCommittedShapeTransaction: true },
      ): {
        kind: string;
        payload?: {
          bodies: readonly [{ topology: readonly { id: string }[] }];
        };
      };
    }
  ).buildNativeTopologyPayloadForState.bind(adapter);

  try {
    const result = buildCommittedSnapshot(state, undefined, {
      useCommittedShapeTransaction: true,
    });
    const firstPayloadId = result.payload?.bodies[0]?.topology.find(
      (record) => record.id !== body.bodyId,
    )?.id;
    const firstBodyPayloadId = body.nativeTopologyPayload?.topology[0]?.id;

    expectTrue(
      result.kind === "nativeTopologyPayload",
      "Committed native topology snapshot should build successfully.",
    );
    expectTrue(
      firstPayloadId === firstBodyPayloadId,
      "Committed native topology snapshot should emit the body-owned native transaction payload.",
    );
  } finally {
    nativeHost.CadaraExecuteNativeFeatureTransaction!.BuildCommittedShapePayload =
      originalBuildCommittedShapePayload;
  }
});

test("native transaction replacements retain rewritten committed payloads after preserving public ids", async () => {
  const oc = await loadCustomOpenCascadeForTest();
  const body = makeTrackedBox(
    oc,
    "body_rewritten_payload_reuse" as BodyId,
    "feature_rewritten_payload_seed" as FeatureId,
    [2, 2, 2],
  );
  const nativeHost = oc as unknown as OpenCascadeNativeTopologyKernelHost;
  const context = createOccAuthoringState(oc, { bodies: [body] });
  const featureShape = makeBoxShape(oc, [2, 2, 2]);
  const result = applyBooleanPolicy(
    context,
    "feature_rewritten_payload_join" as FeatureId,
    "join",
    { kind: "targetBody", bodyId: body.bodyId },
    featureShape,
  );
  const replacement = result.bodies.find(
    (candidate) => candidate.bodyId === body.bodyId,
  );

  expectTrue(
    replacement != null,
    "Native boolean replacement should preserve the target body.",
  );
  expectTrue(
    body.topology.faceIds.every((faceId) =>
      replacement?.topology.faceIds.includes(faceId),
    ),
    "Native boolean history should preserve public face ids with unique successors.",
  );
  expectTrue(
    replacement?.nativeTopologyPayload?.topology.some(
      (record) => record.id === body.topology.faceIds[0],
    ) === true,
    "Native transaction payload should be rewritten to the reconciled public face ids.",
  );

  const originalBuildCommittedShapePayload =
    nativeHost.CadaraExecuteNativeFeatureTransaction
      ?.BuildCommittedShapePayload;
  expectTrue(
    typeof originalBuildCommittedShapePayload === "function",
    "Expected custom OCC runtime to expose committed shape payload extraction.",
  );
  nativeHost.CadaraExecuteNativeFeatureTransaction!.BuildCommittedShapePayload =
    () => {
      throw new Error(
        "Committed payload extraction should not run after native transaction payload rewrite.",
      );
    };
  const adapter = new OpenCascadeKernelAdapter({
    solverAdapter: {} as never,
    getOpenCascadeInstance: async () => oc,
  });
  const buildCommittedSnapshot = (
    adapter as unknown as {
      buildNativeTopologyPayloadForState(
        state: typeof context,
        lodTierId: undefined,
        options: { useCommittedShapeTransaction: true },
      ): {
        kind: string;
        payload?: {
          bodies: readonly [{ topology: readonly { id: string }[] }];
        };
      };
    }
  ).buildNativeTopologyPayloadForState.bind(adapter);

  try {
    const nativeSnapshot = buildCommittedSnapshot(
      createOccAuthoringState(oc, { bodies: [replacement!] }),
      undefined,
      { useCommittedShapeTransaction: true },
    );

    expectTrue(
      nativeSnapshot.kind === "nativeTopologyPayload",
      "Committed native topology snapshot should build successfully.",
    );
    expectTrue(
      nativeSnapshot.payload?.bodies[0]?.topology.some(
        (record) => record.id === body.topology.faceIds[0],
      ) === true,
      "Committed native topology snapshot should reuse the rewritten transaction payload.",
    );
  } finally {
    nativeHost.CadaraExecuteNativeFeatureTransaction!.BuildCommittedShapePayload =
      originalBuildCommittedShapePayload;
  }
});

test("applyBooleanPolicy preserves unique native boolean history successors", async () => {
  const oc = await loadCustomOpenCascadeForTest();
  const body = makeTrackedBox(
    oc,
    "body_native_boolean_history_seed" as BodyId,
    "feature_native_boolean_history_seed" as FeatureId,
    [2, 2, 2],
  );
  const context = createOccAuthoringState(oc, { bodies: [body] });
  const featureShape = makeBoxShape(oc, [2, 2, 2]);

  const result = applyBooleanPolicy(
    context,
    "feature_native_boolean_history_join" as FeatureId,
    "join",
    { kind: "targetBody", bodyId: body.bodyId },
    featureShape,
  );
  const replacement = result.bodies.find(
    (candidate) => candidate.bodyId === body.bodyId,
  );

  expectTrue(
    replacement != null,
    "Native boolean policy should replace the target body.",
  );
  expectTrue(
    result.historyInvalidations.size === 0,
    "Native boolean history should not invalidate references that have unique successors.",
  );
  expectTrue(
    body.topology.faceIds.every((faceId) =>
      replacement?.topology.faceIds.includes(faceId),
    ),
    "Native boolean history should preserve previous face ids with unique successors.",
  );
  expectTrue(
    body.topology.edgeIds.every((edgeId) =>
      replacement?.topology.edgeIds.includes(edgeId),
    ),
    "Native boolean history should preserve previous edge ids with unique successors.",
  );
  expectTrue(
    body.topology.vertexIds.every((vertexId) =>
      replacement?.topology.vertexIds.includes(vertexId),
    ),
    "Native boolean history should preserve previous vertex ids with unique successors.",
  );
});

test("applyBooleanPolicy uses native boolean transactions for per-target multi-body policy", async () => {
  const oc = await loadCustomOpenCascadeForTest();
  const bodyA = makeTrackedBox(
    oc,
    "body_native_boolean_multibody_a" as BodyId,
    "feature_native_boolean_multibody_a" as FeatureId,
    [2, 2, 2],
  );
  const bodyB = makeTrackedBox(
    oc,
    "body_native_boolean_multibody_b" as BodyId,
    "feature_native_boolean_multibody_b" as FeatureId,
    [2, 2, 2],
  );
  const nativeHost = oc as unknown as OpenCascadeNativeTopologyKernelHost;
  const nativeBuilder =
    nativeHost.CadaraExecuteNativeFeatureTransaction
      ?.BuildBooleanCommittedShapeTransactionWithHistory;
  let nativeCallCount = 0;
  expectTrue(
    typeof nativeBuilder === "function",
    "Expected custom OCC runtime to expose native boolean transactions.",
  );
  nativeHost.CadaraExecuteNativeFeatureTransaction!.BuildBooleanCommittedShapeTransactionWithHistory =
    (...args) => {
      nativeCallCount += 1;
      return nativeBuilder(...args);
    };
  const context = createOccAuthoringState(oc, { bodies: [bodyA, bodyB] });
  const featureShape = makeBoxShape(oc, [1, 1, 1]);

  const result = applyBooleanPolicy(
    context,
    "feature_native_boolean_multibody_cut" as FeatureId,
    "cut",
    { kind: "targetBodies", bodyIds: [bodyA.bodyId, bodyB.bodyId] },
    featureShape,
  );

  expectTrue(
    nativeCallCount === 2,
    "Per-target multi-body cut should use one native boolean transaction per target body.",
  );
  expectTrue(
    result.bodies.some((candidate) => candidate.bodyId === bodyA.bodyId),
    "Multi-body cut should keep body A.",
  );
  expectTrue(
    result.bodies.some((candidate) => candidate.bodyId === bodyB.bodyId),
    "Multi-body cut should keep body B.",
  );
  expectTrue(
    ![...result.historyInvalidations.values()].some(
      (invalidation) =>
        invalidation.reason ===
          OCC_REFERENCE_INVALIDATION_REASONS.topologyUnsupportedHistory ||
        invalidation.reason ===
          OCC_REFERENCE_INVALIDATION_REASONS.topologyModified,
    ),
    "Native multi-body cut should not fall back to unsupported or JS-side modified-history invalidations.",
  );
});
