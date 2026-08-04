import { test, expect } from "vitest";
import { readFile } from "node:fs/promises";
import type { BodyId, FaceId, FeatureId } from "@/contracts/shared/ids";
import type { DurableRef } from "@/contracts/shared/references";
import { createOccAuthoringState } from "@/domain/modeling/occ/authoring-state";
import {
  applyBooleanPolicy,
  createBooleanBuilder,
  refineBooleanResultShape,
  resolveNativeFeatureTransactionReplacement,
  resolveReplacementBodies,
  runSheetSplit,
  selectBooleanResultWithCompleteHistory,
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
  expect(box.IsDone(), `Expected ${bodyId} box to build.`).toBeTruthy();

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
  expect(box.IsDone(), "Expected replacement box to build.").toBeTruthy();

  return box.Shape();
}

function createFailingSheetSplitOc(phase: "build" | "simplify" | "undone") {
  const deleted: string[] = [];

  class ShapeList {
    Append_1() {}

    delete() {
      deleted.push("list");
    }
  }

  class Splitter {
    SetArguments() {}

    SetTools() {}

    SetToFillHistory() {}

    Build() {
      if (phase === "build") {
        throw new Error("sheet split build failure");
      }
    }

    IsDone() {
      return phase !== "undone";
    }

    SimplifyResult() {
      if (phase === "simplify") {
        throw new Error("sheet split simplify failure");
      }
    }

    delete() {
      deleted.push("builder");
    }
  }

  class ProgressRange {
    delete() {
      deleted.push("progress");
    }
  }

  return {
    oc: {
      TopTools_ListOfShape_1: ShapeList,
      BRepAlgoAPI_Splitter_1: Splitter,
      Message_ProgressRange_1: ProgressRange,
    } as unknown as OpenCascadeInstance,
    deleted,
  };
}

test.each([
  ["build", "sheet split build failure"],
  ["simplify", "sheet split simplify failure"],
  ["undone", "OCC sheet-tool split failed to build."],
] as const)(
  "runSheetSplit disposes its fallback resources when %s does not return",
  (phase, errorMessage) => {
    const { oc, deleted } = createFailingSheetSplitOc(phase);

    expect(() => runSheetSplit(oc, {} as never, {} as never)).toThrow(
      errorMessage,
    );
    expect(
      deleted,
      "A failed sheet split must release its builder exactly once and clean up the progress range and both native lists.",
    ).toEqual(["builder", "progress", "list", "list"]);
  },
);

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
  expect(result.replacements.length, "Expected one replacement body.").toBe(1);
  expect(
    result.historyInvalidations.size,
    "Expected every previous face, edge, and vertex to receive an unsupported-history invalidation.",
  ).toBe(expectedTargets.length);

  for (const target of expectedTargets) {
    const invalidation = result.historyInvalidations.get(
      getOccDurableRefKey(target),
    );
    expect(
      invalidation?.reason,
      `Expected ${getOccDurableRefKey(target)} to be invalidated as unsupported history.`,
    ).toBe(OCC_REFERENCE_INVALIDATION_REASONS.topologyUnsupportedHistory);
    expect(
      invalidation.sourceTarget?.kind === "body" &&
        invalidation.sourceTarget.bodyId === body.bodyId,
      `Expected ${getOccDurableRefKey(target)} to identify its owning body as the invalidation source.`,
    ).toBeTruthy();
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
    expect(
      false,
      "Native transaction validation diagnostics should reject committed state.",
    ).toBeTruthy();
  } catch (error) {
    expect(
      error instanceof Error &&
        error.message.includes("Native validation rejected test shape."),
      "Native transaction rejection should surface the native validation diagnostic message.",
    ).toBeTruthy();
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

  expect(
    result.replacements[0]?.topology.faceIds[0],
    "Native transaction replacement faces should come from native payload ids, not a second TS enumeration pass.",
  ).toBe(nativeFaceId);
  expect(
    result.replacements[0]?.topology.edgeIds[0],
    "Native transaction replacement edges should come from native payload ids, not a second TS enumeration pass.",
  ).toBe(nativeEdgeId);
  expect(
    result.replacements[0]?.topology.vertexIds[0],
    "Native transaction replacement vertices should come from native payload ids, not a second TS enumeration pass.",
  ).toBe(nativeVertexId);
  expect(
    result.replacements[0]?.nativeTopologyPayload?.topology[0]?.id,
    "Native transaction replacements should retain their native payload when history reconciliation leaves payload ids intact.",
  ).toBe(transactionPayload.topology[0]?.id);
});

test("committed native topology snapshots reuse body-owned transaction payloads", async () => {
  const oc = await loadCustomOpenCascadeForTest();
  const body = makeTrackedBox(
    oc,
    "body_committed_payload_reuse" as BodyId,
    "feature_committed_payload_reuse" as FeatureId,
    [1, 1, 1],
  );
  expect(
    body.nativeTopologyPayload != null,
    "Tracked OCC body should carry the native topology payload that established its ids.",
  ).toBeTruthy();
  const nativeHost = oc as unknown as OpenCascadeNativeTopologyKernelHost;
  const originalBuildCommittedShapePayload =
    nativeHost.CadaraExecuteNativeFeatureTransaction
      ?.BuildCommittedShapePayload;
  expect(
    typeof originalBuildCommittedShapePayload,
    "Expected custom OCC runtime to expose committed shape payload extraction.",
  ).toBe("function");
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

    expect(
      result.kind,
      "Committed native topology snapshot should build successfully.",
    ).toBe("nativeTopologyPayload");
    expect(
      firstPayloadId,
      "Committed native topology snapshot should emit the body-owned native transaction payload.",
    ).toBe(firstBodyPayloadId);
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

  expect(
    replacement != null,
    "Native boolean replacement should preserve the target body.",
  ).toBeTruthy();
  expect(
    body.topology.faceIds.every((faceId) =>
      replacement?.topology.faceIds.includes(faceId),
    ),
    "Native boolean history should preserve public face ids with unique successors.",
  ).toBeTruthy();
  expect(
    replacement?.nativeTopologyPayload?.topology.some(
      (record) => record.id === body.topology.faceIds[0],
    ),
    "Native transaction payload should be rewritten to the reconciled public face ids.",
  ).toBeTruthy();

  const originalBuildCommittedShapePayload =
    nativeHost.CadaraExecuteNativeFeatureTransaction
      ?.BuildCommittedShapePayload;
  expect(
    typeof originalBuildCommittedShapePayload,
    "Expected custom OCC runtime to expose committed shape payload extraction.",
  ).toBe("function");
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

    expect(
      nativeSnapshot.kind,
      "Committed native topology snapshot should build successfully.",
    ).toBe("nativeTopologyPayload");
    expect(
      nativeSnapshot.payload?.bodies[0]?.topology.some(
        (record) => record.id === body.topology.faceIds[0],
      ),
      "Committed native topology snapshot should reuse the rewritten transaction payload.",
    ).toBeTruthy();
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

  expect(
    replacement != null,
    "Native boolean policy should replace the target body.",
  ).toBeTruthy();
  expect(
    result.historyInvalidations.size,
    "Native boolean history should not invalidate references that have unique successors.",
  ).toBe(0);
  expect(
    body.topology.faceIds.every((faceId) =>
      replacement?.topology.faceIds.includes(faceId),
    ),
    "Native boolean history should preserve previous face ids with unique successors.",
  ).toBeTruthy();
  expect(
    body.topology.edgeIds.every((edgeId) =>
      replacement?.topology.edgeIds.includes(edgeId),
    ),
    "Native boolean history should preserve previous edge ids with unique successors.",
  ).toBeTruthy();
  expect(
    body.topology.vertexIds.every((vertexId) =>
      replacement?.topology.vertexIds.includes(vertexId),
    ),
    "Native boolean history should preserve previous vertex ids with unique successors.",
  ).toBeTruthy();
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
  expect(
    typeof nativeBuilder,
    "Expected custom OCC runtime to expose native boolean transactions.",
  ).toBe("function");
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

  expect(
    nativeCallCount,
    "Per-target multi-body cut should use one native boolean transaction per target body.",
  ).toBe(2);
  expect(
    result.bodies.some((candidate) => candidate.bodyId === bodyA.bodyId),
    "Multi-body cut should keep body A.",
  ).toBeTruthy();
  expect(
    result.bodies.some((candidate) => candidate.bodyId === bodyB.bodyId),
    "Multi-body cut should keep body B.",
  ).toBeTruthy();
  expect(
    [...result.historyInvalidations.values()].some(
      (invalidation) =>
        invalidation.reason ===
          OCC_REFERENCE_INVALIDATION_REASONS.topologyUnsupportedHistory ||
        invalidation.reason ===
          OCC_REFERENCE_INVALIDATION_REASONS.topologyModified,
    ),
    "Native multi-body cut should not fall back to unsupported or JS-side modified-history invalidations.",
  ).toBeFalsy();
});

test("native Boolean history retains exact fused-face successor claims", async () => {
  const oc = await getDefaultOpenCascadeInstance();
  const body = makeTrackedBox(
    oc,
    "body_native_boolean_fused_history" as BodyId,
    "feature_native_boolean_fused_history" as FeatureId,
    [1, 1, 1],
  );
  const context = createOccAuthoringState(oc, { bodies: [body] });
  const [firstSourceFaceId, secondSourceFaceId] = body.topology.faceIds;
  const finalNativeFaceId = `face_${body.bodyId}_native_payload_1`;
  const transaction = {
    IsDone: () => true,
    Shape: () => body.shape,
    PayloadJson: () => JSON.stringify({
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
    }),
    HistoryJson: () => JSON.stringify({
      schemaVersion: "occ-native-history-payload/v1alpha1",
      source: "occt7-shim",
      status: "available",
      records: [firstSourceFaceId, secondSourceFaceId].map((faceId) => ({
        target: { kind: "face", bodyId: body.bodyId, faceId },
        reason: "unique-successor",
        successors: [
          { kind: "face", bodyId: body.bodyId, faceId: finalNativeFaceId },
        ],
      })),
      diagnostics: [],
    }),
  };

  const result = resolveNativeFeatureTransactionReplacement(
    context,
    body,
    transaction,
    "native-boolean-fused-history",
    "feature_native_boolean_fused_history_replace" as FeatureId,
  );
  const successors = result?.successorTargetsByPreviousKey;

  expect(result?.historyInvalidations.size).toBe(0);
  expect(successors?.size).toBe(2);
  expect(new Set([firstSourceFaceId, secondSourceFaceId].map((faceId) =>
    getOccDurableRefKey(successors!.get(
      getOccDurableRefKey({ kind: "face", bodyId: body.bodyId, faceId }),
    )!),
  )).size).toBe(1);
});

test("resolveNativeFeatureTransactionReplacement claims producer identity from native generated history records", async () => {
  const oc = await getDefaultOpenCascadeInstance();
  const body = makeTrackedBox(
    oc,
    "body_native_generated_history_seed" as BodyId,
    "feature_native_generated_history_seed" as FeatureId,
    [1, 1, 1],
  );
  const context = createOccAuthoringState(oc, { bodies: [body] });
  const ownerFeatureId =
    "feature_native_generated_history_replace" as FeatureId;
  const sourceEdgeId = body.topology.edgeIds[0]!;
  const otherSourceEdgeId = body.topology.edgeIds[1]!;
  const generatedFaceId = `face_${body.bodyId}_native_payload_1`;

  const makeTransaction = (
    records: readonly Record<string, unknown>[],
  ) => ({
    IsDone: () => true,
    Shape: () => body.shape,
    PayloadJson: () =>
      JSON.stringify({
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
      }),
    HistoryJson: () =>
      JSON.stringify({
        schemaVersion: "occ-native-history-payload/v1alpha1",
        source: "occt7-shim",
        status: "available",
        records,
        diagnostics: [],
      }),
  });

  const generatedRecord = (edgeId: string) => ({
    target: { kind: "edge", bodyId: body.bodyId, edgeId },
    reason: "generated",
    successors: [
      { kind: "face", bodyId: body.bodyId, faceId: generatedFaceId },
    ],
  });

  const oneToOne = resolveNativeFeatureTransactionReplacement(
    context,
    body,
    makeTransaction([generatedRecord(sourceEdgeId)]),
    "native-generated-history",
    ownerFeatureId,
  );

  expect(
    oneToOne?.generatedTargetsBySourceKey.get(
      `generated-from:${ownerFeatureId}:${body.bodyId}:edge:${sourceEdgeId}:generated-face`,
    ),
    "A native generated record naming exactly one entity should claim producer identity for the entity its builder created.",
  ).toEqual({
    kind: "face",
    bodyId: body.bodyId,
    faceId: generatedFaceId,
  });

  const many = resolveNativeFeatureTransactionReplacement(
    context,
    body,
    makeTransaction([
      generatedRecord(sourceEdgeId),
      generatedRecord(otherSourceEdgeId),
    ]),
    "native-generated-history",
    ownerFeatureId,
  );

  expect(
    many?.generatedTargetsBySourceKey.size,
    "An entity reachable from two native generated sources is many, so neither source may claim it.",
  ).toBe(0);

  const ambiguousRecord = resolveNativeFeatureTransactionReplacement(
    context,
    body,
    makeTransaction([
      {
        target: { kind: "edge", bodyId: body.bodyId, edgeId: sourceEdgeId },
        reason: "generated",
        successors: [
          { kind: "face", bodyId: body.bodyId, faceId: generatedFaceId },
          {
            kind: "face",
            bodyId: body.bodyId,
            faceId: `face_${body.bodyId}_native_payload_2`,
          },
        ],
      },
    ]),
    "native-generated-history",
    ownerFeatureId,
  );

  expect(
    ambiguousRecord?.generatedTargetsBySourceKey.size,
    "A native generated record resolving to more than one entity is not one-to-one and must claim nothing.",
  ).toBe(0);
  expect(
    ambiguousRecord?.historyInvalidations.size,
    "Native generated records carry producer identity only and must not invalidate the prior entity they are attributed to.",
  ).toBe(0);
});

// Lane: logic (per docs/testing.md). Seam: the real OCC Boolean/unifier boundary
// retains the raw result when unification loses exact identity, and the public
// face id then survives replacement naming without a geometric rematch.
test("falls back to the raw Fuse result when unification loses a retained face", async () => {
  const oc = await getDefaultOpenCascadeInstance();
  const body = makeTrackedBox(
    oc,
    "body_unifier_identity_loss" as BodyId,
    "feature_unifier_identity_seed" as FeatureId,
    [2, 2, 2],
  );
  const makeTool = (
    origin: readonly [number, number, number],
    dimensions: readonly [number, number, number],
  ) => {
    const tool = new oc.BRepPrimAPI_MakeBox_3(
      toGpPnt(oc, origin),
      dimensions[0],
      dimensions[1],
      dimensions[2],
    );
    tool.Build(new oc.Message_ProgressRange_1());
    expect(tool.IsDone()).toBe(true);
    return tool.Shape();
  };
  const faceType = oc.TopAbs_ShapeEnum.TopAbs_FACE as never;
  const facesOf = (shape: InstanceType<OpenCascadeInstance["TopoDS_Shape"]>) => {
    const faces = new oc.TopTools_IndexedMapOfShape_1();
    try {
      oc.TopExp.MapShapes_1(shape, faceType, faces);
      return Array.from({ length: faces.Size() }, (_, index) =>
        oc.TopoDS.Face_1(faces.FindKey(index + 1)),
      );
    } finally {
      faces.delete();
    }
  };
  const candidates = [
    { origin: [2, 0, 0], dimensions: [2, 2, 2] },
    { origin: [2, 0, 0], dimensions: [2, 2, 1] },
    { origin: [2, 0, 1], dimensions: [2, 2, 1] },
    { origin: [0, 2, 0], dimensions: [2, 2, 2] },
    { origin: [0, 0, 2], dimensions: [2, 2, 2] },
    { origin: [1, 0, 0], dimensions: [2, 2, 2] },
    { origin: [0, 1, 0], dimensions: [2, 2, 2] },
    { origin: [1, 1, 0], dimensions: [2, 2, 2] },
    { origin: [0.5, 0.5, 0], dimensions: [2, 2, 2] },
  ] as const;
  let fixture:
    | {
        faceId: FaceId;
        face: InstanceType<OpenCascadeInstance["TopoDS_Face"]>;
        raw: InstanceType<OpenCascadeInstance["TopoDS_Shape"]>;
        unified: InstanceType<OpenCascadeInstance["TopoDS_Shape"]>;
        builder: ReturnType<typeof createBooleanBuilder>;
      }
    | undefined;
  for (const candidate of candidates) {
    const tool = makeTool(candidate.origin, candidate.dimensions);
    const builder = createBooleanBuilder(oc, "join", body.shape, tool);
    builder.SetToFillHistory(true);
    builder.Build(new oc.Message_ProgressRange_1());
    const raw = builder.Shape();
    const refined = refineBooleanResultShape(oc, raw);
    const retained = [...body.facesById].find(([, face]) => {
      const modified = builder.Modified(face);
      try {
        return (
          modified.Size() === 0 &&
          facesOf(raw).filter((entry) => entry.IsSame(face)).length === 1 &&
          facesOf(refined.shape).filter((entry) => entry.IsSame(face)).length === 0
        );
      } finally {
        modified.delete();
      }
    });
    if (retained) {
      fixture = {
        faceId: retained[0],
        face: retained[1],
        raw,
        unified: refined.shape,
        builder,
      };
      break;
    }
  }

  expect(
    fixture,
    "The real Fuse fixture must reproduce raw IsSame=1 and unified IsSame=0.",
  ).toBeTruthy();
  if (!fixture) throw new Error("Expected an OCC unifier identity-loss fixture.");

  const list = (...shapes: InstanceType<OpenCascadeInstance["TopoDS_Shape"]>[]) => {
    const result = new oc.TopTools_ListOfShape_1();
    for (const shape of shapes) result.Append_1(shape);
    return result;
  };
  const rawHistorySource = {
    Modified: (shape: InstanceType<OpenCascadeInstance["TopoDS_Shape"]>) =>
      fixture.builder.Modified(shape),
    Generated: () => list(),
    IsDeleted: (shape: InstanceType<OpenCascadeInstance["TopoDS_Shape"]>) =>
      fixture.builder.IsDeleted(shape),
    resultShape: fixture.raw,
  };
  // This is g22's real history contract: the real Unify shape no longer
  // contains the retained raw face and exposes no Modified successor for it.
  const missingUnifierHistory = {
    Modified: () => list(),
    Generated: () => list(),
    resultShape: fixture.unified,
  };
  const selected = selectBooleanResultWithCompleteHistory({
    oc,
    operands: [fixture.face],
    rawShape: fixture.raw,
    rawHistorySource,
    unifiedShape: fixture.unified,
    unifyHistorySource: missingUnifierHistory,
  });
  expect(selected.usesUnifiedResult).toBe(false);
  expect(
    facesOf(selected.shape).filter((candidate) => candidate.IsSame(fixture.face)),
    "The policy must select the raw Boolean shape rather than the identity-losing unified shape.",
  ).toHaveLength(1);

  const replacement = resolveReplacementBodies(
    createOccAuthoringState(oc, { bodies: [body] }),
    body.bodyId,
    selected.shape,
    "feature_unifier_identity_replace" as FeatureId,
    { allowEmpty: false, historySources: selected.historySources },
  ).replacements[0];
  expect(
    replacement?.facesById.get(fixture.faceId)?.IsSame(fixture.face),
    "resolveReplacementBodies must retain the raw exact IsSame public face id.",
  ).toBe(true);
});

test("Modified history takes precedence and ambiguous Modified history fails closed", async () => {
  const oc = await getDefaultOpenCascadeInstance();
  const body = makeTrackedBox(
    oc,
    "body_modified_precedence" as BodyId,
    "feature_modified_precedence_seed" as FeatureId,
    [2, 2, 2],
  );
  const [source, , firstModified, secondModified] = [...body.facesById.values()];
  if (!source || !firstModified || !secondModified) {
    throw new Error("Expected three box faces for exact-history policy coverage.");
  }
  const list = (...shapes: InstanceType<OpenCascadeInstance["TopoDS_Shape"]>[]) => {
    const result = new oc.TopTools_ListOfShape_1();
    for (const shape of shapes) result.Append_1(shape);
    return result;
  };
  const unchangedUnifier = {
    Modified: () => list(),
    Generated: () => list(),
    resultShape: body.shape,
  };
  const uniqueModified = {
    Modified: (shape: InstanceType<OpenCascadeInstance["TopoDS_Shape"]>) =>
      shape.IsSame(source) ? list(firstModified) : list(),
    Generated: () => list(),
    resultShape: body.shape,
  };
  const manyModified = {
    Modified: (shape: InstanceType<OpenCascadeInstance["TopoDS_Shape"]>) =>
      shape.IsSame(source) ? list(firstModified, secondModified) : list(),
    Generated: () => list(),
    resultShape: body.shape,
  };
  const select = (rawHistorySource: typeof uniqueModified) =>
    selectBooleanResultWithCompleteHistory({
      oc,
      operands: [body.shape],
      rawShape: body.shape,
      rawHistorySource,
      unifiedShape: body.shape,
      unifyHistorySource: unchangedUnifier,
    });

  expect(
    select(uniqueModified).usesUnifiedResult,
    "A unique Modified successor must take precedence even when the source is still IsSame in the result.",
  ).toBe(true);
  expect(
    select(manyModified).usesUnifiedResult,
    "Many Modified successors are ambiguous and must fail closed instead of falling through to IsSame.",
  ).toBe(false);
});
