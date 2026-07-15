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

import type { OnshapeFeatureNode, StudioReadResult } from "@/domain/import/onshape/bundle-reader";
import {
  createOnshapeFeatureTranslatorRegistry,
  type FidelityPlanningState,
} from "@/domain/import/onshape/feature-translator-registry";
import { extrudeFeatureTranslator } from "@/domain/import/onshape/extrude-feature-translator";
import { fallbackFeatureTranslator, planeFeatureTranslator } from "@/domain/import/onshape/fallback-feature-translator";
import { sketchFeatureTranslator } from "@/domain/import/onshape/sketch-feature-translator";
import { variableFeatureTranslator } from "@/domain/import/onshape/variable-feature-translator";
import type { PlannedExtrude } from "@/domain/import/onshape/extrude-planner";
import type { PlannedRevolve } from "@/domain/import/onshape/wave-a-feature-translators";
import {
  loftFeatureTranslator,
  revolveFeatureTranslator,
  sweepFeatureTranslator,
  thickenFeatureTranslator,
} from "@/domain/import/onshape/wave-a-feature-translators";
import {
  booleanBodiesFeatureTranslator,
  chamferFeatureTranslator,
  deleteBodiesFeatureTranslator,
  filletFeatureTranslator,
  holeFeatureTranslator,
  mirrorFeatureTranslator,
  shellFeatureTranslator,
  splitFeatureTranslator,
  transformFeatureTranslator,
  type PlannedBodyTopologyConsumer,
} from "@/domain/import/onshape/wave-b-body-feature-translators";

export const onshapeFeatureTranslatorRegistry = createOnshapeFeatureTranslatorRegistry({
  translators: [
    variableFeatureTranslator,
    sketchFeatureTranslator,
    planeFeatureTranslator,
    extrudeFeatureTranslator,
    revolveFeatureTranslator,
    thickenFeatureTranslator,
    sweepFeatureTranslator,
    loftFeatureTranslator,
    booleanBodiesFeatureTranslator,
    deleteBodiesFeatureTranslator,
    filletFeatureTranslator,
    chamferFeatureTranslator,
    shellFeatureTranslator,
    holeFeatureTranslator,
    mirrorFeatureTranslator,
    transformFeatureTranslator,
    splitFeatureTranslator,
  ],
  fallback: fallbackFeatureTranslator,
});
export type FidelityTier = "parametric" | "baked" | "geometryOnly";

export type PlanReasonCode =
  | "sketch-on-canonical-plane"
  | "document-variable"
  // Consumes a sketch region; blocked by post-commit region resolution across
  // prepared actions (no cross-action correlation mechanism yet), not the probe.
  | "needs-region-resolution"
  // Consumes body faces/edges/bodies mid-history; needs the sandboxed probe.
  | "needs-history-probe"
  | "sketch-on-probed-face"
  | "sketch-on-captured-frame"
  // A cPlane translated to a parametric plane feature from its captured frame.
  | "plane-from-captured-frame"
  // A sketch rewired onto a translated plane feature via a deferred construction.
  | "sketch-on-translated-plane"
  // A captured-frame sketch promotion whose fabricated construction support did
  // not survive a real kernel history probe; demoted back to baked.
  | "captured-frame-unresolvable"
  | "translator-unavailable"
  | "custom-feature"
  | "unsupported-feature"
  | "downstream-of-baked"
  | "unreadable-feature"
  | "revolve-axis-unresolved"
  | "thicken-requires-topology"
  | "sweep-path-unresolved"
  | "loft-profile-unresolved"
  | "boolean-offset-unsupported"
  | "boolean-operation-unsupported"
  | "mirror-operation-unsupported"
  | "mirror-plane-unresolved"
  | "transform-copy-unsupported"
  | "transform-rotation-unsupported"
  | "transform-translation-unreadable"
  | "transform-reference-unresolved"
  | "transform-type-unsupported"
  | "split-face-tool-unsupported"
  | "split-one-side-unsupported"
  | "topology-query-unreadable"
  | "topology-history-evidence-missing"
  | "topology-source-query-unresolved"
  | "topology-source-kind-mismatch"
  | "topology-reference-no-match"
  | "topology-reference-ambiguous"
  | "topology-durable-naming-unavailable"
  | "topology-upstream-baked"
  | "topology-apply-rematch-failed"
  | "topology-bake-snapshot-missing"
  | "fillet-radius-unreadable"
  | "chamfer-method-unsupported"
  | "chamfer-style-unsupported"
  | "chamfer-direction-overrides-unsupported"
  | "chamfer-width-unreadable"
  | "shell-non-hollow-unsupported"
  | "shell-hollow-without-openings"
  | "shell-thickness-unreadable"
  | "hole-style-unsupported"
  | "hole-diameter-unreadable"
  | "hole-executor-unavailable"
  | "sheet-metal-unsupported"
  | "surface-modeling-unsupported"
  | "curve-modeling-unsupported"
  | "primitive-unsupported"
  | "annotation-meta-unsupported"
  | "part-operation-unsupported"
  | "pattern-unsupported"
  | "tolerance-unsupported";

export type PlannedTarget =
  | {
      kind: "sketch";
      planeKey: SketchPlaneKey;
      plane?: import("@/contracts/shared/sketch-plane").SketchPlaneDefinition;
      /**
       * Onshape feature id of a translated plane feature whose produced
       * construction this sketch defers its support to (resolved to a
       * `constructionOf` reference by the provider at prepare time).
       */
      constructionFromFeatureId?: string;
    }
  | {
      kind: "plane";
      frame: import("@/contracts/shared/sketch-plane").SketchPlaneFrame;
    }
  | { kind: "variable" }
  | { kind: "feature" }
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
  /** Present when a region-consuming solid feature planned parametric (task 3). */
  plannedExtrude?: PlannedExtrude;
  /** Present when a sketch-region revolve with a local sketch-line axis plans parametric. */
  plannedRevolve?: PlannedRevolve;
  /** Body-only topology consumer declaration populated by Wave B translators. */
  plannedBodyTopologyConsumer?: PlannedBodyTopologyConsumer;
  /** Resolved deferred definition, rematched to live durable refs by the orchestrator. */
  plannedAdvancedSolid?: import("@/contracts/import/actions").ImportDeferredFeatureDefinition;
  /** Onshape feature ids that this plan consumes directly. */
  inputFeatureIds: string[];
}

export interface StudioPlan {
  featurePlans: FeaturePlan[];
  /** Whether a whole-studio baked body should represent non-parametric geometry. */
  requiresStudioBake: boolean;
  tierCounts: Record<FidelityTier, number>;
}


function referenceMap(
  references: readonly OnshapeResolvedReference[],
): ReadonlyMap<string, readonly OnshapeResolvedReference[]> {
  const map = new Map<string, OnshapeResolvedReference[]>();
  for (const reference of references) {
    const records = map.get(reference.deterministicId) ?? [];
    records.push(reference);
    map.set(reference.deterministicId, records);
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


/**
 * Produce the per-feature translation plan for a read Part Studio. Pure and
 * deterministic; the provider consumes this to emit actions and render the
 * fidelity report.
 */
export function planStudioFidelity(read: StudioReadResult): StudioPlan {
  const studio: OnshapePartStudioCapture = read.studio;
  const refs = referenceMap(studio.resolvedReferences);
  const featurePlans: FeaturePlan[] = [];
  const state: FidelityPlanningState = {
    bakedLineageFeatureIds: new Set<string>(),
    sketchPlansByFeatureId: new Map<string, { tier: FidelityTier; planeKey: SketchPlaneKey }>(),
    bodyProducingFeatureIds: [],
  };

  for (const feature of read.features) {
    const label = feature.name ?? feature.featureId;
    featurePlans.push(
      onshapeFeatureTranslatorRegistry.forFeatureType(feature.featureType).plan({
        feature,
        label,
        onshapeSuppressed: feature.suppressed === true,
        read,
        references: refs,
        state,
      }),
    );
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
    requiresStudioBake: state.bakedLineageFeatureIds.size > 0 && studio.groundTruth.hasBodies,
    tierCounts,
  };
}
