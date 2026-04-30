import { test } from 'bun:test'

import {
  initialEditorState,
  transitionEditorState,
  type SketchEditorState,
} from '@/domain/editor/state-machine'
import {
  appendReferenceImageOperations,
  createNewSketchSession,
  getSketchSessionPreviewLabel,
} from '@/domain/editor/sketch-session'
import { createStandardPlaneDefinition } from '@/domain/modeling/opencascade-kernel-seed'
import { REFERENCE_IMAGE_CALIBRATION_MODE_ID, type ReferenceImageCalibrationModeState } from '@/domain/reference-image-calibration/mode/shared'
import { createReferenceImageOperation } from '@/domain/reference-image/operations'

function createEditingSketchState(): SketchEditorState {
  const session = appendReferenceImageOperations(
    createNewSketchSession(createStandardPlaneDefinition('xy')),
    [createReferenceImageOperation({
      sequence: 1,
      sketchId: 'sketch_draft',
      payload: {
        mediaType: 'image/png',
        fileName: 'fixture.png',
        pixelWidth: 400,
        pixelHeight: 200,
        base64Data: 'cG5n',
      },
    })],
  )

  return {
    ...initialEditorState,
    kind: 'editingSketch',
    mode: 'sketch',
    document: {
      documentId: 'doc_fixture',
      revisionId: 'rev_fixture',
    },
    command: {
      commandSessionId: 'command_sketch-fixture',
      toolId: 'sketch',
      phase: 'editing',
    },
    preview: {
      kind: 'sketch',
      label: getSketchSessionPreviewLabel(session),
      target: session.planeTarget,
    },
    session,
    pendingCommitRequestId: null,
    pendingProjectionRequestId: null,
    pendingImportRequestId: null,
  }
}

function getOperationTarget(state: SketchEditorState) {
  const operationId = state.session.definition.authoringOperations?.[0]?.operationId
  if (!operationId) {
    throw new Error('Expected reference-image operation fixture.')
  }

  return {
    kind: 'sketchOperation' as const,
    sketchId: 'sketch_draft',
    operationId,
  }
}

function getModeState(state: SketchEditorState) {
  const modeState = state.session.activeSpecialMode?.state as ReferenceImageCalibrationModeState | undefined
  if (!modeState) {
    throw new Error('Expected active calibration mode state.')
  }

  return modeState
}

test('src/domain/reference-image-calibration/mode/definition.spec.ts only places anchors on the active image', () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const baseState = createEditingSketchState()
  const operationTarget = getOperationTarget(baseState)

  const entered = transitionEditorState(baseState, {
    type: 'sketch.specialModeEntered',
    modeId: REFERENCE_IMAGE_CALIBRATION_MODE_ID,
    operationId: operationTarget.operationId,
  })
  const armed = transitionEditorState(entered.state, {
    type: 'sketch.specialModePanelActionInvoked',
    action: {
      kind: 'invoke',
      actionId: 'add-anchor',
    },
  })

  const outsideBounds = transitionEditorState(armed.state, {
    type: 'sketch.specialModeClickRequested',
    point: [200, 200],
    target: operationTarget,
  })
  assert(
    getModeState(outsideBounds.state).draftState.calibration.anchors.length === 0,
    'Clicking outside the image bounds should not create a calibration anchor.',
  )

  const placed = transitionEditorState(outsideBounds.state, {
    type: 'sketch.specialModeClickRequested',
    point: [0, 0],
    target: operationTarget,
  })
  const modeState = getModeState(placed.state)
  assert(modeState.draftState.calibration.anchors.length === 1, 'Clicking the active image within bounds should create a calibration anchor.')
  assert(modeState.draftPoints.length === 1, 'Creating an anchor should stage a bound construction point for commit.')
  assert(modeState.draftState.calibration.anchors[0]?.pointId === modeState.draftPoints[0]?.pointId, 'The authored anchor should bind to the staged sketch point.')
})

test('src/domain/reference-image-calibration/mode/definition.spec.ts lists authored anchors in the panel and removes the selected one', () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const operationTarget = getOperationTarget(createEditingSketchState())
  let state = transitionEditorState(createEditingSketchState(), {
    type: 'sketch.specialModeEntered',
    modeId: REFERENCE_IMAGE_CALIBRATION_MODE_ID,
    operationId: operationTarget.operationId,
  }).state

  for (const point of [[-40, 0], [40, 0]] as const) {
    state = transitionEditorState(state, {
      type: 'sketch.specialModePanelActionInvoked',
      action: { kind: 'invoke', actionId: 'add-anchor' },
    }).state
    state = transitionEditorState(state, {
      type: 'sketch.specialModeClickRequested',
      point,
      target: operationTarget,
    }).state
  }

  const modeState = getModeState(state)
  const anchorIds = modeState.draftState.calibration.anchors.map((anchor) => anchor.anchorId)
  const panel = state.session.activeSpecialMode
    ? state.session.activeSpecialMode
    : null
  assert(anchorIds.length === 2, 'Fixture should create two bound anchors.')
  assert(panel !== null, 'Calibration mode should remain active while editing anchors.')

  state = transitionEditorState(state, {
    type: 'sketch.specialModePanelActionInvoked',
    action: {
      kind: 'patch',
      patch: {
        field: 'selectedAnchorId',
        value: anchorIds[0]!,
      },
    },
  }).state
  state = transitionEditorState(state, {
    type: 'sketch.specialModePanelActionInvoked',
    action: { kind: 'invoke', actionId: 'remove-anchor' },
  }).state

  const remainingAnchors = getModeState(state).draftState.calibration.anchors
  assert(remainingAnchors.length === 1, 'Removing a panel-selected anchor should update the authored anchor list.')
  assert(remainingAnchors[0]?.anchorId === anchorIds[1], 'Removing a panel-selected anchor should remove the chosen anchor instead of a different one.')
})

test('src/domain/reference-image-calibration/mode/definition.spec.ts allocates a fresh anchor id after removing an earlier anchor', () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const operationTarget = getOperationTarget(createEditingSketchState())
  let state = transitionEditorState(createEditingSketchState(), {
    type: 'sketch.specialModeEntered',
    modeId: REFERENCE_IMAGE_CALIBRATION_MODE_ID,
    operationId: operationTarget.operationId,
  }).state

  for (const point of [[-40, 0], [40, 0]] as const) {
    state = transitionEditorState(state, {
      type: 'sketch.specialModePanelActionInvoked',
      action: { kind: 'invoke', actionId: 'add-anchor' },
    }).state
    state = transitionEditorState(state, {
      type: 'sketch.specialModeClickRequested',
      point,
      target: operationTarget,
    }).state
  }

  const originalAnchorIds = getModeState(state).draftState.calibration.anchors.map((anchor) => anchor.anchorId)
  state = transitionEditorState(state, {
    type: 'sketch.specialModePanelActionInvoked',
    action: {
      kind: 'patch',
      patch: {
        field: 'selectedAnchorId',
        value: originalAnchorIds[0]!,
      },
    },
  }).state
  state = transitionEditorState(state, {
    type: 'sketch.specialModePanelActionInvoked',
    action: { kind: 'invoke', actionId: 'remove-anchor' },
  }).state
  state = transitionEditorState(state, {
    type: 'sketch.specialModePanelActionInvoked',
    action: { kind: 'invoke', actionId: 'add-anchor' },
  }).state
  state = transitionEditorState(state, {
    type: 'sketch.specialModeClickRequested',
    point: [0, 20],
    target: operationTarget,
  }).state

  const nextAnchorIds = getModeState(state).draftState.calibration.anchors.map((anchor) => anchor.anchorId)
  assert(nextAnchorIds.length === 2, 'The replacement fixture should still contain two anchors after remove-and-add.')
  assert(new Set(nextAnchorIds).size === nextAnchorIds.length, 'Remove-and-add should not reuse an anchor id that is still present.')
  assert(nextAnchorIds.includes(originalAnchorIds[1]!), 'Remove-and-add should preserve the untouched anchor id.')
  assert(!nextAnchorIds.includes(originalAnchorIds[0]!), 'Remove-and-add should not resurrect the removed anchor id when a newer anchor already exists.')
})

test('src/domain/reference-image-calibration/mode/definition.spec.ts rebinds a selected anchor to an existing sketch point', () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const baseState = createEditingSketchState()
  const stateWithPoint: SketchEditorState = {
    ...baseState,
    session: {
      ...baseState.session,
      definition: {
        ...baseState.session.definition,
        pointIds: [...baseState.session.definition.pointIds, 'sketch_point_anchor'],
        points: [
          ...baseState.session.definition.points,
          {
            pointId: 'sketch_point_anchor',
            label: 'Existing anchor',
            target: { kind: 'sketchPoint', sketchId: 'sketch_draft', pointId: 'sketch_point_anchor' },
            position: [30, 0],
            isConstruction: true,
          },
        ],
      },
      fullDefinition: {
        ...baseState.session.fullDefinition,
        pointIds: [...baseState.session.fullDefinition.pointIds, 'sketch_point_anchor'],
        points: [
          ...baseState.session.fullDefinition.points,
          {
            pointId: 'sketch_point_anchor',
            label: 'Existing anchor',
            target: { kind: 'sketchPoint', sketchId: 'sketch_draft', pointId: 'sketch_point_anchor' },
            position: [30, 0],
            isConstruction: true,
          },
        ],
      },
    },
  }

  const operationTarget = getOperationTarget(stateWithPoint)
  let state = transitionEditorState(stateWithPoint, {
    type: 'sketch.specialModeEntered',
    modeId: REFERENCE_IMAGE_CALIBRATION_MODE_ID,
    operationId: operationTarget.operationId,
  }).state

  state = transitionEditorState(state, {
    type: 'sketch.specialModePanelActionInvoked',
    action: { kind: 'invoke', actionId: 'add-anchor' },
  }).state
  state = transitionEditorState(state, {
    type: 'sketch.specialModeClickRequested',
    point: [0, 0],
    target: operationTarget,
  }).state

  const initialBinding = getModeState(state).draftState.calibration.anchors[0]?.pointId
  state = transitionEditorState(state, {
    type: 'sketch.specialModePanelActionInvoked',
    action: {
      kind: 'patch',
      patch: {
        field: 'selectedAnchorId',
        value: getModeState(state).draftState.calibration.anchors[0]?.anchorId,
      },
    },
  }).state
  state = transitionEditorState(state, {
    type: 'sketch.specialModePanelActionInvoked',
    action: { kind: 'invoke', actionId: 'rebind-anchor' },
  }).state
  state = transitionEditorState(state, {
    type: 'sketch.specialModeClickRequested',
    point: [30, 0],
    target: {
      kind: 'sketchPoint',
      sketchId: 'sketch_draft',
      pointId: 'sketch_point_anchor',
    },
  }).state

  const reboundAnchor = getModeState(state).draftState.calibration.anchors[0]
  assert(reboundAnchor?.pointId === 'sketch_point_anchor', 'Rebinding should target the explicitly selected sketch point.')
  assert(reboundAnchor?.pointId !== initialBinding, 'Rebinding should replace the previous construction-point binding.')
})

test('src/domain/reference-image-calibration/mode/definition.spec.ts rebind mode prioritizes the clicked sketch point over anchor hit-testing', () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const baseState = createEditingSketchState()
  const stateWithOverlappingPoint: SketchEditorState = {
    ...baseState,
    session: {
      ...baseState.session,
      definition: {
        ...baseState.session.definition,
        pointIds: [...baseState.session.definition.pointIds, 'sketch_point_overlap'],
        points: [
          ...baseState.session.definition.points,
          {
            pointId: 'sketch_point_overlap',
            label: 'Overlap point',
            target: { kind: 'sketchPoint', sketchId: 'sketch_draft', pointId: 'sketch_point_overlap' },
            position: [0, 0],
            isConstruction: true,
          },
        ],
      },
      fullDefinition: {
        ...baseState.session.fullDefinition,
        pointIds: [...baseState.session.fullDefinition.pointIds, 'sketch_point_overlap'],
        points: [
          ...baseState.session.fullDefinition.points,
          {
            pointId: 'sketch_point_overlap',
            label: 'Overlap point',
            target: { kind: 'sketchPoint', sketchId: 'sketch_draft', pointId: 'sketch_point_overlap' },
            position: [0, 0],
            isConstruction: true,
          },
        ],
      },
    },
  }

  const operationTarget = getOperationTarget(stateWithOverlappingPoint)
  let state = transitionEditorState(stateWithOverlappingPoint, {
    type: 'sketch.specialModeEntered',
    modeId: REFERENCE_IMAGE_CALIBRATION_MODE_ID,
    operationId: operationTarget.operationId,
  }).state

  state = transitionEditorState(state, {
    type: 'sketch.specialModePanelActionInvoked',
    action: { kind: 'invoke', actionId: 'add-anchor' },
  }).state
  state = transitionEditorState(state, {
    type: 'sketch.specialModeClickRequested',
    point: [0, 0],
    target: operationTarget,
  }).state
  state = transitionEditorState(state, {
    type: 'sketch.specialModePanelActionInvoked',
    action: {
      kind: 'patch',
      patch: {
        field: 'selectedAnchorId',
        value: getModeState(state).draftState.calibration.anchors[0]?.anchorId,
      },
    },
  }).state
  state = transitionEditorState(state, {
    type: 'sketch.specialModePanelActionInvoked',
    action: { kind: 'invoke', actionId: 'rebind-anchor' },
  }).state
  state = transitionEditorState(state, {
    type: 'sketch.specialModeClickRequested',
    point: [0, 0],
    target: {
      kind: 'sketchPoint',
      sketchId: 'sketch_draft',
      pointId: 'sketch_point_overlap',
    },
  }).state

  const reboundAnchor = getModeState(state).draftState.calibration.anchors[0]
  assert(reboundAnchor?.pointId === 'sketch_point_overlap', 'Rebind mode should honor the clicked sketch point even when it overlaps the anchor handle.')
})
