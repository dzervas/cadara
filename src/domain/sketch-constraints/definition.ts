import type {
  ConstraintDefinition,
  DimensionDefinition,
  SketchDefinition,
  SketchEntityDefinition,
  SketchPoint2D,
  SketchPointDefinition,
} from '@/contracts/sketch/schema'
import type { ProjectedSketchReferenceRecord } from '@/contracts/solver/schema'
import type { PrimitiveRef } from '@/domain/editor/schema'
import type { ToolIconId, ToolbarMode } from '@/domain/tools/schema'
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
  | 'dimensionDistance'
  | 'dimensionHorizontal'
  | 'dimensionVertical'
  | 'dimensionRadius'

export type SketchConstraintSelectionKind = 'point' | 'line' | 'circle'

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

export interface SketchConstraintMetadata<TToolId extends SketchConstraintToolId = SketchConstraintToolId> {
  id: TToolId
  name: string
  tooltip: string
  icon: ToolIconId
  group: 'constraints' | 'dimensions'
  modes: readonly ToolbarMode[]
}

export interface SketchConstraintTargetRecord {
  target: PrimitiveRef
  label: string
  kind: SketchConstraintSelectionKind
  anchor: SketchPoint2D
  point?: SketchPointDefinition
  entity?: SketchEntityDefinition
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
}

export interface SketchConstraintCommitInput {
  sequence: number
  selectedTargets: readonly SketchConstraintTargetRecord[]
  pointer: SketchPoint2D | null
  referenceKind?: SketchToolDimensionReferenceKind | null
  value: number | null
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

  if (!entity || entity.kind !== 'circle') {
    return null
  }

  return {
    target,
    label: entity.label,
    kind: 'circle',
    anchor: findPoint(definition, entity.centerPointId)?.position ?? [0, 0],
    entity,
    circle: {
      center: findPoint(definition, entity.centerPointId)?.position ?? [0, 0],
      radius: entity.radius,
    },
  }
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
