/**
 * Extrude translation + review-time region/topology verification.
 *
 * Keeps extent and boolean-lineage concerns local while delegating reusable
 * sketch-profile and exact-prefix topology matching to the shared import seams.
 */
import type { ImportDeferredTopologyRef } from "@/contracts/import/actions";
import type { OnshapeProfileEvidence } from "@/contracts/import/onshape-capture-bundle";
import type { AuthoredValue } from "@/contracts/modeling/authored-values";
import type {
  ExtrudeEndCondition,
  ExtrudeFeatureExtent,
  FeatureBooleanOperation,
  LinearExtentDirection,
  LinearUpToOffset,
} from "@/contracts/modeling/schema";
import type { SketchPlaneFrame, SketchPlaneKey } from "@/contracts/shared/sketch-plane";
import type {
  OnshapeFeatureNode,
  OnshapeSolvedSketch,
} from "@/domain/import/onshape/bundle-reader";
import { translateOnshapeExpression } from "@/domain/import/onshape/expression-translator";
import {
  referencedSketchFeatureIdsFromProfileParameter,
  resolveOnshapeSketchProfiles,
  type DeferredOnshapeProfile,
  type ProfileResolutionDiagnostic,
} from "@/domain/import/onshape/profile-resolver";
import type { TopologyResolutionBinding } from "@/domain/import/onshape/topology-reference-resolver";
import type { TopologyQuerySlot } from "@/domain/import/onshape/topology-query-reader";

export type PlannedExtrudeProfile = DeferredOnshapeProfile;

interface PlannedTopologyTarget {
  kind: "topologySlot";
  slotKey: string;
}

type PlannedExtrudeTarget = PlannedTopologyTarget | ImportDeferredTopologyRef;

type PlannedExtrudeEndCondition =
  | Extract<ExtrudeEndCondition, { kind: "blind" | "upToNext" | "throughAll" }>
  | (Omit<Extract<ExtrudeEndCondition, { kind: "upToFace" }>, "target"> & {
      target: PlannedExtrudeTarget;
    })
  | (Omit<Extract<ExtrudeEndCondition, { kind: "upToPart" }>, "target"> & {
      target: PlannedExtrudeTarget;
    })
  | (Omit<Extract<ExtrudeEndCondition, { kind: "upToVertex" }>, "target"> & {
      target: PlannedExtrudeTarget;
    });

export type PlannedExtrudeExtent =
  | { mode: "oneSide"; end: PlannedExtrudeEndCondition }
  | {
      mode: "symmetric";
      end: Extract<PlannedExtrudeEndCondition, { kind: "blind" | "throughAll" }>;
    }
  | {
      mode: "twoSide";
      firstEnd: PlannedExtrudeEndCondition;
      secondEnd: PlannedExtrudeEndCondition;
    };

export type PlannedExtrudeBoolean =
  | { kind: "standalone" }
  | { kind: "deferredBody"; sourceFeatureId: string }
  | {
      kind: "topologyTargets";
      slotKey: string;
      targets: readonly ImportDeferredTopologyRef[];
    };

export interface PlannedExtrude {
  /** Ordered exact query results; each profile carries its own source sketch or face identity. */
  profiles: PlannedExtrudeProfile[];
  extent: PlannedExtrudeExtent;
  operation: AuthoredValue<FeatureBooleanOperation>;
  boolean: PlannedExtrudeBoolean;
  /** Active topology roles resolved atomically against the exact pre-consumer prefix. */
  topologySlots: readonly TopologyQuerySlot[];
}

export type ExtrudePlanDiagnostic = ProfileResolutionDiagnostic;

export type ExtrudePlanResult =
  | { tier: "parametric"; plannedExtrude: PlannedExtrude; diagnostics: ExtrudePlanDiagnostic[] }
  | { tier: "topology"; plannedExtrude: PlannedExtrude; diagnostics: ExtrudePlanDiagnostic[] }
  | {
      tier: "baked";
      reason:
        | "needs-region-resolution"
        | "needs-history-probe"
        | "extrude-body-type-unsupported"
        | "extrude-default-scope-ambiguous"
        | "unsupported-feature";
      diagnostics: ExtrudePlanDiagnostic[];
    };

export interface ExtrudePlanInput {
  feature: OnshapeFeatureNode;
  /** Exact selected-face evidence captured immediately before this extrude. */
  profileEvidence: readonly OnshapeProfileEvidence[];
  /** Solved sketches keyed by exact evidence source ids. */
  solvedSketchesByFeatureId: ReadonlyMap<string, OnshapeSolvedSketch>;
  /** Earlier planned sketches keyed by exact evidence source ids. */
  referencedSketchesByFeatureId: ReadonlyMap<
    string,
    { tier: string; planeKey: SketchPlaneKey; planeFrame?: SketchPlaneFrame }
  >;
  /** Onshape feature ids of prior parametric NEW-body extrudes, in order. */
  priorBodyProducingFeatureIds: readonly string[];
  /** Unique target lineage inferred from rollback body identity for default scope. */
  inferredDefaultScopeFeatureIds?: readonly string[];
}

function findParameter(
  feature: OnshapeFeatureNode,
  parameterId: string,
): Record<string, unknown> | null {
  for (const parameter of feature.parameters ?? []) {
    if (
      typeof parameter === "object" &&
      parameter !== null &&
      (parameter as { parameterId?: unknown }).parameterId === parameterId
    ) {
      return parameter as Record<string, unknown>;
    }
  }
  return null;
}

function enumValue(feature: OnshapeFeatureNode, parameterId: string): string | null {
  const value = findParameter(feature, parameterId)?.value;
  return typeof value === "string" ? value : null;
}

function booleanValue(feature: OnshapeFeatureNode, parameterId: string): boolean {
  return findParameter(feature, parameterId)?.value === true;
}

function quantityExpression(
  feature: OnshapeFeatureNode,
  parameterId: string,
): string | null {
  const expression = findParameter(feature, parameterId)?.expression;
  return typeof expression === "string" ? expression : null;
}

function hasQueries(feature: OnshapeFeatureNode, parameterId: string): boolean {
  const queries = findParameter(feature, parameterId)?.queries;
  return Array.isArray(queries) && queries.length > 0;
}

/** Parse readable source ids only. Opaque qCompressed source is capture evidence, never text-decoded. */
export function referencedSketchFeatureIds(feature: OnshapeFeatureNode): string[] {
  return referencedSketchFeatureIdsFromProfileParameter(findParameter(feature, "entities"));
}

const BARE_NUMBER = /^-?\d+(?:\.\d+)?$/;

function authoredDistance(
  expression: string | null,
  diagnostics: ExtrudePlanDiagnostic[],
): AuthoredValue<number> {
  const translated = translateOnshapeExpression({ expression });
  if (translated.diagnostic) {
    diagnostics.push({
      code: translated.diagnostic.code,
      message: translated.diagnostic.message,
    });
  }
  // Extrude distances are strictly positive; direction is carried separately.
  if (BARE_NUMBER.test(translated.valueText)) {
    return { source: "literal", value: Math.abs(Number(translated.valueText)) };
  }
  return { source: "expression", valueText: translated.valueText };
}

function authoredAngle(
  feature: OnshapeFeatureNode,
  enabledParameterId: string,
  angleParameterId: string,
  pullDirectionParameterId: string,
  diagnostics: ExtrudePlanDiagnostic[],
): AuthoredValue<number> | undefined {
  if (!booleanValue(feature, enabledParameterId)) return undefined;
  const translated = translateOnshapeExpression({
    expression: quantityExpression(feature, angleParameterId),
  });
  if (translated.diagnostic) {
    diagnostics.push({
      code: translated.diagnostic.code,
      message: translated.diagnostic.message,
    });
  }
  const sign = booleanValue(feature, pullDirectionParameterId) ? -1 : 1;
  if (BARE_NUMBER.test(translated.valueText)) {
    return {
      source: "literal",
      value: sign * Number(translated.valueText) * (Math.PI / 180),
    };
  }
  return {
    source: "expression",
    valueText: `${sign < 0 ? "-" : ""}((${translated.valueText}) * ${Math.PI / 180})`,
  };
}

function upToOffset(
  feature: OnshapeFeatureNode,
  prefix: "" | "secondDirection",
  diagnostics: ExtrudePlanDiagnostic[],
): LinearUpToOffset | undefined {
  const hasOffsetId = prefix ? "secondDirectionHasOffset" : "hasOffset";
  if (!booleanValue(feature, hasOffsetId)) return undefined;
  const distanceId = prefix ? "secondDirectionOffsetDistance" : "offsetDistance";
  const oppositeId = prefix ? "secondDirectionOffsetOppositeDirection" : "offsetOppositeDirection";
  return {
    distance: authoredDistance(quantityExpression(feature, distanceId), diagnostics),
    direction: booleanValue(feature, oppositeId) ? "extend" : "shorten",
  };
}

function topologySlot(
  key: string,
  parameterId: string,
  role: TopologyQuerySlot["role"],
  expectedKinds: TopologyQuerySlot["expectedKinds"],
  min = 1,
  max: number | null = 1,
): TopologyQuerySlot {
  return { key, parameterId, role, expectedKinds, cardinality: { min, max } };
}

function translateEnd(
  feature: OnshapeFeatureNode,
  side: "first" | "second",
  diagnostics: ExtrudePlanDiagnostic[],
  slots: TopologyQuerySlot[],
): PlannedExtrudeEndCondition | null {
  const second = side === "second";
  const boundId = second ? "secondDirectionBound" : "endBound";
  const bound = enumValue(feature, boundId) ?? "BLIND";
  const directionParameterId = second
    ? "secondDirectionOppositeDirection"
    : "oppositeDirection";
  const oppositeDirection = findParameter(feature, directionParameterId)?.value;
  const direction: LinearExtentDirection =
    oppositeDirection === true || (second && oppositeDirection === undefined)
      ? "negative"
      : "positive";
  const draftAngle = authoredAngle(
    feature,
    second ? "hasSecondDirectionDraft" : "hasDraft",
    second ? "secondDirectionDraftAngle" : "draftAngle",
    second ? "secondDirectionDraftPullDirection" : "draftPullDirection",
    diagnostics,
  );
  const offset = upToOffset(feature, second ? "secondDirection" : "", diagnostics);
  const slotPrefix = second ? "secondEnd" : "firstEnd";

  switch (bound) {
    case "BLIND":
      return {
        kind: "blind",
        direction,
        distance: authoredDistance(
          quantityExpression(feature, second ? "secondDirectionDepth" : "depth"),
          diagnostics,
        ),
        draftAngle,
      };
    case "THROUGH_ALL":
      return { kind: "throughAll", direction, draftAngle };
    case "UP_TO_NEXT":
      return { kind: "upToNext", direction, offset, draftAngle };
    case "UP_TO_FACE":
    case "UP_TO_SURFACE": {
      const slot = topologySlot(
        `${slotPrefix}Face`,
        second ? "secondDirectionBoundEntityFace" : "endBoundEntityFace",
        "face",
        ["face"],
      );
      slots.push(slot);
      return {
        kind: "upToFace",
        direction,
        target: { kind: "topologySlot", slotKey: slot.key },
        offset,
        draftAngle,
      };
    }
    case "UP_TO_PART":
    case "UP_TO_BODY": {
      const slot = topologySlot(
        `${slotPrefix}Part`,
        second ? "secondDirectionBoundEntityBody" : "endBoundEntityBody",
        "body",
        ["body"],
      );
      slots.push(slot);
      return {
        kind: "upToPart",
        direction,
        target: { kind: "topologySlot", slotKey: slot.key },
        offset,
        draftAngle,
      };
    }
    case "UP_TO_VERTEX": {
      const slot = topologySlot(
        `${slotPrefix}Vertex`,
        second ? "secondDirectionBoundEntityVertex" : "endBoundEntityVertex",
        "body",
        ["vertex"],
      );
      slots.push(slot);
      return {
        kind: "upToVertex",
        direction,
        target: { kind: "topologySlot", slotKey: slot.key },
        offset,
        draftAngle,
      };
    }
    default:
      return null;
  }
}

function translateExtent(
  feature: OnshapeFeatureNode,
  diagnostics: ExtrudePlanDiagnostic[],
  slots: TopologyQuerySlot[],
): PlannedExtrudeExtent | null {
  const firstEnd = translateEnd(feature, "first", diagnostics, slots);
  if (!firstEnd) return null;
  if (booleanValue(feature, "hasSecondDirection")) {
    const secondEnd = translateEnd(feature, "second", diagnostics, slots);
    return secondEnd ? { mode: "twoSide", firstEnd, secondEnd } : null;
  }
  if ((enumValue(feature, "endBound") ?? "BLIND") === "SYMMETRIC") {
    return firstEnd.kind === "blind" || firstEnd.kind === "throughAll"
      ? { mode: "symmetric", end: firstEnd }
      : null;
  }
  return { mode: "oneSide", end: firstEnd };
}

const OPERATION_MAP: Record<string, FeatureBooleanOperation> = {
  NEW: "newBody",
  ADD: "join",
  REMOVE: "cut",
  INTERSECT: "intersect",
};

export function planExtrudeFeature(input: ExtrudePlanInput): ExtrudePlanResult {
  const diagnostics: ExtrudePlanDiagnostic[] = [];
  const { feature } = input;
  if ((enumValue(feature, "bodyType") ?? "SOLID") !== "SOLID") {
    return { tier: "baked", reason: "extrude-body-type-unsupported", diagnostics };
  }

  const profileParameter = findParameter(feature, "entities");
  if (!profileParameter) {
    return { tier: "baked", reason: "needs-region-resolution", diagnostics };
  }

  const topologySlots: TopologyQuerySlot[] = [];
  const extent = translateExtent(feature, diagnostics, topologySlots);
  if (!extent) {
    return { tier: "baked", reason: "unsupported-feature", diagnostics };
  }

  const profileResolution = resolveOnshapeSketchProfiles({
    profileParameter,
    consumerFeatureId: feature.featureId,
    featureLabel: feature.name ?? feature.featureId,
    featureKind: "extrude",
    profileEvidence: input.profileEvidence,
    solvedSketchesByFeatureId: input.solvedSketchesByFeatureId,
    referencedSketchesByFeatureId: input.referencedSketchesByFeatureId,
  });
  diagnostics.push(...profileResolution.diagnostics);
  if (profileResolution.tier === "unresolved") {
    return { tier: "baked", reason: profileResolution.reason, diagnostics };
  }

  const operationType = enumValue(feature, "operationType") ?? "NEW";
  const operation = OPERATION_MAP[operationType];
  if (!operation) {
    return { tier: "baked", reason: "unsupported-feature", diagnostics };
  }

  let boolean: PlannedExtrudeBoolean;
  if (operation === "newBody") {
    boolean = { kind: "standalone" };
  } else if (hasQueries(feature, "booleanScope")) {
    const scopeSlot = topologySlot(
      "booleanScope",
      "booleanScope",
      "targetBody",
      ["body"],
      1,
      null,
    );
    topologySlots.push(scopeSlot);
    boolean = { kind: "topologyTargets", slotKey: scopeSlot.key, targets: [] };
  } else {
    const inferred = input.inferredDefaultScopeFeatureIds ?? [];
    const candidates = inferred.length > 0
      ? inferred
      : input.priorBodyProducingFeatureIds.length === 1
        ? input.priorBodyProducingFeatureIds
        : [];
    if (candidates.length === 1) {
      boolean = { kind: "deferredBody", sourceFeatureId: candidates[0]! };
    } else if (input.priorBodyProducingFeatureIds.length > 1) {
      return {
        tier: "baked",
        reason: "extrude-default-scope-ambiguous",
        diagnostics,
      };
    } else {
      return { tier: "baked", reason: "needs-history-probe", diagnostics };
    }
  }

  const plannedExtrude: PlannedExtrude = {
    profiles: profileResolution.profiles,
    extent,
    operation: { source: "literal", value: operation },
    boolean,
    topologySlots,
  };
  return topologySlots.length > 0
    ? { tier: "topology", plannedExtrude, diagnostics }
    : { tier: "parametric", plannedExtrude, diagnostics };
}

function bindingFor(
  slotKey: string,
  bindings: readonly TopologyResolutionBinding[],
): ImportDeferredTopologyRef | null {
  return bindings.find((binding) => binding.query.slotKey === slotKey)?.deferred ?? null;
}

function resolveEnd(
  end: PlannedExtrudeEndCondition,
  bindings: readonly TopologyResolutionBinding[],
): PlannedExtrudeEndCondition | null {
  if (end.kind !== "upToFace" && end.kind !== "upToPart" && end.kind !== "upToVertex") {
    return end;
  }
  if (end.target.kind !== "topologySlot") return end;
  const target = bindingFor(end.target.slotKey, bindings);
  return target ? { ...end, target } : null;
}

/** Install exact-prefix deferred topology selectors after all slots resolve atomically. */
export function resolvePlannedExtrudeTopology(
  planned: PlannedExtrude,
  bindings: readonly TopologyResolutionBinding[],
): PlannedExtrude | null {
  let extent: PlannedExtrudeExtent;
  if (planned.extent.mode === "twoSide") {
    const firstEnd = resolveEnd(planned.extent.firstEnd, bindings);
    const secondEnd = resolveEnd(planned.extent.secondEnd, bindings);
    if (!firstEnd || !secondEnd) return null;
    extent = { mode: "twoSide", firstEnd, secondEnd };
  } else {
    const end = resolveEnd(planned.extent.end, bindings);
    if (!end) return null;
    extent = { ...planned.extent, end } as PlannedExtrudeExtent;
  }

  let boolean = planned.boolean;
  if (boolean.kind === "topologyTargets") {
    const slotKey = boolean.slotKey;
    const targets = bindings
      .filter((binding) => binding.query.slotKey === slotKey)
      .map((binding) => binding.deferred);
    if (targets.length === 0) return null;
    boolean = { ...boolean, targets };
  }
  return { ...planned, extent, boolean };
}

/** True when a resolved plan still carries live apply-time topology selectors. */
export function extrudeUsesDeferredTopology(planned: PlannedExtrude): boolean {
  return planned.topologySlots.length > 0;
}

/** Narrow cast at the provider boundary after all topology slots have resolved. */
export function resolvedExtrudeExtent(planned: PlannedExtrude): ExtrudeFeatureExtent {
  return planned.extent as unknown as ExtrudeFeatureExtent;
}
