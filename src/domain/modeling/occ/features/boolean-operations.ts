import type {
  FeatureBooleanOperation,
  FeatureBooleanScope,
} from '@/contracts/modeling/schema'
import type {
  BodyId,
  EdgeId,
  FaceId,
  FeatureId,
  VertexId,
} from '@/contracts/shared/ids'
import type { DurableRef } from '@/contracts/shared/references'
import { getMultiBodyBooleanPolicy } from '@/domain/modeling/occ/implementation-policy'
import type { OpenCascadeInstance } from '@/domain/modeling/occ/runtime'
import {
  advanceTopologyToken,
  extractSolidShapes,
  getOccDurableRefKey,
  haveSameOccTopologyIds,
  OCC_REFERENCE_INVALIDATION_REASONS,
  reconcileReplacementSolidBody,
  trackDerivedSolidBody,
  trackNewSolidBody,
  trackReplacementSolidBody,
  trackReplacementSolidBodyFromNativePayload,
  type OccTrackedBody,
  type OccReferenceInvalidationRecord,
} from '@/domain/modeling/occ/topology'
import {
  parseNativeFeatureTransactionHistoryJson,
  parseNativeShimPayloadJson,
  type OccNativeFeatureTransactionHistoryPayload,
  type OccNativeFeatureTransactionHistoryRecord,
  type OccNativeShimPayload,
  type OpenCascadeNativeFeatureTransactionResult,
  type OpenCascadeNativeTopologyKernelHost,
} from '@/domain/modeling/occ/native-topology-payload'
import {
  isOccTopologyHistoryDeleted,
  type OccTopologyHistorySource,
} from '@/domain/modeling/occ/topology-naming'
import {
  requireBody,
  trackNewBodyResults,
  type OccFeatureExecutionContext,
} from '@/domain/modeling/occ/features/shared'

export { trackDerivedSolidBody }

export function createBooleanBuilder(
  oc: OpenCascadeInstance,
  operation: Exclude<FeatureBooleanOperation, 'newBody'>,
  left: InstanceType<OpenCascadeInstance['TopoDS_Shape']>,
  right: InstanceType<OpenCascadeInstance['TopoDS_Shape']>,
) {
  const progress = new oc.Message_ProgressRange_1()

  switch (operation) {
    case 'join':
      return new oc.BRepAlgoAPI_Fuse_3(left, right, progress)
    case 'cut':
      return new oc.BRepAlgoAPI_Cut_3(left, right, progress)
    case 'intersect':
      return new oc.BRepAlgoAPI_Common_3(left, right, progress)
  }
}

export function refineBooleanResultShape(
  oc: OpenCascadeInstance,
  shape: InstanceType<OpenCascadeInstance['TopoDS_Shape']>,
) {
  const unifier = new oc.ShapeUpgrade_UnifySameDomain_2(shape, true, true, true)
  unifier.AllowInternalEdges(false)
  unifier.SetSafeInputMode(true)
  unifier.SetLinearTolerance(0.001)
  unifier.SetAngularTolerance(0.001)
  unifier.Build()
  const unifiedShape = unifier.Shape()
  const historySource = new oc.BRepTools_History()
  const historyHandle = unifier.History_1()

  if (!historyHandle.IsNull()) {
    historySource.Merge_1(historyHandle)
  }

  historyHandle.delete()
  unifier.delete()

  return {
    shape: unifiedShape,
    historySource,
  }
}

export function runBoolean(
  oc: OpenCascadeInstance,
  operation: Exclude<FeatureBooleanOperation, 'newBody'>,
  left: InstanceType<OpenCascadeInstance['TopoDS_Shape']>,
  right: InstanceType<OpenCascadeInstance['TopoDS_Shape']>,
) {
  const builder = createBooleanBuilder(oc, operation, left, right)
  builder.SetToFillHistory(true)
  builder.Build(new oc.Message_ProgressRange_1())

  if (!builder.IsDone()) {
    throw new Error(`OCC boolean ${operation} failed to build.`)
  }

  builder.SimplifyResult(true, true, 1e-7)

  const refined = refineBooleanResultShape(oc, builder.Shape())

  return {
    shape: refined.shape,
    builder,
    historySources: [builder, refined.historySource] satisfies OccTopologyHistorySource[],
  }
}

function appendOwnerFeature(
  contributors: readonly FeatureId[],
  ownerFeatureId: FeatureId | null,
) {
  return ownerFeatureId && !contributors.includes(ownerFeatureId)
    ? [...contributors, ownerFeatureId]
    : [...contributors]
}

function collectBodyContributors(
  ownerFeatureId: FeatureId | null,
  ...maps: readonly ReadonlyMap<FaceId | EdgeId | VertexId, readonly FeatureId[]>[]
) {
  const contributors: FeatureId[] = []

  for (const map of maps) {
    for (const list of map.values()) {
      for (const featureId of list) {
        if (!contributors.includes(featureId)) {
          contributors.push(featureId)
        }
      }
    }
  }

  if (ownerFeatureId && !contributors.includes(ownerFeatureId)) {
    contributors.push(ownerFeatureId)
  }

  return contributors
}

function nativeHistoryInvalidationReason(reason: OccNativeFeatureTransactionHistoryRecord['reason']) {
  switch (reason) {
    case 'ambiguous':
      return OCC_REFERENCE_INVALIDATION_REASONS.topologyAmbiguous
    case 'deleted':
      return OCC_REFERENCE_INVALIDATION_REASONS.topologyDeleted
    case 'missing':
      return OCC_REFERENCE_INVALIDATION_REASONS.missing
    case 'unique-successor':
      return null
  }
}

function sameTopologyTargetKind(target: DurableRef, successor: DurableRef) {
  return (
    (target.kind === 'face' && successor.kind === 'face')
    || (target.kind === 'edge' && successor.kind === 'edge')
    || (target.kind === 'vertex' && successor.kind === 'vertex')
  )
}

function createNativeCurrentTargetAliases(
  current: OccTrackedBody,
  nativePayload: OccNativeShimPayload | null,
) {
  const aliases = new Map<string, DurableRef>()

  if (!nativePayload) {
    return aliases
  }

  for (const record of nativePayload.topology) {
    if (record.bodyId !== current.bodyId) {
      continue
    }

    if (record.kind === 'face') {
      const faceId = current.topology.faceIds[record.index - 1]
      if (faceId) {
        aliases.set(getOccDurableRefKey({ kind: 'face', bodyId: current.bodyId, faceId: record.id as FaceId }), {
          kind: 'face',
          bodyId: current.bodyId,
          faceId,
        })
      }
      continue
    }

    if (record.kind === 'edge') {
      const edgeId = current.topology.edgeIds[record.index - 1]
      if (edgeId) {
        aliases.set(getOccDurableRefKey({ kind: 'edge', bodyId: current.bodyId, edgeId: record.id as EdgeId }), {
          kind: 'edge',
          bodyId: current.bodyId,
          edgeId,
        })
      }
      continue
    }

    if (record.kind === 'vertex') {
      const vertexId = current.topology.vertexIds[record.index - 1]
      if (vertexId) {
        aliases.set(getOccDurableRefKey({ kind: 'vertex', bodyId: current.bodyId, vertexId: record.id as VertexId }), {
          kind: 'vertex',
          bodyId: current.bodyId,
          vertexId,
        })
      }
    }
  }

  return aliases
}

function collectNativeHistoryResolution(input: {
  current: OccTrackedBody
  history: OccNativeFeatureTransactionHistoryPayload
  currentNativePayload?: OccNativeShimPayload | null
}) {
  const preservedTargetsBySuccessorKey = new Map<string, DurableRef>()
  const invalidations = new Map<string, OccReferenceInvalidationRecord>()
  const currentTargetAliases = createNativeCurrentTargetAliases(input.current, input.currentNativePayload ?? null)

  for (const record of input.history.records) {
    const target = currentTargetAliases.get(getOccDurableRefKey(record.target)) ?? record.target

    if (
      record.reason === 'unique-successor'
      && record.successors.length === 1
      && sameTopologyTargetKind(target, record.successors[0]!)
    ) {
      preservedTargetsBySuccessorKey.set(getOccDurableRefKey(record.successors[0]!), target)
      continue
    }

    const reason = record.reason === 'unique-successor'
      ? OCC_REFERENCE_INVALIDATION_REASONS.topologyAmbiguous
      : nativeHistoryInvalidationReason(record.reason)

    if (reason) {
      invalidations.set(getOccDurableRefKey(target), {
        target,
        reason,
        sourceTarget: { kind: 'body', bodyId: input.current.bodyId },
      })
    }
  }

  return {
    preservedTargetsBySuccessorKey,
    invalidations,
  }
}

export function collectNativeFeatureHistoryInvalidations(
  current: OccTrackedBody,
  history: OccNativeFeatureTransactionHistoryPayload,
) {
  if (history.status !== 'available') {
    return createUnsupportedHistoryInvalidations(current)
  }

  return collectNativeHistoryResolution({
    current,
    history,
  }).invalidations
}

function reconcileNativeHistoryReplacement(
  current: OccTrackedBody,
  replacement: OccTrackedBody,
  history: OccNativeFeatureTransactionHistoryPayload,
  ownerFeatureId: FeatureId,
  currentNativePayload: OccNativeShimPayload | null,
) {
  if (history.status !== 'available') {
    return {
      body: replacement,
      historyInvalidations: createUnsupportedHistoryInvalidations(current),
    }
  }

  const { preservedTargetsBySuccessorKey, invalidations } = collectNativeHistoryResolution({
    current,
    history,
    currentNativePayload,
  })
  const faceIds: FaceId[] = []
  const facesById = new Map<FaceId, OccTrackedBody['facesById'] extends Map<FaceId, infer Face> ? Face : never>()
  const faceContributingFeatureIdsById = new Map<FaceId, FeatureId[]>()
  const faceIdsByNativeId = new Map<FaceId, FaceId>()

  for (const freshId of replacement.topology.faceIds) {
    const preservedTarget = preservedTargetsBySuccessorKey.get(getOccDurableRefKey({
      kind: 'face',
      bodyId: replacement.bodyId,
      faceId: freshId,
    }))
    const faceId = preservedTarget?.kind === 'face' ? preservedTarget.faceId : freshId
    const face = replacement.facesById.get(freshId)

    if (!face || facesById.has(faceId)) {
      continue
    }

    faceIds.push(faceId)
    faceIdsByNativeId.set(freshId, faceId)
    facesById.set(faceId, face as never)
    faceContributingFeatureIdsById.set(faceId, preservedTarget?.kind === 'face'
      ? appendOwnerFeature(current.faceContributingFeatureIdsById.get(faceId) ?? [], ownerFeatureId)
      : [...(replacement.faceContributingFeatureIdsById.get(freshId) ?? [])])
  }

  const edgeIds: EdgeId[] = []
  const edgesById = new Map<EdgeId, OccTrackedBody['edgesById'] extends Map<EdgeId, infer Edge> ? Edge : never>()
  const edgeContributingFeatureIdsById = new Map<EdgeId, FeatureId[]>()

  for (const freshId of replacement.topology.edgeIds) {
    const preservedTarget = preservedTargetsBySuccessorKey.get(getOccDurableRefKey({
      kind: 'edge',
      bodyId: replacement.bodyId,
      edgeId: freshId,
    }))
    const edgeId = preservedTarget?.kind === 'edge' ? preservedTarget.edgeId : freshId
    const edge = replacement.edgesById.get(freshId)

    if (!edge || edgesById.has(edgeId)) {
      continue
    }

    edgeIds.push(edgeId)
    edgesById.set(edgeId, edge as never)
    edgeContributingFeatureIdsById.set(edgeId, preservedTarget?.kind === 'edge'
      ? appendOwnerFeature(current.edgeContributingFeatureIdsById.get(edgeId) ?? [], ownerFeatureId)
      : [...(replacement.edgeContributingFeatureIdsById.get(freshId) ?? [])])
  }

  const vertexIds: VertexId[] = []
  const verticesById = new Map<VertexId, OccTrackedBody['verticesById'] extends Map<VertexId, infer Vertex> ? Vertex : never>()
  const vertexContributingFeatureIdsById = new Map<VertexId, FeatureId[]>()

  for (const freshId of replacement.topology.vertexIds) {
    const preservedTarget = preservedTargetsBySuccessorKey.get(getOccDurableRefKey({
      kind: 'vertex',
      bodyId: replacement.bodyId,
      vertexId: freshId,
    }))
    const vertexId = preservedTarget?.kind === 'vertex' ? preservedTarget.vertexId : freshId
    const vertex = replacement.verticesById.get(freshId)

    if (!vertex || verticesById.has(vertexId)) {
      continue
    }

    vertexIds.push(vertexId)
    verticesById.set(vertexId, vertex as never)
    vertexContributingFeatureIdsById.set(vertexId, preservedTarget?.kind === 'vertex'
      ? appendOwnerFeature(current.vertexContributingFeatureIdsById.get(vertexId) ?? [], ownerFeatureId)
      : [...(replacement.vertexContributingFeatureIdsById.get(freshId) ?? [])])
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
    nativeTopologyPayload: haveSameOccTopologyIds({
      faceIds,
      edgeIds,
      vertexIds,
    }, replacement.topology)
      ? replacement.nativeTopologyPayload
      : undefined,
    nativeTopologyIdAliases: {
      faceIdsByNativeId,
    },
  } satisfies OccTrackedBody

  return {
    body: reconciledBody,
    historyInvalidations: invalidations,
  }
}

export function resolveNativeFeatureTransactionReplacement(
  context: OccFeatureExecutionContext,
  current: OccTrackedBody,
  transaction: OpenCascadeNativeFeatureTransactionResult,
  operation: string,
  ownerFeatureId: FeatureId,
) {
  const { payload, history } = validateNativeFeatureTransaction(transaction, operation)
  const replacement = trackReplacementSolidBodyFromNativePayload(context.oc, {
    previous: current,
    ownerFeatureId,
    shape: transaction.Shape() as InstanceType<OpenCascadeInstance['TopoDS_Shape']>,
    nativePayload: payload,
  })
  const nativeHost = context.oc as unknown as OpenCascadeNativeTopologyKernelHost
  const currentNativePayloadJson = nativeHost.CadaraBuildNativeTopologyPayload?.BuildJson?.(
    current.shape,
    current.bodyId,
    current.topologyToken,
    context.modelingTolerance,
    0.5,
  )
  const currentNativePayload = currentNativePayloadJson
    ? parseNativeShimPayloadJson(currentNativePayloadJson)
    : null
  const reconciled = reconcileNativeHistoryReplacement(current, replacement, history, ownerFeatureId, currentNativePayload)

  return {
    replacements: [reconciled.body],
    historyInvalidations: reconciled.historyInvalidations,
  }
}

export function validateNativeFeatureTransaction(
  transaction: OpenCascadeNativeFeatureTransactionResult,
  operation: string,
) {
  if (!transaction.IsDone()) {
    throw new Error(`Native OCC ${operation} failed to build.`)
  }

  const payload = parseNativeShimPayloadJson(transaction.PayloadJson())
  const payloadError = payload.diagnostics.find((diagnostic) => diagnostic.severity === 'error')

  if (payloadError) {
    throw new Error(`Native OCC ${operation} rejected committed result: ${payloadError.message}`)
  }

  const history = parseNativeFeatureTransactionHistoryJson(transaction.HistoryJson())
  const historyError = history.diagnostics.find((diagnostic) => diagnostic.severity === 'error')

  if (historyError) {
    throw new Error(`Native OCC ${operation} rejected topology history: ${historyError.message}`)
  }

  return {
    payload,
    history,
  }
}

function resolveNativeBooleanReplacement(
  context: OccFeatureExecutionContext,
  current: OccTrackedBody,
  featureShape: InstanceType<OpenCascadeInstance['TopoDS_Shape']>,
  operation: Exclude<FeatureBooleanOperation, 'newBody'>,
  ownerFeatureId: FeatureId,
) {
  const nativeHost = context.oc as unknown as OpenCascadeNativeTopologyKernelHost
  const builder = nativeHost.CadaraExecuteNativeFeatureTransaction?.BuildBooleanCommittedShapeTransactionWithHistory

  if (!builder) {
    return null
  }

  const nextTopologyToken = advanceTopologyToken(current.topologyToken)
  const transaction = builder(
    current.shape,
    featureShape,
    operation,
    current.bodyId,
    current.topologyToken,
    nextTopologyToken,
    context.modelingTolerance,
    0.5,
  )

  return resolveNativeFeatureTransactionReplacement(
    context,
    current,
    transaction,
    operation,
    ownerFeatureId,
  )
}

function createHistoryTargetForShape(
  target: DurableRef,
  ownerBodyId: BodyId,
) {
  switch (target.kind) {
    case 'face':
    case 'edge':
    case 'vertex':
      return {
        target,
        sourceTarget: { kind: 'body', bodyId: ownerBodyId } as DurableRef,
      }
    default:
      return null
  }
}

export function collectTopologyHistoryInvalidations(
  current: OccTrackedBody,
  historySource: OccTopologyHistorySource,
) {
  const invalidations = new Map<string, OccReferenceInvalidationRecord>()
  const register = (
    target: DurableRef,
    shape: InstanceType<OpenCascadeInstance['TopoDS_Shape']>,
  ) => {
    const relation = createHistoryTargetForShape(target, current.bodyId)

    if (!relation) {
      return
    }

    let reason: OccReferenceInvalidationRecord['reason'] = OCC_REFERENCE_INVALIDATION_REASONS.missing

    if (isOccTopologyHistoryDeleted(historySource, shape)) {
      reason = OCC_REFERENCE_INVALIDATION_REASONS.topologyDeleted
    } else if (
      historySource.Modified(shape).Size() > 0
      || historySource.Generated(shape).Size() > 0
    ) {
      reason = OCC_REFERENCE_INVALIDATION_REASONS.topologyModified
    }

    invalidations.set(getOccDurableRefKey(target), {
      target,
      reason,
      sourceTarget: relation.sourceTarget,
    })
  }

  for (const [faceId, face] of current.facesById.entries()) {
    register({ kind: 'face', bodyId: current.bodyId, faceId }, face)
  }

  for (const [edgeId, edge] of current.edgesById.entries()) {
    register({ kind: 'edge', bodyId: current.bodyId, edgeId }, edge)
  }

  for (const [vertexId, vertex] of current.verticesById.entries()) {
    register({ kind: 'vertex', bodyId: current.bodyId, vertexId }, vertex)
  }

  return invalidations
}

export function createUnsupportedHistoryInvalidations(body: OccTrackedBody) {
  const invalidations = new Map<string, OccReferenceInvalidationRecord>()
  const sourceTarget = { kind: 'body', bodyId: body.bodyId } as DurableRef
  const register = (target: DurableRef) => {
    invalidations.set(getOccDurableRefKey(target), {
      target,
      reason: OCC_REFERENCE_INVALIDATION_REASONS.topologyUnsupportedHistory,
      sourceTarget,
    })
  }

  for (const faceId of body.facesById.keys()) {
    register({ kind: 'face', bodyId: body.bodyId, faceId })
  }

  for (const edgeId of body.edgesById.keys()) {
    register({ kind: 'edge', bodyId: body.bodyId, edgeId })
  }

  for (const vertexId of body.verticesById.keys()) {
    register({ kind: 'vertex', bodyId: body.bodyId, vertexId })
  }

  return invalidations
}

export function resolveReplacementBodies(
  context: OccFeatureExecutionContext,
  bodyId: BodyId,
  shape: InstanceType<OpenCascadeInstance['TopoDS_Shape']>,
  ownerFeatureId: FeatureId,
  options: {
    allowEmpty: boolean
    historySource?: OccTopologyHistorySource
    historySources?: readonly OccTopologyHistorySource[]
  },
) {
  const current = requireBody(context, bodyId)
  const solids = extractSolidShapes(context.oc, shape)
  const historySources = options.historySources ?? (options.historySource ? [options.historySource] : [])
  const invalidationHistorySource = options.historySource
    ?? historySources.find((historySource) =>
      typeof historySource.IsDeleted === 'function' || typeof historySource.IsRemoved === 'function',
    )
  let historyInvalidations = invalidationHistorySource
    ? collectTopologyHistoryInvalidations(current, invalidationHistorySource)
    : new Map<string, OccReferenceInvalidationRecord>()

  if (historySources.length === 0) {
    mergeHistoryInvalidations(historyInvalidations, createUnsupportedHistoryInvalidations(current))
  }

  if (solids.length === 0) {
    if (options.allowEmpty) {
      return {
        replacements: [] as OccTrackedBody[],
        historyInvalidations,
      }
    }

    throw new Error(
      `Feature ${ownerFeatureId} removed every solid while replacing body ${bodyId}; Phase 4 expected one solid result.`,
    )
  }

  if (solids.length !== 1) {
    throw new Error(
      `Feature ${ownerFeatureId} produced ${solids.length} solids while replacing body ${bodyId}; single-body replacement is required in Phase 4.`,
    )
  }

  const replacement = historySources.length > 0
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
      }

  historyInvalidations = replacement.historyInvalidations

  return {
    replacements: [replacement.body],
    historyInvalidations,
  }
}

export function assertBooleanScopeCompatible(
  operation: FeatureBooleanOperation,
  booleanScope: FeatureBooleanScope,
) {
  if (operation === 'newBody' && booleanScope.kind !== 'standalone') {
    throw new Error('Boolean operation newBody requires standalone scope.')
  }

  if (operation !== 'newBody' && booleanScope.kind === 'standalone') {
    throw new Error(`Boolean operation ${operation} requires explicit target bodies.`)
  }
}

export function requireUniqueTargetBodies(targetBodyIds: readonly BodyId[]) {
  const seen = new Set<BodyId>()

  for (const bodyId of targetBodyIds) {
    if (seen.has(bodyId)) {
      throw new Error(`Boolean target body ${bodyId} is duplicated in the explicit participant scope.`)
    }

    seen.add(bodyId)
  }
}

export function applyBooleanPolicy(
  context: OccFeatureExecutionContext,
  ownerFeatureId: FeatureId,
  operation: FeatureBooleanOperation,
  booleanScope: FeatureBooleanScope,
  featureShape: InstanceType<OpenCascadeInstance['TopoDS_Shape']>,
) {
  assertBooleanScopeCompatible(operation, booleanScope)

  if (operation === 'newBody') {
    const newBodies = trackNewBodyResults(context, ownerFeatureId, ownerFeatureId, featureShape)
    return {
      bodies: [
        ...context.bodies,
        ...newBodies,
      ],
      producedTargets: newBodies.map((body) => ({ kind: 'body', bodyId: body.bodyId }) as DurableRef),
      historyInvalidations: new Map<string, OccReferenceInvalidationRecord>(),
    }
  }

  let targetBodyIds: BodyId[]

  if (booleanScope.kind === 'targetBody') {
    targetBodyIds = [booleanScope.bodyId]
  } else if (booleanScope.kind === 'targetBodies') {
    targetBodyIds = [...booleanScope.bodyIds]
  } else {
    throw new Error(`Boolean operation ${operation} requires explicit target bodies.`)
  }

  if (targetBodyIds.length === 0) {
    throw new Error(`Boolean operation ${operation} requires at least one target body.`)
  }

  requireUniqueTargetBodies(targetBodyIds)

  const policy = getMultiBodyBooleanPolicy(operation, booleanScope)
  const nextBodies = [...context.bodies]
  const producedTargets: DurableRef[] = []

  if (!policy) {
    const bodyId = targetBodyIds[0]!
    const targetBody = requireBody(context, bodyId)
    const replacementResult = resolveNativeBooleanReplacement(
      context,
      targetBody,
      featureShape,
      operation,
      ownerFeatureId,
    ) ?? (() => {
      const result = runBoolean(context.oc, operation, targetBody.shape, featureShape)
      return resolveReplacementBodies(context, bodyId, result.shape, ownerFeatureId, {
        allowEmpty: true,
        historySources: result.historySources,
      })
    })()
    const index = nextBodies.findIndex((entry) => entry.bodyId === bodyId)
    nextBodies.splice(index, 1, ...replacementResult.replacements)
    for (const replacement of replacementResult.replacements) {
      producedTargets.push({ kind: 'body', bodyId: replacement.bodyId })
    }
    return {
      bodies: nextBodies,
      producedTargets,
      historyInvalidations: replacementResult.historyInvalidations,
    }
  }

  if (policy.application === 'sequential') {
    const [firstBodyId, ...restBodyIds] = targetBodyIds
    const firstBody = requireBody(context, firstBodyId!)
    const combinedHistoryInvalidations = new Map<string, OccReferenceInvalidationRecord>()
    let replacementResult = resolveNativeBooleanReplacement(
      context,
      firstBody,
      featureShape,
      policy.operation,
      ownerFeatureId,
    )

    if (replacementResult) {
      let currentBody = replacementResult.replacements[0]
      for (const [key, value] of replacementResult.historyInvalidations) {
        combinedHistoryInvalidations.set(key, value)
      }

      for (const bodyId of restBodyIds) {
        if (!currentBody) {
          break
        }

        const body = requireBody(context, bodyId)
        replacementResult = resolveNativeBooleanReplacement(
          context,
          currentBody,
          body.shape,
          policy.operation,
          ownerFeatureId,
        )

        if (!replacementResult) {
          break
        }

        currentBody = replacementResult.replacements[0]
        for (const [key, value] of replacementResult.historyInvalidations) {
          combinedHistoryInvalidations.set(key, value)
        }
      }
    }

    if (!replacementResult) {
      let currentResult = runBoolean(
        context.oc,
        policy.operation,
        firstBody.shape,
        featureShape,
      )
      const firstBodyHistorySources: OccTopologyHistorySource[] = [...currentResult.historySources]
      for (const [key, value] of collectTopologyHistoryInvalidations(firstBody, currentResult.builder)) {
        combinedHistoryInvalidations.set(key, value)
      }

      for (const bodyId of restBodyIds) {
        const body = requireBody(context, bodyId)
        currentResult = runBoolean(context.oc, policy.operation, currentResult.shape, body.shape)
        firstBodyHistorySources.push(...currentResult.historySources)
        for (const [key, value] of collectTopologyHistoryInvalidations(body, currentResult.builder)) {
          combinedHistoryInvalidations.set(key, value)
        }
      }

      replacementResult = resolveReplacementBodies(context, firstBodyId!, currentResult.shape, ownerFeatureId, {
        allowEmpty: true,
        historySources: firstBodyHistorySources,
      })
    }

    const firstIndex = nextBodies.findIndex((entry) => entry.bodyId === firstBodyId)
    nextBodies.splice(firstIndex, 1, ...replacementResult.replacements)

    for (const bodyId of targetBodyIds.slice(1)) {
      const consumedBody = requireBody(context, bodyId)
      const index = nextBodies.findIndex((entry) => entry.bodyId === bodyId)
      if (index >= 0) {
        nextBodies.splice(index, 1)
      }
      for (const [key, value] of createDeletedBodyInvalidations(consumedBody)) {
        combinedHistoryInvalidations.set(key, value)
      }
    }

    for (const replacement of replacementResult.replacements) {
      producedTargets.push({ kind: 'body', bodyId: replacement.bodyId })
    }
    for (const [key, value] of replacementResult.historyInvalidations) {
      combinedHistoryInvalidations.set(key, value)
    }
    return {
      bodies: nextBodies,
      producedTargets,
      historyInvalidations: combinedHistoryInvalidations,
    }
  }

  const combinedHistoryInvalidations = new Map<string, OccReferenceInvalidationRecord>()
  for (const bodyId of targetBodyIds) {
    const targetBody = requireBody(context, bodyId)
    const replacementResult = resolveNativeBooleanReplacement(
      context,
      targetBody,
      featureShape,
      policy.operation,
      ownerFeatureId,
    ) ?? (() => {
      const result = runBoolean(context.oc, policy.operation, targetBody.shape, featureShape)
      return resolveReplacementBodies(context, bodyId, result.shape, ownerFeatureId, {
        allowEmpty: true,
        historySources: result.historySources,
      })
    })()
    const index = nextBodies.findIndex((entry) => entry.bodyId === bodyId)
    nextBodies.splice(index, 1, ...replacementResult.replacements)
    for (const replacement of replacementResult.replacements) {
      producedTargets.push({ kind: 'body', bodyId: replacement.bodyId })
    }
    for (const [key, value] of replacementResult.historyInvalidations) {
      combinedHistoryInvalidations.set(key, value)
    }
  }

  return {
    bodies: nextBodies,
    producedTargets,
    historyInvalidations: combinedHistoryInvalidations,
  }
}

export function createDeletedBodyInvalidations(body: OccTrackedBody) {
  const invalidations = new Map<string, OccReferenceInvalidationRecord>()
  const register = (target: DurableRef, sourceTarget: DurableRef | null) => {
    invalidations.set(getOccDurableRefKey(target), {
      target,
      reason: OCC_REFERENCE_INVALIDATION_REASONS.topologyDeleted,
      sourceTarget,
    })
  }

  register({ kind: 'body', bodyId: body.bodyId }, null)

  for (const faceId of body.facesById.keys()) {
    register({ kind: 'face', bodyId: body.bodyId, faceId }, { kind: 'body', bodyId: body.bodyId })
  }
  for (const edgeId of body.edgesById.keys()) {
    register({ kind: 'edge', bodyId: body.bodyId, edgeId }, { kind: 'body', bodyId: body.bodyId })
  }
  for (const vertexId of body.verticesById.keys()) {
    register({ kind: 'vertex', bodyId: body.bodyId, vertexId }, { kind: 'body', bodyId: body.bodyId })
  }

  return invalidations
}

export function trackBodiesFromShape(
  context: OccFeatureExecutionContext,
  ownerFeatureId: FeatureId,
  label: string,
  shape: InstanceType<OpenCascadeInstance['TopoDS_Shape']>,
  suffix: string,
) {
  const solids = extractSolidShapes(context.oc, shape)

  if (solids.length === 0) {
    throw new Error(
      `advanced-feature-unsupported-kernel-case: ${label} for ${ownerFeatureId} produced no solid result bodies.`,
    )
  }

  return solids.map((solid, index) => trackNewSolidBody(context.oc, {
    bodyId: `body_${ownerFeatureId}_${suffix}${solids.length === 1 ? '' : `_${index + 1}`}` as BodyId,
    label: `${ownerFeatureId}_${suffix}${solids.length === 1 ? '' : `_${index + 1}`}`,
    ownerFeatureId,
    shape: solid,
  }))
}

export function mergeHistoryInvalidations(
  target: Map<string, OccReferenceInvalidationRecord>,
  source: Map<string, OccReferenceInvalidationRecord>,
) {
  for (const [key, value] of source) {
    target.set(key, value)
  }
}

export function markSplitAmbiguousInvalidations(
  source: Map<string, OccReferenceInvalidationRecord>,
) {
  const ambiguous = new Map<string, OccReferenceInvalidationRecord>()

  for (const [key, value] of source) {
    ambiguous.set(key, {
      ...value,
      reason: value.reason === OCC_REFERENCE_INVALIDATION_REASONS.topologyModified
        ? OCC_REFERENCE_INVALIDATION_REASONS.topologyAmbiguous
        : value.reason,
    })
  }

  return ambiguous
}
