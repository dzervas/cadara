import { describe, expect, test } from "vitest";
import type { ImportCapabilities } from "@/contracts/import/capabilities";
import type { ResolvedImportSource } from "@/contracts/import/source";
import { validateImportPreparedActions } from "@/contracts/import/validation";
import {
  HOLE_OPTION_DESCRIPTORS,
  validateAdvancedSolidFeatureDefinition,
  type AdvancedSolidFeatureAuthoringDescriptor,
} from "@/contracts/modeling/advanced-solid";
import { validateFeatureDefinitionAuthoredValueInvariants } from "@/contracts/modeling/feature-authored-values";
import { CONTRACT_VERSION } from "@/contracts/shared/versioning";

import type { OnshapeFeatureNode } from "@/domain/import/onshape/bundle-reader";
import type { OnshapeFeatureTranslator } from "@/domain/import/onshape/feature-translator-registry";
import { readTopologyQueryRefs } from "@/domain/import/onshape/topology-query-reader";
import { resolveTopologyReferences } from "@/domain/import/onshape/topology-reference-resolver";
import { createRollbackTopologyTimeline } from "@/domain/import/onshape/rollback-topology-reader";
import {
  booleanBodiesFeatureTranslator,
  buildResolvedBodyConsumerDefinition,
  chamferFeatureTranslator,
  deleteBodiesFeatureTranslator,
  filletFeatureTranslator,
  holeFeatureTranslator,
  mirrorFeatureTranslator,
  circularPatternFeatureTranslator,
  shellFeatureTranslator,
  thickenFeatureTranslator,
  linearPatternFeatureTranslator,
  splitFeatureTranslator,
  transformFeatureTranslator,
} from "@/domain/import/onshape/wave-b-body-feature-translators";
import {
  onshapeImportProvider,
  resolvePlannedDeferredParticipants,
} from "@/domain/import/onshape/provider";
import { makeWaveTMirrorTransformCaptureBundle } from "@/domain/import/onshape/wave-t-capture-fixtures";
import { makeWaveXChamferAndImplicitUnionCaptureBundle } from "@/domain/import/onshape/wave-x-capture-fixtures";
import { makeWaveXPatternMirrorCaptureBundle } from "@/domain/import/onshape/wave-x-pattern-mirror-capture-fixtures";
import { makeWaveWPatternCaptureBundle } from "@/domain/import/onshape/wave-w-pattern-capture-fixtures";

const query = (id: string) => ({
  btType: "BTMIndividualQuery-138",
  queryString: `query=${id}`,
  deterministicIds: [id],
});
const queryParameter = (parameterId: string, ids: string[]) => ({
  btType: "BTMParameterQueryList-148",
  parameterId,
  queries: ids.map(query),
});

const holeAdvancedDescriptor = {
  featureKind: "hole",
  participants: [
    {
      role: "location",
      label: "Hole locations",
      required: true,
      cardinality: { min: 1, max: null },
      acceptedKinds: ["sketchPoint"],
    },
    {
      role: "body",
      label: "Body targets",
      required: true,
      cardinality: { min: 1, max: null },
      acceptedKinds: ["body"],
    },
  ],
  options: HOLE_OPTION_DESCRIPTORS,
} as const satisfies AdvancedSolidFeatureAuthoringDescriptor;

function planHole(parameters: unknown[], options: { queryText?: string; pointIds?: string[]; sketchPlanTier?: "parametric" | "baked" } = {}) {
  const sketchFeatureId = "SKETCH_LOC";
  const pointIds = options.pointIds ?? ["POINT_A"];
  const queryString = options.queryText ?? `query = qCreatedBy(id + "${sketchFeatureId}" + "pointOp", EntityType.VERTEX); ${pointIds[0]}`;
  return holeFeatureTranslator.plan({
    feature: {
      featureId: "F_hole",
      featureType: "hole",
      name: "Hole",
      parameters: [
        ...parameters,
        { parameterId: "locations", queries: [{ queryString }] },
        queryParameter("scope", ["body"]),
      ],
    } as OnshapeFeatureNode,
    label: "Hole",
    onshapeSuppressed: false,
    read: {
      features: [
        { featureId: sketchFeatureId, featureType: "newSketch", parameters: [] },
        { featureId: "F_hole", featureType: "hole", parameters: [] },
      ],
      solvedSketchesByFeatureId: new Map([[sketchFeatureId, {
        featureId: sketchFeatureId,
        entities: pointIds.map((entityId, index) => ({
          entityId,
          entityType: "point",
          onshapeEntityType: "skPoint",
          isConstruction: false,
          center3d: [index / 1000, 0, 0] as [number, number, number],
        })),
      }]]),
    } as never,
    references: new Map(),
    state: {
      sketchPlansByFeatureId: new Map([[sketchFeatureId, { tier: options.sketchPlanTier ?? "parametric", planeKey: "xy" }]]),
      bodyProducingFeatureIds: [],
    },
  });
}
const valueParameter = (parameterId: string, value: unknown, expression?: string) => ({
  parameterId,
  value,
  ...(expression ? { expression } : {}),
});

function plan(translator: OnshapeFeatureTranslator, featureType: string, parameters: unknown[], references = new Map()) {
  const feature = { featureId: `F_${featureType}`, featureType, name: featureType, parameters } as OnshapeFeatureNode;
  return translator.plan({
    feature,
    label: featureType,
    onshapeSuppressed: false,
    read: {} as never,
    references,
    state: {
      sketchPlansByFeatureId: new Map(),
      bodyProducingFeatureIds: [],
    },
  });
}

test("provider helper resolves planned sketchPointFromFeature participants", () => {
  const result = resolvePlannedDeferredParticipants(
    {
      kind: "hole",
      featureTypeVersion: "advanced-solid-feature/v0",
      parameters: {
        participants: [
          {
            role: "location",
            targets: [
              {
                kind: "sketchPointFromFeature",
                sketchFeatureId: "SKETCH_A",
                pointId: "sketch_point_hole_center",
              },
            ],
          },
          { role: "body", targets: [{ kind: "body", bodyId: "body_target" }] },
        ],
      },
    },
    new Map([["SKETCH_A", 3]]),
  );

  expect(result.missingFeatureId).toBeNull();
  expect(result.definition).toMatchObject({
    parameters: {
      participants: [
        {
          role: "location",
          targets: [
            {
              kind: "sketchPoint",
              sketchId: { kind: "sketchIdOf", actionIndex: 3 },
              pointId: "sketch_point_hole_center",
            },
          ],
        },
        { role: "body", targets: [{ kind: "body", bodyId: "body_target" }] },
      ],
    },
  });

  expect(
    resolvePlannedDeferredParticipants(
      {
        kind: "hole",
        featureTypeVersion: "advanced-solid-feature/v0",
        parameters: {
          participants: [
            {
              role: "location",
              targets: [
                {
                  kind: "sketchPointFromFeature",
                  sketchFeatureId: "MISSING_SKETCH",
                  pointId: "sketch_point_hole_center",
                },
              ],
            },
          ],
        },
      },
      new Map(),
    ),
  ).toMatchObject({ definition: null, missingFeatureId: "MISSING_SKETCH" });
});

const providerCapabilities: ImportCapabilities = {
  context: {
    contractVersion: CONTRACT_VERSION,
    documentId: "doc_workspace",
    baseRevisionId: "rev_1",
  },
  modeling: {
    async bakeGeometry() { throw new Error("not used"); },
    async reconstructMeshToBrep() { throw new Error("not used"); },
  },
  sketch: {
    async convertVectorToSketch() { throw new Error("not used"); },
  },
  assets: {
    async registerGeometryAsset() { throw new Error("not used"); },
    async storeEmbeddedBinary() { throw new Error("not used"); },
  },
  history: {
    async evaluateHistoryProbe(input) {
      const signatures = [{
        entityClass: "body" as const,
        geometryType: "solid",
        boundingBox: { low: [-10, -10, 0] as [number, number, number], high: [10, 10, 20] as [number, number, number] },
        centroid: [0, 0, 10] as [number, number, number],
        reference: { kind: "body" as const, bodyId: "body_mirror_source" as never },
      }];
      return {
        steps: Array.from(
          { length: Math.max(1, input.actions.orderedActions?.length ?? 0) },
          () => ({ status: "rebuilt" as const, signatures }),
        ),
      };
    },
  },
};

function mirrorSource(): ResolvedImportSource {
  return {
    name: "wave-t-mirror.onshape-capture.json",
    origin: { kind: "localFile", fileName: "wave-t-mirror.onshape-capture.json" },
    mediaType: "application/json",
    bytes: new TextEncoder().encode(JSON.stringify(makeWaveTMirrorTransformCaptureBundle())),
    fingerprint: `sha256:${"a".repeat(64)}`,
  };
}

describe("Wave B body topology translators", () => {
  test("maps boolean target/tool roles and ignores inactive offset queries", () => {
    const feature = {
      featureId: "F_BOOL",
      featureType: "booleanBodies",
      parameters: [
        valueParameter("operationType", "SUBTRACTION"),
        valueParameter("offset", false),
        valueParameter("keepTools", true),
        queryParameter("targets", ["target"]),
        queryParameter("tools", ["tool"]),
        queryParameter("entitiesToOffset", ["inactive-face"]),
      ],
    } as OnshapeFeatureNode;
    const result = plan(booleanBodiesFeatureTranslator, feature.featureType, feature.parameters ?? []);
    expect(result.reasonCodes).toEqual(["needs-history-probe"]);
    expect(result.plannedBodyTopologyConsumer).toMatchObject({
      featureKind: "combine",
      operationIntent: "subtract",
      options: { keepTools: true },
      slots: [
        { parameterId: "targets", role: "targetBody" },
        { parameterId: "tools", role: "toolBody" },
      ],
    });
    expect(result.inputDependencies).toEqual([
      { kind: "query", parameterId: "targets", slotKey: "targetBodies" },
      { kind: "query", parameterId: "tools", slotKey: "toolBodies" },
    ]);
    const read = readTopologyQueryRefs(feature, result.plannedBodyTopologyConsumer!.slots);
    expect(read.refs.map((entry) => entry.deterministicId)).toEqual(["target", "tool"]);
  });

  test("deduplicates deleteBodies duplicate encodings by semantic body role", () => {
    const result = plan(deleteBodiesFeatureTranslator, "deleteBodies", [
      queryParameter("entities", ["A", "B"]),
      queryParameter("nonCompositeEntities", ["A", "B"]),
    ]);
    const feature = {
      featureId: "F_deleteBodies",
      featureType: "deleteBodies",
      parameters: [queryParameter("entities", ["A", "B"]), queryParameter("nonCompositeEntities", ["A", "B"])],
    } as OnshapeFeatureNode;
    expect(readTopologyQueryRefs(feature, result.plannedBodyTopologyConsumer!.slots).refs.map((entry) => entry.deterministicId)).toEqual(["A", "B"]);
  });

  test("maps XYZ translation aliases in millimeters and rejects rotation honestly", () => {
    const translated = plan(transformFeatureTranslator, "transform", [
      valueParameter("transformType", "TRANSLATION_3D"),
      queryParameter("entities", ["body"]),
      valueParameter("dx", 0, "25 mm"),
      valueParameter("dy", 0, "-2 cm"),
      valueParameter("dz", 0, "0 mm"),
      valueParameter("makeCopy", false),
    ]);
    expect(translated.plannedBodyTopologyConsumer).toMatchObject({
      featureKind: "transform",
      options: { vector: [25, -20, 0] },
      slots: [{ parameterId: "entities", role: "body" }],
    });
  });

  test("maps supported ROTATION about an earlier parametric sketch line", () => {
    const sketchFeatureId = "SKETCH_AXIS";
    const rotation = transformFeatureTranslator.plan({
      feature: {
        featureId: "F_transform",
        featureType: "transform",
        name: "Transform",
        parameters: [
          valueParameter("transformType", "ROTATION"),
          queryParameter("entities", ["body"]),
          {
            parameterId: "transformAxis",
            queries: [{ queryString: `qCreatedBy(id + "${sketchFeatureId}" + "wireOp", EntityType.EDGE)->qNthElement(0) /* axis_line */` }],
          },
          valueParameter("angle", 0, "90 deg"),
          valueParameter("oppositeDirectionEntity", true),
          valueParameter("makeCopy", false),
        ],
      } as OnshapeFeatureNode,
      label: "Transform",
      onshapeSuppressed: false,
      read: {
        features: [],
        solvedSketchesByFeatureId: new Map([[sketchFeatureId, {
          featureId: sketchFeatureId,
          entities: [{ entityId: "axis_line", entityType: "lineSegment", start3d: [0, 0, 0], end3d: [0.01, 0, 0] }],
          constraints: [],
        }]]),
      } as never,
      references: new Map(),
      state: {
        sketchPlansByFeatureId: new Map([[sketchFeatureId, { tier: "parametric", planeKey: "xy" }]]),
        bodyProducingFeatureIds: [],
      },
    });

    expect(rotation).toMatchObject({
      tier: "baked",
      reasonCodes: ["needs-history-probe"],
      plannedBodyTopologyConsumer: {
        featureKind: "transform",
        options: { transformType: "rotation", angle: -90 },
        staticParticipants: [{
          role: "axis",
          targets: [{ kind: "sketchEntityFromFeature", sketchFeatureId }],
        }],
        slots: [{ parameterId: "entities", role: "body" }],
      },
    });
  });

  test("bakes ROTATION when the axis is not a solved earlier sketch line", () => {
    const rotation = plan(transformFeatureTranslator, "transform", [
      valueParameter("transformType", "ROTATION"),
      queryParameter("entities", ["body"]),
      queryParameter("transformAxis", ["axisEdge"]),
      valueParameter("angle", 0, "90 deg"),
      valueParameter("oppositeDirection", false),
      valueParameter("makeCopy", false),
    ]);
    expect(rotation.tier).toBe("baked");
    expect(rotation.reasonCodes).toEqual(["transform-rotation-axis-unresolved"]);
    expect(rotation.plannedBodyTopologyConsumer).toBeUndefined();
  });

  test("reports an unreadable rotation angle before the axis blocker", () => {
    expect(
      plan(transformFeatureTranslator, "transform", [
        valueParameter("transformType", "ROTATION"),
        queryParameter("entities", ["body"]),
        queryParameter("transformAxis", ["axisEdge"]),
      ]).reasonCodes,
    ).toEqual(["transform-rotation-angle-unreadable"]);
  });

  test("accepts body-tool split and rejects active face-tool split", () => {
    const supported = plan(splitFeatureTranslator, "splitPart", [
      valueParameter("splitType", "PART"),
      valueParameter("keepBothSides", true),
      valueParameter("keepTools", false),
      queryParameter("targets", ["target"]),
      queryParameter("tool", ["tool"]),
    ]);
    expect(supported.plannedBodyTopologyConsumer).toMatchObject({
      featureKind: "split",
      options: { keepTools: false },
      slots: [
        { role: "targetBody", cardinality: { min: 1, max: 1 } },
        { role: "toolBody", cardinality: { min: 1, max: 1 } },
      ],
    });
    expect(plan(splitFeatureTranslator, "splitPart", [
      valueParameter("splitType", "PART"),
      queryParameter("faceTools", ["face"]),
    ]).reasonCodes).toEqual(["split-face-tool-unsupported"]);
  });

  test("maps a canonical datum mirror plane without requiring subtopology naming", () => {
    const references = new Map([["Top", [{
      deterministicId: "Top",
      evaluatedAt: "finalState" as const,
      signature: { entityClass: "face" as const, geometryType: "plane", definingData: { normal: [0, 0, 1] }, isDefaultPlane: true },
    }]]]);
    const result = plan(mirrorFeatureTranslator, "mirror", [
      valueParameter("patternType", "PART"),
      valueParameter("operationType", "NEW"),
      queryParameter("entities", ["body"]),
      queryParameter("mirrorPlane", ["Top"]),
    ], references);
    expect(result.plannedBodyTopologyConsumer).toMatchObject({
      featureKind: "mirror",
      options: { copy: true },
      staticParticipants: [{ role: "plane", targets: [{ kind: "construction", constructionId: "construction_plane-xy" }] }],
    });
  });

  test("retains exact FEATURE replay seeds and prepares the exact PART+ADD mirror", async () => {
    const source: ResolvedImportSource = {
      name: "wave-x-pattern-mirror.onshape-capture.json",
      origin: { kind: "localFile", fileName: "wave-x-pattern-mirror.onshape-capture.json" },
      mediaType: "application/json",
      bytes: new TextEncoder().encode(JSON.stringify(makeWaveXPatternMirrorCaptureBundle())),
      fingerprint: `sha256:${"b".repeat(64)}`,
    };
    const partAddCapabilities: ImportCapabilities = {
      ...providerCapabilities,
      history: {
        async evaluateHistoryProbe(input) {
          const signatures = [{
            entityClass: "body" as const,
            geometryType: "solid",
            boundingBox: { low: [0, 0, 0] as [number, number, number], high: [4, 4, 4] as [number, number, number] },
            centroid: [2, 2, 2] as [number, number, number],
            reference: { kind: "body" as const, bodyId: "body_part-1" as never },
          }];
          return {
            steps: Array.from(
              { length: Math.max(1, input.actions.orderedActions?.length ?? 0) },
              () => ({ status: "rebuilt" as const, signatures }),
            ),
          };
        },
      },
    };
    const review = await onshapeImportProvider.review({ source, capabilities: partAddCapabilities });
    const featurePatterns = review.providerReview.studios.find(
      (studio) => studio.elementId === "wave-x-feature-patterns",
    )?.featurePlans;
    expect(featurePatterns?.find((plan) => plan.onshapeFeatureId === "FNmvaMWuCDIXPZo_2")).toMatchObject({
      tier: "parametric",
      reasonCodes: [],
      inputFeatureIds: ["FOKYXKU0uqy9EB3_2"],
      plannedFeatureReplay: {
        kind: "linear",
        sourceFeatureIds: ["FOKYXKU0uqy9EB3_2"],
        instanceCount: 3,
        spacing: 40.2,
        oppositeDirection: true,
      },
    });
    expect(featurePatterns?.find((plan) => plan.onshapeFeatureId === "Fvk35GMOaMRxzg8_2")).toMatchObject({
      tier: "parametric",
      reasonCodes: [],
      inputFeatureIds: ["F2B5cy3xMm2MHNU_2"],
      plannedFeatureReplay: {
        kind: "linear",
        sourceFeatureIds: ["F2B5cy3xMm2MHNU_2"],
      },
    });
    expect(featurePatterns?.find((plan) => plan.onshapeFeatureId === "FtdzVK4Ok7Ghvzz_2")).toMatchObject({
      tier: "parametric",
      reasonCodes: [],
      inputFeatureIds: [
        "FOKYXKU0uqy9EB3_2",
        "FNmvaMWuCDIXPZo_2",
        "F2B5cy3xMm2MHNU_2",
        "Fvk35GMOaMRxzg8_2",
      ],
      plannedFeatureReplay: {
        kind: "mirror",
        sourceFeatureIds: [
          "FOKYXKU0uqy9EB3_2",
          "FNmvaMWuCDIXPZo_2",
          "F2B5cy3xMm2MHNU_2",
          "Fvk35GMOaMRxzg8_2",
        ],
      },
    });

    const featureReplayActions = await onshapeImportProvider.prepare({
      source,
      review,
      selections: { studioElementId: "wave-x-feature-patterns", demotedFeatureIds: [] },
      capabilities: partAddCapabilities,
    });
    expect(validateImportPreparedActions(featureReplayActions).success).toBe(true);
    const featureReplays = featureReplayActions.createFeatures?.filter(
      (action) => action.definition.kind === "featureReplay",
    );
    expect(featureReplays?.map((action) => action.definition.parameters.sourceFeatureIds)).toEqual([
      [{ kind: "featureOf", actionIndex: 3 }],
      [{ kind: "featureOf", actionIndex: 6 }],
      [
        { kind: "featureOf", actionIndex: 3 },
        { kind: "featureOf", actionIndex: 4 },
        { kind: "featureOf", actionIndex: 6 },
        { kind: "featureOf", actionIndex: 7 },
      ],
    ]);

    const partAddStudio = review.providerReview.studios.find(
      (studio) => studio.elementId === "wave-x-part-add-mirror",
    );
    expect(partAddStudio?.featurePlans).toEqual([expect.objectContaining({
      tier: "parametric",
      reasonCodes: [],
      plannedAdvancedSolid: expect.objectContaining({
        kind: "mirror",
        parameters: expect.objectContaining({ operationIntent: { source: "literal", value: "add" } }),
      }),
    })]);
    const actions = await onshapeImportProvider.prepare({
      source,
      review,
      selections: { studioElementId: "wave-x-part-add-mirror", demotedFeatureIds: [] },
      capabilities: partAddCapabilities,
    });
    const validation = validateImportPreparedActions(actions);
    expect(validation.success, JSON.stringify(validation)).toBe(true);
    expect(actions.createFeatures?.[0]?.definition).toMatchObject({
      kind: "mirror",
      parameters: {
        operationIntent: { source: "literal", value: "add" },
        participants: expect.arrayContaining([
          { role: "body", targets: [expect.objectContaining({ kind: "topologyOf", source: expect.objectContaining({ deterministicId: "BODY_SOURCE" }) })] },
          { role: "targetBody", targets: [expect.objectContaining({ kind: "topologyOf", source: expect.objectContaining({ deterministicId: "BODY_SOURCE" }) })] },
        ]),
      },
    });
  });


  test("plans translated cPlane references for mirror and distance transform", () => {
    const read = { features: [{ featureId: "OFFSET_PLANE", featureType: "cPlane" }] } as never;
    const contextPlan = (
      translator: OnshapeFeatureTranslator,
      featureType: string,
      parameterId: string,
    ) => translator.plan({
      feature: {
        featureId: `F_${featureType}`,
        featureType,
        name: featureType,
        parameters: [
          ...(featureType === "mirror"
            ? [valueParameter("patternType", "PART"), valueParameter("operationType", "NEW")]
            : [valueParameter("transformType", "TRANSLATION_BY_DISTANCE"), valueParameter("distance", 0, "5 mm")]),
          queryParameter("entities", ["body"]),
          {
            parameterId,
            queries: [{ queryString: 'query = qCreatedBy(id + "OFFSET_PLANE" + "planeOp", EntityType.FACE);' }],
          },
        ],
      } as OnshapeFeatureNode,
      label: featureType,
      onshapeSuppressed: false,
      read,
      references: new Map(),
      state: { sketchPlansByFeatureId: new Map(), bodyProducingFeatureIds: [] },
    });

    expect(contextPlan(mirrorFeatureTranslator, "mirror", "mirrorPlane").plannedBodyTopologyConsumer)
      .toMatchObject({ staticParticipants: [{ role: "plane", targets: [{ kind: "constructionFromFeature", featureId: "OFFSET_PLANE" }] }] });
    expect(contextPlan(transformFeatureTranslator, "transform", "transformDirection").plannedBodyTopologyConsumer)
      .toMatchObject({ staticParticipants: [{ role: "transformReference", targets: [{ kind: "constructionFromFeature", featureId: "OFFSET_PLANE" }] }] });
  });


  test("maps supported PART NEW linear and circular body patterns", () => {
    const references = new Map([["Top", [{
      deterministicId: "Top",
      evaluatedAt: "finalState" as const,
      signature: { entityClass: "face" as const, geometryType: "plane", definingData: { normal: [0, 0, 1] }, isDefaultPlane: true },
    }]]]);
    const linear = linearPatternFeatureTranslator.plan({
      feature: {
        featureId: "P_LINEAR",
        featureType: "linearPattern",
        name: "Linear",
        parameters: [
          valueParameter("patternType", "PART"),
          valueParameter("operationType", "NEW"),
          queryParameter("entities", ["body"]),
          {
            parameterId: "directionOne",
            queries: [{ queryString: 'qCreatedBy(id + "S_AXIS" + "wireOp", EntityType.EDGE)->qNthElement(0) /* axis_line */' }],
          },
          valueParameter("distance", 0, "10 mm"),
          valueParameter("instanceCount", 3),
          valueParameter("oppositeDirection", true),
          valueParameter("isCentered", false),
          valueParameter("hasSecondDir", false),
          valueParameter("skipInstances", false),
        ],
      } as OnshapeFeatureNode,
      label: "Linear",
      onshapeSuppressed: false,
      read: {
        features: [
          { featureId: "S_AXIS", featureType: "newSketch", parameters: [] },
          { featureId: "P_LINEAR", featureType: "linearPattern", parameters: [] },
        ],
        solvedSketchesByFeatureId: new Map([["S_AXIS", {
          featureId: "S_AXIS",
          entities: [{ entityId: "axis_line", entityType: "lineSegment", start3d: [0, 0, 0], end3d: [0.01, 0, 0] }],
        }]]),
      } as never,
      references,
      state: { sketchPlansByFeatureId: new Map([["S_AXIS", { tier: "parametric", planeKey: "xy" }]]), bodyProducingFeatureIds: [] },
    });
    expect(linear).toMatchObject({
      reasonCodes: ["needs-history-probe"],
      inputDependencies: [
        { kind: "query", parameterId: "entities", slotKey: "bodies" },
        { kind: "sketch", featureId: "S_AXIS" },
      ],
      plannedBodyTopologyConsumer: {
        featureKind: "linearPattern",
        options: { instanceCount: 3, spacing: 10, centered: false, oppositeDirection: true },
        slots: [{ key: "bodies", parameterId: "entities", role: "body", expectedKinds: ["body"] }],
        staticParticipants: [{ role: "direction", targets: [{ kind: "sketchEntityFromFeature", sketchFeatureId: "S_AXIS" }] }],
      },
    });

    const circular = plan(circularPatternFeatureTranslator, "circularPattern", [
      valueParameter("patternType", "PART"),
      valueParameter("operationType", "NEW"),
      queryParameter("entities", ["body"]),
      queryParameter("axis", ["Top"]),
      valueParameter("angle", Math.PI * 2),
      valueParameter("instanceCount", 4),
      valueParameter("oppositeDirection", false),
      valueParameter("equalSpace", true),
      valueParameter("isCentered", false),
      valueParameter("skipInstances", false),
    ], references);
    expect(circular.plannedBodyTopologyConsumer).toMatchObject({
      featureKind: "circularPattern",
      options: { instanceCount: 4, angleDegrees: 360, equalSpace: true, oppositeDirection: false },
      slots: [{ key: "bodies", parameterId: "entities", role: "body", expectedKinds: ["body"] }],
      staticParticipants: [{ role: "axis", targets: [{ kind: "construction", constructionId: "construction_plane-xy" }] }],
    });
  });

  test("reports exact pattern reason codes for unsupported branches", () => {
    const validLinear = [
      valueParameter("patternType", "PART"),
      valueParameter("operationType", "NEW"),
      queryParameter("entities", ["body"]),
      queryParameter("directionOne", ["missing"]),
      valueParameter("distance", 0, "10 mm"),
      valueParameter("instanceCount", 3),
    ];
    const reason = (parameters: unknown[]) => plan(linearPatternFeatureTranslator, "linearPattern", parameters).reasonCodes;
    expect(reason([valueParameter("patternType", "FACE")])).toEqual(["pattern-type-unsupported"]);
    expect(reason([valueParameter("patternType", "FEATURE")])).toEqual(["pattern-feature-seed-unsupported"]);
    expect(reason([valueParameter("patternType", "PART"), valueParameter("operationType", "ADD")])).toEqual(["pattern-operation-unsupported"]);
    expect(reason([valueParameter("patternType", "PART"), valueParameter("operationType", "NEW")])).toEqual(["pattern-seed-unresolved"]);
    expect(reason([...validLinear, valueParameter("hasSecondDir", true)])).toEqual(["pattern-second-direction-unsupported"]);
    expect(reason([...validLinear, valueParameter("isCentered", true)])).toEqual(["pattern-centered-unsupported"]);
    expect(reason([...validLinear, queryParameter("skipInstances", ["skip"])] )).toEqual(["pattern-skipping-unsupported"]);
    expect(reason(validLinear.filter((entry) => (entry as { parameterId?: string }).parameterId !== "instanceCount"))).toEqual(["pattern-count-unreadable"]);
    expect(reason(validLinear.filter((entry) => (entry as { parameterId?: string }).parameterId !== "distance"))).toEqual(["pattern-spacing-unreadable"]);
    expect(reason(validLinear)).toEqual(["pattern-direction-unresolved"]);

    const circularReason = (parameters: unknown[]) => plan(circularPatternFeatureTranslator, "circularPattern", parameters).reasonCodes;
    expect(circularReason([
      valueParameter("patternType", "PART"),
      valueParameter("operationType", "NEW"),
      queryParameter("entities", ["body"]),
      queryParameter("axis", ["missing"]),
      valueParameter("angle", 0),
      valueParameter("instanceCount", 4),
    ])).toEqual(["pattern-angle-unreadable"]);
    expect(circularReason([
      valueParameter("patternType", "PART"),
      valueParameter("operationType", "NEW"),
      queryParameter("entities", ["body"]),
      queryParameter("axis", ["missing"]),
      valueParameter("angle", Math.PI / 2),
      valueParameter("instanceCount", 4),
    ])).toEqual(["pattern-axis-unresolved"]);
  });

  test("provider reviews and prepares pattern fixtures with deferred bodies, refs, and authored boolean wrappers", async () => {
    const source: ResolvedImportSource = {
      name: "wave-w-pattern.onshape-capture.json",
      origin: { kind: "localFile", fileName: "wave-w-pattern.onshape-capture.json" },
      mediaType: "application/json",
      bytes: new TextEncoder().encode(JSON.stringify(makeWaveWPatternCaptureBundle())),
      fingerprint: `sha256:${"b".repeat(64)}`,
    };
    const patternCapabilities: ImportCapabilities = {
      ...providerCapabilities,
      modeling: {
        ...providerCapabilities.modeling,
        async bakeGeometry({ bytes }: { bytes: Uint8Array }) {
          return { assetId: "asset_pattern_checkpoint", format: "baked-mesh" as const, hash: `sha256:${"c".repeat(64)}`, byteLength: bytes.byteLength };
        },
      },
      history: {
        async evaluateHistoryProbe(input) {
          const signatures = [
            { entityClass: "body" as const, geometryType: "solid", boundingBox: { low: [0, 0, 0] as [number, number, number], high: [2, 2, 2] as [number, number, number] }, centroid: [1, 1, 1] as [number, number, number], reference: { kind: "body" as const, bodyId: "probe_linear" as never } },
            { entityClass: "body" as const, geometryType: "solid", boundingBox: { low: [10, -1, 0] as [number, number, number], high: [12, 1, 2] as [number, number, number] }, centroid: [11, 0, 1] as [number, number, number], reference: { kind: "body" as const, bodyId: "probe_circular" as never } },
          ];
          return { steps: (input.actions.orderedActions ?? []).map(() => ({ status: "rebuilt" as const, signatures })) };
        },
      },
    };
    const review = await onshapeImportProvider.review({ source, capabilities: patternCapabilities });
    const plans = review.providerReview.studios.flatMap((studio) => studio.featurePlans);
    expect(plans.filter((plan) => plan.featureType.includes("Pattern")).map((plan) => [plan.featureType, plan.tier, plan.reasonCodes])).toEqual([
      ["linearPattern", "parametric", []],
      ["circularPattern", "parametric", []],
    ]);

    const linearActions = await onshapeImportProvider.prepare({
      source,
      review,
      selections: { studioElementId: "wave-w-pattern-linear", demotedFeatureIds: [] },
      capabilities: patternCapabilities,
    });
    const linear = linearActions.createFeatures?.find((action) => action.definition.kind === "linearPattern");
    expect(linear?.definition.kind).toBe("linearPattern");
    const linearParameters = linear?.definition.kind === "linearPattern" ? linear.definition.parameters : null;
    expect(linearParameters?.participants).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "body", targets: [expect.objectContaining({ kind: "topologyOf", expectedKind: "body" })] }),
      expect.objectContaining({ role: "direction", targets: [expect.objectContaining({ kind: "sketchEntity", sketchId: expect.objectContaining({ kind: "sketchIdOf" }) })] }),
    ]));
    expect(linearParameters?.options).toMatchObject({
      instanceCount: { source: "literal", value: 3 },
      spacing: { source: "literal", value: 10 },
      centered: { source: "literal", value: false },
      oppositeDirection: { source: "literal", value: false },
    });

    const circularActions = await onshapeImportProvider.prepare({
      source,
      review,
      selections: { studioElementId: "wave-w-pattern-circular", demotedFeatureIds: [] },
      capabilities: patternCapabilities,
    });
    const circular = circularActions.createFeatures?.find((action) => action.definition.kind === "circularPattern");
    expect(circular?.definition.kind).toBe("circularPattern");
    const circularParameters = circular?.definition.kind === "circularPattern" ? circular.definition.parameters : null;
    expect(circularParameters?.participants).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "body", targets: [expect.objectContaining({ kind: "topologyOf", expectedKind: "body" })] }),
      expect.objectContaining({ role: "axis", targets: [expect.objectContaining({ kind: "construction", constructionId: "construction_plane-xy" })] }),
    ]));
    expect(circularParameters?.options).toMatchObject({
      instanceCount: { source: "literal", value: 4 },
      angleDegrees: { source: "literal", value: 360 },
      equalSpace: { source: "literal", value: true },
      oppositeDirection: { source: "literal", value: false },
    });
  });

  test("provider promotes mirror across a captured-frame cPlane and emits constructionOf", async () => {
    const source = mirrorSource();
    const review = await onshapeImportProvider.review({ source, capabilities: providerCapabilities });
    const studio = review.providerReview.studios[0]!;
    expect(studio.tierCounts).toEqual({ parametric: 5, baked: 0, geometryOnly: 0 });
    expect(studio.bakeStrategy).toEqual({ kind: "none" });
    expect(studio.featurePlans.find((candidate) => candidate.featureType === "cPlane")).toMatchObject({
      tier: "parametric",
      reasonCodes: ["plane-from-captured-frame"],
    });
    expect(studio.featurePlans.find((candidate) => candidate.featureType === "mirror")).toMatchObject({
      tier: "parametric",
      reasonCodes: [],
    });

    const actions = await onshapeImportProvider.prepare({
      source,
      review,
      selections: onshapeImportProvider.createDefaultSelections(review),
      capabilities: providerCapabilities,
    });
    const validation = validateImportPreparedActions(actions);
    expect(validation.success, JSON.stringify(validation)).toBe(true);
    const mirror = actions.createFeatures?.find((candidate) => candidate.definition.kind === "mirror");
    expect(mirror?.definition).toMatchObject({
      kind: "mirror",
      parameters: {
        participants: expect.arrayContaining([
          { role: "plane", targets: [{ kind: "constructionOf", actionIndex: 2 }] },
        ]),
      },
    });
  });

  test("prepares a variable-linked chamfer and an implicit UNION only from one remaining prefix body", async () => {
    const source: ResolvedImportSource = {
      name: "wave-x-chamfer-union.onshape-capture.json",
      origin: { kind: "localFile", fileName: "wave-x-chamfer-union.onshape-capture.json" },
      mediaType: "application/json",
      bytes: new TextEncoder().encode(JSON.stringify(makeWaveXChamferAndImplicitUnionCaptureBundle())),
      fingerprint: `sha256:${"x".repeat(64)}`,
    };
    const liveBody = (bodyId: string, x: number) => ({
      entityClass: "body" as const,
      geometryType: "solid",
      boundingBox: { low: [x, 0, 0] as [number, number, number], high: [x + 1, 1, 1] as [number, number, number] },
      centroid: [x + 0.5, 0.5, 0.5] as [number, number, number],
      reference: { kind: "body" as const, bodyId: bodyId as never },
    });
    const capabilities: ImportCapabilities = {
      ...providerCapabilities,
      history: {
        async evaluateHistoryProbe(input) {
          const signatures = [
            { entityClass: "edge" as const, geometryType: "line", definingData: { origin: [0, 0, 0], direction: [1, 0, 0] }, reference: { kind: "edge" as const, bodyId: "body_target" as never, edgeId: "edge_live" as never } },
            liveBody("body_target", 0),
            liveBody("body_tool_a", 1),
            liveBody("body_tool_b", 2),
            liveBody("body_tool_c", 3),
            liveBody("body_tool_d", 4),
          ];
          return { steps: (input.actions.orderedActions ?? []).map(() => ({ status: "rebuilt" as const, signatures })) };
        },
      },
    };
    const review = await onshapeImportProvider.review({ source, capabilities });
    const studio = review.providerReview.studios[0]!;
    expect(studio.tierCounts).toEqual({ parametric: 3, baked: 0, geometryOnly: 0 });
    expect(studio.bakeStrategy).toEqual({ kind: "none" });

    const actions = await onshapeImportProvider.prepare({
      source,
      review,
      selections: onshapeImportProvider.createDefaultSelections(review),
      capabilities,
    });
    expect(actions.addDocumentVariables?.[0]).toMatchObject({ name: "Wall", valueText: "5" });
    const chamfer = actions.createFeatures?.find((request) => request.definition.kind === "chamfer");
    expect(chamfer?.definition).toMatchObject({
      kind: "chamfer",
      parameters: { options: { distance: { source: "expression", valueText: "Wall*(4/5)" } } },
    });
    const union = actions.createFeatures?.find((request) => request.definition.kind === "combine");
    expect(union?.definition).toMatchObject({
      kind: "combine",
      parameters: {
        participants: expect.arrayContaining([
          { role: "targetBody", targets: [expect.objectContaining({ kind: "topologyOf", source: expect.objectContaining({ deterministicId: "implicit-union-target:body_target" }) })] },
          { role: "toolBody", targets: expect.arrayContaining([expect.objectContaining({ kind: "topologyOf" })]) },
        ]),
      },
    });
  });

  test("preserves an expression-authored chamfer width through planning", () => {
    const chamfer = plan(chamferFeatureTranslator, "chamfer", [
      queryParameter("entities", ["edge"]),
      valueParameter("chamferMethod", "FACE_OFFSET"),
      valueParameter("chamferType", "EQUAL_OFFSETS"),
      valueParameter("width", 0, "#Wall*(4/5)"),
    ]);
    expect(chamfer.plannedBodyTopologyConsumer?.options).toEqual({
      widthForm: "equalOffsets",
      distance: { source: "expression", valueText: "Wall*(4/5)" },
    });
    const definition = buildResolvedBodyConsumerDefinition(
      chamfer.plannedBodyTopologyConsumer!,
      [{
        query: { consumerFeatureId: "CHAMFER", slotKey: "edgeTargets", parameterId: "entities", queryIndex: 0, deterministicId: "edge", queryString: null, expectedKinds: ["edge"] },
        reviewReference: { kind: "edge", bodyId: "body" as never, edgeId: "edge" as never },
        deferred: { kind: "topologyOf", expectedKind: "edge", capturedSignature: { entityClass: "edge", geometryType: "line" }, tolerance: { linear: 0.01, angularRadians: 0.001, relative: 0.000001, ambiguityMargin: 0.000001 }, source: { consumerFeatureId: "CHAMFER", parameterId: "entities", deterministicId: "edge" } },
        score: 0,
        evidence: [],
        sourceEvidence: "historyPoint" as const,
      }],
    );
    expect(definition).toMatchObject({
      kind: "chamfer",
      parameters: { options: { distance: { source: "expression", valueText: "Wall*(4/5)" } } },
    });
  });

  test("maps the real equal-offset chamfer envelope to the executor's distance-only contract", () => {
    const fillet = plan(filletFeatureTranslator, "fillet", [valueParameter("radius", 0, "2.5 mm"), queryParameter("entities", ["edge"]) ]);
    expect(fillet).toMatchObject({
      reasonCodes: ["needs-history-probe"],
      plannedBodyTopologyConsumer: { featureKind: "fillet", radius: 2.5, slots: [{ parameterId: "entities", role: "edge", expectedKinds: ["edge"] }] },
    });
    const chamfer = plan(chamferFeatureTranslator, "chamfer", [
      queryParameter("entities", ["JNB"]),
      valueParameter("chamferMethod", "FACE_OFFSET"),
      valueParameter("chamferType", "EQUAL_OFFSETS"),
      valueParameter("width", 0, "15 mm"),
      valueParameter("width1", 0, "5 mm"),
      valueParameter("oppositeDirection", false),
      valueParameter("width2", 0, "5 mm"),
      valueParameter("angle", 0, "45 deg"),
      queryParameter("directionOverrides", []),
      valueParameter("tangentPropagation", true),
    ]);
    expect(chamfer).toMatchObject({
      reasonCodes: ["needs-history-probe"],
      plannedBodyTopologyConsumer: {
        featureKind: "chamfer",
        options: { widthForm: "equalOffsets", distance: 15 },
        slots: [{ parameterId: "entities", role: "edge", expectedKinds: ["edge"] }],
      },
    });
    expect(chamfer.plannedBodyTopologyConsumer?.options).toEqual({
      widthForm: "equalOffsets",
      distance: 15,
    });
  });

  test("accepts supported chamfer width forms and rejects only inexpressible method/style combinations", () => {
    const equalOffsets = plan(chamferFeatureTranslator, "chamfer", [
      queryParameter("entities", ["edge"]),
      valueParameter("chamferMethod", "FACE_OFFSET"),
      valueParameter("chamferStyle", "EQUAL_OFFSETS"),
      valueParameter("width", 0, "2.5 mm"),
    ]);
    expect(equalOffsets.plannedBodyTopologyConsumer?.options).toEqual({
      widthForm: "equalOffsets",
      distance: 2.5,
    });

    const twoOffsets = plan(chamferFeatureTranslator, "chamfer", [
      queryParameter("entities", ["edge"]),
      valueParameter("chamferMethod", "FACE_OFFSET"),
      valueParameter("chamferStyle", "TWO_OFFSETS"),
      valueParameter("width1", 0, "3 mm"),
      valueParameter("width2", 0, "5 mm"),
    ]);
    expect(twoOffsets.plannedBodyTopologyConsumer?.options).toEqual({
      widthForm: "twoOffsets",
      distance1: 3,
      distance2: 5,
    });

    const offsetAngle = plan(chamferFeatureTranslator, "chamfer", [
      queryParameter("entities", ["edge"]),
      valueParameter("chamferMethod", "FACE_OFFSET"),
      valueParameter("chamferStyle", "OFFSET_ANGLE"),
      valueParameter("width", 0, "4 mm"),
      valueParameter("angle", 0, "30 deg"),
    ]);
    expect(offsetAngle.plannedBodyTopologyConsumer?.options).toEqual({
      widthForm: "offsetAngle",
      distance: 4,
      angle: 30,
    });

    expect(plan(chamferFeatureTranslator, "chamfer", [
      valueParameter("chamferMethod", "EDGE_OFFSET"),
      valueParameter("chamferStyle", "EQUAL_OFFSETS"),
    ]).reasonCodes).toEqual(["chamfer-method-unsupported"]);
    expect(plan(chamferFeatureTranslator, "chamfer", [
      valueParameter("chamferMethod", "FACE_OFFSET"),
      valueParameter("chamferStyle", "VERTEX"),
    ]).reasonCodes).toEqual(["chamfer-style-unsupported"]);
    expect(plan(chamferFeatureTranslator, "chamfer", [
      valueParameter("chamferMethod", "FACE_OFFSET"),
      valueParameter("chamferStyle", "OFFSET_ANGLE"),
      valueParameter("width", 0, "2 mm"),
      valueParameter("angle", 0, "90 deg"),
    ]).reasonCodes).toEqual(["chamfer-width-unreadable"]);
  });

  test("maps shell openings, closed hollows, and whole-solid offsets exactly", () => {
    const shell = plan(shellFeatureTranslator, "shell", [
      valueParameter("isHollow", true), queryParameter("parts", ["body"]), queryParameter("entities", ["face"]),
      valueParameter("thickness", 0, "2.5 mm"), valueParameter("oppositeDirection", false),
    ]);
    expect(shell.plannedBodyTopologyConsumer).toMatchObject({ featureKind: "shell", thickness: 2.5, direction: "inside", slots: [{ parameterId: "parts", role: "body" }, { parameterId: "entities", role: "face" }] });

    const realRootCaptureEnvelope = [
      valueParameter("isHollow", true),
      queryParameter("entities", []),
      queryParameter("parts", ["JND"]),
      valueParameter("thickness", 0, "2.5 mm"),
      valueParameter("oppositeDirection", false),
    ];
    const closedHollow = plan(shellFeatureTranslator, "shell", realRootCaptureEnvelope);
    expect(closedHollow.plannedBodyTopologyConsumer).toMatchObject({
      featureKind: "shell",
      shellMode: "closedHollow",
      thickness: 2.5,
      direction: "inside",
      slots: [{ parameterId: "parts", role: "body", cardinality: { min: 1, max: 1 } }],
    });

    expect(plan(shellFeatureTranslator, "shell", [
      ...realRootCaptureEnvelope.slice(0, 4),
      valueParameter("oppositeDirection", true),
    ]).reasonCodes).toEqual(["shell-closed-hollow-direction-unsupported"]);

    const nonHollowOffsetAllFaces = plan(shellFeatureTranslator, "shell", [
      valueParameter("isHollow", false),
      queryParameter("entities", []),
      queryParameter("parts", ["body"]),
      valueParameter("thickness", 0, "2.5 mm"),
      valueParameter("oppositeDirection", false),
    ]);
    expect(nonHollowOffsetAllFaces.plannedBodyTopologyConsumer).toMatchObject({
      featureKind: "shell",
      shellMode: "offsetAllFaces",
      thickness: 2.5,
      direction: "inside",
      slots: [{ parameterId: "parts", role: "body" }],
    });

    const selectedFaceNonHollow = [
      valueParameter("isHollow", false),
      queryParameter("entities", ["face"]),
      queryParameter("parts", ["body"]),
      valueParameter("thickness", 0, "2.5 mm"),
      valueParameter("oppositeDirection", false),
    ];
    expect(plan(shellFeatureTranslator, "shell", selectedFaceNonHollow).reasonCodes).toEqual(["shell-non-hollow-unsupported"]);
  });

  test("maps one-face NEW thicken to a capability-gated topology consumer", () => {
    const thicken = plan(thickenFeatureTranslator, "thicken", [
      valueParameter("operationType", "NEW"),
      queryParameter("entities", ["face"]),
      valueParameter("thickness", 0, "2.5 mm"),
      valueParameter("oppositeDirection", true),
    ]);
    expect(thicken).toMatchObject({
      reasonCodes: ["needs-history-probe"],
      plannedBodyTopologyConsumer: {
        featureKind: "thicken",
        operationIntent: "create",
        options: {
          thickness: 2.5,
          side: "oneSide",
          direction: "negative",
        },
        slots: [{ parameterId: "entities", expectedKinds: ["face"] }],
      },
    });

    expect(plan(thickenFeatureTranslator, "thicken", [
      valueParameter("operationType", "NEW"),
      queryParameter("entities", ["face"]),
      valueParameter("thickness", 0, "2.5 mm"),
      valueParameter("midplane", true),
    ]).reasonCodes).toEqual(["thicken-requires-topology"]);
  });

  test("maps supported hole styles, aliases, termination, direction, and sketch-point locations", () => {
    const simple = planHole([
      valueParameter("style", "SIMPLE"),
      valueParameter("holeDiameterV2", 0, "6 mm"),
      valueParameter("endStyle", "BLIND"),
      valueParameter("holeDepth", 0, "10 mm"),
      valueParameter("oppositeDirection", true),
    ]);
    expect(simple).toMatchObject({
      reasonCodes: ["needs-history-probe"],
      inputDependencies: [{ kind: "query", slotKey: "scope" }, { kind: "sketch", featureId: "SKETCH_LOC" }],
      inputFeatureIds: ["SKETCH_LOC"],
      plannedBodyTopologyConsumer: {
        featureKind: "hole",
        options: {
          style: "simple",
          mainDiameter: 6,
          termination: "blind",
          depth: 10,
          direction: "reverse",
        },
        staticParticipants: [{ role: "location", targets: [{ kind: "sketchPointFromFeature", sketchFeatureId: "SKETCH_LOC" }] }],
        slots: [{ key: "scope", parameterId: "scope", role: "body", expectedKinds: ["body"] }],
      },
    });

    const counterbore = planHole([
      valueParameter("styleV2", "C_BORE"),
      valueParameter("holeDiameterV3", 0, "4 mm"),
      valueParameter("endStyleV2", "THROUGH"),
      valueParameter("cBoreDiameter", 0, "7 mm"),
      valueParameter("cBoreDepthV3", 0, "2 mm"),
    ]);
    expect(counterbore.plannedBodyTopologyConsumer?.options).toMatchObject({
      style: "counterbore",
      mainDiameter: 4,
      termination: "throughAll",
      counterboreDiameter: 7,
      counterboreDepth: 2,
      direction: "forward",
    });

    const countersink = planHole([
      valueParameter("styleV2", "C_SINK"),
      valueParameter("holeDiameterV3", 0, "3 mm"),
      valueParameter("endStyleV2", "THROUGH"),
      valueParameter("cSinkDiameter", 0, "6 mm"),
      valueParameter("cSinkAngleV3", Math.PI / 2),
    ]);
    expect(countersink.plannedBodyTopologyConsumer?.options).toMatchObject({
      style: "countersink",
      countersinkDiameter: 6,
      countersinkAngleDegrees: 90,
    });
  });

  test("reports exact hole reason codes for unresolved and unsupported forms", () => {
    expect(planHole([
      valueParameter("styleV2", "SIMPLE"),
      valueParameter("holeDiameterV3", 0, "4 mm"),
      valueParameter("endStyleV2", "BLIND"),
    ]).reasonCodes).toEqual(["hole-depth-unreadable"]);

    expect(planHole([
      valueParameter("styleV2", "C_BORE"),
      valueParameter("holeDiameterV3", 0, "4 mm"),
      valueParameter("endStyleV2", "THROUGH"),
      valueParameter("cBoreDiameterV3", 0, "7 mm"),
    ]).reasonCodes).toEqual(["hole-counterbore-parameters-unreadable"]);

    expect(planHole([
      valueParameter("styleV2", "C_SINK"),
      valueParameter("holeDiameterV3", 0, "4 mm"),
      valueParameter("endStyleV2", "THROUGH"),
      valueParameter("cSinkDiameterV3", 0, "7 mm"),
    ]).reasonCodes).toEqual(["hole-countersink-parameters-unreadable"]);

    expect(planHole([
      valueParameter("styleV2", "SIMPLE"),
      valueParameter("holeDiameterV3", 0, "4 mm"),
      valueParameter("endStyleV2", "UP_TO_NEXT"),
    ]).reasonCodes).toEqual(["hole-termination-unsupported"]);

    expect(planHole([
      valueParameter("styleV2", "SIMPLE"),
      valueParameter("holeDiameterV3", 0, "4 mm"),
      valueParameter("endStyleV2", "THROUGH"),
      valueParameter("threaded", true),
    ]).reasonCodes).toEqual(["hole-thread-unsupported"]);

    expect(planHole([
      valueParameter("styleV2", "SIMPLE"),
      valueParameter("holeDiameterV3", 0, "4 mm"),
      valueParameter("endStyleV2", "THROUGH"),
    ], { queryText: "query = qCreatedBy(id + \"OTHER_SKETCH\" + \"pointOp\", EntityType.VERTEX);" }).reasonCodes).toEqual(["hole-location-unresolved"]);

    expect(planHole([
      valueParameter("styleV2", "SIMPLE"),
      valueParameter("holeDiameterV3", 0, "4 mm"),
      valueParameter("endStyleV2", "THROUGH"),
    ], { queryText: "query = qCreatedBy(id + \"SKETCH_LOC\" + \"pointOp\", EntityType.VERTEX);", pointIds: ["POINT_A", "POINT_B"] }).reasonCodes).toEqual(["hole-location-unresolved"]);
  });

  test("gate-flip readiness resolves synthetic v2 edge evidence into fillet and chamfer deferred positions", () => {
    const input = {
      consumerFeatureId: "consumer",
      queries: [{ consumerFeatureId: "consumer", slotKey: "edgeTargets", parameterId: "entities", queryIndex: 0, deterministicId: "edge", queryString: null, expectedKinds: ["edge"] as const }],
      capturedReferences: [{ deterministicId: "edge", evaluatedAt: "historyPoint" as const, consumingFeatureId: "consumer", signature: { entityClass: "edge" as const, geometryType: "line", definingData: { origin: [0, 0, 0] as [number, number, number], direction: [1, 0, 0] as [number, number, number] } } }],
      rollback: createRollbackTopologyTimeline({ featureIds: ["consumer"], snapshots: [] }),
      cadaraSignatures: [{ entityClass: "edge" as const, geometryType: "line", definingData: { origin: [0, 0, 0], direction: [1, 0, 0] }, reference: { kind: "edge" as const, bodyId: "body" as never, edgeId: "live" as never } }],
      tolerance: { linear: 0.01, angularRadians: 0.001, relative: 0.000001, ambiguityMargin: 0.000001 },
    };
    expect(resolveTopologyReferences({ ...input, durableNamingAvailable: false })).toMatchObject({
      kind: "degraded",
      reason: "topology-durable-naming-unavailable",
    });

    const resolution = resolveTopologyReferences({
      ...input,
      durableNamingAvailable: true, // mocked capability flip; source evidence is v2 history-point evidence.
    });
    expect(resolution.kind).toBe("resolved");
    if (resolution.kind !== "resolved") return;
    const fillet = buildResolvedBodyConsumerDefinition({ featureKind: "fillet", radius: 2, slots: [{ key: "edgeTargets", parameterId: "entities", role: "edge", expectedKinds: ["edge"], cardinality: { min: 1, max: null } }] }, resolution.bindings);
    const chamfer = buildResolvedBodyConsumerDefinition({ featureKind: "chamfer", options: { widthForm: "twoOffsets", distance1: 2, distance2: 3 }, slots: [{ key: "edgeTargets", parameterId: "entities", role: "edge", expectedKinds: ["edge"], cardinality: { min: 1, max: null } }] }, resolution.bindings);
    expect(fillet).toMatchObject({ kind: "fillet", parameters: { edgeTargets: [{ kind: "topologyOf", expectedKind: "edge" }] } });
    expect(chamfer).toMatchObject({ kind: "chamfer", parameters: { participants: [{ role: "edge", targets: [{ kind: "topologyOf", expectedKind: "edge" }] }] } });
    expect(chamfer).toMatchObject({
      kind: "chamfer",
      parameters: {
        options: {
          widthForm: { source: "literal", value: "twoOffsets" },
          distance1: { source: "literal", value: 2 },
          distance2: { source: "literal", value: 3 },
        },
      },
    });
    expect(validateFeatureDefinitionAuthoredValueInvariants(chamfer).map((issue) => issue.message)).toEqual([]);

    const shellBodyBinding = {
      query: {
        consumerFeatureId: "consumer",
        slotKey: "bodyTarget",
        parameterId: "parts",
        queryIndex: 0,
        deterministicId: "body",
        queryString: null,
        expectedKinds: ["body" as const],
      },
      reviewReference: { kind: "body" as const, bodyId: "body" as never },
      deferred: {
        kind: "topologyOf" as const,
        expectedKind: "body" as const,
        capturedSignature: { entityClass: "body" as const, geometryType: "unknown" as const },
        tolerance: { linear: 0.01, angularRadians: 0.001, relative: 0.000001, ambiguityMargin: 0.000001 },
        source: { consumerFeatureId: "consumer", parameterId: "parts", deterministicId: "body" },
      },
      score: 0,
      evidence: [],
      sourceEvidence: "historyPoint" as const,
    };
    const holeBodyBinding = {
      ...shellBodyBinding,
      query: { ...shellBodyBinding.query, slotKey: "scope", parameterId: "scope" },
      deferred: {
        ...shellBodyBinding.deferred,
        source: { consumerFeatureId: "consumer", parameterId: "scope", deterministicId: "body" },
      },
    };
    const hole = buildResolvedBodyConsumerDefinition({
      featureKind: "hole",
      options: {
        style: "counterbore",
        mainDiameter: 4,
        counterboreDiameter: 8,
        counterboreDepth: 2,
        termination: "blind",
        depth: 6,
        direction: "reverse",
      },
      staticParticipants: [{ role: "location", targets: [{ kind: "sketchPointFromFeature", sketchFeatureId: "SKETCH_LOC", pointId: "POINT_LOC" as never }] }],
      slots: [{ key: "scope", parameterId: "scope", role: "body", expectedKinds: ["body"], cardinality: { min: 1, max: null } }],
    }, [holeBodyBinding]);
    const resolvedHole = resolvePlannedDeferredParticipants(hole, new Map([["SKETCH_LOC", 0]]));
    expect(resolvedHole.missingFeatureId).toBeNull();
    expect(JSON.stringify(resolvedHole.definition)).not.toContain("sketchPointFromFeature");
    expect(resolvedHole.definition).toMatchObject({
      kind: "hole",
      parameters: {
        options: {
          style: { source: "literal", value: "counterbore" },
          mainDiameter: { source: "literal", value: 4 },
          termination: { source: "literal", value: "blind" },
        },
        participants: [
          { role: "body", targets: [{ kind: "topologyOf", expectedKind: "body" }] },
          { role: "location", targets: [{ kind: "sketchPoint", sketchId: { kind: "sketchIdOf", actionIndex: 0 } }] },
        ],
      },
    });
    if (!resolvedHole.definition || resolvedHole.definition.kind !== "hole") throw new Error("Expected resolved hole definition");
    const materializedHole = {
      ...resolvedHole.definition,
      parameters: {
        ...resolvedHole.definition.parameters,
        participants: resolvedHole.definition.parameters.participants.map((participant) => ({
          ...participant,
          targets: participant.targets.map((target) => {
            if (target.kind === "topologyOf") return { kind: "body" as const, bodyId: "live_body" as never };
            if (target.kind === "sketchPoint" && typeof target.sketchId !== "string") {
              return { ...target, sketchId: "live_sketch" as never };
            }
            return target;
          }),
        })),
      },
    };
    expect(JSON.stringify(materializedHole)).not.toContain("topologyOf");
    expect(JSON.stringify(materializedHole)).not.toContain("sketchIdOf");
    expect(validateAdvancedSolidFeatureDefinition(materializedHole as never, holeAdvancedDescriptor)).toEqual([]);
    const shellClosedHollow = buildResolvedBodyConsumerDefinition({
      featureKind: "shell",
      shellMode: "closedHollow",
      thickness: 2.5,
      direction: "inside",
      slots: [{ key: "bodyTarget", parameterId: "parts", role: "body", expectedKinds: ["body"], cardinality: { min: 1, max: 1 } }],
    }, [shellBodyBinding]);
    expect(shellClosedHollow).toMatchObject({
      kind: "shell",
      parameters: {
        mode: "closedHollow",
        bodyTarget: { kind: "topologyOf", expectedKind: "body" },
        faceTargets: [],
        thickness: { source: "literal", value: 2.5 },
        direction: "inside",
      },
    });

    const shellOffset = buildResolvedBodyConsumerDefinition({
      featureKind: "shell",
      shellMode: "offsetAllFaces",
      thickness: 2.5,
      direction: "inside",
      slots: [{ key: "bodyTarget", parameterId: "parts", role: "body", expectedKinds: ["body"], cardinality: { min: 1, max: 1 } }],
    }, [shellBodyBinding]);
    expect(shellOffset).toMatchObject({
      kind: "shell",
      parameters: {
        mode: "offsetAllFaces",
        bodyTarget: { kind: "topologyOf", expectedKind: "body" },
        faceTargets: [],
        thickness: { source: "literal", value: 2.5 },
      },
    });

    const faceResolution = resolveTopologyReferences({
      ...input,
      queries: [{
        consumerFeatureId: "consumer",
        slotKey: "faceTargets",
        parameterId: "entities",
        queryIndex: 0,
        deterministicId: "face",
        queryString: null,
        expectedKinds: ["face"] as const,
      }],
      capturedReferences: [{
        deterministicId: "face",
        evaluatedAt: "historyPoint" as const,
        consumingFeatureId: "consumer",
        signature: {
          entityClass: "face" as const,
          geometryType: "plane",
          definingData: { origin: [0, 0, 0], normal: [0, 0, 1] },
        },
      }],
      cadaraSignatures: [{
        entityClass: "face" as const,
        geometryType: "plane",
        definingData: { origin: [0, 0, 0], normal: [0, 0, 1] },
        reference: {
          kind: "face" as const,
          bodyId: "body" as never,
          faceId: "live-face" as never,
        },
      }],
      durableNamingAvailable: true,
    });
    expect(faceResolution.kind).toBe("resolved");
    if (faceResolution.kind !== "resolved") return;
    expect(buildResolvedBodyConsumerDefinition({
      featureKind: "thicken",
      operationIntent: "create",
      options: { thickness: 2, side: "oneSide", direction: "positive" },
      slots: [{
        key: "faceTargets",
        parameterId: "entities",
        role: "face",
        expectedKinds: ["face"],
        cardinality: { min: 1, max: 1 },
      }],
    }, faceResolution.bindings)).toMatchObject({
      kind: "thicken",
      parameters: {
        operationIntent: { source: "literal", value: "create" },
        options: {
          thickness: { source: "literal", value: 2 },
          side: { source: "literal", value: "oneSide" },
          direction: { source: "literal", value: "positive" },
        },
        participants: [{ role: "face", targets: [{ kind: "topologyOf" }] }],
      },
    });
  });

  test("promotes a symmetric-part chamfer to distinct resolved edges and never picks a mirror arbitrarily", () => {
    // Two diagonals of the same square face share bbox+centroid; only the line
    // direction/support distinguishes them (W.2 symmetric-part failure mode).
    // Captured evidence is in meters (the resolver normalizes it to mm); the
    // live cadara signatures are already in the document's millimeters.
    const capturedBox = { low: [0, 0, 0] as [number, number, number], high: [0.01, 0.01, 0] as [number, number, number] };
    const liveBox = { low: [0, 0, 0] as [number, number, number], high: [10, 10, 0] as [number, number, number] };
    const diagA = { origin: [0, 0, 0] as [number, number, number], direction: [1, 1, 0] as [number, number, number] };
    const diagB = { origin: [0, 0.01, 0] as [number, number, number], direction: [1, -1, 0] as [number, number, number] };
    const liveDiagA = { origin: [0, 0, 0] as [number, number, number], direction: [1, 1, 0] as [number, number, number] };
    const liveDiagB = { origin: [0, 10, 0] as [number, number, number], direction: [1, -1, 0] as [number, number, number] };
    const chamferSlots = [{
      key: "edgeTargets",
      parameterId: "entities",
      role: "edge" as const,
      expectedKinds: ["edge" as const],
      cardinality: { min: 1, max: null },
    }];
    const edgeQuery = (deterministicId: string, queryIndex: number) => ({
      consumerFeatureId: "consumer",
      slotKey: "edgeTargets",
      parameterId: "entities",
      queryIndex,
      deterministicId,
      queryString: null,
      expectedKinds: ["edge"] as const,
    });
    const historyEdge = (deterministicId: string, definingData: Record<string, unknown>) => ({
      deterministicId,
      evaluatedAt: "historyPoint" as const,
      consumingFeatureId: "consumer",
      signature: { entityClass: "edge" as const, geometryType: "line", definingData, boundingBox: capturedBox },
    });
    const liveEdge = (edgeId: string, definingData: Record<string, unknown>) => ({
      entityClass: "edge" as const,
      geometryType: "line",
      definingData,
      boundingBox: liveBox,
      reference: { kind: "edge" as const, bodyId: "body" as never, edgeId: edgeId as never },
    });
    const base = {
      consumerFeatureId: "consumer",
      rollback: createRollbackTopologyTimeline({ featureIds: ["consumer"], snapshots: [] }),
      tolerance: { linear: 0.01, angularRadians: 0.001, relative: 0.000001, ambiguityMargin: 0.000001 },
      durableNamingAvailable: true,
    };

    const resolution = resolveTopologyReferences({
      ...base,
      queries: [edgeQuery("edge-diag-a", 0), edgeQuery("edge-diag-b", 1)],
      capturedReferences: [historyEdge("edge-diag-a", diagA), historyEdge("edge-diag-b", diagB)],
      cadaraSignatures: [liveEdge("live_diag_a", liveDiagA), liveEdge("live_diag_b", liveDiagB)],
    });
    expect(resolution.kind).toBe("resolved");
    if (resolution.kind !== "resolved") return;
    // Each mirror query resolves to its own live edge — no arbitrary pick.
    expect(resolution.bindings.map((binding) => binding.reviewReference)).toMatchObject([
      { edgeId: "live_diag_a" },
      { edgeId: "live_diag_b" },
    ]);
    const chamfer = buildResolvedBodyConsumerDefinition(
      { featureKind: "chamfer", options: { distance: 2 }, slots: chamferSlots },
      resolution.bindings,
    );
    expect(chamfer).toMatchObject({
      kind: "chamfer",
      parameters: { participants: [{ role: "edge", targets: [{ kind: "topologyOf" }, { kind: "topologyOf" }] }] },
    });
    if (chamfer.kind !== "chamfer") return;
    expect(chamfer.parameters.options?.distance).toEqual({ source: "literal", value: 2 });
    const sources = chamfer.parameters.participants[0]!.targets.map(
      (target) => (target as { source: { deterministicId: string } }).source.deterministicId,
    );
    expect(sources).toEqual(["edge-diag-a", "edge-diag-b"]);

    // Genuinely coincident edges (same defining data) must degrade honestly.
    const ambiguous = resolveTopologyReferences({
      ...base,
      queries: [edgeQuery("edge-diag-a", 0)],
      capturedReferences: [historyEdge("edge-diag-a", diagA)],
      cadaraSignatures: [liveEdge("live_coincident_a", liveDiagA), liveEdge("live_coincident_b", liveDiagA)],
    });
    expect(ambiguous).toMatchObject({ kind: "degraded", reason: "topology-reference-ambiguous" });
  });
});
