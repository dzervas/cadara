import type { AdvancedSolidFeatureDefinition } from "@/contracts/modeling/advanced-solid";
import type { ConstructionId, FeatureId } from "@/contracts/shared/ids";
import type { DurableRef } from "@/contracts/shared/references";
import type { SketchPlaneDefinition } from "@/contracts/shared/sketch-plane";
import {
  getAdvancedParticipant,
  getTransformOperationKind,
} from "@/contracts/modeling/advanced-solid";
import { getAuthoredLiteralValue } from "@/contracts/modeling/authored-values";
import type { MaybeAuthoredValue } from "@/contracts/modeling/authored-values";
import {
  normalize,
  scale,
  toGpDir,
  toGpPnt,
  toGpVec,
  toVec3FromGpPoint,
  type Vec3,
} from "@/domain/modeling/occ/geometry";
import {
  buildAxisFromLineEdge,
  buildConstructionPlaneFromPlanarFace,
} from "@/domain/modeling/occ/sketch-profile";
import { buildAxisFromSketchLine } from "@/domain/modeling/occ/features/revolve";
import type {
  OccReferenceInvalidationRecord,
  OccTrackedBody,
} from "@/domain/modeling/occ/topology";
import {
  advanceTopologyToken,
  buildNativeTopologyIdAliasesForTrackedBody,
  getOccDurableRefKey,
} from "@/domain/modeling/occ/topology";
import { deleteOccObject } from "@/domain/modeling/occ/memory";
import {
  requireBody,
  requireSolidBody,
  requireEdge,
  requireFace,
  requireConstructionPlaneDefinition,
  type OccFeatureExecutionContext,
  type OccFeatureExecutionResult,
} from "@/domain/modeling/occ/features/shared";
import {
  applyBooleanPolicy,
  resolveNativeFeatureTransactionReplacement,
  resolveReplacementBodies,
  requireUniqueTargetBodies,
  trackBodiesFromShape,
  validateNativeFeatureTransaction,
  type OccResolvedNativeBooleanOperandHistory,
} from "@/domain/modeling/occ/features/boolean-operations";
import {
  parseNativeShimPayloadJson,
  type OpenCascadeNativeFeatureTransactionResult,
  type OpenCascadeNativeTopologyKernelHost,
} from "@/domain/modeling/occ/native-topology-payload";
import {
  createExactSuccessorTopologyStage,
  createUnsupportedProducerTopologyStage,
  formatMirrorOperandTopologySourceKey,
  isOccTopologyProvenanceResolutionError,
  type OccFeatureTopologyStage,
} from "@/domain/modeling/occ/topology-stage";

export function resolvePlanarReferencePlane(
  context: OccFeatureExecutionContext,
  target: DurableRef,
  supportConstructionId: ConstructionId,
) {
  if (target.kind === "construction") {
    const plane = requireConstructionPlaneDefinition(
      context,
      target.constructionId,
    );
    return {
      support: {
        kind: "construction" as const,
        constructionId: supportConstructionId,
      },
      frame: plane.frame,
      key: null,
    } satisfies SketchPlaneDefinition;
  }

  if (target.kind === "face") {
    return buildConstructionPlaneFromPlanarFace(
      context.oc,
      requireFace(context, requireBody(context, target.bodyId), target.faceId),
      target.faceId,
      { kind: "construction", constructionId: supportConstructionId },
    );
  }

  throw new Error(
    "advanced-feature-unsupported-kernel-case: OCC transform-family references must be planar face or construction targets.",
  );
}

export function resolvePlanarReferenceNormal(
  context: OccFeatureExecutionContext,
  ownerFeatureId: FeatureId,
  target: DurableRef,
  supportSuffix: string,
): Vec3 {
  const plane = resolvePlanarReferencePlane(
    context,
    target,
    `construction_${ownerFeatureId}_${supportSuffix}` as ConstructionId,
  );
  return normalize(plane.frame.normal);
}

export function resolveLinearDirectionReference(
  context: OccFeatureExecutionContext,
  ownerFeatureId: FeatureId,
  target: DurableRef,
  supportSuffix: string,
): Vec3 {
  if (target.kind === "construction" || target.kind === "face") {
    return resolvePlanarReferenceNormal(
      context,
      ownerFeatureId,
      target,
      supportSuffix,
    );
  }

  if (target.kind === "edge") {
    const axis = buildAxisFromLineEdge(
      context.oc,
      requireEdge(context, requireBody(context, target.bodyId), target.edgeId),
    );
    try {
      return normalize(toVec3FromGpPoint(axis.Direction()));
    } finally {
      deleteOccObject(axis);
    }
  }

  if (target.kind === "sketchEntity") {
    const axis = buildAxisFromSketchLine(
      context,
      target.sketchId,
      target.entityId,
    );
    try {
      return normalize(toVec3FromGpPoint(axis.Direction()));
    } finally {
      deleteOccObject(axis);
    }
  }

  throw new Error(
    "advanced-feature-unsupported-kernel-case: OCC direction references must be planar construction/face, linear edge, or sketch line targets.",
  );
}

export function buildCircularAxisReference(
  context: OccFeatureExecutionContext,
  ownerFeatureId: FeatureId,
  target: DurableRef,
  supportSuffix: string,
) {
  if (target.kind === "edge") {
    return buildAxisFromLineEdge(
      context.oc,
      requireEdge(context, requireBody(context, target.bodyId), target.edgeId),
    );
  }

  if (target.kind === "sketchEntity") {
    return buildAxisFromSketchLine(context, target.sketchId, target.entityId);
  }

  const plane = resolvePlanarReferencePlane(
    context,
    target,
    `construction_${ownerFeatureId}_${supportSuffix}` as ConstructionId,
  );
  return new context.oc.gp_Ax1_2(
    toGpPnt(context.oc, plane.frame.origin),
    toGpDir(context.oc, plane.frame.normal),
  );
}

function buildMirrorAxisPlane(
  context: OccFeatureExecutionContext,
  plane: SketchPlaneDefinition,
) {
  return new context.oc.gp_Ax2_2(
    toGpPnt(context.oc, plane.frame.origin),
    toGpDir(context.oc, plane.frame.normal),
    toGpDir(context.oc, plane.frame.xAxis),
  );
}

function buildNativeTransformTransaction(
  context: OccFeatureExecutionContext,
  body: OccTrackedBody,
  transform: InstanceType<OccFeatureExecutionContext["oc"]["gp_Trsf_1"]>,
  operation: string,
): OpenCascadeNativeFeatureTransactionResult | null {
  const nativeHost =
    context.oc as unknown as OpenCascadeNativeTopologyKernelHost;
  const nativeBuilder =
    nativeHost.CadaraExecuteNativeFeatureTransaction
      ?.BuildTransformCommittedShapeTransactionWithHistory;

  if (!nativeBuilder) {
    return null;
  }

  const transaction = nativeBuilder(
    body.shape,
    transform,
    true,
    body.bodyId,
    body.topologyToken,
    advanceTopologyToken(body.topologyToken),
    context.modelingTolerance,
    0.5,
  );

  validateNativeFeatureTransaction(transaction, operation);

  return transaction;
}

function getMirrorBodyTargets(
  definition: AdvancedSolidFeatureDefinition & { kind: "mirror" },
) {
  const targets = getAdvancedParticipant(definition, "body")?.targets ?? [];

  if (targets.length === 0) {
    throw new Error(
      "advanced-feature-unsupported-kernel-case: OCC mirror requires at least one body participant.",
    );
  }

  for (const target of targets) {
    if (target.kind !== "body") {
      throw new Error(
        "advanced-feature-unsupported-kernel-case: OCC mirror body participants must be durable body targets.",
      );
    }
  }

  return targets as readonly Extract<DurableRef, { kind: "body" }>[];
}

function getMirrorPlaneTarget(
  definition: AdvancedSolidFeatureDefinition & { kind: "mirror" },
) {
  const targets = getAdvancedParticipant(definition, "plane")?.targets ?? [];

  if (targets.length !== 1) {
    throw new Error(
      "advanced-feature-unsupported-kernel-case: OCC mirror requires exactly one plane participant.",
    );
  }

  const [planeTarget] = targets;
  if (
    !planeTarget ||
    (planeTarget.kind !== "construction" && planeTarget.kind !== "face")
  ) {
    throw new Error(
      "advanced-feature-unsupported-kernel-case: OCC mirror plane participants must be planar face or construction targets.",
    );
  }

  return planeTarget;
}

function getMirrorCopyOption(
  definition: AdvancedSolidFeatureDefinition & { kind: "mirror" },
) {
  if (definition.parameters.options?.copy !== true) {
    throw new Error(
      "advanced-feature-unsupported-kernel-case: OCC mirror currently supports copy=true only.",
    );
  }

  return true;
}

function getMirrorOperation(
  definition: AdvancedSolidFeatureDefinition & { kind: "mirror" },
) {
  const operationIntent =
    definition.parameters.operationIntent === undefined
      ? undefined
      : getAuthoredLiteralValue(definition.parameters.operationIntent);
  if (operationIntent === undefined) return "newBody" as const;
  if (operationIntent === "add") return "add" as const;
  throw new Error(
    "advanced-feature-unsupported-kernel-case: OCC mirror supports only add operation intent.",
  );
}

function getMirrorAddTarget(
  definition: AdvancedSolidFeatureDefinition & { kind: "mirror" },
) {
  const targets =
    getAdvancedParticipant(definition, "targetBody")?.targets ?? [];
  if (targets.length !== 1 || targets[0]?.kind !== "body") {
    throw new Error(
      "advanced-feature-unsupported-kernel-case: OCC mirror add requires exactly one body target.",
    );
  }
  return targets[0];
}

type MirrorAddSubtopologyRef = Extract<
  DurableRef,
  { kind: "face" | "edge" | "vertex" }
>;

function mirrorAddSourceTargets(
  body: OccTrackedBody,
): MirrorAddSubtopologyRef[] {
  return [
    ...body.topology.faceIds.map(
      (faceId): MirrorAddSubtopologyRef => ({
        kind: "face",
        bodyId: body.bodyId,
        faceId,
      }),
    ),
    ...body.topology.edgeIds.map(
      (edgeId): MirrorAddSubtopologyRef => ({
        kind: "edge",
        bodyId: body.bodyId,
        edgeId,
      }),
    ),
    ...body.topology.vertexIds.map(
      (vertexId): MirrorAddSubtopologyRef => ({
        kind: "vertex",
        bodyId: body.bodyId,
        vertexId,
      }),
    ),
  ];
}

function isLiveMirrorAddTarget(
  body: OccTrackedBody,
  source: MirrorAddSubtopologyRef,
  target: DurableRef,
): target is MirrorAddSubtopologyRef {
  if (target.kind !== source.kind || target.bodyId !== body.bodyId) {
    return false;
  }
  if (target.kind === "face") return body.facesById.has(target.faceId);
  if (target.kind === "edge") return body.edgesById.has(target.edgeId);
  return body.verticesById.has(target.vertexId);
}

function collectMirrorAddSuccessors(input: {
  ownerFeatureId: FeatureId;
  sourceBody: OccTrackedBody;
  outputBody: OccTrackedBody;
  nativeSuccessors: ReadonlyMap<string, DurableRef>;
  featureSourceTargets: ReadonlyMap<string, readonly DurableRef[]> | undefined;
}) {
  const successors = new Map(input.nativeSuccessors);
  for (const source of mirrorAddSourceTargets(input.sourceBody)) {
    const sourceKey = getOccDurableRefKey(source);
    if (successors.has(sourceKey)) continue;
    const targets =
      input.featureSourceTargets?.get(
        `boolean:${input.ownerFeatureId}:input:${sourceKey}`,
      ) ?? [];
    const exactTargets = targets.filter((target) =>
      isLiveMirrorAddTarget(input.outputBody, source, target),
    );
    if (exactTargets.length === 1) {
      successors.set(sourceKey, exactTargets[0]!);
    }
  }
  return successors;
}

function collectMirrorAddGeneratedTargets(input: {
  outputBody: OccTrackedBody;
  nativeGeneratedTargets: ReadonlyMap<string, DurableRef>;
}) {
  const generated = new Map<string, DurableRef>();
  for (const [sourceKey, target] of input.nativeGeneratedTargets) {
    if (
      (target.kind === "face" ||
        target.kind === "edge" ||
        target.kind === "vertex") &&
      isLiveMirrorAddTarget(input.outputBody, target, target)
    ) {
      generated.set(sourceKey, target);
    }
  }
  return generated;
}

function collectMirrorAddOperandProducerTargets(input: {
  context: OccFeatureExecutionContext;
  ownerFeatureId: FeatureId;
  sourceBody: OccTrackedBody;
  transform: InstanceType<OccFeatureExecutionContext["oc"]["BRepBuilderAPI_Transform_2"]>;
  transformedShape: InstanceType<OccFeatureExecutionContext["oc"]["TopoDS_Shape"]>;
  history: OccResolvedNativeBooleanOperandHistory | undefined;
}) {
  if (!input.history || input.history.operation !== "join") {
    return new Map<string, DurableRef>();
  }
  const nativeHost = input.context.oc as unknown as OpenCascadeNativeTopologyKernelHost;
  const payloadJson = nativeHost.CadaraBuildNativeTopologyPayload?.BuildJson?.(
    input.transformedShape,
    input.sourceBody.bodyId,
    input.sourceBody.topologyToken,
    input.context.modelingTolerance,
    0.5,
  );
  if (typeof payloadJson !== "string") return new Map<string, DurableRef>();

  const payload = parseNativeShimPayloadJson(payloadJson);
  const records = payload.topology.filter(
    (record) => record.kind === "face" && record.bodyId === input.sourceBody.bodyId,
  );
  const faceMap = new input.context.oc.TopTools_IndexedMapOfShape_1();
  input.context.oc.TopExp.MapShapes_1(
    input.transformedShape,
    input.context.oc.TopAbs_ShapeEnum.TopAbs_FACE as never,
    faceMap,
  );
  const transformedFacesByNativeId = new Map<
    string,
    InstanceType<OccFeatureExecutionContext["oc"]["TopoDS_Face"]>
  >();
  try {
    if (records.length !== faceMap.Size()) return new Map<string, DurableRef>();
    for (const record of records) {
      if (
        record.index < 1 ||
        record.index > faceMap.Size() ||
        transformedFacesByNativeId.has(record.id)
      ) {
        return new Map<string, DurableRef>();
      }
      transformedFacesByNativeId.set(
        record.id,
        input.context.oc.TopoDS.Face_1(faceMap.FindKey(record.index)),
      );
    }
    const sourceAliases =
      input.sourceBody.nativeTopologyIdAliases?.faceIdsByNativeId ??
      (() => {
        const sourcePayloadJson =
          nativeHost.CadaraBuildNativeTopologyPayload?.BuildJson?.(
            input.sourceBody.shape,
            input.sourceBody.bodyId,
            input.sourceBody.topologyToken,
            input.context.modelingTolerance,
            0.5,
          );
        // A missing source-alias ABI yields no operand claims; downstream
        // consumers receive honest invalidations instead of fabricated ones.
        if (typeof sourcePayloadJson !== "string") return null;
        return buildNativeTopologyIdAliasesForTrackedBody(
          input.context.oc,
          input.sourceBody,
          parseNativeShimPayloadJson(sourcePayloadJson),
        ).faceIdsByNativeId;
      })();
    if (!sourceAliases) return new Map<string, DurableRef>();
    const canonicalBySourceNativeId = new Map<string, string>();
    const sourceNativeIdsByPublicId = new Map<string, string[]>();
    for (const [nativeFaceId, publicFaceId] of sourceAliases) {
      if (!input.sourceBody.facesById.has(publicFaceId)) continue;
      sourceNativeIdsByPublicId.set(publicFaceId, [
        ...(sourceNativeIdsByPublicId.get(publicFaceId) ?? []),
        nativeFaceId,
      ]);
      try {
        canonicalBySourceNativeId.set(
          nativeFaceId,
          input.context.topologyProvenanceIndex.resolveFace({
            kind: "face",
            bodyId: input.sourceBody.bodyId,
            faceId: publicFaceId,
          }),
        );
      } catch (error) {
        // A face whose lineage does not resolve (missing, remintable root,
        // ambiguous, cyclic, or future-stage) cannot contribute a right/mixed
        // producer, but it must not erase independently exact operand
        // incidences. Non-provenance errors are genuine faults and propagate.
        if (!isOccTopologyProvenanceResolutionError(error)) throw error;
      }
    }
    if (
      input.sourceBody.topology.faceIds.length === 0 ||
      input.sourceBody.topology.faceIds.some(
        (faceId) => (sourceNativeIdsByPublicId.get(faceId)?.length ?? 0) !== 1,
      )
    ) {
      return new Map<string, DurableRef>();
    }
    const canonicalByTransformedNativeId = new Map<string, string>();
    for (const sourceFaceId of input.sourceBody.topology.faceIds) {
      const sourceFace = input.sourceBody.facesById.get(sourceFaceId);
      const sourceNativeId = sourceNativeIdsByPublicId.get(sourceFaceId)?.[0];
      if (!sourceFace || !sourceNativeId) return new Map<string, DurableRef>();
      const transformed = input.transform.ModifiedShape(sourceFace);
      try {
        const matches = [...transformedFacesByNativeId].filter(([, candidate]) =>
          candidate.IsSame(transformed),
        );
        if (matches.length !== 1) continue;
        const [transformedNativeId] = matches[0]!;
        const canonical = canonicalBySourceNativeId.get(sourceNativeId);
        if (!canonical) continue;
        if (canonicalByTransformedNativeId.has(transformedNativeId)) continue;
        canonicalByTransformedNativeId.set(transformedNativeId, canonical);
      } finally {
        deleteOccObject(transformed);
      }
    }
    const candidatesBySourceKey = new Map<string, DurableRef[]>();
    for (const finalFace of input.history.finalFaces) {
      const hasRight = finalFace.rightSourceFaceNativeIds.length > 0;
      if (!hasRight) continue;
      const left = finalFace.leftSourceFaceNativeIds.map((id) =>
        canonicalBySourceNativeId.get(id),
      );
      const right = finalFace.rightSourceFaceNativeIds.map((id) =>
        canonicalByTransformedNativeId.get(id),
      );
      if (left.some((value) => !value) || right.some((value) => !value)) {
        continue;
      }
      const sourceCanonicalProvenanceIds = [...new Set([...left, ...right])] as string[];
      if (sourceCanonicalProvenanceIds.length === 0) continue;
      const sourceKey = formatMirrorOperandTopologySourceKey({
        featureId: input.ownerFeatureId,
        bodyId: input.sourceBody.bodyId,
        role: left.length > 0 ? "mixed" : "right",
        sourceCanonicalProvenanceIds,
      });
      candidatesBySourceKey.set(sourceKey, [
        ...(candidatesBySourceKey.get(sourceKey) ?? []),
        finalFace.finalFace,
      ]);
    }
    const claims = new Map<string, DurableRef>();
    for (const [sourceKey, candidates] of candidatesBySourceKey) {
      const uniqueTargets = new Map(
        candidates.map((target) => [getOccDurableRefKey(target), target]),
      );
      // Zero, many, or missing exact relations never receive a fabricated claim.
      if (uniqueTargets.size === 1) {
        claims.set(sourceKey, uniqueTargets.values().next().value!);
      }
    }
    return claims;
  } finally {
    for (const face of transformedFacesByNativeId.values()) deleteOccObject(face);
    deleteOccObject(faceMap);
  }
}

export function executeMirrorFeature(
  context: OccFeatureExecutionContext,
  ownerFeatureId: FeatureId,
  definition: AdvancedSolidFeatureDefinition & { kind: "mirror" },
): OccFeatureExecutionResult {
  getMirrorCopyOption(definition);
  const operation = getMirrorOperation(definition);
  const bodyTargets = getMirrorBodyTargets(definition);
  requireUniqueTargetBodies(bodyTargets.map((target) => target.bodyId));
  const planeTarget = getMirrorPlaneTarget(definition);
  const plane = resolvePlanarReferencePlane(
    context,
    planeTarget,
    `construction_${ownerFeatureId}_mirror` as ConstructionId,
  );
  const mirror = new context.oc.gp_Trsf_1();
  mirror.SetMirror_3(buildMirrorAxisPlane(context, plane));

  if (operation === "add") {
    const target = getMirrorAddTarget(definition);
    if (bodyTargets.length !== 1 || bodyTargets[0]?.bodyId !== target.bodyId) {
      throw new Error(
        "advanced-feature-unsupported-kernel-case: OCC mirror add requires one source body identical to its target.",
      );
    }
    const sourceBody = requireSolidBody(context, target.bodyId, "mirror");
    const transform = new context.oc.BRepBuilderAPI_Transform_2(
      sourceBody.shape,
      mirror,
      true,
    );
    const progress = new context.oc.Message_ProgressRange_1();
    let transformedShape:
      | InstanceType<OccFeatureExecutionContext["oc"]["TopoDS_Shape"]>
      | undefined;
    try {
      transform.Build(progress);
      if (!transform.IsDone()) {
        throw new Error(
          "advanced-feature-unsupported-kernel-case: OCC mirror add transform build failed.",
        );
      }
      transformedShape = transform.Shape();
      const joined = applyBooleanPolicy(
        context,
        ownerFeatureId,
        "join",
        { kind: "targetBody", bodyId: target.bodyId },
        transformedShape,
      );
      const outputBodies = joined.bodies.filter(
        (body) => body.bodyId === sourceBody.bodyId,
      );
      if (outputBodies.length !== 1) {
        throw new Error(
          "advanced-feature-unsupported-kernel-case: OCC mirror add did not retain exactly one target body output.",
        );
      }
      const outputBody = outputBodies[0]!;
      const nativeSuccessors =
        ("successorTargetsByPreviousKey" in joined
          ? joined.successorTargetsByPreviousKey
          : undefined) ?? new Map<string, DurableRef>();
      const nativeGeneratedTargets =
        ("generatedTargetsBySourceKey" in joined
          ? joined.generatedTargetsBySourceKey
          : undefined) ?? new Map<string, DurableRef>();
      const booleanOperandHistory =
        ("booleanOperandHistory" in joined
          ? joined.booleanOperandHistory
          : undefined) as OccResolvedNativeBooleanOperandHistory | undefined;
      return {
        bodies: joined.bodies,
        constructions: [...context.constructions],
        constructionPlanes: new Map(context.constructionPlanes),
        producedTargets: joined.producedTargets,
        entities: [],
        renderRecords: [],
        historyInvalidations: joined.historyInvalidations,
        topologyStage: (() => {
          const supplementalProducerTargetsBySourceKey =
            collectMirrorAddOperandProducerTargets({
              context,
              ownerFeatureId,
              sourceBody,
              transform,
              transformedShape,
              history: booleanOperandHistory,
            });
          const topologyStage = createExactSuccessorTopologyStage({
            featureId: ownerFeatureId,
            sourceBody,
            outputBody,
            successorsBySourceKey: collectMirrorAddSuccessors({
              ownerFeatureId,
              sourceBody,
              outputBody,
              nativeSuccessors,
              featureSourceTargets: joined.featureSourceTargets,
            }),
            generatedTargetsBySourceKey: collectMirrorAddGeneratedTargets({
              outputBody,
              nativeGeneratedTargets,
            }),
            supplementalProducerTargetsBySourceKey,
          });
          return topologyStage;
        })(),
      };
    } finally {
      deleteOccObject(transformedShape);
      deleteOccObject(progress);
      deleteOccObject(transform);
      deleteOccObject(mirror);
  }
  }

  const mirroredBodies: OccTrackedBody[] = [];
  for (const [index, bodyTarget] of bodyTargets.entries()) {
    const body = requireSolidBody(context, bodyTarget.bodyId, "mirror");
    const transformedShape = (() => {
      const nativeTransaction = buildNativeTransformTransaction(
        context,
        body,
        mirror,
        "mirror",
      );
      if (nativeTransaction) {
        return nativeTransaction.Shape() as InstanceType<
          OccFeatureExecutionContext["oc"]["TopoDS_Shape"]
        >;
      }

      const transform = new context.oc.BRepBuilderAPI_Transform_2(
        body.shape,
        mirror,
        true,
      );
      transform.Build(new context.oc.Message_ProgressRange_1());

      if (!transform.IsDone()) {
        throw new Error(
          "advanced-feature-unsupported-kernel-case: OCC mirror transform build failed.",
        );
      }

      return transform.Shape();
    })();

    mirroredBodies.push(
      ...trackBodiesFromShape(
        context,
        ownerFeatureId,
        "Mirror result",
        transformedShape,
        `mirror_${index + 1}`,
      ),
    );
  }

  return {
    bodies: [...context.bodies, ...mirroredBodies],
    constructions: [...context.constructions],
    constructionPlanes: new Map(context.constructionPlanes),
    producedTargets: mirroredBodies.map((body) => ({
      kind: "body" as const,
      bodyId: body.bodyId,
    })),
    entities: [],
    renderRecords: [],
    historyInvalidations: new Map<string, OccReferenceInvalidationRecord>(),
    topologyStage: createUnsupportedProducerTopologyStage({
      featureId: ownerFeatureId,
      bodies: mirroredBodies,
      producedTargets: mirroredBodies.map((body) => ({
        kind: "body" as const,
        bodyId: body.bodyId,
      })),
    }),
  };
}

function getTransformBodyTargets(
  definition: AdvancedSolidFeatureDefinition & { kind: "transform" },
) {
  const targets = getAdvancedParticipant(definition, "body")?.targets ?? [];

  if (targets.length === 0) {
    throw new Error(
      "advanced-feature-unsupported-kernel-case: OCC transform requires at least one body participant.",
    );
  }

  for (const target of targets) {
    if (target.kind !== "body") {
      throw new Error(
        "advanced-feature-unsupported-kernel-case: OCC transform body participants must be durable body targets.",
      );
    }
  }

  return targets as readonly Extract<DurableRef, { kind: "body" }>[];
}

function getTransformReferenceTarget(
  definition: AdvancedSolidFeatureDefinition & { kind: "transform" },
) {
  const targets =
    getAdvancedParticipant(definition, "transformReference")?.targets ?? [];

  if (targets.length !== 1) {
    throw new Error(
      "advanced-feature-unsupported-kernel-case: OCC transform requires exactly one transformReference participant.",
    );
  }

  const [referenceTarget] = targets;
  if (
    !referenceTarget ||
    (referenceTarget.kind !== "construction" && referenceTarget.kind !== "face")
  ) {
    throw new Error(
      "advanced-feature-unsupported-kernel-case: OCC transform references must be planar face or construction targets.",
    );
  }

  return referenceTarget;
}

function getTransformDistance(
  definition: AdvancedSolidFeatureDefinition & { kind: "transform" },
) {
  const distance = definition.parameters.options?.distance;

  if (
    typeof distance !== "number" ||
    !Number.isFinite(distance) ||
    distance <= 0
  ) {
    throw new Error(
      "advanced-feature-unsupported-kernel-case: OCC transform requires a positive distance option.",
    );
  }

  return distance;
}

function getTransformDirection(
  definition: AdvancedSolidFeatureDefinition & { kind: "transform" },
) {
  const direction = definition.parameters.options?.direction;

  if (direction === undefined || direction === "positive") {
    return "positive";
  }

  if (direction === "negative") {
    return "negative";
  }

  throw new Error(
    "advanced-feature-unsupported-kernel-case: OCC transform direction must be positive or negative.",
  );
}

function getTransformVector(
  definition: AdvancedSolidFeatureDefinition & { kind: "transform" },
): [number, number, number] | null {
  const vector = definition.parameters.options?.vector;
  return Array.isArray(vector) &&
    vector.length === 3 &&
    vector.every(
      (component) =>
        typeof component === "number" && Number.isFinite(component),
    ) &&
    vector.some((component) => component !== 0)
    ? [vector[0] as number, vector[1] as number, vector[2] as number]
    : null;
}

function getTransformAxisTarget(
  definition: AdvancedSolidFeatureDefinition & { kind: "transform" },
) {
  const targets = getAdvancedParticipant(definition, "axis")?.targets ?? [];

  if (targets.length !== 1) {
    throw new Error(
      "advanced-feature-unsupported-kernel-case: OCC transform rotation requires exactly one axis participant.",
    );
  }

  const [axisTarget] = targets;
  if (
    !axisTarget ||
    (axisTarget.kind !== "construction" &&
      axisTarget.kind !== "face" &&
      axisTarget.kind !== "edge" &&
      axisTarget.kind !== "sketchEntity")
  ) {
    throw new Error(
      "advanced-feature-unsupported-kernel-case: OCC transform rotation axis must be a construction, planar face, linear edge, or sketch line target.",
    );
  }

  return axisTarget;
}

function getTransformAngleRadians(
  definition: AdvancedSolidFeatureDefinition & { kind: "transform" },
) {
  const raw = definition.parameters.options?.angle;
  const degrees =
    typeof raw === "number"
      ? raw
      : getAuthoredLiteralValue(raw as MaybeAuthoredValue<unknown>);

  if (
    typeof degrees !== "number" ||
    !Number.isFinite(degrees) ||
    degrees === 0
  ) {
    throw new Error(
      "advanced-feature-unsupported-kernel-case: OCC transform rotation requires a non-zero angle in degrees.",
    );
  }

  return (degrees * Math.PI) / 180;
}

function buildRotationAxis(
  context: OccFeatureExecutionContext,
  ownerFeatureId: FeatureId,
  target: DurableRef,
) {
  return buildCircularAxisReference(
    context,
    ownerFeatureId,
    target,
    "transform_axis",
  );
}

function buildTransformTranslation(
  context: OccFeatureExecutionContext,
  ownerFeatureId: FeatureId,
  definition: AdvancedSolidFeatureDefinition & { kind: "transform" },
) {
  const vector = getTransformVector(definition);
  let translationVector: readonly [number, number, number];
  if (vector) {
    translationVector = vector;
  } else {
    const referenceTarget = getTransformReferenceTarget(definition);
    const distance = getTransformDistance(definition);
    const direction = getTransformDirection(definition);
    const plane = resolvePlanarReferencePlane(
      context,
      referenceTarget,
      `construction_${ownerFeatureId}_transform` as ConstructionId,
    );
    const signedDistance = direction === "positive" ? distance : -distance;
    translationVector = scale(normalize(plane.frame.normal), signedDistance);
  }
  const translation = new context.oc.gp_Trsf_1();
  translation.SetTranslation_1(toGpVec(context.oc, translationVector));
  return translation;
}

function buildTransformRotation(
  context: OccFeatureExecutionContext,
  ownerFeatureId: FeatureId,
  definition: AdvancedSolidFeatureDefinition & { kind: "transform" },
) {
  const axis = buildRotationAxis(
    context,
    ownerFeatureId,
    getTransformAxisTarget(definition),
  );
  const angle = getTransformAngleRadians(definition);
  const rotation = new context.oc.gp_Trsf_1();
  rotation.SetRotation_1(axis, angle);
  return rotation;
}

export function executeTransformFeature(
  context: OccFeatureExecutionContext,
  ownerFeatureId: FeatureId,
  definition: AdvancedSolidFeatureDefinition & { kind: "transform" },
): OccFeatureExecutionResult {
  if (definition.parameters.operationIntent !== undefined) {
    throw new Error(
      "advanced-feature-unsupported-kernel-case: OCC transform does not support operation intents.",
    );
  }

  const bodyTargets = getTransformBodyTargets(definition);
  requireUniqueTargetBodies(bodyTargets.map((target) => target.bodyId));
  const transform =
    getTransformOperationKind(definition) === "rotation"
      ? buildTransformRotation(context, ownerFeatureId, definition)
      : buildTransformTranslation(context, ownerFeatureId, definition);

  const nextBodies = [...context.bodies];
  const historyInvalidations = new Map<
    string,
    OccReferenceInvalidationRecord
  >();
  const producedTargets: DurableRef[] = [];

  const topologyStages: OccFeatureTopologyStage[] = [];
  for (const bodyTarget of bodyTargets) {
    const body = requireSolidBody(context, bodyTarget.bodyId, "transform");
    const nativeTransaction = buildNativeTransformTransaction(
      context,
      body,
      transform,
      "transform",
    );
    const nativeReplacementResult = nativeTransaction
      ? resolveNativeFeatureTransactionReplacement(
          context,
          body,
          nativeTransaction,
          "transform",
          ownerFeatureId,
        )
      : null;
    const replacementResult =
      nativeReplacementResult ??
      (() => {
        const builder = new context.oc.BRepBuilderAPI_Transform_2(
          body.shape,
          transform,
          true,
        );
        builder.Build(new context.oc.Message_ProgressRange_1());

        if (!builder.IsDone()) {
          throw new Error(
            "advanced-feature-unsupported-kernel-case: OCC transform build failed.",
          );
        }

        const fallbackResult = resolveReplacementBodies(
          context,
          body.bodyId,
          builder.Shape(),
          ownerFeatureId,
          {
            allowEmpty: false,
            historySource: builder,
          },
        );
        topologyStages.push(
          createUnsupportedProducerTopologyStage({
            featureId: ownerFeatureId,
            bodies: fallbackResult.replacements,
            producedTargets: fallbackResult.replacements.map((replacement) => ({
              kind: "body" as const,
              bodyId: replacement.bodyId,
            })),
          }),
        );
        return fallbackResult;
      })();
    const index = nextBodies.findIndex((entry) => entry.bodyId === body.bodyId);
    nextBodies.splice(index, 1, ...replacementResult.replacements);
    for (const replacement of replacementResult.replacements) {
      producedTargets.push({ kind: "body", bodyId: replacement.bodyId });
    }
    for (const [key, value] of replacementResult.historyInvalidations) {
      historyInvalidations.set(key, value);
    }
    if (nativeReplacementResult) {
      for (const replacement of replacementResult.replacements) {
        topologyStages.push(
          createExactSuccessorTopologyStage({
            featureId: ownerFeatureId,
            sourceBody: body,
            outputBody: replacement,
            successorsBySourceKey:
              replacementResult.successorTargetsByPreviousKey ?? new Map(),
          }),
        );
      }
    }
  }

  return {
    bodies: nextBodies,
    constructions: [...context.constructions],
    constructionPlanes: new Map(context.constructionPlanes),
    producedTargets,
    entities: [],
    renderRecords: [],
    historyInvalidations,
    topologyStage: {
      featureId: ownerFeatureId,
      outputs: new Map(topologyStages.flatMap((stage) => [...stage.outputs])),
    },
  };
}
