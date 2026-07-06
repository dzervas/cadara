/**
 * Fidelity planner (probe-absent v1 — the shipped path).
 *
 * Walks the Onshape history in order and assigns each entry a translation tier
 * with honest reason codes. Because no sandboxed history probe exists yet
 * (Decision 5 amendment), any feature that needs mid-history topological
 * resolution — solid features consuming faces/edges/bodies, and sketches on
 * non-datum planes — degrades to `baked` with a `capability` reason. Variables
 * and sketches on canonical datum planes translate parametrically probe-free.
 *
 * Baked-tier v1 semantics (capture v1 has no per-feature rollback snapshots):
 * the studio's final-state body is the only bakeable geometry, so the first
 * baked solid marks the studio bake and later solids import suppressed.
 */
import type {
  OnshapePartStudioCapture,
  OnshapeResolvedReference,
} from "@/contracts/import/onshape-capture-bundle";
import type { SketchPlaneKey } from "@/contracts/shared/sketch-plane";

import type {
  OnshapeFeatureNode,
  StudioReadResult,
} from "@/domain/import/onshape/bundle-reader";
import { interpretResolvedReference } from "@/domain/import/onshape/signature-interpreter";

export type FidelityTier = "parametric" | "baked" | "geometryOnly";

export type PlanReasonCode =
  | "sketch-on-canonical-plane"
  | "document-variable"
  // Consumes a sketch region; blocked by post-commit region resolution across
  // prepared actions (no cross-action correlation mechanism yet), not the probe.
  | "needs-region-resolution"
  // Consumes body faces/edges/bodies mid-history; needs the sandboxed probe.
  | "needs-history-probe"
  | "custom-feature"
  | "unsupported-feature"
  | "downstream-of-baked"
  | "unreadable-feature";

export type PlannedTarget =
  | { kind: "sketch"; planeKey: SketchPlaneKey }
  | { kind: "variable" }
  | { kind: "bakedBody" }
  | { kind: "suppressed" };

export interface FeaturePlan {
  onshapeFeatureId: string;
  featureType: string;
  label: string;
  tier: FidelityTier;
  target: PlannedTarget;
  reasonCodes: PlanReasonCode[];
  /** True when the feature was suppressed in Onshape or degraded downstream. */
  suppressed: boolean;
}

export interface StudioPlan {
  featurePlans: FeaturePlan[];
  /** Whether a whole-studio baked body should represent non-parametric geometry. */
  requiresStudioBake: boolean;
  tierCounts: Record<FidelityTier, number>;
}

// Sketch-region-consuming features. These would be parametric on a
// canonical-plane sketch, but reference the sketch region produced only at
// commit time; without a cross-action correlation mechanism the provider
// cannot bind the region, so they degrade with `needs-region-resolution`.
const REGION_CONSUMING_FEATURES = new Set([
  "extrude",
  "revolve",
  "sweep",
  "loft",
  "thicken",
]);

// Body-topology-consuming features (faces/edges/bodies mid-history). These
// genuinely require the sandboxed history probe to resolve references.
const TOPOLOGY_DEPENDENT_FEATURES = new Set([
  "chamfer",
  "fillet",
  "shell",
  "cPlane",
  "transform",
  "splitPart",
  "split",
  "booleanBodies",
  "deleteBodies",
  "hole",
  "mirror",
]);

function degradationReason(featureType: string): PlanReasonCode {
  if (REGION_CONSUMING_FEATURES.has(featureType)) {
    return "needs-region-resolution";
  }
  if (TOPOLOGY_DEPENDENT_FEATURES.has(featureType)) {
    return "needs-history-probe";
  }
  return "custom-feature";
}

function referenceMap(
  references: readonly OnshapeResolvedReference[],
): ReadonlyMap<string, OnshapeResolvedReference> {
  const map = new Map<string, OnshapeResolvedReference>();
  for (const reference of references) {
    map.set(reference.deterministicId, reference);
  }
  return map;
}

/**
 * Defensively extract the first deterministic id referenced by a `sketchPlane`
 * parameter query on a newSketch feature.
 */
export function extractSketchPlaneDeterministicId(
  feature: OnshapeFeatureNode,
): string | null {
  for (const parameter of feature.parameters ?? []) {
    if (
      typeof parameter !== "object" ||
      parameter === null ||
      (parameter as { parameterId?: unknown }).parameterId !== "sketchPlane"
    ) {
      continue;
    }
    const queries = (parameter as { queries?: unknown }).queries;
    if (!Array.isArray(queries)) {
      continue;
    }
    for (const query of queries) {
      const ids = (query as { deterministicIds?: unknown }).deterministicIds;
      if (Array.isArray(ids) && typeof ids[0] === "string") {
        return ids[0];
      }
    }
  }
  return null;
}

/**
 * Defensively read the `name` parameter of an assignVariable feature so the
 * fidelity report shows the authored variable name rather than a generic
 * feature label.
 */
export function extractVariableName(
  feature: OnshapeFeatureNode,
): string | null {
  for (const parameter of feature.parameters ?? []) {
    if (
      typeof parameter === "object" &&
      parameter !== null &&
      (parameter as { parameterId?: unknown }).parameterId === "name" &&
      typeof (parameter as { value?: unknown }).value === "string"
    ) {
      const value = (parameter as { value: string }).value.trim();
      if (value) {
        return value;
      }
    }
  }
  return null;
}

function planSketch(
  feature: OnshapeFeatureNode,
  refs: ReadonlyMap<string, OnshapeResolvedReference>,
): { target: PlannedTarget; tier: FidelityTier; reason: PlanReasonCode } {
  const planeId = extractSketchPlaneDeterministicId(feature);
  const reference = planeId ? refs.get(planeId) : undefined;

  if (reference) {
    const resolution = interpretResolvedReference(reference);
    if (resolution.kind === "canonicalPlane") {
      return {
        target: { kind: "sketch", planeKey: resolution.planeKey },
        tier: "parametric",
        reason: "sketch-on-canonical-plane",
      };
    }
  } else if (!planeId) {
    // No plane query recorded: default to the Top (XY) datum, which cadara
    // always provides. This matches Onshape's default sketch plane behavior.
    return {
      target: { kind: "sketch", planeKey: "xy" },
      tier: "parametric",
      reason: "sketch-on-canonical-plane",
    };
  }

  return {
    target: { kind: "suppressed" },
    tier: "baked",
    reason: "needs-history-probe",
  };
}

/**
 * Produce the per-feature translation plan for a read Part Studio. Pure and
 * deterministic; the provider consumes this to emit actions and render the
 * fidelity report.
 */
export function planStudioFidelity(read: StudioReadResult): StudioPlan {
  const studio: OnshapePartStudioCapture = read.studio;
  const refs = referenceMap(studio.resolvedReferences);
  const featurePlans: FeaturePlan[] = [];
  let sawBaked = false;

  for (const feature of read.features) {
    const label = feature.name ?? feature.featureId;
    const onshapeSuppressed = feature.suppressed === true;

    if (feature.featureType === "assignVariable") {
      const variableName = extractVariableName(feature);
      featurePlans.push({
        onshapeFeatureId: feature.featureId,
        featureType: feature.featureType,
        label: variableName ?? label,
        tier: "parametric",
        target: { kind: "variable" },
        reasonCodes: ["document-variable"],
        suppressed: onshapeSuppressed,
      });
      continue;
    }

    if (feature.featureType === "newSketch") {
      const sketchPlan = planSketch(feature, refs);
      if (sketchPlan.tier === "baked") {
        sawBaked = true;
      }
      featurePlans.push({
        onshapeFeatureId: feature.featureId,
        featureType: feature.featureType,
        label,
        tier: sketchPlan.tier,
        target: sketchPlan.target,
        reasonCodes: [sketchPlan.reason],
        suppressed: onshapeSuppressed || sketchPlan.tier === "baked",
      });
      continue;
    }

    // Any recognized-or-unknown solid feature degrades in probe-less v1, with a
    // reason code that distinguishes region-resolution blockers from true
    // topology-probe blockers and custom features.
    const reason: PlanReasonCode = degradationReason(feature.featureType);
    const downstream = sawBaked;
    sawBaked = true;
    featurePlans.push({
      onshapeFeatureId: feature.featureId,
      featureType: feature.featureType,
      label,
      tier: "baked",
      target: { kind: downstream ? "suppressed" : "bakedBody" },
      reasonCodes: downstream ? [reason, "downstream-of-baked"] : [reason],
      suppressed: true,
    });
  }

  const tierCounts: Record<FidelityTier, number> = {
    parametric: 0,
    baked: 0,
    geometryOnly: 0,
  };
  for (const plan of featurePlans) {
    tierCounts[plan.tier] += 1;
  }

  return {
    featurePlans,
    requiresStudioBake: sawBaked && studio.groundTruth.hasBodies,
    tierCounts,
  };
}
