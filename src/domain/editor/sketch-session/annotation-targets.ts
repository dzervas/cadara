import type {
  SketchEntityId,
  SketchId,
  SketchPointId,
} from '@/contracts/shared/ids'
import type {
  ConstraintDefinition,
  DimensionDefinition,
  ProjectedSketchGeometryRef,
} from '@/contracts/sketch/schema'
import type {
  PrimitiveRef,
} from '@/core/editor/schema'

export function createProjectedPrimitiveRef(
  reference: ProjectedSketchGeometryRef & { kind: NonNullable<ProjectedSketchGeometryRef['kind']> },
): PrimitiveRef {
  return {
    kind: 'projectedReferenceGeometry',
    referenceId: reference.referenceId,
    geometryId: reference.geometryId,
    geometryKind: reference.kind === 'projectedPoint'
      ? 'point'
      : reference.kind === 'projectedLineSegment'
        ? 'lineSegment'
        : reference.kind === 'projectedCircle'
          ? 'circle'
          : reference.kind === 'projectedArc'
            ? 'arc'
            : 'spline',
  }
}

export function createReferencePrimitiveRef(
  operand: {
    kind: string
    reference?: ProjectedSketchGeometryRef & { kind: NonNullable<ProjectedSketchGeometryRef['kind']> }
    datum?: 'origin' | 'xAxis' | 'yAxis'
  },
  sketchId: SketchId,
): PrimitiveRef | null {
  if (operand.kind === 'projectedGeometry' && operand.reference) {
    return createProjectedPrimitiveRef(operand.reference)
  }

  if (operand.kind === 'sketchDatum' && operand.datum) {
    return {
      kind: 'sketchDatumReference',
      sketchId,
      datumId: operand.datum,
      geometryKind: operand.datum === 'origin' ? 'point' : 'lineSegment',
    }
  }

  return null
}

function createSketchEntityRef(sketchId: SketchId, entityId: SketchEntityId): PrimitiveRef {
  return { kind: 'sketchEntity', sketchId, entityId }
}

function createSketchPointRef(sketchId: SketchId, pointId: SketchPointId): PrimitiveRef {
  return { kind: 'sketchPoint', sketchId, pointId }
}

export function getConstraintAffectedGeometryRefs(
  sketchId: SketchId,
  constraint: ConstraintDefinition,
): readonly PrimitiveRef[] {
  switch (constraint.kind) {
    case 'coincident':
    case 'angle':
      return constraint.pointIds.map((pointId) => createSketchPointRef(sketchId, pointId))
    case 'fixPoint':
      return [createSketchPointRef(sketchId, constraint.pointId)]
    case 'horizontal':
    case 'vertical':
      return [createSketchEntityRef(sketchId, constraint.entityId)]
    case 'parallel':
    case 'perpendicular':
    case 'equalLength':
    case 'tangent':
    case 'concentric':
      return constraint.entityIds.map((entityId) => createSketchEntityRef(sketchId, entityId))
    case 'midpoint':
      return [
        createSketchPointRef(sketchId, constraint.point.pointId),
        createSketchEntityRef(sketchId, constraint.line.entityId),
      ]
    case 'midpointProjectedLine':
      return [
        createSketchPointRef(sketchId, constraint.point.pointId),
        createReferencePrimitiveRef(constraint.projectedLine, sketchId)!,
      ]
    case 'pointOnCurve':
      return [
        createSketchPointRef(sketchId, constraint.point.pointId),
        createSketchEntityRef(sketchId, constraint.curve.entityId),
      ]
    case 'normal':
      return [
        createSketchPointRef(sketchId, constraint.point.pointId),
        createSketchEntityRef(sketchId, constraint.line.entityId),
        createSketchEntityRef(sketchId, constraint.curve.entityId),
      ]
    case 'normalProjectedCurve':
      return [
        createSketchPointRef(sketchId, constraint.point.pointId),
        createSketchEntityRef(sketchId, constraint.line.entityId),
        createReferencePrimitiveRef(constraint.projectedCurve, sketchId)!,
      ]
    case 'symmetric':
      return [
        ...constraint.pointIds.map((pointId) => createSketchPointRef(sketchId, pointId)),
        createSketchEntityRef(sketchId, constraint.axis.entityId),
      ]
    case 'symmetricProjectedLine':
      return [
        ...constraint.pointIds.map((pointId) => createSketchPointRef(sketchId, pointId)),
        createReferencePrimitiveRef(constraint.projectedLine, sketchId)!,
      ]
    case 'coincidentProjectedPoint':
      return [
        createSketchPointRef(sketchId, constraint.point.pointId),
        createReferencePrimitiveRef(constraint.projectedPoint, sketchId)!,
      ]
    case 'pointOnProjectedCurve':
      return [
        createSketchPointRef(sketchId, constraint.point.pointId),
        createReferencePrimitiveRef(constraint.projectedCurve, sketchId)!,
      ]
    case 'parallelProjectedLine':
    case 'perpendicularProjectedLine':
      return [
        createSketchEntityRef(sketchId, constraint.line.entityId),
        createReferencePrimitiveRef(constraint.projectedLine, sketchId)!,
      ]
    case 'tangentProjectedCurve':
    case 'concentricProjectedCurve':
      return [
        createSketchEntityRef(sketchId, constraint.curve.entityId),
        createReferencePrimitiveRef(constraint.projectedCurve, sketchId)!,
      ]
  }
}

export function getDimensionAffectedGeometryRefs(
  sketchId: SketchId,
  dimension: DimensionDefinition,
): readonly PrimitiveRef[] {
  const operandRef = (
    operand: {
      kind: string
      pointId?: SketchPointId
      entityId?: SketchEntityId
      reference?: ProjectedSketchGeometryRef & { kind: NonNullable<ProjectedSketchGeometryRef['kind']> }
      datum?: 'origin' | 'xAxis' | 'yAxis'
    },
  ): PrimitiveRef | null => {
    if (operand.kind === 'localPoint' && operand.pointId) {
      return createSketchPointRef(sketchId, operand.pointId)
    }

    if (operand.kind === 'localEntity' && operand.entityId) {
      return createSketchEntityRef(sketchId, operand.entityId)
    }

    if (operand.kind === 'projectedGeometry' && operand.reference) {
      return createProjectedPrimitiveRef(operand.reference)
    }

    if (operand.kind === 'sketchDatum' && operand.datum) {
      return {
        kind: 'sketchDatumReference',
        sketchId,
        datumId: operand.datum,
        geometryKind: operand.datum === 'origin' ? 'point' : 'lineSegment',
      }
    }

    return null
  }

  switch (dimension.kind) {
    case 'distance':
    case 'horizontalDistance':
    case 'verticalDistance':
      return dimension.pointIds.map((pointId) => createSketchPointRef(sketchId, pointId))
    case 'pointDatumDistance':
      return [
        createSketchPointRef(sketchId, dimension.point.pointId),
        createReferencePrimitiveRef(dimension.datum, sketchId)!,
      ]
    case 'circleRadius':
    case 'diameter':
    case 'lineLength':
      return [createSketchEntityRef(sketchId, dimension.entityId)]
    case 'lineDistance':
    case 'lineAngle':
      return dimension.lines.map(operandRef).filter((ref): ref is PrimitiveRef => ref !== null)
    case 'linePointDistance':
      return [operandRef(dimension.line), operandRef(dimension.point)].filter((ref): ref is PrimitiveRef => ref !== null)
    case 'arcStartPointCoincident':
    case 'arcEndPointCoincident':
      return [
        createSketchEntityRef(sketchId, dimension.entityId),
        createSketchPointRef(sketchId, dimension.pointId),
      ]
  }
}
