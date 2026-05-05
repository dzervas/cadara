import type { FeatureBooleanOperation } from '@/contracts/modeling/schema'
import type { AdvancedSolidFeatureDefinition } from '@/contracts/modeling/advanced-solid'
import type { BodyId, FeatureId } from '@/contracts/shared/ids'
import type { DurableRef } from '@/contracts/shared/references'
import { getAdvancedParticipant } from '@/contracts/modeling/advanced-solid'
import { advanceTopologyToken, type OccReferenceInvalidationRecord } from '@/domain/modeling/occ/topology'
import {
  requireBody,
  type OccFeatureExecutionContext,
  type OccFeatureExecutionResult,
} from '@/domain/modeling/occ/features/shared'
import {
  runBoolean,
  resolveNativeFeatureTransactionReplacement,
  resolveReplacementBodies,
  requireUniqueTargetBodies,
  createDeletedBodyInvalidations,
  collectTopologyHistoryInvalidations,
  trackBodiesFromShape,
  mergeHistoryInvalidations,
  markSplitAmbiguousInvalidations,
  collectNativeFeatureHistoryInvalidations,
} from '@/domain/modeling/occ/features/boolean-operations'
import {
  parseNativeFeatureTransactionHistoryJson,
  type OpenCascadeNativeTopologyKernelHost,
} from '@/domain/modeling/occ/native-topology-payload'

function getCombineBodyTargets(
  definition: AdvancedSolidFeatureDefinition & { kind: 'combine' },
  role: 'targetBody' | 'toolBody',
) {
  const targets = getAdvancedParticipant(definition, role)?.targets ?? []

  if (targets.length === 0) {
    throw new Error(`advanced-feature-unsupported-kernel-case: OCC combine requires at least one ${role} participant.`)
  }

  for (const target of targets) {
    if (target.kind !== 'body') {
      throw new Error(`advanced-feature-unsupported-kernel-case: OCC combine ${role} participants must be durable body targets.`)
    }
  }

  return targets as readonly Extract<DurableRef, { kind: 'body' }>[]
}

function getCombineBooleanOperation(definition: AdvancedSolidFeatureDefinition & { kind: 'combine' }): Exclude<FeatureBooleanOperation, 'newBody'> {
  const intent = definition.parameters.operationIntent

  switch (intent) {
    case 'add':
      return 'join'
    case 'subtract':
      return 'cut'
    case 'intersect':
      return 'intersect'
    default:
      throw new Error('advanced-feature-unsupported-kernel-case: OCC combine requires add, subtract, or intersect operation intent.')
  }
}

function resolveNativeCombineReplacement(input: {
  context: OccFeatureExecutionContext
  targetBodyId: BodyId
  toolBodyId: BodyId
  operation: Exclude<FeatureBooleanOperation, 'newBody'>
  ownerFeatureId: FeatureId
}) {
  const targetBody = requireBody(input.context, input.targetBodyId)
  const toolBody = requireBody(input.context, input.toolBodyId)
  const nativeHost = input.context.oc as unknown as OpenCascadeNativeTopologyKernelHost
  const nativeBuilder = nativeHost.CadaraExecuteNativeFeatureTransaction?.BuildBooleanCommittedShapeTransactionWithHistory

  if (!nativeBuilder) {
    return null
  }

  return resolveNativeFeatureTransactionReplacement(
    input.context,
    targetBody,
    nativeBuilder(
      targetBody.shape,
      toolBody.shape,
      input.operation,
      targetBody.bodyId,
      targetBody.topologyToken,
      advanceTopologyToken(targetBody.topologyToken),
      input.context.modelingTolerance,
      0.5,
    ),
    `combine-${input.operation}`,
    input.ownerFeatureId,
  )
}

export function executeCombineFeature(
  context: OccFeatureExecutionContext,
  ownerFeatureId: FeatureId,
  definition: AdvancedSolidFeatureDefinition & { kind: 'combine' },
): OccFeatureExecutionResult {
  const targetBodies = getCombineBodyTargets(definition, 'targetBody')
  const toolBodies = getCombineBodyTargets(definition, 'toolBody')
  const operation = getCombineBooleanOperation(definition)
  const targetBodyIds = targetBodies.map((target) => target.bodyId)
  const toolBodyIds = toolBodies.map((target) => target.bodyId)
  requireUniqueTargetBodies(targetBodyIds)
  requireUniqueTargetBodies(toolBodyIds)

  if (targetBodyIds.some((bodyId) => toolBodyIds.includes(bodyId))) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC combine target and tool bodies must be distinct.')
  }

  const historyInvalidations = new Map<string, OccReferenceInvalidationRecord>()
  const nextBodies = [...context.bodies]
  const producedTargets: DurableRef[] = []

  if (operation === 'join') {
    const [firstTargetBodyId, ...remainingTargetBodyIds] = targetBodyIds
    const firstTargetBody = requireBody(context, firstTargetBodyId!)
    const replacementResult = remainingTargetBodyIds.length === 0 && toolBodyIds.length === 1
      ? resolveNativeCombineReplacement({
          context,
          targetBodyId: firstTargetBodyId!,
          toolBodyId: toolBodyIds[0]!,
          operation,
          ownerFeatureId,
        }) ?? (() => {
          const toolBody = requireBody(context, toolBodyIds[0]!)
          const result = runBoolean(context.oc, 'join', firstTargetBody.shape, toolBody.shape)
          return resolveReplacementBodies(context, firstTargetBodyId!, result.shape, ownerFeatureId, {
            allowEmpty: true,
            historySources: result.historySources,
          })
        })()
      : (() => {
          let currentShape = firstTargetBody.shape
          const firstTargetHistorySources: import('@/domain/modeling/occ/topology-naming').OccTopologyHistorySource[] = []

          for (const bodyId of [...remainingTargetBodyIds, ...toolBodyIds]) {
            const body = requireBody(context, bodyId)
            const result = runBoolean(context.oc, 'join', currentShape, body.shape)
            currentShape = result.shape
            firstTargetHistorySources.push(...result.historySources)
          }

          return resolveReplacementBodies(context, firstTargetBodyId!, currentShape, ownerFeatureId, {
            allowEmpty: true,
            historySources: firstTargetHistorySources,
          })
        })()
    const firstIndex = nextBodies.findIndex((entry) => entry.bodyId === firstTargetBodyId)
    nextBodies.splice(firstIndex, 1, ...replacementResult.replacements)
    mergeHistoryInvalidations(historyInvalidations, replacementResult.historyInvalidations)

    for (const bodyId of [...remainingTargetBodyIds, ...toolBodyIds]) {
      const body = requireBody(context, bodyId)
      const index = nextBodies.findIndex((entry) => entry.bodyId === bodyId)
      if (index >= 0) {
        nextBodies.splice(index, 1)
      }
      mergeHistoryInvalidations(historyInvalidations, createDeletedBodyInvalidations(body))
    }

    for (const replacement of replacementResult.replacements) {
      producedTargets.push({ kind: 'body', bodyId: replacement.bodyId })
    }
  } else {
    for (const targetBodyId of targetBodyIds) {
      const targetBody = requireBody(context, targetBodyId)
      const replacementResult = toolBodyIds.length === 1
        ? resolveNativeCombineReplacement({
            context,
            targetBodyId,
            toolBodyId: toolBodyIds[0]!,
            operation,
            ownerFeatureId,
          }) ?? (() => {
            const toolBody = requireBody(context, toolBodyIds[0]!)
            const result = runBoolean(context.oc, operation, targetBody.shape, toolBody.shape)
            return resolveReplacementBodies(context, targetBodyId, result.shape, ownerFeatureId, {
              allowEmpty: true,
              historySources: result.historySources,
            })
          })()
        : (() => {
            let currentShape = targetBody.shape
            const targetHistorySources: import('@/domain/modeling/occ/topology-naming').OccTopologyHistorySource[] = []

            for (const toolBodyId of toolBodyIds) {
              const toolBody = requireBody(context, toolBodyId)
              const result = runBoolean(context.oc, operation, currentShape, toolBody.shape)
              currentShape = result.shape
              targetHistorySources.push(...result.historySources)
            }

            return resolveReplacementBodies(context, targetBodyId, currentShape, ownerFeatureId, {
              allowEmpty: true,
              historySources: targetHistorySources,
            })
          })()
      const targetIndex = nextBodies.findIndex((entry) => entry.bodyId === targetBodyId)
      nextBodies.splice(targetIndex, 1, ...replacementResult.replacements)
      mergeHistoryInvalidations(historyInvalidations, replacementResult.historyInvalidations)

      for (const replacement of replacementResult.replacements) {
        producedTargets.push({ kind: 'body', bodyId: replacement.bodyId })
      }
    }

    for (const toolBodyId of toolBodyIds) {
      const toolBody = requireBody(context, toolBodyId)
      const index = nextBodies.findIndex((entry) => entry.bodyId === toolBodyId)
      if (index >= 0) {
        nextBodies.splice(index, 1)
      }
      mergeHistoryInvalidations(historyInvalidations, createDeletedBodyInvalidations(toolBody))
    }
  }

  if (producedTargets.length === 0) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC combine produced no solid result bodies.')
  }

  return {
    bodies: nextBodies,
    constructions: [...context.constructions],
    constructionPlanes: new Map(context.constructionPlanes),
    producedTargets,
    entities: [],
    renderRecords: [],
    historyInvalidations,
  }
}

function getSplitTargetBody(definition: AdvancedSolidFeatureDefinition & { kind: 'split' }) {
  const targets = getAdvancedParticipant(definition, 'targetBody')?.targets ?? []

  if (targets.length !== 1 || targets[0]?.kind !== 'body') {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC split requires exactly one targetBody participant.')
  }

  return targets[0]
}

function getSplitToolBody(definition: AdvancedSolidFeatureDefinition & { kind: 'split' }) {
  const toolBodies = getAdvancedParticipant(definition, 'toolBody')?.targets ?? []
  const planes = getAdvancedParticipant(definition, 'plane')?.targets ?? []

  if (planes.length > 0) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC split does not support plane split tools yet.')
  }

  if (toolBodies.length !== 1 || toolBodies[0]?.kind !== 'body') {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC split requires exactly one toolBody participant in the initial implementation.')
  }

  return toolBodies[0]
}

export function executeSplitFeature(
  context: OccFeatureExecutionContext,
  ownerFeatureId: FeatureId,
  definition: AdvancedSolidFeatureDefinition & { kind: 'split' },
): OccFeatureExecutionResult {
  if (definition.parameters.operationIntent !== undefined) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC split does not support operation intents.')
  }

  const targetBodyRef = getSplitTargetBody(definition)
  const toolBodyRef = getSplitToolBody(definition)

  if (targetBodyRef.bodyId === toolBodyRef.bodyId) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC split requires distinct target and tool bodies.')
  }

  const targetBody = requireBody(context, targetBodyRef.bodyId)
  const toolBody = requireBody(context, toolBodyRef.bodyId)
  const nativeHost = context.oc as unknown as OpenCascadeNativeTopologyKernelHost
  const nativeBuilder = nativeHost.CadaraExecuteNativeFeatureTransaction?.BuildSplitCommittedShapeTransactionWithHistory

  if (nativeBuilder) {
    const transaction = nativeBuilder(
      targetBody.shape,
      toolBody.shape,
      targetBody.bodyId,
      targetBody.topologyToken,
      advanceTopologyToken(targetBody.topologyToken),
      context.modelingTolerance,
      0.5,
    )

    if (!transaction.IsDone()) {
      throw new Error('advanced-feature-unsupported-kernel-case: OCC split native transaction failed.')
    }

    const splitBodies = trackBodiesFromShape(
      context,
      ownerFeatureId,
      'Split result',
      transaction.Shape() as Parameters<typeof trackBodiesFromShape>[3],
      'split',
    )
    const nextBodies = context.bodies
      .filter((body) => body.bodyId !== targetBody.bodyId)
      .concat(splitBodies)
    const historyInvalidations = createDeletedBodyInvalidations(targetBody)
    const nativeHistory = parseNativeFeatureTransactionHistoryJson(transaction.HistoryJson())
    mergeHistoryInvalidations(historyInvalidations, collectNativeFeatureHistoryInvalidations(targetBody, nativeHistory))

    return {
      bodies: nextBodies,
      constructions: [...context.constructions],
      constructionPlanes: new Map(context.constructionPlanes),
      producedTargets: splitBodies.map((body) => ({ kind: 'body' as const, bodyId: body.bodyId })),
      entities: [],
      renderRecords: [],
      historyInvalidations,
    }
  }

  const cutResult = runBoolean(context.oc, 'cut', targetBody.shape, toolBody.shape)
  const intersectResult = runBoolean(context.oc, 'intersect', targetBody.shape, toolBody.shape)
  const remainderBodies = trackBodiesFromShape(context, ownerFeatureId, 'Split remainder', cutResult.shape, 'remainder')
  const toolSideBodies = trackBodiesFromShape(context, ownerFeatureId, 'Split tool-side result', intersectResult.shape, 'tool-side')
  const nextBodies = context.bodies
    .filter((body) => body.bodyId !== targetBody.bodyId)
    .concat([...remainderBodies, ...toolSideBodies])
  const historyInvalidations = createDeletedBodyInvalidations(targetBody)

  for (const [key, value] of markSplitAmbiguousInvalidations(collectTopologyHistoryInvalidations(targetBody, cutResult.builder))) {
    historyInvalidations.set(key, value)
  }
  for (const [key, value] of markSplitAmbiguousInvalidations(collectTopologyHistoryInvalidations(targetBody, intersectResult.builder))) {
    historyInvalidations.set(key, value)
  }

  return {
    bodies: nextBodies,
    constructions: [...context.constructions],
    constructionPlanes: new Map(context.constructionPlanes),
    producedTargets: [...remainderBodies, ...toolSideBodies].map((body) => ({ kind: 'body' as const, bodyId: body.bodyId })),
    entities: [],
    renderRecords: [],
    historyInvalidations,
  }
}

function getDeleteSolidBodyTargets(definition: AdvancedSolidFeatureDefinition & { kind: 'deleteSolid' }) {
  const bodyTargets = getAdvancedParticipant(definition, 'body')?.targets ?? []

  if (bodyTargets.length === 0) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC delete-solid requires at least one body participant.')
  }

  for (const target of bodyTargets) {
    if (target.kind !== 'body') {
      throw new Error('advanced-feature-unsupported-kernel-case: OCC delete-solid body participants must be durable body targets.')
    }
  }

  return bodyTargets as readonly Extract<DurableRef, { kind: 'body' }>[]
}

export function executeDeleteSolidFeature(
  context: OccFeatureExecutionContext,
  definition: AdvancedSolidFeatureDefinition & { kind: 'deleteSolid' },
): OccFeatureExecutionResult {
  if (definition.parameters.operationIntent !== undefined) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC delete-solid does not support operation intents.')
  }

  const bodyTargets = getDeleteSolidBodyTargets(definition)
  requireUniqueTargetBodies(bodyTargets.map((target) => target.bodyId))

  const historyInvalidations = new Map<string, OccReferenceInvalidationRecord>()
  for (const target of bodyTargets) {
    const body = requireBody(context, target.bodyId)
    for (const [key, value] of createDeletedBodyInvalidations(body)) {
      historyInvalidations.set(key, value)
    }
  }

  return {
    bodies: context.bodies.filter((body) => !bodyTargets.some((target) => target.bodyId === body.bodyId)),
    constructions: [...context.constructions],
    constructionPlanes: new Map(context.constructionPlanes),
    producedTargets: [],
    entities: [],
    renderRecords: [],
    historyInvalidations,
  }
}
