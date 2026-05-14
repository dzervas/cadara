import { test, expect } from "vitest";
import { readFile } from "node:fs/promises";

import type { AdvancedSolidFeatureDefinition } from "@/contracts/modeling/advanced-solid";
import { ADVANCED_SOLID_FEATURE_SCHEMA_VERSION } from "@/contracts/modeling/advanced-solid";
import type { BodyId, FeatureId } from "@/contracts/shared/ids";
import { createOccAuthoringState } from "@/domain/modeling/occ/authoring-state";
import { executeShellFeature } from "@/domain/modeling/occ/features/shell";
import {
  executeMirrorFeature,
  executeTransformFeature,
} from "@/domain/modeling/occ/features/mirror-transform";
import type { OpenCascadeNativeTopologyKernelHost } from "@/domain/modeling/occ/native-topology-payload";
import { toGpPnt } from "@/domain/modeling/occ/planes";
import type { OpenCascadeInstance } from "@/domain/modeling/occ/runtime";
import {
  OCC_REFERENCE_INVALIDATION_REASONS,
  trackNewSolidBody,
  type OccReferenceInvalidationRecord,
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
) {
  const box = new oc.BRepPrimAPI_MakeBox_3(toGpPnt(oc, [0, 0, 0]), 4, 4, 4);
  box.Build(new oc.Message_ProgressRange_1());
  expect(box.IsDone(), `Expected ${bodyId} box to build.`).toBeTruthy();

  return trackNewSolidBody(oc, {
    bodyId,
    label: bodyId,
    ownerFeatureId,
    shape: box.Shape(),
  });
}

function assertNativeHistoryDidNotFallBack(
  invalidations: ReadonlyMap<string, OccReferenceInvalidationRecord>,
  label: string,
) {
  for (const invalidation of invalidations.values()) {
    expect(
      invalidation.reason,
      `${label} should use native history instead of unsupported-history invalidations.`,
    ).not.toBe(OCC_REFERENCE_INVALIDATION_REASONS.topologyUnsupportedHistory);
    expect(
      invalidation.reason,
      `${label} should use native successor classifications instead of JS-side modified-history invalidations.`,
    ).not.toBe(OCC_REFERENCE_INVALIDATION_REASONS.topologyModified);
  }
}

test("executeTransformFeature uses native transaction history for replacement topology", async () => {
  const oc = await loadCustomOpenCascadeForTest();
  const body = makeTrackedBox(
    oc,
    "body_native_transform_history_seed" as BodyId,
    "feature_native_transform_history_seed" as FeatureId,
  );
  const context = createOccAuthoringState(oc, { bodies: [body] });

  const result = executeTransformFeature(
    context,
    "feature_native_transform_history" as FeatureId,
    {
      kind: "transform",
      featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
      parameters: {
        participants: [
          { role: "body", targets: [{ kind: "body", bodyId: body.bodyId }] },
          {
            role: "transformReference",
            targets: [
              { kind: "construction", constructionId: "construction_plane-xy" },
            ],
          },
        ],
        options: { distance: 1 },
      },
    } satisfies AdvancedSolidFeatureDefinition & { kind: "transform" },
  );
  const replacement = result.bodies.find(
    (candidate) => candidate.bodyId === body.bodyId,
  );

  expect(
    replacement != null,
    "Native transform should replace the selected body.",
  ).toBeTruthy();
  expect(
    body.topology.faceIds.every((faceId) =>
      replacement?.topology.faceIds.includes(faceId),
    ),
    "Native transform should preserve previous face ids with unique successors.",
  ).toBeTruthy();
  assertNativeHistoryDidNotFallBack(
    result.historyInvalidations,
    "Native transform",
  );
});

test("executeShellFeature uses native shell transaction before replacement boolean composition", async () => {
  const oc = await loadCustomOpenCascadeForTest();
  const body = makeTrackedBox(
    oc,
    "body_native_shell_history_seed" as BodyId,
    "feature_native_shell_history_seed" as FeatureId,
  );
  const nativeHost = oc as unknown as OpenCascadeNativeTopologyKernelHost;
  const nativeBuilder =
    nativeHost.CadaraExecuteNativeFeatureTransaction
      ?.BuildShellCommittedShapeTransactionWithHistory;
  let nativeCallCount = 0;
  expect(
    typeof nativeBuilder,
    "Expected custom OCC runtime to expose native shell transactions.",
  ).toBe("function");
  nativeHost.CadaraExecuteNativeFeatureTransaction!.BuildShellCommittedShapeTransactionWithHistory =
    (...args) => {
      nativeCallCount += 1;
      return nativeBuilder(...args);
    };
  const faceId = body.topology.faceIds[0];
  expect(
    faceId != null,
    "Expected the tracked box to expose a shell removable face target.",
  ).toBeTruthy();
  const context = createOccAuthoringState(oc, { bodies: [body] });

  const result = executeShellFeature(
    context,
    "feature_native_shell_history" as FeatureId,
    {
      bodyTarget: { kind: "body", bodyId: body.bodyId },
      faceTargets: [{ kind: "face", bodyId: body.bodyId, faceId }],
      thickness: 0.2,
      operation: "join",
      booleanScope: { kind: "targetBody", bodyId: body.bodyId },
    },
  );
  const replacement = result.bodies.find(
    (candidate) => candidate.bodyId === body.bodyId,
  );

  expect(
    replacement != null,
    "Native shell composition should replace the selected body.",
  ).toBeTruthy();
  expect(
    nativeCallCount,
    "Shell feature execution should use the native shell transaction when available.",
  ).toBe(1);
  assertNativeHistoryDidNotFallBack(
    result.historyInvalidations,
    "Native shell composition",
  );
});

test("executeMirrorFeature uses native transform transaction for copied topology", async () => {
  const oc = await loadCustomOpenCascadeForTest();
  const body = makeTrackedBox(
    oc,
    "body_native_mirror_seed" as BodyId,
    "feature_native_mirror_seed" as FeatureId,
  );
  const nativeHost = oc as unknown as OpenCascadeNativeTopologyKernelHost;
  const nativeBuilder =
    nativeHost.CadaraExecuteNativeFeatureTransaction
      ?.BuildTransformCommittedShapeTransactionWithHistory;
  let nativeCallCount = 0;
  expect(
    typeof nativeBuilder,
    "Expected custom OCC runtime to expose native transform transactions.",
  ).toBe("function");
  nativeHost.CadaraExecuteNativeFeatureTransaction!.BuildTransformCommittedShapeTransactionWithHistory =
    (...args) => {
      nativeCallCount += 1;
      return nativeBuilder(...args);
    };
  const context = createOccAuthoringState(oc, { bodies: [body] });

  const result = executeMirrorFeature(
    context,
    "feature_native_mirror" as FeatureId,
    {
      kind: "mirror",
      featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
      parameters: {
        participants: [
          { role: "body", targets: [{ kind: "body", bodyId: body.bodyId }] },
          {
            role: "plane",
            targets: [
              { kind: "construction", constructionId: "construction_plane-yz" },
            ],
          },
        ],
        options: { copy: true },
      },
    } satisfies AdvancedSolidFeatureDefinition & { kind: "mirror" },
  );
  const mirroredBody = result.bodies.find(
    (candidate) => candidate.bodyId !== body.bodyId,
  );

  expect(
    mirroredBody != null,
    "Native mirror should append a copied body.",
  ).toBeTruthy();
  expect(
    nativeCallCount,
    "Mirror feature execution should use the native transform transaction when available.",
  ).toBe(1);
  expect(
    result.historyInvalidations.size,
    "Mirror copy should keep source topology live and create fresh copied topology.",
  ).toBe(0);
});
