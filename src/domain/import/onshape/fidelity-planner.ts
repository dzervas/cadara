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
import type { OnshapeResolvedReference } from "@/contracts/import/onshape-capture-bundle";
import type { SketchPlaneKey } from "@/contracts/shared/sketch-plane";

import type { OnshapeFeatureNode, StudioReadResult } from "@/domain/import/onshape/bundle-reader";
import {
  planBakeSegments,
  unreachableFeatureDependencies,
  type BakeSegmentFeature,
  type BakeSegmentPreflightDiagnostic,
  type StudioBakeStrategy,
} from "@/domain/import/onshape/bake-segment-planner";
import {
  createOnshapeFeatureTranslatorRegistry,
  type FeatureDependencyInput,
  type FidelityPlanningState,
} from "@/domain/import/onshape/feature-translator-registry";
import { extrudeFeatureTranslator } from "@/domain/import/onshape/extrude-feature-translator";
import { fallbackFeatureTranslator, planeFeatureTranslator } from "@/domain/import/onshape/fallback-feature-translator";
import { sketchFeatureTranslator } from "@/domain/import/onshape/sketch-feature-translator";
import { variableFeatureTranslator } from "@/domain/import/onshape/variable-feature-translator";
import type { PlannedExtrude } from "@/domain/import/onshape/extrude-planner";
import { createRollbackTopologyTimeline } from "@/domain/import/onshape/rollback-topology-reader";
import type {
  PlannedLoft,
  PlannedRevolve,
  PlannedSweep,
} from "@/domain/import/onshape/wave-a-feature-translators";
import {
  loftFeatureTranslator,
  revolveFeatureTranslator,
  sweepFeatureTranslator,
} from "@/domain/import/onshape/wave-a-feature-translators";
import {
  booleanBodiesFeatureTranslator,
  chamferFeatureTranslator,
  circularPatternFeatureTranslator,
  deleteBodiesFeatureTranslator,
  filletFeatureTranslator,
  holeFeatureTranslator,
  linearPatternFeatureTranslator,
  mirrorFeatureTranslator,
  shellFeatureTranslator,
  splitFeatureTranslator,
  thickenFeatureTranslator,
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
    linearPatternFeatureTranslator,
    circularPatternFeatureTranslator,
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
  | "extrude-body-type-unsupported"
  | "extrude-default-scope-ambiguous"
  // The extrude's up-to (extent) or explicit boolean-scope topology slot could
  // not be resolved against the exact pre-consumer prefix, so it can never be
  // prepared as a parametric feature; fail closed to baked at the feature level.
  | "extrude-extent-topology-unresolved"
  | "sketch-on-probed-face"
  // The sketch plane face exists only on a checkpoint-baked body lineage, so no
  // live face can ever be probed or rematched in the parametric prefix.
  | "sketch-face-on-checkpoint-body"
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
  | "revolve-operation-unsupported"
  | "revolve-body-type-unsupported"
  | "revolve-profile-unresolved"
  | "revolve-axis-unresolved"
  | "revolve-extent-unsupported"
  | "thicken-requires-topology"
  | "sweep-path-unresolved"
  | "loft-profile-unresolved"
  | "loft-guides-unsupported"
  | "loft-conditions-unsupported"
  | "loft-periodicity-unsupported"
  | "boolean-offset-unsupported"
  | "boolean-operation-unsupported"
  | "mirror-operation-unsupported"
  | "mirror-plane-unresolved"
  | "transform-copy-unsupported"
  | "transform-rotation-unsupported"
  | "transform-rotation-angle-unreadable"
  | "transform-rotation-axis-unresolved"
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
  // The feature's boolean severed its target body into several solids on a
  // kernel path that cannot replace one body with many; bake this feature
  // instead of aborting the studio.
  | "extrude-boolean-severs-target-body"
  // The live kernel refused to build this feature against the real prefix
  // (invalid or unsupported result geometry); bake it rather than abort.
  | "feature-kernel-build-failed"
  | "topology-bake-snapshot-missing"
  | "bake-segment-boundary-snapshot-missing"
  | "bake-segment-boundary-tessellation-unreadable"
  | "bake-segment-body-unreachable"
  | "bake-segment-body-attribution-ambiguous"
  | "bake-segment-replacement-scope-unresolved"
  | "bake-segment-empty-output-unsupported"
  | "fillet-radius-unreadable"
  | "chamfer-method-unsupported"
  | "chamfer-style-unsupported"
  | "chamfer-direction-overrides-unsupported"
  | "chamfer-width-unreadable"
  | "shell-non-hollow-unsupported"
  | "shell-hollow-without-openings"
  | "shell-closed-hollow-direction-unsupported"
  | "shell-thickness-unreadable"
  | "hole-style-unsupported"
  | "hole-thread-unsupported"
  | "hole-diameter-unreadable"
  | "hole-location-unresolved"
  | "hole-depth-unreadable"
  | "hole-counterbore-parameters-unreadable"
  | "hole-countersink-parameters-unreadable"
  | "hole-termination-unsupported"
  | "hole-scope-unresolved"
  | "hole-executor-unavailable"
  | "sheet-metal-unsupported"
  | "surface-modeling-unsupported"
  | "curve-modeling-unsupported"
  | "primitive-unsupported"
  | "annotation-meta-unsupported"
  | "part-operation-unsupported"
  | "pattern-unsupported"
  | "pattern-type-unsupported"
  | "pattern-operation-unsupported"
  | "pattern-seed-unresolved"
  | "pattern-direction-unresolved"
  | "pattern-axis-unresolved"
  | "pattern-count-unreadable"
  | "pattern-spacing-unreadable"
  | "pattern-angle-unreadable"
  | "pattern-second-direction-unsupported"
  | "pattern-centered-unsupported"
  | "pattern-skipping-unsupported"
  | "pattern-feature-seed-unsupported"
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
      /** Fixed world-space support recovered at a baked checkpoint barrier. */
      capturedFrame?: import("@/contracts/shared/sketch-plane").SketchPlaneFrame;
      /**
       * Deferred face selector for a probe-promoted sketch. The provider emits
       * it as the commit's plane support so the orchestrator rematches the
       * probed face against live topology at apply time.
       */
      probedFaceSelector?: import("@/contracts/import/actions").ImportDeferredTopologyRef;
    }
  | {
      kind: "plane";
      frame: import("@/contracts/shared/sketch-plane").SketchPlaneFrame;
    }
  | { kind: "variable" }
  | { kind: "feature" }
  | { kind: "bakedBody" }
  | { kind: "suppressed" };

export type PlannedFeatureReplay =
  | {
      kind: "linear";
      /** Exact ordered Onshape FeatureList source ids. */
      sourceFeatureIds: readonly string[];
      direction: { kind: "construction"; constructionId: import("@/contracts/shared/ids").ConstructionId };
      instanceCount: number;
      spacing: number;
      oppositeDirection: boolean;
    }
  | {
      kind: "mirror";
      /** Exact ordered Onshape FeatureList source ids. */
      sourceFeatureIds: readonly string[];
      plane: { kind: "construction"; constructionId: import("@/contracts/shared/ids").ConstructionId };
    };

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
  /** Present when a sketch-region revolve with a resolvable sketch-line axis plans parametric. */
  plannedRevolve?: PlannedRevolve;
  /** Present when a sweep resolves one profile region and one solved sketch curve. */
  plannedSweep?: PlannedSweep;
  /** Present when a loft resolves two or more ordered sketch-region profiles. */
  plannedLoft?: PlannedLoft;
  /** Body-only topology consumer declaration populated by Wave B translators. */
  plannedBodyTopologyConsumer?: PlannedBodyTopologyConsumer;
  /** Resolved deferred definition, rematched to live durable refs by the orchestrator. */
  plannedAdvancedSolid?: import("@/contracts/import/actions").ImportDeferredFeatureDefinition;
  /** Exact source-operation replay form for captured FEATURE patterns and mirrors. */
  plannedFeatureReplay?: PlannedFeatureReplay;
  /** Classified sketch, body, and topology-query inputs consumed by this feature. */
  inputDependencies: FeatureDependencyInput[];
  /** Compatibility projection of sketch/body dependency feature ids. */
  inputFeatureIds: string[];
}

export interface StudioPlan {
  featurePlans: FeaturePlan[];
  bakeStrategy: StudioBakeStrategy;
  bakeDiagnostics: readonly BakeSegmentPreflightDiagnostic[];
  /** Compatibility field: true only for the exact whole-studio legacy path. */
  requiresStudioBake: boolean;
  tierCounts: Record<FidelityTier, number>;
}

export interface StudioFidelityPlanningOptions {
  captureFormatVersion?: 1 | 2;
  historyProbeAvailable?: boolean;
  demotedFeatureIds?: Iterable<string>;
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


function readPoint3(value: unknown): [number, number, number] | null {
  return Array.isArray(value) &&
    value.length === 3 &&
    value.every((component) => typeof component === "number")
    ? [value[0] as number, value[1] as number, value[2] as number]
    : null;
}

function normalizeVector(
  value: readonly [number, number, number],
): [number, number, number] | null {
  const length = Math.hypot(...value);
  return length > 1e-12
    ? [value[0] / length, value[1] / length, value[2] / length]
    : null;
}

function cross(
  left: readonly [number, number, number],
  right: readonly [number, number, number],
): [number, number, number] {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function sketchPlaneUsesConstruction(feature: OnshapeFeatureNode): boolean {
  return (feature.parameters ?? []).some((parameter) => {
    if (
      typeof parameter !== "object" ||
      parameter === null ||
      (parameter as { parameterId?: unknown }).parameterId !== "sketchPlane"
    ) {
      return false;
    }
    const queries = (parameter as { queries?: unknown }).queries;
    return Array.isArray(queries) && queries.some((query) =>
      typeof (query as { queryString?: unknown }).queryString === "string" &&
      (query as { queryString: string }).queryString.includes("planeOp"),
    );
  });
}

function capturedSketchFrame(
  feature: OnshapeFeatureNode,
  references: ReadonlyMap<string, readonly OnshapeResolvedReference[]>,
): import("@/contracts/shared/sketch-plane").SketchPlaneFrame | null {
  const deterministicId = extractSketchPlaneDeterministicId(feature);
  const records = deterministicId ? references.get(deterministicId) ?? [] : [];
  const historyPointRecords = records.filter(
    (record) =>
      record.evaluatedAt === "historyPoint" &&
      record.consumingFeatureId === feature.featureId &&
      "signature" in record,
  );
  if (historyPointRecords.length !== 1 || !("signature" in historyPointRecords[0]!)) {
    return null;
  }
  const { signature } = historyPointRecords[0];
  if (signature.entityClass !== "face" || signature.geometryType.toLowerCase() !== "plane") {
    return null;
  }
  const originMeters = readPoint3(signature.definingData?.origin);
  const normal = normalizeVector(readPoint3(signature.definingData?.normal) ?? [0, 0, 0]);
  if (!originMeters || !normal) return null;
  const authoredXAxis = normalizeVector(
    readPoint3(signature.definingData?.xDirection) ?? [0, 0, 0],
  );
  const seed: [number, number, number] = Math.abs(normal[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const dot = seed[0] * normal[0] + seed[1] * normal[1] + seed[2] * normal[2];
  const xAxis = authoredXAxis ?? normalizeVector([
    seed[0] - normal[0] * dot,
    seed[1] - normal[1] * dot,
    seed[2] - normal[2] * dot,
  ]);
  if (!xAxis) return null;
  return {
    origin: [originMeters[0] * 1000, originMeters[1] * 1000, originMeters[2] * 1000],
    xAxis,
    yAxis: cross(normal, xAxis),
    normal,
    linearUnit: "documentLength",
    handedness: "rightHanded",
  };
}

function tierCountsFor(featurePlans: readonly FeaturePlan[]): Record<FidelityTier, number> {
  const counts: Record<FidelityTier, number> = {
    parametric: 0,
    baked: 0,
    geometryOnly: 0,
  };
  for (const plan of featurePlans) counts[plan.tier] += 1;
  return counts;
}

function legacyFeaturePlans(read: StudioReadResult): FeaturePlan[] {
  const refs = referenceMap(read.studio.resolvedReferences);
  const featurePlans: FeaturePlan[] = [];
  const state: FidelityPlanningState = {
    sketchPlansByFeatureId: new Map(),
    bodyProducingFeatureIds: [],
  };
  const reachableSketchFeatureIds = new Set<string>();
  const reachableBodyFeatureIds = new Set<string>();
  const knownFeatureIds = new Set<string>();

  for (const feature of read.features) {
    const intrinsicPlan = onshapeFeatureTranslatorRegistry.forFeatureType(feature.featureType).plan({
      feature,
      label: feature.name ?? feature.featureId,
      onshapeSuppressed: feature.suppressed === true,
      read,
      references: refs,
      state,
    });
    const replaySourcesLive = intrinsicPlan.plannedFeatureReplay?.sourceFeatureIds.every(
      (sourceFeatureId) =>
        featurePlans.find((candidate) => candidate.onshapeFeatureId === sourceFeatureId)
          ?.tier === "parametric",
    );
    const blocked = intrinsicPlan.plannedFeatureReplay
      ? replaySourcesLive !== true
      : unreachableFeatureDependencies(intrinsicPlan.inputDependencies, {
          reachableSketchFeatureIds,
          reachableBodyFeatureIds,
          knownFeatureIds,
        }).length > 0;
    const plan = blocked
      ? {
          ...intrinsicPlan,
          tier: "baked" as const,
          target: { kind: "suppressed" as const },
          reasonCodes: [...new Set([...intrinsicPlan.reasonCodes, "downstream-of-baked" as const])],
          suppressed: true,
        }
      : intrinsicPlan;
    featurePlans.push(plan);
    if (plan.tier === "parametric" && plan.target.kind === "sketch") {
      reachableSketchFeatureIds.add(feature.featureId);
    }
    if (plan.tier === "parametric" && state.bodyProducingFeatureIds.includes(feature.featureId)) {
      reachableBodyFeatureIds.add(feature.featureId);
    }
    knownFeatureIds.add(feature.featureId);
  }
  return featurePlans;
}

function segmentedFeaturePlans(input: {
  read: StudioReadResult;
  demotedFeatureIds: ReadonlySet<string>;
}): FeaturePlan[] {
  const refs = referenceMap(input.read.studio.resolvedReferences);
  const state: FidelityPlanningState = {
    sketchPlansByFeatureId: new Map(),
    bodyProducingFeatureIds: [],
  };
  const plans: FeaturePlan[] = [];
  const reachableSketchFeatureIds = new Set<string>();
  const knownFeatureIds = new Set<string>();
  const timeline = createRollbackTopologyTimeline({
    featureIds: input.read.features.map((feature) => feature.featureId),
    snapshots: input.read.studio.rollbackSnapshots,
  });
  let bakedBodyBarrierSeen = false;

  for (const feature of input.read.features) {
    let plan = onshapeFeatureTranslatorRegistry.forFeatureType(feature.featureType).plan({
      feature,
      label: feature.name ?? feature.featureId,
      onshapeSuppressed: feature.suppressed === true,
      read: input.read,
      references: refs,
      state,
    });
    if (
      plan.tier === "baked" &&
      plan.featureType === "newSketch" &&
      plan.reasonCodes.includes("needs-history-probe") &&
      !sketchPlaneUsesConstruction(feature)
    ) {
      const frame = capturedSketchFrame(feature, refs);
      if (frame) {
        plan = {
          ...plan,
          tier: "parametric",
          target: { kind: "sketch", planeKey: "xy", capturedFrame: frame },
          reasonCodes: ["sketch-on-captured-frame"],
          suppressed: false,
        };
        state.sketchPlansByFeatureId.set(feature.featureId, {
          tier: "parametric",
          planeKey: "xy",
          planeFrame: frame,
        });
      }
    }
    if (
      plan.tier === "baked" &&
      plan.plannedExtrude &&
      plan.reasonCodes.length === 1 &&
      plan.reasonCodes[0] === "needs-history-probe" &&
      !bakedBodyBarrierSeen
    ) {
      plan = {
        ...plan,
        tier: "parametric",
        target: { kind: "feature" },
        reasonCodes: [],
        suppressed: false,
      };
    }
    const unreachableSketch = unreachableFeatureDependencies(plan.inputDependencies, {
      reachableSketchFeatureIds,
      reachableBodyFeatureIds: new Set(),
      knownFeatureIds,
    }).some((dependency) => dependency.kind === "sketch");
    // Feature-operation replay cannot consume a checkpoint or inferred body:
    // every exact source feature must already be live in the authored prefix.
    // Keep it pending behind unresolved source operations rather than claiming a
    // body-copy promotion before X.4 can materialize the seed regions.
    const unreachableReplaySource = plan.plannedFeatureReplay?.sourceFeatureIds.some(
      (sourceFeatureId) =>
        plans.find((candidate) => candidate.onshapeFeatureId === sourceFeatureId)
          ?.tier !== "parametric",
    ) ?? false;
    if (input.demotedFeatureIds.has(feature.featureId) || unreachableSketch || unreachableReplaySource) {
      plan = {
        ...plan,
        tier: "baked",
        target: { kind: "suppressed" },
        reasonCodes: unreachableSketch || unreachableReplaySource
          ? [...new Set([...plan.reasonCodes, "downstream-of-baked" as const])]
          : plan.reasonCodes,
        suppressed: true,
      };
      if (plan.featureType === "newSketch") state.sketchPlansByFeatureId.delete(feature.featureId);
    }
    plans.push(plan);
    if (plan.tier === "parametric" && plan.target.kind === "sketch") {
      reachableSketchFeatureIds.add(feature.featureId);
    }
    const delta = timeline.bodyDeltaBetweenFeatures(feature.featureId, feature.featureId);
    if (
      plan.tier === "baked" &&
      delta &&
      (delta.introducedBodyDeterministicIds.length > 0 ||
        delta.changedBodyDeterministicIds.length > 0 ||
        delta.removedBodyDeterministicIds.length > 0)
    ) {
      bakedBodyBarrierSeen = true;
    }
    knownFeatureIds.add(feature.featureId);
  }

  const consumedParametricSketchIds = new Set(
    plans.flatMap((plan) =>
      plan.tier === "parametric"
        ? plan.inputDependencies.flatMap((dependency) =>
            dependency.kind === "sketch" ? [dependency.featureId] : [],
          )
        : [],
    ),
  );
  return plans.map((plan) =>
    plan.reasonCodes.includes("sketch-on-captured-frame") &&
    !consumedParametricSketchIds.has(plan.onshapeFeatureId)
      ? {
          ...plan,
          tier: "baked" as const,
          target: { kind: "suppressed" as const },
          reasonCodes: ["needs-history-probe" as const],
          suppressed: true,
        }
      : plan,
  );
}

function segmentFeaturesFor(
  read: StudioReadResult,
  featurePlans: readonly FeaturePlan[],
): BakeSegmentFeature[] {
  const timeline = createRollbackTopologyTimeline({
    featureIds: read.features.map((feature) => feature.featureId),
    snapshots: read.studio.rollbackSnapshots,
  });
  return featurePlans.map((plan) => {
    if (read.features.find((feature) => feature.featureId === plan.onshapeFeatureId)?.suppressed) {
      return { featureId: plan.onshapeFeatureId, kind: "suppressed" };
    }
    const delta = timeline.bodyDeltaBetweenFeatures(
      plan.onshapeFeatureId,
      plan.onshapeFeatureId,
    );
    const bodyChanged = delta !== null && (
      delta.introducedBodyDeterministicIds.length > 0 ||
      delta.changedBodyDeterministicIds.length > 0 ||
      delta.removedBodyDeterministicIds.length > 0
    );
    if (bodyChanged && plan.tier === "parametric") {
      return {
        featureId: plan.onshapeFeatureId,
        kind: "parametricBody",
        transition: {
          consumedBodyDeterministicIds: [
            ...delta.changedBodyDeterministicIds,
            ...delta.removedBodyDeterministicIds,
          ],
          producedBodyDeterministicIds: [
            ...delta.introducedBodyDeterministicIds,
            ...delta.changedBodyDeterministicIds,
          ],
        },
      };
    }
    if (bodyChanged) return { featureId: plan.onshapeFeatureId, kind: "bakedBody" };
    return {
      featureId: plan.onshapeFeatureId,
      kind: plan.tier === "parametric" ? "passThrough" : "bakedDependency",
    };
  });
}

export function replanStudioBakeStrategy(
  read: StudioReadResult,
  featurePlans: readonly FeaturePlan[],
) {
  return planBakeSegments({
    captureFormatVersion: 2,
    historyProbeAvailable: true,
    features: segmentFeaturesFor(read, featurePlans),
    rollbackSnapshots: read.studio.rollbackSnapshots,
  });
}

/**
 * Produce the per-feature translation plan for a read Part Studio. Snapshot-
 * enabled plans use body-history segments; legacy plans retain the exact prior
 * suppression cascade.
 */
export function planStudioFidelity(
  read: StudioReadResult,
  options: StudioFidelityPlanningOptions = {},
): StudioPlan {
  const formatVersion = options.captureFormatVersion ??
    (read.studio.rollbackSnapshots === null ? 1 : 2);
  const historyProbeAvailable = options.historyProbeAvailable ?? true;
  const demotedFeatureIds = new Set(options.demotedFeatureIds ?? []);
  const legacyPlans = legacyFeaturePlans(read);
  const hasLegacyBake = legacyPlans.some((plan) => plan.tier === "baked") &&
    read.studio.groundTruth.hasBodies;

  if (formatVersion === 1 || read.studio.rollbackSnapshots === null || !historyProbeAvailable) {
    const reason = formatVersion === 1
      ? "capture-v1" as const
      : read.studio.rollbackSnapshots === null
        ? "rollback-snapshots-absent" as const
        : "history-probe-unavailable" as const;
    return {
      featurePlans: legacyPlans,
      bakeStrategy: hasLegacyBake ? { kind: "wholeStudioLegacy", reason } : { kind: "none" },
      bakeDiagnostics: [],
      requiresStudioBake: hasLegacyBake,
      tierCounts: tierCountsFor(legacyPlans),
    };
  }

  const candidatePlans = segmentedFeaturePlans({ read, demotedFeatureIds });
  const segmentResult = planBakeSegments({
    captureFormatVersion: formatVersion,
    historyProbeAvailable,
    features: segmentFeaturesFor(read, candidatePlans),
    rollbackSnapshots: read.studio.rollbackSnapshots,
  });
  if (segmentResult.strategy.kind === "wholeStudioLegacy") {
    return {
      featurePlans: legacyPlans,
      bakeStrategy: segmentResult.strategy,
      bakeDiagnostics: segmentResult.diagnostics,
      requiresStudioBake: hasLegacyBake,
      tierCounts: tierCountsFor(legacyPlans),
    };
  }

  return {
    featurePlans: candidatePlans,
    bakeStrategy: segmentResult.strategy,
    bakeDiagnostics: segmentResult.diagnostics,
    requiresStudioBake: false,
    tierCounts: tierCountsFor(candidatePlans),
  };
}
