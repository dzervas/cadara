import type { FeatureBooleanOperation, FeatureBooleanScope } from '@/contracts/modeling/schema'
import type { AdvancedSolidFeatureDefinition } from '@/contracts/modeling/advanced-solid'
import type { FeatureId } from '@/contracts/shared/ids'
import type { DurableRef } from '@/contracts/shared/references'
import { getAdvancedParticipant } from '@/contracts/modeling/advanced-solid'
import type { Vec3 } from '@/domain/modeling/occ/math'
import { getExtrusionNormalForPlanarFace } from '@/domain/modeling/occ/sketch-profile'
import { normalize, scale, toGpVec } from '@/domain/modeling/occ/geometry'
import type { OpenCascadeInstance } from '@/domain/modeling/occ/runtime'
import {
  requireBody,
  requireFace,
  type OccFeatureExecutionContext,
  type OccFeatureExecutionResult,
} from '@/domain/modeling/occ/features/shared'
import { applyBooleanPolicy } from '@/domain/modeling/occ/features/boolean-operations'

function getThickenThickness(definition: AdvancedSolidFeatureDefinition & { kind: 'thicken' }) {
  const thickness = definition.parameters.options?.thickness

  if (typeof thickness !== 'number' || !Number.isFinite(thickness) || thickness <= 0) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC thicken requires a positive thickness option.')
  }

  return thickness
}

function getThickenSide(definition: AdvancedSolidFeatureDefinition & { kind: 'thicken' }) {
  const side = definition.parameters.options?.side

  if (side === undefined || side === 'oneSide') {
    return 'oneSide'
  }

  if (side === 'symmetric') {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC thicken does not support symmetric side mode yet.')
  }

  throw new Error('advanced-feature-unsupported-kernel-case: OCC thicken side must be oneSide.')
}

function getThickenDirection(definition: AdvancedSolidFeatureDefinition & { kind: 'thicken' }) {
  const direction = definition.parameters.options?.direction

  if (direction === undefined || direction === 'positive') {
    return 'positive'
  }

  if (direction === 'negative') {
    return 'negative'
  }

  throw new Error('advanced-feature-unsupported-kernel-case: OCC thicken direction must be positive or negative.')
}

function getThickenFaceTargets(definition: AdvancedSolidFeatureDefinition & { kind: 'thicken' }) {
  const faceTargets = getAdvancedParticipant(definition, 'face')?.targets ?? []

  if (faceTargets.length !== 1) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC thicken requires exactly one face target in the initial implementation.')
  }

  for (const target of faceTargets) {
    if (target.kind !== 'face') {
      throw new Error('advanced-feature-unsupported-kernel-case: OCC thicken face participants must be durable face targets.')
    }
  }

  return faceTargets as readonly Extract<DurableRef, { kind: 'face' }>[]
}

function buildThickenFeatureShape(
  context: OccFeatureExecutionContext,
  definition: AdvancedSolidFeatureDefinition & { kind: 'thicken' },
) {
  const [faceTarget] = getThickenFaceTargets(definition)
  const thickness = getThickenThickness(definition)
  getThickenSide(definition)
  const direction = getThickenDirection(definition)
  const body = requireBody(context, faceTarget!.bodyId)
  const face = requireFace(body, faceTarget!.faceId)

  let extrusionNormal: Vec3
  try {
    extrusionNormal = getExtrusionNormalForPlanarFace(
      context.oc,
      face,
      direction,
    )
  } catch {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC thicken requires a planar face target.')
  }

  const profileShape: InstanceType<OpenCascadeInstance['TopoDS_Shape']> = face

  const prism = new context.oc.BRepPrimAPI_MakePrism_1(
    profileShape,
    toGpVec(context.oc, scale(normalize(extrusionNormal), thickness)),
    false,
    true,
  )
  prism.Build(new context.oc.Message_ProgressRange_1())

  if (!prism.IsDone()) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC thicken prism build failed.')
  }

  return prism.Shape()
}

function getThickenBooleanPolicy(definition: AdvancedSolidFeatureDefinition & { kind: 'thicken' }): {
  operation: FeatureBooleanOperation
  booleanScope: FeatureBooleanScope
} {
  const intent = definition.parameters.operationIntent ?? 'create'

  if (intent === 'create') {
    return {
      operation: 'newBody',
      booleanScope: { kind: 'standalone' },
    }
  }

  throw new Error('advanced-feature-unsupported-kernel-case: OCC thicken does not support boolean composition yet.')
}

export function executeThickenFeature(
  context: OccFeatureExecutionContext,
  ownerFeatureId: FeatureId,
  definition: AdvancedSolidFeatureDefinition & { kind: 'thicken' },
): OccFeatureExecutionResult {
  const featureShape = buildThickenFeatureShape(context, definition)
  const policy = getThickenBooleanPolicy(definition)
  const result = applyBooleanPolicy(context, ownerFeatureId, policy.operation, policy.booleanScope, featureShape)

  return {
    bodies: result.bodies,
    constructions: [...context.constructions],
    constructionPlanes: new Map(context.constructionPlanes),
    producedTargets: result.producedTargets,
    entities: [],
    renderRecords: [],
    historyInvalidations: result.historyInvalidations,
  }
}
