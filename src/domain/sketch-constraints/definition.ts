import type {
  ConstraintDefinition,
  DimensionDefinition,
  DimensionAnnotationPlacement,
  SketchDefinition,
  SketchEntityDefinition,
  SketchPoint2D,
  SketchPointDefinition,
} from '@/contracts/sketch/schema'
import type { ProjectedSketchReferenceRecord } from '@/contracts/solver/schema'
import type { PrimitiveRef } from '@/domain/editor/schema'
import type { ToolMetadataBase } from '@/domain/tools/metadata'
import type {
  SketchToolDimensionReferenceKind,
  SketchToolOverlayDescriptor,
} from '@/domain/sketch-tools/editor-schema'

export type SketchConstraintToolId =
  | 'constraintCoincident'
  | 'constraintParallel'
  | 'constraintPerpendicular'
  | 'constraintTangent'
  | 'constraintEqual'
  | 'constraintConcentric'
  | 'constraintMidpoint'
  | 'constraintNormal'
  | 'constraintPierce'
  | 'constraintSymmetric'
  | 'constraintFix'
  | 'dimensionDistance'
  | 'dimensionHorizontal'
  | 'dimensionVertical'
  | 'dimensionRadius'

export type SketchConstraintSelectionKind = 'point' | 'line' | 'circle' | 'spline'

export interface SketchConstraintSelectionStep {
  id: string
  label: string
  acceptedKinds: readonly SketchConstraintSelectionKind[]
}

export interface SketchConstraintValueSpec {
  label: string
  unit?: string
  min?: number
  defaultValue: number
}

export interface SketchConstraintMetadata<TToolId extends SketchConstraintToolId = SketchConstraintToolId> extends ToolMetadataBase<TToolId> {
  group: 'constraints' | 'dimensions'
}

export interface SketchConstraintTargetRecord {
  target: PrimitiveRef
  label: string
  kind: SketchConstraintSelectionKind
  anchor: SketchPoint2D
  point?: SketchPointDefinition
  entity?: SketchEntityDefinition
  entityPoints?: readonly Pick<SketchPointDefinition, 'pointId' | 'position'>[]
  projected?: {
    reference: NonNullable<Extract<PrimitiveRef, { kind: 'projectedReferenceGeometry' }>>
    geometry: ProjectedSketchReferenceRecord['geometry'][number]
  }
  line?: {
    start: SketchPoint2D
    end: SketchPoint2D
  }
  circle?: {
    center: SketchPoint2D
    radius: number
  }
}

export interface SketchConstraintPreviewInput {
  selectedTargets: readonly SketchConstraintTargetRecord[]
  hoverTarget: SketchConstraintTargetRecord | null
  pointer: SketchPoint2D | null
  value: number | null
  annotationPlacement?: DimensionAnnotationPlacement | null
}

export interface SketchConstraintCommitInput {
  sequence: number
  selectedTargets: readonly SketchConstraintTargetRecord[]
  pointer: SketchPoint2D | null
  referenceKind?: SketchToolDimensionReferenceKind | null
  value: number | null
  annotationPlacement?: DimensionAnnotationPlacement | null
  createConstraintId(suffix: string): import('@/contracts/shared/ids').ConstraintId
  createDimensionId(suffix: string): import('@/contracts/shared/ids').DimensionId
}

export interface SketchConstraintCommitContribution {
  constraints?: ConstraintDefinition[]
  dimensions?: DimensionDefinition[]
}

export interface SketchConstraintDefinition<TToolId extends SketchConstraintToolId = SketchConstraintToolId> {
  metadata: SketchConstraintMetadata<TToolId>
  steps: readonly SketchConstraintSelectionStep[]
  valueSpec?: SketchConstraintValueSpec
  resolveTarget(
    definition: SketchDefinition,
    target: PrimitiveRef,
    projectedReferences?: readonly ProjectedSketchReferenceRecord[],
  ): SketchConstraintTargetRecord | null
  buildPreview(input: SketchConstraintPreviewInput): readonly SketchToolOverlayDescriptor[]
  getValueSpec?(selectedTargets: readonly SketchConstraintTargetRecord[]): SketchConstraintValueSpec | null
  isReadyForValue?(selectedTargets: readonly SketchConstraintTargetRecord[]): boolean
  canSelectMoreTargets?(selectedTargets: readonly SketchConstraintTargetRecord[]): boolean
  createCommitContribution(input: SketchConstraintCommitInput): SketchConstraintCommitContribution
}

export function findPoint(definition: SketchDefinition, pointId: SketchPointDefinition['pointId']) {
  return definition.points.find((point) => point.pointId === pointId) ?? null
}

export function findEntity(definition: SketchDefinition, entityId: SketchEntityDefinition['entityId']) {
  return definition.entities.find((entity) => entity.entityId === entityId) ?? null
}

export function resolvePointTarget(
  definition: SketchDefinition,
  target: PrimitiveRef,
  projectedReferences: readonly ProjectedSketchReferenceRecord[] = [],
): SketchConstraintTargetRecord | null {
  if (target.kind === 'projectedReferenceGeometry') {
    const projected = resolveProjectedGeometryTarget(target, projectedReferences)

    if (!projected || projected.projected?.geometry.kind !== 'point') {
      return null
    }

    return projected
  }

  if (target.kind !== 'sketchPoint') {
    return null
  }

  const point = findPoint(definition, target.pointId)

  if (!point) {
    return null
  }

  return {
    target,
    label: point.label,
    kind: 'point',
    anchor: point.position,
    point,
  }
}

export function resolveLineTarget(
  definition: SketchDefinition,
  target: PrimitiveRef,
  projectedReferences: readonly ProjectedSketchReferenceRecord[] = [],
): SketchConstraintTargetRecord | null {
  if (target.kind === 'projectedReferenceGeometry') {
    const projected = resolveProjectedGeometryTarget(target, projectedReferences)

    if (!projected || projected.projected?.geometry.kind !== 'lineSegment') {
      return null
    }

    return projected
  }

  if (target.kind !== 'sketchEntity') {
    return null
  }

  const entity = findEntity(definition, target.entityId)

  if (!entity || entity.kind !== 'lineSegment') {
    return null
  }

  return {
    target,
    label: entity.label,
    kind: 'line',
    anchor: midpointForLine(definition, entity),
    entity,
    entityPoints: [
      findPoint(definition, entity.startPointId),
      findPoint(definition, entity.endPointId),
    ].filter((point): point is SketchPointDefinition => Boolean(point))
      .map((point) => ({ pointId: point.pointId, position: point.position })),
    line: {
      start: findPoint(definition, entity.startPointId)?.position ?? [0, 0],
      end: findPoint(definition, entity.endPointId)?.position ?? [0, 0],
    },
  }
}

export function resolveCircleTarget(
  definition: SketchDefinition,
  target: PrimitiveRef,
  projectedReferences: readonly ProjectedSketchReferenceRecord[] = [],
): SketchConstraintTargetRecord | null {
  if (target.kind === 'projectedReferenceGeometry') {
    const projected = resolveProjectedGeometryTarget(target, projectedReferences)

    if (!projected || (projected.projected?.geometry.kind !== 'circle' && projected.projected?.geometry.kind !== 'arc')) {
      return null
    }

    return projected
  }

  if (target.kind !== 'sketchEntity') {
    return null
  }

  const entity = findEntity(definition, target.entityId)

  if (!entity || (entity.kind !== 'circle' && entity.kind !== 'arc')) {
    return null
  }

  const center = findPoint(definition, entity.centerPointId)?.position ?? [0, 0]
  const radius = entity.kind === 'circle'
    ? entity.radius
    : Math.hypot(
        (findPoint(definition, entity.startPointId)?.position ?? center)[0] - center[0],
        (findPoint(definition, entity.startPointId)?.position ?? center)[1] - center[1],
      )

  return {
    target,
    label: entity.label,
    kind: 'circle',
    anchor: center,
    entity,
    entityPoints: [
      findPoint(definition, entity.centerPointId),
      entity.kind === 'arc' ? findPoint(definition, entity.startPointId) : null,
      entity.kind === 'arc' ? findPoint(definition, entity.endPointId) : null,
    ].filter((point): point is SketchPointDefinition => Boolean(point))
      .map((point) => ({ pointId: point.pointId, position: point.position })),
    circle: {
      center,
      radius,
    },
  }
}

export function resolveCurveTarget(
  definition: SketchDefinition,
  target: PrimitiveRef,
  projectedReferences: readonly ProjectedSketchReferenceRecord[] = [],
): SketchConstraintTargetRecord | null {
  if (target.kind !== 'projectedReferenceGeometry') {
    if (target.kind !== 'sketchEntity') {
      return null
    }

    const entity = findEntity(definition, target.entityId)

    if (!entity || entity.kind !== 'spline') {
      return null
    }

    const firstPoint = findPoint(definition, entity.fitPointIds[0])

    return {
      target,
      label: entity.label,
      kind: 'spline',
      anchor: firstPoint?.position ?? [0, 0],
      entity,
      entityPoints: entity.fitPointIds.flatMap((pointId) => {
        const point = findPoint(definition, pointId)
        return point ? [{ pointId: point.pointId, position: point.position }] : []
      }),
    }
  }

  const projected = resolveProjectedGeometryTarget(target, projectedReferences)
  return projected?.kind === 'spline' ? projected : null
}

function midpointForLine(definition: SketchDefinition, entity: Extract<SketchEntityDefinition, { kind: 'lineSegment' }>): SketchPoint2D {
  const start = findPoint(definition, entity.startPointId)?.position ?? [0, 0]
  const end = findPoint(definition, entity.endPointId)?.position ?? [0, 0]
  return [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2]
}

function resolveProjectedGeometryTarget(
  target: Extract<PrimitiveRef, { kind: 'projectedReferenceGeometry' }>,
  projectedReferences: readonly ProjectedSketchReferenceRecord[],
): SketchConstraintTargetRecord | null {
  const reference = projectedReferences.find((entry) => entry.referenceId === target.referenceId)
  const geometry = reference?.geometry.find((entry) =>
    entry.geometryId === target.geometryId && entry.kind === target.geometryKind,
  )

  if (!reference || reference.status !== 'projected' || !geometry) {
    return null
  }

  if (geometry.kind === 'point') {
    return {
      target,
      label: `Projected ${geometry.geometryId}`,
      kind: 'point',
      anchor: geometry.position,
      projected: { reference: target, geometry },
    }
  }

  if (geometry.kind === 'lineSegment') {
    return {
      target,
      label: `Projected ${geometry.geometryId}`,
      kind: 'line',
      anchor: [
        (geometry.startPosition[0] + geometry.endPosition[0]) / 2,
        (geometry.startPosition[1] + geometry.endPosition[1]) / 2,
      ],
      projected: { reference: target, geometry },
      line: {
        start: geometry.startPosition,
        end: geometry.endPosition,
      },
    }
  }

  if (geometry.kind === 'spline') {
    return {
      target,
      label: `Projected ${geometry.geometryId}`,
      kind: 'spline',
      anchor: geometry.fitPoints[0] ?? [0, 0],
      projected: { reference: target, geometry },
    }
  }

  const radius = geometry.kind === 'circle'
    ? geometry.radius
    : Math.hypot(
        geometry.startPosition[0] - geometry.centerPosition[0],
        geometry.startPosition[1] - geometry.centerPosition[1],
      )

  return {
    target,
    label: `Projected ${geometry.geometryId}`,
    kind: 'circle',
    anchor: geometry.centerPosition,
    projected: { reference: target, geometry },
    circle: {
      center: geometry.centerPosition,
      radius,
    },
  }
}
