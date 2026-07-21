import { describe, expect, test } from "vitest";
import type { ImportCapabilities } from "@/contracts/import/capabilities";
import type { ResolvedImportSource } from "@/contracts/import/source";
import { validateImportPreparedActions } from "@/contracts/import/validation";
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
  shellFeatureTranslator,
  thickenFeatureTranslator,
  splitFeatureTranslator,
  transformFeatureTranslator,
} from "@/domain/import/onshape/wave-b-body-feature-translators";
import { onshapeImportProvider } from "@/domain/import/onshape/provider";
import { makeWaveTMirrorTransformCaptureBundle } from "@/domain/import/onshape/wave-t-capture-fixtures";

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

  test("provider promotes mirror across a captured-frame cPlane and emits constructionOf", async () => {
    const source = mirrorSource();
    const review = await onshapeImportProvider.review({ source, capabilities: providerCapabilities });
    const studio = review.providerReview.studios[0]!;
    expect(studio.tierCounts).toEqual({ parametric: 4, baked: 1, geometryOnly: 0 });
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
    const mirror = actions.createFeatures?.find((candidate) => candidate.definition.kind === "mirror");
    expect(mirror?.definition).toMatchObject({
      kind: "mirror",
      parameters: {
        participants: expect.arrayContaining([
          { role: "plane", targets: [{ kind: "constructionOf", actionIndex: 2 }] },
        ]),
      },
    });
    expect(validateImportPreparedActions(actions).success).toBe(true);
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

  test("maps shell openings and keeps inexpressible shell forms honest", () => {
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
    expect(plan(shellFeatureTranslator, "shell", realRootCaptureEnvelope).reasonCodes).toEqual(["shell-hollow-without-openings"]);

    const nonHollowOffsetAllFaces = [
      valueParameter("isHollow", false),
      queryParameter("entities", []),
      queryParameter("parts", ["body"]),
      valueParameter("thickness", 0, "2.5 mm"),
      valueParameter("oppositeDirection", false),
    ];
    expect(plan(shellFeatureTranslator, "shell", nonHollowOffsetAllFaces).reasonCodes).toEqual(["shell-non-hollow-unsupported"]);
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

  test("reads hole locations and scope but reports the absent OCC hole executor", () => {
    const result = plan(holeFeatureTranslator, "hole", [
      valueParameter("styleV2", "SIMPLE"), valueParameter("diameter", 0, "6 mm"),
      queryParameter("locations", ["vertex"]), queryParameter("scope", ["body"]),
    ]);
    expect(result.plannedBodyTopologyConsumer).toMatchObject({
      featureKind: "hole", unavailableReason: "hole-executor-unavailable",
      slots: [{ parameterId: "locations", expectedKinds: ["vertex"] }, { parameterId: "scope", expectedKinds: ["body"] }],
    });
    expect(plan(holeFeatureTranslator, "hole", [valueParameter("styleV2", "C_BORE"), valueParameter("diameter", 0, "6 mm")]).reasonCodes).toEqual(["hole-style-unsupported"]);
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
          widthForm: "twoOffsets",
          distance1: { source: "literal", value: 2 },
          distance2: { source: "literal", value: 3 },
        },
      },
    });
    expect(validateFeatureDefinitionAuthoredValueInvariants(chamfer).map((issue) => issue.message)).toEqual([]);

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
        operationIntent: { value: "create" },
        options: { thickness: 2, side: "oneSide", direction: "positive" },
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
