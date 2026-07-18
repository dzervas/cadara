import type {
  OnshapeGeometricSignature,
  OnshapeRollbackSnapshot,
} from "@/contracts/import/onshape-capture-bundle";

import type { FeatureDependencyInput } from "@/domain/import/onshape/feature-translator-registry";
import {
  createRollbackTopologyTimeline,
  diffRollbackTopologySnapshots,
  type RollbackBodyTopology,
  type RollbackTopologySnapshot,
} from "@/domain/import/onshape/rollback-topology-reader";

export type BakeSegmentPreflightCode =
  | "bake-segment-boundary-snapshot-missing"
  | "bake-segment-boundary-tessellation-unreadable"
  | "bake-segment-replacement-scope-unresolved"
  | "bake-segment-empty-output-unsupported";

export interface BakeSegmentPreflightDiagnostic {
  code: BakeSegmentPreflightCode;
  message: string;
  segmentId: string;
  featureId: string;
}

export interface CheckpointBodyBinding {
  deterministicId: string;
  sourceComponentKey: string;
  capturedSignature: OnshapeGeometricSignature;
}

export interface BakeSegmentPlan {
  segmentId: string;
  fromFeatureId: string;
  toFeatureId: string;
  featureIds: readonly string[];
  boundaryFeatureId: string;
  checkpointBodyDeterministicIds: readonly string[];
  directlyAffectedBodyDeterministicIds: readonly string[];
  consumedBodyDeterministicIds: readonly string[];
  carriedBodyDeterministicIds: readonly string[];
  replacementProducerFeatureIds: readonly string[];
  bodyBindings: readonly CheckpointBodyBinding[];
}

export type StudioBakeStrategy =
  | { kind: "none" }
  | { kind: "segments"; segments: readonly BakeSegmentPlan[] }
  | {
      kind: "wholeStudioLegacy";
      reason:
        | "capture-v1"
        | "rollback-snapshots-absent"
        | "history-probe-unavailable"
        | "segment-preflight-failed";
    };

export interface ParametricBodyTransition {
  consumedBodyDeterministicIds: readonly string[];
  producedBodyDeterministicIds: readonly string[];
}

export type BakeSegmentFeature =
  | {
      featureId: string;
      kind: "parametricBody";
      transition: ParametricBodyTransition;
    }
  | { featureId: string; kind: "bakedBody" }
  | { featureId: string; kind: "bakedDependency" }
  | { featureId: string; kind: "passThrough" }
  | { featureId: string; kind: "suppressed" };

export interface BodyProducerPlan {
  producerFeatureId: string;
  producerKind: "parametric" | "checkpoint";
  segmentId?: string;
  bodyDeterministicIds: readonly string[];
}

export interface BakeSegmentPlannerInput {
  captureFormatVersion: 1 | 2;
  historyProbeAvailable: boolean;
  features: readonly BakeSegmentFeature[];
  rollbackSnapshots: readonly OnshapeRollbackSnapshot[] | null;
  initialBodyProducers?: readonly BodyProducerPlan[];
}

export interface BakeSegmentPlannerResult {
  strategy: StudioBakeStrategy;
  diagnostics: readonly BakeSegmentPreflightDiagnostic[];
  finalBodyProducers: readonly BodyProducerPlan[];
}

export interface FeatureDependencyReachability {
  reachableSketchFeatureIds: ReadonlySet<string>;
  reachableBodyFeatureIds: ReadonlySet<string>;
  /** When present, undeclared/forward source ids are left to intrinsic diagnostics. */
  knownFeatureIds?: ReadonlySet<string>;
  reachableQueryInputs?: ReadonlySet<string>;
}

export function featureDependencyQueryKey(
  input: Extract<FeatureDependencyInput, { kind: "query" }>,
): string {
  return `${input.parameterId}:${input.slotKey ?? ""}`;
}

/**
 * Resolve only declared inputs. A baked feature elsewhere in the history has
 * no effect unless this feature names it as a sketch/body dependency. Segment
 * checkpoints can make a body dependency reachable by adding its source
 * feature id to `reachableBodyFeatureIds`; sketch dependencies remain tied to
 * parametric sketch actions.
 */
export function unreachableFeatureDependencies(
  inputs: readonly FeatureDependencyInput[],
  reachability: FeatureDependencyReachability,
): FeatureDependencyInput[] {
  return inputs.filter((input) => {
    if (input.kind === "sketch") {
      return (reachability.knownFeatureIds?.has(input.featureId) ?? true) &&
        !reachability.reachableSketchFeatureIds.has(input.featureId);
    }
    if (input.kind === "body") {
      return (reachability.knownFeatureIds?.has(input.featureId) ?? true) &&
        !reachability.reachableBodyFeatureIds.has(input.featureId);
    }
    return reachability.reachableQueryInputs !== undefined &&
      !reachability.reachableQueryInputs.has(featureDependencyQueryKey(input));
  });
}

interface MutableProducer {
  producerFeatureId: string;
  producerKind: "parametric" | "checkpoint";
  segmentId?: string;
  bodyIds: Set<string>;
}

interface OpenBakedRun {
  fromFeatureId: string;
  featureIds: string[];
  firstBodyFeatureId: string | null;
  boundaryFeatureId: string | null;
}

interface PlannerState {
  readonly featureOrder: ReadonlyMap<string, number>;
  readonly timeline: ReturnType<typeof createRollbackTopologyTimeline>;
  readonly bodyToProducer: Map<string, MutableProducer>;
  readonly producers: Set<MutableProducer>;
  readonly segments: BakeSegmentPlan[];
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function sortedUnique(values: readonly string[]): string[] {
  return unique(values).sort();
}

function producerOrder(
  producer: MutableProducer,
  featureOrder: ReadonlyMap<string, number>,
): [number, string] {
  return [
    featureOrder.get(producer.producerFeatureId) ?? Number.MAX_SAFE_INTEGER,
    producer.producerFeatureId,
  ];
}

function compareProducers(
  left: MutableProducer,
  right: MutableProducer,
  featureOrder: ReadonlyMap<string, number>,
): number {
  const [leftIndex, leftId] = producerOrder(left, featureOrder);
  const [rightIndex, rightId] = producerOrder(right, featureOrder);
  return leftIndex - rightIndex || leftId.localeCompare(rightId);
}

function hasReadableFacets(body: RollbackBodyTopology): boolean {
  return body.faces.some((face) =>
    face.facets.some((facet) => facet.vertices.length >= 3),
  );
}

function bodySignature(
  body: RollbackBodyTopology,
  snapshot: RollbackTopologySnapshot,
): OnshapeGeometricSignature {
  const vertices = body.faces.flatMap((face) =>
    face.facets.flatMap((facet) => facet.vertices),
  );
  const low: [number, number, number] = [Infinity, Infinity, Infinity];
  const high: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const centroid: [number, number, number] = [0, 0, 0];
  for (const vertex of vertices) {
    for (let axis = 0; axis < 3; axis += 1) {
      low[axis] = Math.min(low[axis], vertex[axis]);
      high[axis] = Math.max(high[axis], vertex[axis]);
      centroid[axis] += vertex[axis];
    }
  }
  for (let axis = 0; axis < 3; axis += 1) {
    centroid[axis] /= vertices.length;
  }

  return {
    entityClass: "body",
    geometryType: "tessellated-body",
    definingData: { captureTolerance: snapshot.tessellationTolerance },
    boundingBox: { low, high },
    centroid,
    tessellationSample: vertices.slice(0, 8).flat(),
  };
}

function snapshotBodiesById(
  snapshot: RollbackTopologySnapshot,
): Map<string, RollbackBodyTopology> | null {
  const bodies = new Map<string, RollbackBodyTopology>();
  for (const body of snapshot.bodies) {
    if (bodies.has(body.id)) return null;
    bodies.set(body.id, body);
  }
  return bodies;
}

function legacyResult(
  reason: Extract<StudioBakeStrategy, { kind: "wholeStudioLegacy" }>["reason"],
  diagnostic?: BakeSegmentPreflightDiagnostic,
): BakeSegmentPlannerResult {
  return {
    strategy: { kind: "wholeStudioLegacy", reason },
    diagnostics: diagnostic ? [diagnostic] : [],
    finalBodyProducers: [],
  };
}

function addProducer(
  state: Pick<PlannerState, "bodyToProducer" | "producers">,
  producer: MutableProducer,
): boolean {
  for (const bodyId of producer.bodyIds) {
    if (state.bodyToProducer.has(bodyId)) return false;
  }
  state.producers.add(producer);
  for (const bodyId of producer.bodyIds) {
    state.bodyToProducer.set(bodyId, producer);
  }
  return true;
}

function removeBodyFromProducer(state: PlannerState, bodyId: string): void {
  const producer = state.bodyToProducer.get(bodyId);
  if (!producer) return;
  producer.bodyIds.delete(bodyId);
  state.bodyToProducer.delete(bodyId);
  if (producer.bodyIds.size === 0) state.producers.delete(producer);
}

function applyParametricTransition(
  state: PlannerState,
  feature: Extract<BakeSegmentFeature, { kind: "parametricBody" }>,
): boolean {
  for (const bodyId of unique(feature.transition.consumedBodyDeterministicIds)) {
    removeBodyFromProducer(state, bodyId);
  }
  const producedBodyIds = new Set(
    unique(feature.transition.producedBodyDeterministicIds),
  );
  if (producedBodyIds.size === 0) return true;
  return addProducer(state, {
    producerFeatureId: feature.featureId,
    producerKind: "parametric",
    bodyIds: producedBodyIds,
  });
}

function openRunFor(run: OpenBakedRun | null, featureId: string): OpenBakedRun {
  return run ?? {
    fromFeatureId: featureId,
    featureIds: [],
    firstBodyFeatureId: null,
    boundaryFeatureId: null,
  };
}

function preflightDiagnostic(
  code: BakeSegmentPreflightCode,
  segmentId: string,
  featureId: string,
  message: string,
): BakeSegmentPreflightDiagnostic {
  return { code, segmentId, featureId, message };
}

function closeBakedRun(
  state: PlannerState,
  run: OpenBakedRun,
): BakeSegmentPreflightDiagnostic | null {
  if (!run.firstBodyFeatureId || !run.boundaryFeatureId) return null;

  const segmentId = `bake-segment-${state.segments.length + 1}`;
  const before = state.timeline.snapshotBeforeFeature(run.firstBodyFeatureId);
  const after = state.timeline.snapshotAfterFeature(run.boundaryFeatureId);
  if (!before || !after) {
    return preflightDiagnostic(
      "bake-segment-boundary-snapshot-missing",
      segmentId,
      run.boundaryFeatureId,
      `Bake segment ${segmentId} is missing its exact rollback boundary state.`,
    );
  }
  if (before.diagnostics.length > 0 || after.diagnostics.length > 0) {
    return preflightDiagnostic(
      "bake-segment-boundary-tessellation-unreadable",
      segmentId,
      run.boundaryFeatureId,
      `Bake segment ${segmentId} has an unreadable rollback tessellation boundary.`,
    );
  }

  const afterBodies = snapshotBodiesById(after);
  if (!afterBodies) {
    return preflightDiagnostic(
      "bake-segment-replacement-scope-unresolved",
      segmentId,
      run.boundaryFeatureId,
      `Bake segment ${segmentId} contains duplicate deterministic body IDs.`,
    );
  }

  const delta = diffRollbackTopologySnapshots(before, after);
  const directlyAffectedBodyIds = sortedUnique([
    ...delta.introducedBodyDeterministicIds,
    ...delta.changedBodyDeterministicIds,
    ...delta.removedBodyDeterministicIds,
  ]);
  if (directlyAffectedBodyIds.length === 0) return null;

  const consumedBodyIds = sortedUnique([
    ...delta.changedBodyDeterministicIds,
    ...delta.removedBodyDeterministicIds,
  ]);
  const directOutputIds = new Set([
    ...delta.introducedBodyDeterministicIds,
    ...delta.changedBodyDeterministicIds,
  ]);
  const replacementProducers = new Set<MutableProducer>();
  for (const bodyId of consumedBodyIds) {
    const producer = state.bodyToProducer.get(bodyId);
    if (!producer) {
      return preflightDiagnostic(
        "bake-segment-replacement-scope-unresolved",
        segmentId,
        run.boundaryFeatureId,
        `Bake segment ${segmentId} cannot attribute consumed body ${bodyId} to a live producer.`,
      );
    }
    replacementProducers.add(producer);
  }

  for (const bodyId of delta.introducedBodyDeterministicIds) {
    if (state.bodyToProducer.has(bodyId)) {
      return preflightDiagnostic(
        "bake-segment-replacement-scope-unresolved",
        segmentId,
        run.boundaryFeatureId,
        `Bake segment ${segmentId} introduces already-live body ${bodyId}.`,
      );
    }
  }

  const carriedBodyIds = new Set<string>();
  for (const producer of replacementProducers) {
    for (const bodyId of producer.bodyIds) {
      if (!consumedBodyIds.includes(bodyId) && !directOutputIds.has(bodyId)) {
        carriedBodyIds.add(bodyId);
      }
    }
  }
  const checkpointOutputIds = new Set([...directOutputIds, ...carriedBodyIds]);
  if (checkpointOutputIds.size === 0) {
    return preflightDiagnostic(
      "bake-segment-empty-output-unsupported",
      segmentId,
      run.boundaryFeatureId,
      `Bake segment ${segmentId} only removes bodies and cannot be represented by bakedBody.`,
    );
  }

  for (const bodyId of checkpointOutputIds) {
    const body = afterBodies.get(bodyId);
    if (!body || !hasReadableFacets(body)) {
      return preflightDiagnostic(
        "bake-segment-boundary-tessellation-unreadable",
        segmentId,
        run.boundaryFeatureId,
        `Bake segment ${segmentId} has no readable tessellation for output body ${bodyId}.`,
      );
    }
  }

  const orderedOutputIds = after.bodies
    .map((body) => body.id)
    .filter((bodyId) => checkpointOutputIds.has(bodyId));
  const orderedCarriedIds = after.bodies
    .map((body) => body.id)
    .filter((bodyId) => carriedBodyIds.has(bodyId));
  const orderedReplacementProducers = [...replacementProducers].sort(
    (left, right) => compareProducers(left, right, state.featureOrder),
  );

  for (const producer of orderedReplacementProducers) {
    for (const bodyId of producer.bodyIds) state.bodyToProducer.delete(bodyId);
    state.producers.delete(producer);
  }
  const checkpointProducer: MutableProducer = {
    producerFeatureId: run.boundaryFeatureId,
    producerKind: "checkpoint",
    segmentId,
    bodyIds: new Set(orderedOutputIds),
  };
  if (!addProducer(state, checkpointProducer)) {
    return preflightDiagnostic(
      "bake-segment-replacement-scope-unresolved",
      segmentId,
      run.boundaryFeatureId,
      `Bake segment ${segmentId} collides with an unrelated live body producer.`,
    );
  }

  state.segments.push({
    segmentId,
    fromFeatureId: run.fromFeatureId,
    toFeatureId: run.boundaryFeatureId,
    featureIds: run.featureIds,
    boundaryFeatureId: run.boundaryFeatureId,
    checkpointBodyDeterministicIds: orderedOutputIds,
    directlyAffectedBodyDeterministicIds: directlyAffectedBodyIds,
    consumedBodyDeterministicIds: consumedBodyIds,
    carriedBodyDeterministicIds: orderedCarriedIds,
    replacementProducerFeatureIds: orderedReplacementProducers.map(
      (producer) => producer.producerFeatureId,
    ),
    bodyBindings: orderedOutputIds.map((bodyId) => ({
      deterministicId: bodyId,
      sourceComponentKey: `onshape-body:${bodyId}`,
      capturedSignature: bodySignature(afterBodies.get(bodyId)!, after),
    })),
  });
  return null;
}

function finalBodyProducers(state: PlannerState): BodyProducerPlan[] {
  return [...state.producers]
    .filter((producer) => producer.bodyIds.size > 0)
    .sort((left, right) => compareProducers(left, right, state.featureOrder))
    .map((producer) => ({
      producerFeatureId: producer.producerFeatureId,
      producerKind: producer.producerKind,
      ...(producer.segmentId ? { segmentId: producer.segmentId } : {}),
      bodyDeterministicIds: [...producer.bodyIds].sort(),
    }));
}

/**
 * Plan body-level baked checkpoints and exact action-granularity replacement
 * closure. This function is pure: it reads rollback evidence but prepares no
 * baked assets or import actions.
 */
export function planBakeSegments(
  input: BakeSegmentPlannerInput,
): BakeSegmentPlannerResult {
  const hasBakedBodyRun = input.features.some(
    (feature) => feature.kind === "bakedBody",
  );
  if (hasBakedBodyRun && input.captureFormatVersion === 1) {
    return legacyResult("capture-v1");
  }
  if (hasBakedBodyRun && input.rollbackSnapshots === null) {
    return legacyResult("rollback-snapshots-absent");
  }
  if (hasBakedBodyRun && !input.historyProbeAvailable) {
    return legacyResult("history-probe-unavailable");
  }

  const featureOrder = new Map(
    input.features.map((feature, index) => [feature.featureId, index]),
  );
  const state: PlannerState = {
    featureOrder,
    timeline: createRollbackTopologyTimeline({
      featureIds: input.features.map((feature) => feature.featureId),
      snapshots: input.rollbackSnapshots,
    }),
    bodyToProducer: new Map(),
    producers: new Set(),
    segments: [],
  };
  for (const producer of input.initialBodyProducers ?? []) {
    if (!addProducer(state, {
      producerFeatureId: producer.producerFeatureId,
      producerKind: producer.producerKind,
      segmentId: producer.segmentId,
      bodyIds: new Set(producer.bodyDeterministicIds),
    })) {
      return legacyResult(
        "segment-preflight-failed",
        preflightDiagnostic(
          "bake-segment-replacement-scope-unresolved",
          "bake-segment-1",
          producer.producerFeatureId,
          "Initial body producer declarations overlap.",
        ),
      );
    }
  }

  let openRun: OpenBakedRun | null = null;
  for (const feature of input.features) {
    if (feature.kind === "bakedDependency") {
      openRun = openRunFor(openRun, feature.featureId);
      openRun.featureIds.push(feature.featureId);
      continue;
    }
    if (feature.kind === "bakedBody") {
      openRun = openRunFor(openRun, feature.featureId);
      openRun.featureIds.push(feature.featureId);
      openRun.firstBodyFeatureId ??= feature.featureId;
      openRun.boundaryFeatureId = feature.featureId;
      continue;
    }
    if (feature.kind !== "parametricBody") continue;

    if (openRun) {
      const diagnostic = closeBakedRun(state, openRun);
      if (diagnostic) return legacyResult("segment-preflight-failed", diagnostic);
      openRun = null;
    }
    if (!applyParametricTransition(state, feature)) {
      return legacyResult(
        "segment-preflight-failed",
        preflightDiagnostic(
          "bake-segment-replacement-scope-unresolved",
          `bake-segment-${state.segments.length + 1}`,
          feature.featureId,
          `Parametric feature ${feature.featureId} produces an already-live body ID.`,
        ),
      );
    }
  }

  if (openRun) {
    const diagnostic = closeBakedRun(state, openRun);
    if (diagnostic) return legacyResult("segment-preflight-failed", diagnostic);
  }

  return {
    strategy: state.segments.length > 0
      ? { kind: "segments", segments: state.segments }
      : { kind: "none" },
    diagnostics: [],
    finalBodyProducers: finalBodyProducers(state),
  };
}
