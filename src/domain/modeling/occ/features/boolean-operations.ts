import type {
  FeatureBooleanOperation,
  FeatureBooleanScope,
} from "@/contracts/modeling/schema";
import type {
  BodyId,
  EdgeId,
  FaceId,
  FeatureId,
  VertexId,
} from "@/contracts/shared/ids";
import type { DurableRef } from "@/contracts/shared/references";
import { getMultiBodyBooleanPolicy } from "@/domain/modeling/occ/implementation-policy";
import type { OpenCascadeInstance } from "@/domain/modeling/occ/runtime";
import {
  advanceTopologyToken,
  extractSolidShapes,
  getOccDurableRefKey,
  orderSolidShapesCanonically,
  OCC_REFERENCE_INVALIDATION_REASONS,
  reconcileReplacementSolidBody,
  rewriteNativeTopologyPayloadIds,
  trackDerivedSolidBody,
  trackNewSolidBody,
  trackReplacementSolidBody,
  trackReplacementSolidBodyFromNativePayload,
  type OccTrackedBody,
  type OccReferenceInvalidationRecord,
} from "@/domain/modeling/occ/topology";
import {
  parseNativeBooleanOperandHistoryJson,
  parseNativeFeatureTransactionHistoryJson,
  parseNativeShimPayloadJson,
  type OccNativeBooleanOperandHistoryPayload,
  type OccNativeFeatureTransactionHistoryPayload,
  type OccNativeFeatureTransactionHistoryRecord,
  type OccNativeShimPayload,
  type OpenCascadeNativeFeatureTransactionResult,
  type OpenCascadeNativeTopologyKernelHost,
} from "@/domain/modeling/occ/native-topology-payload";
import {
  isOccTopologyHistoryDeleted,
  type OccTopologyHistorySource,
} from "@/domain/modeling/occ/topology-naming";
import { formatGeneratedProducerTopologySourceKey } from "@/domain/modeling/occ/topology-stage";
import {
  requireSolidBody,
  trackNewBodyResults,
  type OccFeatureExecutionContext,
} from "@/domain/modeling/occ/features/shared";

export type OccFeatureSourceShapeMap = ReadonlyMap<
  string,
  readonly InstanceType<OpenCascadeInstance["TopoDS_Shape"]>[]
>;

interface ApplyBooleanPolicyOptions {
  sourceShapes?: OccFeatureSourceShapeMap;
}

function listHistoryShapes(oc: OpenCascadeInstance, list: { Size(): number }) {
  const shapes: InstanceType<OpenCascadeInstance["TopoDS_Shape"]>[] = [];
  const typedList = list as InstanceType<
    OpenCascadeInstance["TopTools_ListOfShape"]
  >;
  const copy = new oc.TopTools_ListOfShape_3(typedList);

  try {
    while (copy.Size() > 0) {
      shapes.push(copy.First_1());
      copy.RemoveFirst();
    }
  } finally {
    copy.delete();
    typedList.delete();
  }

  return shapes;
}

function appendUniqueShape(
  shapes: InstanceType<OpenCascadeInstance["TopoDS_Shape"]>[],
  candidate: InstanceType<OpenCascadeInstance["TopoDS_Shape"]>,
) {
  if (!shapes.some((shape) => shape.IsSame(candidate))) {
    shapes.push(candidate);
  }
}

export function projectFeatureSourceShapes(
  oc: OpenCascadeInstance,
  sourceShapes: OccFeatureSourceShapeMap,
  historySources: readonly OccTopologyHistorySource[],
) {
  const projected = new Map<
    string,
    InstanceType<OpenCascadeInstance["TopoDS_Shape"]>[]
  >();

  for (const [sourceKey, initialShapes] of sourceShapes) {
    let candidates = [...initialShapes];

    for (const historySource of historySources) {
      const successors: InstanceType<OpenCascadeInstance["TopoDS_Shape"]>[] =
        [];

      for (const candidate of candidates) {
        if (isOccTopologyHistoryDeleted(historySource, candidate)) {
          continue;
        }

        const evolved = [
          ...listHistoryShapes(oc, historySource.Modified(candidate)),
          ...listHistoryShapes(oc, historySource.Generated(candidate)),
        ];

        if (evolved.length === 0) {
          appendUniqueShape(successors, candidate);
        } else {
          for (const shape of evolved) {
            appendUniqueShape(successors, shape);
          }
        }
      }

      candidates = successors;
    }

    projected.set(sourceKey, candidates);
  }

  return projected;
}

function mergeFeatureSourceShapes(
  target: Map<string, InstanceType<OpenCascadeInstance["TopoDS_Shape"]>[]>,
  source: OccFeatureSourceShapeMap,
) {
  for (const [sourceKey, shapes] of source) {
    const merged = target.get(sourceKey) ?? [];
    for (const shape of shapes) {
      appendUniqueShape(merged, shape);
    }
    target.set(sourceKey, merged);
  }
}

function mapFeatureSourceTargets(
  bodies: readonly OccTrackedBody[],
  sourceShapes: OccFeatureSourceShapeMap | undefined,
) {
  if (!sourceShapes) {
    return undefined;
  }

  const targets = new Map<string, DurableRef[]>();

  for (const [sourceKey, shapes] of sourceShapes) {
    const refs: DurableRef[] = [];
    const register = (target: DurableRef) => {
      const key = getOccDurableRefKey(target);
      if (!refs.some((entry) => getOccDurableRefKey(entry) === key)) {
        refs.push(target);
      }
    };

    for (const body of bodies) {
      for (const shape of shapes) {
        for (const [faceId, face] of body.facesById) {
          if (face.IsSame(shape)) {
            register({ kind: "face", bodyId: body.bodyId, faceId });
          }
        }
        for (const [edgeId, edge] of body.edgesById) {
          if (edge.IsSame(shape)) {
            register({ kind: "edge", bodyId: body.bodyId, edgeId });
          }
        }
        for (const [vertexId, vertex] of body.verticesById) {
          if (vertex.IsSame(shape)) {
            register({ kind: "vertex", bodyId: body.bodyId, vertexId });
          }
        }
      }
    }

    targets.set(sourceKey, refs);
  }

  return targets;
}

function mergeFeatureSourceTargets(
  ...sources: readonly (
    | ReadonlyMap<string, readonly DurableRef[]>
    | undefined
  )[]
) {
  const merged = new Map<string, DurableRef[]>();
  for (const source of sources) {
    for (const [sourceKey, targets] of source ?? []) {
      const current = merged.get(sourceKey) ?? [];
      for (const target of targets) {
        if (
          !current.some(
            (candidate) =>
              getOccDurableRefKey(candidate) === getOccDurableRefKey(target),
          )
        ) {
          current.push(target);
        }
      }
      merged.set(sourceKey, current);
    }
  }
  return merged;
}

function mapInheritedBodyTopologyTargets(
  ownerFeatureId: FeatureId,
  sourceBody: OccTrackedBody,
  replacements: readonly OccTrackedBody[],
) {
  const replacement = replacements.find(
    (body) => body.bodyId === sourceBody.bodyId,
  );
  const targets = new Map<string, DurableRef[]>();
  if (!replacement) {
    return targets;
  }

  const register = (target: DurableRef, isLive: boolean) => {
    if (isLive) {
      targets.set(
        `boolean:${ownerFeatureId}:input:${getOccDurableRefKey(target)}`,
        [target],
      );
    }
  };
  for (const faceId of sourceBody.topology.faceIds) {
    register(
      { kind: "face", bodyId: sourceBody.bodyId, faceId },
      replacement.facesById.has(faceId),
    );
  }
  for (const edgeId of sourceBody.topology.edgeIds) {
    register(
      { kind: "edge", bodyId: sourceBody.bodyId, edgeId },
      replacement.edgesById.has(edgeId),
    );
  }
  for (const vertexId of sourceBody.topology.vertexIds) {
    register(
      { kind: "vertex", bodyId: sourceBody.bodyId, vertexId },
      replacement.verticesById.has(vertexId),
    );
  }
  return targets;
}

export { trackDerivedSolidBody };

export function createBooleanBuilder(
  oc: OpenCascadeInstance,
  operation: Exclude<FeatureBooleanOperation, "newBody">,
  left: InstanceType<OpenCascadeInstance["TopoDS_Shape"]>,
  right: InstanceType<OpenCascadeInstance["TopoDS_Shape"]>,
) {
  const progress = new oc.Message_ProgressRange_1();

  switch (operation) {
    case "join":
      return new oc.BRepAlgoAPI_Fuse_3(left, right, progress);
    case "cut":
      return new oc.BRepAlgoAPI_Cut_3(left, right, progress);
    case "intersect":
      return new oc.BRepAlgoAPI_Common_3(left, right, progress);
  }
}

export function refineBooleanResultShape(
  oc: OpenCascadeInstance,
  shape: InstanceType<OpenCascadeInstance["TopoDS_Shape"]>,
) {
  const unifier = new oc.ShapeUpgrade_UnifySameDomain_2(
    shape,
    true,
    true,
    true,
  );
  unifier.AllowInternalEdges(false);
  unifier.SetSafeInputMode(true);
  unifier.SetLinearTolerance(0.001);
  unifier.SetAngularTolerance(0.001);
  unifier.Build();
  const unifiedShape = unifier.Shape();
  const historySource = new oc.BRepTools_History();
  const historyHandle = unifier.History_1();

  if (!historyHandle.IsNull()) {
    historySource.Merge_1(historyHandle);
  }

  historyHandle.delete();
  unifier.delete();

  return {
    shape: unifiedShape,
    historySource,
  };
}

export function runBoolean(
  oc: OpenCascadeInstance,
  operation: Exclude<FeatureBooleanOperation, "newBody">,
  left: InstanceType<OpenCascadeInstance["TopoDS_Shape"]>,
  right: InstanceType<OpenCascadeInstance["TopoDS_Shape"]>,
) {
  const builder = createBooleanBuilder(oc, operation, left, right);
  builder.SetToFillHistory(true);
  builder.Build(new oc.Message_ProgressRange_1());

  if (!builder.IsDone()) {
    throw new Error(`OCC boolean ${operation} failed to build.`);
  }

  builder.SimplifyResult(true, true, 1e-7);

  const refined = refineBooleanResultShape(oc, builder.Shape());

  return {
    shape: refined.shape,
    builder,
    historySources: [
      builder,
      refined.historySource,
    ] satisfies OccTopologyHistorySource[],
  };
}

/**
 * Split a solid by a sheet tool.
 *
 * A sheet has no volume, so cut/common boolean semantics cannot express this;
 * OCC's splitter subdivides the arguments by the tools and never keeps the
 * tools in the result. The result is not unified afterwards: the freshly created
 * split faces are the topology this operation exists to produce.
 */
export function runSheetSplit(
  oc: OpenCascadeInstance,
  target: InstanceType<OpenCascadeInstance["TopoDS_Shape"]>,
  tool: InstanceType<OpenCascadeInstance["TopoDS_Shape"]>,
) {
  let argumentShapes:
    | InstanceType<OpenCascadeInstance["TopTools_ListOfShape"]>
    | undefined;
  let toolShapes:
    | InstanceType<OpenCascadeInstance["TopTools_ListOfShape"]>
    | undefined;
  let builder:
    | InstanceType<OpenCascadeInstance["BRepAlgoAPI_Splitter"]>
    | undefined;
  let progress:
    | InstanceType<OpenCascadeInstance["Message_ProgressRange"]>
    | undefined;
  let returned = false;

  try {
    argumentShapes = new oc.TopTools_ListOfShape_1();
    toolShapes = new oc.TopTools_ListOfShape_1();
    builder = new oc.BRepAlgoAPI_Splitter_1();
    progress = new oc.Message_ProgressRange_1();
    argumentShapes.Append_1(target);
    toolShapes.Append_1(tool);
    builder.SetArguments(argumentShapes);
    builder.SetTools(toolShapes);
    builder.SetToFillHistory(true);
    builder.Build(progress);

    if (!builder.IsDone()) {
      throw new Error("OCC sheet-tool split failed to build.");
    }

    builder.SimplifyResult(true, true, 1e-7);
    const completedBuilder = builder;
    const shape = completedBuilder.Shape();
    returned = true;

    return {
      shape,
      builder: completedBuilder,
      historySources: [completedBuilder] satisfies OccTopologyHistorySource[],
      dispose: () => completedBuilder.delete(),
    };
  } finally {
    if (!returned) {
      builder?.delete();
    }
    progress?.delete();
    toolShapes?.delete();
    argumentShapes?.delete();
  }
}

function appendOwnerFeature(
  contributors: readonly FeatureId[],
  ownerFeatureId: FeatureId | null,
) {
  return ownerFeatureId && !contributors.includes(ownerFeatureId)
    ? [...contributors, ownerFeatureId]
    : [...contributors];
}

function collectBodyContributors(
  ownerFeatureId: FeatureId | null,
  ...maps: readonly ReadonlyMap<
    FaceId | EdgeId | VertexId,
    readonly FeatureId[]
  >[]
) {
  const contributors: FeatureId[] = [];

  for (const map of maps) {
    for (const list of map.values()) {
      for (const featureId of list) {
        if (!contributors.includes(featureId)) {
          contributors.push(featureId);
        }
      }
    }
  }

  if (ownerFeatureId && !contributors.includes(ownerFeatureId)) {
    contributors.push(ownerFeatureId);
  }

  return contributors;
}

function nativeHistoryInvalidationReason(
  reason: OccNativeFeatureTransactionHistoryRecord["reason"],
) {
  switch (reason) {
    case "ambiguous":
      return OCC_REFERENCE_INVALIDATION_REASONS.topologyAmbiguous;
    case "deleted":
      return OCC_REFERENCE_INVALIDATION_REASONS.topologyDeleted;
    case "missing":
      return OCC_REFERENCE_INVALIDATION_REASONS.missing;
    case "unique-successor":
      return null;
  }
}

function sameTopologyTargetKind(target: DurableRef, successor: DurableRef) {
  return (
    (target.kind === "face" && successor.kind === "face") ||
    (target.kind === "edge" && successor.kind === "edge") ||
    (target.kind === "vertex" && successor.kind === "vertex")
  );
}

function createNativeCurrentTargetAliases(
  current: OccTrackedBody,
  nativePayload: OccNativeShimPayload | null,
) {
  const aliases = new Map<string, DurableRef>();

  if (!nativePayload) {
    return aliases;
  }

  for (const record of nativePayload.topology) {
    if (record.bodyId !== current.bodyId) {
      continue;
    }

    if (record.kind === "face") {
      const faceId = current.topology.faceIds[record.index - 1];
      if (faceId) {
        aliases.set(
          getOccDurableRefKey({
            kind: "face",
            bodyId: current.bodyId,
            faceId: record.id as FaceId,
          }),
          {
            kind: "face",
            bodyId: current.bodyId,
            faceId,
          },
        );
      }
      continue;
    }

    if (record.kind === "edge") {
      const edgeId = current.topology.edgeIds[record.index - 1];
      if (edgeId) {
        aliases.set(
          getOccDurableRefKey({
            kind: "edge",
            bodyId: current.bodyId,
            edgeId: record.id as EdgeId,
          }),
          {
            kind: "edge",
            bodyId: current.bodyId,
            edgeId,
          },
        );
      }
      continue;
    }

    if (record.kind === "vertex") {
      const vertexId = current.topology.vertexIds[record.index - 1];
      if (vertexId) {
        aliases.set(
          getOccDurableRefKey({
            kind: "vertex",
            bodyId: current.bodyId,
            vertexId: record.id as VertexId,
          }),
          {
            kind: "vertex",
            bodyId: current.bodyId,
            vertexId,
          },
        );
      }
    }
  }

  return aliases;
}

function resolveExistingNativeAliasTarget(
  current: OccTrackedBody,
  target: DurableRef,
): DurableRef {
  if (target.kind === "face") {
    const faceId = current.nativeTopologyIdAliases?.faceIdsByNativeId.get(
      target.faceId,
    );
    return faceId ? { ...target, faceId } : target;
  }
  if (target.kind === "edge") {
    const edgeId = current.nativeTopologyIdAliases?.edgeIdsByNativeId?.get(
      target.edgeId,
    );
    return edgeId ? { ...target, edgeId } : target;
  }
  if (target.kind === "vertex") {
    const vertexId = current.nativeTopologyIdAliases?.vertexIdsByNativeId?.get(
      target.vertexId,
    );
    return vertexId ? { ...target, vertexId } : target;
  }
  return target;
}

function isCurrentTopologyTarget(current: OccTrackedBody, target: DurableRef) {
  if (target.kind === "face") {
    return (
      target.bodyId === current.bodyId && current.facesById.has(target.faceId)
    );
  }
  if (target.kind === "edge") {
    return (
      target.bodyId === current.bodyId && current.edgesById.has(target.edgeId)
    );
  }
  if (target.kind === "vertex") {
    return (
      target.bodyId === current.bodyId &&
      current.verticesById.has(target.vertexId)
    );
  }
  return false;
}

type OccNativeSubtopologyRef = Extract<
  DurableRef,
  { kind: "face" | "edge" | "vertex" }
>;

type OccNativeSuccessorClaim = {
  previous: OccNativeSubtopologyRef;
  successor: OccNativeSubtopologyRef;
};

type OccNativeGeneratedClaim = {
  source: OccNativeSubtopologyRef;
  generated: OccNativeSubtopologyRef;
};

export interface OccResolvedNativeBooleanOperandHistory {
  operation: OccNativeBooleanOperandHistoryPayload["operation"];
  finalFaces: readonly {
    finalFace: Extract<DurableRef, { kind: "face" }>;
    leftSourceFaceNativeIds: readonly string[];
    rightSourceFaceNativeIds: readonly string[];
  }[];
}

function resolveNativeBooleanOperandHistory(input: {
  history: OccNativeBooleanOperandHistoryPayload | undefined;
  current: OccTrackedBody;
  replacement: OccTrackedBody;
  operation: string;
}) {
  const history = input.history;
  if (!history || history.status === "unsupported") {
    return undefined;
  }
  const expectedOperation = input.operation.replace(/^combine-/, "");
  if (
    history.operation !== expectedOperation ||
    history.bodyId !== input.current.bodyId ||
    history.previousTopologyToken !== input.current.topologyToken ||
    history.topologyToken !== input.replacement.topologyToken
  ) {
    throw new Error(
      "occ-native-boolean-operand-history-inconsistent-transaction: operand history does not describe the committed Boolean replacement.",
    );
  }
  const aliases = input.replacement.nativeTopologyIdAliases?.faceIdsByNativeId;
  if (!aliases) {
    throw new Error(
      "occ-native-boolean-operand-history-missing-final-face-aliases: committed Boolean replacement has no exact native-to-public face aliases.",
    );
  }
  const finalFaces = history.finalFaces.map((finalFace) => {
    const faceId = aliases.get(finalFace.nativeFaceId as FaceId);
    if (!faceId || !input.replacement.facesById.has(faceId)) {
      throw new Error(
        `occ-native-boolean-operand-history-missing-final-face: ${finalFace.nativeFaceId}.`,
      );
    }
    return {
      finalFace: {
        kind: "face" as const,
        bodyId: input.replacement.bodyId,
        faceId,
      },
      leftSourceFaceNativeIds: [...finalFace.leftSourceFaceNativeIds],
      rightSourceFaceNativeIds: [...finalFace.rightSourceFaceNativeIds],
    };
  });
  return { operation: history.operation, finalFaces } satisfies OccResolvedNativeBooleanOperandHistory;
}

function isNativeSubtopologyRef(
  target: DurableRef,
): target is OccNativeSubtopologyRef {
  return (
    target.kind === "face" || target.kind === "edge" || target.kind === "vertex"
  );
}

/**
 * Producer-identity claims carried by native `generated` history records.
 *
 * A generated entity is the successor of nothing, so it reaches a rebuild with
 * no source key unless the feature that produced it names it. The native shim
 * emits, per prior subshape, the entities its builder's `Generated` attributes
 * to that subshape; the honesty rules match the JS builder path exactly: a
 * record naming anything other than exactly one entity claims nothing, and an
 * entity reachable from two sources is many, so both claims are dropped.
 */
function collectNativeGeneratedClaims(input: {
  record: OccNativeFeatureTransactionHistoryRecord;
  source: DurableRef;
  current: OccTrackedBody;
  generatedClaims: OccNativeGeneratedClaim[];
  generatedSourceKeysByTargetKey: Map<string, string>;
}) {
  if (
    input.record.successors.length !== 1 ||
    !isNativeSubtopologyRef(input.source) ||
    !isCurrentTopologyTarget(input.current, input.source)
  ) {
    return;
  }

  const generated = input.record.successors[0]!;
  if (!isNativeSubtopologyRef(generated)) {
    return;
  }

  const sourceKey = getOccDurableRefKey(input.source);
  const targetKey = getOccDurableRefKey(generated);
  const claimedBy = input.generatedSourceKeysByTargetKey.get(targetKey);
  if (claimedBy !== undefined) {
    const index = input.generatedClaims.findIndex(
      (claim) => getOccDurableRefKey(claim.generated) === targetKey,
    );
    if (index >= 0) {
      input.generatedClaims.splice(index, 1);
    }
    return;
  }

  input.generatedSourceKeysByTargetKey.set(targetKey, sourceKey);
  input.generatedClaims.push({ source: input.source, generated });
}
function collectNativeHistoryResolution(input: {
  current: OccTrackedBody;
  history: OccNativeFeatureTransactionHistoryPayload;
  currentNativePayload?: OccNativeShimPayload | null;
}) {
  const preservedTargetsBySuccessorKey = new Map<string, DurableRef>();
  const successorTargetsByPreviousKey = new Map<string, DurableRef>();
  const invalidations = new Map<string, OccReferenceInvalidationRecord>();
  const currentTargetAliases = createNativeCurrentTargetAliases(
    input.current,
    input.currentNativePayload ?? null,
  );
  const claims: OccNativeSuccessorClaim[] = [];
  const generatedClaims: OccNativeGeneratedClaim[] = [];
  const generatedSourceKeysByTargetKey = new Map<string, string>();

  for (const record of input.history.records) {
    const target =
      currentTargetAliases.get(getOccDurableRefKey(record.target)) ??
      record.target;
    const exactTarget = resolveExistingNativeAliasTarget(
      input.current,
      record.target,
    );

    if (
      record.reason === "unique-successor" &&
      record.successors.length === 1 &&
      sameTopologyTargetKind(target, record.successors[0]!)
    ) {
      const successor = record.successors[0]!;
      preservedTargetsBySuccessorKey.set(
        getOccDurableRefKey(successor),
        target,
      );
      if (
        sameTopologyTargetKind(exactTarget, successor) &&
        isCurrentTopologyTarget(input.current, exactTarget)
      ) {
        claims.push({
          previous: exactTarget,
          successor,
        } as OccNativeSuccessorClaim);
      }
      continue;
    }

    if (record.reason === "generated") {
      collectNativeGeneratedClaims({
        record,
        source: exactTarget,
        current: input.current,
        generatedClaims,
        generatedSourceKeysByTargetKey,
      });
      continue;
    }
    const reason =
      record.reason === "unique-successor"
        ? OCC_REFERENCE_INVALIDATION_REASONS.topologyAmbiguous
        : nativeHistoryInvalidationReason(record.reason);

    if (reason) {
      invalidations.set(getOccDurableRefKey(target), {
        target,
        reason,
        sourceTarget: { kind: "body", bodyId: input.current.bodyId },
      });
    }
  }

  const previousClaims = new Map<string, OccNativeSuccessorClaim[]>();
  const successorClaims = new Map<string, OccNativeSuccessorClaim[]>();
  for (const claim of claims) {
    const previousKey = getOccDurableRefKey(claim.previous);
    const successorKey = getOccDurableRefKey(claim.successor);
    previousClaims.set(previousKey, [
      ...(previousClaims.get(previousKey) ?? []),
      claim,
    ]);
    successorClaims.set(successorKey, [
      ...(successorClaims.get(successorKey) ?? []),
      claim,
    ]);
  }

  for (const claim of claims) {
    const previousKey = getOccDurableRefKey(claim.previous);
    const successorKey = getOccDurableRefKey(claim.successor);
    const duplicatePrevious =
      (previousClaims.get(previousKey)?.length ?? 0) > 1;
    const duplicateSuccessor =
      (successorClaims.get(successorKey)?.length ?? 0) > 1;
    if (duplicatePrevious || duplicateSuccessor) {
      invalidations.set(previousKey, {
        target: claim.previous,
        reason: OCC_REFERENCE_INVALIDATION_REASONS.topologyAmbiguous,
        sourceTarget: { kind: "body", bodyId: input.current.bodyId },
      });
      preservedTargetsBySuccessorKey.delete(successorKey);
      continue;
    }

    successorTargetsByPreviousKey.set(previousKey, claim.successor);
  }

  return {
    preservedTargetsBySuccessorKey,
    successorTargetsByPreviousKey,
    generatedClaims,
    invalidations,
  };
}

export function collectNativeFeatureHistoryInvalidations(
  current: OccTrackedBody,
  history: OccNativeFeatureTransactionHistoryPayload,
) {
  if (history.status !== "available") {
    return createUnsupportedHistoryInvalidations(current);
  }

  return collectNativeHistoryResolution({
    current,
    history,
  }).invalidations;
}

/**
 * Assign durable ids to the fresh native topology of a replacement body.
 *
 * A preserved id claimed through native history must win over the fresh native
 * id that happens to spell the same string, and every fresh entity must keep an
 * id: dropping one would leave the tracked body smaller than its own shape and
 * break native payload aliasing later. Preserved claims are therefore resolved
 * first, and any remaining entity keeps its fresh id unless that id was already
 * claimed, in which case it is suffixed to stay unique within the body.
 */
function assignNativeHistoryIds<Id extends FaceId | EdgeId | VertexId>(input: {
  kind: "face" | "edge" | "vertex";
  bodyId: BodyId;
  freshIds: readonly Id[];
  preservedTargetsBySuccessorKey: ReadonlyMap<string, DurableRef>;
  ownerFeatureId: FeatureId;
  previousContributingFeatureIdsById: ReadonlyMap<Id, readonly FeatureId[]>;
  freshContributingFeatureIdsById: ReadonlyMap<Id, readonly FeatureId[]>;
}) {
  const preservedIdByFreshId = new Map<Id, Id>();
  const claimed = new Set<Id>();

  for (const freshId of input.freshIds) {
    const successorKey = getOccDurableRefKey(
      topologyRefFor(input.kind, input.bodyId, freshId),
    );
    const preservedTarget =
      input.preservedTargetsBySuccessorKey.get(successorKey);
    if (preservedTarget?.kind !== input.kind) continue;
    const preservedId = topologyRefId(preservedTarget) as Id;
    if (claimed.has(preservedId)) continue;
    claimed.add(preservedId);
    preservedIdByFreshId.set(freshId, preservedId);
  }

  const ids: Id[] = [];
  const idsByNativeId = new Map<Id, Id>();
  const contributingFeatureIdsById = new Map<Id, FeatureId[]>();

  for (const freshId of input.freshIds) {
    const preservedId = preservedIdByFreshId.get(freshId);
    let id = preservedId ?? freshId;
    if (!preservedId) {
      let disambiguator = 1;
      while (claimed.has(id)) {
        disambiguator += 1;
        id = `${freshId}_${disambiguator}` as Id;
      }
      claimed.add(id);
    }

    ids.push(id);
    idsByNativeId.set(freshId, id);
    contributingFeatureIdsById.set(
      id,
      preservedId
        ? appendOwnerFeature(
            input.previousContributingFeatureIdsById.get(preservedId) ?? [],
            input.ownerFeatureId,
          )
        : [...(input.freshContributingFeatureIdsById.get(freshId) ?? [])],
    );
  }

  return { ids, idsByNativeId, contributingFeatureIdsById };
}

function topologyRefFor(
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

function topologyRefId(target: DurableRef) {
  switch (target.kind) {
    case "face":
      return target.faceId;
    case "edge":
      return target.edgeId;
    case "vertex":
      return target.vertexId;
    default:
      throw new Error(
        `Native history successor ${target.kind} is not a topology target.`,
      );
  }
}

function nativeSubtopologyRefId(target: OccNativeSubtopologyRef) {
  if (target.kind === "face") {
    return target.faceId;
  }
  if (target.kind === "edge") {
    return target.edgeId;
  }
  return target.vertexId;
}

function rewriteNativeSubtopologyRef(
  target: OccNativeSubtopologyRef,
  aliases: {
    faceIdsByNativeId: ReadonlyMap<FaceId, FaceId>;
    edgeIdsByNativeId: ReadonlyMap<EdgeId, EdgeId>;
    vertexIdsByNativeId: ReadonlyMap<VertexId, VertexId>;
  },
): OccNativeSubtopologyRef | null {
  if (target.kind === "face") {
    const faceId = aliases.faceIdsByNativeId.get(target.faceId);
    return faceId ? { ...target, faceId } : null;
  }
  if (target.kind === "edge") {
    const edgeId = aliases.edgeIdsByNativeId.get(target.edgeId);
    return edgeId ? { ...target, edgeId } : null;
  }
  const vertexId = aliases.vertexIdsByNativeId.get(target.vertexId);
  return vertexId ? { ...target, vertexId } : null;
}
function reconcileNativeHistoryReplacement(
  current: OccTrackedBody,
  replacement: OccTrackedBody,
  history: OccNativeFeatureTransactionHistoryPayload,
  ownerFeatureId: FeatureId,
  currentNativePayload: OccNativeShimPayload | null,
) {
  if (history.status !== "available") {
    return {
      body: replacement,
      historyInvalidations: createUnsupportedHistoryInvalidations(current),
      successorTargetsByPreviousKey: new Map<string, DurableRef>(),
      generatedTargetsBySourceKey: new Map<string, DurableRef>(),
    };
  }

  const {
    preservedTargetsBySuccessorKey,
    successorTargetsByPreviousKey: rawSuccessorTargetsByPreviousKey,
    generatedClaims,
    invalidations,
  } = collectNativeHistoryResolution({
    current,
    history,
    currentNativePayload,
  });
  const faces = assignNativeHistoryIds<FaceId>({
    kind: "face",
    bodyId: replacement.bodyId,
    freshIds: replacement.topology.faceIds,
    preservedTargetsBySuccessorKey,
    ownerFeatureId,
    previousContributingFeatureIdsById: current.faceContributingFeatureIdsById,
    freshContributingFeatureIdsById: replacement.faceContributingFeatureIdsById,
  });
  const facesById = new Map<
    FaceId,
    OccTrackedBody["facesById"] extends Map<FaceId, infer Face> ? Face : never
  >();
  for (const [freshId, faceId] of faces.idsByNativeId) {
    const face = replacement.facesById.get(freshId);
    if (face) facesById.set(faceId, face as never);
  }
  const faceIds = faces.ids;
  const faceContributingFeatureIdsById = faces.contributingFeatureIdsById;
  const faceIdsByNativeId = faces.idsByNativeId;

  const edges = assignNativeHistoryIds<EdgeId>({
    kind: "edge",
    bodyId: replacement.bodyId,
    freshIds: replacement.topology.edgeIds,
    preservedTargetsBySuccessorKey,
    ownerFeatureId,
    previousContributingFeatureIdsById: current.edgeContributingFeatureIdsById,
    freshContributingFeatureIdsById: replacement.edgeContributingFeatureIdsById,
  });
  const edgesById = new Map<
    EdgeId,
    OccTrackedBody["edgesById"] extends Map<EdgeId, infer Edge> ? Edge : never
  >();
  for (const [freshId, edgeId] of edges.idsByNativeId) {
    const edge = replacement.edgesById.get(freshId);
    if (edge) edgesById.set(edgeId, edge as never);
  }
  const edgeIds = edges.ids;
  const edgeContributingFeatureIdsById = edges.contributingFeatureIdsById;
  const edgeIdsByNativeId = edges.idsByNativeId;

  const vertices = assignNativeHistoryIds<VertexId>({
    kind: "vertex",
    bodyId: replacement.bodyId,
    freshIds: replacement.topology.vertexIds,
    preservedTargetsBySuccessorKey,
    ownerFeatureId,
    previousContributingFeatureIdsById:
      current.vertexContributingFeatureIdsById,
    freshContributingFeatureIdsById:
      replacement.vertexContributingFeatureIdsById,
  });
  const verticesById = new Map<
    VertexId,
    OccTrackedBody["verticesById"] extends Map<VertexId, infer Vertex>
      ? Vertex
      : never
  >();
  for (const [freshId, vertexId] of vertices.idsByNativeId) {
    const vertex = replacement.verticesById.get(freshId);
    if (vertex) verticesById.set(vertexId, vertex as never);
  }
  const vertexIds = vertices.ids;
  const vertexContributingFeatureIdsById = vertices.contributingFeatureIdsById;
  const vertexIdsByNativeId = vertices.idsByNativeId;

  const successorTargetsByPreviousKey = new Map<string, DurableRef>();
  for (const [previousKey, successor] of rawSuccessorTargetsByPreviousKey) {
    if (successor.kind === "face") {
      const faceId = faceIdsByNativeId.get(successor.faceId);
      if (faceId) {
        successorTargetsByPreviousKey.set(previousKey, {
          ...successor,
          faceId,
        });
      }
      continue;
    }
    if (successor.kind === "edge") {
      const edgeId = edgeIdsByNativeId.get(successor.edgeId);
      if (edgeId) {
        successorTargetsByPreviousKey.set(previousKey, {
          ...successor,
          edgeId,
        });
      }
      continue;
    }
    if (successor.kind === "vertex") {
      const vertexId = vertexIdsByNativeId.get(successor.vertexId);
      if (vertexId) {
        successorTargetsByPreviousKey.set(previousKey, {
          ...successor,
          vertexId,
        });
      }
    }
  }
  const generatedTargetsBySourceKey = new Map<string, DurableRef>();
  for (const claim of generatedClaims) {
    const generated = rewriteNativeSubtopologyRef(claim.generated, {
      faceIdsByNativeId,
      edgeIdsByNativeId,
      vertexIdsByNativeId,
    });
    if (!generated) {
      continue;
    }
    generatedTargetsBySourceKey.set(
      formatGeneratedProducerTopologySourceKey({
        featureId: ownerFeatureId,
        bodyId: current.bodyId,
        sourceKind: claim.source.kind,
        sourcePublicId: nativeSubtopologyRefId(claim.source),
        role: `generated-${generated.kind}`,
      }),
      generated,
    );
  }

  const reconciledBody = {
    ...replacement,
    topology: {
      faceIds,
      edgeIds,
      vertexIds,
    },
    contributingFeatureIds: collectBodyContributors(
      ownerFeatureId,
      faceContributingFeatureIdsById,
      edgeContributingFeatureIdsById,
      vertexContributingFeatureIdsById,
    ),
    facesById,
    faceContributingFeatureIdsById,
    edgesById,
    edgeContributingFeatureIdsById,
    verticesById,
    vertexContributingFeatureIdsById,
    naming: undefined,
    nativeTopologyPayload: replacement.nativeTopologyPayload
      ? rewriteNativeTopologyPayloadIds(
          replacement.bodyId,
          replacement.nativeTopologyPayload,
          {
            faceIdsByNativeId,
            edgeIdsByNativeId,
            vertexIdsByNativeId,
          },
        )
      : undefined,
    nativeTopologyIdAliases: {
      faceIdsByNativeId,
      edgeIdsByNativeId,
      vertexIdsByNativeId,
    },
  } satisfies OccTrackedBody;

  return {
    body: reconciledBody,
    historyInvalidations: invalidations,
    successorTargetsByPreviousKey,
    generatedTargetsBySourceKey,
  };
}

export function assertValidFeatureResultShape(
  context: OccFeatureExecutionContext,
  shape: InstanceType<OpenCascadeInstance["TopoDS_Shape"]>,
  operation: string,
) {
  const analyzer = new context.oc.BRepCheck_Analyzer(shape, true, false);
  try {
    if (!analyzer.IsValid_2()) {
      throw new Error(
        `occ-invalid-result-topology: OCC ${operation} produced invalid or non-manifold topology.`,
      );
    }
  } finally {
    analyzer.delete();
  }
}

export function resolveNativeFeatureTransactionReplacement(
  context: OccFeatureExecutionContext,
  current: OccTrackedBody,
  transaction: OpenCascadeNativeFeatureTransactionResult,
  operation: string,
  ownerFeatureId: FeatureId,
) {
  const { payload, history, booleanOperandHistory } =
    validateNativeFeatureTransaction(transaction, operation);
  assertValidFeatureResultShape(
    context,
    transaction.Shape() as InstanceType<OpenCascadeInstance["TopoDS_Shape"]>,
    operation,
  );
  const replacement = trackReplacementSolidBodyFromNativePayload(context.oc, {
    previous: current,
    ownerFeatureId,
    shape: transaction.Shape() as InstanceType<
      OpenCascadeInstance["TopoDS_Shape"]
    >,
    nativePayload: payload,
  });
  // A severing result has no single native replacement identity; fall back to
  // the JS path, which owns multi-piece identity and invalidation.
  if (!replacement) {
    return null;
  }
  const nativeHost =
    context.oc as unknown as OpenCascadeNativeTopologyKernelHost;
  const currentNativePayloadJson =
    nativeHost.CadaraBuildNativeTopologyPayload?.BuildJson?.(
      current.shape,
      current.bodyId,
      current.topologyToken,
      context.modelingTolerance,
      0.5,
    );
  const currentNativePayload = currentNativePayloadJson
    ? parseNativeShimPayloadJson(currentNativePayloadJson)
    : null;
  const reconciled = reconcileNativeHistoryReplacement(
    current,
    replacement,
    history,
    ownerFeatureId,
    currentNativePayload,
  );

  return {
    replacements: [reconciled.body],
    historyInvalidations: reconciled.historyInvalidations,
    successorTargetsByPreviousKey: reconciled.successorTargetsByPreviousKey,
    generatedTargetsBySourceKey: reconciled.generatedTargetsBySourceKey,
    booleanOperandHistory: resolveNativeBooleanOperandHistory({
      history: booleanOperandHistory,
      current,
      replacement: reconciled.body,
      operation,
    }),
  };
}

export function validateNativeFeatureTransaction(
  transaction: OpenCascadeNativeFeatureTransactionResult,
  operation: string,
) {
  if (!transaction.IsDone()) {
    throw new Error(`Native OCC ${operation} failed to build.`);
  }

  const payload = parseNativeShimPayloadJson(transaction.PayloadJson());
  const payloadError = payload.diagnostics.find(
    (diagnostic) => diagnostic.severity === "error",
  );

  if (payloadError) {
    throw new Error(
      `Native OCC ${operation} rejected committed result: ${payloadError.message}`,
    );
  }

  const history = parseNativeFeatureTransactionHistoryJson(
    transaction.HistoryJson(),
  );
  const historyError = history.diagnostics.find(
    (diagnostic) => diagnostic.severity === "error",
  );
  if (historyError) {
    throw new Error(
      `Native OCC ${operation} rejected topology history: ${historyError.message}`,
    );
  }
  const booleanOperandHistoryJson = transaction.BooleanOperandHistoryJson?.();
  const booleanOperandHistory =
    typeof booleanOperandHistoryJson === "string" &&
    booleanOperandHistoryJson.trim().length > 0
      ? parseNativeBooleanOperandHistoryJson(booleanOperandHistoryJson)
      : undefined;

  return {
    payload,
    history,
    booleanOperandHistory,
  };
}

function resolveNativeBooleanReplacement(
  context: OccFeatureExecutionContext,
  current: OccTrackedBody,
  featureShape: InstanceType<OpenCascadeInstance["TopoDS_Shape"]>,
  operation: Exclude<FeatureBooleanOperation, "newBody">,
  ownerFeatureId: FeatureId,
) {
  const nativeHost =
    context.oc as unknown as OpenCascadeNativeTopologyKernelHost;
  const builder =
    nativeHost.CadaraExecuteNativeFeatureTransaction
      ?.BuildBooleanCommittedShapeTransactionWithHistory;

  if (!builder) {
    return null;
  }

  const nextTopologyToken = advanceTopologyToken(current.topologyToken);
  const transaction = builder(
    current.shape,
    featureShape,
    operation,
    current.bodyId,
    current.topologyToken,
    nextTopologyToken,
    context.modelingTolerance,
    0.5,
  );

  try {
    return resolveNativeFeatureTransactionReplacement(
      context,
      current,
      transaction,
      operation,
      ownerFeatureId,
    );
  } finally {
    transaction.delete();
}
}

function createHistoryTargetForShape(target: DurableRef, ownerBodyId: BodyId) {
  switch (target.kind) {
    case "face":
    case "edge":
    case "vertex":
      return {
        target,
        sourceTarget: { kind: "body", bodyId: ownerBodyId } as DurableRef,
      };
    default:
      return null;
  }
}

export function collectTopologyHistoryInvalidations(
  current: OccTrackedBody,
  historySource: OccTopologyHistorySource,
) {
  const invalidations = new Map<string, OccReferenceInvalidationRecord>();
  const register = (
    target: DurableRef,
    shape: InstanceType<OpenCascadeInstance["TopoDS_Shape"]>,
  ) => {
    const relation = createHistoryTargetForShape(target, current.bodyId);

    if (!relation) {
      return;
    }

    let reason: OccReferenceInvalidationRecord["reason"] =
      OCC_REFERENCE_INVALIDATION_REASONS.missing;

    if (isOccTopologyHistoryDeleted(historySource, shape)) {
      reason = OCC_REFERENCE_INVALIDATION_REASONS.topologyDeleted;
    } else if (
      historySource.Modified(shape).Size() > 0 ||
      historySource.Generated(shape).Size() > 0
    ) {
      reason = OCC_REFERENCE_INVALIDATION_REASONS.topologyModified;
    }

    invalidations.set(getOccDurableRefKey(target), {
      target,
      reason,
      sourceTarget: relation.sourceTarget,
    });
  };

  for (const [faceId, face] of current.facesById.entries()) {
    register({ kind: "face", bodyId: current.bodyId, faceId }, face);
  }

  for (const [edgeId, edge] of current.edgesById.entries()) {
    register({ kind: "edge", bodyId: current.bodyId, edgeId }, edge);
  }

  for (const [vertexId, vertex] of current.verticesById.entries()) {
    register({ kind: "vertex", bodyId: current.bodyId, vertexId }, vertex);
  }

  return invalidations;
}

export function createUnsupportedHistoryInvalidations(body: OccTrackedBody) {
  const invalidations = new Map<string, OccReferenceInvalidationRecord>();
  const sourceTarget = { kind: "body", bodyId: body.bodyId } as DurableRef;
  const register = (target: DurableRef) => {
    invalidations.set(getOccDurableRefKey(target), {
      target,
      reason: OCC_REFERENCE_INVALIDATION_REASONS.topologyUnsupportedHistory,
      sourceTarget,
    });
  };

  for (const faceId of body.facesById.keys()) {
    register({ kind: "face", bodyId: body.bodyId, faceId });
  }

  for (const edgeId of body.edgesById.keys()) {
    register({ kind: "edge", bodyId: body.bodyId, edgeId });
  }

  for (const vertexId of body.verticesById.keys()) {
    register({ kind: "vertex", bodyId: body.bodyId, vertexId });
  }

  return invalidations;
}

/**
 * Marker for a boolean whose result severed its target body into several
 * solids on a code path that has not opted into multi-body replacement. The
 * import seam recognizes it structurally so it can contain the failure to the
 * one offending feature instead of aborting a whole studio.
 */
export const BOOLEAN_SEVERS_TARGET_BODY_NAME = "BooleanSeversTargetBodyError";

export function createBooleanSeversTargetBodyError(
  ownerFeatureId: FeatureId,
  bodyId: BodyId,
  solidCount: number,
) {
  const error = new Error(
    `Feature ${ownerFeatureId} severed body ${bodyId} into ${solidCount} solids; this operation does not support disconnecting results.`,
  );
  error.name = BOOLEAN_SEVERS_TARGET_BODY_NAME;
  return error;
}

export function isBooleanSeversTargetBodyError(error: unknown) {
  return (
    error instanceof Error && error.name === BOOLEAN_SEVERS_TARGET_BODY_NAME
  );
}

export function resolveReplacementBodies(
  context: OccFeatureExecutionContext,
  bodyId: BodyId,
  shape: InstanceType<OpenCascadeInstance["TopoDS_Shape"]>,
  ownerFeatureId: FeatureId,
  options: {
    allowEmpty: boolean;
    historySource?: OccTopologyHistorySource;
    historySources?: readonly OccTopologyHistorySource[];
    /**
     * How to handle a feature that severs its target into several solids.
     * `reject` (the default for callers whose downstream handling of several
     * bodies has not been audited) throws a structured severing error;
     * `freshIdentities` mints one deterministic body per piece and invalidates
     * every reference to the source body, which is what Onshape itself does.
     */
    onSever?: "reject" | "freshIdentities";
  },
) {
  const current = requireSolidBody(context, bodyId, "boolean replacement");
  const solids = extractSolidShapes(context.oc, shape);
  for (const solid of solids) {
    assertValidFeatureResultShape(context, solid, String(ownerFeatureId));
  }
  const historySources =
    options.historySources ??
    (options.historySource ? [options.historySource] : []);
  const invalidationHistorySource =
    options.historySource ??
    historySources.find(
      (historySource) =>
        typeof historySource.IsDeleted === "function" ||
        typeof historySource.IsRemoved === "function",
    );
  let historyInvalidations = invalidationHistorySource
    ? collectTopologyHistoryInvalidations(current, invalidationHistorySource)
    : new Map<string, OccReferenceInvalidationRecord>();

  if (historySources.length === 0) {
    mergeHistoryInvalidations(
      historyInvalidations,
      createUnsupportedHistoryInvalidations(current),
    );
  }

  if (solids.length === 0) {
    if (options.allowEmpty) {
      return {
        replacements: [] as OccTrackedBody[],
        historyInvalidations,
        successorTargetsByPreviousKey: new Map<string, DurableRef>(),
        generatedTargetsBySourceKey: new Map<string, DurableRef>(),
      };
    }

    throw new Error(
      `Feature ${ownerFeatureId} removed every solid while replacing body ${bodyId}; Phase 4 expected one solid result.`,
    );
  }

  if (solids.length !== 1) {
    if (options.onSever !== "freshIdentities") {
      throw createBooleanSeversTargetBodyError(
        ownerFeatureId,
        bodyId,
        solids.length,
      );
    }

    // Severing replacement: the source body no longer exists, so every piece
    // gets a fresh deterministic identity and every reference to the source is
    // invalidated. Pieces are enumerated canonically so a rebuild reproduces
    // the same ids; no piece inherits the source identity.
    const ordered = orderSolidShapesCanonically(context.oc, solids);
    const replacements = ordered.map((solid, index) =>
      trackNewSolidBody(context.oc, {
        bodyId: `body_${ownerFeatureId}_split_${index + 1}` as BodyId,
        label: `${current.label}_${index + 1}`,
        ownerFeatureId,
        shape: solid,
      }),
    );

    // The source body is gone, so its own reference and every face/edge/vertex
    // on it are deleted outright; anything the history only marked as modified
    // is downgraded to ambiguous because no single piece inherits it.
    historyInvalidations =
      markSplitAmbiguousInvalidations(historyInvalidations);
    mergeHistoryInvalidations(
      historyInvalidations,
      createDeletedBodyInvalidations(current),
    );

    return {
      replacements,
      historyInvalidations,
      successorTargetsByPreviousKey: new Map<string, DurableRef>(),
      generatedTargetsBySourceKey: new Map<string, DurableRef>(),
    };
  }

  const replacement =
    historySources.length > 0
      ? reconcileReplacementSolidBody(context.oc, {
          previous: current,
          ownerFeatureId,
          shape: solids[0]!,
          historySources,
        })
      : {
          body: trackReplacementSolidBody(context.oc, {
            previous: current,
            ownerFeatureId,
            shape: solids[0]!,
          }),
          historyInvalidations,
        };

  historyInvalidations = replacement.historyInvalidations;

  return {
    replacements: [replacement.body],
    historyInvalidations,
    successorTargetsByPreviousKey: new Map<string, DurableRef>(),
    generatedTargetsBySourceKey: new Map<string, DurableRef>(),
  };
}

export function assertBooleanScopeCompatible(
  operation: FeatureBooleanOperation,
  booleanScope: FeatureBooleanScope,
) {
  if (operation === "newBody" && booleanScope.kind !== "standalone") {
    throw new Error("Boolean operation newBody requires standalone scope.");
  }

  if (operation !== "newBody" && booleanScope.kind === "standalone") {
    throw new Error(
      `Boolean operation ${operation} requires explicit target bodies.`,
    );
  }
}

export function requireUniqueTargetBodies(targetBodyIds: readonly BodyId[]) {
  const seen = new Set<BodyId>();

  for (const bodyId of targetBodyIds) {
    if (seen.has(bodyId)) {
      throw new Error(
        `Boolean target body ${bodyId} is duplicated in the explicit participant scope.`,
      );
    }

    seen.add(bodyId);
  }
}

/**
 * Result of a surface-producing feature.
 *
 * `resultBodyType: "surface"` payloads carry no operation and no boolean scope,
 * so a sheet result never participates in boolean composition: it is tracked as
 * one new sheet body and existing bodies are untouched.
 */
export function trackSurfaceFeatureResult(
  context: OccFeatureExecutionContext,
  ownerFeatureId: FeatureId,
  featureShape: InstanceType<OpenCascadeInstance["TopoDS_Shape"]>,
  options: { sourceShapes?: OccFeatureSourceShapeMap } = {},
) {
  const newBodies = trackNewBodyResults(
    context,
    ownerFeatureId,
    ownerFeatureId,
    featureShape,
    "sheet",
  );

  return {
    bodies: [...context.bodies, ...newBodies],
    producedTargets: newBodies.map(
      (body) => ({ kind: "body", bodyId: body.bodyId }) as DurableRef,
    ),
    historyInvalidations: new Map<string, OccReferenceInvalidationRecord>(),
    featureSourceTargets: mapFeatureSourceTargets(
      newBodies,
      options.sourceShapes,
    ),
  };
}

export function applyBooleanPolicy(
  context: OccFeatureExecutionContext,
  ownerFeatureId: FeatureId,
  operation: FeatureBooleanOperation,
  booleanScope: FeatureBooleanScope,
  featureShape: InstanceType<OpenCascadeInstance["TopoDS_Shape"]>,
  options: ApplyBooleanPolicyOptions = {},
) {
  assertBooleanScopeCompatible(operation, booleanScope);

  if (operation === "newBody") {
    const newBodies = trackNewBodyResults(
      context,
      ownerFeatureId,
      ownerFeatureId,
      featureShape,
    );
    const bodies = [...context.bodies, ...newBodies];
    return {
      bodies,
      producedTargets: newBodies.map(
        (body) => ({ kind: "body", bodyId: body.bodyId }) as DurableRef,
      ),
      historyInvalidations: new Map<string, OccReferenceInvalidationRecord>(),
      featureSourceTargets: mapFeatureSourceTargets(
        newBodies,
        options.sourceShapes,
      ),
    };
  }

  let targetBodyIds: BodyId[];

  if (booleanScope.kind === "targetBody") {
    targetBodyIds = [booleanScope.bodyId];
  } else if (booleanScope.kind === "targetBodies") {
    targetBodyIds = [...booleanScope.bodyIds];
  } else {
    throw new Error(
      `Boolean operation ${operation} requires explicit target bodies.`,
    );
  }

  if (targetBodyIds.length === 0) {
    throw new Error(
      `Boolean operation ${operation} requires at least one target body.`,
    );
  }

  requireUniqueTargetBodies(targetBodyIds);

  const policy = getMultiBodyBooleanPolicy(operation, booleanScope);
  const nextBodies = [...context.bodies];
  const producedTargets: DurableRef[] = [];

  if (!policy) {
    const bodyId = targetBodyIds[0]!;
    const targetBody = requireSolidBody(
      context,
      bodyId,
      `boolean ${operation}`,
    );
    let projectedSourceShapes = options.sourceShapes;
    let replacementResult = options.sourceShapes
      ? null
      : resolveNativeBooleanReplacement(
          context,
          targetBody,
          featureShape,
          operation,
          ownerFeatureId,
        );

    if (!replacementResult) {
      const result = runBoolean(
        context.oc,
        operation,
        targetBody.shape,
        featureShape,
      );
      projectedSourceShapes = options.sourceShapes
        ? projectFeatureSourceShapes(
            context.oc,
            options.sourceShapes,
            result.historySources,
          )
        : undefined;
      replacementResult = {
        ...resolveReplacementBodies(
          context,
          bodyId,
          result.shape,
          ownerFeatureId,
          {
            allowEmpty: true,
            historySources: result.historySources,
            // A single-target boolean is the disconnecting-cut route: a cut that
            // severs its target replaces it with one body per resulting piece.
            onSever: "freshIdentities",
          },
        ),
        booleanOperandHistory: undefined,
      };
    }

    const index = nextBodies.findIndex((entry) => entry.bodyId === bodyId);
    nextBodies.splice(index, 1, ...replacementResult.replacements);
    for (const replacement of replacementResult.replacements) {
      producedTargets.push({ kind: "body", bodyId: replacement.bodyId });
    }
    return {
      bodies: nextBodies,
      producedTargets,
      historyInvalidations: replacementResult.historyInvalidations,
      successorTargetsByPreviousKey:
        "successorTargetsByPreviousKey" in replacementResult
          ? replacementResult.successorTargetsByPreviousKey
          : new Map<string, DurableRef>(),
      generatedTargetsBySourceKey:
        "generatedTargetsBySourceKey" in replacementResult
          ? replacementResult.generatedTargetsBySourceKey
          : new Map<string, DurableRef>(),
      booleanOperandHistory:
        "booleanOperandHistory" in replacementResult
          ? replacementResult.booleanOperandHistory
          : undefined,
      featureSourceTargets: mergeFeatureSourceTargets(
        mapFeatureSourceTargets(
          replacementResult.replacements,
          projectedSourceShapes,
        ),
        mapInheritedBodyTopologyTargets(
          ownerFeatureId,
          targetBody,
          replacementResult.replacements,
        ),
      ),
    };
  }

  if (policy.application === "sequential") {
    const [firstBodyId, ...restBodyIds] = targetBodyIds;
    const firstBody = requireSolidBody(
      context,
      firstBodyId!,
      `boolean ${policy.operation}`,
    );
    const combinedHistoryInvalidations = new Map<
      string,
      OccReferenceInvalidationRecord
    >();
    let projectedSourceShapes = options.sourceShapes;
    let replacementResult = options.sourceShapes
      ? null
      : resolveNativeBooleanReplacement(
          context,
          firstBody,
          featureShape,
          policy.operation,
          ownerFeatureId,
        );

    if (replacementResult) {
      let currentBody = replacementResult.replacements[0];
      for (const [key, value] of replacementResult.historyInvalidations) {
        combinedHistoryInvalidations.set(key, value);
      }

      for (const bodyId of restBodyIds) {
        if (!currentBody) {
          break;
        }

        const body = requireSolidBody(
          context,
          bodyId,
          `boolean ${policy.operation}`,
        );
        replacementResult = resolveNativeBooleanReplacement(
          context,
          currentBody,
          body.shape,
          policy.operation,
          ownerFeatureId,
        );

        if (!replacementResult) {
          break;
        }

        currentBody = replacementResult.replacements[0];
        for (const [key, value] of replacementResult.historyInvalidations) {
          combinedHistoryInvalidations.set(key, value);
        }
      }
    }

    if (!replacementResult) {
      let currentResult = runBoolean(
        context.oc,
        policy.operation,
        firstBody.shape,
        featureShape,
      );
      const firstBodyHistorySources: OccTopologyHistorySource[] = [
        ...currentResult.historySources,
      ];
      if (projectedSourceShapes) {
        projectedSourceShapes = projectFeatureSourceShapes(
          context.oc,
          projectedSourceShapes,
          currentResult.historySources,
        );
      }
      for (const [key, value] of collectTopologyHistoryInvalidations(
        firstBody,
        currentResult.builder,
      )) {
        combinedHistoryInvalidations.set(key, value);
      }

      for (const bodyId of restBodyIds) {
        const body = requireSolidBody(
          context,
          bodyId,
          `boolean ${policy.operation}`,
        );
        currentResult = runBoolean(
          context.oc,
          policy.operation,
          currentResult.shape,
          body.shape,
        );
        firstBodyHistorySources.push(...currentResult.historySources);
        if (projectedSourceShapes) {
          projectedSourceShapes = projectFeatureSourceShapes(
            context.oc,
            projectedSourceShapes,
            currentResult.historySources,
          );
        }
        for (const [key, value] of collectTopologyHistoryInvalidations(
          body,
          currentResult.builder,
        )) {
          combinedHistoryInvalidations.set(key, value);
        }
      }

      replacementResult = {
        ...resolveReplacementBodies(
          context,
          firstBodyId!,
          currentResult.shape,
          ownerFeatureId,
          {
            allowEmpty: true,
            historySources: firstBodyHistorySources,
          },
        ),
        booleanOperandHistory: undefined,
      };
    }

    const firstIndex = nextBodies.findIndex(
      (entry) => entry.bodyId === firstBodyId,
    );
    nextBodies.splice(firstIndex, 1, ...replacementResult.replacements);

    for (const bodyId of targetBodyIds.slice(1)) {
      const consumedBody = requireSolidBody(
        context,
        bodyId,
        `boolean ${policy.operation}`,
      );
      const index = nextBodies.findIndex((entry) => entry.bodyId === bodyId);
      if (index >= 0) {
        nextBodies.splice(index, 1);
      }
      for (const [key, value] of createDeletedBodyInvalidations(consumedBody)) {
        combinedHistoryInvalidations.set(key, value);
      }
    }

    for (const replacement of replacementResult.replacements) {
      producedTargets.push({ kind: "body", bodyId: replacement.bodyId });
    }
    for (const [key, value] of replacementResult.historyInvalidations) {
      combinedHistoryInvalidations.set(key, value);
    }
    return {
      bodies: nextBodies,
      producedTargets,
      historyInvalidations: combinedHistoryInvalidations,
      featureSourceTargets: mergeFeatureSourceTargets(
        mapFeatureSourceTargets(
          replacementResult.replacements,
          projectedSourceShapes,
        ),
        mapInheritedBodyTopologyTargets(
          ownerFeatureId,
          firstBody,
          replacementResult.replacements,
        ),
      ),
    };
  }

  const combinedHistoryInvalidations = new Map<
    string,
    OccReferenceInvalidationRecord
  >();
  const projectedSourceShapes = new Map<
    string,
    InstanceType<OpenCascadeInstance["TopoDS_Shape"]>[]
  >();
  const replacementBodies: OccTrackedBody[] = [];
  const inheritedSourceTargets = new Map<string, DurableRef[]>();

  for (const bodyId of targetBodyIds) {
    const targetBody = requireSolidBody(
      context,
      bodyId,
      `boolean ${policy.operation}`,
    );
    let targetSourceShapes = options.sourceShapes;
    let replacementResult = options.sourceShapes
      ? null
      : resolveNativeBooleanReplacement(
          context,
          targetBody,
          featureShape,
          policy.operation,
          ownerFeatureId,
        );

    if (!replacementResult) {
      const result = runBoolean(
        context.oc,
        policy.operation,
        targetBody.shape,
        featureShape,
      );
      targetSourceShapes = options.sourceShapes
        ? projectFeatureSourceShapes(
            context.oc,
            options.sourceShapes,
            result.historySources,
          )
        : undefined;
      replacementResult = {
        ...resolveReplacementBodies(
          context,
          bodyId,
          result.shape,
          ownerFeatureId,
          {
            allowEmpty: true,
            historySources: result.historySources,
          },
        ),
        booleanOperandHistory: undefined,
      };
    }

    if (targetSourceShapes) {
      mergeFeatureSourceShapes(projectedSourceShapes, targetSourceShapes);
    }
    replacementBodies.push(...replacementResult.replacements);
    for (const [sourceKey, targets] of mapInheritedBodyTopologyTargets(
      ownerFeatureId,
      targetBody,
      replacementResult.replacements,
    )) {
      inheritedSourceTargets.set(sourceKey, targets);
    }
    const index = nextBodies.findIndex((entry) => entry.bodyId === bodyId);
    nextBodies.splice(index, 1, ...replacementResult.replacements);
    for (const replacement of replacementResult.replacements) {
      producedTargets.push({ kind: "body", bodyId: replacement.bodyId });
    }
    for (const [key, value] of replacementResult.historyInvalidations) {
      combinedHistoryInvalidations.set(key, value);
    }
  }

  return {
    bodies: nextBodies,
    producedTargets,
    historyInvalidations: combinedHistoryInvalidations,
    featureSourceTargets: mergeFeatureSourceTargets(
      mapFeatureSourceTargets(
        replacementBodies,
        options.sourceShapes ? projectedSourceShapes : undefined,
      ),
      inheritedSourceTargets,
    ),
  };
}

export function createDeletedBodyInvalidations(body: OccTrackedBody) {
  const invalidations = new Map<string, OccReferenceInvalidationRecord>();
  const register = (target: DurableRef, sourceTarget: DurableRef | null) => {
    invalidations.set(getOccDurableRefKey(target), {
      target,
      reason: OCC_REFERENCE_INVALIDATION_REASONS.topologyDeleted,
      sourceTarget,
    });
  };

  register({ kind: "body", bodyId: body.bodyId }, null);

  for (const faceId of body.facesById.keys()) {
    register(
      { kind: "face", bodyId: body.bodyId, faceId },
      { kind: "body", bodyId: body.bodyId },
    );
  }
  for (const edgeId of body.edgesById.keys()) {
    register(
      { kind: "edge", bodyId: body.bodyId, edgeId },
      { kind: "body", bodyId: body.bodyId },
    );
  }
  for (const vertexId of body.verticesById.keys()) {
    register(
      { kind: "vertex", bodyId: body.bodyId, vertexId },
      { kind: "body", bodyId: body.bodyId },
    );
  }

  return invalidations;
}

export function trackBodiesFromShape(
  context: OccFeatureExecutionContext,
  ownerFeatureId: FeatureId,
  label: string,
  shape: InstanceType<OpenCascadeInstance["TopoDS_Shape"]>,
  suffix: string,
) {
  const solids = extractSolidShapes(context.oc, shape);

  if (solids.length === 0) {
    throw new Error(
      `advanced-feature-unsupported-kernel-case: ${label} for ${ownerFeatureId} produced no solid result bodies.`,
    );
  }

  return solids.map((solid, index) =>
    trackNewSolidBody(context.oc, {
      bodyId:
        `body_${ownerFeatureId}_${suffix}${solids.length === 1 ? "" : `_${index + 1}`}` as BodyId,
      label: `${ownerFeatureId}_${suffix}${solids.length === 1 ? "" : `_${index + 1}`}`,
      ownerFeatureId,
      shape: solid,
    }),
  );
}

export function mergeHistoryInvalidations(
  target: Map<string, OccReferenceInvalidationRecord>,
  source: Map<string, OccReferenceInvalidationRecord>,
) {
  for (const [key, value] of source) {
    target.set(key, value);
  }
}

export function markSplitAmbiguousInvalidations(
  source: Map<string, OccReferenceInvalidationRecord>,
) {
  const ambiguous = new Map<string, OccReferenceInvalidationRecord>();

  for (const [key, value] of source) {
    ambiguous.set(key, {
      ...value,
      reason:
        value.reason === OCC_REFERENCE_INVALIDATION_REASONS.topologyModified
          ? OCC_REFERENCE_INVALIDATION_REASONS.topologyAmbiguous
          : value.reason,
    });
  }

  return ambiguous;
}
