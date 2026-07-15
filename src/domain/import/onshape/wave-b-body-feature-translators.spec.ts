import { describe, expect, test } from "vitest";

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
  splitFeatureTranslator,
  transformFeatureTranslator,
} from "@/domain/import/onshape/wave-b-body-feature-translators";

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
      bakedLineageFeatureIds: new Set(),
      sketchPlansByFeatureId: new Map(),
      bodyProducingFeatureIds: [],
    },
  });
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

  test("maps XYZ translation in millimeters and rejects rotation honestly", () => {
    const translated = plan(transformFeatureTranslator, "transform", [
      valueParameter("transformType", "TRANSLATION_BY_XYZ"),
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
    expect(plan(transformFeatureTranslator, "transform", [valueParameter("transformType", "ROTATION")]).reasonCodes).toEqual([
      "transform-rotation-unsupported",
    ]);
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

  test("maps fillet radius and root-bundle equal-offset chamfer parameters before topology gating", () => {
    const fillet = plan(filletFeatureTranslator, "fillet", [valueParameter("radius", 0, "2.5 mm"), queryParameter("entities", ["edge"]) ]);
    expect(fillet).toMatchObject({
      reasonCodes: ["needs-history-probe"],
      plannedBodyTopologyConsumer: { featureKind: "fillet", radius: 2.5, slots: [{ parameterId: "entities", role: "edge", expectedKinds: ["edge"] }] },
    });
    const chamfer = plan(chamferFeatureTranslator, "chamfer", [
      queryParameter("entities", ["edge"]),
      valueParameter("chamferMethod", "FACE_OFFSET"),
      valueParameter("chamferType", "EQUAL_OFFSETS"),
      valueParameter("width", 0, "15 mm"),
      valueParameter("width1", 0, "5 mm"),
      valueParameter("width2", 0, "5 mm"),
      valueParameter("angle", 0, "45 deg"),
      valueParameter("oppositeDirection", false),
      valueParameter("tangentPropagation", true),
      queryParameter("directionOverrides", []),
    ]);
    expect(chamfer.plannedBodyTopologyConsumer).toMatchObject({ featureKind: "chamfer", options: { distance: 15, style: "equalOffsets" } });
    expect(plan(chamferFeatureTranslator, "chamfer", [valueParameter("chamferType", "TWO_OFFSETS")]).reasonCodes).toEqual(["chamfer-style-unsupported"]);
  });

  test("maps shell openings and rejects the root bundle's hollow shell without openings", () => {
    const shell = plan(shellFeatureTranslator, "shell", [
      valueParameter("isHollow", true), queryParameter("parts", ["body"]), queryParameter("entities", ["face"]),
      valueParameter("thickness", 0, "2.5 mm"), valueParameter("oppositeDirection", false),
    ]);
    expect(shell.plannedBodyTopologyConsumer).toMatchObject({ featureKind: "shell", thickness: 2.5, direction: "inside", slots: [{ parameterId: "parts", role: "body" }, { parameterId: "entities", role: "face" }] });
    expect(plan(shellFeatureTranslator, "shell", [valueParameter("isHollow", true), queryParameter("parts", ["body"]), valueParameter("thickness", 0, "2.5 mm")]).reasonCodes).toEqual(["shell-hollow-without-openings"]);
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
    const resolution = resolveTopologyReferences({
      consumerFeatureId: "consumer",
      queries: [{ consumerFeatureId: "consumer", slotKey: "edgeTargets", parameterId: "entities", queryIndex: 0, deterministicId: "edge", queryString: null, expectedKinds: ["edge"] }],
      capturedReferences: [{ deterministicId: "edge", evaluatedAt: "historyPoint", consumingFeatureId: "consumer", signature: { entityClass: "edge", geometryType: "line", definingData: { origin: [0, 0, 0], direction: [1, 0, 0] } } }],
      rollback: createRollbackTopologyTimeline({ featureIds: ["consumer"], snapshots: [] }),
      cadaraSignatures: [{ entityClass: "edge", geometryType: "line", definingData: { origin: [0, 0, 0], direction: [1, 0, 0] }, reference: { kind: "edge", bodyId: "body" as never, edgeId: "live" as never } }],
      tolerance: { linear: 0.01, angularRadians: 0.001, relative: 0.000001, ambiguityMargin: 0.000001 },
      durableNamingAvailable: true, // mocked capability flip; source evidence is v2 history-point evidence.
    });
    expect(resolution.kind).toBe("resolved");
    if (resolution.kind !== "resolved") return;
    const fillet = buildResolvedBodyConsumerDefinition({ featureKind: "fillet", radius: 2, slots: [{ key: "edgeTargets", parameterId: "entities", role: "edge", expectedKinds: ["edge"], cardinality: { min: 1, max: null } }] }, resolution.bindings);
    const chamfer = buildResolvedBodyConsumerDefinition({ featureKind: "chamfer", options: { distance: 2 }, slots: [{ key: "edgeTargets", parameterId: "entities", role: "edge", expectedKinds: ["edge"], cardinality: { min: 1, max: null } }] }, resolution.bindings);
    expect(fillet).toMatchObject({ kind: "fillet", parameters: { edgeTargets: [{ kind: "topologyOf", expectedKind: "edge" }] } });
    expect(chamfer).toMatchObject({ kind: "chamfer", parameters: { participants: [{ role: "edge", targets: [{ kind: "topologyOf", expectedKind: "edge" }] }] } });
  });
});
