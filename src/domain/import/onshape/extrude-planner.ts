/**
 * Extrude translation + review-time region/topology verification.
 *
 * Keeps extent and boolean-lineage concerns local while delegating reusable
 * sketch-profile and exact-prefix topology matching to the shared import seams.
 */
import type {
  ImportDeferredExtrudeEndCondition,
  ImportDeferredExtrudeExtent,
  ImportDeferredExtrudeStartExtent,
  ImportDeferredSketchPointRef,
  ImportDeferredTopologySelector,
} from "@/contracts/import/actions";
import type { OnshapeProfileEvidence } from "@/contracts/import/onshape-capture-bundle";
import type { AuthoredValue } from "@/contracts/modeling/authored-values";
import type {
  ExtrudeEndCondition,
  FeatureBooleanOperation,
  LinearExtentDirection,
  LinearUpToOffset,
} from "@/contracts/modeling/schema";
import type { SketchPlaneFrame, SketchPlaneKey } from "@/contracts/shared/sketch-plane";
import type { SketchPointId } from "@/contracts/shared/ids";
import type {
  OnshapeFeatureNode,
  OnshapeSolvedSketch,
} from "@/domain/import/onshape/bundle-reader";
import { translateOnshapeExpression } from "@/domain/import/onshape/expression-translator";
import {
  referencedSketchFeatureIdsFromProfileParameter,
  resolveOnshapeSketchProfiles,
  resolveOnshapeOpenSketchCurveProfiles,
  type DeferredOnshapeProfile,
  type DeferredOpenSketchCurveProfile,
  type ProfileResolutionDiagnostic,
} from "@/domain/import/onshape/profile-resolver";
import type { TopologyResolutionBinding } from "@/domain/import/onshape/topology-reference-resolver";
import type { TopologyQuerySlot } from "@/domain/import/onshape/topology-query-reader";
import { readSketchEntityVertexQuery } from "@/domain/import/onshape/sketch-point-query-reader";
import { translateSolvedSketch } from "@/domain/import/onshape/solved-sketch-projection";

export type PlannedExtrudeProfile = DeferredOnshapeProfile;

interface PlannedTopologyTarget {
  kind: "topologySlot";
  slotKey: string;
}

/**
 * Exact authored sketch point that terminates an up-to-vertex extent. It is
 * resolved from the consumer's own decoded query, not from live topology, so it
 * carries the producing Onshape sketch feature id until the provider can bind
 * that feature's committed sketch id.
 */
export interface PlannedSketchPointExtentTarget {
  kind: "sketchPointFromFeature";
  sketchFeatureId: string;
  pointId: SketchPointId;
}

type PlannedExtrudeTarget =
  | PlannedTopologyTarget
  | PlannedSketchPointExtentTarget
  | ImportDeferredTopologySelector
  | ImportDeferredSketchPointRef;

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

/**
 * Onshape's `startOffset` start bound, translated exactly. A sketch-point
 * offset carries its producing sketch feature id until the provider binds that
 * feature's committed sketch id, exactly like the up-to-vertex terminator. An
 * entity offset names a live body edge or face through a topology slot resolved
 * against the exact pre-consumer prefix.
 */
export type PlannedExtrudeStartExtent =
  | { kind: "profilePlane" }
  | {
      kind: "blindOffset";
      distance: AuthoredValue<number>;
      direction: LinearExtentDirection;
    }
  | {
      kind: "sketchPointOffset";
      target: PlannedSketchPointExtentTarget | ImportDeferredSketchPointRef;
    }
  | {
      kind: "entityOffset";
      target:
        | { kind: "topologySlot"; slotKey: string }
        | Extract<ImportDeferredExtrudeStartExtent, { kind: "entityOffset" }>["target"];
    };
export type PlannedExtrudeBoolean =
  | { kind: "standalone" }
  | { kind: "deferredBody"; sourceFeatureId: string }
  | {
      kind: "topologyTargets";
      slotKey: string;
      targets: readonly ImportDeferredTopologySelector[];
    };

interface PlannedExtrudeShared {
  extent: PlannedExtrudeExtent;
  startExtent: PlannedExtrudeStartExtent;
  /** Active topology roles resolved atomically against the exact pre-consumer prefix. */
  topologySlots: readonly TopologyQuerySlot[];
}

export interface PlannedSolidExtrude extends PlannedExtrudeShared {
  resultBodyType: "solid";
  /** Ordered exact query results; each profile carries its own source sketch or face identity. */
  profiles: PlannedExtrudeProfile[];
  operation: AuthoredValue<FeatureBooleanOperation>;
  boolean: PlannedExtrudeBoolean;
}

/** Surface extrudes create one sheet body, so no boolean state is representable. */
export interface PlannedSurfaceExtrude extends PlannedExtrudeShared {
  resultBodyType: "surface";
  /** Ordered durable open sketch curves forming exactly one connected chain. */
  profiles: DeferredOpenSketchCurveProfile[];
}

export type PlannedExtrude = PlannedSolidExtrude | PlannedSurfaceExtrude;

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
        | "extrude-start-extent-unsupported"
        | "extrude-default-scope-ambiguous"
        | "extrude-surface-operation-unsupported"
        | "extrude-surface-draft-unsupported"
        | "extrude-surface-profile-unresolved"
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

/**
 * Resolve an `UP_TO_VERTEX` bound whose query names a sketch entity endpoint.
 *
 * Onshape expresses this terminator against sketch geometry, not against a
 * built body, so it can never resolve through live-topology matching. The
 * query is decoded exactly and mapped onto the same translated sketch the
 * provider commits, yielding the precise authored point. Anything that is not
 * an exact single-query sketch-entity vertex over an already-parametric sketch
 * returns `null` and leaves the caller on the topology-slot path.
 */
function resolveSketchPointExtentTarget(
  feature: OnshapeFeatureNode,
  parameterId: string,
  input: ExtrudePlanInput,
): PlannedSketchPointExtentTarget | null {
  const queries = findParameter(feature, parameterId)?.queries;
  if (!Array.isArray(queries) || queries.length !== 1) return null;
  const query = queries[0] as { queryString?: unknown } | null;
  const decoded = readSketchEntityVertexQuery(
    typeof query?.queryString === "string" ? query.queryString : null,
  );
  if (!decoded) return null;

  const solved = input.solvedSketchesByFeatureId.get(decoded.sketchFeatureId);
  const sketchPlan = input.referencedSketchesByFeatureId.get(decoded.sketchFeatureId);
  if (!solved || sketchPlan?.tier !== "parametric") return null;

  const translation = translateSolvedSketch({
    solved,
    featureId: decoded.sketchFeatureId,
    label: decoded.sketchFeatureId,
    planeKey: sketchPlan.planeKey,
    planeFrame: sketchPlan.planeFrame,
  });
  const entity = translation.definition.entities.find(
    (candidate) => candidate.label === decoded.sketchEntityId,
  );
  if (!entity) return null;

  // Read the point the translated entity actually owns, so coincident-point
  // normalization is followed rather than re-derived.
  const pointId =
    decoded.role === "start" && "startPointId" in entity
      ? entity.startPointId
      : decoded.role === "end" && "endPointId" in entity
        ? entity.endPointId
        : decoded.role === "center" && "centerPointId" in entity
          ? entity.centerPointId
          : decoded.role === "point" && entity.kind === "point"
            ? entity.pointId
            : null;
  if (!pointId) return null;

  return {
    kind: "sketchPointFromFeature",
    sketchFeatureId: decoded.sketchFeatureId,
    pointId,
  };
}

/**
 * Translate Onshape's start bound. `startOffset=false` starts on the profile
 * plane. `startOffsetBound=ENTITY` with exactly one decodable sketch-entity
 * vertex query becomes an exact `sketchPointOffset`; an `ENTITY` bound whose
 * query names live body topology becomes an `entityOffset` bound to a topology
 * slot, resolved exactly against the pre-consumer prefix.
 *
 * `startOffsetBound=BLIND` displaces the start plane by `startOffsetDistance`.
 * The contract's `blindOffset.direction` is signed along the EXTRUDE direction
 * (`ExtrudeEndCondition.direction` already flips the profile normal), so the
 * authored sign has to be pinned against ground truth rather than assumed. The
 * `9841e486906fa2ce62d74d8e` capture pins it exactly, on both of its BLIND
 * instances, by projecting the rollback tessellation onto the extrude direction
 * u = (0, 0.8660254037844385, -0.5000000000000004):
 *
 * - `Extrude 10` (`FnqLWtKC5loyWcj_1`, snapshots 17 → 18 on body `JbH`):
 *   profile sketch `Sketch 7` lies on the plane u = 0 (its `sketchMatrix`
 *   normal is -u through the origin) and `oppositeDirection=true`, so the
 *   extrude direction is +u. The six added start caps (facet normal -u) all sit
 *   at u = +2.000000 mm and the end caps at u = 17.000000 mm (the
 *   `UP_TO_SURFACE` face `JhK` plane). Authored `startOffsetDistance=2 mm`,
 *   `startOffsetOppositeDirection=true`.
 * - `Extrude 11` (`FarVWY13vdeW4u9_1`, snapshots 18 → 19 on body `JbD`):
 *   its profile is `Extrude 10`'s end cap at u = 17.000000 mm and
 *   `oppositeDirection=false`, so the extrude direction is again +u. Its added
 *   start caps sit at u = 17.200000 mm. Authored
 *   `startOffsetDistance=#tolerance*2` (= 0.2 mm),
 *   `startOffsetOppositeDirection=false`.
 *
 * Both instances therefore displace the start plane by exactly
 * `+startOffsetDistance` ALONG the extrude direction, and in both
 * `startOffsetOppositeDirection` equals `oppositeDirection`. That is all the
 * capture set discriminates: when the two flags disagree the observed data
 * cannot separate "offset along the un-flipped profile normal, negated by
 * `startOffsetOppositeDirection`" from "offset always along the extrude
 * direction", which are the two conventions consistent with both instances.
 * That combination therefore stays baked instead of guessing a sign that would
 * displace geometry.
 *
 * Every other authored form returns `null` so the caller bakes with a specific
 * reason; nothing is inferred and no distance sign is guessed.
 */
function translateStartExtent(
  feature: OnshapeFeatureNode,
  input: ExtrudePlanInput,
  slots: TopologyQuerySlot[],
  diagnostics: ExtrudePlanDiagnostic[],
): PlannedExtrudeStartExtent | null {
  if (!booleanValue(feature, "startOffset")) return { kind: "profilePlane" };
  const bound = enumValue(feature, "startOffsetBound");
  if (bound === "BLIND") {
    // The pinned displacement is measured along the first direction's extrude
    // direction, so a symmetric or two-sided extent names no single start plane.
    if (booleanValue(feature, "hasSecondDirection")) return null;
    if (isSymmetricExtrude(feature)) return null;
    if (
      booleanValue(feature, "startOffsetOppositeDirection") !==
      booleanValue(feature, "oppositeDirection")
    ) {
      return null;
    }
    return {
      kind: "blindOffset",
      distance: authoredDistance(
        quantityExpression(feature, "startOffsetDistance"),
        diagnostics,
      ),
      direction: "positive",
    };
  }
  if (bound !== "ENTITY") return null;
  const target = resolveSketchPointExtentTarget(
    feature,
    "startOffsetEntity",
    input,
  );
  if (target) return { kind: "sketchPointOffset", target };
  if (!hasQueries(feature, "startOffsetEntity")) return null;
  const slot = topologySlot(
    "startEntity",
    "startOffsetEntity",
    "edge",
    ["edge", "face"],
  );
  slots.push(slot);
  return { kind: "entityOffset", target: { kind: "topologySlot", slotKey: slot.key } };
}
function translateEnd(
  feature: OnshapeFeatureNode,
  side: "first" | "second",
  diagnostics: ExtrudePlanDiagnostic[],
  slots: TopologyQuerySlot[],
  input: ExtrudePlanInput,
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
      const parameterId = second
        ? "secondDirectionBoundEntityVertex"
        : "endBoundEntityVertex";
      const sketchPointTarget = resolveSketchPointExtentTarget(
        feature,
        parameterId,
        input,
      );
      if (sketchPointTarget) {
        return {
          kind: "upToVertex",
          direction,
          target: sketchPointTarget,
          offset,
          draftAngle,
        };
      }
      const slot = topologySlot(
        `${slotPrefix}Vertex`,
        parameterId,
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

function isSymmetricExtrude(feature: OnshapeFeatureNode): boolean {
  return (
    booleanValue(feature, "symmetric") ||
    (enumValue(feature, "endBound") ?? "BLIND") === "SYMMETRIC"
  );
}

function halvedDistance(distance: AuthoredValue<number>): AuthoredValue<number> {
  return distance.source === "literal"
    ? { source: "literal", value: distance.value / 2 }
    : { source: "expression", valueText: `((${distance.valueText}) / 2)` };
}

function translateExtent(
  feature: OnshapeFeatureNode,
  diagnostics: ExtrudePlanDiagnostic[],
  slots: TopologyQuerySlot[],
  input: ExtrudePlanInput,
): PlannedExtrudeExtent | null {
  const firstEnd = translateEnd(feature, "first", diagnostics, slots, input);
  if (!firstEnd) return null;
  if (booleanValue(feature, "hasSecondDirection")) {
    const secondEnd = translateEnd(feature, "second", diagnostics, slots, input);
    return secondEnd ? { mode: "twoSide", firstEnd, secondEnd } : null;
  }
  // Onshape's `symmetric` flag distributes the authored blind depth evenly about
  // the profile plane: the `d3cd9b09c3c36af1dd2efae9` `Extrude 4` sheet authors
  // `depth = 50 mm, symmetric = true` and its captured rollback body spans
  // z ∈ [-25 mm, +25 mm]. Cadara's symmetric extent applies its end distance in
  // BOTH directions, so the faithful translation halves the authored depth.
  if (isSymmetricExtrude(feature)) {
    if (firstEnd.kind === "throughAll") return { mode: "symmetric", end: firstEnd };
    return firstEnd.kind === "blind"
      ? {
          mode: "symmetric",
          end: { ...firstEnd, distance: halvedDistance(firstEnd.distance) },
        }
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

/**
 * Plan an Onshape `bodyType: SURFACE` extrude as a surface extrude feature. The
 * surface contract carries no boolean state and the adapter cannot draft a swept
 * sheet, so a non-`NEW` surface operation or an authored draft angle bakes with
 * its own reason instead of dropping authored intent.
 */
function planSurfaceExtrude(
  input: ExtrudePlanInput,
  diagnostics: ExtrudePlanDiagnostic[],
  startExtent: PlannedExtrudeStartExtent,
  extent: PlannedExtrudeExtent,
  topologySlots: TopologyQuerySlot[],
): ExtrudePlanResult {
  const { feature } = input;
  const operationType =
    enumValue(feature, "surfaceOperationType") ??
    enumValue(feature, "operationType") ??
    "NEW";
  if (operationType !== "NEW") {
    return { tier: "baked", reason: "extrude-surface-operation-unsupported", diagnostics };
  }
  const ends =
    extent.mode === "twoSide" ? [extent.firstEnd, extent.secondEnd] : [extent.end];
  if (ends.some((end) => end.draftAngle !== undefined)) {
    return { tier: "baked", reason: "extrude-surface-draft-unsupported", diagnostics };
  }

  const profileResolution = resolveOnshapeOpenSketchCurveProfiles({
    profileParameter: findParameter(feature, "surfaceEntities"),
    featureKind: "surface extrude",
    featureLabel: feature.name ?? feature.featureId,
    solvedSketchesByFeatureId: input.solvedSketchesByFeatureId,
    referencedSketchesByFeatureId: input.referencedSketchesByFeatureId,
  });
  diagnostics.push(...profileResolution.diagnostics);
  if (profileResolution.tier === "unresolved") {
    return { tier: "baked", reason: "extrude-surface-profile-unresolved", diagnostics };
  }

  const plannedExtrude: PlannedSurfaceExtrude = {
    resultBodyType: "surface",
    profiles: profileResolution.profiles,
    extent,
    startExtent,
    topologySlots,
  };
  return topologySlots.length > 0
    ? { tier: "topology", plannedExtrude, diagnostics }
    : { tier: "parametric", plannedExtrude, diagnostics };
}

export function planExtrudeFeature(input: ExtrudePlanInput): ExtrudePlanResult {
  const diagnostics: ExtrudePlanDiagnostic[] = [];
  const { feature } = input;
  const bodyType = enumValue(feature, "bodyType") ?? "SOLID";
  if (bodyType !== "SOLID" && bodyType !== "SURFACE") {
    return { tier: "baked", reason: "extrude-body-type-unsupported", diagnostics };
  }

  const topologySlots: TopologyQuerySlot[] = [];
  // Onshape's `startOffset` moves the prism's START plane off the profile
  // plane. The `ENTITY` form names either an exact sketch point (translated to
  // the contract's `sketchPointOffset`) or live body topology (translated to an
  // `entityOffset` bound to a resolved topology slot); the `BLIND` form carries
  // the capture-pinned signed distance. Every form whose displacement this
  // capture set cannot pin against ground truth stays baked rather than building
  // a solid displaced by a guessed offset.
  const startExtent = translateStartExtent(
    feature,
    input,
    topologySlots,
    diagnostics,
  );
  if (!startExtent) {
    return { tier: "baked", reason: "extrude-start-extent-unsupported", diagnostics };
  }

  if (bodyType === "SURFACE") {
    const extent = translateExtent(feature, diagnostics, topologySlots, input);
    if (!extent) {
      return { tier: "baked", reason: "unsupported-feature", diagnostics };
    }
    return planSurfaceExtrude(input, diagnostics, startExtent, extent, topologySlots);
  }

  const profileParameter = findParameter(feature, "entities");
  if (!profileParameter) {
    return { tier: "baked", reason: "needs-region-resolution", diagnostics };
  }

  const extent = translateExtent(feature, diagnostics, topologySlots, input);
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

  const plannedExtrude: PlannedSolidExtrude = {
    resultBodyType: "solid",
    profiles: profileResolution.profiles,
    extent,
    startExtent,
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
): ImportDeferredTopologySelector | null {
  const deferred = bindings.find((binding) => binding.query.slotKey === slotKey)?.deferred;
  return deferred?.kind === "bodyOf" || deferred?.kind === "bodyOfSourceFeature" ? null : deferred ?? null;
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

  // The start plane's entity is one more slot in the same atomic resolution: an
  // unbound slot fails the whole plan rather than silently starting the prism on
  // the profile plane.
  let startExtent = planned.startExtent;
  if (startExtent.kind === "entityOffset" && startExtent.target.kind === "topologySlot") {
    const target = bindingFor(startExtent.target.slotKey, bindings);
    if (!target) return null;
    // A start plane can only be fixed by an edge or a face; a slot that resolved
    // to a body or vertex names no plane, so the whole plan fails honestly.
    if (target.expectedKind !== "edge" && target.expectedKind !== "face") return null;
    startExtent = { kind: "entityOffset", target: { ...target, expectedKind: target.expectedKind } };
  }

  if (planned.resultBodyType === "surface") {
    return { ...planned, extent, startExtent };
  }

  let boolean = planned.boolean;
  if (boolean.kind === "topologyTargets") {
    const slotKey = boolean.slotKey;
    const targets = bindings.flatMap((binding) =>
      binding.query.slotKey === slotKey &&
      binding.deferred.kind !== "bodyOf" &&
      binding.deferred.kind !== "bodyOfSourceFeature"
        ? [binding.deferred]
        : [],
    );
    if (targets.length === 0) return null;
    boolean = { ...boolean, targets };
  }
  return { ...planned, extent, startExtent, boolean };
}

function endHasUnresolvedTopology(
  end: PlannedExtrudeEndCondition,
): boolean {
  return (
    (end.kind === "upToFace" || end.kind === "upToPart" || end.kind === "upToVertex") &&
    end.target.kind === "topologySlot"
  );
}

/** True only while an extent target or explicit boolean scope still needs prefix resolution. */
export function hasUnresolvedExtrudeTopology(planned: PlannedExtrude): boolean {
  const unresolvedExtent =
    planned.extent.mode === "twoSide"
      ? endHasUnresolvedTopology(planned.extent.firstEnd) ||
        endHasUnresolvedTopology(planned.extent.secondEnd)
      : endHasUnresolvedTopology(planned.extent.end);
  return unresolvedExtent ||
    (planned.startExtent.kind === "entityOffset" &&
      planned.startExtent.target.kind === "topologySlot") ||
    (planned.resultBodyType === "solid" &&
      planned.boolean.kind === "topologyTargets" &&
      planned.boolean.targets.length === 0);
}

/** True when a resolved plan still carries live apply-time topology selectors. */
export function extrudeUsesDeferredTopology(planned: PlannedExtrude): boolean {
  return planned.topologySlots.length > 0;
}

function isPreparedExtrudeEnd(
  end: PlannedExtrudeEndCondition,
): end is PlannedExtrudeEndCondition & ImportDeferredExtrudeEndCondition {
  return (
    (end.kind !== "upToFace" &&
      end.kind !== "upToPart" &&
      end.kind !== "upToVertex") ||
    (end.target.kind !== "topologySlot" &&
      end.target.kind !== "sketchPointFromFeature")
  );
}

function isPreparedExtrudeExtent(
  extent: PlannedExtrudeExtent,
): extent is PlannedExtrudeExtent & ImportDeferredExtrudeExtent {
  if (extent.mode === "twoSide") {
    return (
      isPreparedExtrudeEnd(extent.firstEnd) &&
      isPreparedExtrudeEnd(extent.secondEnd)
    );
  }
  return isPreparedExtrudeEnd(extent.end);
}

function endSketchPointExtentFeatureId(
  end: PlannedExtrudeEndCondition,
): string | null {
  return (end.kind === "upToFace" ||
    end.kind === "upToPart" ||
    end.kind === "upToVertex") &&
    end.target.kind === "sketchPointFromFeature"
    ? end.target.sketchFeatureId
    : null;
}

/**
 * True when this extrude's up-to-vertex bound names a sketch entity vertex
 * whose owning sketch is live now but was not when the extrude was planned. The
 * plan must be recomputed for the exact terminator to be readable at all.
 */
export function extrudeAwaitsLiveSketchPointExtent(
  feature: OnshapeFeatureNode,
  input: ExtrudePlanInput,
): boolean {
  return [
    "endBoundEntityVertex",
    "secondDirectionBoundEntityVertex",
    // A start offset's entity is read by the same decoder and is live-gated the
    // same way, so it must also trigger a replan once its sketch is live.
    "startOffsetEntity",
  ].some(
    (parameterId) =>
      resolveSketchPointExtentTarget(feature, parameterId, input) !== null,
  );
}

/** Onshape sketch features whose committed sketch ids an extent still needs. */
export function extrudeSketchPointExtentFeatureIds(
  planned: PlannedExtrude,
): readonly string[] {
  const ends =
    planned.extent.mode === "twoSide"
      ? [planned.extent.firstEnd, planned.extent.secondEnd]
      : [planned.extent.end];
  const startFeatureId =
    planned.startExtent.kind === "sketchPointOffset" &&
    planned.startExtent.target.kind === "sketchPointFromFeature"
      ? planned.startExtent.target.sketchFeatureId
      : null;
  return [
    ...new Set([
      ...ends.flatMap((end) => {
        const featureId = endSketchPointExtentFeatureId(end);
        return featureId ? [featureId] : [];
      }),
      ...(startFeatureId ? [startFeatureId] : []),
    ]),
  ];
}

function bindEndSketchPoint(
  end: PlannedExtrudeEndCondition,
  sketchActionIndexByFeatureId: ReadonlyMap<string, number>,
): PlannedExtrudeEndCondition {
  const featureId = endSketchPointExtentFeatureId(end);
  if (featureId === null) return end;
  const actionIndex = sketchActionIndexByFeatureId.get(featureId);
  if (actionIndex === undefined) return end;
  const target = (end as { target: PlannedSketchPointExtentTarget }).target;
  return {
    ...end,
    target: {
      kind: "sketchPoint" as const,
      sketchId: { kind: "sketchIdOf" as const, actionIndex },
      pointId: target.pointId,
    },
  } as PlannedExtrudeEndCondition;
}

/**
 * Bind a sketch-point start offset to its committed producing sketch action.
 * An unbound sketch-point offset can never be prepared, so it throws exactly
 * like an unresolved extent target rather than degrading to the profile plane.
 * An entity offset carries its resolved apply-time selector through unchanged;
 * an unresolved slot throws for the same reason.
 */
export function resolvedExtrudeStartExtent(
  planned: PlannedExtrude,
  sketchActionIndexByFeatureId: ReadonlyMap<string, number> = new Map(),
): ImportDeferredExtrudeStartExtent {
  const startExtent = planned.startExtent;
  if (startExtent.kind === "entityOffset") {
    if (startExtent.target.kind === "topologySlot") {
      throw new Error(
        "Extrude start extent references an unresolved topology slot and cannot be prepared.",
      );
    }
    return { kind: "entityOffset", target: startExtent.target };
  }
  if (startExtent.kind !== "sketchPointOffset") return startExtent;
  if (startExtent.target.kind !== "sketchPointFromFeature") {
    return { kind: "sketchPointOffset", target: startExtent.target };
  }
  const actionIndex = sketchActionIndexByFeatureId.get(
    startExtent.target.sketchFeatureId,
  );
  if (actionIndex === undefined) {
    throw new Error(
      "Extrude start extent references a sketch point whose producing sketch is not committed.",
    );
  }
  return {
    kind: "sketchPointOffset",
    target: {
      kind: "sketchPoint",
      sketchId: { kind: "sketchIdOf", actionIndex },
      pointId: startExtent.target.pointId,
    },
  };
}
/**
 * Reject planner-only slots while retaining apply-time topologyOf selectors and
 * binding sketch-point terminators to their committed producing sketch action.
 */
export function resolvedExtrudeExtent(
  planned: PlannedExtrude,
  sketchActionIndexByFeatureId: ReadonlyMap<string, number> = new Map(),
): ImportDeferredExtrudeExtent {
  const bound: PlannedExtrudeExtent =
    planned.extent.mode === "twoSide"
      ? {
          mode: "twoSide",
          firstEnd: bindEndSketchPoint(
            planned.extent.firstEnd,
            sketchActionIndexByFeatureId,
          ),
          secondEnd: bindEndSketchPoint(
            planned.extent.secondEnd,
            sketchActionIndexByFeatureId,
          ),
        }
      : ({
          ...planned.extent,
          end: bindEndSketchPoint(planned.extent.end, sketchActionIndexByFeatureId),
        } as PlannedExtrudeExtent);

  if (!isPreparedExtrudeExtent(bound)) {
    throw new Error(
      "Extrude extent contains unresolved topologySlot or sketch-point targets and cannot be prepared.",
    );
  }
  return bound;
}
