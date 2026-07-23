import type { DurableRef } from "@/contracts/shared/references";
import {
  createEmptyGeometryAssetManifest,
  type GeometryAssetHash,
  type GeometryAssetManifest,
  type GeometryAssetRecord,
} from "@/contracts/modeling/geometry-assets";
import type { EmbeddedBinaryAssetRecord } from "@/contracts/modeling/embedded-binary-assets";
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
} from "@/domain/modeling/opencascade-kernel-seed";
import type { DocumentHistoryOrderEntry } from "@/domain/modeling/document-history";
import {
  createConstructionPresentationArtifacts,
  executeOccFeature,
  type OccFeatureExecutionContext,
  type OccFeatureExecutionResult,
} from "@/domain/modeling/occ/features";
import { resolveFeatureDefinitionValues } from "@/domain/modeling/feature-value-expressions";
import type { OpenCascadeInstance } from "@/domain/modeling/occ/runtime";
import {
  createFeatureTopologyStage,
  getPreviousFeatureTopologyLineage,
  getPreviousFeatureTopologyStage,
  type OccFeatureTopologyLineageMap,
  type OccFeatureTopologyStageMap,
} from "@/domain/modeling/occ/topology-stage";
import {
  classifyPersistedStageTopology,
  classifySemanticStageTopology,
  createUnsupportedPersistedTopologyInvalidations,
  createUnsupportedStageTopologyInvalidations,
} from "@/domain/modeling/occ/topology-naming";
import {
  applySemanticStageTopologyIds,
  createOccReferenceState,
  getOccDurableRefKey,
  type OccReferenceInvalidationRecord,
  type OccReferenceState,
  type OccTrackedBody,
} from "@/domain/modeling/occ/topology";

export interface OccAuthoringFeatureRecord {
  featureId: FeatureId;
  definition: FeatureDefinition;
  label?: string;
  suppressed: boolean;
  producedTargets?: readonly DurableRef[];
}

export interface OccAuthoringState extends OccFeatureExecutionContext {
  name: string;
  baseBodies: readonly OccTrackedBody[];
  baseConstructions: OccFeatureExecutionContext["constructions"];
  baseConstructionPlanes: ReadonlyMap<ConstructionId, SketchPlaneDefinition>;
  bodyLabels: ReadonlyMap<BodyId, string>;
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
    sketches,
    constructions: baseConstructions,
    constructionPlanes,
    bodies: baseBodies,
    baseBodies,
    baseConstructions,
    baseConstructionPlanes: constructionPlanes,
    bodyLabels,
    variables,
    features,
    assets,
    assetBlobs,
    assetResolver: input.assetResolver,
    resolvedGeometryAssets,
    bakedShapeCache,
    previousTopologyStage: null,
    authoredFeatures: features,
    embeddedBinaryAssets,
    historyOrder,
    cursor,
    diagnostics: [...(input.diagnostics ?? [])],
    entities: [],
    renderRecords: [],
    referenceState,
    featureTopologyStages: new Map(input.featureTopologyStages ?? []),
    previousFeatureTopologyStages: new Map(
      input.previousFeatureTopologyStages ?? [],
    ),
    previousFeatureTopologyLineage: new Map(
      input.previousFeatureTopologyLineage ?? [],
    ),
  };
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
    const reconciled = applySemanticStageTopologyIds({
      previous: previousOutput?.body ?? {
        bodyId: previousLineageOutput!.outputSlot,
        topologyToken: previousLineageOutput!.topologyToken,
      },
      current: currentOutput.body,
      preservedTargetsByCurrentKey: classification.preservedTargetsByCurrentKey,
    });
    const sourceTargets = new Map(
      [...currentOutput.sourceTargets].map(([sourceKey, targets]) => [
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

    for (const target of classification.preservedTargetsByCurrentKey.values()) {
      provedLiveReferenceKeys.add(getOccDurableRefKey(target));
    }

    bodiesById.set(outputSlot, reconciled.body);
    outputs.set(outputSlot, {
      ...currentOutput,
      body: reconciled.body,
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
  const referenceState = createOccReferenceState({
    documentId: state.documentId,
    revisionId: state.revisionId,
    bodies: reconciled.bodies,
    constructions: result.constructions,
    sketches: state.sketches,
    features,
    previous: state.referenceState,
    historyInvalidations: reconciled.historyInvalidations,
    provedLiveReferenceKeys: reconciled.provedLiveReferenceKeys,
  });
  const featureTopologyStages = new Map(state.featureTopologyStages);
  featureTopologyStages.set(feature.featureId, reconciled.topologyStage);

  return {
    ...state,
    assets: mergeGeometryAssetRecords(state.assets, result.assetRecords),
    bodies: reconciled.bodies,
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
    featureTopologyStages,
  };
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

  return applyFeatureResult(
    state,
    feature,
    executeOccFeature(
      { ...state, previousTopologyStage },
      feature.featureId,
      resolvedDefinition.definition,
    ),
  );
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
    sketches: state.sketches,
    variables: state.variables,
    bodies: state.baseBodies,
    bodyLabels: state.bodyLabels,
    constructions: state.baseConstructions,
    constructionPlanes: state.baseConstructionPlanes,
    features: [],
    assets: state.assets,
    cursor: { kind: "empty" },
    assetResolver: state.assetResolver,
    previousReferenceState: state.referenceState,
    previousFeatureTopologyStages: state.featureTopologyStages,
    previousFeatureTopologyLineage: state.previousFeatureTopologyLineage,
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
