import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";

import type { AdvancedSolidFeatureDefinition } from "@/contracts/modeling/advanced-solid";
import { ADVANCED_SOLID_FEATURE_SCHEMA_VERSION } from "@/contracts/modeling/advanced-solid";
import type { BodyId, FeatureId } from "@/contracts/shared/ids";
import { createOccAuthoringState } from "@/domain/modeling/occ/authoring-state";
import {
  executeCombineFeature,
  executeSplitFeature,
} from "@/domain/modeling/occ/features/combine-split-delete";
import type { OpenCascadeNativeTopologyKernelHost } from "@/domain/modeling/occ/native-topology-payload";
import { toGpPnt } from "@/domain/modeling/occ/planes";
import type { OpenCascadeInstance } from "@/domain/modeling/occ/runtime";
import {
  OCC_REFERENCE_INVALIDATION_REASONS,
  trackNewSheetBody,
  trackNewSolidBody,
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
  origin: readonly [number, number, number],
) {
  const box = new oc.BRepPrimAPI_MakeBox_3(toGpPnt(oc, origin), 4, 4, 4);
  box.Build(new oc.Message_ProgressRange_1());
  expect(box.IsDone(), `Expected ${bodyId} box to build.`).toBeTruthy();

  return trackNewSolidBody(oc, {
    bodyId,
    label: bodyId,
    ownerFeatureId,
    shape: box.Shape(),
  });
}

/**
 * A sheet split tool needs `BRepAlgoAPI_Splitter`, which only exists in the
 * custom OCC build once `opencascade-recipe.yaml` has been rebuilt. The build's
 * generated type declarations are the authoritative record of its bindings.
 */
const CUSTOM_OCC_HAS_SPLITTER = readFileSync(
  new URL("../../../../../public/cadara-occ.d.ts", import.meta.url),
  "utf8",
).includes("BRepAlgoAPI_Splitter");

/** A sheet body at `y = 2` that fully crosses a `makeTrackedBox` box. */
function makeTrackedCrossingSheet(
  oc: OpenCascadeInstance,
  bodyId: BodyId,
  ownerFeatureId: FeatureId,
) {
  const edge = new oc.BRepBuilderAPI_MakeEdge_3(
    toGpPnt(oc, [-1, 2, -1]),
    toGpPnt(oc, [5, 2, -1]),
  );
  const wire = new oc.BRepBuilderAPI_MakeWire_2(edge.Edge());
  const prism = new oc.BRepPrimAPI_MakePrism_1(
    wire.Wire(),
    new oc.gp_Vec_4(0, 0, 6),
    false,
    true,
  );
  prism.Build(new oc.Message_ProgressRange_1());
  expect(
    prism.IsDone(),
    `Expected ${bodyId} sheet prism to build.`,
  ).toBeTruthy();

  return trackNewSheetBody(oc, {
    bodyId,
    label: bodyId,
    ownerFeatureId,
    shape: prism.Shape(),
  });
}

function splitDefinition(
  targetBodyId: BodyId,
  toolBodyId: BodyId,
  keepTools?: boolean,
) {
  return {
    kind: "split" as const,
    featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
    parameters: {
      ...(keepTools === undefined ? {} : { options: { keepTools } }),
      participants: [
        {
          role: "targetBody" as const,
          targets: [{ kind: "body" as const, bodyId: targetBodyId }],
        },
        {
          role: "toolBody" as const,
          targets: [{ kind: "body" as const, bodyId: toolBodyId }],
        },
      ],
    },
  } satisfies AdvancedSolidFeatureDefinition & { kind: "split" };
}

test("executeSplitFeature uses native split transaction for ambiguous/deleted topology history", async () => {
  const oc = await loadCustomOpenCascadeForTest();
  const target = makeTrackedBox(
    oc,
    "body_native_split_target" as BodyId,
    "feature_native_split_target" as FeatureId,
    [0, 0, 0],
  );
  const tool = makeTrackedBox(
    oc,
    "body_native_split_tool" as BodyId,
    "feature_native_split_tool" as FeatureId,
    [2, 0, 0],
  );
  const nativeHost = oc as unknown as OpenCascadeNativeTopologyKernelHost;
  const nativeBuilder =
    nativeHost.CadaraExecuteNativeFeatureTransaction
      ?.BuildSplitCommittedShapeTransactionWithHistory;
  let nativeCallCount = 0;
  expect(
    typeof nativeBuilder,
    "Expected custom OCC runtime to expose native split transactions.",
  ).toBe("function");
  nativeHost.CadaraExecuteNativeFeatureTransaction!.BuildSplitCommittedShapeTransactionWithHistory =
    (...args) => {
      nativeCallCount += 1;
      return nativeBuilder(...args);
    };
  const context = createOccAuthoringState(oc, { bodies: [target, tool] });

  const result = executeSplitFeature(
    context,
    "feature_native_split" as FeatureId,
    {
      kind: "split",
      featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
      parameters: {
        participants: [
          {
            role: "targetBody",
            targets: [{ kind: "body", bodyId: target.bodyId }],
          },
          {
            role: "toolBody",
            targets: [{ kind: "body", bodyId: tool.bodyId }],
          },
        ],
      },
    } satisfies AdvancedSolidFeatureDefinition & { kind: "split" },
  );

  expect(
    nativeCallCount,
    "Split feature execution should use the native split transaction when available.",
  ).toBe(1);
  expect(
    result.bodies.some((body) => body.bodyId === target.bodyId),
    "Split should remove the original target body.",
  ).toBeFalsy();
  expect(
    result.bodies.some((body) => body.bodyId === tool.bodyId),
    "Split should keep the tool body live.",
  ).toBeTruthy();
  expect(
    result.producedTargets.length > 0,
    "Native split should produce replacement split result bodies.",
  ).toBeTruthy();
  expect(
    [...result.historyInvalidations.values()].some(
      (invalidation) =>
        invalidation.reason ===
        OCC_REFERENCE_INVALIDATION_REASONS.topologyAmbiguous,
    ),
    "Native split should report ambiguous topology instead of choosing traversal-order successors.",
  ).toBeTruthy();
  expect(
    [...result.historyInvalidations.values()].some(
      (invalidation) =>
        invalidation.reason ===
          OCC_REFERENCE_INVALIDATION_REASONS.topologyUnsupportedHistory ||
        invalidation.reason ===
          OCC_REFERENCE_INVALIDATION_REASONS.topologyModified,
    ),
    "Native split should not fall back to unsupported or JS-side modified-history invalidations.",
  ).toBeFalsy();
});

test("executeCombineFeature uses native boolean transaction for single-tool subtraction history", async () => {
  const oc = await loadCustomOpenCascadeForTest();
  const target = makeTrackedBox(
    oc,
    "body_native_combine_target" as BodyId,
    "feature_native_combine_target" as FeatureId,
    [0, 0, 0],
  );
  const tool = makeTrackedBox(
    oc,
    "body_native_combine_tool" as BodyId,
    "feature_native_combine_tool" as FeatureId,
    [2, 0, 0],
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
  const context = createOccAuthoringState(oc, { bodies: [target, tool] });

  const result = executeCombineFeature(
    context,
    "feature_native_combine" as FeatureId,
    {
      kind: "combine",
      featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
      parameters: {
        operationIntent: "subtract",
        participants: [
          {
            role: "targetBody",
            targets: [{ kind: "body", bodyId: target.bodyId }],
          },
          {
            role: "toolBody",
            targets: [{ kind: "body", bodyId: tool.bodyId }],
          },
        ],
      },
    } satisfies AdvancedSolidFeatureDefinition & { kind: "combine" },
  );
  const replacement = result.bodies.find(
    (body) => body.bodyId === target.bodyId,
  );

  expect(
    nativeCallCount,
    "Combine subtraction should use the native boolean transaction when available.",
  ).toBe(1);
  expect(
    replacement != null,
    "Combine subtraction should keep a replacement target body.",
  ).toBeTruthy();
  expect(
    result.bodies.some((body) => body.bodyId === tool.bodyId),
    "Combine subtraction should consume the tool body.",
  ).toBeFalsy();
  expect(
    [...result.historyInvalidations.values()].some(
      (invalidation) =>
        invalidation.reason ===
          OCC_REFERENCE_INVALIDATION_REASONS.topologyUnsupportedHistory ||
        invalidation.reason ===
          OCC_REFERENCE_INVALIDATION_REASONS.topologyModified,
    ),
    "Native combine should not fall back to unsupported or JS-side modified-history invalidations.",
  ).toBeFalsy();
});

test.skipIf(!CUSTOM_OCC_HAS_SPLITTER)(
  "executeSplitFeature splits a solid target with a sheet tool body",
  async () => {
    const oc = await loadCustomOpenCascadeForTest();
    const target = makeTrackedBox(
      oc,
      "body_sheet_split_target" as BodyId,
      "feature_sheet_split_target" as FeatureId,
      [0, 0, 0],
    );
    const tool = makeTrackedCrossingSheet(
      oc,
      "body_sheet_split_tool" as BodyId,
      "feature_sheet_split_tool" as FeatureId,
    );
    const context = createOccAuthoringState(oc, { bodies: [target, tool] });

    const result = executeSplitFeature(
      context,
      "feature_sheet_split" as FeatureId,
      splitDefinition(target.bodyId, tool.bodyId),
    );

    expect(
      result.producedTargets,
      "A sheet tool crossing the target should split it into two solids.",
    ).toHaveLength(2);
    expect(
      result.bodies
        .filter((body) => body.bodyId !== tool.bodyId)
        .every((body) => body.bodyKind === "solid"),
      "Every split result body should be a solid.",
    ).toBeTruthy();
    expect(
      result.bodies.some((body) => body.bodyId === target.bodyId),
      "Split should remove the original target body.",
    ).toBeFalsy();
    expect(
      result.bodies.some((body) => body.bodyId === tool.bodyId),
      "Split should keep the sheet tool body live by default.",
    ).toBeTruthy();
    expect(
      [...result.historyInvalidations.values()].some(
        (invalidation) =>
          invalidation.reason ===
          OCC_REFERENCE_INVALIDATION_REASONS.topologyAmbiguous,
      ),
      "A sheet-tool split should report ambiguous target topology.",
    ).toBeTruthy();
  },
);

test.skipIf(!CUSTOM_OCC_HAS_SPLITTER)(
  "executeSplitFeature consumes a sheet tool body when keepTools is false",
  async () => {
    const oc = await loadCustomOpenCascadeForTest();
    const target = makeTrackedBox(
      oc,
      "body_sheet_split_consumed_target" as BodyId,
      "feature_sheet_split_consumed_target" as FeatureId,
      [0, 0, 0],
    );
    const tool = makeTrackedCrossingSheet(
      oc,
      "body_sheet_split_consumed_tool" as BodyId,
      "feature_sheet_split_consumed_tool" as FeatureId,
    );
    const context = createOccAuthoringState(oc, { bodies: [target, tool] });

    const result = executeSplitFeature(
      context,
      "feature_sheet_split_consumed" as FeatureId,
      splitDefinition(target.bodyId, tool.bodyId, false),
    );

    expect(
      result.bodies.some((body) => body.bodyId === tool.bodyId),
      "keepTools false should consume the sheet tool body.",
    ).toBeFalsy();
    expect(
      result.producedTargets,
      "Consuming the sheet tool should not change the split result bodies.",
    ).toHaveLength(2);
  },
);

test.skipIf(!CUSTOM_OCC_HAS_SPLITTER)(
  "executeSplitFeature splits with a sheet tool through the JavaScript fallback",
  async () => {
    const oc = await loadCustomOpenCascadeForTest();
    const nativeHost = oc as unknown as OpenCascadeNativeTopologyKernelHost;
    nativeHost.CadaraExecuteNativeFeatureTransaction!.BuildSplitCommittedShapeTransactionWithHistory =
      undefined;
    const target = makeTrackedBox(
      oc,
      "body_sheet_split_fallback_target" as BodyId,
      "feature_sheet_split_fallback_target" as FeatureId,
      [0, 0, 0],
    );
    const tool = makeTrackedCrossingSheet(
      oc,
      "body_sheet_split_fallback_tool" as BodyId,
      "feature_sheet_split_fallback_tool" as FeatureId,
    );
    const context = createOccAuthoringState(oc, { bodies: [target, tool] });

    const result = executeSplitFeature(
      context,
      "feature_sheet_split_fallback" as FeatureId,
      splitDefinition(target.bodyId, tool.bodyId),
    );

    expect(
      result.producedTargets,
      "The fallback splitter path should also produce two solid result bodies.",
    ).toHaveLength(2);
  },
);

test("executeSplitFeature rejects a sheet target body", async () => {
  const oc = await loadCustomOpenCascadeForTest();
  const target = makeTrackedCrossingSheet(
    oc,
    "body_sheet_split_sheet_target" as BodyId,
    "feature_sheet_split_sheet_target" as FeatureId,
  );
  const tool = makeTrackedBox(
    oc,
    "body_sheet_split_solid_tool" as BodyId,
    "feature_sheet_split_solid_tool" as FeatureId,
    [0, 0, 0],
  );
  const context = createOccAuthoringState(oc, { bodies: [target, tool] });

  expect(() =>
    executeSplitFeature(
      context,
      "feature_sheet_split_rejected" as FeatureId,
      splitDefinition(target.bodyId, tool.bodyId),
    ),
  ).toThrow(
    `advanced-feature-unsupported-kernel-case: OCC split does not support sheet body ${target.bodyId}.`,
  );
});
