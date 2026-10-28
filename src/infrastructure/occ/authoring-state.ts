import type { DurableRef } from "@/contracts/shared/references";
import {
  createEmptyGeometryAssetManifest,
  type GeometryAssetHash,
  type GeometryAssetManifest,
  type GeometryAssetRecord,
} from "@/contracts/modeling/geometry-assets";
import type { EmbeddedBinaryAssetRecord } from "@/contracts/modeling/embedded-binary-assets";
import type { AuthoredTopologyLineageOutput } from "@/contracts/modeling/authored-document";
import { stableJsonValue } from "@/contracts/modeling/authored-document-serialization";
import {
  withAutoBodyAppearances,
  type BodyAppearance,
} from "@/contracts/modeling/body-appearance";
import type {
  DocumentFeatureCursor,
  DocumentVariableRecord,
  FeatureDefinition,
  ModelingDiagnostic,
  SketchSnapshotRecord,
  SnapshotEntityRecord,
} from "@/contracts/modeling/schema";
import type { RenderableEntityRecord } from "@/contracts/render/schema";
import type {
  BodyId,
  ConstructionId,
  FeatureId,
  SketchId,
} from "@/contracts/shared/ids";
import type { SketchPlaneDefinition } from "@/contracts/shared/sketch-plane";
import {
  OCC_KERNEL_DOCUMENT_ID,
  OCC_KERNEL_DOCUMENT_NAME,
  OCC_KERNEL_INITIAL_REVISION_ID,
  OCC_KERNEL_SETTINGS,
  createStandardPlaneDefinition,
} from "@/core/modeling/opencascade-kernel-seed";
import type { DocumentHistoryOrderEntry } from "@/core/modeling/document-history";
import {
  createConstructionPresentationArtifacts,
  executeOccFeature,
  type OccFeatureExecutionContext,
  type OccFeatureExecutionResult,
} from "@/infrastructure/occ/features";
import { resolveFeatureDefinitionValues } from "@/core/modeling/feature-value-expressions";
import { resolveSketchDimensionValues } from "@/core/modeling/sketch-dimension-expressions";
import type { OpenCascadeInstance } from "@/infrastructure/occ/kernel-capabilities";
import {
  combineOccCleanupError,
  releaseDiscardedOccAuthoringStateObjects,
  releaseOccObjects,
} from "@/infrastructure/occ/memory";
import {
  createFeatureTopologyStage,
  createOccTopologyProvenanceIndex,
  getPreviousFeatureTopologyLineage,
  getPreviousFeatureTopologyStage,
  isSameTopologyLineageOutput,
  serializeOccTopologyStageOutput,
  type OccFeatureTopologyLineageMap,
  type OccFeatureTopologyStageMap,
  type OccTopologyStageOutput,
} from "@/infrastructure/occ/topology-stage";
import {
  classifyPersistedStageTopology,
  classifySemanticStageTopology,
  createUnsupportedPersistedTopologyInvalidations,
  createUnsupportedStageTopologyInvalidations,
  type OccSemanticStageReconciliation,
} from "@/infrastructure/occ/topology-naming";
import {
  applySemanticStageTopologyIds,
  planSemanticStageTopologyIds,
  createOccReferenceState,
  getOccDurableRefKey,
  renameOccReferenceStateBody,
  renameOccReferenceStateSketch,
  type OccReferenceInvalidationRecord,
  type OccReferenceState,
  type OccTrackedBody,
} from "@/infrastructure/occ/topology";

export interface OccAuthoringFeatureRecord {
  featureId: FeatureId;
  definition: FeatureDefinition;
  label?: string;
  suppressed: boolean;
  producedTargets?: readonly DurableRef[];
}

export interface OccAuthoringState extends OccFeatureExecutionContext {
  name: string;
  angularToleranceRadians: number;
  baseBodies: readonly OccTrackedBody[];
  baseConstructions: OccFeatureExecutionContext["constructions"];
  baseConstructionPlanes: ReadonlyMap<ConstructionId, SketchPlaneDefinition>;
  bodyLabels: ReadonlyMap<BodyId, string>;
  /** Display colour per body id, kept for inactive bodies like `bodyLabels`. */
  bodyAppearances: ReadonlyMap<BodyId, BodyAppearance>;
  variables: readonly DocumentVariableRecord[];
  features: readonly OccAuthoringFeatureRecord[];
  assets: GeometryAssetManifest;
  assetBlobs: ReadonlyMap<GeometryAssetHash, Uint8Array>;
  assetResolver?: OccFeatureExecutionContext["assetResolver"];
  resolvedGeometryAssets: OccFeatureExecutionContext["resolvedGeometryAssets"];
  bakedShapeCache: OccFeatureExecutionContext["bakedShapeCache"];
  embeddedBinaryAssets: readonly EmbeddedBinaryAssetRecord[];
  historyOrder: readonly DocumentHistoryOrderEntry[];
  cursor: DocumentFeatureCursor;
  diagnostics: readonly ModelingDiagnostic[];
  entities: readonly SnapshotEntityRecord[];
  renderRecords: readonly RenderableEntityRecord[];
  referenceState: OccReferenceState;
  featureTopologyStages: OccFeatureTopologyStageMap;
  previousFeatureTopologyStages: OccFeatureTopologyStageMap;
  previousFeatureTopologyLineage: OccFeatureTopologyLineageMap;
}

/**
 * The history state right after a feature applied in a rebuild, with the
 * inputs it was evaluated from. It rides on the feature's current topology
 * stage, so the stage map's native ownership graph retains its bodies. A later
 * rebuild whose history is unchanged up to this feature resumes from it instead
 * of replaying from the empty cursor (cadara-di5).
 */
export interface OccFeatureStageCheckpoint extends Pick<
  OccAuthoringState,
  | "sketches"
  | "variables"
  | "historyOrder"
  | "modelingTolerance"
  | "angularToleranceRadians"
  | "bodies"
  | "constructions"
  | "constructionPlanes"
  | "features"
  | "entities"
  | "renderRecords"
  | "referenceState"
  | "bodyAppearances"
  | "assets"
> {
  /** Diagnostics the features up to this one added to the rebuild's base diagnostics. */
  featureDiagnostics: readonly ModelingDiagnostic[];
}

/** Records `state`, which just applied `featureId`, on that feature's stage. */
export function checkpointOccFeatureStage(
  state: OccAuthoringState,
  featureId: FeatureId,
  baseDiagnosticCount: number,
): OccAuthoringState {
  const stage = state.featureTopologyStages.get(featureId);
  if (!stage) {
    throw new Error(`Applied feature ${featureId} has no topology stage.`);
  }
  const checkpoint: OccFeatureStageCheckpoint = {
    sketches: state.sketches,
    variables: state.variables,
    historyOrder: state.historyOrder,
    modelingTolerance: state.modelingTolerance,
    angularToleranceRadians: state.angularToleranceRadians,
    bodies: state.bodies,
    constructions: state.constructions,
    constructionPlanes: state.constructionPlanes,
    features: state.features,
    entities: state.entities,
    renderRecords: state.renderRecords,
    referenceState: state.referenceState,
    bodyAppearances: state.bodyAppearances,
    assets: state.assets,
    featureDiagnostics: state.diagnostics.slice(baseDiagnosticCount),
  };
  const featureTopologyStages = new Map(state.featureTopologyStages);
  featureTopologyStages.set(featureId, { ...stage, checkpoint });
  return { ...state, featureTopologyStages };
}

/** Whether `next` is `previous` with at most its labels changed, as
 * renameOccAuthoringStateSketch makes it. */
function isSketchRelabel(
  previous: SketchSnapshotRecord,
  next: SketchSnapshotRecord,
) {
  const sameExcept = <T extends object>(
    left: T,
    right: T,
    ignored: readonly (keyof T)[],
  ) =>
    [...new Set([...Object.keys(left), ...Object.keys(right)])].every(
      (key) =>
        ignored.includes(key as keyof T) ||
        left[key as keyof T] === right[key as keyof T],
    );
  return (
    sameExcept(previous, next, ["label", "sketch"]) &&
    sameExcept(previous.sketch, next.sketch, ["label"])
  );
}

/** Ids of sketches that `next` adds, removes or replaces relative to
 * `previous`; a relabelled sketch counts as replaced unless `ignoreLabels`. */
function getChangedSketchIds(
  previous: readonly SketchSnapshotRecord[],
  next: readonly SketchSnapshotRecord[],
  ignoreLabels: boolean,
) {
  if (previous === next) return new Set<SketchId>();
  const previousById = new Map(
    previous.map((sketch) => [sketch.sketchId, sketch]),
  );
  const changed = new Set<SketchId>();
  for (const sketch of next) {
    const evaluated = previousById.get(sketch.sketchId);
    if (
      evaluated !== sketch &&
      !(ignoreLabels && evaluated && isSketchRelabel(evaluated, sketch))
    ) {
      changed.add(sketch.sketchId);
    }
    previousById.delete(sketch.sketchId);
  }
  for (const sketchId of previousById.keys()) changed.add(sketchId);
  return changed;
}

/**
 * Ids of `sketches` whose dimensions or offset distances resolve differently
 * under `nextVariables` than under `previousVariables`: a document-variable
 * edit must re-solve them, and the features they feed rerun (cadara-afj3).
 */
export function getSketchIdsResolvingDifferently(
  sketches: readonly SketchSnapshotRecord[],
  previousVariables: readonly DocumentVariableRecord[],
  nextVariables: readonly DocumentVariableRecord[],
) {
  const resolvedValues = (
    sketch: SketchSnapshotRecord,
    variables: readonly DocumentVariableRecord[],
  ) => {
    const resolution = resolveSketchDimensionValues({
      definition: sketch.sketch.definition,
      variables,
    });
    return JSON.stringify(
      resolution.ok
        ? [
            resolution.definition.dimensions,
            resolution.definition.derivedRelationships,
          ]
        : resolution.diagnostics,
    );
  };
  return new Set(
    sketches
      .filter(
        (sketch) =>
          resolvedValues(sketch, previousVariables) !==
          resolvedValues(sketch, nextVariables),
      )
      .map((sketch) => sketch.sketchId),
  );
}

/**
 * Whether two feature definitions are the same authored value. Object key
 * order is not part of it: a document from the repository holds the keys
 * sorted, a feature the session evaluated holds them as its request did.
 */
function isSameFeatureDefinition(
  left: FeatureDefinition,
  right: FeatureDefinition,
) {
  return (
    left === right ||
    JSON.stringify(left) === JSON.stringify(right) ||
    JSON.stringify(stableJsonValue(left)) ===
      JSON.stringify(stableJsonValue(right))
  );
}

/**
 * The number of leading `prefix` features that `checkpoint` evaluated from
 * the same record and from the same sketches and resolved variable values
 * that a rebuild from `base` would use.
 *
 * Feature and sketch labels count only when the checkpoint holds diagnostics
 * (cadara-kv69): their messages name features and sketches, and nothing else
 * it holds derives from those labels. A body named after its feature took
 * that name into `bodyLabels` when first evaluated, which
 * isCheckpointContextUnchanged compares, and resuming takes each feature's
 * label from `prefix`.
 */
function countUnchangedCheckpointFeatures(
  checkpoint: OccFeatureStageCheckpoint,
  base: OccAuthoringState,
  prefix: readonly OccAuthoringFeatureRecord[],
  labelsFeedCheckpoint = checkpoint.featureDiagnostics.length > 0,
) {
  const variablesChanged =
    checkpoint.variables !== base.variables &&
    JSON.stringify(checkpoint.variables) !== JSON.stringify(base.variables);
  // Callers that re-solve sketches replace their records, so the identity
  // check already catches them; resolving under both variable sets keeps the
  // answer right for a caller that changes variables without re-solving.
  const changedSketchIds = new Set([
    ...getChangedSketchIds(
      checkpoint.sketches,
      base.sketches,
      !labelsFeedCheckpoint,
    ),
    ...(variablesChanged
      ? getSketchIdsResolvingDifferently(
          base.sketches,
          checkpoint.variables,
          base.variables,
        )
      : []),
  ]);
  for (const [index, feature] of prefix.entries()) {
    const evaluated = checkpoint.features[index];
    const definition = JSON.stringify(feature.definition);
    if (
      evaluated?.featureId !== feature.featureId ||
      evaluated.suppressed ||
      feature.suppressed ||
      (labelsFeedCheckpoint &&
        (evaluated.label ?? evaluated.featureId) !==
          (feature.label ?? feature.featureId)) ||
      !isSameFeatureDefinition(evaluated.definition, feature.definition) ||
      // Any sketch id the definition names, wherever it nests.
      [...changedSketchIds].some((sketchId) =>
        definition.includes(`"${sketchId}"`),
      ) ||
      (variablesChanged &&
        JSON.stringify(
          resolveFeatureDefinitionValues({
            definition: feature.definition,
            variables: checkpoint.variables,
          }),
        ) !==
          JSON.stringify(
            resolveFeatureDefinitionValues({
              definition: feature.definition,
              variables: base.variables,
            }),
          ))
    ) {
      return index;
    }
  }
  return checkpoint.features.length === prefix.length ? prefix.length : 0;
}

/**
 * Whether a rebuild from `base` evaluates the features before and including
 * `last` in the same document context as `checkpoint`: settings, history order
 * up to `last`, a label for every body it holds, an appearance for every body
 * it knew, and asset records.
 *
 * A body label differing from the one the checkpoint holds rejects it only
 * when the checkpoint holds diagnostics, which may name the body. Otherwise a
 * label feeds nothing else a feature evaluates: as for
 * renameOccAuthoringStateBody, labels derived from it entered `bodyLabels`
 * when first evaluated, and resuming relabels the bodies to `base`'s labels.
 */
function isCheckpointContextUnchanged(
  checkpoint: OccFeatureStageCheckpoint,
  base: OccAuthoringState,
  last: FeatureId,
) {
  const isLast = (entry: DocumentHistoryOrderEntry) =>
    entry.kind === "feature" && entry.featureId === last;
  const end = base.historyOrder.findIndex(isLast);
  return (
    checkpoint.modelingTolerance === base.modelingTolerance &&
    checkpoint.angularToleranceRadians === base.angularToleranceRadians &&
    end >= 0 &&
    checkpoint.historyOrder.findIndex(isLast) === end &&
    base.historyOrder
      .slice(0, end)
      .every(
        (entry, index) =>
          JSON.stringify(entry) ===
          JSON.stringify(checkpoint.historyOrder[index]),
      ) &&
    checkpoint.bodies.every((body) => {
      const label = base.bodyLabels.get(body.bodyId);
      return (
        label === body.label ||
        (label !== undefined && checkpoint.featureDiagnostics.length === 0)
      );
    }) &&
    [...checkpoint.bodyAppearances.keys()].every((bodyId) =>
      base.bodyAppearances.has(bodyId),
    ) &&
    (checkpoint.assets === base.assets ||
      JSON.stringify(checkpoint.assets) === JSON.stringify(base.assets))
  );
}

/**
 * The longest leading run of `appliedFeatures` that a rebuild from `base` can
 * take unchanged from the checkpoints on `stages` (the current runtime's), and
 * the checkpoint to resume from. Only features `isReplayable` accepts and that
 * applied in that runtime carry a checkpoint, so a failed, suppressed or
 * deferred feature ends the run.
 */
export function findReusableOccFeatureCheckpoint(
  stages: OccFeatureTopologyStageMap,
  base: OccAuthoringState,
  appliedFeatures: readonly OccAuthoringFeatureRecord[],
  isReplayable: (feature: OccAuthoringFeatureRecord) => boolean,
): {
  prefixFeatures: OccAuthoringFeatureRecord[];
  checkpoint: OccFeatureStageCheckpoint;
} | null {
  let count = 0;
  while (
    count < appliedFeatures.length &&
    isReplayable(appliedFeatures[count]!) &&
    stages.get(appliedFeatures[count]!.featureId)?.checkpoint
  ) {
    count += 1;
  }

  while (count > 0) {
    const prefix = appliedFeatures.slice(0, count);
    const last = prefix.at(-1)!.featureId;
    const checkpoint = stages.get(last)!.checkpoint!;
    const unchanged = countUnchangedCheckpointFeatures(
      checkpoint,
      base,
      prefix,
    );
    if (
      unchanged === count &&
      isCheckpointContextUnchanged(checkpoint, base, last)
    ) {
      return { prefixFeatures: prefix, checkpoint };
    }
    // A label difference rules out only checkpoints holding diagnostics; a
    // shorter one without them can still take it, so skip only to the first
    // other difference.
    count = Math.min(
      unchanged < count && checkpoint.featureDiagnostics.length > 0
        ? countUnchangedCheckpointFeatures(checkpoint, base, prefix, false)
        : unchanged,
      count - 1,
    );
  }
  return null;
}

/**
 * The unapplied features whose stage checkpoint a cursor rollback keeps so
 * that a later cursor move forward resumes them instead of running them again
 * (cadara-vjcv): the leading run after `appliedFeatures` with a checkpoint on
 * `stages` evaluated from the feature's current record. That is at most one
 * kept state per rolled-back feature; a missing or changed feature ends the
 * run, since no rebuild can resume past it.
 *
 * The run follows `features`, not the history order, because rebuilds
 * evaluate and findReusableOccFeatureCheckpoint resumes along that array (the
 * history order only selects which features apply), so each checkpoint holds
 * the features before it in this order. This is a pre-filter on definitions:
 * the resume still checks every input with findReusableOccFeatureCheckpoint.
 */
export function getResumableUnappliedTail(
  features: readonly OccAuthoringFeatureRecord[],
  appliedFeatures: readonly OccAuthoringFeatureRecord[],
  stages: OccFeatureTopologyStageMap,
): ReadonlySet<FeatureId> {
  const applied = new Set(appliedFeatures.map(({ featureId }) => featureId));
  const tail = new Set<FeatureId>();
  for (const feature of features) {
    if (applied.has(feature.featureId)) continue;
    const evaluated = stages
      .get(feature.featureId)
      ?.checkpoint?.features.at(-1);
    if (
      evaluated?.featureId !== feature.featureId ||
      evaluated.suppressed ||
      feature.suppressed ||
      !isSameFeatureDefinition(evaluated.definition, feature.definition)
    ) {
      break;
    }
    tail.add(feature.featureId);
  }
  return tail;
}

/**
 * Continues the rebuild `base` after its first `prefixFeatures`, which
 * `checkpoint` evaluated and whose `stages` are reused as they are. The caller
 * proves the prefix unchanged against `base`, so its bodies, appearances and
 * assets are those a replay from `base` would produce; each feature record
 * takes its label from `prefixFeatures`, and each body its label from `base`
 * (renamed in place, as renameOccAuthoringStateBody does). The
 * references are re-evaluated at `base`'s revision against
 * `previousReferenceState`, as the replay's base state does: the prefix keeps
 * its live references, and references only the dropped suffix made live are
 * invalidated.
 */
export function resumeOccAuthoringStateFromCheckpoint(
  base: OccAuthoringState,
  checkpoint: OccFeatureStageCheckpoint,
  stages: OccFeatureTopologyStageMap,
  prefixFeatures: readonly OccAuthoringFeatureRecord[],
  previousReferenceState: OccReferenceState,
): OccAuthoringState {
  const featureTopologyStages = new Map(
    prefixFeatures.map(({ featureId }) => {
      const stage = stages.get(featureId);
      if (!stage) {
        throw new Error(`Reused feature ${featureId} has no topology stage.`);
      }
      return [featureId, stage] as const;
    }),
  );
  const referenceState = createOccReferenceState({
    documentId: base.documentId,
    revisionId: base.revisionId,
    bodies: checkpoint.bodies,
    constructions: checkpoint.constructions,
    sketches: base.sketches,
    features: checkpoint.features,
    previous: {
      bodySnapshots: [],
      liveReferencesByKey: previousReferenceState.liveReferencesByKey,
      invalidatedReferencesByKey: new Map([
        ...checkpoint.referenceState.invalidatedReferencesByKey,
        ...previousReferenceState.invalidatedReferencesByKey,
      ]),
    },
    provedLiveReferenceKeys: new Set(
      checkpoint.referenceState.liveReferencesByKey.keys(),
    ),
    // A reference `previousReferenceState` holds live but the checkpoint's
    // evaluation invalidated (a resume past a rollback, cadara-vjcv) keeps the
    // reason that evaluation gave it, not a generic missing reference.
    historyInvalidations: new Map(
      [...checkpoint.referenceState.invalidatedReferencesByKey].flatMap(
        ([key, { invalidation }]) =>
          invalidation
            ? [
                [
                  key,
                  {
                    target: invalidation.target,
                    reason: invalidation.reason,
                    sourceTarget: invalidation.sourceTarget,
                  },
                ] as const,
              ]
            : [],
      ),
    ),
  });
  const features = checkpoint.features.map((feature, index) => {
    const label = prefixFeatures[index]!.label ?? feature.featureId;
    return feature.label === label ? feature : { ...feature, label };
  });

  const resumed: OccAuthoringState = {
    ...base,
    bodies: checkpoint.bodies,
    constructions: checkpoint.constructions,
    constructionPlanes: checkpoint.constructionPlanes,
    features,
    authoredFeatures: features,
    cursor: { kind: "feature", featureId: prefixFeatures.at(-1)!.featureId },
    diagnostics: [...base.diagnostics, ...checkpoint.featureDiagnostics],
    entities: checkpoint.entities,
    renderRecords: checkpoint.renderRecords,
    referenceState,
    previousTopologyStage: null,
    topologyProvenanceIndex: createOccTopologyProvenanceIndex({
      stages: featureTopologyStages,
      previousLineage: base.previousFeatureTopologyLineage,
      historyOrder: base.historyOrder,
    }),
    featureTopologyStages,
  };
  return checkpoint.bodies.reduce((state, { bodyId, label }) => {
    const baseLabel = base.bodyLabels.get(bodyId) ?? label;
    return baseLabel === label
      ? state
      : renameOccAuthoringStateBody(state, {
          bodyId,
          label: baseLabel,
          revisionId: base.revisionId,
        });
  }, resumed);
}

function createTailCursor(
  features: readonly { featureId: FeatureId }[],
  sketches: readonly { sketchId: SketchId }[],
): DocumentFeatureCursor {
  const tail = features.at(-1);
  if (tail) {
    return { kind: "feature", featureId: tail.featureId };
  }

  const sketch = sketches.at(-1);
  return sketch
    ? { kind: "sketch", sketchId: sketch.sketchId }
    : { kind: "empty" };
}

function applyBodyLabels(
  bodies: readonly OccTrackedBody[],
  bodyLabels: ReadonlyMap<BodyId, string>,
): OccTrackedBody[] {
  if (bodyLabels.size === 0) {
    return [...bodies];
  }

  return bodies.map((body) => {
    const label = bodyLabels.get(body.bodyId);
    return label ? { ...body, label } : body;
  });
}

/**
 * T17k2 (T17h finding): a body a feature creates is named after the feature
 * ("Extrude 1"; several solids "Extrude 1 (2)"), not by its id: the kernel
 * tracks it under the generated label `‹featureId›` / `‹featureId›_‹n›`.
 */
function withFeatureBodyLabels(
  bodies: readonly OccTrackedBody[],
  feature: OccAuthoringFeatureRecord,
): OccTrackedBody[] {
  const featureLabel = feature.label;
  if (!featureLabel) return [...bodies];
  return bodies.map((body) => {
    const label = generatedBodyLabel(body);
    return body.ownerFeatureId === feature.featureId && label
      ? {
          ...body,
          label:
            label.index === null
              ? featureLabel
              : `${featureLabel} (${label.index})`,
        }
      : body;
  });
}

/** The kernel's id-based default label of `body`, if it has one. */
function generatedBodyLabel(
  body: Pick<OccTrackedBody, "ownerFeatureId" | "label">,
): { index: string | null } | null {
  const { label, ownerFeatureId: featureId } = body;
  if (featureId === null) return null;
  if (label === featureId) return { index: null };
  const index = label.startsWith(`${featureId}_`)
    ? label.slice(featureId.length + 1)
    : "";
  return /^[0-9]+$/.test(index) ? { index } : null;
}

/**
 * A body rename changes only labels, so no feature runs again: topology,
 * lineage, naming and reference identities are kept and every record carrying
 * the body's label is renamed in place. Labels a feature derives from a body's
 * label (a severing cut's `‹label›_‹n›` pieces) need no recomputation: each
 * body's label entered `bodyLabels` when it was first evaluated
 * (applyFeatureResult), and a rebuild or reopen applies those entries over the
 * derived ones, so the pieces keep their names, as they would after a rebuild.
 */
export function renameOccAuthoringStateBody(
  state: OccAuthoringState,
  input: { bodyId: BodyId; label: string; revisionId: OccAuthoringState["revisionId"] },
): OccAuthoringState {
  // One renamed record per tracked body record, so a body a topology stage
  // shares with `bodies` stays one object.
  const renamed = new Map<OccTrackedBody, OccTrackedBody>();
  const rename = (body: OccTrackedBody) => {
    if (body.bodyId !== input.bodyId) return body;
    const existing = renamed.get(body);
    if (existing) return existing;
    const next = { ...body, label: input.label };
    renamed.set(body, next);
    return next;
  };
  const renameStages = (stages: OccFeatureTopologyStageMap) =>
    new Map(
      [...stages].map(([featureId, stage]) => [
        featureId,
        {
          ...stage,
          outputs: new Map(
            [...stage.outputs].map(([slot, output]) => [
              slot,
              { ...output, body: rename(output.body) },
            ]),
          ),
        },
      ]),
    );
  const bodyLabels = new Map(state.bodyLabels);
  bodyLabels.set(input.bodyId, input.label);

  return {
    ...state,
    revisionId: input.revisionId,
    bodyLabels,
    bodies: state.bodies.map(rename),
    baseBodies: state.baseBodies.map(rename),
    featureTopologyStages: renameStages(state.featureTopologyStages),
    previousFeatureTopologyStages: renameStages(
      state.previousFeatureTopologyStages,
    ),
    referenceState: renameOccReferenceStateBody(state.referenceState, input),
  };
}

/**
 * A feature relabel changes only the feature record (cadara-kv69), so no
 * feature runs again. Bodies named after the feature keep their names, as in a
 * rebuild: those names entered `bodyLabels` when the bodies were first
 * evaluated. References name a feature by its id. Rebuild diagnostics name
 * features by label, so a caller relabels in place only a state none of whose
 * diagnostics names the feature.
 */
export function renameOccAuthoringStateFeature(
  state: OccAuthoringState,
  input: {
    featureId: FeatureId;
    label: string;
    revisionId: OccAuthoringState["revisionId"];
  },
): OccAuthoringState {
  return {
    ...state,
    revisionId: input.revisionId,
    features: state.features.map((feature) =>
      feature.featureId === input.featureId
        ? { ...feature, label: input.label }
        : feature,
    ),
  };
}

/**
 * A sketch relabel changes only the sketch record and the sketch reference's
 * label (cadara-kv69): the sketch is not solved again and no feature runs
 * again. The features' checkpoints still hold the previous record, which
 * countUnchangedCheckpointFeatures accepts as unchanged. Rebuild diagnostics
 * name sketches by label, so a caller relabels in place only a state none of
 * whose diagnostics names the sketch.
 */
export function renameOccAuthoringStateSketch(
  state: OccAuthoringState,
  input: {
    sketchId: SketchId;
    label: string;
    revisionId: OccAuthoringState["revisionId"];
  },
): OccAuthoringState {
  return {
    ...state,
    revisionId: input.revisionId,
    sketches: state.sketches.map((sketch) =>
      sketch.sketchId === input.sketchId
        ? {
            ...sketch,
            label: input.label,
            sketch: { ...sketch.sketch, label: input.label },
          }
        : sketch,
    ),
    referenceState: renameOccReferenceStateSketch(state.referenceState, input),
  };
}

function mergeGeometryAssetRecords(
  manifest: GeometryAssetManifest,
  updates: readonly GeometryAssetRecord[] | undefined,
): GeometryAssetManifest {
  if (!updates || updates.length === 0) {
    return manifest;
  }

  const updatesById = new Map(updates.map((asset) => [asset.assetId, asset]));
  return {
    ...manifest,
    records: manifest.records.map(
      (asset) => updatesById.get(asset.assetId) ?? asset,
    ),
  };
}

function createStandardConstructionState(
  documentId: OccFeatureExecutionContext["documentId"],
  revisionId: OccFeatureExecutionContext["revisionId"],
) {
  const standardPlanes = [
    createStandardPlaneDefinition("xy"),
    createStandardPlaneDefinition("yz"),
    createStandardPlaneDefinition("xz"),
  ];

  const standardPlaneLabels = {
    xy: "Top Plane",
    yz: "Right Plane",
    xz: "Front Plane",
  } as const;

  return {
    constructions: standardPlanes.map((plane) => {
      const support = plane.support;

      if (support.kind !== "construction") {
        throw new Error(
          "Expected standard OCC planes to be construction-backed.",
        );
      }

      const label = plane.key
        ? standardPlaneLabels[plane.key]
        : support.constructionId;

      return {
        ownerDocumentId: documentId,
        ownerRevisionId: revisionId,
        ownerFeatureId: null,
        ownerSketchId: null,
        ownerBodyId: null,
        constructionId: support.constructionId,
        label,
        constructionType: "plane" as const,
        plane,
        target: {
          kind: "construction" as const,
          constructionId: support.constructionId,
        },
      };
    }),
    constructionPlanes: new Map<ConstructionId, SketchPlaneDefinition>(
      standardPlanes.map((plane) => {
        const support = plane.support;

        if (support.kind !== "construction") {
          throw new Error(
            "Expected standard OCC planes to be construction-backed.",
          );
        }

        return [support.constructionId, plane];
      }),
    ),
  };
}

export function createOccAuthoringState(
  oc: OpenCascadeInstance,
  input: {
    sketches?: readonly SketchSnapshotRecord[];
    bodies?: readonly OccTrackedBody[];
    bodyLabels?: ReadonlyMap<BodyId, string>;
    bodyAppearances?: ReadonlyMap<BodyId, BodyAppearance>;
    variables?: readonly DocumentVariableRecord[];
    features?: readonly OccAuthoringFeatureRecord[];
    assets?: GeometryAssetManifest;
    assetBlobs?: ReadonlyMap<GeometryAssetHash, Uint8Array>;
    assetResolver?: OccFeatureExecutionContext["assetResolver"];
    resolvedGeometryAssets?: OccFeatureExecutionContext["resolvedGeometryAssets"];
    bakedShapeCache?: OccFeatureExecutionContext["bakedShapeCache"];
    embeddedBinaryAssets?: readonly EmbeddedBinaryAssetRecord[];
    historyOrder?: readonly DocumentHistoryOrderEntry[];
    cursor?: DocumentFeatureCursor;
    constructions?: OccFeatureExecutionContext["constructions"];
    constructionPlanes?: ReadonlyMap<ConstructionId, SketchPlaneDefinition>;
    documentId?: OccFeatureExecutionContext["documentId"];
    name?: string;
    revisionId?: OccFeatureExecutionContext["revisionId"];
    modelingTolerance?: number;
    angularToleranceRadians?: number;
    previousReferenceState?: OccReferenceState;
    featureTopologyStages?: OccFeatureTopologyStageMap;
    previousFeatureTopologyStages?: OccFeatureTopologyStageMap;
    previousFeatureTopologyLineage?: OccFeatureTopologyLineageMap;
    diagnostics?: readonly ModelingDiagnostic[];
  } = {},
): OccAuthoringState {
  const documentId = input.documentId ?? OCC_KERNEL_DOCUMENT_ID;
  const name = input.name ?? OCC_KERNEL_DOCUMENT_NAME;
  const revisionId = input.revisionId ?? OCC_KERNEL_INITIAL_REVISION_ID;
  const standardState = createStandardConstructionState(documentId, revisionId);
  const constructionById = new Map<
    ConstructionId,
    OccFeatureExecutionContext["constructions"][number]
  >(
    standardState.constructions.map((construction) => [
      construction.constructionId,
      construction,
    ]),
  );

  for (const construction of input.constructions ?? []) {
    constructionById.set(construction.constructionId, construction);
  }

  const constructionPlanes = new Map<ConstructionId, SketchPlaneDefinition>([
    ...standardState.constructionPlanes.entries(),
    ...Array.from(input.constructionPlanes?.entries() ?? []),
  ]);
  const baseConstructions = [...constructionById.values()];
  const bodyLabels = new Map<BodyId, string>(input.bodyLabels ?? []);
  const variables = [...(input.variables ?? [])];
  const baseBodies = applyBodyLabels(input.bodies ?? [], bodyLabels);
  const bodyAppearances = withAutoBodyAppearances(
    new Map(input.bodyAppearances ?? []),
    baseBodies.map((body) => body.bodyId),
  );
  const features = [...(input.features ?? [])];
  const assets = structuredClone(
    input.assets ?? createEmptyGeometryAssetManifest(),
  );
  const assetBlobs = new Map(input.assetBlobs ?? []);
  const resolvedGeometryAssets = new Map(input.resolvedGeometryAssets ?? []);
  const bakedShapeCache = input.bakedShapeCache ?? new Map();
  const embeddedBinaryAssets = structuredClone(
    input.embeddedBinaryAssets ?? [],
  );
  const sketches = input.sketches ?? [];
  const historyOrder = input.historyOrder ?? [
    ...sketches.map((sketch) => ({
      kind: "sketch" as const,
      sketchId: sketch.sketchId,
    })),
    ...features.map((feature) => ({
      kind: "feature" as const,
      featureId: feature.featureId,
    })),
  ];
  const cursor = input.cursor ?? createTailCursor(features, sketches);
  const featureTopologyStages = new Map(input.featureTopologyStages ?? []);
  const previousFeatureTopologyLineage = new Map(
    input.previousFeatureTopologyLineage ?? [],
  );
  const topologyProvenanceIndex = createOccTopologyProvenanceIndex({
    stages: featureTopologyStages,
    previousLineage: previousFeatureTopologyLineage,
    historyOrder,
  });
  const referenceState = createOccReferenceState({
    documentId,
    revisionId,
    bodies: baseBodies,
    constructions: baseConstructions,
    sketches,
    features,
    previous: input.previousReferenceState,
  });

  return {
    oc,
    documentId,
    name,
    revisionId,
    modelingTolerance:
      input.modelingTolerance ?? OCC_KERNEL_SETTINGS.modelingTolerance,
    angularToleranceRadians:
      input.angularToleranceRadians ??
      OCC_KERNEL_SETTINGS.angularToleranceRadians,
    sketches,
    constructions: baseConstructions,
    constructionPlanes,
    bodies: baseBodies,
    baseBodies,
    baseConstructions,
    baseConstructionPlanes: constructionPlanes,
    bodyLabels,
    bodyAppearances,
    variables,
    features,
    assets,
    assetBlobs,
    assetResolver: input.assetResolver,
    resolvedGeometryAssets,
    bakedShapeCache,
    previousTopologyStage: null,
    topologyProvenanceIndex,
    authoredFeatures: features,
    embeddedBinaryAssets,
    historyOrder,
    cursor,
    diagnostics: [...(input.diagnostics ?? [])],
    entities: [],
    renderRecords: [],
    referenceState,
    featureTopologyStages,
    previousFeatureTopologyStages: new Map(
      input.previousFeatureTopologyStages ?? [],
    ),
    previousFeatureTopologyLineage,
  };
}

function reconcileStageOutputIds(input: {
  previous: Pick<OccTrackedBody, "bodyId" | "topologyToken">;
  current: OccTopologyStageOutput;
  preservedTargetsByCurrentKey: OccSemanticStageReconciliation["preservedTargetsByCurrentKey"];
  reusePreviousTopologyToken?: boolean;
}) {
  const reconciled = applySemanticStageTopologyIds({
    previous: input.previous,
    current: input.current.body,
    preservedTargetsByCurrentKey: input.preservedTargetsByCurrentKey,
    reusePreviousTopologyToken: input.reusePreviousTopologyToken,
  });
  const sourceTargets = new Map(
    [...input.current.sourceTargets].map(([sourceKey, targets]) => [
      sourceKey,
      targets.map((target) =>
        target.kind === "face" ||
        target.kind === "edge" ||
        target.kind === "vertex"
          ? (reconciled.targetByCurrentKey.get(getOccDurableRefKey(target)) ??
            target)
          : target,
      ),
    ]),
  );
  return { reconciled, sourceTargets };
}

/**
 * A restore keeps a persisted output's token and topology ids when it
 * reproduces the persisted output exactly (ids, source targets, witnesses), so
 * reopening a document rewrites none of its lineage (cadara-797). Any
 * difference advances the token as an in-session rebuild does.
 *
 * Two forms reproduce. A fresh evaluation (no previous stage or lineage) keeps
 * its evaluated ids, native hash ids for subtopologies no witness preserves
 * included, and the restore keeps an output whose raw evaluation equals it
 * with those ids (cadara-phi0). A freshly built file then reopens unchanged:
 * the first feature evaluates from the same authored inputs as the fresh
 * build, so its raw output equals the stored one, and the later features'
 * raw outputs equal theirs too. That later equality is measured on the landing
 * fixtures, not proven (a kept body is reconciled onto itself and drops its
 * OCAF naming); a mismatch falls back to minting below. An output a
 * reconciliation wrote (minted ids) reproduces when minting with its stored
 * token gives them.
 *
 * Rule: a restore reproduces a persisted output exactly (either form); an
 * in-session rebuild always re-mints unwitnessed ids and advances the token;
 * both forms are valid persisted forms. A rebuild therefore names those
 * subtopologies differently from a cold open of the same document, by
 * position only.
 */
function reproducePersistedStageOutput(
  previous: AuthoredTopologyLineageOutput,
  current: OccTopologyStageOutput,
  preservedTargetsByCurrentKey: OccSemanticStageReconciliation["preservedTargetsByCurrentKey"],
) {
  if (
    isSameTopologyLineageOutput(
      previous,
      serializeOccTopologyStageOutput(previous.outputSlot, current),
    )
  ) {
    // Every id is kept; reconciling to itself gives the body the form any
    // reconciled output has (no seeded naming, native ids aliased).
    return reconcileStageOutputIds({
      previous: {
        bodyId: previous.outputSlot,
        topologyToken: previous.topologyToken,
      },
      current,
      preservedTargetsByCurrentKey: new Map(
        [
          ...current.body.topology.faceIds.map((faceId) => ({
            kind: "face" as const,
            bodyId: current.body.bodyId,
            faceId,
          })),
          ...current.body.topology.edgeIds.map((edgeId) => ({
            kind: "edge" as const,
            bodyId: current.body.bodyId,
            edgeId,
          })),
          ...current.body.topology.vertexIds.map((vertexId) => ({
            kind: "vertex" as const,
            bodyId: current.body.bodyId,
            vertexId,
          })),
        ].map((target) => [getOccDurableRefKey(target), target]),
      ),
      reusePreviousTopologyToken: true,
    });
  }
  // Planned ids first: minting with an already used token can collide with a
  // preserved id when the output changed, which reconciliation rejects.
  const planned = planSemanticStageTopologyIds({
    current: current.body,
    preservedTargetsByCurrentKey,
    topologyToken: previous.topologyToken,
  });
  const sameIds = (left: readonly string[], right: readonly string[]) =>
    left.length === right.length &&
    left.every((id, index) => id === right[index]);
  if (
    !sameIds(planned.faceIds, previous.topology.faceIds) ||
    !sameIds(planned.edgeIds, previous.topology.edgeIds) ||
    !sameIds(planned.vertexIds, previous.topology.vertexIds)
  ) {
    return null;
  }
  const result = reconcileStageOutputIds({
    previous: {
      bodyId: previous.outputSlot,
      topologyToken: previous.topologyToken,
    },
    current,
    preservedTargetsByCurrentKey,
    reusePreviousTopologyToken: true,
  });
  return isSameTopologyLineageOutput(
    previous,
    serializeOccTopologyStageOutput(previous.outputSlot, {
      ...current,
      body: result.reconciled.body,
      sourceTargets: result.sourceTargets,
    }),
  )
    ? result
    : null;
}

function reconcileFeatureTopologyStage(
  previousStage: ReturnType<typeof getPreviousFeatureTopologyStage>,
  previousLineage: ReturnType<typeof getPreviousFeatureTopologyLineage>,
  currentStage: ReturnType<typeof createFeatureTopologyStage>,
  bodies: readonly OccTrackedBody[],
  historyInvalidations: ReadonlyMap<string, OccReferenceInvalidationRecord>,
) {
  if (!previousStage && !previousLineage) {
    return {
      bodies: [...bodies],
      topologyStage: currentStage,
      historyInvalidations: new Map(historyInvalidations),
      provedLiveReferenceKeys: new Set<string>(),
    };
  }

  const bodiesById = new Map(bodies.map((body) => [body.bodyId, body]));
  const outputs = new Map(currentStage.outputs);
  const reconciledInvalidations = new Map(historyInvalidations);
  const provedLiveReferenceKeys = new Set<string>();

  for (const [outputSlot, currentOutput] of currentStage.outputs) {
    const previousOutput = previousStage?.outputs.get(outputSlot);
    const previousLineageOutput = previousLineage?.outputs.find(
      (output) => output.outputSlot === outputSlot,
    );
    if (!previousOutput && !previousLineageOutput) {
      continue;
    }

    const classification = previousOutput
      ? classifySemanticStageTopology({
          previous: previousOutput,
          current: currentOutput,
        })
      : classifyPersistedStageTopology({
          previous: previousLineageOutput!,
          current: currentOutput,
        });
    const { reconciled, sourceTargets } =
      (!previousOutput &&
        reproducePersistedStageOutput(
          previousLineageOutput!,
          currentOutput,
          classification.preservedTargetsByCurrentKey,
        )) ||
      reconcileStageOutputIds({
        previous: previousOutput?.body ?? {
          bodyId: previousLineageOutput!.outputSlot,
          topologyToken: previousLineageOutput!.topologyToken,
        },
        current: currentOutput,
        preservedTargetsByCurrentKey:
          classification.preservedTargetsByCurrentKey,
      });

    for (const target of classification.preservedTargetsByCurrentKey.values()) {
      provedLiveReferenceKeys.add(getOccDurableRefKey(target));
    }

    // Reconciliation owns topology identity, not authored body names. The stage
    // body can predate applyBodyLabels above; retain that current authored label.
    const body = { ...reconciled.body, label: bodiesById.get(outputSlot)?.label ?? reconciled.body.label };
    bodiesById.set(outputSlot, body);
    outputs.set(outputSlot, {
      ...currentOutput,
      body,
      sourceTargets,
    });
    for (const [key, invalidation] of classification.invalidations) {
      reconciledInvalidations.set(key, invalidation);
    }
  }

  const previousOutputs = previousStage
    ? [...previousStage.outputs.values()].map((output) => ({
        outputSlot: output.outputSlot,
        invalidations: createUnsupportedStageTopologyInvalidations(output),
      }))
    : (previousLineage?.outputs ?? []).map((output) => ({
        outputSlot: output.outputSlot,
        invalidations: createUnsupportedPersistedTopologyInvalidations(output),
      }));
  for (const previousOutput of previousOutputs) {
    if (currentStage.outputs.has(previousOutput.outputSlot)) {
      continue;
    }

    for (const [key, invalidation] of previousOutput.invalidations) {
      reconciledInvalidations.set(key, invalidation);
    }
  }

  return {
    bodies: bodies.map((body) => bodiesById.get(body.bodyId) ?? body),
    topologyStage: { ...currentStage, outputs },
    historyInvalidations: reconciledInvalidations,
    provedLiveReferenceKeys,
  };
}

function applyFeatureResult(
  state: OccAuthoringState,
  feature: OccAuthoringFeatureRecord,
  result: OccFeatureExecutionResult,
): OccAuthoringState {
  const features = [
    ...state.features,
    {
      ...feature,
      definition: result.featureDefinition ?? feature.definition,
      label: feature.label ?? feature.featureId,
      suppressed: feature.suppressed,
      producedTargets: [...result.producedTargets],
    },
  ];
  const rawBodies = applyBodyLabels(result.bodies, state.bodyLabels);
  const rawTopologyStage =
    result.topologyStage ??
    createFeatureTopologyStage({
      featureId: feature.featureId,
      previousBodies: state.bodies,
      currentBodies: rawBodies,
    });

  if (rawTopologyStage.featureId !== feature.featureId) {
    throw new Error(
      `Feature ${feature.featureId} returned topology stage ${rawTopologyStage.featureId}.`,
    );
  }

  const reconciled = reconcileFeatureTopologyStage(
    getPreviousFeatureTopologyStage(
      state.previousFeatureTopologyStages,
      feature.featureId,
    ),
    getPreviousFeatureTopologyLineage(
      state.previousFeatureTopologyLineage,
      feature.featureId,
    ),
    rawTopologyStage,
    rawBodies,
    result.historyInvalidations,
  );
  // Named after reconciliation: a reconciled body is the topology stage's,
  // which the feature tracked under its generated label.
  const bodies = applyBodyLabels(
    withFeatureBodyLabels(reconciled.bodies, feature),
    state.bodyLabels,
  );
  const referenceState = createOccReferenceState({
    documentId: state.documentId,
    revisionId: state.revisionId,
    bodies,
    constructions: result.constructions,
    sketches: state.sketches,
    features,
    previous: state.referenceState,
    historyInvalidations: reconciled.historyInvalidations,
    provedLiveReferenceKeys: reconciled.provedLiveReferenceKeys,
  });
  const featureTopologyStages = new Map(state.featureTopologyStages);
  featureTopologyStages.set(feature.featureId, reconciled.topologyStage);
  const historyOrder = state.historyOrder.some(
    (entry) =>
      entry.kind === "feature" && entry.featureId === feature.featureId,
  )
    ? state.historyOrder
    : [
        ...state.historyOrder,
        { kind: "feature" as const, featureId: feature.featureId },
      ];
  const topologyProvenanceIndex = createOccTopologyProvenanceIndex({
    stages: featureTopologyStages,
    previousLineage: state.previousFeatureTopologyLineage,
    historyOrder,
  });

  return {
    ...state,
    assets: mergeGeometryAssetRecords(state.assets, result.assetRecords),
    // Retain final human/authored labels even when these bodies become inactive.
    bodyLabels: new Map([
      ...state.bodyLabels,
      ...bodies.map((body) => [body.bodyId, body.label] as const),
    ]),
    // A body id seen for the first time gets the next auto palette slot here,
    // inside the authored action whose feature created it.
    bodyAppearances: withAutoBodyAppearances(
      state.bodyAppearances,
      bodies.map((body) => body.bodyId),
    ),
    bodies,
    constructions: result.constructions,
    constructionPlanes: result.constructionPlanes,
    features,
    authoredFeatures: features,
    cursor: { kind: "feature", featureId: feature.featureId },
    diagnostics: [...state.diagnostics, ...(result.diagnostics ?? [])],
    entities: [...state.entities, ...result.entities],
    renderRecords: [...state.renderRecords, ...result.renderRecords],
    referenceState,
    previousTopologyStage: null,
    topologyProvenanceIndex,
    historyOrder,
    featureTopologyStages,
  };
}

type OccNamingOwnershipGraph = Pick<
  OccAuthoringState,
  "bodies" | "featureTopologyStages"
> &
  Partial<
    Pick<OccAuthoringState, "baseBodies" | "previousFeatureTopologyStages">
  >;

function collectOccNamingStates(state: Partial<OccNamingOwnershipGraph>) {
  const bodies = [...(state.baseBodies ?? []), ...(state.bodies ?? [])];
  for (const stages of [
    state.featureTopologyStages,
    state.previousFeatureTopologyStages,
  ]) {
    for (const stage of stages?.values() ?? []) {
      for (const output of stage.outputs.values()) bodies.push(output.body);
      bodies.push(...(stage.checkpoint?.bodies ?? []));
    }
  }
  return bodies.flatMap((body) => (body.naming ? [body.naming] : []));
}

/**
 * Semantic stage reconciliation replaces result bodies with re-identified
 * bodies that share their shape wrappers but drop the stale naming state.
 * Releases the dropped naming wrappers that no retained state still owns:
 * labels first, then the documents that own their native label nodes.
 */
function releaseDroppedOccNaming(
  result: Partial<OccNamingOwnershipGraph>,
  retained: readonly OccNamingOwnershipGraph[],
) {
  const retainedOwners = new Set<unknown>();
  for (const naming of retained.flatMap(collectOccNamingStates)) {
    retainedOwners.add(naming.document);
    retainedOwners.add(naming.bodyLabel);
    for (const label of naming.topologyLabelsByKey.values()) {
      retainedOwners.add(label);
    }
    for (const label of naming.selectorLabelsByKey.values()) {
      retainedOwners.add(label);
    }
  }

  const labels = new Set<{ delete(): void }>();
  const documents = new Set<{ delete(): void }>();
  for (const naming of collectOccNamingStates(result)) {
    for (const label of [
      naming.bodyLabel,
      ...naming.topologyLabelsByKey.values(),
      ...naming.selectorLabelsByKey.values(),
    ]) {
      if (!retainedOwners.has(label)) labels.add(label);
    }
    if (!retainedOwners.has(naming.document)) documents.add(naming.document);
  }
  releaseOccObjects([...labels, ...documents]);
}

export function applyOccFeatureToAuthoringState(
  state: OccAuthoringState,
  feature: OccAuthoringFeatureRecord,
) {
  const resolvedDefinition = resolveFeatureDefinitionValues({
    definition: feature.definition,
    variables: state.variables,
  });

  if (!resolvedDefinition.ok) {
    throw new Error(
      resolvedDefinition.diagnostics
        .map((diagnostic) => diagnostic.message)
        .join(" "),
    );
  }

  const previousTopologyStage = getPreviousFeatureTopologyStage(
    state.previousFeatureTopologyStages,
    feature.featureId,
  );
  const historyOrder = state.historyOrder.some(
    (entry) =>
      entry.kind === "feature" && entry.featureId === feature.featureId,
  )
    ? state.historyOrder
    : [
        ...state.historyOrder,
        { kind: "feature" as const, featureId: feature.featureId },
      ];
  const topologyProvenanceIndex = createOccTopologyProvenanceIndex({
    stages: state.featureTopologyStages,
    previousLineage: state.previousFeatureTopologyLineage,
    historyOrder,
    beforeFeatureId: feature.featureId,
  });

  const result = executeOccFeature(
    {
      ...state,
      previousTopologyStage,
      previousTopologyLineage: getPreviousFeatureTopologyLineage(
        state.previousFeatureTopologyLineage,
        feature.featureId,
      ),
      topologyProvenanceIndex,
    },
    feature.featureId,
    resolvedDefinition.definition,
  );

  const resultOwnership = {
    bodies: result.bodies,
    featureTopologyStages: result.topologyStage
      ? new Map([[feature.featureId, result.topologyStage]])
      : undefined,
  };
  let next: OccAuthoringState;
  try {
    next = applyFeatureResult(state, feature, result);
  } catch (error) {
    try {
      releaseDiscardedOccAuthoringStateObjects(resultOwnership, [state]);
    } catch (cleanupError) {
      throw combineOccCleanupError(error, cleanupError);
    }
    throw error;
  }

  try {
    releaseDroppedOccNaming(resultOwnership, [state, next]);
  } catch (error) {
    try {
      releaseDiscardedOccAuthoringStateObjects(next, [state]);
    } catch (cleanupError) {
      throw combineOccCleanupError(error, cleanupError);
    }
    throw error;
  }
  return next;
}

export function rebuildOccAuthoringState(
  state: OccAuthoringState,
  features: readonly OccAuthoringFeatureRecord[],
) {
  let current = createOccAuthoringState(state.oc, {
    documentId: state.documentId,
    name: state.name,
    revisionId: state.revisionId,
    modelingTolerance: state.modelingTolerance,
    angularToleranceRadians: state.angularToleranceRadians,
    sketches: state.sketches,
    variables: state.variables,
    bodies: state.baseBodies,
    bodyLabels: state.bodyLabels,
    bodyAppearances: state.bodyAppearances,
    constructions: state.baseConstructions,
    constructionPlanes: state.baseConstructionPlanes,
    features: [],
    assets: state.assets,
    cursor: { kind: "empty" },
    assetResolver: state.assetResolver,
    previousReferenceState: state.referenceState,
    previousFeatureTopologyStages: state.featureTopologyStages,
    previousFeatureTopologyLineage: state.previousFeatureTopologyLineage,
    historyOrder: state.historyOrder,
    resolvedGeometryAssets: state.resolvedGeometryAssets,
    bakedShapeCache: state.bakedShapeCache,
  });

  for (const feature of features) {
    if (feature.suppressed) {
      current = {
        ...current,
        features: [
          ...current.features,
          {
            ...feature,
            label: feature.label ?? feature.featureId,
            producedTargets: [],
          },
        ],
      };
      continue;
    }
    current = applyOccFeatureToAuthoringState(current, feature);
  }

  return { ...current, previousFeatureTopologyLineage: new Map() };
}

export function buildOccConstructionPresentationForState(
  state: OccAuthoringState,
) {
  return state.constructions.flatMap((construction) => {
    const plane = state.constructionPlanes.get(construction.constructionId);

    if (!plane) {
      return [];
    }

    return createConstructionPresentationArtifacts(state, construction, plane)
      .renderRecords;
  });
}
