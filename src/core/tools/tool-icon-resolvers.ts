import type {
  DocumentHistoryItemRecord,
  FeatureSnapshotRecord,
  ObjectTreeNodeRecord,
} from '@/contracts/modeling/schema'
import type {
  ConstraintDefinition,
  SketchDefinition,
  SketchEntityDefinition,
} from '@/contracts/sketch/schema'
import { getRegisteredFeatureAuthoringDefinitions } from '@/core/feature-authoring/registry'
import type { ToolIconId } from '@/core/tools/schema'

type SketchHistoryIconItem = {
  kind: 'operation' | 'entity' | 'constraint' | 'dimension'
  id: string
}

export function getFeatureSnapshotToolIcon(feature: FeatureSnapshotRecord | null): ToolIconId | null {
  if (!feature) {
    return null
  }

  return getRegisteredFeatureAuthoringDefinitions().find((definition) =>
    definition.metadata.kind === feature.definition.kind,
  )?.metadata.icon ?? null
}

export function getDocumentHistoryItemToolIcon(
  item: DocumentHistoryItemRecord,
  features: readonly FeatureSnapshotRecord[],
): ToolIconId | null {
  if (item.kind === 'sketch') {
    return 'sketch'
  }

  const feature = features.find((entry) => entry.featureId === item.featureId) ?? null
  return getFeatureSnapshotToolIcon(feature)
}

export function getObjectTreeNodeToolIcon(item: ObjectTreeNodeRecord): ToolIconId | null {
  switch (item.kind) {
    case 'sketch':
      return 'sketch'
    case 'construction':
      return 'plane'
    case 'body':
      return null
  }
}

export function getSketchHistoryItemToolIcon(
  item: SketchHistoryIconItem,
  definition: SketchDefinition,
): ToolIconId | null {
  switch (item.kind) {
    case 'operation': {
      const operation = definition.authoringOperations?.find((entry) => entry.operationId === item.id) ?? null
      return operation ? getSketchOperationToolIcon(operation.kind) : null
    }
    case 'entity': {
      const entity = definition.entities.find((entry) => entry.entityId === item.id) ?? null
      return entity ? getSketchEntityToolIcon(entity) : null
    }
    case 'constraint': {
      const constraint = definition.constraints.find((entry) => entry.constraintId === item.id) ?? null
      return constraint ? getSketchConstraintToolIcon(constraint) : null
    }
    case 'dimension': {
      const dimension = definition.dimensions.find((entry) => entry.dimensionId === item.id) ?? null
      return dimension ? getSketchDimensionToolIcon() : null
    }
  }
}

function getSketchOperationToolIcon(kind: NonNullable<SketchDefinition['authoringOperations']>[number]['kind']): ToolIconId | null {
  switch (kind) {
    case 'rectangle':
    case 'centerPointRectangle':
    case 'alignedRectangle':
      return 'rectangle'
    case 'line':
    case 'midpointLine':
      return 'line'
    case 'circle':
    case 'threePointCircle':
    case 'centerPointArc':
    case 'threePointArc':
    case 'tangentArc':
      return 'circle'
    case 'spline':
    case 'controlPointSpline':
    case 'ellipse':
    case 'ellipticalArc':
    case 'conic':
    case 'bezierCurve':
    case 'profileText':
      return 'spline'
    case 'constraint':
      return 'constraintCoincident'
    case 'dimension':
      return 'dimension'
    case 'referenceImage':
      return 'import'
    case 'delete':
    case 'edit':
    case 'derived':
    case 'point':
    case 'construction':
    case 'reference':
    case 'inscribedPolygon':
    case 'circumscribedPolygon':
    case 'operation':
      return null
  }
}

function getSketchEntityToolIcon(entity: SketchEntityDefinition): ToolIconId | null {
  switch (entity.kind) {
    case 'lineSegment':
      return 'line'
    case 'circle':
    case 'arc':
      return 'circle'
    case 'spline':
      return 'spline'
    case 'ellipse':
    case 'ellipticalArc':
    case 'conic':
    case 'bezierCurve':
    case 'profileText':
      return 'spline'
    case 'point':
      return null
  }
}

function getSketchConstraintToolIcon(constraint: ConstraintDefinition): ToolIconId | null {
  switch (constraint.kind) {
    case 'coincident':
    case 'coincidentProjectedPoint':
      return 'constraintCoincident'
    case 'collinear':
    case 'collinearProjectedLine':
      return 'constraintCollinear'
    case 'parallel':
    case 'parallelProjectedLine':
      return 'constraintParallel'
    case 'perpendicular':
    case 'perpendicularProjectedLine':
      return 'constraintPerpendicular'
    case 'tangent':
    case 'tangentProjectedCurve':
      return 'constraintTangent'
    case 'equalLength':
      return 'constraintEqual'
    case 'horizontal':
      return 'constraintHorizontal'
    case 'vertical':
      return 'constraintVertical'
    case 'concentric':
    case 'concentricProjectedCurve':
      return 'constraintConcentric'
    case 'midpoint':
    case 'midpointProjectedLine':
      return 'constraintMidpoint'
    case 'normal':
    case 'normalProjectedCurve':
      return 'constraintNormal'
    case 'pointOnCurve':
    case 'pointOnProjectedCurve':
      return 'constraintPierce'
    case 'symmetric':
    case 'symmetricProjectedLine':
      return 'constraintSymmetric'
    case 'fixPoint':
      return 'constraintFix'
    case 'angle':
      return null
  }
}

function getSketchDimensionToolIcon(): ToolIconId {
  return 'dimension'
}
