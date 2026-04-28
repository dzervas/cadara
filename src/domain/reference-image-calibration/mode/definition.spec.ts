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
import { referenceImageCalibrationModeDefinition } from '@/domain/reference-image-calibration/mode/definition'
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
  const solvedAnchorPoints = modeStateBeforeConstraint.draftState.calibration.solveResult.anchors
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

  assert(state.kind === 'editingSketch', 'Anchor fixture should remain in sketch editing.')
  const modeState = getModeState(state)
  const anchorIds = modeState.draftState.calibration.anchors.map((anchor) => anchor.anchorId)
  const panel = referenceImageCalibrationModeDefinition.buildPanel?.({
    sketchSession: state.session,
    activeMode: state.session.activeSpecialMode!,
  })
  const anchorSelection = panel?.sections
    .flatMap((section) => section.fields ?? [])
    .find((field) => field.id === 'anchor-selection')

  assert(anchorSelection?.kind === 'option', 'Calibration panel should list authored anchors as a selectable field.')
  assert(
    JSON.stringify(anchorSelection.options.map((option) => option.value)) === JSON.stringify(anchorIds),
    'Calibration panel should include every authored anchor in the selection list.',
  )

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
    action: {
      kind: 'invoke',
      actionId: 'remove-anchor',
    },
  }).state

  const remainingAnchors = getModeState(state).draftState.calibration.anchors
  assert(remainingAnchors.length === 1, 'Removing a panel-selected anchor should update the authored anchor list.')
  assert(
    remainingAnchors[0]?.anchorId === anchorIds[1],
    'Removing a panel-selected anchor should remove the chosen anchor instead of a different one.',
  )
})

test('src/domain/reference-image-calibration/mode/definition.spec.ts keeps left-biased two-anchor calibration stable when authoring a distance constraint', () => {
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

  for (const point of [[-90, 0], [-30, 0]] as const) {
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

  assert(state.kind === 'editingSketch', 'Two-anchor fixture should remain in sketch editing.')
  let modeState = getModeState(state)
  let solvedAnchors = modeState.draftState.calibration.solveResult.anchors
  assert(modeState.draftState.placement.width > 100, 'Two authored anchors should keep the reference image from collapsing.')
  assert(
    Math.abs(solvedAnchors[0]!.worldPosition[0] - solvedAnchors[1]!.worldPosition[0]) > 50,
    'Two authored anchors should remain spatially distinct after solving.',
  )

  state = transitionEditorState(state, {
    type: 'sketch.specialModePanelActionInvoked',
    action: {
      kind: 'invoke',
      actionId: 'add-distance-constraint',
    },
  }).state

  for (const anchor of solvedAnchors) {
    state = transitionEditorState(state, {
      type: 'sketch.specialModeClickRequested',
      point: anchor.worldPosition,
      target: operationTarget,
    }).state
  }

  modeState = getModeState(state)
  solvedAnchors = modeState.draftState.calibration.solveResult.anchors
  assert(modeState.draftState.calibration.constraints.length === 1, 'Selecting the authored anchor pair should create a distance constraint.')
  assert(modeState.draftState.placement.width > 100, 'Adding a distance constraint should not collapse the calibrated image.')
  assert(
    Math.abs(solvedAnchors[0]!.worldPosition[0] - solvedAnchors[1]!.worldPosition[0]) > 50,
    'Adding a distance constraint should preserve both solved anchor positions.',
  )
})
