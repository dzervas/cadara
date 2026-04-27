import { test } from 'bun:test'

import {
  appendReferenceImageOperations,
  createNewSketchSession,
  deleteSelectedSketchGeometry,
  getSketchSessionDisplayRenderables,
  updateReferenceImageOperationStates,
} from '@/domain/editor/sketch-session'
import { createStandardPlaneDefinition } from '@/domain/modeling/opencascade-kernel-seed'
import { REFERENCE_IMAGE_CALIBRATION_MODE_ID, type ReferenceImageCalibrationModeState } from '@/domain/reference-image-calibration/mode/shared'
import { createReferenceImageEditOperation, createReferenceImageOperation } from '@/domain/reference-image/operations'

test('src/domain/editor/reference-image-operations.spec.ts', () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  function createReferenceImageSession() {
    const plane = createStandardPlaneDefinition('xy')
    const baseSession = createNewSketchSession(plane)

    return appendReferenceImageOperations(baseSession, [
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
  }

  const session = createReferenceImageSession()
  assert(session.definition.points.length === 0, 'Reference-image imports should not materialize sketch points.')
  assert(session.definition.entities.length === 0, 'Reference-image imports should not materialize sketch entities.')
  assert(session.definition.constraints.length === 0, 'Reference-image imports should not materialize sketch constraints.')
  assert(session.definition.dimensions.length === 0, 'Reference-image imports should not materialize sketch dimensions.')
  assert(session.definition.authoringOperations?.length === 2, 'Reference-image imports should commit as authoring operations.')
  assert(
    session.definition.authoringOperations?.every((operation) =>
      operation.kind === 'referenceImage' && operation.ownedState.placement.center[0] === 0 && operation.ownedState.placement.center[1] === 0,
    ),
    'New reference-image operations should default to centered placement on the sketch plane.',
  )

  const renderables = getSketchSessionDisplayRenderables(session).filter((entry) => entry.target?.kind === 'sketchOperation')
  assert(renderables.length === 2, 'Committed reference images should render from operation-owned state.')
  assert(
    renderables.every((entry) => entry.geometry.kind === 'mesh' && entry.textureFill?.kind === 'inlineImage'),
    'Reference-image renderables should use textured mesh geometry with inline image data.',
  )
  assert(
    renderables[0]?.textureFill?.mediaType === 'image/png'
      && renderables[0]?.textureFill?.base64Data === 'cG5n'
      && renderables[0]?.textureFill?.sourceKey.includes('sketch_operation_1_reference-image'),
    'Reference-image renderables should expose inline payload metadata without embedding image bytes in scene keys.',
  )

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
  assert(updated.definition.authoringOperations?.at(-1)?.kind === 'edit', 'Reference-image state updates should append edit authoring operations.')
  const updatedRenderables = getSketchSessionDisplayRenderables(updated).filter((entry) => entry.target?.kind === 'sketchOperation')
  assert(updatedRenderables[0]?.label === 'reference-a-updated.png', 'Reference-image updates should replay the latest operation label.')
  assert(
    updatedRenderables[0]?.textureFill?.base64Data === 'dXBkYXRlZA==',
    'Reference-image updates should replay the latest inline payload bytes for rendering.',
  )

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
  assert(
    adjustedRenderables[1]?.textureFill?.sourceKey.includes('reference-b-adjusted.jpg'),
    'Reference-image edit rows should update the active texture source token for the targeted operation.',
  )

  const deleted = deleteSelectedSketchGeometry(session, [renderables[0]!.target!])
  assert(deleted.definition.authoringOperations?.length === 3, 'Deleting a reference image should append a delete authoring operation.')
  const remainingRenderables = getSketchSessionDisplayRenderables(deleted).filter((entry) => entry.target?.kind === 'sketchOperation')
  assert(remainingRenderables.length === 1, 'Deleting one reference image should leave the other committed images intact.')
  assert(
    remainingRenderables[0]?.label === 'reference-b.jpg',
    'Reference-image deletes should target individual operations rather than clearing the whole sketch image set.',
  )
})

test('src/domain/editor/reference-image-operations.spec.ts renders exported anchor references from draft calibration state', () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const plane = createStandardPlaneDefinition('xy')
  const operationId = 'sketch_operation_1_reference-image'
  const committed = updateReferenceImageOperationStates({
    session: appendReferenceImageOperations(createNewSketchSession(plane), [
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
      operationId,
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
          showExportedAnchorsInSketch: false,
          anchors: [{
            anchorId: 'anchor-1',
            label: 'A1',
            uv: [0.5, 0.5],
            worldPosition: [0, 0],
          }],
          constraints: [],
          solveResult: {
            placement: {
              center: [0, 0],
              width: 200,
              height: 100,
              rotationRadians: 0,
            },
            anchors: [{
              anchorId: 'anchor-1',
              worldPosition: [0, 0],
            }],
            diagnostics: [],
          },
        },
      },
    }],
  })

  const draftState: ReferenceImageCalibrationModeState = {
    operationId,
    draftState: {
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
        showExportedAnchorsInSketch: false,
        anchors: [{
          anchorId: 'anchor-1',
          label: 'A1',
          uv: [0.5, 0.5],
          worldPosition: [25, 10],
        }],
        constraints: [],
        solveResult: {
          placement: {
            center: [15, 5],
            width: 200,
            height: 100,
            rotationRadians: 0,
          },
          anchors: [{
            anchorId: 'anchor-1',
            worldPosition: [25, 10],
          }],
          diagnostics: [],
        },
      },
    },
    selectedAnchorId: 'anchor-1',
    selectedConstraintId: null,
    pendingAnchorPlacement: false,
    pendingConstraintAnchorIds: null,
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
  const exportedAnchor = renderables.find((entry) =>
    entry.target?.kind === 'projectedReferenceGeometry'
      && entry.target.referenceId.includes(operationId)
      && entry.geometry.kind === 'marker'
  )

  assert(
    draftImage?.textureFill?.base64Data === 'dXBkYXRlZA==',
    'Active calibration sessions should render the draft reference-image payload.',
  )
  assert(
    exportedAnchor?.geometry.kind === 'marker'
      && Math.abs(exportedAnchor.geometry.position[0] - 25) < 0.01
      && Math.abs(exportedAnchor.geometry.position[1] - 10) < 0.01,
    'Derived exported anchor references should render from the draft calibration solve while calibration is active.',
  )
})
