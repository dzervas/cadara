import { test } from 'bun:test'

import { expectTrue } from '@/testing/expect.spec'
import { solveSketchDefinitionCore } from '@/contracts/sketch/solver-core'
import {
  acceptSketchDraw,
  appendReferenceImageOperations,
  beginSketchTool,
  createSketchSessionFromSnapshot,
  createNewSketchSession,
  deleteSelectedSketchGeometry,
  deleteSketchHistoryOperation,
  getSketchSessionDisplayRenderables,
  startSketchDraw,
  updateReferenceImageOperationStates,
} from '@/domain/editor/sketch-session'
import { createStandardPlaneDefinition } from '@/domain/modeling/opencascade-kernel-seed'
import { REFERENCE_IMAGE_CALIBRATION_MODE_ID, type ReferenceImageCalibrationModeState } from '@/domain/reference-image-calibration/mode/shared'
import { solveReferenceImageOperationState } from '@/domain/reference-image-calibration/state'
import { createReferenceImageEditOperation, createReferenceImageOperation } from '@/domain/reference-image/operations'

function loadCapturedReferenceImageSketchFixture() {
  const sketch = {
    sketchId: 'sketch_primary',
    label: 'Sketch Draft',
    plane: createStandardPlaneDefinition('xy'),
    planeTarget: { kind: 'construction' as const, constructionId: 'construction_plane-xy' },
    planeKey: 'xy' as const,
    definition: {
      schemaVersion: 'sketch-definition/v1alpha1' as const,
      referenceIds: [],
      references: [],
      pointIds: [
        'sketch_point_sketch_operation_1_reference_image_sketch_operation_1_reference_image_anchor_1',
        'sketch_point_sketch_operation_1_reference_image_sketch_operation_1_reference_image_anchor_2',
      ],
      points: [
        {
          pointId: 'sketch_point_sketch_operation_1_reference_image_sketch_operation_1_reference_image_anchor_1',
          label: 'Anchor 1',
          target: {
            kind: 'sketchPoint' as const,
            sketchId: 'sketch_primary',
            pointId: 'sketch_point_sketch_operation_1_reference_image_sketch_operation_1_reference_image_anchor_1',
          },
          position: [66.07556708127112, 23.759903721283415] as const,
          isConstruction: true,
        },
        {
          pointId: 'sketch_point_sketch_operation_1_reference_image_sketch_operation_1_reference_image_anchor_2',
          label: 'Anchor 2',
          target: {
            kind: 'sketchPoint' as const,
            sketchId: 'sketch_primary',
            pointId: 'sketch_point_sketch_operation_1_reference_image_sketch_operation_1_reference_image_anchor_2',
          },
          position: [66.75807778062575, -22.650823834832128] as const,
          isConstruction: true,
        },
      ],
      entityIds: [
        'sketch_entity_sketch_operation_1_reference_image_sketch_point_sketch_operation_1_reference_image_sketch_operation_1_reference_image_anchor_1_point',
        'sketch_entity_sketch_operation_1_reference_image_sketch_point_sketch_operation_1_reference_image_sketch_operation_1_reference_image_anchor_2_point',
      ],
      entities: [
        {
          kind: 'point' as const,
          entityId: 'sketch_entity_sketch_operation_1_reference_image_sketch_point_sketch_operation_1_reference_image_sketch_operation_1_reference_image_anchor_1_point',
          label: 'Anchor 1',
          target: {
            kind: 'sketchEntity' as const,
            sketchId: 'sketch_primary',
            entityId: 'sketch_entity_sketch_operation_1_reference_image_sketch_point_sketch_operation_1_reference_image_sketch_operation_1_reference_image_anchor_1_point',
          },
          isConstruction: true,
          pointId: 'sketch_point_sketch_operation_1_reference_image_sketch_operation_1_reference_image_anchor_1',
        },
        {
          kind: 'point' as const,
          entityId: 'sketch_entity_sketch_operation_1_reference_image_sketch_point_sketch_operation_1_reference_image_sketch_operation_1_reference_image_anchor_2_point',
          label: 'Anchor 2',
          target: {
            kind: 'sketchEntity' as const,
            sketchId: 'sketch_primary',
            entityId: 'sketch_entity_sketch_operation_1_reference_image_sketch_point_sketch_operation_1_reference_image_sketch_operation_1_reference_image_anchor_2_point',
          },
          isConstruction: true,
          pointId: 'sketch_point_sketch_operation_1_reference_image_sketch_operation_1_reference_image_anchor_2',
        },
      ],
      constraintIds: [],
      constraints: [],
      dimensionIds: [],
      dimensions: [],
      styleIds: [],
      styles: [],
      svgRenderingEnabled: true,
      derivedRelationships: [],
      authoringOperations: [
        {
          operationId: 'sketch_operation_1_reference-image',
          label: 'cadara-mock.png',
          kind: 'referenceImage' as const,
          targets: {
            created: [{ kind: 'operation' as const, operationId: 'sketch_operation_1_reference-image' }],
          },
          ownedState: {
            kind: 'referenceImage' as const,
            image: {
              mediaType: 'image/png',
              fileName: 'cadara-mock.png',
              pixelWidth: 1254,
              pixelHeight: 1254,
              base64Data: 'fixture-image-data',
            },
            placement: {
              center: [0, 0] as const,
              width: 199.99999999999994,
              height: 199.99999999999994,
              rotationRadians: 0,
            },
            calibration: {
              scaleMode: 'lockedAspect' as const,
              showExportedAnchorsInSketch: true,
              anchors: [],
            },
          },
        },
        {
          operationId: 'sketch_operation_2_edit-reference-image',
          label: 'cadara-mock.png',
          kind: 'edit' as const,
          targets: {
            created: [
              { kind: 'point' as const, pointId: 'sketch_point_sketch_operation_1_reference_image_sketch_operation_1_reference_image_anchor_1' },
              { kind: 'point' as const, pointId: 'sketch_point_sketch_operation_1_reference_image_sketch_operation_1_reference_image_anchor_2' },
              {
                kind: 'entity' as const,
                entityId: 'sketch_entity_sketch_operation_1_reference_image_sketch_point_sketch_operation_1_reference_image_sketch_operation_1_reference_image_anchor_1_point',
              },
              {
                kind: 'entity' as const,
                entityId: 'sketch_entity_sketch_operation_1_reference_image_sketch_point_sketch_operation_1_reference_image_sketch_operation_1_reference_image_anchor_2_point',
              },
            ],
            edited: [{ kind: 'operation' as const, operationId: 'sketch_operation_1_reference-image' }],
          },
          createdGraph: {
            points: [
              {
                pointId: 'sketch_point_sketch_operation_1_reference_image_sketch_operation_1_reference_image_anchor_1',
                label: 'Anchor 1',
                target: {
                  kind: 'sketchPoint' as const,
                  sketchId: 'sketch_primary',
                  pointId: 'sketch_point_sketch_operation_1_reference_image_sketch_operation_1_reference_image_anchor_1',
                },
                position: [66.07556708127112, 23.759903721283415] as const,
                isConstruction: true,
              },
              {
                pointId: 'sketch_point_sketch_operation_1_reference_image_sketch_operation_1_reference_image_anchor_2',
                label: 'Anchor 2',
                target: {
                  kind: 'sketchPoint' as const,
                  sketchId: 'sketch_primary',
                  pointId: 'sketch_point_sketch_operation_1_reference_image_sketch_operation_1_reference_image_anchor_2',
                },
                position: [66.75807778062575, -22.650823834832128] as const,
                isConstruction: true,
              },
            ],
            entities: [
              {
                kind: 'point' as const,
                entityId: 'sketch_entity_sketch_operation_1_reference_image_sketch_point_sketch_operation_1_reference_image_sketch_operation_1_reference_image_anchor_1_point',
                label: 'Anchor 1',
                target: {
                  kind: 'sketchEntity' as const,
                  sketchId: 'sketch_primary',
                  entityId: 'sketch_entity_sketch_operation_1_reference_image_sketch_point_sketch_operation_1_reference_image_sketch_operation_1_reference_image_anchor_1_point',
                },
                isConstruction: true,
                pointId: 'sketch_point_sketch_operation_1_reference_image_sketch_operation_1_reference_image_anchor_1',
              },
              {
                kind: 'point' as const,
                entityId: 'sketch_entity_sketch_operation_1_reference_image_sketch_point_sketch_operation_1_reference_image_sketch_operation_1_reference_image_anchor_2_point',
                label: 'Anchor 2',
                target: {
                  kind: 'sketchEntity' as const,
                  sketchId: 'sketch_primary',
                  entityId: 'sketch_entity_sketch_operation_1_reference_image_sketch_point_sketch_operation_1_reference_image_sketch_operation_1_reference_image_anchor_2_point',
                },
                isConstruction: true,
                pointId: 'sketch_point_sketch_operation_1_reference_image_sketch_operation_1_reference_image_anchor_2',
              },
            ],
          },
          ownedState: {
            kind: 'referenceImage' as const,
            image: {
              mediaType: 'image/png',
              fileName: 'cadara-mock.png',
              pixelWidth: 1254,
              pixelHeight: 1254,
              base64Data: 'fixture-image-data',
            },
            placement: {
              center: [0, 0] as const,
              width: 199.99999999999994,
              height: 199.99999999999994,
              rotationRadians: 0,
            },
            calibration: {
              scaleMode: 'lockedAspect' as const,
              showExportedAnchorsInSketch: true,
              anchors: [
                {
                  anchorId: 'sketch_operation_1_reference-image_anchor_1',
                  label: 'Anchor 1',
                  uv: [0.8303778354063556, 0.3812004813935829] as const,
                  pointId: 'sketch_point_sketch_operation_1_reference_image_sketch_operation_1_reference_image_anchor_1',
                },
                {
                  anchorId: 'sketch_operation_1_reference-image_anchor_2',
                  label: 'Anchor 2',
                  uv: [0.8337903889031288, 0.6132541191741606] as const,
                  pointId: 'sketch_point_sketch_operation_1_reference_image_sketch_operation_1_reference_image_anchor_2',
                },
              ],
            },
          },
        },
      ],
    },
  }

  const solved = solveSketchDefinitionCore({
    definition: sketch.definition,
    projectedReferences: [],
    tolerances: {
      coincidence: 1e-6,
      angleRadians: 1e-6,
      minimumSegmentLength: 1e-6,
    },
    partialSolvePolicy: 'bestEffort',
  })

  return {
    ownerDocumentId: 'doc_fixture',
    ownerRevisionId: 'rev_fixture',
    ownerFeatureId: null,
    ownerSketchId: sketch.sketchId,
    ownerBodyId: null,
    sketchId: sketch.sketchId,
    label: sketch.label,
    plane: sketch.plane,
    planeTarget: sketch.planeTarget,
    planeKey: sketch.planeKey,
    sketch: {
      ownerDocumentId: 'doc_fixture',
      ownerRevisionId: 'rev_fixture',
      ownerFeatureId: null,
      ownerSketchId: sketch.sketchId,
      ownerBodyId: null,
      sketchId: sketch.sketchId,
      label: sketch.label,
      planeSupport: sketch.planeTarget,
      definition: sketch.definition,
      solvedSnapshot: solved.solvedSnapshot,
      regions: [],
    },
    solvedSketch: solved,
    projectedReferences: [],
  }
}

test('src/domain/editor/reference-image-operations.spec.ts keeps reference-image state operation-owned while rendering the latest payload', () => {  const plane = createStandardPlaneDefinition('xy')
  const session = appendReferenceImageOperations(createNewSketchSession(plane), [
    createReferenceImageOperation({
      sequence: 1,
      sketchId: 'sketch_draft',
      payload: {
        mediaType: 'image/png',
        fileName: 'reference-a.png',
        pixelWidth: 400,
        pixelHeight: 200,
        base64Data: 'cG5n',
      },
    }),
    createReferenceImageOperation({
      sequence: 2,
      sketchId: 'sketch_draft',
      payload: {
        mediaType: 'image/jpeg',
        fileName: 'reference-b.jpg',
        pixelWidth: 200,
        pixelHeight: 400,
        base64Data: 'anBn',
      },
    }),
  ])

  expectTrue(session.definition.points.length === 0, 'Reference-image imports should not materialize sketch points at import time.')
  expectTrue(session.definition.authoringOperations?.length === 2, 'Reference-image imports should commit as authoring operations.')

  const updated = updateReferenceImageOperationStates({
    session,
    updates: [{
      operationId: 'sketch_operation_1_reference-image',
      label: 'reference-a-updated.png',
      state: {
        kind: 'referenceImage',
        image: {
          mediaType: 'image/png',
          fileName: 'reference-a-updated.png',
          pixelWidth: 800,
          pixelHeight: 600,
          base64Data: 'dXBkYXRlZA==',
        },
        placement: {
          center: [12, -4],
          width: 240,
          height: 180,
          rotationRadians: 0.4,
        },
      },
    }],
  })

  const persistedCalibration = updated.definition.authoringOperations?.at(-1)?.ownedState?.kind === 'referenceImage'
    ? updated.definition.authoringOperations.at(-1)?.ownedState.calibration
    : undefined

  expectTrue(updated.definition.authoringOperations?.at(-1)?.kind === 'edit', 'Reference-image state updates should append edit authoring operations.')
  expectTrue(
    !updated.commitRequest?.definition.references.some((reference) => reference.kind === 'referenceImageAnchor'),
    'Committed sketch definitions must not persist derived reference-image anchor references.',
  )
  expectTrue(
    persistedCalibration === undefined || !('solveResult' in persistedCalibration),
    'Persisted reference-image operation state must not serialize runtime-only calibration solve output.',
  )

  const updatedRenderables = getSketchSessionDisplayRenderables(updated).filter((entry) => entry.target?.kind === 'sketchOperation')
  expectTrue(updatedRenderables[0]?.label === 'reference-a-updated.png', 'Reference-image updates should replay the latest operation label.')
  expectTrue(updatedRenderables[0]?.textureFill?.base64Data === 'dXBkYXRlZA==', 'Reference-image updates should replay the latest inline payload bytes for rendering.')

  const explicitEdit = appendReferenceImageOperations(session, [
    createReferenceImageEditOperation({
      sequence: session.sequence + 1,
      operationId: 'sketch_operation_2_reference-image',
      label: 'reference-b-adjusted.jpg',
      state: {
        kind: 'referenceImage',
        image: {
          mediaType: 'image/jpeg',
          fileName: 'reference-b-adjusted.jpg',
          pixelWidth: 200,
          pixelHeight: 400,
          base64Data: 'YWRqdXN0ZWQ=',
        },
        placement: {
          center: [-6, 8],
          width: 100,
          height: 200,
          rotationRadians: 1.2,
        },
      },
    }),
  ])
  const adjustedRenderables = getSketchSessionDisplayRenderables(explicitEdit).filter((entry) => entry.target?.kind === 'sketchOperation')
  expectTrue(
    adjustedRenderables[1]?.textureFill?.sourceKey.includes('reference-b-adjusted.jpg'),
    'Reference-image edit rows should update the active texture source token for the targeted operation.',
  )
})

test('src/domain/editor/reference-image-operations.spec.ts removes anchor bindings when a bound sketch point is deleted', () => {  const session = updateReferenceImageOperationStates({
    session: appendReferenceImageOperations(createNewSketchSession(createStandardPlaneDefinition('xy')), [
      createReferenceImageOperation({
        sequence: 1,
        sketchId: 'sketch_draft',
        payload: {
          mediaType: 'image/png',
          fileName: 'reference.png',
          pixelWidth: 400,
          pixelHeight: 200,
          base64Data: 'cG5n',
        },
      }),
    ]),
    updates: [{
      operationId: 'sketch_operation_1_reference-image',
      state: {
        kind: 'referenceImage',
        image: {
          mediaType: 'image/png',
          fileName: 'reference.png',
          pixelWidth: 400,
          pixelHeight: 200,
          base64Data: 'cG5n',
        },
        placement: {
          center: [0, 0],
          width: 200,
          height: 100,
          rotationRadians: 0,
        },
        calibration: {
          scaleMode: 'lockedAspect',
          anchors: [{
            anchorId: 'anchor-1',
            label: 'A1',
            uv: [0.25, 0.5],
            pointId: 'sketch_point_anchor_1',
          }],
        },
      },
      createdPoints: [{
        pointId: 'sketch_point_anchor_1',
        label: 'A1',
        target: { kind: 'sketchPoint', sketchId: 'sketch_draft', pointId: 'sketch_point_anchor_1' },
        position: [0, 0],
        isConstruction: true,
      }],
    }],
  })

  const deleted = deleteSelectedSketchGeometry(session, [{
    kind: 'sketchPoint',
    sketchId: 'sketch_draft',
    pointId: 'sketch_point_anchor_1',
  }])

  const latestOwnedState = deleted.definition.authoringOperations?.at(-1)?.ownedState
  expectTrue(latestOwnedState?.kind === 'referenceImage', 'Deleting a bound point should append a reference-image edit row after the delete.')
  expectTrue(latestOwnedState.calibration?.anchors.length === 0, 'Deleting a bound anchor point should detach the anchor binding from the reference-image operation.')
})

test('src/domain/editor/reference-image-operations.spec.ts renders draft reference-image payload overrides without projected anchor exports', () => {  const plane = createStandardPlaneDefinition('xy')
  const operationId = 'sketch_operation_1_reference-image'
  const committed = appendReferenceImageOperations(createNewSketchSession(plane), [
    createReferenceImageOperation({
      sequence: 1,
      sketchId: 'sketch_draft',
      payload: {
        mediaType: 'image/png',
        fileName: 'reference.png',
        pixelWidth: 400,
        pixelHeight: 200,
        base64Data: 'cG5n',
      },
    }),
  ])

  const draftState: ReferenceImageCalibrationModeState = {
    sketchId: 'sketch_draft',
    operationId,
    draftPoints: [
      {
        pointId: 'sketch_point_anchor_1',
        label: 'A1',
        target: { kind: 'sketchPoint', sketchId: 'sketch_draft', pointId: 'sketch_point_anchor_1' },
        position: [15, 5],
        isConstruction: true,
      },
    ],
    draftState: solveReferenceImageOperationState({
      kind: 'referenceImage',
      image: {
        mediaType: 'image/png',
        fileName: 'reference-updated.png',
        pixelWidth: 400,
        pixelHeight: 200,
        base64Data: 'dXBkYXRlZA==',
      },
      placement: {
        center: [15, 5],
        width: 200,
        height: 100,
        rotationRadians: 0,
      },
      calibration: {
        scaleMode: 'lockedAspect',
        anchors: [{
          anchorId: 'anchor-1',
          label: 'A1',
          uv: [0.25, 0.5],
          pointId: 'sketch_point_anchor_1',
        }],
      },
    }, {
      pointPositionsById: new Map([
        ['sketch_point_anchor_1', [15, 5] as const],
      ]),
    }),
    selectedAnchorId: 'anchor-1',
    pendingAnchorPlacement: false,
  }

  const renderables = getSketchSessionDisplayRenderables({
    ...committed,
    activeSpecialMode: {
      modeId: REFERENCE_IMAGE_CALIBRATION_MODE_ID,
      operationTarget: {
        kind: 'sketchOperation',
        sketchId: 'sketch_draft',
        operationId,
      },
      state: draftState,
      generation: 1,
      hoverTarget: null,
      selectedTarget: null,
      activeDragHandle: null,
      pendingEffect: null,
      pendingExit: false,
    },
  })

  const draftImage = renderables.find((entry) =>
    entry.target?.kind === 'sketchOperation' && entry.target.operationId === operationId
  )
  const projectedAnchor = renderables.find((entry) => entry.target?.kind === 'projectedReferenceGeometry')

  expectTrue(draftImage?.textureFill?.base64Data === 'dXBkYXRlZA==', 'Active calibration sessions should render the draft reference-image payload.')
  expectTrue(projectedAnchor === undefined, 'Draft calibration display should not synthesize projected anchor exports.')
})

test('src/domain/editor/reference-image-operations.spec.ts lets bound anchor points participate in ordinary sketch constraints', () => {  const definition = {
    schemaVersion: 'sketch-definition/v1alpha1' as const,
    referenceIds: [],
    references: [],
    pointIds: ['sketch_point_anchor', 'sketch_point_free'],
    points: [
      {
        pointId: 'sketch_point_anchor',
        label: 'Anchor',
        target: { kind: 'sketchPoint' as const, sketchId: 'sketch_primary', pointId: 'sketch_point_anchor' },
        position: [0, 0] as const,
        isConstruction: true,
      },
      {
        pointId: 'sketch_point_free',
        label: 'Free',
        target: { kind: 'sketchPoint' as const, sketchId: 'sketch_primary', pointId: 'sketch_point_free' },
        position: [10, 5] as const,
        isConstruction: false,
      },
    ],
    entityIds: ['sketch_entity_line'],
    entities: [{
      kind: 'lineSegment' as const,
      entityId: 'sketch_entity_line',
      label: 'Line',
      target: { kind: 'sketchEntity' as const, sketchId: 'sketch_primary', entityId: 'sketch_entity_line' },
      isConstruction: false,
      startPointId: 'sketch_point_anchor',
      endPointId: 'sketch_point_free',
    }],
    constraintIds: ['constraint_horizontal'],
    constraints: [{
      constraintId: 'constraint_horizontal',
      kind: 'horizontal' as const,
      label: 'Horizontal',
      entityId: 'sketch_entity_line',
    }],
    dimensionIds: [],
    dimensions: [],
    svgRenderingEnabled: true,
    derivedRelationships: [],
    authoringOperations: [{
      operationId: 'sketch_operation_1_reference-image',
      label: 'Reference image',
      kind: 'referenceImage' as const,
      targets: {
        created: [{ kind: 'operation' as const, operationId: 'sketch_operation_1_reference-image' }],
      },
      ownedState: {
        kind: 'referenceImage' as const,
        image: {
          mediaType: 'image/png',
          fileName: 'reference.png',
          pixelWidth: 400,
          pixelHeight: 200,
          base64Data: 'cG5n',
        },
        placement: {
          center: [0, 0] as const,
          width: 200,
          height: 100,
          rotationRadians: 0,
        },
        calibration: {
          scaleMode: 'lockedAspect' as const,
          anchors: [{
            anchorId: 'anchor-1',
            label: 'A1',
            uv: [0.25, 0.5] as const,
            pointId: 'sketch_point_anchor',
          }],
        },
      },
    }],
  }

  const solved = solveSketchDefinitionCore({
    definition,
    projectedReferences: [],
    tolerances: {
      coincidence: 1e-6,
      angleRadians: 1e-6,
      minimumSegmentLength: 1e-6,
    },
    partialSolvePolicy: 'bestEffort',
  })
  const anchorPoint = solved.solvedSnapshot.solvedPoints.find((point) => point.pointId === 'sketch_point_anchor')
  const freePoint = solved.solvedSnapshot.solvedPoints.find((point) => point.pointId === 'sketch_point_free')

  expectTrue(anchorPoint && freePoint, 'Expected solved line endpoints.')
  expectTrue(
    Math.abs(anchorPoint.solvedPosition[1] - freePoint.solvedPosition[1]) < 1e-6,
    'Bound anchor points should remain valid local targets for ordinary sketch constraints.',
  )
})

test('src/domain/editor/reference-image-operations.spec.ts reuses bound anchor point ids when drawing snapped lines', () => {  let session = createSketchSessionFromSnapshot(loadCapturedReferenceImageSketchFixture())
  const anchorPointIds = session.definition.authoringOperations?.[1]?.ownedState?.kind === 'referenceImage'
    ? session.definition.authoringOperations[1].ownedState.calibration?.anchors.map((anchor) => anchor.pointId) ?? []
    : []

  expectTrue(anchorPointIds.length === 2, 'Expected captured fixture to expose two bound anchor points.')

  session = beginSketchTool(session, 'line')
  session = startSketchDraw(session, [66.08, 23.76])
  expectTrue(session.activeSnap?.kind === 'endpoint', 'Bound anchor points should participate in ordinary endpoint snapping.')
  session = acceptSketchDraw(session, [66.76, -22.65])

  const committed = session.definition.entities.at(-1)
  expectTrue(committed?.kind === 'lineSegment', 'Expected snapped anchor draw to commit a line segment.')
  expectTrue(
    committed.startPointId === anchorPointIds[0] && committed.endPointId === anchorPointIds[1],
    'Snapped anchor lines should reuse the existing anchor point ids at both endpoints.',
  )
  expectTrue(
    session.definition.points.length === 2,
    'Connecting two existing anchors should not author duplicate endpoint points.',
  )
  expectTrue(
    !session.definition.constraints.some((constraint) => constraint.kind === 'coincident'),
    'Reused anchor endpoints should not need inferred coincident constraints.',
  )
})

test('src/domain/editor/reference-image-operations.spec.ts keeps captured debug-state anchors visible in normal sketch mode', () => {  const session = createSketchSessionFromSnapshot(loadCapturedReferenceImageSketchFixture())
  const renderables = getSketchSessionDisplayRenderables(session)

  const overlayAnchors = renderables.filter((renderable) =>
    renderable.markerLayer === 'overlay'
    && renderable.target?.kind === 'sketchPoint'
    && renderable.label.startsWith('Anchor ')
  )

  expectTrue(overlayAnchors.length === 2, 'Captured bound anchors should render explicit normal-mode overlay markers.')
  expectTrue(
    overlayAnchors.every((renderable) => renderable.geometry.kind === 'marker' && renderable.geometry.displayRadius >= 0.4),
    'Captured bound anchors should render enlarged overlay markers in normal sketch mode.',
  )
})

test('src/domain/editor/reference-image-operations.spec.ts deletes one reference-image history row without appending a new delete operation or disturbing other images', () => {  const session = updateReferenceImageOperationStates({
    session: appendReferenceImageOperations(createNewSketchSession(createStandardPlaneDefinition('xy')), [
      createReferenceImageOperation({
        sequence: 1,
        sketchId: 'sketch_draft',
        payload: {
          mediaType: 'image/png',
          fileName: 'reference-a.png',
          pixelWidth: 400,
          pixelHeight: 200,
          base64Data: 'aW1hZ2UtYQ==',
        },
      }),
      createReferenceImageOperation({
        sequence: 2,
        sketchId: 'sketch_draft',
        payload: {
          mediaType: 'image/png',
          fileName: 'reference-b.png',
          pixelWidth: 200,
          pixelHeight: 400,
          base64Data: 'aW1hZ2UtYg==',
        },
      }),
    ]),
    updates: [{
      operationId: 'sketch_operation_1_reference-image',
      label: 'reference-a-edited.png',
      state: {
        kind: 'referenceImage',
        image: {
          mediaType: 'image/png',
          fileName: 'reference-a-edited.png',
          pixelWidth: 500,
          pixelHeight: 250,
          base64Data: 'ZWRpdGVkLWE=',
        },
        placement: {
          center: [12, 6],
          width: 220,
          height: 110,
          rotationRadians: 0.2,
        },
      },
    }],
  })

  const deleted = deleteSketchHistoryOperation(session, 'sketch_operation_1_reference-image')
  const renderables = getSketchSessionDisplayRenderables(deleted)
    .filter((entry) => entry.target?.kind === 'sketchOperation')

  expectTrue(
    deleted.fullDefinition.authoringOperations?.every((operation) =>
      operation.operationId !== 'sketch_operation_1_reference-image'
      && operation.operationId !== 'sketch_operation_3_edit-reference-image',
    ),
    'Deleting a reference-image history row should prune direct operation-owned follow-up rows for that image.',
  )
  expectTrue(
    deleted.fullDefinition.authoringOperations?.every((operation) => operation.kind !== 'delete'),
    'Deleting a reference-image history row should not append a new delete operation.',
  )
  expectTrue(renderables.length === 1, 'Deleting one reference-image history row should preserve other committed reference images.')
  expectTrue(renderables[0]?.label === 'reference-b.png', 'Deleting one reference-image history row should leave the untargeted image intact.')
})
