import type {
  BodyId,
  EdgeId,
  FaceId,
  FeatureId,
  VertexId,
} from "@/contracts/shared/ids";
import type { DurableRef } from "@/contracts/shared/references";
import type { AuthoredTopologyLineageOutput } from "@/contracts/modeling/authored-document";
import type { OpenCascadeInstance } from "@/domain/modeling/occ/runtime";
import {
  OccCleanupError,
  collectOccCleanupErrors,
  combineOccCleanupError,
  releaseOccObjects,
  type OccDisposable,
} from "@/domain/modeling/occ/memory";
import type { OccTopologyStageOutput } from "@/domain/modeling/occ/topology-stage";
import type {
  OccReferenceInvalidationRecord,
  OccTrackedBody,
} from "@/domain/modeling/occ/topology";

type OccShape = InstanceType<OpenCascadeInstance["TopoDS_Shape"]>;
type OccFace = InstanceType<OpenCascadeInstance["TopoDS_Face"]>;
type OccEdge = InstanceType<OpenCascadeInstance["TopoDS_Edge"]>;
type OccVertex = InstanceType<OpenCascadeInstance["TopoDS_Vertex"]>;
type OccLabel = InstanceType<OpenCascadeInstance["TDF_Label"]>;
type OccDocument = InstanceType<OpenCascadeInstance["TDocStd_Document"]>;
type OccLabelMap = InstanceType<OpenCascadeInstance["TDF_LabelMap"]>;
type OccNamedShape = InstanceType<
  OpenCascadeInstance["Handle_TNaming_NamedShape"]
>;

export interface OccTopologyHistorySource {
  Modified(shape: OccShape): { Size(): number };
  Generated(shape: OccShape): { Size(): number };
  IsDeleted?(shape: OccShape): boolean;
  IsRemoved?(shape: OccShape): boolean;
  /** Exact result membership for this history hop, when the producer exposes it. */
  resultShape?: OccShape;
}

export const OCC_TOPOLOGY_NAMING_STRATEGY =
  "selector-backed-ocaf-labels" as const;

export interface OccTopologyNamingBodyState {
  strategy: typeof OCC_TOPOLOGY_NAMING_STRATEGY;
  document: OccDocument;
  bodyLabel: OccLabel;
  topologyLabelsByKey: Map<string, OccLabel>;
  selectorLabelsByKey: Map<string, OccLabel>;
}

interface EnumeratedReplacementTopology {
  topology: OccTrackedBody["topology"];
  contributingFeatureIds: FeatureId[];
  facesById: Map<FaceId, OccFace>;
  faceContributingFeatureIdsById: Map<FaceId, FeatureId[]>;
  edgesById: Map<EdgeId, OccEdge>;
  edgeContributingFeatureIdsById: Map<EdgeId, FeatureId[]>;
  verticesById: Map<VertexId, OccVertex>;
  vertexContributingFeatureIdsById: Map<VertexId, FeatureId[]>;
}

interface TrackedTopologyInput {
  bodyId: BodyId;
  ownerFeatureId: FeatureId | null;
  topology: OccTrackedBody["topology"];
  shape: OccShape;
  facesById: Map<FaceId, OccFace>;
  faceContributingFeatureIdsById: Map<FaceId, FeatureId[]>;
  edgesById: Map<EdgeId, OccEdge>;
  edgeContributingFeatureIdsById: Map<EdgeId, FeatureId[]>;
  verticesById: Map<VertexId, OccVertex>;
  vertexContributingFeatureIdsById: Map<VertexId, FeatureId[]>;
}

export interface OccTopologyReconciliationResult extends EnumeratedReplacementTopology {
  naming: OccTopologyNamingBodyState;
  invalidations: Map<string, OccReferenceInvalidationRecord>;
}

export type OccGeneratedTopologyContributorResult =
  EnumeratedReplacementTopology;

const TOPOLOGY_DELETED_REASON = "occ-topology-deleted";
const TOPOLOGY_AMBIGUOUS_REASON = "occ-topology-ambiguous";
const TOPOLOGY_MISSING_REASON = "occ-missing-reference";

type OccSubtopologyRef = Extract<
  DurableRef,
  { kind: "face" | "edge" | "vertex" }
>;

export interface OccSemanticStageReconciliation {
  preservedTargetsByCurrentKey: ReadonlyMap<string, OccSubtopologyRef>;
  invalidations: ReadonlyMap<string, OccReferenceInvalidationRecord>;
}

interface OccTopologyStageLineageView {
  outputSlot: OccTopologyStageOutput["outputSlot"];
  body: Pick<OccTrackedBody, "bodyId" | "topology">;
  sourceTargets: OccTopologyStageOutput["sourceTargets"];
  unsupportedSourceKeys: OccTopologyStageOutput["unsupportedSourceKeys"];
}

function createPersistedStageLineageView(
  output: AuthoredTopologyLineageOutput,
): OccTopologyStageLineageView {
  return {
    outputSlot: output.outputSlot,
    body: { bodyId: output.outputSlot, topology: output.topology },
    sourceTargets: new Map(
      output.sourceTargets.map((entry) => [entry.sourceKey, entry.targets]),
    ),
    unsupportedSourceKeys: new Set(output.unsupportedSourceKeys),
  };
}

function isStageSubtopologyTarget(
  target: DurableRef,
  bodyId: BodyId,
): target is OccSubtopologyRef {
  return (
    (target.kind === "face" ||
      target.kind === "edge" ||
      target.kind === "vertex") &&
    target.bodyId === bodyId
  );
}

function getBodySubtopologyTargets(
  body: Pick<OccTrackedBody, "bodyId" | "topology">,
) {
  return [
    ...body.topology.faceIds.map(
      (faceId): OccSubtopologyRef => ({
        kind: "face",
        bodyId: body.bodyId,
        faceId,
      }),
    ),
    ...body.topology.edgeIds.map(
      (edgeId): OccSubtopologyRef => ({
        kind: "edge",
        bodyId: body.bodyId,
        edgeId,
      }),
    ),
    ...body.topology.vertexIds.map(
      (vertexId): OccSubtopologyRef => ({
        kind: "vertex",
        bodyId: body.bodyId,
        vertexId,
      }),
    ),
  ];
}

export function createUnsupportedStageTopologyInvalidations(
  output: {
    outputSlot: OccTopologyStageOutput["outputSlot"];
    body: Pick<OccTrackedBody, "bodyId" | "topology">;
  },
) {
  return new Map(
    getBodySubtopologyTargets(output.body).map((target) => [
      topologyRefKey(target),
      {
        target,
        reason: "occ-topology-unsupported-history",
        sourceTarget: { kind: "body" as const, bodyId: output.outputSlot },
      },
    ]),
  );
}

/**
 * Classifies exact semantic source-key lineage between two executions of the
 * same feature/output slot. Geometry and topology traversal order are never
 * consulted: only a unique source-key successor can preserve an old public ID.
 */
export function classifySemanticStageTopology(input: {
  previous: OccTopologyStageLineageView;
  current: OccTopologyStageLineageView;
}): OccSemanticStageReconciliation {
  if (input.previous.outputSlot !== input.current.outputSlot) {
    throw new Error(
      `Cannot reconcile topology slots ${input.previous.outputSlot} and ${input.current.outputSlot}.`,
    );
  }

  const bodyId = input.previous.outputSlot;
  const sourceKeysByPreviousTarget = new Map<string, string[]>();
  const previousTargetsByKey = new Map<string, OccSubtopologyRef>();

  for (const target of getBodySubtopologyTargets(input.previous.body)) {
    const key = topologyRefKey(target);
    previousTargetsByKey.set(key, target);
    sourceKeysByPreviousTarget.set(key, []);
  }

  for (const [sourceKey, targets] of input.previous.sourceTargets) {
    for (const target of targets) {
      if (!isStageSubtopologyTarget(target, bodyId)) {
        continue;
      }

      const targetKey = topologyRefKey(target);
      const sourceKeys = sourceKeysByPreviousTarget.get(targetKey);
      if (sourceKeys && !sourceKeys.includes(sourceKey)) {
        sourceKeys.push(sourceKey);
      }
    }
  }

  const candidateByPreviousKey = new Map<string, OccSubtopologyRef>();
  const invalidations = new Map<string, OccReferenceInvalidationRecord>();

  const invalidate = (target: OccSubtopologyRef, reason: string) => {
    invalidations.set(topologyRefKey(target), {
      target,
      reason,
      sourceTarget: { kind: "body", bodyId },
    });
  };

  for (const [previousKey, previousTarget] of previousTargetsByKey) {
    const sourceKeys = sourceKeysByPreviousTarget.get(previousKey) ?? [];

    if (sourceKeys.length === 0) {
      invalidate(previousTarget, "occ-topology-unsupported-history");
      continue;
    }

    if (
      sourceKeys.some((sourceKey) =>
        input.current.unsupportedSourceKeys.has(sourceKey),
      )
    ) {
      invalidate(previousTarget, "occ-topology-unsupported-history");
      continue;
    }

    const successorsByKey = new Map<string, OccSubtopologyRef>();
    for (const sourceKey of sourceKeys) {
      for (const target of input.current.sourceTargets.get(sourceKey) ?? []) {
        if (
          isStageSubtopologyTarget(target, bodyId) &&
          target.kind === previousTarget.kind
        ) {
          successorsByKey.set(topologyRefKey(target), target);
        }
      }
    }

    if (successorsByKey.size === 0) {
      invalidate(previousTarget, TOPOLOGY_DELETED_REASON);
      continue;
    }

    if (successorsByKey.size > 1) {
      invalidate(previousTarget, TOPOLOGY_AMBIGUOUS_REASON);
      continue;
    }

    candidateByPreviousKey.set(
      previousKey,
      successorsByKey.values().next().value!,
    );
  }

  const previousClaimsByCurrentKey = new Map<string, string[]>();
  for (const [previousKey, currentTarget] of candidateByPreviousKey) {
    const currentKey = topologyRefKey(currentTarget);
    previousClaimsByCurrentKey.set(currentKey, [
      ...(previousClaimsByCurrentKey.get(currentKey) ?? []),
      previousKey,
    ]);
  }

  const preservedTargetsByCurrentKey = new Map<string, OccSubtopologyRef>();
  for (const [currentKey, previousKeys] of previousClaimsByCurrentKey) {
    if (previousKeys.length === 1) {
      preservedTargetsByCurrentKey.set(
        currentKey,
        previousTargetsByKey.get(previousKeys[0]!)!,
      );
      continue;
    }

    for (const previousKey of previousKeys) {
      invalidate(
        previousTargetsByKey.get(previousKey)!,
        TOPOLOGY_AMBIGUOUS_REASON,
      );
    }
  }

  return { preservedTargetsByCurrentKey, invalidations };
}

export function classifyPersistedStageTopology(input: {
  previous: AuthoredTopologyLineageOutput;
  current: OccTopologyStageOutput;
}): OccSemanticStageReconciliation {
  return classifySemanticStageTopology({
    previous: createPersistedStageLineageView(input.previous),
    current: input.current,
  });
}

export function createUnsupportedPersistedTopologyInvalidations(
  output: AuthoredTopologyLineageOutput,
) {
  return createUnsupportedStageTopologyInvalidations(
    createPersistedStageLineageView(output),
  );
}

function ignoreOccNamingResolutionError() {
  // TNaming selector solving can fail for deleted or unresolved names. History
  // reconciliation remains the authoritative fallback for those cases.
}

function faceShapeType(oc: OpenCascadeInstance) {
  return oc.TopAbs_ShapeEnum.TopAbs_FACE as unknown as number;
}

function edgeShapeType(oc: OpenCascadeInstance) {
  return oc.TopAbs_ShapeEnum.TopAbs_EDGE as unknown as number;
}

function vertexShapeType(oc: OpenCascadeInstance) {
  return oc.TopAbs_ShapeEnum.TopAbs_VERTEX as unknown as number;
}

function topologyRefKey(target: DurableRef) {
  switch (target.kind) {
    case "body":
      return `body:${target.bodyId}`;
    case "face":
      return `face:${target.bodyId}:${target.faceId}`;
    case "edge":
      return `edge:${target.bodyId}:${target.edgeId}`;
    case "vertex":
      return `vertex:${target.bodyId}:${target.vertexId}`;
    default:
      throw new Error(`Unsupported OCC topology naming target ${target.kind}.`);
  }
}

/**
 * Runs `operation`, then releases `owned()` whether or not it failed. An
 * operation error stays primary and is combined with any cleanup error.
 */
function releaseAfter<T>(
  operation: () => T,
  owned: () => Iterable<OccDisposable>,
): T {
  let result: T;
  try {
    result = operation();
  } catch (error) {
    try {
      releaseOccObjects(owned());
    } catch (cleanupError) {
      throw combineOccCleanupError(error, cleanupError);
    }
    throw error;
  }
  releaseOccObjects(owned());
  return result;
}

/**
 * The document release waits behind pending attribute cleanups: a TNaming
 * attribute handle must be released while its document is alive. Only label
 * retries are safe after their document.
 */
function deferNamingDocumentRelease(
  document: OccDocument,
  attributeCleanups: readonly OccCleanupError[],
) {
  let releaseDocument: (() => void) | undefined;
  return new OccCleanupError(
    [
      new Error(
        "An OCC naming document is retained until its pending attribute cleanup succeeds.",
      ),
    ],
    () => {
      for (const cleanup of attributeCleanups) cleanup.retry();
      if (releaseDocument) return releaseDocument();
      releaseDocument = () => {};
      try {
        releaseOccObjects([document]);
      } catch (error) {
        // Share the failed release's own pending set so no path deletes twice.
        releaseDocument =
          error instanceof OccCleanupError ? error.retry : undefined;
        throw error;
      }
    },
  );
}

/**
 * Releases naming created locally (labels, then its document) after `failure`
 * and rethrows it, combined with any cleanup error. `attributeCleanups` are
 * pending attribute-handle releases that the document must wait for.
 */
function rethrowAfterReleasingLocalNaming(
  failure: unknown,
  labels: Iterable<OccLabel>,
  document: OccDocument,
  attributeCleanups: readonly OccCleanupError[],
): never {
  const errors: unknown[] = [];
  try {
    releaseOccObjects(
      attributeCleanups.length === 0 ? [...labels, document] : labels,
    );
  } catch (cleanupError) {
    errors.push(cleanupError);
  }
  if (attributeCleanups.length > 0) {
    errors.push(deferNamingDocumentRelease(document, attributeCleanups));
  }
  if (errors.length === 0) throw failure;
  throw combineOccCleanupError(
    failure,
    errors.length === 1 ? errors[0] : new AggregateError(errors),
  );
}

function createDocument(oc: OpenCascadeInstance) {
  // TDocStd_Document stores a copy of its storage format (a value member).
  const storageFormat = new oc.TCollection_ExtendedString_2(
    "CadaraOccNaming",
    true,
  );
  return releaseAfter(
    () => new oc.TDocStd_Document(storageFormat),
    () => [storageFormat],
  );
}

function createPrimitiveLabel(
  oc: OpenCascadeInstance,
  parent: OccLabel,
  shape: OccShape,
) {
  const label = parent.NewChild();
  const builder = new oc.TNaming_Builder(label);
  builder.Generated_1(shape);
  builder.delete();

  return label;
}

function hasShapeType(shape: OccShape, expected: OccShape) {
  const shapeType = shape.ShapeType() as unknown as { value?: number };
  const expectedType = expected.ShapeType() as unknown as { value?: number };
  if (
    typeof shapeType.value === "number" &&
    typeof expectedType.value === "number"
  ) {
    return shapeType.value === expectedType.value;
  }

  return shape.ShapeType() === expected.ShapeType();
}

/**
 * Returns the unique shapes of `namedShape`. Every JS-owned TopoDS copy read,
 * including dropped duplicates, is appended to `owned` for the caller to
 * release after its final use.
 */
function readNamedShape(
  oc: OpenCascadeInstance,
  namedShape: OccNamedShape,
  owned: OccDisposable[],
) {
  if (namedShape.IsNull()) {
    return [];
  }

  const shapes: OccShape[] = [];
  const read = (shape: OccShape) => {
    owned.push(shape);
    shapes.push(shape);
  };

  try {
    read(oc.TNaming_Tool.GetShape(namedShape));
  } catch {
    // Some unresolved selected names cannot be materialized by OCJS.
    ignoreOccNamingResolutionError();
  }

  try {
    read(oc.TNaming_Tool.CurrentShape_1(namedShape));
  } catch {
    // CurrentShape can throw for unresolved or deleted selector states.
    ignoreOccNamingResolutionError();
  }

  return uniqueShapes(shapes);
}

function selectIntoSelectorLabel(
  oc: OpenCascadeInstance,
  label: OccLabel,
  selection: OccShape,
  context: OccShape,
) {
  const selector = new oc.TNaming_Selector(label);
  // Attribute handles and read copies first, then the selector, all while the
  // document is alive; a failed delete never skips the remaining ones.
  const owned: OccDisposable[] = [];

  return releaseAfter(
    () => {
      try {
        const selectedWithContext = selector.Select_1(
          selection,
          context,
          false,
          true,
        );
        const namedShape = selector.NamedShape();
        owned.push(namedShape);
        const selectedShapes = readNamedShape(oc, namedShape, owned);

        if (
          selectedWithContext &&
          selectedShapes.some(
            (shape) =>
              shape.IsSame(selection) && hasShapeType(shape, selection),
          )
        ) {
          return label;
        }
      } catch {
        // Fall back to direct shape selection below; Select_1 is not reliable for every OCJS case.
        ignoreOccNamingResolutionError();
      }

      selector.Select_2(selection, false, true);
      return label;
    },
    () => [...owned, selector],
  );
}

function directlyReselectSelectorLabel(
  oc: OpenCascadeInstance,
  label: OccLabel,
  selection: OccShape,
) {
  const selector = new oc.TNaming_Selector(label);
  try {
    selector.Select_2(selection, false, true);
    return label;
  } finally {
    selector.delete();
  }
}

function createSelectorLabel(
  oc: OpenCascadeInstance,
  parent: OccLabel,
  selection: OccShape,
  context: OccShape,
) {
  const label = parent.NewChild();
  try {
    return selectIntoSelectorLabel(oc, label, selection, context);
  } catch (error) {
    // Not yet stored in any naming map; a label release is safe at any time.
    try {
      releaseOccObjects([label]);
    } catch (cleanupError) {
      throw combineOccCleanupError(error, cleanupError);
    }
    throw error;
  }
}

function modifyLabel(
  oc: OpenCascadeInstance,
  label: OccLabel,
  previous: OccShape,
  next: OccShape,
) {
  const builder = new oc.TNaming_Builder(label);
  builder.Modify(previous, next);
  builder.delete();
}

function deleteLabel(
  oc: OpenCascadeInstance,
  label: OccLabel,
  previous: OccShape,
) {
  const builder = new oc.TNaming_Builder(label);
  builder.Delete(previous);
  builder.delete();
}

function createBodyLabel(
  oc: OpenCascadeInstance,
  document: OccDocument,
  shape: OccShape,
) {
  const main = document.Main();
  const label = main.NewChild();
  main.delete();
  const builder = new oc.TNaming_Builder(label);
  builder.Generated_1(shape);
  builder.delete();

  return label;
}

function namingLabels(naming: {
  bodyLabel?: OccLabel;
  topologyLabelsByKey: ReadonlyMap<string, OccLabel>;
  selectorLabelsByKey: ReadonlyMap<string, OccLabel>;
}) {
  return [
    ...(naming.bodyLabel ? [naming.bodyLabel] : []),
    ...naming.topologyLabelsByKey.values(),
    ...naming.selectorLabelsByKey.values(),
  ];
}

function createInitialNamingState(
  oc: OpenCascadeInstance,
  body: TrackedTopologyInput,
): OccTopologyNamingBodyState {
  const document = createDocument(oc);
  const topologyLabelsByKey = new Map<string, OccLabel>();
  const selectorLabelsByKey = new Map<string, OccLabel>();
  let bodyLabel: OccLabel | undefined;
  try {
    bodyLabel = createBodyLabel(oc, document, body.shape);
    populateInitialNamingLabels(
      oc,
      body,
      bodyLabel,
      topologyLabelsByKey,
      selectorLabelsByKey,
    );
  } catch (error) {
    rethrowAfterReleasingLocalNaming(
      error,
      namingLabels({ bodyLabel, topologyLabelsByKey, selectorLabelsByKey }),
      document,
      collectOccCleanupErrors(error),
    );
  }

  return {
    strategy: OCC_TOPOLOGY_NAMING_STRATEGY,
    document,
    bodyLabel,
    topologyLabelsByKey,
    selectorLabelsByKey,
  };
}

function populateInitialNamingLabels(
  oc: OpenCascadeInstance,
  body: TrackedTopologyInput,
  bodyLabel: OccLabel,
  topologyLabelsByKey: Map<string, OccLabel>,
  selectorLabelsByKey: Map<string, OccLabel>,
) {
  for (const [faceId, face] of body.facesById) {
    const key = topologyRefKey({ kind: "face", bodyId: body.bodyId, faceId });
    topologyLabelsByKey.set(key, createPrimitiveLabel(oc, bodyLabel, face));
    selectorLabelsByKey.set(
      key,
      createSelectorLabel(oc, bodyLabel, face, body.shape),
    );
  }

  for (const [edgeId, edge] of body.edgesById) {
    const key = topologyRefKey({ kind: "edge", bodyId: body.bodyId, edgeId });
    topologyLabelsByKey.set(key, createPrimitiveLabel(oc, bodyLabel, edge));
    selectorLabelsByKey.set(
      key,
      createSelectorLabel(oc, bodyLabel, edge, body.shape),
    );
  }

  for (const [vertexId, vertex] of body.verticesById) {
    const key = topologyRefKey({
      kind: "vertex",
      bodyId: body.bodyId,
      vertexId,
    });
    topologyLabelsByKey.set(key, createPrimitiveLabel(oc, bodyLabel, vertex));
    selectorLabelsByKey.set(
      key,
      createSelectorLabel(oc, bodyLabel, vertex, body.shape),
    );
  }
}

export function seedOccTopologyNaming(
  oc: OpenCascadeInstance,
  body: TrackedTopologyInput,
) {
  return createInitialNamingState(oc, body);
}

function listShapes(oc: OpenCascadeInstance, list: { Size(): number }) {
  const shapes: OccShape[] = [];
  const copy = new oc.TopTools_ListOfShape_3(
    list as InstanceType<OpenCascadeInstance["TopTools_ListOfShape"]>,
  );

  while (copy.Size() > 0) {
    shapes.push(copy.First_1());
    copy.RemoveFirst();
  }

  copy.delete();
  return shapes;
}

function hasSameShape(shapes: readonly OccShape[], candidate: OccShape) {
  return shapes.some((shape) => shape.IsSame(candidate));
}

function uniqueShapes(shapes: readonly OccShape[]) {
  const unique: OccShape[] = [];

  for (const shape of shapes) {
    if (!hasSameShape(unique, shape)) {
      unique.push(shape);
    }
  }

  return unique;
}

function createValidLabelMap(
  oc: OpenCascadeInstance,
  naming: OccTopologyNamingBodyState,
) {
  const labels = new oc.TDF_LabelMap_1();
  const main = naming.document.Main();
  labels.Add(main);
  main.delete();
  labels.Add(naming.bodyLabel);

  for (const label of naming.topologyLabelsByKey.values()) {
    labels.Add(label);
  }

  for (const label of naming.selectorLabelsByKey.values()) {
    labels.Add(label);
  }

  return labels;
}

function mapFinalIndexes(
  finalShapeMap: InstanceType<
    OpenCascadeInstance["TopTools_IndexedMapOfShape"]
  >,
  candidates: readonly OccShape[],
) {
  const indexes: number[] = [];

  for (const candidate of candidates) {
    const index = finalShapeMap.FindIndex(candidate);

    if (index > 0 && !indexes.includes(index)) {
      indexes.push(index);
    }
  }

  return indexes;
}

/** Like readNamedShape: every copy and attribute handle read is appended to `owned`. */
function readCurrentNamedShape(
  oc: OpenCascadeInstance,
  namedShape: OccNamedShape,
  validLabels: OccLabelMap,
  owned: OccDisposable[],
) {
  if (namedShape.IsNull()) {
    return [];
  }

  const shapes = readNamedShape(oc, namedShape, owned);

  try {
    const current = oc.TNaming_Tool.CurrentShape_2(namedShape, validLabels);
    owned.push(current);
    shapes.push(current);
  } catch {
    // OCJS throws when the selected name cannot be solved in the current label set.
    ignoreOccNamingResolutionError();
  }

  try {
    const currentNamedShape = oc.TNaming_Tool.CurrentNamedShape_1(
      namedShape,
      validLabels,
    );
    owned.push(currentNamedShape);
    shapes.push(...readNamedShape(oc, currentNamedShape, owned));
  } catch {
    // CurrentNamedShape has the same unresolved-name failure mode as CurrentShape.
    ignoreOccNamingResolutionError();
  }

  return uniqueShapes(shapes);
}

function resolveSelectorFinalSuccessors(
  oc: OpenCascadeInstance,
  selectorLabel: OccLabel | undefined,
  validLabels: OccLabelMap,
  finalShapeMap: InstanceType<
    OpenCascadeInstance["TopTools_IndexedMapOfShape"]
  >,
) {
  if (!selectorLabel) {
    return [];
  }

  const selector = new oc.TNaming_Selector(selectorLabel);
  // Attribute handles and read copies first, then the selector, all while the
  // document is alive; a failed delete never skips the remaining ones.
  const owned: OccDisposable[] = [];

  return releaseAfter(
    () => {
      try {
        selector.Solve(validLabels);
      } catch {
        // Unsolved selectors still expose their last named shape; history is the fallback.
        ignoreOccNamingResolutionError();
      }

      const namedShape = selector.NamedShape();
      owned.push(namedShape);
      return mapFinalIndexes(
        finalShapeMap,
        readCurrentNamedShape(oc, namedShape, validLabels, owned),
      );
    },
    () => [...owned, selector],
  );
}

export function isOccTopologyHistoryDeleted(
  historySource: OccTopologyHistorySource,
  shape: OccShape,
) {
  return (
    historySource.IsDeleted?.(shape) === true ||
    historySource.IsRemoved?.(shape) === true
  );
}

function isExactSubshapeOfResult(
  oc: OpenCascadeInstance,
  result: OccShape,
  candidate: OccShape,
) {
  const subshapes = new oc.TopTools_IndexedMapOfShape_1();
  try {
    oc.TopExp.MapShapes_1(result, candidate.ShapeType() as never, subshapes);
    for (let index = 1; index <= subshapes.Size(); index += 1) {
      if (subshapes.FindKey(index).IsSame(candidate)) {
        return true;
      }
    }
    return false;
  } finally {
    subshapes.delete();
  }
}


function resolveFinalSuccessors(
  oc: OpenCascadeInstance,
  previousShape: OccShape,
  finalShapeMap: InstanceType<
    OpenCascadeInstance["TopTools_IndexedMapOfShape"]
  >,
  historySources: readonly OccTopologyHistorySource[],
  includeGenerated = false,
) {
  let candidates = [previousShape];
  let deleted = false;
  let ambiguous = false;

  for (const historySource of historySources) {
    const nextCandidates: OccShape[] = [];

    for (const candidate of candidates) {
      if (includeGenerated) {
        nextCandidates.push(...listShapes(oc, historySource.Generated(candidate)));
      }
      if (isOccTopologyHistoryDeleted(historySource, candidate)) {
        deleted = true;
        continue;
      }

      const modified = uniqueShapes(
        listShapes(oc, historySource.Modified(candidate)),
      );
      if (includeGenerated && modified.length > 0) {
        nextCandidates.push(...modified);
        continue;
      }
      if (modified.length > 1) {
        ambiguous = true;
        continue;
      }
      if (modified.length === 1) {
        nextCandidates.push(modified[0]!);
        continue;
      }

      // A history source that omits Modified proves retention only when its
      // own result still contains the exact native subshape. This is a
      // TopoDS_Shape.IsSame check, never a geometric match.
      if (
        historySource.resultShape &&
        !isExactSubshapeOfResult(oc, historySource.resultShape, candidate)
      ) {
        continue;
      }
      nextCandidates.push(candidate);
    }

    if (ambiguous) {
      return { finalIndexes: [], deleted, ambiguous };
    }
    candidates = uniqueShapes(nextCandidates);
  }

  const finalIndexes = mapFinalIndexes(finalShapeMap, candidates);

  return { finalIndexes, deleted, ambiguous };
}

function buildShapeMap(
  oc: OpenCascadeInstance,
  kind: "face" | "edge" | "vertex",
  shape: OccShape,
) {
  const map = new oc.TopTools_IndexedMapOfShape_1();
  const shapeType =
    kind === "face"
      ? faceShapeType(oc)
      : kind === "edge"
        ? edgeShapeType(oc)
        : vertexShapeType(oc);
  oc.TopExp.MapShapes_1(shape, shapeType as never, map);
  return map;
}

function targetFor(kind: "face", bodyId: BodyId, id: FaceId): DurableRef;
function targetFor(kind: "edge", bodyId: BodyId, id: EdgeId): DurableRef;
function targetFor(kind: "vertex", bodyId: BodyId, id: VertexId): DurableRef;
function targetFor(
  kind: "face" | "edge" | "vertex",
  bodyId: BodyId,
  id: FaceId | EdgeId | VertexId,
): DurableRef {
  switch (kind) {
    case "face":
      return { kind, bodyId, faceId: id as FaceId };
    case "edge":
      return { kind, bodyId, edgeId: id as EdgeId };
    case "vertex":
      return { kind, bodyId, vertexId: id as VertexId };
  }
}

function registerInvalidation(
  invalidations: Map<string, OccReferenceInvalidationRecord>,
  target: DurableRef,
  reason: string,
  bodyId: BodyId,
) {
  invalidations.set(topologyRefKey(target), {
    target,
    reason,
    sourceTarget: { kind: "body", bodyId },
  });
}

function mergeContributorIds(...lists: readonly (readonly FeatureId[])[]) {
  const merged: FeatureId[] = [];

  for (const list of lists) {
    for (const featureId of list) {
      if (!merged.includes(featureId)) {
        merged.push(featureId);
      }
    }
  }

  return merged;
}

function appendContributorId(
  contributors: readonly FeatureId[],
  ownerFeatureId: FeatureId | null,
) {
  if (!ownerFeatureId || contributors.includes(ownerFeatureId)) {
    return [...contributors];
  }

  return [...contributors, ownerFeatureId];
}

function deriveBodyContributorIds(input: {
  ownerFeatureId: FeatureId | null;
  faces: ReadonlyMap<FaceId, readonly FeatureId[]>;
  edges: ReadonlyMap<EdgeId, readonly FeatureId[]>;
  vertices: ReadonlyMap<VertexId, readonly FeatureId[]>;
}) {
  const merged = mergeContributorIds(
    ...[
      ...input.faces.values(),
      ...input.edges.values(),
      ...input.vertices.values(),
    ],
  );

  if (input.ownerFeatureId && !merged.includes(input.ownerFeatureId)) {
    merged.push(input.ownerFeatureId);
  }

  return merged;
}

function reconcileKind<
  Id extends FaceId | EdgeId | VertexId,
  Shape extends OccFace | OccEdge | OccVertex,
>(
  oc: OpenCascadeInstance,
  input: {
    kind: "face" | "edge" | "vertex";
    bodyId: BodyId;
    previousIds: readonly Id[];
    previousShapesById: ReadonlyMap<Id, Shape>;
    freshIds: readonly Id[];
    freshShapesById: ReadonlyMap<Id, Shape>;
    finalShapeMap: InstanceType<
      OpenCascadeInstance["TopTools_IndexedMapOfShape"]
    >;
    historySources: readonly OccTopologyHistorySource[];
    previousContributingFeatureIdsById: ReadonlyMap<Id, readonly FeatureId[]>;
    ownerFeatureId: FeatureId | null;
    previousLabelsByKey: ReadonlyMap<string, OccLabel>;
    previousSelectorLabelsByKey: ReadonlyMap<string, OccLabel>;
    nextLabelsByKey: Map<string, OccLabel>;
    nextSelectorLabelsByKey: Map<string, OccLabel>;
    bodyLabel: OccLabel;
    contextShape: OccShape;
    validLabels: OccLabelMap;
    invalidations: Map<string, OccReferenceInvalidationRecord>;
  },
) {
  const claimsByIndex = new Map<number, Id[]>();
  const resultById = new Map<Id, Shape>();
  const contributingFeatureIdsById = new Map<Id, FeatureId[]>();
  const preservedIndexById = new Map<Id, number>();
  const inheritedContributorIdsByIndex = new Map<number, FeatureId[]>();
  const shapeByIndex = new Map<number, Shape>();

  for (const shape of input.freshShapesById.values()) {
    const index = input.finalShapeMap.FindIndex(shape);

    if (index > 0) {
      shapeByIndex.set(index, shape);
    }
  }

  for (const previousId of input.previousIds) {
    const previousShape = input.previousShapesById.get(previousId);
    const previousContributorIds =
      input.previousContributingFeatureIdsById.get(previousId) ?? [];

    if (!previousShape) {
      continue;
    }

    const target = targetFor(
      input.kind as never,
      input.bodyId,
      previousId as never,
    );
    const key = topologyRefKey(target);
    const inheritedResolution = resolveFinalSuccessors(
      oc,
      previousShape,
      input.finalShapeMap,
      input.historySources,
    );
    const selectorFinalIndexes =
      inheritedResolution.finalIndexes.length === 1 || inheritedResolution.ambiguous
        ? []
        : resolveSelectorFinalSuccessors(
            oc,
            input.previousSelectorLabelsByKey.get(key),
            input.validLabels,
            input.finalShapeMap,
          );
    const resolution =
      inheritedResolution.finalIndexes.length === 1
        ? inheritedResolution
        : selectorFinalIndexes.length > 0
          ? { finalIndexes: selectorFinalIndexes, deleted: false, ambiguous: false }
          : inheritedResolution;

    if (resolution.finalIndexes.length === 1) {
      const [index] = resolution.finalIndexes;
      claimsByIndex.set(index!, [
        ...(claimsByIndex.get(index!) ?? []),
        previousId,
      ]);
      preservedIndexById.set(previousId, index!);
    }


    for (const index of inheritedResolution.finalIndexes) {
      if (preservedIndexById.get(previousId) === index) {
        continue;
      }

      inheritedContributorIdsByIndex.set(
        index,
        mergeContributorIds(inheritedContributorIdsByIndex.get(index) ?? [], [
          ...previousContributorIds,
        ]),
      );
    }

    if (resolution.finalIndexes.length === 1) {
      continue;
    }

    const label = input.previousLabelsByKey.get(key);

    if (label) {
      deleteLabel(oc, label, previousShape);
    }

    registerInvalidation(
      input.invalidations,
      target,
      resolution.ambiguous || resolution.finalIndexes.length > 1
        ? TOPOLOGY_AMBIGUOUS_REASON
        : resolution.deleted
          ? TOPOLOGY_DELETED_REASON
          : TOPOLOGY_MISSING_REASON,
      input.bodyId,
    );
  }

  const claimedIndexes = new Set<number>();

  for (const [index, ids] of claimsByIndex) {
    if (ids.length !== 1) {
      for (const id of ids) {
        registerInvalidation(
          input.invalidations,
          targetFor(input.kind as never, input.bodyId, id as never),
          TOPOLOGY_AMBIGUOUS_REASON,
          input.bodyId,
        );
      }
      continue;
    }

    const id = ids[0]!;
    const shape = shapeByIndex.get(index);
    const previousShape = input.previousShapesById.get(id);

    if (!shape || !previousShape) {
      continue;
    }

    const key = topologyRefKey(
      targetFor(input.kind as never, input.bodyId, id as never),
    );
    const label = input.previousLabelsByKey.get(key);

    if (label) {
      modifyLabel(oc, label, previousShape, shape);
      input.nextLabelsByKey.set(key, label);
      const selectorLabel = input.previousSelectorLabelsByKey.get(key);
      input.nextSelectorLabelsByKey.set(
        key,
        selectorLabel
          ? directlyReselectSelectorLabel(oc, selectorLabel, shape)
          : createSelectorLabel(oc, input.bodyLabel, shape, input.contextShape),
      );
    }

    resultById.set(id, shape);
    contributingFeatureIdsById.set(id, [
      ...(input.previousContributingFeatureIdsById.get(id) ?? []),
    ]);
    claimedIndexes.add(index);
  }

  for (const [freshId, freshShape] of input.freshShapesById) {
    const index = input.finalShapeMap.FindIndex(freshShape);

    if (index > 0 && claimedIndexes.has(index)) {
      continue;
    }

    const key = topologyRefKey(
      targetFor(input.kind as never, input.bodyId, freshId as never),
    );
    input.nextLabelsByKey.set(
      key,
      createPrimitiveLabel(oc, input.bodyLabel, freshShape),
    );
    input.nextSelectorLabelsByKey.set(
      key,
      createSelectorLabel(oc, input.bodyLabel, freshShape, input.contextShape),
    );
    resultById.set(freshId, freshShape);
    contributingFeatureIdsById.set(
      freshId,
      appendContributorId(
        inheritedContributorIdsByIndex.get(index) ?? [],
        input.ownerFeatureId,
      ),
    );
  }

  return {
    resultById,
    contributingFeatureIdsById,
  };
}

function createTopologyFromMaps(
  facesById: Map<FaceId, OccFace>,
  edgesById: Map<EdgeId, OccEdge>,
  verticesById: Map<VertexId, OccVertex>,
) {
  return {
    faceIds: [...facesById.keys()],
    edgeIds: [...edgesById.keys()],
    vertexIds: [...verticesById.keys()],
  };
}

function deriveGeneratedKindContributorIds<
  Id extends FaceId | EdgeId | VertexId,
  Shape extends OccFace | OccEdge | OccVertex,
>(
  oc: OpenCascadeInstance,
  input: {
    kind: "face" | "edge" | "vertex";
    bodyId: BodyId;
    previousIds: readonly Id[];
    previousShapesById: ReadonlyMap<Id, Shape>;
    previousContributingFeatureIdsById: ReadonlyMap<Id, readonly FeatureId[]>;
    previousSelectorLabelsByKey: ReadonlyMap<string, OccLabel>;
    freshShapesById: ReadonlyMap<Id, Shape>;
    finalShapeMap: InstanceType<
      OpenCascadeInstance["TopTools_IndexedMapOfShape"]
    >;
    historySources: readonly OccTopologyHistorySource[];
    ownerFeatureId: FeatureId | null;
    validLabels: OccLabelMap;
  },
) {
  const claimsByIndex = new Map<number, Id[]>();
  const preservedContributorIdsByIndex = new Map<number, FeatureId[]>();
  const inheritedContributorIdsByIndex = new Map<number, FeatureId[]>();
  const contributingFeatureIdsById = new Map<Id, FeatureId[]>();

  for (const previousId of input.previousIds) {
    const previousShape = input.previousShapesById.get(previousId);
    const previousContributorIds =
      input.previousContributingFeatureIdsById.get(previousId) ?? [];

    if (!previousShape) {
      continue;
    }

    const key = topologyRefKey(
      targetFor(input.kind as never, input.bodyId, previousId as never),
    );
    const inheritedResolution = resolveFinalSuccessors(
      oc,
      previousShape,
      input.finalShapeMap,
      input.historySources,
    );
    const selectorFinalIndexes =
      inheritedResolution.finalIndexes.length === 1 || inheritedResolution.ambiguous
        ? []
        : resolveSelectorFinalSuccessors(
            oc,
            input.previousSelectorLabelsByKey.get(key),
            input.validLabels,
            input.finalShapeMap,
          );
    const preservedResolution =
      inheritedResolution.finalIndexes.length === 1
        ? inheritedResolution
        : selectorFinalIndexes.length > 0
          ? { finalIndexes: selectorFinalIndexes, deleted: false, ambiguous: false }
          : inheritedResolution;

    if (preservedResolution.finalIndexes.length === 1) {
      const [index] = preservedResolution.finalIndexes;
      claimsByIndex.set(index!, [
        ...(claimsByIndex.get(index!) ?? []),
        previousId,
      ]);
    }

    // Contributor ancestry includes generated descendants; durable identity
    // above still requires a unique Modified or retained exact successor.
    const contributorResolution = resolveFinalSuccessors(
      oc,
      previousShape,
      input.finalShapeMap,
      input.historySources,
      true,
    );
    for (const index of contributorResolution.finalIndexes) {
      inheritedContributorIdsByIndex.set(
        index,
        mergeContributorIds(inheritedContributorIdsByIndex.get(index) ?? [], [
          ...previousContributorIds,
        ]),
      );
    }

  }

  for (const [index, ids] of claimsByIndex) {
    if (ids.length !== 1) {
      continue;
    }

    preservedContributorIdsByIndex.set(index, [
      ...(input.previousContributingFeatureIdsById.get(ids[0]!) ?? []),
    ]);
  }

  for (const [freshId, freshShape] of input.freshShapesById) {
    const index = input.finalShapeMap.FindIndex(freshShape);
    const preservedContributorIds =
      index > 0 ? preservedContributorIdsByIndex.get(index) : undefined;
    contributingFeatureIdsById.set(
      freshId,
      preservedContributorIds
        ? [...preservedContributorIds]
        : appendContributorId(
            index > 0 ? (inheritedContributorIdsByIndex.get(index) ?? []) : [],
            input.ownerFeatureId,
          ),
    );
  }

  return contributingFeatureIdsById;
}

export function deriveGeneratedTopologyContributors(
  oc: OpenCascadeInstance,
  input: {
    previous: OccTrackedBody;
    generated: TrackedTopologyInput;
    historySources: readonly OccTopologyHistorySource[];
  },
): OccGeneratedTopologyContributorResult {
  if (input.previous.naming) {
    return deriveGeneratedTopologyContributorsWithNaming(
      oc,
      input,
      input.previous.naming,
    );
  }

  // The seeded source naming is local to this derivation; no body owns it.
  const temporaryNaming = createInitialNamingState(oc, input.previous);
  let result: OccGeneratedTopologyContributorResult;
  try {
    result = deriveGeneratedTopologyContributorsWithNaming(
      oc,
      input,
      temporaryNaming,
    );
  } catch (error) {
    rethrowAfterReleasingLocalNaming(
      error,
      namingLabels(temporaryNaming),
      temporaryNaming.document,
      collectOccCleanupErrors(error),
    );
  }
  releaseOccObjects([
    ...namingLabels(temporaryNaming),
    temporaryNaming.document,
  ]);
  return result;
}

function deriveGeneratedTopologyContributorsWithNaming(
  oc: OpenCascadeInstance,
  input: {
    previous: OccTrackedBody;
    generated: TrackedTopologyInput;
    historySources: readonly OccTopologyHistorySource[];
  },
  previousNaming: OccTopologyNamingBodyState,
): OccGeneratedTopologyContributorResult {
  const temporaries: OccDisposable[] = [];
  return releaseAfter(
    () => deriveWithTemporaries(oc, input, previousNaming, temporaries),
    () => temporaries,
  );
}

function deriveWithTemporaries(
  oc: OpenCascadeInstance,
  input: {
    previous: OccTrackedBody;
    generated: TrackedTopologyInput;
    historySources: readonly OccTopologyHistorySource[];
  },
  previousNaming: OccTopologyNamingBodyState,
  temporaries: OccDisposable[],
): OccGeneratedTopologyContributorResult {
  const validLabels = createValidLabelMap(oc, previousNaming);
  temporaries.push(validLabels);
  const faceShapeMap = buildShapeMap(oc, "face", input.generated.shape);
  temporaries.push(faceShapeMap);
  const edgeShapeMap = buildShapeMap(oc, "edge", input.generated.shape);
  temporaries.push(edgeShapeMap);
  const vertexShapeMap = buildShapeMap(oc, "vertex", input.generated.shape);
  temporaries.push(vertexShapeMap);

  const faceContributingFeatureIdsById = deriveGeneratedKindContributorIds(oc, {
    kind: "face",
    bodyId: input.previous.bodyId,
    previousIds: input.previous.topology.faceIds,
    previousShapesById: input.previous.facesById,
    previousContributingFeatureIdsById:
      input.previous.faceContributingFeatureIdsById,
    previousSelectorLabelsByKey: previousNaming.selectorLabelsByKey,
    freshShapesById: input.generated.facesById,
    finalShapeMap: faceShapeMap,
    historySources: input.historySources,
    ownerFeatureId: input.generated.ownerFeatureId,
    validLabels,
  });
  const edgeContributingFeatureIdsById = deriveGeneratedKindContributorIds(oc, {
    kind: "edge",
    bodyId: input.previous.bodyId,
    previousIds: input.previous.topology.edgeIds,
    previousShapesById: input.previous.edgesById,
    previousContributingFeatureIdsById:
      input.previous.edgeContributingFeatureIdsById,
    previousSelectorLabelsByKey: previousNaming.selectorLabelsByKey,
    freshShapesById: input.generated.edgesById,
    finalShapeMap: edgeShapeMap,
    historySources: input.historySources,
    ownerFeatureId: input.generated.ownerFeatureId,
    validLabels,
  });
  const vertexContributingFeatureIdsById = deriveGeneratedKindContributorIds(
    oc,
    {
      kind: "vertex",
      bodyId: input.previous.bodyId,
      previousIds: input.previous.topology.vertexIds,
      previousShapesById: input.previous.verticesById,
      previousContributingFeatureIdsById:
        input.previous.vertexContributingFeatureIdsById,
      previousSelectorLabelsByKey: previousNaming.selectorLabelsByKey,
      freshShapesById: input.generated.verticesById,
      finalShapeMap: vertexShapeMap,
      historySources: input.historySources,
      ownerFeatureId: input.generated.ownerFeatureId,
      validLabels,
    },
  );

  return {
    topology: createTopologyFromMaps(
      input.generated.facesById,
      input.generated.edgesById,
      input.generated.verticesById,
    ),
    contributingFeatureIds: deriveBodyContributorIds({
      ownerFeatureId: input.generated.ownerFeatureId,
      faces: faceContributingFeatureIdsById,
      edges: edgeContributingFeatureIdsById,
      vertices: vertexContributingFeatureIdsById,
    }),
    facesById: input.generated.facesById,
    faceContributingFeatureIdsById,
    edgesById: input.generated.edgesById,
    edgeContributingFeatureIdsById,
    verticesById: input.generated.verticesById,
    vertexContributingFeatureIdsById,
  };
}

export function reconcileReplacementTopology(
  oc: OpenCascadeInstance,
  input: {
    previous: OccTrackedBody;
    replacement: TrackedTopologyInput;
    historySources: readonly OccTopologyHistorySource[];
  },
): OccTopologyReconciliationResult {
  // Stored naming is borrowed from the input body, which keeps owning it (and
  // the labels this reconciliation leaves out). Seeded naming is local: its
  // document and body label transfer to the result, and every seeded label the
  // result does not carry is released here.
  const seeded = input.previous.naming
    ? undefined
    : createInitialNamingState(oc, input.previous);
  const previousNaming = input.previous.naming ?? seeded!;
  const borrowedLabels = new Set(seeded ? [] : namingLabels(previousNaming));
  const next = {
    topologyLabelsByKey: new Map<string, OccLabel>(),
    selectorLabelsByKey: new Map<string, OccLabel>(),
  };
  const temporaries: OccDisposable[] = [];
  const localLabels = () =>
    [...(seeded ? namingLabels(seeded) : []), ...namingLabels(next)].filter(
      (label) => !borrowedLabels.has(label),
    );

  let result: OccTopologyReconciliationResult;
  try {
    result = releaseAfter(
      () => reconcileWithNaming(oc, input, previousNaming, next, temporaries),
      () => temporaries,
    );
  } catch (error) {
    if (!seeded) {
      // The borrowed document stays with its owner; only new labels are local.
      try {
        releaseOccObjects(localLabels());
      } catch (cleanupError) {
        throw combineOccCleanupError(error, cleanupError);
      }
      throw error;
    }
    rethrowAfterReleasingLocalNaming(
      error,
      localLabels(),
      seeded.document,
      collectOccCleanupErrors(error),
    );
  }

  if (seeded) {
    const carried = new Set(namingLabels(next));
    const dropped = namingLabels(seeded).filter(
      (label) => label !== seeded.bodyLabel && !carried.has(label),
    );
    try {
      releaseOccObjects(dropped);
    } catch (error) {
      // Only labels are pending, and label retries are safe after the document.
      rethrowAfterReleasingLocalNaming(
        error,
        localLabels().filter((label) => !dropped.includes(label)),
        seeded.document,
        [],
      );
    }
  }
  return result;
}

function reconcileWithNaming(
  oc: OpenCascadeInstance,
  input: {
    previous: OccTrackedBody;
    replacement: TrackedTopologyInput;
    historySources: readonly OccTopologyHistorySource[];
  },
  previousNaming: OccTopologyNamingBodyState,
  next: {
    topologyLabelsByKey: Map<string, OccLabel>;
    selectorLabelsByKey: Map<string, OccLabel>;
  },
  temporaries: OccDisposable[],
): OccTopologyReconciliationResult {
  const invalidations = new Map<string, OccReferenceInvalidationRecord>();
  const bodyLabel = previousNaming.bodyLabel;
  modifyLabel(oc, bodyLabel, input.previous.shape, input.replacement.shape);

  const nextLabelsByKey = next.topologyLabelsByKey;
  const nextSelectorLabelsByKey = next.selectorLabelsByKey;
  const validLabels = createValidLabelMap(oc, previousNaming);
  temporaries.push(validLabels);
  const faceShapeMap = buildShapeMap(oc, "face", input.replacement.shape);
  temporaries.push(faceShapeMap);
  const edgeShapeMap = buildShapeMap(oc, "edge", input.replacement.shape);
  temporaries.push(edgeShapeMap);
  const vertexShapeMap = buildShapeMap(oc, "vertex", input.replacement.shape);
  temporaries.push(vertexShapeMap);

  const facesById = reconcileKind(oc, {
    kind: "face",
    bodyId: input.previous.bodyId,
    previousIds: input.previous.topology.faceIds,
    previousShapesById: input.previous.facesById,
    freshIds: input.replacement.topology.faceIds,
    freshShapesById: input.replacement.facesById,
    finalShapeMap: faceShapeMap,
    historySources: input.historySources,
    previousContributingFeatureIdsById:
      input.previous.faceContributingFeatureIdsById,
    ownerFeatureId: input.replacement.ownerFeatureId,
    previousLabelsByKey: previousNaming.topologyLabelsByKey,
    previousSelectorLabelsByKey: previousNaming.selectorLabelsByKey,
    nextLabelsByKey,
    nextSelectorLabelsByKey,
    bodyLabel,
    contextShape: input.replacement.shape,
    validLabels,
    invalidations,
  });
  const edgesById = reconcileKind(oc, {
    kind: "edge",
    bodyId: input.previous.bodyId,
    previousIds: input.previous.topology.edgeIds,
    previousShapesById: input.previous.edgesById,
    freshIds: input.replacement.topology.edgeIds,
    freshShapesById: input.replacement.edgesById,
    finalShapeMap: edgeShapeMap,
    historySources: input.historySources,
    previousContributingFeatureIdsById:
      input.previous.edgeContributingFeatureIdsById,
    ownerFeatureId: input.replacement.ownerFeatureId,
    previousLabelsByKey: previousNaming.topologyLabelsByKey,
    previousSelectorLabelsByKey: previousNaming.selectorLabelsByKey,
    nextLabelsByKey,
    nextSelectorLabelsByKey,
    bodyLabel,
    contextShape: input.replacement.shape,
    validLabels,
    invalidations,
  });
  const verticesById = reconcileKind(oc, {
    kind: "vertex",
    bodyId: input.previous.bodyId,
    previousIds: input.previous.topology.vertexIds,
    previousShapesById: input.previous.verticesById,
    freshIds: input.replacement.topology.vertexIds,
    freshShapesById: input.replacement.verticesById,
    finalShapeMap: vertexShapeMap,
    historySources: input.historySources,
    previousContributingFeatureIdsById:
      input.previous.vertexContributingFeatureIdsById,
    ownerFeatureId: input.replacement.ownerFeatureId,
    previousLabelsByKey: previousNaming.topologyLabelsByKey,
    previousSelectorLabelsByKey: previousNaming.selectorLabelsByKey,
    nextLabelsByKey,
    nextSelectorLabelsByKey,
    bodyLabel,
    contextShape: input.replacement.shape,
    validLabels,
    invalidations,
  });

  return {
    topology: createTopologyFromMaps(
      facesById.resultById,
      edgesById.resultById,
      verticesById.resultById,
    ),
    contributingFeatureIds: deriveBodyContributorIds({
      ownerFeatureId: input.replacement.ownerFeatureId,
      faces: facesById.contributingFeatureIdsById,
      edges: edgesById.contributingFeatureIdsById,
      vertices: verticesById.contributingFeatureIdsById,
    }),
    facesById: facesById.resultById,
    faceContributingFeatureIdsById: facesById.contributingFeatureIdsById,
    edgesById: edgesById.resultById,
    edgeContributingFeatureIdsById: edgesById.contributingFeatureIdsById,
    verticesById: verticesById.resultById,
    vertexContributingFeatureIdsById: verticesById.contributingFeatureIdsById,
    naming: {
      strategy: OCC_TOPOLOGY_NAMING_STRATEGY,
      document: previousNaming.document,
      bodyLabel,
      topologyLabelsByKey: nextLabelsByKey,
      selectorLabelsByKey: nextSelectorLabelsByKey,
    },
    invalidations,
  };
}
