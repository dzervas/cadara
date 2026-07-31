import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";

import type { AdvancedSolidFeatureDefinition } from "@/contracts/modeling/advanced-solid";
import { ADVANCED_SOLID_FEATURE_SCHEMA_VERSION } from "@/contracts/modeling/advanced-solid";
import type { BodyId, FaceId, FeatureId } from "@/contracts/shared/ids";
import {
  applyOccFeatureToAuthoringState,
  createOccAuthoringState,
} from "@/domain/modeling/occ/authoring-state";
import {
  createSheetSplitToolHistoryTopologyStage,
  executeCombineFeature,
  executeSplitFeature,
  translateSheetSplitToolHistoryToSemanticIds,
} from "@/domain/modeling/occ/features/combine-split-delete";
import {
  parseNativeSheetSplitToolHistoryJson,
  type OpenCascadeNativeTopologyKernelHost,
} from "@/domain/modeling/occ/native-topology-payload";
import { toGpPnt } from "@/domain/modeling/occ/planes";
import { requireFace } from "@/domain/modeling/occ/features/shared";
import type { OpenCascadeInstance } from "@/domain/modeling/occ/runtime";
import {
  OCC_REFERENCE_INVALIDATION_REASONS,
  trackNewSheetBody,
  trackNewSolidBody,
} from "@/domain/modeling/occ/topology";
import {
  createOccFeatureTopologyLineageMap,
  OccTopologyProvenanceMissingError,
  serializeOccFeatureTopologyLineage,
  type OccFeatureTopologyStage,
  type OccTopologyProvenanceIndex,
} from "@/domain/modeling/occ/topology-stage";

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
  dimensions: readonly [number, number, number] = [4, 4, 4],
) {
  const box = new oc.BRepPrimAPI_MakeBox_3(
    toGpPnt(oc, origin),
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

/**
 * A sheet split tool needs `BRepAlgoAPI_Splitter`, which only exists in the
 * custom OCC build once `opencascade-recipe.yaml` has been rebuilt. The build's
 * generated type declarations are the authoritative record of its bindings.
 */
const CUSTOM_OCC_DTS = readFileSync(
  new URL("../../../../../public/cadara-occ.d.ts", import.meta.url),
  "utf8",
);
const CUSTOM_OCC_HAS_SPLITTER = CUSTOM_OCC_DTS.includes("BRepAlgoAPI_Splitter");
const CUSTOM_OCC_HAS_SHEET_SPLIT_TOOL_HISTORY =
  CUSTOM_OCC_DTS.includes(
    "BuildSheetSplitCommittedShapeTransactionWithToolHistory",
  ) && CUSTOM_OCC_DTS.includes("SplitToolHistoryJson");

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

function provenanceIndex(
  entries: readonly [BodyId, FaceId, string][],
): OccTopologyProvenanceIndex {
  const roots = new Map(
    entries.map(([bodyId, faceId, root]) => [`${bodyId}:${faceId}`, root]),
  );
  return {
    resolveFace(target) {
      const root = roots.get(`${target.bodyId}:${target.faceId}`);
      if (!root) throw new Error(`Missing test provenance for ${target.faceId}.`);
      return root;
    },
  };
}

function producerStage(
  featureId: FeatureId,
  body: ReturnType<typeof makeTrackedBox> | ReturnType<typeof makeTrackedCrossingSheet>,
  rootPrefix: string,
): OccFeatureTopologyStage {
  return {
    featureId,
    outputs: new Map([
      [
        body.bodyId,
        {
          outputSlot: body.bodyId,
          body,
          sourceTargets: new Map(
            body.topology.faceIds.map((faceId, index) => [
              `${rootPrefix}:face-role:${index}`,
              [{ kind: "face" as const, bodyId: body.bodyId, faceId }],
            ]),
          ),
          unsupportedSourceKeys: new Set(),
        },
      ],
    ]),
  };
}

function createSheetSplitAuthoringState(
  oc: OpenCascadeInstance,
  target: ReturnType<typeof makeTrackedBox>,
  tool: ReturnType<typeof makeTrackedCrossingSheet>,
  previousFeatureTopologyLineage = createOccFeatureTopologyLineageMap([]),
) {
  const targetFeatureId = "feature_test_sheet_split_target_root" as FeatureId;
  const toolFeatureId = "feature_test_sheet_split_tool_root" as FeatureId;
  return createOccAuthoringState(oc, {
    bodies: [target, tool],
    featureTopologyStages: new Map([
      [
        targetFeatureId,
        producerStage(targetFeatureId, target, "extrude:target-root"),
      ],
      [toolFeatureId, producerStage(toolFeatureId, tool, "extrude:tool-root")],
    ]),
    previousFeatureTopologyLineage,
    historyOrder: [
      { kind: "feature", featureId: targetFeatureId },
      { kind: "feature", featureId: toolFeatureId },
      ...[...previousFeatureTopologyLineage.keys()].map((featureId) => ({
        kind: "feature" as const,
        featureId,
      })),
    ],
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

test("createSheetSplitToolHistoryTopologyStage scopes exact tool faces to each output slot", () => {
  const bodyA = {
    bodyId: "body_sheet_split_output_a" as BodyId,
  } as unknown as import("@/domain/modeling/occ/topology").OccTrackedBody;
  const bodyB = {
    bodyId: "body_sheet_split_output_b" as BodyId,
  } as unknown as import("@/domain/modeling/occ/topology").OccTrackedBody;
  const outputA = {
    outputSlotKey:
      "sheet-split-output:target:body_sheet_split_target:target-face-provenance:target-provenance-a",
    body: bodyA,
    finalFacesByNativeId: new Map([
      ["face_final_shared", "face_sheet_split_output_a_shared" as const],
      ["face_final_a_only", "face_sheet_split_output_a_only" as const],
    ]),
  };
  const outputB = {
    outputSlotKey:
      "sheet-split-output:target:body_sheet_split_target:target-face-provenance:target-provenance-b",
    body: bodyB,
    finalFacesByNativeId: new Map([
      ["face_final_shared", "face_sheet_split_output_b_shared" as const],
    ]),
  };
  const outputs = [outputA, outputB];
  const makeHistory = (
    cardinality: "zero" | "one" | "many",
    finalFaces: readonly {
      nativeFaceId: string;
      outputSlotKeys: readonly string[];
    }[],
  ) => ({
    outputs: [
      {
        nativeOutputSlotKey: "native-slot-a",
        outputSlotKey: outputA.outputSlotKey,
        sourceTargetProvenanceIds: ["target-provenance-a"],
        finalFaceNativeIds: ["face_final_shared", "face_final_a_only"],
      },
      {
        nativeOutputSlotKey: "native-slot-b",
        outputSlotKey: outputB.outputSlotKey,
        sourceTargetProvenanceIds: ["target-provenance-b"],
        finalFaceNativeIds: ["face_final_shared"],
      },
    ],
    toolFaceRelations: [
      {
        sourceToolFaceProvenanceId: "tool-provenance-a",
        cardinality,
        finalFaces,
      },
    ],
  });
  const sourceKeyFor = (outputSlotKey: string) =>
    `generated-from:feature_sheet_split:body_sheet_split_tool:face:${encodeURIComponent("tool-provenance-a")}:sheet-split-interface-face:output-slot:${encodeURIComponent(outputSlotKey)}`;

  const shared = createSheetSplitToolHistoryTopologyStage({
    ownerFeatureId: "feature_sheet_split" as FeatureId,
    toolBodyId: "body_sheet_split_tool" as BodyId,
    history: makeHistory("one", [
      {
        nativeFaceId: "face_final_shared",
        outputSlotKeys: [outputA.outputSlotKey, outputB.outputSlotKey],
      },
    ]),
    outputs,
  });
  const sourceKeyA = sourceKeyFor(outputA.outputSlotKey);
  const sourceKeyB = sourceKeyFor(outputB.outputSlotKey);
  expect(sourceKeyA).not.toBe(sourceKeyB);
  expect(shared.outputs.get(bodyA.bodyId)?.sourceTargets.get(sourceKeyA)).toEqual([
    {
      kind: "face",
      bodyId: bodyA.bodyId,
      faceId: "face_sheet_split_output_a_shared",
    },
  ]);
  expect(shared.outputs.get(bodyB.bodyId)?.sourceTargets.get(sourceKeyB)).toEqual([
    {
      kind: "face",
      bodyId: bodyB.bodyId,
      faceId: "face_sheet_split_output_b_shared",
    },
  ]);

  const zero = createSheetSplitToolHistoryTopologyStage({
    ownerFeatureId: "feature_sheet_split" as FeatureId,
    toolBodyId: "body_sheet_split_tool" as BodyId,
    history: makeHistory("zero", []),
    outputs,
  });
  expect(
    zero.outputs.get(bodyA.bodyId)?.unsupportedSourceKeys.has(sourceKeyA),
    "A zero-cardinality relation must stay explicitly unsupported per output slot.",
  ).toBeTruthy();
  expect(
    zero.outputs.get(bodyB.bodyId)?.unsupportedSourceKeys.has(sourceKeyB),
    "A zero-cardinality relation must stay explicitly unsupported per output slot.",
  ).toBeTruthy();

  const many = createSheetSplitToolHistoryTopologyStage({
    ownerFeatureId: "feature_sheet_split" as FeatureId,
    toolBodyId: "body_sheet_split_tool" as BodyId,
    history: makeHistory("many", [
      {
        nativeFaceId: "face_final_shared",
        outputSlotKeys: [outputA.outputSlotKey, outputB.outputSlotKey],
      },
      {
        nativeFaceId: "face_final_a_only",
        outputSlotKeys: [outputA.outputSlotKey],
      },
    ]),
    outputs,
  });
  expect(
    many.outputs.get(bodyA.bodyId)?.sourceTargets.has(sourceKeyA),
    "Two final faces in one output slot must remain ambiguous.",
  ).toBeFalsy();
  expect(
    many.outputs.get(bodyA.bodyId)?.unsupportedSourceKeys.has(sourceKeyA),
    "A many-cardinality relation must stay unsupported in its ambiguous output slot.",
  ).toBeTruthy();
  expect(
    many.outputs.get(bodyB.bodyId)?.sourceTargets.get(sourceKeyB),
    "A globally many relation may still be exact in another output slot.",
  ).toEqual([
    {
      kind: "face",
      bodyId: bodyB.bodyId,
      faceId: "face_sheet_split_output_b_shared",
    },
  ]);
});

test("translateSheetSplitToolHistoryToSemanticIds rejects incomplete aliases and native slot collisions", () => {
  const makeHistory = (outputs: readonly {
    outputSlotKey: string;
    sourceTargetFaceNativeIds: readonly string[];
  }[]) =>
    parseNativeSheetSplitToolHistoryJson(
      JSON.stringify({
        schemaVersion: "occ-native-sheet-split-tool-history-payload/v1alpha1",
        source: "occt7-shim",
        status: "available",
        targetBodyId: "body_sheet_split_target",
        toolBodyId: "body_sheet_split_tool",
        previousTopologyToken: "t0001",
        topologyToken: "t0002",
        outputs: outputs.map((output) => ({
          ...output,
          finalFaceNativeIds: ["face_final"],
        })),
        toolFaceRelations: [
          {
            sourceToolFace: {
              bodyId: "body_sheet_split_tool",
              nativeFaceId: "face_tool_native",
            },
            cardinality: "one",
            finalFaces: [
              {
                nativeFaceId: "face_final",
                outputSlotKeys: outputs.map((output) => output.outputSlotKey),
              },
            ],
          },
        ],
        diagnostics: [],
      }),
    );
  const history = makeHistory([
    {
      outputSlotKey: "native-slot-a",
      sourceTargetFaceNativeIds: ["face_target_native_a"],
    },
  ]);
  const aliases = {
    targetFaceIdsByNativeId: new Map([
      ["face_target_native_a", "face_target_public_a"],
    ]),
    toolFaceIdsByNativeId: new Map([
      ["face_tool_native", "face_tool_public"],
    ]),
    topologyProvenanceIndex: provenanceIndex([
      [
        "body_sheet_split_target" as BodyId,
        "face_target_public_a" as FaceId,
        "extrude:feature_target:profile:0:first-face",
      ],
      [
        "body_sheet_split_tool" as BodyId,
        "face_tool_public" as FaceId,
        "extrude:feature_tool:profile:0:generated-side-face",
      ],
    ]),
  };
  const semantic = translateSheetSplitToolHistoryToSemanticIds({
    history,
    ...aliases,
  });

  expect(semantic.outputs[0]?.outputSlotKey).toBe(
    `sheet-split-output:target:body_sheet_split_target:target-face-provenance:${encodeURIComponent("extrude:feature_target:profile:0:first-face")}`,
  );
  expect(semantic.toolFaceRelations[0]?.sourceToolFaceProvenanceId).toBe(
    "extrude:feature_tool:profile:0:generated-side-face",
  );
  expect(JSON.stringify(semantic)).not.toMatch(
    /face_target_public|face_tool_public|face_target_native|face_tool_native/,
  );
  expect(() =>
    translateSheetSplitToolHistoryToSemanticIds({
      history,
      ...aliases,
      targetFaceIdsByNativeId: new Map(),
    }),
  ).toThrow(/target-output-membership-alias-missing/);
  expect(() =>
    translateSheetSplitToolHistoryToSemanticIds({
      history,
      ...aliases,
      toolFaceIdsByNativeId: new Map([
        ["face_tool_native", "face_tool_public"],
        ["face_tool_other_native", "face_tool_public"],
      ]),
    }),
  ).toThrow(/tool-producer-alias-ambiguous/);
  expect(() =>
    translateSheetSplitToolHistoryToSemanticIds({
      history: makeHistory([
        {
          outputSlotKey: "native-slot-a",
          sourceTargetFaceNativeIds: ["face_target_native_a"],
        },
        {
          outputSlotKey: "native-slot-b",
          sourceTargetFaceNativeIds: ["face_target_native_b"],
        },
      ]),
      ...aliases,
      targetFaceIdsByNativeId: new Map([
        ["face_target_native_a", "face_target_public_a"],
        ["face_target_native_b", "face_target_public_b"],
      ]),
      topologyProvenanceIndex: provenanceIndex([
        ["body_sheet_split_target" as BodyId, "face_target_public_a" as FaceId, "same-target-root"],
        ["body_sheet_split_target" as BodyId, "face_target_public_b" as FaceId, "same-target-root"],
        ["body_sheet_split_tool" as BodyId, "face_tool_public" as FaceId, "tool-root"],
      ]),
    }),
  ).toThrow(/semantic-output-slot-collision/);
  expect(() =>
    translateSheetSplitToolHistoryToSemanticIds({
      history: makeHistory([
        {
          outputSlotKey: "native-slot-a",
          sourceTargetFaceNativeIds: ["face_target_native_a", "face_target_native_b"],
        },
      ]),
      ...aliases,
      targetFaceIdsByNativeId: new Map([
        ["face_target_native_a", "face_target_public_a"],
        ["face_target_native_b", "face_target_public_b"],
      ]),
      topologyProvenanceIndex: provenanceIndex([
        ["body_sheet_split_target" as BodyId, "face_target_public_a" as FaceId, "same-target-root"],
        ["body_sheet_split_target" as BodyId, "face_target_public_b" as FaceId, "same-target-root"],
        ["body_sheet_split_tool" as BodyId, "face_tool_public" as FaceId, "tool-root"],
      ]),
    }),
  ).toThrow(/exclusive-witness-provenance-ambiguous/);
});


test("translateSheetSplitToolHistoryToSemanticIds derives slots from exact exclusive canonical witnesses", () => {
  const makeHistory = (
    outputs: readonly {
      outputSlotKey: string;
      sourceTargetFaceNativeIds: readonly string[];
    }[],
  ) =>
    parseNativeSheetSplitToolHistoryJson(
      JSON.stringify({
        schemaVersion: "occ-native-sheet-split-tool-history-payload/v1alpha1",
        source: "occt7-shim",
        status: "available",
        targetBodyId: "body_sheet_split_target",
        toolBodyId: "body_sheet_split_tool",
        previousTopologyToken: "t0001",
        topologyToken: "t0002",
        outputs: outputs.map((output) => ({
          ...output,
          finalFaceNativeIds: [`face_final_${output.outputSlotKey}`],
        })),
        toolFaceRelations: [],
        diagnostics: [],
      }),
    );
  const targetAliases = new Map<FaceId, FaceId>([
    ["face_native_a", "face_public_a"],
    ["face_native_b", "face_public_b"],
    ["face_native_shared", "face_public_shared"],
    ["face_native_mirror", "face_public_mirror"],
    ["face_native_ambiguous", "face_public_ambiguous"],
    ["face_native_malformed", "face_public_malformed"],
  ]);
  const witnesses: OccTopologyProvenanceIndex = {
    resolveFace(target) {
      if (target.faceId === "face_public_a") return "canonical-witness-a";
      if (target.faceId === "face_public_b") return "canonical-witness-b";
      if (target.faceId === "face_public_mirror") {
        throw new OccTopologyProvenanceMissingError("face:body_sheet_split_target:face_public_mirror");
      }
      if (target.faceId === "face_public_ambiguous") {
        throw new Error("occ-topology-provenance-ambiguous: test witness.");
      }
      if (target.faceId === "face_public_malformed") {
        throw new Error("occ-topology-provenance-malformed-source-key: test witness.");
      }
      throw new Error(`Unexpected witness ${target.faceId}.`);
    },
  };
  const translate = (
    history: ReturnType<typeof makeHistory>,
    topologyProvenanceIndex: OccTopologyProvenanceIndex = witnesses,
  ) =>
    translateSheetSplitToolHistoryToSemanticIds({
      history,
      targetFaceIdsByNativeId: targetAliases,
      toolFaceIdsByNativeId: new Map(),
      topologyProvenanceIndex,
    });

  const semantic = translate(
    makeHistory([
      {
        outputSlotKey: "native-slot-a",
        sourceTargetFaceNativeIds: [
          "face_native_a",
          "face_native_shared",
          "face_native_mirror",
        ],
      },
      {
        outputSlotKey: "native-slot-b",
        sourceTargetFaceNativeIds: ["face_native_b", "face_native_shared"],
      },
    ]),
  );
  expect(
    semantic.outputs.map((output) => output.sourceTargetProvenanceIds),
    "An unclaimed Mirror-like face may be omitted while unique exact witnesses name each output.",
  ).toEqual([["canonical-witness-a"], ["canonical-witness-b"]]);
  expect(
    JSON.stringify(semantic),
    "Shared source faces do not discriminate semantic split output slots.",
  ).not.toContain("face_native_shared");

  expect(() =>
    translate(
      makeHistory([
        { outputSlotKey: "native-slot-a", sourceTargetFaceNativeIds: ["face_native_shared"] },
        { outputSlotKey: "native-slot-b", sourceTargetFaceNativeIds: ["face_native_shared"] },
      ]),
    ),
  ).toThrow(/exclusive-witnesses-missing/);
  expect(() =>
    translate(
      makeHistory([
        { outputSlotKey: "native-slot-a", sourceTargetFaceNativeIds: ["face_native_ambiguous"] },
      ]),
    ),
  ).toThrow("occ-topology-provenance-ambiguous: test witness.");
  expect(() =>
    translate(
      makeHistory([
        { outputSlotKey: "native-slot-a", sourceTargetFaceNativeIds: ["face_native_malformed"] },
      ]),
    ),
  ).toThrow("occ-topology-provenance-malformed-source-key: test witness.");

  const duplicateWitnessIndex = provenanceIndex([
    ["body_sheet_split_target" as BodyId, "face_public_a" as FaceId, "canonical-witness-collapsed"],
    ["body_sheet_split_target" as BodyId, "face_public_b" as FaceId, "canonical-witness-collapsed"],
  ]);
  expect(() =>
    translate(
      makeHistory([
        {
          outputSlotKey: "native-slot-a",
          sourceTargetFaceNativeIds: ["face_native_a", "face_native_b"],
        },
      ]),
      duplicateWitnessIndex,
    ),
  ).toThrow(/exclusive-witness-provenance-ambiguous/);
  expect(() =>
    translate(
      makeHistory([
        { outputSlotKey: "native-slot-a", sourceTargetFaceNativeIds: ["face_native_a"] },
        { outputSlotKey: "native-slot-b", sourceTargetFaceNativeIds: ["face_native_b"] },
      ]),
      duplicateWitnessIndex,
    ),
  ).toThrow(/semantic-output-slot-collision/);
});

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

test.skipIf(!CUSTOM_OCC_HAS_SHEET_SPLIT_TOOL_HISTORY)(
  "executeSplitFeature publishes an exact sheet-tool interface producer after the additive native ABI rebuild",
  async () => {
    const oc = await loadCustomOpenCascadeForTest();
    const nativeHost = oc as unknown as OpenCascadeNativeTopologyKernelHost;
    const nativeBuilder =
      nativeHost.CadaraExecuteNativeFeatureTransaction!
        .BuildSheetSplitCommittedShapeTransactionWithToolHistory!;
    let transactionDeleteCount = 0;
    let transactionShapeCallCount = 0;
    nativeHost.CadaraExecuteNativeFeatureTransaction!.BuildSheetSplitCommittedShapeTransactionWithToolHistory =
      (...args) => {
        const transaction = nativeBuilder(...args);
        return {
          IsDone: () => transaction.IsDone(),
          Shape: () => {
            transactionShapeCallCount += 1;
            return transaction.Shape();
          },
          PayloadJson: () => transaction.PayloadJson(),
          HistoryJson: () => transaction.HistoryJson(),
          SplitToolHistoryJson: () => transaction.SplitToolHistoryJson?.(),
          delete: () => {
            transactionDeleteCount += 1;
            transaction.delete();
          },
        };
      };
    const target = makeTrackedBox(
      oc,
      "body_sheet_split_history_target" as BodyId,
      "feature_sheet_split_history_target" as FeatureId,
      [0, 0, 0],
    );
    const tool = makeTrackedCrossingSheet(
      oc,
      "body_sheet_split_history_tool" as BodyId,
      "feature_sheet_split_history_tool" as FeatureId,
    );
    const result = executeSplitFeature(
      createSheetSplitAuthoringState(oc, target, tool),
      "feature_sheet_split_history" as FeatureId,
      splitDefinition(target.bodyId, tool.bodyId),
    );
    const interfaceClaims = [
      ...(result.topologyStage?.outputs.values() ?? []),
    ].flatMap((output) =>
      [...output.sourceTargets].filter(([sourceKey]) =>
        sourceKey.includes(":sheet-split-interface-face:output-slot:"),
      ),
    );

    expect(
      interfaceClaims.length,
      "The rebuilt additive ABI should publish one exact interface producer claim for each output that shares the physical split face.",
    ).toBe(2);
    expect(
      new Set(interfaceClaims.map(([sourceKey]) => sourceKey)).size,
      "Each shared-interface claim must use an output-slot-qualified producer key.",
    ).toBe(2);
    expect(
      interfaceClaims.every(([, targets]) => targets.length === 1),
      "Each exact sheet-tool producer claim must name one live public face in its own output body.",
    ).toBeTruthy();
    expect(
      new Set(
        interfaceClaims.map(([, targets]) =>
          targets[0]?.kind === "face" ? targets[0].bodyId : undefined,
        ),
      ).size,
      "Shared physical interface faces must be represented by independent body-scoped public FaceIds.",
    ).toBe(2);
    const persistedLineage = serializeOccFeatureTopologyLineage(
      new Map([["feature_sheet_split_history" as FeatureId, result.topologyStage!]]),
      new Map(),
      new Set(["feature_sheet_split_history" as FeatureId]),
    );
    expect(
      persistedLineage[0]?.outputs.flatMap((output) => output.sourceTargets),
      "Serialized lineage must retain both output-scoped claims for a later rebuild.",
    ).toHaveLength(2);
    expect(
      transactionShapeCallCount,
      "The adapter must retain one transaction Shape wrapper for the complete tracking scope.",
    ).toBe(1);
    expect(
      transactionDeleteCount,
      "The native transaction must be released after successful output tracking.",
    ).toBe(1);
  },
);


test.skipIf(!CUSTOM_OCC_HAS_SHEET_SPLIT_TOOL_HISTORY)(
  "executeSplitFeature degrades unavailable semantic tool history to generic native split bodies",
  async () => {
    const oc = await loadCustomOpenCascadeForTest();
    const target = makeTrackedBox(
      oc,
      "body_sheet_split_degraded_target" as BodyId,
      "feature_sheet_split_degraded_target" as FeatureId,
      [0, 0, 0],
    );
    const tool = makeTrackedCrossingSheet(
      oc,
      "body_sheet_split_degraded_tool" as BodyId,
      "feature_sheet_split_degraded_tool" as FeatureId,
    );
    const context = createSheetSplitAuthoringState(oc, target, tool);
    context.topologyProvenanceIndex = {
      resolveFace(targetFace) {
        throw new OccTopologyProvenanceMissingError(
          `face:${targetFace.bodyId}:${targetFace.faceId}`,
        );
      },
    };

    const result = executeSplitFeature(
      context,
      "feature_sheet_split_degraded" as FeatureId,
      splitDefinition(target.bodyId, tool.bodyId),
    );

    expect(result.topologyStage).toBeUndefined();
    expect(result.producedTargets).toEqual([
      { kind: "body", bodyId: "body_feature_sheet_split_degraded_split_1" },
      { kind: "body", bodyId: "body_feature_sheet_split_degraded_split_2" },
    ]);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "occ-native-sheet-split-tool-history-degraded",
        severity: "warning",
      }),
    );
  },
);

test.skipIf(!CUSTOM_OCC_HAS_SHEET_SPLIT_TOOL_HISTORY)(
  "sheet split releases its native transaction when tool-history parsing fails",
  async () => {
    const oc = await loadCustomOpenCascadeForTest();
    const nativeHost = oc as unknown as OpenCascadeNativeTopologyKernelHost;
    const nativeBuilder =
      nativeHost.CadaraExecuteNativeFeatureTransaction!
        .BuildSheetSplitCommittedShapeTransactionWithToolHistory!;
    let transactionDeleteCount = 0;
    nativeHost.CadaraExecuteNativeFeatureTransaction!.BuildSheetSplitCommittedShapeTransactionWithToolHistory =
      (...args) => {
        const transaction = nativeBuilder(...args);
        return {
          IsDone: () => transaction.IsDone(),
          Shape: () => transaction.Shape(),
          PayloadJson: () => transaction.PayloadJson(),
          HistoryJson: () => transaction.HistoryJson(),
          SplitToolHistoryJson: () => {
            throw new Error("tool-history read failure");
          },
          delete: () => {
            transactionDeleteCount += 1;
            transaction.delete();
          },
        };
      };
    const target = makeTrackedBox(
      oc,
      "body_sheet_split_history_failure_target" as BodyId,
      "feature_sheet_split_history_failure_target" as FeatureId,
      [0, 0, 0],
    );
    const tool = makeTrackedCrossingSheet(
      oc,
      "body_sheet_split_history_failure_tool" as BodyId,
      "feature_sheet_split_history_failure_tool" as FeatureId,
    );

    expect(() =>
      executeSplitFeature(
        createSheetSplitAuthoringState(oc, target, tool),
        "feature_sheet_split_history_failure" as FeatureId,
        splitDefinition(target.bodyId, tool.bodyId),
      ),
    ).toThrow("tool-history read failure");
    expect(transactionDeleteCount).toBe(1);
  },
);

test.skipIf(!CUSTOM_OCC_HAS_SHEET_SPLIT_TOOL_HISTORY)(
  "sheet split keeps semantic output and interface producer identity across target-width rebuilds",
  async () => {
    const oc = await loadCustomOpenCascadeForTest();
    const featureId = "feature_sheet_split_semantic_rebuild" as FeatureId;
    const targetBodyId = "body_sheet_split_semantic_target" as BodyId;
    const toolBodyId = "body_sheet_split_semantic_tool" as BodyId;
    const firstTarget = makeTrackedBox(
      oc,
      targetBodyId,
      "feature_sheet_split_semantic_target" as FeatureId,
      [0, 0, 0],
      [4, 4, 4],
    );
    const firstTool = makeTrackedCrossingSheet(
      oc,
      toolBodyId,
      "feature_sheet_split_semantic_tool" as FeatureId,
    );
    const feature = {
      featureId,
      label: featureId,
      suppressed: false,
      definition: splitDefinition(targetBodyId, toolBodyId),
      producedTargets: [],
    };
    const first = applyOccFeatureToAuthoringState(
      createSheetSplitAuthoringState(oc, firstTarget, firstTool),
      feature,
    );
    const firstStage = first.featureTopologyStages.get(featureId);
    const firstInterfaceClaim = [...(firstStage?.outputs.values() ?? [])]
      .flatMap((output) => [...output.sourceTargets])
      .find(([sourceKey]) =>
        sourceKey.includes(":sheet-split-interface-face:output-slot:"),
      );
    expect(firstInterfaceClaim, "Expected an exact interface producer claim.").toBeTruthy();

    const rebuiltTarget = makeTrackedBox(
      oc,
      targetBodyId,
      "feature_sheet_split_semantic_target" as FeatureId,
      [0, 0, 0],
      [5, 4, 4],
    );
    const rebuiltTool = makeTrackedCrossingSheet(
      oc,
      toolBodyId,
      "feature_sheet_split_semantic_tool" as FeatureId,
    );
    expect(
      rebuiltTarget.topology.faceIds,
      "The real OCC width edit should naturally remint target FaceIds in this regression test.",
    ).not.toEqual(firstTarget.topology.faceIds);
    const persistedLineage = serializeOccFeatureTopologyLineage(
      first.featureTopologyStages,
      new Map(),
      new Set([featureId]),
    );
    const rebuilt = applyOccFeatureToAuthoringState(
      createSheetSplitAuthoringState(
        oc,
        rebuiltTarget,
        rebuiltTool,
        createOccFeatureTopologyLineageMap(persistedLineage),
      ),
      feature,
    );
    const rebuiltStage = rebuilt.featureTopologyStages.get(featureId);
    const rebuiltInterfaceClaim = [...(rebuiltStage?.outputs.values() ?? [])]
      .flatMap((output) => [...output.sourceTargets])
      .find(([sourceKey]) => sourceKey === firstInterfaceClaim?.[0]);

    expect(
      [...(rebuiltStage?.outputs.keys() ?? [])].sort(),
      "Output bodies must be named from durable target-face memberships, not rebuilt native face ids.",
    ).toEqual([...(firstStage?.outputs.keys() ?? [])].sort());
    expect(
      rebuiltInterfaceClaim,
      "The output-qualified producer key must survive the upstream target width edit.",
    ).toBeTruthy();
    expect(
      rebuiltInterfaceClaim?.[1],
      "Reconciliation must preserve the selected interface FaceId under its stable producer key.",
    ).toEqual(firstInterfaceClaim?.[1]);
    const downstreamFace = rebuiltInterfaceClaim?.[1][0];
    expect(downstreamFace?.kind).toBe("face");
    if (downstreamFace?.kind === "face") {
      const downstreamBody = rebuilt.bodies.find(
        (body) => body.bodyId === downstreamFace.bodyId,
      );
      expect(downstreamBody).toBeTruthy();
      expect(() =>
        requireFace(rebuilt, downstreamBody!, downstreamFace.faceId),
      ).not.toThrow();
    }
    const persistentIdentity = [
      ...(rebuiltStage?.outputs.keys() ?? []),
      ...[...(rebuiltStage?.outputs.values() ?? [])].flatMap((output) => [
        ...output.sourceTargets.keys(),
      ]),
    ].join("\n");
    expect(persistentIdentity).not.toMatch(/native-slot|face_[^:%]+|:t\d+/);
  },
);

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
    const context = createSheetSplitAuthoringState(oc, target, tool);

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
    const context = createSheetSplitAuthoringState(oc, target, tool);

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
    nativeHost.CadaraExecuteNativeFeatureTransaction!.BuildSheetSplitCommittedShapeTransactionWithToolHistory =
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
    expect(
      result.topologyStage,
      "Without the additive tool-history ABI, the fallback must not fabricate an interface producer claim.",
    ).toBeUndefined();
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
