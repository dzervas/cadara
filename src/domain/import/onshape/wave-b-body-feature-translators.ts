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
import type { ConstructionId } from "@/contracts/shared/ids";
import type { OnshapeFeatureNode } from "@/domain/import/onshape/bundle-reader";
import type { OnshapeFeatureTranslator } from "@/domain/import/onshape/feature-translator-registry";
import type { TopologyQuerySlot } from "@/domain/import/onshape/topology-query-reader";
export interface PlannedBodyTopologyConsumer {
  slots: readonly TopologyQuerySlot[];
  featureKind: AdvancedSolidFeatureKind | "fillet" | "shell" | "hole";
  operationIntent?: AdvancedSolidOperationIntent;
  options?: Record<string, unknown>;
  staticParticipants?: readonly AdvancedParticipantValue[];
  radius?: number;
  thickness?: number;
  direction?: "inside" | "outside";
  unavailableReason?: import("@/domain/import/onshape/fidelity-planner").PlanReasonCode;
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

function slot(key: string, parameterId: string, role: TopologyQuerySlot["role"], min = 1, max: number | null = null, expectedKinds: TopologyQuerySlot["expectedKinds"] = ["body"]): TopologyQuerySlot {
  return { key, parameterId, role, expectedKinds, cardinality: { min, max } };
}

function baked(context: Parameters<OnshapeFeatureTranslator["plan"]>[0], reason: import("@/domain/import/onshape/fidelity-planner").PlanReasonCode, planned?: PlannedBodyTopologyConsumer) {
  context.state.bakedLineageFeatureIds.add(context.feature.featureId);
  return {
    onshapeFeatureId: context.feature.featureId,
    featureType: context.feature.featureType,
    label: context.label,
    tier: "baked" as const,
    target: { kind: "bakedBody" as const },
    reasonCodes: [reason],
    suppressed: true,
    plannedBodyTopologyConsumer: planned,
    inputFeatureIds: [],
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
    if (transformType === "ROTATION") return baked(context, "transform-rotation-unsupported");
    if (transformType === "TRANSLATION_BY_XYZ") {
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
      const reference = canonicalPlane(context.feature, "transformDirection", context);
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
    const plane = canonicalPlane(context.feature, "mirrorPlane", context);
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
    const style = enumValue(context.feature, "chamferType") ?? "EQUAL_OFFSETS";
    if (method !== "FACE_OFFSET") return baked(context, "chamfer-method-unsupported");
    if (style !== "EQUAL_OFFSETS") return baked(context, "chamfer-style-unsupported");
    if (hasQueries(context.feature, "directionOverrides")) return baked(context, "chamfer-direction-overrides-unsupported");
    const width = positiveQuantity(context.feature, "width");
    if (width === null) return baked(context, "chamfer-width-unreadable");
    return topologyCandidate(context, {
      featureKind: "chamfer",
      options: {
        distance: width,
        style: "equalOffsets",
        oppositeDirection: booleanValue(context.feature, "oppositeDirection"),
        tangentPropagation: booleanValue(context.feature, "tangentPropagation", true),
      },
      slots: [slot("edgeTargets", "entities", "edge", 1, null, ["edge"])],
    });
  },
  apply: ({ apply }) => apply(),
};

export const shellFeatureTranslator: OnshapeFeatureTranslator = {
  featureTypes: ["shell"],
  plan(context) {
    if (!booleanValue(context.feature, "isHollow")) return baked(context, "shell-non-hollow-unsupported");
    if (!hasQueries(context.feature, "entities")) return baked(context, "shell-hollow-without-openings");
    const thickness = positiveQuantity(context.feature, "thickness");
    if (thickness === null) return baked(context, "shell-thickness-unreadable");
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

export const holeFeatureTranslator: OnshapeFeatureTranslator = {
  featureTypes: ["hole"],
  plan(context) {
    const style = enumValue(context.feature, "styleV2") ?? enumValue(context.feature, "style") ?? "SIMPLE";
    const diameter = positiveQuantity(context.feature, "diameter");
    if (style !== "SIMPLE") return baked(context, "hole-style-unsupported");
    if (diameter === null) return baked(context, "hole-diameter-unreadable");
    return topologyCandidate(context, {
      featureKind: "hole",
      options: { style: "simple", diameter },
      unavailableReason: "hole-executor-unavailable",
      slots: [
        slot("locations", "locations", "edge", 1, null, ["vertex"]),
        slot("scope", "scope", "body", 1, null, ["body"]),
      ],
    });
  },
  apply: ({ apply }) => apply(),
};

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
        bodyTarget: targetsByRole.get("body")![0]! as import("@/contracts/import/actions").ImportDeferredShellFeatureParameters["bodyTarget"],
        faceTargets: (targetsByRole.get("face") ?? []) as import("@/contracts/import/actions").ImportDeferredShellFeatureParameters["faceTargets"],
        thickness: createLiteralAuthoredValue(planned.thickness!),
        direction: planned.direction,
        operation: createLiteralAuthoredValue("newBody"),
        booleanScope: { kind: "standalone" },
      },
    };
  }
  return {
    kind: planned.featureKind as AdvancedSolidFeatureKind,
    featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
    parameters: {
      ...(planned.operationIntent ? { operationIntent: createLiteralAuthoredValue(planned.operationIntent) } : {}),
      ...(planned.options ? { options: planned.options } : {}),
      participants: [
        ...[...targetsByRole].map(([role, targets]) => ({ role: role as never, targets })),
        ...(planned.staticParticipants ?? []),
      ],
    },
  } as ImportDeferredAdvancedSolidFeatureDefinition;
}
