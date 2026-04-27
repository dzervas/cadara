import { test } from 'bun:test'

import {
  initialEditorState,
  transitionEditorState,
  type SketchEditorState,
} from '@/contracts/editor/state-machine'
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
  assert(entered.state.kind === 'editingSketch', 'Calibration entry should keep sketch editing active.')

  const armed = transitionEditorState(entered.state, {
    type: 'sketch.specialModePanelActionInvoked',
    action: {
      kind: 'invoke',
      actionId: 'add-anchor',
    },
  })
  assert(armed.state.kind === 'editingSketch', 'Add-anchor action should preserve calibration mode.')

  const outsideBounds = transitionEditorState(armed.state, {
    type: 'sketch.specialModeClickRequested',
    point: [200, 200],
    target: operationTarget,
  })
  assert(outsideBounds.state.kind === 'editingSketch', 'Outside-bounds click should stay in sketch editing.')
  assert(
    getModeState(outsideBounds.state).draftState.calibration.anchors.length === 0,
    'Clicking outside the image bounds should not create a calibration anchor.',
  )

  const offImageTarget = transitionEditorState(outsideBounds.state, {
    type: 'sketch.specialModeClickRequested',
    point: [0, 0],
    target: null,
  })
  assert(offImageTarget.state.kind === 'editingSketch', 'Off-image click should stay in sketch editing.')
  assert(
    getModeState(offImageTarget.state).draftState.calibration.anchors.length === 0,
    'Clicks that do not target the active image should not create calibration anchors.',
  )

  const placed = transitionEditorState(offImageTarget.state, {
    type: 'sketch.specialModeClickRequested',
    point: [0, 0],
    target: operationTarget,
  })
  assert(placed.state.kind === 'editingSketch', 'On-image click should stay in sketch editing.')
  assert(
    getModeState(placed.state).draftState.calibration.anchors.length === 1,
    'Clicking the active image within bounds should create a calibration anchor.',
  )
})

test('src/domain/reference-image-calibration/mode/definition.spec.ts authors distance constraints from the chosen anchor pair', () => {
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

  const anchorPoints: readonly [readonly [number, number], string][] = [
    [[-40, 0], 'first'],
    [[0, 0], 'second'],
    [[40, 0], 'third'],
  ]

  for (const [point] of anchorPoints) {
    state = transitionEditorState(state, {
      type: 'sketch.specialModePanelActionInvoked',
      action: {
        kind: 'invoke',
        actionId: 'add-anchor',
      },
    }).state

    state = transitionEditorState(state, {
      type: 'sketch.specialModeClickRequested',
      point,
      target: operationTarget,
    }).state
  }

  assert(state.kind === 'editingSketch', 'Anchor authoring fixture should remain in sketch editing.')
  const modeStateBeforeConstraint = getModeState(state)
  const anchors = modeStateBeforeConstraint.draftState.calibration.anchors
  const solvedAnchorPoints = modeStateBeforeConstraint.draftState.calibration.solveResult?.anchors
  assert(anchors.length === 3, 'Fixture should create three calibration anchors.')
  assert(solvedAnchorPoints?.length === 3, 'Fixture should solve all authored calibration anchors.')

  state = transitionEditorState(state, {
    type: 'sketch.specialModePanelActionInvoked',
    action: {
      kind: 'invoke',
      actionId: 'add-distance-constraint',
    },
  }).state

  state = transitionEditorState(state, {
    type: 'sketch.specialModeClickRequested',
    point: solvedAnchorPoints?.[2]?.worldPosition ?? anchorPoints[2]![0],
    target: operationTarget,
  }).state
  state = transitionEditorState(state, {
    type: 'sketch.specialModeClickRequested',
    point: solvedAnchorPoints?.[0]?.worldPosition ?? anchorPoints[0]![0],
    target: operationTarget,
  }).state

  assert(state.kind === 'editingSketch', 'Constraint authoring should preserve sketch editing.')
  const modeState = getModeState(state)
  const constraint = modeState.draftState.calibration.constraints[0]
  assert(constraint, 'Selecting two anchors should create a distance constraint.')
  assert(
    constraint.firstAnchorId === anchors[2]?.anchorId && constraint.secondAnchorId === anchors[0]?.anchorId,
    'Distance constraints should use the explicitly selected anchor pair, not the first two anchors in the list.',
  )
  assert(
    modeState.pendingConstraintAnchorIds === null,
    'Constraint pair selection should clear once the chosen pair is committed.',
  )
})
