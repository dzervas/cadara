import type {
  BodyId,
  EdgeId,
  FaceId,
  FeatureId,
  VertexId,
} from "@/contracts/shared/ids";
import type { DurableRef } from "@/contracts/shared/references";
import type { OpenCascadeInstance } from "@/domain/modeling/occ/runtime";
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

function createDocument(oc: OpenCascadeInstance) {
  return new oc.TDocStd_Document(
    new oc.TCollection_ExtendedString_2("CadaraOccNaming", true),
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

function readNamedShape(oc: OpenCascadeInstance, namedShape: OccNamedShape) {
  if (namedShape.IsNull()) {
    return [];
  }

  const shapes: OccShape[] = [];

  try {
    shapes.push(oc.TNaming_Tool.GetShape(namedShape));
  } catch {
    // Some unresolved selected names cannot be materialized by OCJS.
    ignoreOccNamingResolutionError();
  }

  try {
    shapes.push(oc.TNaming_Tool.CurrentShape_1(namedShape));
  } catch {
    // CurrentShape can throw for unresolved or deleted selector states.
    ignoreOccNamingResolutionError();
  }

  return uniqueShapes(shapes);
}

function createSelectorLabel(
  oc: OpenCascadeInstance,
  parent: OccLabel,
  selection: OccShape,
  context: OccShape,
) {
  const label = parent.NewChild();
  const selector = new oc.TNaming_Selector(label);

  try {
    try {
      const selectedWithContext = selector.Select_1(
        selection,
        context,
        false,
        true,
      );
      const selectedShapes = readNamedShape(oc, selector.NamedShape());

      if (
        selectedWithContext &&
        selectedShapes.some(
          (shape) => shape.IsSame(selection) && hasShapeType(shape, selection),
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
  } finally {
    selector.delete();
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
  const label = document.Main().NewChild();
  const builder = new oc.TNaming_Builder(label);
  builder.Generated_1(shape);
  builder.delete();

  return label;
}

function createInitialNamingState(
  oc: OpenCascadeInstance,
  body: TrackedTopologyInput,
): OccTopologyNamingBodyState {
  const document = createDocument(oc);
  const bodyLabel = createBodyLabel(oc, document, body.shape);
  const topologyLabelsByKey = new Map<string, OccLabel>();
  const selectorLabelsByKey = new Map<string, OccLabel>();

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

  return {
    strategy: OCC_TOPOLOGY_NAMING_STRATEGY,
    document,
    bodyLabel,
    topologyLabelsByKey,
    selectorLabelsByKey,
  };
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
  labels.Add(naming.document.Main());
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

function readCurrentNamedShape(
  oc: OpenCascadeInstance,
  namedShape: OccNamedShape,
  validLabels: OccLabelMap,
) {
  if (namedShape.IsNull()) {
    return [];
  }

  const shapes = readNamedShape(oc, namedShape);

  try {
    shapes.push(oc.TNaming_Tool.CurrentShape_2(namedShape, validLabels));
  } catch {
    // OCJS throws when the selected name cannot be solved in the current label set.
    ignoreOccNamingResolutionError();
  }

  try {
    const currentNamedShape = oc.TNaming_Tool.CurrentNamedShape_1(
      namedShape,
      validLabels,
    );
    shapes.push(...readNamedShape(oc, currentNamedShape));
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

  try {
    try {
      selector.Solve(validLabels);
    } catch {
      // Unsolved selectors still expose their last named shape; history is the fallback.
      ignoreOccNamingResolutionError();
    }

    return mapFinalIndexes(
      finalShapeMap,
      readCurrentNamedShape(oc, selector.NamedShape(), validLabels),
    );
  } finally {
    selector.delete();
  }
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

function resolveFinalSuccessors(
  oc: OpenCascadeInstance,
  previousShape: OccShape,
  finalShapeMap: InstanceType<
    OpenCascadeInstance["TopTools_IndexedMapOfShape"]
  >,
  historySources: readonly OccTopologyHistorySource[],
) {
  let candidates = [previousShape];
  let deleted = false;

  for (const historySource of historySources) {
    const nextCandidates: OccShape[] = [];

    for (const candidate of candidates) {
      if (isOccTopologyHistoryDeleted(historySource, candidate)) {
        deleted = true;
        continue;
      }

      const modified = listShapes(oc, historySource.Modified(candidate));
      const generated = listShapes(oc, historySource.Generated(candidate));
      const evolved = uniqueShapes([...modified, ...generated]);

      if (evolved.length > 0) {
        nextCandidates.push(...evolved);
      } else {
        nextCandidates.push(candidate);
      }
    }

    candidates = uniqueShapes(nextCandidates);
  }

  const finalIndexes = mapFinalIndexes(finalShapeMap, candidates);

  return {
    finalIndexes,
    deleted,
  };
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
    const selectorFinalIndexes = resolveSelectorFinalSuccessors(
      oc,
      input.previousSelectorLabelsByKey.get(key),
      input.validLabels,
      input.finalShapeMap,
    );
    const resolution =
      selectorFinalIndexes.length > 0
        ? { finalIndexes: selectorFinalIndexes, deleted: false }
        : resolveFinalSuccessors(
            oc,
            previousShape,
            input.finalShapeMap,
            input.historySources,
          );

    if (resolution.finalIndexes.length === 1) {
      const [index] = resolution.finalIndexes;
      claimsByIndex.set(index!, [
        ...(claimsByIndex.get(index!) ?? []),
        previousId,
      ]);
      preservedIndexById.set(previousId, index!);
    }

    const inheritedResolution = resolveFinalSuccessors(
      oc,
      previousShape,
      input.finalShapeMap,
      input.historySources,
    );

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
      resolution.finalIndexes.length > 1
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
      input.nextSelectorLabelsByKey.set(
        key,
        createSelectorLabel(oc, input.bodyLabel, shape, input.contextShape),
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
    const selectorFinalIndexes = resolveSelectorFinalSuccessors(
      oc,
      input.previousSelectorLabelsByKey.get(key),
      input.validLabels,
      input.finalShapeMap,
    );
    const preservedResolution =
      selectorFinalIndexes.length > 0
        ? { finalIndexes: selectorFinalIndexes, deleted: false }
        : resolveFinalSuccessors(
            oc,
            previousShape,
            input.finalShapeMap,
            input.historySources,
          );

    if (preservedResolution.finalIndexes.length === 1) {
      const [index] = preservedResolution.finalIndexes;
      claimsByIndex.set(index!, [
        ...(claimsByIndex.get(index!) ?? []),
        previousId,
      ]);
    }

    const inheritedResolution = resolveFinalSuccessors(
      oc,
      previousShape,
      input.finalShapeMap,
      input.historySources,
    );

    for (const index of inheritedResolution.finalIndexes) {
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
  const previousNaming =
    input.previous.naming ?? createInitialNamingState(oc, input.previous);
  const validLabels = createValidLabelMap(oc, previousNaming);
  const faceShapeMap = buildShapeMap(oc, "face", input.generated.shape);
  const edgeShapeMap = buildShapeMap(oc, "edge", input.generated.shape);
  const vertexShapeMap = buildShapeMap(oc, "vertex", input.generated.shape);

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

  faceShapeMap.delete();
  edgeShapeMap.delete();
  vertexShapeMap.delete();
  validLabels.delete();

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
  const invalidations = new Map<string, OccReferenceInvalidationRecord>();
  const previousNaming =
    input.previous.naming ?? createInitialNamingState(oc, input.previous);
  const bodyLabel = previousNaming.bodyLabel;
  modifyLabel(oc, bodyLabel, input.previous.shape, input.replacement.shape);

  const nextLabelsByKey = new Map<string, OccLabel>();
  const nextSelectorLabelsByKey = new Map<string, OccLabel>();
  const validLabels = createValidLabelMap(oc, previousNaming);
  const faceShapeMap = buildShapeMap(oc, "face", input.replacement.shape);
  const edgeShapeMap = buildShapeMap(oc, "edge", input.replacement.shape);
  const vertexShapeMap = buildShapeMap(oc, "vertex", input.replacement.shape);

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

  faceShapeMap.delete();
  edgeShapeMap.delete();
  vertexShapeMap.delete();
  validLabels.delete();

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
