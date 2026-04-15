import {
  createCommitSketchHistoryEntry,
  createCreateFeatureHistoryEntry,
  createEmptyOperationHistory,
  type ModelingOperationHistoryPayload,
} from '../../src/contracts/modeling/operation-history'
import type {
  CommitSketchRequest,
  CreateFeatureRequest,
} from '../../src/contracts/modeling/schema'
import { SKETCH_SCHEMA_VERSION } from '../../src/contracts/sketch/schema'
import { EXTRUDE_FEATURE_SCHEMA_VERSION } from '../../src/contracts/shared/versioning'

export const FEATURE_FIXTURE = {
  profile: 'sketch_primary.region_primary-outer',
  body: 'body_feature_extrude-1',
} as const

export const SECONDARY_EXTRUDE_FIXTURE = {
  profile: 'sketch_2.region_2-outer',
  body: 'body_feature_extrude-2',
} as const

const DOCUMENT_ID = 'doc_workspace' as const
const BASE_REVISION_ID = 'rev_fixture' as const
const SOLVER_CORRELATION = {
  requestId: 'request_fixture',
  projectionRequestId: 'request_fixture:project',
  validationRequestId: 'request_fixture:validate',
  solveRequestId: 'request_fixture:solve',
  regionRequestId: 'request_fixture:regions',
} as const

type RectangleBounds = {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

function createRectangleSketchDefinition(
  sketchId: `sketch_${string}`,
  idPrefix: `${number}`,
  bounds: RectangleBounds,
): CommitSketchRequest['definition'] {
  const bottomLeftPointId = `sketch_point_${idPrefix}_rect-bottom-left` as const
  const bottomRightPointId = `sketch_point_${idPrefix}_rect-bottom-right` as const
  const topRightPointId = `sketch_point_${idPrefix}_rect-top-right` as const
  const topLeftPointId = `sketch_point_${idPrefix}_rect-top-left` as const
  const bottomEntityId = `sketch_entity_${idPrefix}_rect-bottom` as const
  const rightEntityId = `sketch_entity_${idPrefix}_rect-right` as const
  const topEntityId = `sketch_entity_${idPrefix}_rect-top` as const
  const leftEntityId = `sketch_entity_${idPrefix}_rect-left` as const

  return {
    schemaVersion: SKETCH_SCHEMA_VERSION,
    referenceIds: [],
    references: [],
    pointIds: [bottomLeftPointId, bottomRightPointId, topRightPointId, topLeftPointId],
    points: [
      {
        pointId: bottomLeftPointId,
        label: `Rectangle ${idPrefix} bottom left`,
        target: { kind: 'sketchPoint', sketchId, pointId: bottomLeftPointId },
        position: [bounds.minX, bounds.minY],
        isConstruction: false,
      },
      {
        pointId: bottomRightPointId,
        label: `Rectangle ${idPrefix} bottom right`,
        target: { kind: 'sketchPoint', sketchId, pointId: bottomRightPointId },
        position: [bounds.maxX, bounds.minY],
        isConstruction: false,
      },
      {
        pointId: topRightPointId,
        label: `Rectangle ${idPrefix} top right`,
        target: { kind: 'sketchPoint', sketchId, pointId: topRightPointId },
        position: [bounds.maxX, bounds.maxY],
        isConstruction: false,
      },
      {
        pointId: topLeftPointId,
        label: `Rectangle ${idPrefix} top left`,
        target: { kind: 'sketchPoint', sketchId, pointId: topLeftPointId },
        position: [bounds.minX, bounds.maxY],
        isConstruction: false,
      },
    ],
    entityIds: [bottomEntityId, rightEntityId, topEntityId, leftEntityId],
    entities: [
      {
        kind: 'lineSegment',
        entityId: bottomEntityId,
        label: `Rectangle ${idPrefix} bottom`,
        target: { kind: 'sketchEntity', sketchId, entityId: bottomEntityId },
        isConstruction: false,
        startPointId: bottomLeftPointId,
        endPointId: bottomRightPointId,
      },
      {
        kind: 'lineSegment',
        entityId: rightEntityId,
        label: `Rectangle ${idPrefix} right`,
        target: { kind: 'sketchEntity', sketchId, entityId: rightEntityId },
        isConstruction: false,
        startPointId: bottomRightPointId,
        endPointId: topRightPointId,
      },
      {
        kind: 'lineSegment',
        entityId: topEntityId,
        label: `Rectangle ${idPrefix} top`,
        target: { kind: 'sketchEntity', sketchId, entityId: topEntityId },
        isConstruction: false,
        startPointId: topRightPointId,
        endPointId: topLeftPointId,
      },
      {
        kind: 'lineSegment',
        entityId: leftEntityId,
        label: `Rectangle ${idPrefix} left`,
        target: { kind: 'sketchEntity', sketchId, entityId: leftEntityId },
        isConstruction: false,
        startPointId: topLeftPointId,
        endPointId: bottomLeftPointId,
      },
    ],
    constraintIds: [
      `constraint_${idPrefix}_bottom-horizontal`,
      `constraint_${idPrefix}_top-horizontal`,
      `constraint_${idPrefix}_right-vertical`,
      `constraint_${idPrefix}_left-vertical`,
    ],
    constraints: [
      {
        constraintId: `constraint_${idPrefix}_bottom-horizontal`,
        kind: 'horizontal',
        label: `Rectangle ${idPrefix} bottom horizontal`,
        entityId: bottomEntityId,
      },
      {
        constraintId: `constraint_${idPrefix}_top-horizontal`,
        kind: 'horizontal',
        label: `Rectangle ${idPrefix} top horizontal`,
        entityId: topEntityId,
      },
      {
        constraintId: `constraint_${idPrefix}_right-vertical`,
        kind: 'vertical',
        label: `Rectangle ${idPrefix} right vertical`,
        entityId: rightEntityId,
      },
      {
        constraintId: `constraint_${idPrefix}_left-vertical`,
        kind: 'vertical',
        label: `Rectangle ${idPrefix} left vertical`,
        entityId: leftEntityId,
      },
    ],
    dimensionIds: [`dimension_${idPrefix}_width`, `dimension_${idPrefix}_height`],
    dimensions: [
      {
        dimensionId: `dimension_${idPrefix}_width`,
        kind: 'distance',
        label: `Rectangle ${idPrefix} width`,
        axis: 'horizontal',
        pointIds: [bottomLeftPointId, bottomRightPointId],
        value: bounds.maxX - bounds.minX,
      },
      {
        dimensionId: `dimension_${idPrefix}_height`,
        kind: 'distance',
        label: `Rectangle ${idPrefix} height`,
        axis: 'vertical',
        pointIds: [bottomRightPointId, topRightPointId],
        value: bounds.maxY - bounds.minY,
      },
    ],
  }
}

function createCommitSketchRequest(
  sketchId: `sketch_${string}`,
  label: string,
  idPrefix: `${number}`,
  bounds: RectangleBounds,
): CommitSketchRequest {
  return {
    contractVersion: 'modeling-contract/v1alpha1',
    documentId: DOCUMENT_ID,
    baseRevisionId: BASE_REVISION_ID,
    solverCorrelation: SOLVER_CORRELATION,
    sketchId,
    sketchLabel: label,
    plane: {
      key: 'xy',
      support: { kind: 'construction', constructionId: 'construction_plane-xy' },
      frame: {
        origin: [0, 0, 0],
        xAxis: [1, 0, 0],
        yAxis: [0, 1, 0],
        normal: [0, 0, 1],
        linearUnit: 'documentLength',
        handedness: 'rightHanded',
      },
    },
    planeTarget: { kind: 'construction', constructionId: 'construction_plane-xy' },
    planeKey: 'xy',
    definition: createRectangleSketchDefinition(sketchId, idPrefix, bounds),
  }
}

function createExtrudeFeatureRequest(
  sketchId: `sketch_${string}`,
  regionId: `region_${string}`,
): CreateFeatureRequest {
  return {
    contractVersion: 'modeling-contract/v1alpha1',
    documentId: DOCUMENT_ID,
    baseRevisionId: BASE_REVISION_ID,
    definition: {
      kind: 'extrude',
      featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
      parameters: {
        profiles: [{ kind: 'region', sketchId, regionId }],
        startExtent: { kind: 'profilePlane' },
        endExtent: { kind: 'blind', direction: 'positive', distance: 10 },
        operation: 'newBody',
        booleanScope: { kind: 'standalone' },
      },
    },
  }
}

export function createRectangleProfileOperationHistory(): ModelingOperationHistoryPayload {
  const sketchRequest = createCommitSketchRequest(
    'sketch_primary',
    'Fixture Sketch',
    '1',
    { minX: -15.5, minY: -5, maxX: -5, maxY: 4.5 },
  )

  return {
    ...createEmptyOperationHistory(DOCUMENT_ID),
    entries: [createCommitSketchHistoryEntry(sketchRequest, 'sketch_primary')],
  }
}

export function createBaseExtrudeOperationHistory(): ModelingOperationHistoryPayload {
  const sketchRequest = createCommitSketchRequest(
    'sketch_primary',
    'Fixture Sketch',
    '1',
    { minX: -15.5, minY: -5, maxX: -5, maxY: 4.5 },
  )

  return {
    ...createEmptyOperationHistory(DOCUMENT_ID),
    entries: [
      createCommitSketchHistoryEntry(sketchRequest, 'sketch_primary'),
      createCreateFeatureHistoryEntry(
        createExtrudeFeatureRequest('sketch_primary', 'region_primary-outer'),
      ),
    ],
  }
}

export function createTwoExtrudeBodiesOperationHistory(): ModelingOperationHistoryPayload {
  const firstSketchRequest = createCommitSketchRequest(
    'sketch_primary',
    'Fixture Sketch',
    '1',
    { minX: -15.5, minY: -5, maxX: -5, maxY: 4.5 },
  )
  const secondSketchRequest = createCommitSketchRequest(
    'sketch_2',
    'Fixture Sketch 2',
    '2',
    { minX: -10.5, minY: -5, maxX: 0, maxY: 4.5 },
  )

  return {
    ...createEmptyOperationHistory(DOCUMENT_ID),
    entries: [
      createCommitSketchHistoryEntry(firstSketchRequest, 'sketch_primary'),
      createCreateFeatureHistoryEntry(
        createExtrudeFeatureRequest('sketch_primary', 'region_primary-outer'),
      ),
      createCommitSketchHistoryEntry(secondSketchRequest, 'sketch_2'),
      createCreateFeatureHistoryEntry(
        createExtrudeFeatureRequest('sketch_2', 'region_2-outer'),
      ),
    ],
  }
}
