import type {
  ImportDeferredAdvancedSolidFeatureDefinition,
  ImportDeferredFeatureDefinition,
} from "@/contracts/import/actions";
import {
  ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
  type AdvancedParticipantValue,
  type AdvancedSolidFeatureKind,
  type AdvancedSolidOperationIntent,
} from "@/contracts/modeling/advanced-solid";
import { createLiteralAuthoredValue } from "@/contracts/modeling/authored-values";
import { FILLET_FEATURE_SCHEMA_VERSION, SHELL_FEATURE_SCHEMA_VERSION } from "@/contracts/shared/versioning";
import type { ConstructionId, SketchEntityId, SketchPointId } from "@/contracts/shared/ids";
import type { OnshapeFeatureNode, OnshapeSolvedSketch } from "@/domain/import/onshape/bundle-reader";
import type { FeatureDependencyInput, OnshapeFeatureTranslator } from "@/domain/import/onshape/feature-translator-registry";
import { translateSolvedSketch } from "@/domain/import/onshape/solved-sketch-projection";
import type { TopologyQuerySlot } from "@/domain/import/onshape/topology-query-reader";
export interface PlannedConstructionFromFeatureRef {
  kind: "constructionFromFeature";
  featureId: string;
}

export interface PlannedSketchEntityFromFeatureRef {
  kind: "sketchEntityFromFeature";
  sketchFeatureId: string;
  entityId: SketchEntityId;
}

export interface PlannedSketchPointFromFeatureRef {
  kind: "sketchPointFromFeature";
  sketchFeatureId: string;
  pointId: SketchPointId;
}

export interface PlannedBodyTopologyConsumer {
  slots: readonly TopologyQuerySlot[];
  featureKind: AdvancedSolidFeatureKind | "fillet" | "shell" | "hole";
  operationIntent?: AdvancedSolidOperationIntent;
  options?: Record<string, unknown>;
  staticParticipants?: readonly {
    role: AdvancedParticipantValue["role"];
    targets: readonly PlannedAdvancedParticipantTarget[];
  }[];
  radius?: number;
  thickness?: number;
  direction?: "inside" | "outside";
  shellMode?: "openFaces" | "offsetAllFaces";
  unavailableReason?: import("@/domain/import/onshape/fidelity-planner").PlanReasonCode;
  inputDependencies?: readonly FeatureDependencyInput[];
}

function parameter(feature: OnshapeFeatureNode, id: string): Record<string, unknown> | undefined {
  return (feature.parameters ?? []).find(
    (entry) => typeof entry === "object" && entry !== null && (entry as { parameterId?: unknown }).parameterId === id,
  ) as Record<string, unknown> | undefined;
}

function enumValue(feature: OnshapeFeatureNode, id: string): string | null {
  const value = parameter(feature, id)?.value;
  return typeof value === "string" ? value : null;
}

function booleanValue(feature: OnshapeFeatureNode, id: string, fallback = false): boolean {
  const value = parameter(feature, id)?.value;
  return typeof value === "boolean" ? value : fallback;
}

function hasQueries(feature: OnshapeFeatureNode, id: string): boolean {
  const queries = parameter(feature, id)?.queries;
  return Array.isArray(queries) && queries.length > 0;
}

function queryText(feature: OnshapeFeatureNode, id: string): string {
  const queries = parameter(feature, id)?.queries;
  if (!Array.isArray(queries)) return "";
  return queries
    .map((query) =>
      typeof query === "object" &&
      query !== null &&
      typeof (query as { queryString?: unknown }).queryString === "string"
        ? (query as { queryString: string }).queryString
        : "",
    )
    .join("\n");
}
function quantityMillimeters(feature: OnshapeFeatureNode, id: string): number | null {
  const entry = parameter(feature, id);
  const expression = entry?.expression;
  if (typeof expression === "string") {
    const match = expression.trim().match(/^([-+]?\d+(?:\.\d+)?)\s*(mm|cm|m|in)?$/i);
    if (match) {
      const value = Number(match[1]);
      const factor = ({ mm: 1, cm: 10, m: 1000, in: 25.4 } as const)[(match[2]?.toLowerCase() ?? "mm") as "mm"];
      return value * factor;
    }
  }
  return typeof entry?.value === "number" && Number.isFinite(entry.value) ? entry.value * 1000 : null;
}

function angleDegrees(feature: OnshapeFeatureNode, id: string): number | null {
  const entry = parameter(feature, id);
  const expression = entry?.expression;
  if (typeof expression === "string") {
    const match = expression.trim().match(/^([-+]?\d+(?:\.\d+)?)(?:\s*\*\s*|\s*)(deg|rad|degree|radian)?$/i);
    if (match) {
      const value = Number(match[1]);
      const unit = (match[2]?.toLowerCase() ?? "deg");
      return unit.startsWith("rad") ? (value * 180) / Math.PI : value;
    }
  }
  return typeof entry?.value === "number" && Number.isFinite(entry.value)
    ? (entry.value * 180) / Math.PI
    : null;
}

function canonicalPlane(feature: OnshapeFeatureNode, parameterId: string, context: Parameters<OnshapeFeatureTranslator["plan"]>[0]) {
  const queries = parameter(feature, parameterId)?.queries;
  if (!Array.isArray(queries) || queries.length !== 1) return null;
  const ids = (queries[0] as { deterministicIds?: unknown }).deterministicIds;
  if (!Array.isArray(ids) || ids.length !== 1 || typeof ids[0] !== "string") return null;
  const reference = context.references.get(ids[0])?.find(
    (entry) => "signature" in entry && entry.signature.isDefaultPlane === true,
  );
  if (!reference || !("signature" in reference)) return null;
  const normal = reference.signature.definingData?.normal;
  if (!Array.isArray(normal) || normal.length !== 3) return null;
  const absolute = normal.map((component) => Math.abs(Number(component)));
  const key = absolute[2]! > 0.999 ? "xy" : absolute[0]! > 0.999 ? "yz" : absolute[1]! > 0.999 ? "xz" : null;
  return key
    ? { kind: "construction" as const, constructionId: `construction_plane-${key}` as ConstructionId }
    : null;
}

function planeReference(
  feature: OnshapeFeatureNode,
  parameterId: string,
  context: Parameters<OnshapeFeatureTranslator["plan"]>[0],
): AdvancedParticipantValue["targets"][number] | PlannedConstructionFromFeatureRef | null {
  const canonical = canonicalPlane(feature, parameterId, context);
  if (canonical) return canonical;

  const queries = parameter(feature, parameterId)?.queries;
  if (!Array.isArray(queries) || queries.length !== 1) return null;
  const queryString = (queries[0] as { queryString?: unknown }).queryString;
  if (typeof queryString !== "string") return null;
  const match = queryString.match(
    /\$([A-Za-z0-9_]+)planeOp|id\s*\+\s*"([A-Za-z0-9_]+)"\s*\+\s*"planeOp"/,
  );
  const featureId = match?.[1] ?? match?.[2];
  if (!featureId) return null;
  const producer = context.read.features.find(
    (candidate) => candidate.featureId === featureId,
  );
  return producer?.featureType === "cPlane"
    ? { kind: "constructionFromFeature", featureId }
    : null;
}

function resolveSketchLineAxisSource(axisQuery: string, solvedSketch: OnshapeSolvedSketch) {
  const lines = solvedSketch.entities.filter((entity) => entity.entityType === "lineSegment");
  const exact = lines.filter((entity) => axisQuery.includes(entity.entityId));
  if (exact.length === 1) return exact[0]!;

  const nthIndex = axisQuery.match(/qNthElement\([^;]*?,\s*(\d+)\s*\)/)?.[1];
  if (nthIndex !== undefined) {
    const createdEdges = solvedSketch.entities.filter(
      (entity) => entity.entityType === "lineSegment" || entity.entityType === "circle",
    );
    const indexed = createdEdges[Number(nthIndex)];
    return indexed?.entityType === "lineSegment" ? indexed : null;
  }

  return lines.length === 1 ? lines[0]! : null;
}

function translateRotationAxis(
  context: Parameters<OnshapeFeatureTranslator["plan"]>[0],
): PlannedSketchEntityFromFeatureRef | null {
  const axisQuery = queryText(context.feature, "transformAxis");
  if (!axisQuery) return null;

  const solvedSketches = context.read.solvedSketchesByFeatureId;
  if (!solvedSketches) return null;
  const sketchCandidates = [...solvedSketches.entries()].filter(
    ([featureId]) => axisQuery.includes(featureId),
  );
  if (sketchCandidates.length !== 1) return null;

  const [sketchFeatureId, solvedSketch] = sketchCandidates[0]!;
  const sketchPlan = context.state.sketchPlansByFeatureId.get(sketchFeatureId);
  if (!sketchPlan || sketchPlan.tier !== "parametric") return null;

  const axisSource = resolveSketchLineAxisSource(axisQuery, solvedSketch);
  if (!axisSource) return null;

  const translation = translateSolvedSketch({
    solved: solvedSketch,
    featureId: sketchFeatureId,
    label: sketchFeatureId,
    planeKey: sketchPlan.planeKey,
    planeFrame: sketchPlan.planeFrame,
  });
  const axisEntity = translation.definition.entities.find(
    (entity) => entity.kind === "lineSegment" && entity.label === axisSource.entityId,
  );
  return axisEntity
    ? { kind: "sketchEntityFromFeature", sketchFeatureId, entityId: axisEntity.entityId }
    : null;
}

function slot(key: string, parameterId: string, role: TopologyQuerySlot["role"], min = 1, max: number | null = null, expectedKinds: TopologyQuerySlot["expectedKinds"] = ["body"]): TopologyQuerySlot {
  return { key, parameterId, role, expectedKinds, cardinality: { min, max } };
}

function baked(context: Parameters<OnshapeFeatureTranslator["plan"]>[0], reason: import("@/domain/import/onshape/fidelity-planner").PlanReasonCode, planned?: PlannedBodyTopologyConsumer) {
  const queryDependencies = planned?.slots.map((input) => ({
    kind: "query" as const,
    parameterId: input.parameterId,
    slotKey: input.key,
  })) ?? [];
  const inputDependencies = [...queryDependencies, ...(planned?.inputDependencies ?? [])];
  return {
    onshapeFeatureId: context.feature.featureId,
    featureType: context.feature.featureType,
    label: context.label,
    tier: "baked" as const,
    target: { kind: "bakedBody" as const },
    reasonCodes: [reason],
    suppressed: true,
    plannedBodyTopologyConsumer: planned,
    inputDependencies,
    inputFeatureIds: [...new Set(inputDependencies.flatMap((input) => input.kind === "query" ? [] : [input.featureId]))],
  };
}

function topologyCandidate(context: Parameters<OnshapeFeatureTranslator["plan"]>[0], planned: PlannedBodyTopologyConsumer) {
  return baked(context, "needs-history-probe", planned);
}

export const booleanBodiesFeatureTranslator: OnshapeFeatureTranslator = {
  featureTypes: ["booleanBodies"],
  plan(context) {
    if (booleanValue(context.feature, "offset")) return baked(context, "boolean-offset-unsupported");
    const operation = enumValue(context.feature, "operationType") ?? "SUBTRACTION";
    const operationIntent = ({ UNION: "add", ADD: "add", SUBTRACTION: "subtract", INTERSECTION: "intersect" } as const)[operation];
    if (!operationIntent) return baked(context, "boolean-operation-unsupported");
    return topologyCandidate(context, {
      featureKind: "combine",
      operationIntent,
      options: { keepTools: booleanValue(context.feature, "keepTools") },
      slots: [slot("targetBodies", "targets", "targetBody"), slot("toolBodies", "tools", "toolBody")],
    });
  },
  apply: ({ apply }) => apply(),
};

export const deleteBodiesFeatureTranslator: OnshapeFeatureTranslator = {
  featureTypes: ["deleteBodies"],
  plan(context) {
    return topologyCandidate(context, {
      featureKind: "deleteSolid",
      slots: [slot("bodies", "entities", "body"), slot("bodyAliases", "nonCompositeEntities", "body", 0)],
    });
  },
  apply: ({ apply }) => apply(),
};

export const splitFeatureTranslator: OnshapeFeatureTranslator = {
  featureTypes: ["splitPart", "split"],
  plan(context) {
    if ((enumValue(context.feature, "splitType") ?? "PART") !== "PART" || hasQueries(context.feature, "faceTools")) {
      return baked(context, "split-face-tool-unsupported");
    }
    if (!booleanValue(context.feature, "keepBothSides", true)) return baked(context, "split-one-side-unsupported");
    return topologyCandidate(context, {
      featureKind: "split",
      options: { keepTools: booleanValue(context.feature, "keepTools") },
      slots: [slot("targetBody", "targets", "targetBody", 1, 1), slot("toolBody", "tool", "toolBody", 1, 1)],
    });
  },
  apply: ({ apply }) => apply(),
};

export const transformFeatureTranslator: OnshapeFeatureTranslator = {
  featureTypes: ["transform"],
  plan(context) {
    if (booleanValue(context.feature, "makeCopy")) return baked(context, "transform-copy-unsupported");
    const transformType = enumValue(context.feature, "transformType") ?? "TRANSLATION_BY_XYZ";
    if (transformType === "ROTATION") {
      const angle = angleDegrees(context.feature, "angle");
      if (angle === null || angle === 0) return baked(context, "transform-rotation-angle-unreadable");
      const axis = translateRotationAxis(context);
      if (!axis) return baked(context, "transform-rotation-axis-unresolved");
      const signedAngle = booleanValue(context.feature, "oppositeDirectionEntity") || booleanValue(context.feature, "oppositeDirection")
        ? -angle
        : angle;
      return topologyCandidate(context, {
        featureKind: "transform",
        options: { transformType: "rotation", angle: signedAngle },
        staticParticipants: [{ role: "axis", targets: [axis] }],
        slots: [slot("bodies", "entities", "body")],
      });
    }
    if (transformType === "TRANSLATION_BY_XYZ" || transformType === "TRANSLATION_3D") {
      const vector = ["dx", "dy", "dz"].map((id) => quantityMillimeters(context.feature, id));
      if (vector.some((value) => value === null) || vector.every((value) => value === 0)) return baked(context, "transform-translation-unreadable");
      return topologyCandidate(context, {
        featureKind: "transform",
        options: { vector },
        slots: [slot("bodies", "entities", "body")],
      });
    }
    if (transformType === "TRANSLATION_BY_DISTANCE") {
      const distance = quantityMillimeters(context.feature, "distance");
      const reference = planeReference(context.feature, "transformDirection", context);
      if (!distance || !reference) return baked(context, "transform-reference-unresolved");
      return topologyCandidate(context, {
        featureKind: "transform",
        options: { distance: Math.abs(distance), direction: distance < 0 || booleanValue(context.feature, "oppositeDirection") ? "negative" : "positive" },
        staticParticipants: [{ role: "transformReference", targets: [reference] }],
        slots: [slot("bodies", "entities", "body")],
      });
    }
    return baked(context, "transform-type-unsupported");
  },
  apply: ({ apply }) => apply(),
};

export const mirrorFeatureTranslator: OnshapeFeatureTranslator = {
  featureTypes: ["mirror"],
  plan(context) {
    const patternType = enumValue(context.feature, "patternType") ?? "PART";
    const operation = enumValue(context.feature, "operationType") ?? "NEW";
    if (patternType !== "PART" || operation !== "NEW") return baked(context, "mirror-operation-unsupported");
    const plane = planeReference(context.feature, "mirrorPlane", context);
    if (!plane) return baked(context, "mirror-plane-unresolved");
    return topologyCandidate(context, {
      featureKind: "mirror",
      options: { copy: true },
      staticParticipants: [{ role: "plane", targets: [plane] }],
      slots: [slot("bodies", "entities", "body")],
    });
  },
  apply: ({ apply }) => apply(),
};

function positiveQuantity(feature: OnshapeFeatureNode, id: string): number | null {
  const value = quantityMillimeters(feature, id);
  return value !== null && value > 0 ? value : null;
}

function executableChamferAngle(feature: OnshapeFeatureNode, id: string): number | null {
  const value = angleDegrees(feature, id);
  return value !== null && value > 0 && value < 90 ? value : null;
}

export const filletFeatureTranslator: OnshapeFeatureTranslator = {
  featureTypes: ["fillet"],
  plan(context) {
    const radius = positiveQuantity(context.feature, "radius");
    if (radius === null) return baked(context, "fillet-radius-unreadable");
    return topologyCandidate(context, {
      featureKind: "fillet",
      radius,
      slots: [slot("edgeTargets", "entities", "edge", 1, null, ["edge"])],
    });
  },
  apply: ({ apply }) => apply(),
};

export const chamferFeatureTranslator: OnshapeFeatureTranslator = {
  featureTypes: ["chamfer"],
  plan(context) {
    const method = enumValue(context.feature, "chamferMethod") ?? "FACE_OFFSET";
    const style =
      enumValue(context.feature, "chamferStyle") ??
      enumValue(context.feature, "chamferType") ??
      "EQUAL_OFFSETS";
    if (method !== "FACE_OFFSET") return baked(context, "chamfer-method-unsupported");
    if (hasQueries(context.feature, "directionOverrides")) return baked(context, "chamfer-direction-overrides-unsupported");

    if (style === "EQUAL_OFFSETS") {
      const width = positiveQuantity(context.feature, "width");
      if (width === null) return baked(context, "chamfer-width-unreadable");
      return topologyCandidate(context, {
        featureKind: "chamfer",
        options: { widthForm: "equalOffsets", distance: width },
        slots: [slot("edgeTargets", "entities", "edge", 1, null, ["edge"])],
      });
    }

    if (style === "TWO_OFFSETS") {
      const distance1 =
        positiveQuantity(context.feature, "width1") ??
        positiveQuantity(context.feature, "width");
      const distance2 = positiveQuantity(context.feature, "width2");
      if (distance1 === null || distance2 === null) return baked(context, "chamfer-width-unreadable");
      return topologyCandidate(context, {
        featureKind: "chamfer",
        options: { widthForm: "twoOffsets", distance1, distance2 },
        slots: [slot("edgeTargets", "entities", "edge", 1, null, ["edge"])],
      });
    }

    if (style === "OFFSET_ANGLE") {
      const distance = positiveQuantity(context.feature, "width");
      const angle = executableChamferAngle(context.feature, "angle");
      if (distance === null || angle === null) return baked(context, "chamfer-width-unreadable");
      return topologyCandidate(context, {
        featureKind: "chamfer",
        options: { widthForm: "offsetAngle", distance, angle },
        slots: [slot("edgeTargets", "entities", "edge", 1, null, ["edge"])],
      });
    }

    return baked(context, "chamfer-style-unsupported");
  },
  apply: ({ apply }) => apply(),
};

export const thickenFeatureTranslator: OnshapeFeatureTranslator = {
  featureTypes: ["thicken"],
  plan(context) {
    const operation = enumValue(context.feature, "operationType") ?? "NEW";
    const thickness = positiveQuantity(context.feature, "thickness");
    if (
      operation !== "NEW" ||
      thickness === null ||
      !hasQueries(context.feature, "entities") ||
      booleanValue(context.feature, "midplane") ||
      booleanValue(context.feature, "symmetric")
    ) {
      return baked(context, "thicken-requires-topology");
    }
    context.state.bodyProducingFeatureIds.push(context.feature.featureId);
    return topologyCandidate(context, {
      featureKind: "thicken",
      operationIntent: "create",
      options: {
        thickness,
        side: "oneSide",
        direction: booleanValue(context.feature, "oppositeDirection")
          ? "negative"
          : "positive",
      },
      slots: [slot("faceTargets", "entities", "face", 1, 1, ["face"])],
    });
  },
  apply: ({ apply }) => apply(),
};

export const shellFeatureTranslator: OnshapeFeatureTranslator = {
  featureTypes: ["shell"],
  plan(context) {
    // Onshape has two closed/empty-selection shell meanings:
    // - isHollow=true with no entities creates a closed hollow that preserves the
    //   outer envelope, which differs from a whole-solid offset and remains baked.
    // - isHollow=false with no entities offsets every face of the selected part.
    const isHollow = booleanValue(context.feature, "isHollow");
    const hasEntityTargets = hasQueries(context.feature, "entities");
    const thickness = positiveQuantity(context.feature, "thickness");
    if (thickness === null) return baked(context, "shell-thickness-unreadable");
    if (!isHollow) {
      if (hasEntityTargets) return baked(context, "shell-non-hollow-unsupported");
      return topologyCandidate(context, {
        featureKind: "shell",
        shellMode: "offsetAllFaces",
        thickness,
        direction: booleanValue(context.feature, "oppositeDirection") ? "outside" : "inside",
        slots: [slot("bodyTarget", "parts", "body", 1, 1, ["body"])],
      });
    }
    if (!hasEntityTargets) return baked(context, "shell-hollow-without-openings");
    return topologyCandidate(context, {
      featureKind: "shell",
      thickness,
      direction: booleanValue(context.feature, "oppositeDirection") ? "outside" : "inside",
      slots: [
        slot("bodyTarget", "parts", "body", 1, 1, ["body"]),
        slot("faceTargets", "entities", "face", 1, null, ["face"]),
      ],
    });
  },
  apply: ({ apply }) => apply(),
};

function firstPositiveQuantity(feature: OnshapeFeatureNode, ids: readonly string[]): number | null {
  for (const id of ids) {
    const value = positiveQuantity(feature, id);
    if (value !== null) return value;
  }
  return null;
}

function firstPositiveAngle(feature: OnshapeFeatureNode, ids: readonly string[]): number | null {
  for (const id of ids) {
    const value = angleDegrees(feature, id);
    if (value !== null && value > 0) return value;
  }
  return null;
}

function firstEnumValue(feature: OnshapeFeatureNode, ids: readonly string[]): string | null {
  for (const id of ids) {
    const value = enumValue(feature, id);
    if (value) return value;
  }
  return null;
}

function hasUnsupportedThreadOrClearance(feature: OnshapeFeatureNode): boolean {
  return (feature.parameters ?? []).some((entry) => {
    if (typeof entry !== "object" || entry === null) return false;
    const parameterId = String((entry as { parameterId?: unknown }).parameterId ?? "").toLowerCase();
    const value = (entry as { value?: unknown }).value;
    const textValue = typeof value === "string" ? value.toLowerCase() : "";
    if (/(thread|tap|tapped|clearance)/.test(parameterId) && value === true) return true;
    return /(thread|tap|tapped|clearance)/.test(textValue);
  });
}

function resolveHoleLocations(
  context: Parameters<OnshapeFeatureTranslator["plan"]>[0],
): { sketchFeatureId: string; targets: PlannedSketchPointFromFeatureRef[] } | null {
  const locationsQuery = queryText(context.feature, "locations");
  if (!locationsQuery) return null;

  const consumerIndex = context.read.features.findIndex(
    (feature) => feature.featureId === context.feature.featureId,
  );
  const sketchCandidates = [...context.read.solvedSketchesByFeatureId.entries()].filter(
    ([featureId]) => {
      const featureIndex = context.read.features.findIndex((feature) => feature.featureId === featureId);
      return featureIndex >= 0 && (consumerIndex < 0 || featureIndex < consumerIndex) && locationsQuery.includes(featureId);
    },
  );
  if (sketchCandidates.length !== 1) return null;

  const [sketchFeatureId, solvedSketch] = sketchCandidates[0]!;
  const sketchPlan = context.state.sketchPlansByFeatureId.get(sketchFeatureId);
  if (!sketchPlan || sketchPlan.tier !== "parametric") return null;

  const sourcePoints = solvedSketch.entities.filter((entity) => entity.entityType === "point");
  const explicitPoints = sourcePoints.filter((entity) => locationsQuery.includes(entity.entityId));
  const selectedPoints = explicitPoints.length > 0
    ? explicitPoints
    : sourcePoints.length === 1
      ? sourcePoints
      : [];
  if (selectedPoints.length === 0) return null;

  const translation = translateSolvedSketch({
    solved: solvedSketch,
    featureId: sketchFeatureId,
    label: sketchFeatureId,
    planeKey: sketchPlan.planeKey,
    planeFrame: sketchPlan.planeFrame,
  });
  const translatedPointIds = new Map(
    translation.definition.entities.flatMap((entity) =>
      entity.kind === "point" ? [[entity.label, entity.pointId] as const] : [],
    ),
  );
  const targets = selectedPoints.map((point) => {
    const pointId = translatedPointIds.get(point.entityId);
    return pointId ? { kind: "sketchPointFromFeature" as const, sketchFeatureId, pointId } : null;
  });
  return targets.every((target): target is PlannedSketchPointFromFeatureRef => target !== null)
    ? { sketchFeatureId, targets }
    : null;
}

export const holeFeatureTranslator: OnshapeFeatureTranslator = {
  featureTypes: ["hole"],
  plan(context) {
    if (hasUnsupportedThreadOrClearance(context.feature)) return baked(context, "hole-thread-unsupported");

    const styleToken = firstEnumValue(context.feature, ["styleV2", "style"]) ?? "SIMPLE";
    const style = ({ SIMPLE: "simple", C_BORE: "counterbore", C_SINK: "countersink" } satisfies Record<string, "simple" | "counterbore" | "countersink">)[styleToken];
    if (!style) return baked(context, "hole-style-unsupported");

    const mainDiameter = firstPositiveQuantity(context.feature, ["holeDiameterV3", "holeDiameterV2", "holeDiameter", "diameter"]);
    if (mainDiameter === null) return baked(context, "hole-diameter-unreadable");

    const terminationToken = firstEnumValue(context.feature, ["endStyleV2", "endStyle"]) ?? "BLIND";
    const termination = ({ BLIND: "blind", THROUGH: "throughAll", THROUGH_ALL: "throughAll" } satisfies Record<string, "blind" | "throughAll">)[terminationToken];
    if (!termination) return baked(context, "hole-termination-unsupported");

    const options: Record<string, unknown> = {
      style,
      mainDiameter,
      termination,
      direction: booleanValue(context.feature, "oppositeDirection") ? "reverse" : "forward",
    };
    if (termination === "blind") {
      const depth = firstPositiveQuantity(context.feature, ["holeDepthV3", "holeDepth"]);
      if (depth === null) return baked(context, "hole-depth-unreadable");
      options.depth = depth;
    }
    if (style === "counterbore") {
      const counterboreDiameter = firstPositiveQuantity(context.feature, ["cBoreDiameterV3", "cBoreDiameter"]);
      const counterboreDepth = firstPositiveQuantity(context.feature, ["cBoreDepthV3", "cBoreDepth"]);
      if (counterboreDiameter === null || counterboreDepth === null) return baked(context, "hole-counterbore-parameters-unreadable");
      options.counterboreDiameter = counterboreDiameter;
      options.counterboreDepth = counterboreDepth;
    }
    if (style === "countersink") {
      const countersinkDiameter = firstPositiveQuantity(context.feature, ["cSinkDiameterV3", "cSinkDiameter"]);
      const countersinkAngleDegrees = firstPositiveAngle(context.feature, ["cSinkAngleV3", "cSinkAngle"]);
      if (countersinkDiameter === null || countersinkAngleDegrees === null) return baked(context, "hole-countersink-parameters-unreadable");
      options.countersinkDiameter = countersinkDiameter;
      options.countersinkAngleDegrees = countersinkAngleDegrees;
    }

    const locations = resolveHoleLocations(context);
    if (!hasQueries(context.feature, "scope")) return baked(context, "hole-scope-unresolved");
    if (!locations) return baked(context, "hole-location-unresolved");
    return topologyCandidate(context, {
      featureKind: "hole",
      options,
      staticParticipants: [{ role: "location", targets: locations.targets }],
      slots: [slot("scope", "scope", "body", 1, null, ["body"])],
      inputDependencies: [{ kind: "sketch", featureId: locations.sketchFeatureId }],
    });
  },
  apply: ({ apply }) => apply(),
};

export type PlannedAdvancedParticipantTarget =
  | AdvancedParticipantValue["targets"][number]
  | PlannedConstructionFromFeatureRef
  | PlannedSketchEntityFromFeatureRef
  | PlannedSketchPointFromFeatureRef;

export function buildResolvedBodyConsumerDefinition(
  planned: PlannedBodyTopologyConsumer,
  bindings: readonly import("@/domain/import/onshape/topology-reference-resolver").TopologyResolutionBinding[],
): ImportDeferredFeatureDefinition {
  const targetsByRole = new Map<string, import("@/contracts/import/actions").ImportDeferredDurableRef[]>();
  for (const binding of bindings) {
    const role = planned.slots.find((entry) => entry.key === binding.query.slotKey)?.role;
    if (!role) continue;
    const targets = targetsByRole.get(role) ?? [];
    targets.push(binding.deferred);
    targetsByRole.set(role, targets);
  }
  if (planned.featureKind === "fillet") {
    return {
      kind: "fillet",
      featureTypeVersion: FILLET_FEATURE_SCHEMA_VERSION,
      parameters: { edgeTargets: (targetsByRole.get("edge") ?? []) as import("@/contracts/import/actions").ImportDeferredFilletFeatureParameters["edgeTargets"], radius: createLiteralAuthoredValue(planned.radius!) },
    };
  }
  if (planned.featureKind === "shell") {
    return {
      kind: "shell",
      featureTypeVersion: SHELL_FEATURE_SCHEMA_VERSION,
      parameters: {
        ...(planned.shellMode === "offsetAllFaces"
          ? { mode: "offsetAllFaces" as const, faceTargets: [] as const }
          : {
              faceTargets: (targetsByRole.get("face") ?? []) as import("@/contracts/import/actions").ImportDeferredShellFeatureParameters["faceTargets"],
            }),
        bodyTarget: targetsByRole.get("body")![0]! as import("@/contracts/import/actions").ImportDeferredShellFeatureParameters["bodyTarget"],
        thickness: createLiteralAuthoredValue(planned.thickness!),
        direction: planned.direction,
        operation: createLiteralAuthoredValue("newBody"),
        booleanScope: { kind: "standalone" },
      },
    };
  }
  const executableOptions = planned.options
    ? Object.fromEntries(
        Object.entries(planned.options).map(([key, value]) => [
          key,
          typeof value === "number" || typeof value === "string"
            ? createLiteralAuthoredValue(value)
            : value,
        ]),
      )
    : planned.options;
  return {
    kind: planned.featureKind as AdvancedSolidFeatureKind,
    featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
    parameters: {
      ...(planned.operationIntent ? { operationIntent: createLiteralAuthoredValue(planned.operationIntent) } : {}),
      ...(executableOptions ? { options: executableOptions } : {}),
      participants: [
        ...[...targetsByRole].map(([role, targets]) => ({ role: role as never, targets })),
        ...(planned.staticParticipants ?? []),
      ],
    },
  } as ImportDeferredAdvancedSolidFeatureDefinition;
}
