import { test } from 'bun:test'

import type { SketchDefinition } from '@/contracts/sketch/schema'
import {
  solveSketchDefinitionCore,
} from '@/contracts/sketch/solver-core'
import { createReferenceImageOperation } from '@/domain/reference-image/operations'
import {
  buildReferenceImageAnchorProjectedReferences,
  createReferenceImageAnchorGeometryId,
  createReferenceImageAnchorReferenceId,
  mergeReferenceImageAnchorReferences,
} from '@/domain/reference-image-calibration/export/references'
import {
  createReferenceImageCalibrationAnchor,
  solveReferenceImageOperationState,
} from '@/domain/reference-image-calibration/state'

test('src/domain/reference-image-calibration/export/references.spec.ts', () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const operation = createReferenceImageOperation({
    sequence: 1,
    sketchId: 'sketch_primary',
    payload: {
      mediaType: 'image/png',
      fileName: 'reference.png',
      pixelWidth: 400,
      pixelHeight: 200,
      base64Data: 'cG5n',
    },
  })

  const solvedOperation = {
    ...operation,
    ownedState: solveReferenceImageOperationState({
      ...operation.ownedState,
      calibration: {
        ...operation.ownedState.calibration!,
        anchors: [
          createReferenceImageCalibrationAnchor({
            anchorId: 'anchor_a',
            anchorIndex: 0,
            uv: [0.25, 0.5],
            worldPosition: [10, 12],
          }),
          createReferenceImageCalibrationAnchor({
            anchorId: 'anchor_b',
            anchorIndex: 1,
            uv: [0.75, 0.5],
            worldPosition: [60, 12],
          }),
        ],
      },
    }),
  }

  const definition = mergeReferenceImageAnchorReferences({
    schemaVersion: 'sketch-definition/v1alpha1',
    referenceIds: [],
    references: [],
    pointIds: ['sketch_point_local'],
    points: [{
      pointId: 'sketch_point_local',
      label: 'Local',
      target: { kind: 'sketchPoint', sketchId: 'sketch_primary', pointId: 'sketch_point_local' },
      position: [0, 0],
      isConstruction: false,
    }],
    entityIds: [],
    entities: [],
    constraintIds: ['constraint_anchor'],
    constraints: [{
      constraintId: 'constraint_anchor',
      kind: 'coincidentProjectedPoint',
      label: 'Anchor coincidence',
      point: { kind: 'localPoint', pointId: 'sketch_point_local' },
      projectedPoint: {
        kind: 'projectedGeometry',
        reference: {
          kind: 'projectedPoint',
          referenceId: createReferenceImageAnchorReferenceId(solvedOperation.operationId, 'anchor_a'),
          geometryId: createReferenceImageAnchorGeometryId(solvedOperation.operationId, 'anchor_a'),
        },
      },
    }],
    dimensionIds: [],
    dimensions: [],
    svgRenderingEnabled: true,
    derivedRelationships: [],
    authoringOperations: [solvedOperation],
  } satisfies SketchDefinition, 'sketch_primary')
  const projectedReferences = buildReferenceImageAnchorProjectedReferences(definition)
  const solved = solveSketchDefinitionCore({
    definition,
    projectedReferences,
    tolerances: {
      coincidence: 1e-6,
      angleRadians: 1e-6,
      minimumSegmentLength: 1e-6,
    },
    partialSolvePolicy: 'bestEffort',
  })

  assert(
    projectedReferences.length === 2
      && projectedReferences.every((reference) => reference.status === 'projected' && reference.geometry[0]?.kind === 'point'),
    'Calibrated reference images should export only fixed point geometry into the main sketch.',
  )
  const solvedPoint = solved.solvedSnapshot.solvedPoints.find((point) => point.pointId === 'sketch_point_local')
  assert(
    solvedPoint
      && Math.abs(solvedPoint.solvedPosition[0] - 10) < 1e-3
      && Math.abs(solvedPoint.solvedPosition[1] - 12) < 1e-3,
    'Main sketch solves should consume only the exported fixed anchor point from the dedicated calibration solver.',
  )
})

test('src/domain/reference-image-calibration/export/references.spec.ts does not export weak calibration anchors as fixed geometry', () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const operation = createReferenceImageOperation({
    sequence: 1,
    sketchId: 'sketch_primary',
    payload: {
      mediaType: 'image/png',
      fileName: 'reference.png',
      pixelWidth: 400,
      pixelHeight: 200,
      base64Data: 'cG5n',
    },
  })

  const projectedReferences = buildReferenceImageAnchorProjectedReferences({
    schemaVersion: 'sketch-definition/v1alpha1',
    referenceIds: [],
    references: [],
    pointIds: [],
    points: [],
    entityIds: [],
    entities: [],
    constraintIds: [],
    constraints: [],
    dimensionIds: [],
    dimensions: [],
    svgRenderingEnabled: true,
    derivedRelationships: [],
    authoringOperations: [{
      ...operation,
      ownedState: {
        ...operation.ownedState,
        calibration: {
          ...operation.ownedState.calibration!,
          anchors: [
            createReferenceImageCalibrationAnchor({
              anchorId: 'anchor_a',
              anchorIndex: 0,
              uv: [0.5, 0.5],
              worldPosition: [10, 12],
            }),
          ],
        },
      },
    }],
  } satisfies SketchDefinition)

  assert(projectedReferences[0]?.status === 'ambiguous', 'Underconstrained calibration anchors must not export as fixed projected geometry.')
  assert(projectedReferences[0]?.geometry.length === 0, 'Weak calibration exports should not expose point geometry to the main sketch.')
})
