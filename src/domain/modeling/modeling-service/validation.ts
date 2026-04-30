import type {
  BodyId,
  ConstructionId,
  DocumentId,
  DocumentVariableId,
  EdgeId,
  FaceId,
  FeatureId,
  PrimitiveRef,
  RevisionId,
  SketchId,
  VertexId,
} from '@/core/editor/schema'
import {
  getPrimitiveRefKey,
} from '@/core/editor/schema'
import type {
  ExtrudeProfileRef,
  FilletEdgeRef,
  RevolveAxisRef,
  RevolveFeatureParameters,
  UpToOffsetDirection,
} from '@/contracts/modeling/schema'
import type { DurableRef } from '@/contracts/shared/references'
import type { ConstraintId, DimensionId, RegionId, SketchEntityId, SketchPointId } from '@/contracts/shared/ids'
import type { SketchPlaneSupportRef } from '@/contracts/shared/sketch-plane'
import { getAuthoredLiteralValue, isExpressionAuthoredValue, type MaybeAuthoredValue } from '@/contracts/modeling/authored-values'

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function isString(value: unknown): value is string {
  return typeof value === 'string'
}

export function isAuthoredNumberLike(value: unknown) {
  const literal = getAuthoredLiteralValue(value as MaybeAuthoredValue<unknown>)
  return typeof literal === 'number' || isExpressionAuthoredValue(value)
}

export function isAuthoredEnumLike(value: unknown, options: readonly string[]) {
  const literal = getAuthoredLiteralValue(value as MaybeAuthoredValue<unknown>)
  return (typeof literal === 'string' && options.includes(literal)) || isExpressionAuthoredValue(value)
}

export function isLegacyRevolveAngleExtent(
  extent: RevolveFeatureParameters['extent'],
): extent is Extract<RevolveFeatureParameters['extent'], { kind: 'angle' }> {
  return 'kind' in extent && extent.kind === 'angle'
}

export function assertDocumentId(value: unknown): DocumentId {
  if (!isString(value)) {
    throw new Error('Invalid document ID payload.')
  }

  return value as DocumentId
}

export function assertDocumentVariableId(value: unknown): DocumentVariableId {
  if (!isString(value)) {
    throw new Error('Invalid document variable ID payload.')
  }

  return value as DocumentVariableId
}

export function assertRevisionId(value: unknown): RevisionId {
  if (!isString(value)) {
    throw new Error('Invalid revision ID payload.')
  }

  return value as RevisionId
}

export function assertFeatureId(value: unknown): FeatureId {
  if (!isString(value)) {
    throw new Error('Invalid feature ID payload.')
  }

  return value as FeatureId
}

export function assertSketchId(value: unknown): SketchId {
  if (!isString(value)) {
    throw new Error('Invalid sketch ID payload.')
  }

  return value as SketchId
}

export function assertBodyId(value: unknown): BodyId {
  if (!isString(value)) {
    throw new Error('Invalid body ID payload.')
  }

  return value as BodyId
}

export function assertSketchPointId(value: unknown): SketchPointId {
  if (!isString(value)) {
    throw new Error('Invalid sketch point ID payload.')
  }

  return value as SketchPointId
}

export function assertSketchEntityId(value: unknown): SketchEntityId {
  if (!isString(value)) {
    throw new Error('Invalid sketch entity ID payload.')
  }

  return value as SketchEntityId
}

export function assertConstraintId(value: unknown): ConstraintId {
  if (!isString(value)) {
    throw new Error('Invalid constraint ID payload.')
  }

  return value as ConstraintId
}

export function assertDimensionId(value: unknown): DimensionId {
  if (!isString(value)) {
    throw new Error('Invalid dimension ID payload.')
  }

  return value as DimensionId
}

export function assertRegionId(value: unknown): RegionId {
  if (!isString(value)) {
    throw new Error('Invalid region ID payload.')
  }

  return value as RegionId
}

export function assertPrimitiveRef(value: unknown): PrimitiveRef {
  if (!isRecord(value) || !isString(value.kind)) {
    throw new Error('Invalid primitive reference payload.')
  }

  switch (value.kind) {
    case 'body':
      if (isString(value.bodyId)) {
        return { kind: 'body', bodyId: value.bodyId as BodyId }
      }
      break
    case 'face':
      if (isString(value.bodyId) && isString(value.faceId)) {
        return { kind: 'face', bodyId: value.bodyId as BodyId, faceId: value.faceId as FaceId }
      }
      break
    case 'edge':
      if (isString(value.bodyId) && isString(value.edgeId)) {
        return { kind: 'edge', bodyId: value.bodyId as BodyId, edgeId: value.edgeId as EdgeId }
      }
      break
    case 'vertex':
      if (isString(value.bodyId) && isString(value.vertexId)) {
        return { kind: 'vertex', bodyId: value.bodyId as BodyId, vertexId: value.vertexId as VertexId }
      }
      break
    case 'loop':
      if (isString(value.bodyId) && isString(value.loopId)) {
        return { kind: 'loop', bodyId: value.bodyId as import('@/contracts/shared/ids').BodyId, loopId: value.loopId as import('@/contracts/shared/ids').LoopId }
      }
      break
    case 'sketch':
      if (isString(value.sketchId)) {
        return { kind: 'sketch', sketchId: value.sketchId as SketchId }
      }
      break
    case 'sketchEntity':
      if (isString(value.sketchId) && isString(value.entityId)) {
        return {
          kind: 'sketchEntity',
          sketchId: value.sketchId as SketchId,
          entityId: value.entityId as SketchEntityId,
        }
      }
      break
    case 'sketchPoint':
      if (isString(value.sketchId) && isString(value.pointId)) {
        return {
          kind: 'sketchPoint',
          sketchId: value.sketchId as SketchId,
          pointId: value.pointId as SketchPointId,
        }
      }
      break
    case 'constraint':
      if (isString(value.sketchId) && isString(value.constraintId)) {
        return {
          kind: 'constraint',
          sketchId: value.sketchId as SketchId,
          constraintId: value.constraintId as ConstraintId,
        }
      }
      break
    case 'dimension':
      if (isString(value.sketchId) && isString(value.dimensionId)) {
        return {
          kind: 'dimension',
          sketchId: value.sketchId as SketchId,
          dimensionId: value.dimensionId as DimensionId,
        }
      }
      break
    case 'feature':
      if (isString(value.featureId)) {
        return { kind: 'feature', featureId: value.featureId as FeatureId }
      }
      break
    case 'construction':
      if (isString(value.constructionId)) {
        return { kind: 'construction', constructionId: value.constructionId as ConstructionId }
      }
      break
    case 'region':
      if (isString(value.sketchId) && isString(value.regionId)) {
        return {
          kind: 'region',
          sketchId: value.sketchId as SketchId,
          regionId: value.regionId as RegionId,
        }
      }
      break
  }

  throw new Error('Invalid primitive reference payload.')
}

export function assertDurableRef(value: unknown): DurableRef {
  const target = assertPrimitiveRef(value)

  if (
    target.kind === 'projectedReferenceGeometry'
    || target.kind === 'sketchDatumReference'
    || target.kind === 'sketchExternalReference'
  ) {
    throw new Error('Invalid durable reference payload.')
  }

  return target
}

export function assertSketchPlaneSupportRef(value: unknown): SketchPlaneSupportRef {
  const target = assertPrimitiveRef(value)

  if (target.kind !== 'construction' && target.kind !== 'face') {
    throw new Error('Invalid sketch-plane support payload.')
  }

  return target
}

export function assertExtrudeProfileRef(value: unknown): ExtrudeProfileRef {
  const target = assertPrimitiveRef(value)

  switch (target.kind) {
    case 'region':
    case 'face':
      return target
    default:
      throw new Error('Invalid extrude profile reference payload.')
  }
}

export function assertExtrudeProfileRefs(value: unknown, featureLabel: string): readonly [ExtrudeProfileRef, ...ExtrudeProfileRef[]] {
  if (!Array.isArray(value)) {
    throw new Error(`${featureLabel} parameters must include profiles.`)
  }

  if (value.length === 0) {
    throw new Error(`${featureLabel} profiles must include at least one explicit region or planar face reference.`)
  }

  const [first, ...rest] = value.map((entry) => assertExtrudeProfileRef(entry))
  const profiles = [first!, ...rest] as const
  const seen = new Set<string>()

  for (const profile of profiles) {
    const key = getPrimitiveRefKey(profile)
    if (seen.has(key)) {
      throw new Error(`${featureLabel} profiles must not contain duplicate profile references.`)
    }
    seen.add(key)
  }

  return profiles as readonly [ExtrudeProfileRef, ...ExtrudeProfileRef[]]
}

export function assertFilletEdgeRef(value: unknown): FilletEdgeRef {
  const target = assertPrimitiveRef(value)

  if (target.kind !== 'edge') {
    throw new Error('Invalid fillet edge reference payload.')
  }

  return target
}

export function assertShellFaceRef(value: unknown): Extract<PrimitiveRef, { kind: 'face' }> {
  const target = assertPrimitiveRef(value)

  if (target.kind !== 'face') {
    throw new Error('Invalid shell face reference payload.')
  }

  return target
}

export function assertRevolveAxisRef(value: unknown): RevolveAxisRef {
  const target = assertPrimitiveRef(value)

  if (target.kind !== 'edge' && target.kind !== 'construction') {
    throw new Error('Invalid revolve axis reference payload.')
  }

  return target
}

export function assertUpToTargetForKind(kind: 'upToFace' | 'upToPart' | 'upToVertex', value: unknown) {
  const target = assertPrimitiveRef(value)
  if (kind === 'upToFace' && target.kind === 'face') {
    return target
  }
  if (kind === 'upToPart' && target.kind === 'body') {
    return target
  }
  if (kind === 'upToVertex' && target.kind === 'vertex') {
    return target
  }

  throw new Error(`Invalid ${kind} target payload.`)
}

export function normalizeUpToOffset(value: unknown, field: 'distance' | 'angle') {
  if (value === undefined) {
    return undefined
  }

  if (!isRecord(value) || !isAuthoredNumberLike(value[field])) {
    throw new Error('Invalid up-to offset payload.')
  }

  if (value.direction !== 'shorten' && value.direction !== 'extend') {
    throw new Error('Invalid up-to offset direction payload.')
  }

  return field === 'distance'
    ? { distance: value.distance as MaybeAuthoredValue<number>, direction: value.direction as UpToOffsetDirection }
    : { angle: value.angle as MaybeAuthoredValue<number>, direction: value.direction as UpToOffsetDirection }
}
