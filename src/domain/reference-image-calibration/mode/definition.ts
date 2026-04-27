import type {
  ReferenceImageCalibrationAnchor,
  SolvedReferenceImageCalibrationState,
  SolvedReferenceImageOperationState,
} from '@/contracts/reference-image/schema'
import type { SketchPoint2D } from '@/contracts/sketch/schema'
import type { SketchAuthoringOperationId } from '@/contracts/shared/ids'
import type { PrimitiveRef } from '@/domain/editor/schema'

import {
  createSketchSpecialModeHandleRef,
  createSketchSpecialModeTargetRef,
} from '@/domain/sketch-special-modes/presentation'
import type {
  SketchSpecialModeDefinition,
  SketchSpecialModePanelButton,
  SketchSpecialModePanelField,
  SketchSpecialModePanelSchema,
  SketchSpecialModePanelSection,
  SketchSpecialModeViewportOverlay,
  SketchSpecialModeViewportPresentation,
} from '@/domain/sketch-special-modes/schema'
import {
  collectActiveReferenceImageOperations,
} from '@/domain/reference-image/operations'
import {
  createReferenceImageCalibrationAnchor,
  createReferenceImageCalibrationConstraint,
  replaceReferenceImagePayloadPreservingCalibration,
  solveReferenceImageOperationState,
} from '@/domain/reference-image-calibration/state'
import {
  REFERENCE_IMAGE_CALIBRATION_MODE_ID,
  type ReferenceImageCalibrationModeState,
} from '@/domain/reference-image-calibration/mode/shared'
import { updateReferenceImageOperationStates } from '@/domain/editor/sketch-session'

const ANCHOR_HIT_TOLERANCE = 10
const CONSTRAINT_HIT_TOLERANCE = 8

export const referenceImageCalibrationModeDefinition = {
  id: REFERENCE_IMAGE_CALIBRATION_MODE_ID,
  label: 'Reference Image Calibration',
  resolveOpenRequest: ({ sketchSession, target }) =>
    target?.kind === 'sketchOperation'
      && collectActiveReferenceImageOperations(sketchSession.definition).some(({ operation }) =>
        operation.operationId === target.operationId
      )
      ? { operationId: target.operationId }
      : null,
  selection: {
    label: 'Reference image calibration',
    description: 'Select the active reference image.',
    allowedKinds: ['sketchOperation'],
    resolveTarget: ({ activeMode, target }) =>
      target.kind === 'sketchOperation' && target.operationId === activeMode.operationTarget.operationId
        ? createSketchSpecialModeTargetRef(target.operationId, 'reference-image')
        : null,
  },
  enter: ({ sketchSession, operationTarget }) => {
    const activeOperation = collectActiveReferenceImageOperations(sketchSession.definition).find(({ operation }) =>
      operation.operationId === operationTarget.operationId
    )

    if (!activeOperation) {
      throw new Error(`Reference-image operation ${operationTarget.operationId} is not available for calibration.`)
    }

    return {
      state: {
        operationId: operationTarget.operationId,
        draftState: solveReferenceImageOperationState(activeOperation.state),
        selectedAnchorId: null,
        selectedConstraintId: null,
        pendingAnchorPlacement: false,
        pendingConstraintAnchorIds: null,
      } satisfies ReferenceImageCalibrationModeState,
    }
  },
  buildPanel: ({ activeMode }) => buildPanel(activeMode.state as ReferenceImageCalibrationModeState),
  buildViewport: ({ activeMode }) => buildViewport(activeMode.state as ReferenceImageCalibrationModeState),
  handleClick: ({ activeMode, point, target }) =>
    handleClick(activeMode.state as ReferenceImageCalibrationModeState, point, target),
  handleDragStart: ({ activeMode, handle, point }) => handleDragMove(
    activeMode.state as ReferenceImageCalibrationModeState,
    handle.handleId,
    point,
  ),
  handleDragMove: ({ activeMode, handle, point }) => handleDragMove(
    activeMode.state as ReferenceImageCalibrationModeState,
    handle.handleId,
    point,
  ),
  handleDragEnd: ({ activeMode, handle, point }) => handleDragMove(
    activeMode.state as ReferenceImageCalibrationModeState,
    handle.handleId,
    point,
  ),
  handlePanelAction: ({ activeMode, action }) => {
    const state = activeMode.state as ReferenceImageCalibrationModeState
    if (action.kind === 'patch') {
      return {
        state: patchDraftState(state, action.patch.field, action.patch.value),
      }
    }

    if (action.kind === 'invoke') {
      switch (action.actionId) {
        case 'add-anchor':
          return {
            state: {
              ...state,
              pendingAnchorPlacement: true,
              pendingConstraintAnchorIds: null,
              selectedAnchorId: null,
              selectedConstraintId: null,
            },
          }
        case 'remove-anchor':
          return {
            state: removeSelectedAnchor(state),
          }
        case 'add-distance-constraint':
          return {
            state: startDistanceConstraintSelection(state),
          }
        case 'remove-distance-constraint':
          return {
            state: removeSelectedConstraint(state),
          }
        case 'replace-image':
          return {
            effect: {
              effectId: 'replace-image',
              kind: 'reference-image-replace-image',
              payload: {},
            },
          }
      }
    }

    return { state }
  },
  handleEffectResult: ({ activeMode, effectId, payload }) => {
    const state = activeMode.state as ReferenceImageCalibrationModeState
    if (effectId !== 'replace-image' || !isReferenceImagePayload(payload.image)) {
      return { effect: null }
    }

    return {
      state: {
        ...state,
        draftState: replaceReferenceImagePayloadPreservingCalibration({
          state: state.draftState,
          image: payload.image,
        }),
      },
      effect: null,
    }
  },
  commit: ({ sketchSession, activeMode }) => {
    const state = activeMode.state as ReferenceImageCalibrationModeState
    const nextSession = updateReferenceImageOperationStates({
      session: sketchSession,
      updates: [{
        operationId: state.operationId,
        state: state.draftState,
        label: state.draftState.image.fileName,
      }],
    })

    return {
      session: nextSession,
      exit: true,
    }
  },
  cancel: () => ({
    exit: true,
  }),
  getOperationOwnedStateOverride: ({ activeMode }) => ({
    operationId: (activeMode.state as ReferenceImageCalibrationModeState).operationId,
    state: (activeMode.state as ReferenceImageCalibrationModeState).draftState,
    label: (activeMode.state as ReferenceImageCalibrationModeState).draftState.image.fileName,
  }),
} satisfies SketchSpecialModeDefinition<ReferenceImageCalibrationModeState>

function getCalibrationState(
  draftState: SolvedReferenceImageOperationState,
): SolvedReferenceImageCalibrationState {
  const calibration = draftState.calibration
  if (!calibration) {
    throw new Error('Reference-image calibration state must be solved before entering calibration mode.')
  }

  return calibration
}

function buildPanel(state: ReferenceImageCalibrationModeState): SketchSpecialModePanelSchema {
  const calibration = getCalibrationState(state.draftState)
  const selectedAnchor = getSelectedAnchor(state)
  const selectedConstraint = getSelectedConstraint(state)
  const diagnostics = calibration.solveResult.diagnostics
  const solveFields: SketchSpecialModePanelField[] = [
    {
      id: 'scale-mode',
      kind: 'option',
      label: 'Scale mode',
      value: calibration.scaleMode,
      options: [
        { value: 'lockedAspect', label: 'Locked aspect' },
        { value: 'independent', label: 'Independent X/Y' },
      ],
      action: { kind: 'patch', patch: { field: 'scaleMode' } },
    },
    {
      id: 'anchor-visibility',
      kind: 'toggle',
      label: 'Show exported anchors in sketch',
      value: calibration.showExportedAnchorsInSketch,
      action: { kind: 'patch', patch: { field: 'showExportedAnchorsInSketch' } },
    },
    {
      id: 'anchor-count',
      kind: 'readout',
      label: 'Anchors',
      value: String(calibration.anchors.length),
    },
  ]
  const anchorFields: SketchSpecialModePanelField[] = selectedAnchor
    ? [
        {
          id: 'anchor-label',
          kind: 'text',
          label: 'Selected anchor',
          value: selectedAnchor.label,
          action: { kind: 'patch', patch: { field: 'anchorLabel' } },
        },
        {
          id: 'anchor-x',
          kind: 'numeric',
          label: 'Target X',
          value: selectedAnchor.worldPosition?.[0] ?? null,
          action: { kind: 'patch', patch: { field: 'anchorX' } },
        },
        {
          id: 'anchor-y',
          kind: 'numeric',
          label: 'Target Y',
          value: selectedAnchor.worldPosition?.[1] ?? null,
          action: { kind: 'patch', patch: { field: 'anchorY' } },
        },
      ]
    : [{
        id: 'anchor-selection',
        kind: 'readout',
        label: 'Selected anchor',
        value: 'None',
      }]
  const constraintFields: SketchSpecialModePanelField[] = selectedConstraint
    ? [{
        id: 'constraint-distance',
        kind: 'numeric',
        label: 'Selected distance',
        value: selectedConstraint.distance,
        unit: 'mm',
        action: { kind: 'patch', patch: { field: 'constraintDistance' } },
      }]
    : [{
        id: 'constraint-selection',
        kind: 'readout',
        label: 'Selected constraint',
        value: 'None',
      }]
  const anchorButtons: SketchSpecialModePanelButton[] = [
    {
      id: 'add-anchor',
      label: 'Add Anchor',
      tone: 'primary',
      action: { kind: 'invoke', actionId: 'add-anchor' },
    },
    {
      id: 'remove-anchor',
      label: 'Remove Anchor',
      disabled: selectedAnchor === null,
      action: { kind: 'invoke', actionId: 'remove-anchor' },
    },
  ]
  const constraintButtons: SketchSpecialModePanelButton[] = [
    {
      id: 'add-distance-constraint',
      label: state.pendingConstraintAnchorIds === null ? 'Add Distance' : 'Picking Pair',
      disabled: calibration.anchors.length < 2,
      action: { kind: 'invoke', actionId: 'add-distance-constraint' },
    },
    {
      id: 'remove-distance-constraint',
      label: 'Remove Distance',
      disabled: selectedConstraint === null,
      action: { kind: 'invoke', actionId: 'remove-distance-constraint' },
    },
  ]
  const sections: SketchSpecialModePanelSection[] = [
    {
      id: 'solve',
      title: 'Solve',
      description: 'Choose how the dedicated calibration solver is allowed to scale the image.',
      fields: solveFields,
    },
    {
      id: 'anchors',
      title: 'Anchors',
      description: 'Anchors stay operation-local and export only as fixed reference points after solving.',
      fields: anchorFields,
      buttons: anchorButtons,
    },
    {
      id: 'constraints',
      title: 'Constraints',
      description: 'Distance constraints act only inside the dedicated reference-image solver.',
      fields: constraintFields,
      buttons: constraintButtons,
    },
    {
      id: 'image',
      title: 'Image',
      fields: [{
        id: 'image-name',
        kind: 'readout',
        label: 'Payload',
        value: state.draftState.image.fileName ?? `${state.draftState.image.pixelWidth}×${state.draftState.image.pixelHeight}`,
      }],
      buttons: [{
        id: 'replace-image',
        label: 'Replace Image',
        action: { kind: 'invoke', actionId: 'replace-image' },
      }],
    },
    {
      id: 'diagnostics',
      title: 'Diagnostics',
      diagnostics: diagnostics.map((diagnostic, index) => ({
        id: `${diagnostic.code}:${index}`,
        message: diagnostic.message,
        severity: diagnostic.severity,
      })),
    },
  ]

  return {
    title: 'Reference Image Calibration',
    subtitle: state.draftState.image.fileName ?? 'Reference image',
    prompts: [buildPrompt(state, 'panel')],
    sections,
    footerButtons: [
      { id: 'cancel', label: 'Cancel', action: { kind: 'command', command: 'cancel' } },
      { id: 'commit', label: 'Commit', tone: 'primary', action: { kind: 'command', command: 'commit' } },
    ],
  }
}

function buildViewport(state: ReferenceImageCalibrationModeState): SketchSpecialModeViewportPresentation {
  const calibration = getCalibrationState(state.draftState)
  const solvedByAnchorId = new Map(
    calibration.solveResult.anchors.map((anchor) => [anchor.anchorId, anchor.worldPosition] as const),
  )
  const overlays: SketchSpecialModeViewportOverlay[] = [
    ...calibration.constraints.flatMap((constraint) => {
      const first = solvedByAnchorId.get(constraint.firstAnchorId)
      const second = solvedByAnchorId.get(constraint.secondAnchorId)
      return first && second
        ? [{
            id: `constraint:${constraint.constraintId}`,
            kind: 'segment' as const,
            start: first,
            end: second,
            tone: state.selectedConstraintId === constraint.constraintId ? 'success' as const : 'neutral' as const,
            dashed: true,
          }]
        : []
    }),
    ...calibration.anchors.flatMap((anchor) => {
      const solved = solvedByAnchorId.get(anchor.anchorId)
      return solved
        ? [{
            id: `anchor:${anchor.anchorId}`,
            kind: 'handle' as const,
            label: anchor.label,
            anchor: { kind: 'sketchPoint' as const, point: solved },
            handle: createSketchSpecialModeHandleRef(state.operationId, anchor.anchorId),
            tone: getAnchorHandleTone(state, anchor.anchorId),
            draggable: true,
          }]
        : []
    }),
  ]

  return {
    prompts: [buildPrompt(state, 'viewport')],
    diagnostics: calibration.solveResult.diagnostics.map((diagnostic, index) => ({
      id: `${diagnostic.code}:${index}`,
      message: diagnostic.message,
      severity: diagnostic.severity,
    })),
    overlays,
  }
}

function handleClick(
  state: ReferenceImageCalibrationModeState,
  point: SketchPoint2D,
  target: PrimitiveRef | null,
) {
  const selectedAnchor = findNearestAnchor(state, point)
  if (selectedAnchor) {
    const nextState = selectAnchor(state, selectedAnchor.anchorId)
    return {
      state: nextState.pendingConstraintAnchorIds === null
        ? nextState
        : completePendingDistanceConstraintSelection(nextState, selectedAnchor.anchorId),
    }
  }

  if (state.pendingConstraintAnchorIds !== null) {
    return {
      state: {
        ...state,
        selectedConstraintId: null,
      },
    }
  }

  const selectedConstraint = findNearestConstraint(state, point)
  if (selectedConstraint) {
    return {
      state: {
        ...state,
        selectedConstraintId: selectedConstraint.constraintId,
        selectedAnchorId: null,
        pendingAnchorPlacement: false,
        pendingConstraintAnchorIds: null,
      },
    }
  }

  if (!state.pendingAnchorPlacement) {
    return {
      state: {
        ...state,
        selectedAnchorId: null,
        selectedConstraintId: null,
        pendingConstraintAnchorIds: null,
      },
    }
  }

  if (target?.kind !== 'sketchOperation' || target.operationId !== state.operationId) {
    return { state }
  }

  const uv = worldPointToUv(point, state.draftState.placement)
  if (!uv) {
    return { state }
  }

  const nextAnchor = createReferenceImageCalibrationAnchor({
    anchorId: createAnchorId(state.operationId, getCalibrationState(state.draftState).anchors.length),
    anchorIndex: getCalibrationState(state.draftState).anchors.length,
    uv,
    worldPosition: point,
  })

  const calibration = getCalibrationState(state.draftState)
  const draftState = solveReferenceImageOperationState({
    ...state.draftState,
    calibration: {
      ...calibration,
      anchors: [...calibration.anchors, nextAnchor],
    },
  })

  return {
    state: {
      ...state,
        draftState,
        selectedAnchorId: nextAnchor.anchorId,
        selectedConstraintId: null,
        pendingAnchorPlacement: false,
        pendingConstraintAnchorIds: null,
      },
    }
}

function handleDragMove(
  state: ReferenceImageCalibrationModeState,
  handleId: string,
  point: SketchPoint2D,
) {
  const anchorId = handleId.replace('sketch_special_handle_', '')
  const calibration = getCalibrationState(state.draftState)
  const nextAnchors = calibration.anchors.map((anchor) =>
    anchor.anchorId === anchorId
      ? { ...anchor, worldPosition: point }
      : anchor,
  )

  return {
    state: {
      ...state,
      selectedAnchorId: anchorId,
      selectedConstraintId: null,
      pendingConstraintAnchorIds: null,
      draftState: solveReferenceImageOperationState({
        ...state.draftState,
        calibration: {
          ...calibration,
          anchors: nextAnchors,
        },
      }),
    },
  }
}

function patchDraftState(
  state: ReferenceImageCalibrationModeState,
  field: unknown,
  value: unknown,
) {
  if (typeof field !== 'string') {
    return state
  }

  const calibration = getCalibrationState(state.draftState)

  if (field === 'scaleMode' && (value === 'lockedAspect' || value === 'independent')) {
    return {
      ...state,
      draftState: solveReferenceImageOperationState({
        ...state.draftState,
        calibration: {
          ...calibration,
          scaleMode: value,
        },
      }),
    }
  }

  if (field === 'showExportedAnchorsInSketch' && typeof value === 'boolean') {
    return {
      ...state,
      draftState: {
        ...state.draftState,
        calibration: {
          ...calibration,
          showExportedAnchorsInSketch: value,
        },
      },
    }
  }

  if (field === 'anchorLabel' && typeof value === 'string' && state.selectedAnchorId) {
    return patchSelectedAnchor(state, (anchor) => ({ ...anchor, label: value.trim() || anchor.label }))
  }

  if ((field === 'anchorX' || field === 'anchorY') && typeof value === 'number' && state.selectedAnchorId) {
    return patchSelectedAnchor(state, (anchor) => {
      const current = anchor.worldPosition ?? [0, 0]
      return {
        ...anchor,
        worldPosition: field === 'anchorX'
          ? [value, current[1]]
          : [current[0], value],
      }
    })
  }

  if (field === 'constraintDistance' && typeof value === 'number' && state.selectedConstraintId) {
    const nextConstraints = calibration.constraints.map((constraint) =>
      constraint.constraintId === state.selectedConstraintId
        ? { ...constraint, distance: Math.max(value, 1e-6) }
        : constraint,
    )
    return {
      ...state,
      draftState: solveReferenceImageOperationState({
        ...state.draftState,
        calibration: {
          ...calibration,
          constraints: nextConstraints,
        },
      }),
    }
  }

  return state
}

function patchSelectedAnchor(
  state: ReferenceImageCalibrationModeState,
  update: (anchor: ReferenceImageCalibrationAnchor) => ReferenceImageCalibrationAnchor,
) {
  const calibration = getCalibrationState(state.draftState)
  const nextAnchors = calibration.anchors.map((anchor) =>
    anchor.anchorId === state.selectedAnchorId ? update(anchor) : anchor,
  )
  return {
    ...state,
    draftState: solveReferenceImageOperationState({
      ...state.draftState,
      calibration: {
        ...calibration,
        anchors: nextAnchors,
      },
    }),
  }
}

function addDistanceConstraint(state: ReferenceImageCalibrationModeState) {
  const [firstAnchorId, secondAnchorId] = state.pendingConstraintAnchorIds ?? []
  if (!firstAnchorId || !secondAnchorId) {
    return state
  }

  const calibration = getCalibrationState(state.draftState)
  const first = calibration.anchors.find((anchor) => anchor.anchorId === firstAnchorId)
  const second = calibration.anchors.find((anchor) => anchor.anchorId === secondAnchorId)
  if (!first || !second) {
    return state
  }

  const firstPosition = getSolvedAnchorPosition(state.draftState, first.anchorId)
  const secondPosition = getSolvedAnchorPosition(state.draftState, second.anchorId)
  if (!firstPosition || !secondPosition) {
    return state
  }

  const constraint = createReferenceImageCalibrationConstraint({
    constraintId: createConstraintId(state.operationId, calibration.constraints.length),
    constraintIndex: calibration.constraints.length,
    firstAnchorId: first.anchorId,
    secondAnchorId: second.anchorId,
    distance: distanceBetween(firstPosition, secondPosition),
  })

  return {
    ...state,
    selectedConstraintId: constraint.constraintId,
    selectedAnchorId: null,
    pendingConstraintAnchorIds: null,
    draftState: solveReferenceImageOperationState({
      ...state.draftState,
      calibration: {
        ...calibration,
        constraints: [...calibration.constraints, constraint],
      },
    }),
  }
}

function removeSelectedAnchor(state: ReferenceImageCalibrationModeState) {
  if (!state.selectedAnchorId) {
    return state
  }

  const calibration = getCalibrationState(state.draftState)
  const nextAnchors = calibration.anchors.filter((anchor) => anchor.anchorId !== state.selectedAnchorId)
  const nextConstraints = calibration.constraints.filter((constraint) =>
    constraint.firstAnchorId !== state.selectedAnchorId && constraint.secondAnchorId !== state.selectedAnchorId
  )

  return {
    ...state,
    selectedAnchorId: null,
    selectedConstraintId: null,
    pendingConstraintAnchorIds: null,
    draftState: solveReferenceImageOperationState({
      ...state.draftState,
      calibration: {
        ...calibration,
        anchors: nextAnchors,
        constraints: nextConstraints,
      },
    }),
  }
}

function removeSelectedConstraint(state: ReferenceImageCalibrationModeState) {
  if (!state.selectedConstraintId) {
    return state
  }

  const calibration = getCalibrationState(state.draftState)
  return {
    ...state,
    selectedConstraintId: null,
    pendingConstraintAnchorIds: null,
    draftState: solveReferenceImageOperationState({
      ...state.draftState,
      calibration: {
        ...calibration,
        constraints: calibration.constraints.filter((constraint) =>
          constraint.constraintId !== state.selectedConstraintId
        ),
      },
    }),
  }
}

function getSelectedAnchor(state: ReferenceImageCalibrationModeState) {
  return getCalibrationState(state.draftState).anchors.find((anchor) => anchor.anchorId === state.selectedAnchorId) ?? null
}

function getSelectedConstraint(state: ReferenceImageCalibrationModeState) {
  return getCalibrationState(state.draftState).constraints.find((constraint) => constraint.constraintId === state.selectedConstraintId) ?? null
}

function getSolvedAnchorPosition(
  draftState: SolvedReferenceImageOperationState,
  anchorId: string,
) {
  return getCalibrationState(draftState).solveResult.anchors.find((anchor) => anchor.anchorId === anchorId)?.worldPosition ?? null
}

function buildPrompt(
  state: ReferenceImageCalibrationModeState,
  scope: 'panel' | 'viewport',
) {
  if (state.pendingAnchorPlacement) {
    return {
      id: `${scope}-place-anchor`,
      text: scope === 'panel'
        ? 'Click the image to place a calibration anchor.'
        : 'Place a calibration anchor on the image.',
    }
  }

  if (state.pendingConstraintAnchorIds?.length === 0) {
    return {
      id: `${scope}-pick-first-anchor`,
      text: 'Click the first anchor for the new distance constraint.',
      tone: 'warning' as const,
    }
  }

  if (state.pendingConstraintAnchorIds?.length === 1) {
    return {
      id: `${scope}-pick-second-anchor`,
      text: 'Click a second anchor to define the distance constraint.',
      tone: 'warning' as const,
    }
  }

  return {
    id: `${scope}-drag-anchor`,
    text: 'Drag anchors to align the image to sketch-space references.',
  }
}

function getAnchorHandleTone(
  state: ReferenceImageCalibrationModeState,
  anchorId: string,
) {
  if (state.pendingConstraintAnchorIds?.includes(anchorId)) {
    return 'warning' as const
  }

  return state.selectedAnchorId === anchorId ? 'success' as const : 'neutral' as const
}

function selectAnchor(state: ReferenceImageCalibrationModeState, anchorId: string) {
  return {
    ...state,
    selectedAnchorId: anchorId,
    selectedConstraintId: null,
    pendingAnchorPlacement: false,
  }
}

function startDistanceConstraintSelection(state: ReferenceImageCalibrationModeState) {
  if (getCalibrationState(state.draftState).anchors.length < 2) {
    return state
  }

  return {
    ...state,
    pendingAnchorPlacement: false,
    pendingConstraintAnchorIds: [],
    selectedAnchorId: null,
    selectedConstraintId: null,
  }
}

function completePendingDistanceConstraintSelection(
  state: ReferenceImageCalibrationModeState,
  anchorId: string,
) {
  const pendingAnchorIds = state.pendingConstraintAnchorIds
  if (pendingAnchorIds === null) {
    return state
  }

  if (pendingAnchorIds.length === 0) {
    return {
      ...state,
      pendingConstraintAnchorIds: [anchorId],
      selectedAnchorId: anchorId,
      selectedConstraintId: null,
    }
  }

  if (pendingAnchorIds[0] === anchorId) {
    return {
      ...state,
      selectedAnchorId: anchorId,
      selectedConstraintId: null,
    }
  }

  return addDistanceConstraint({
    ...state,
    pendingConstraintAnchorIds: [pendingAnchorIds[0], anchorId],
    selectedAnchorId: anchorId,
    selectedConstraintId: null,
  })
}

function findNearestAnchor(
  state: ReferenceImageCalibrationModeState,
  point: SketchPoint2D,
) {
  const solvedAnchors = getCalibrationState(state.draftState).solveResult.anchors
  return solvedAnchors
    .map((anchor) => ({
      anchorId: anchor.anchorId,
      distance: distanceBetween(anchor.worldPosition, point),
    }))
    .filter((candidate) => candidate.distance <= ANCHOR_HIT_TOLERANCE)
    .sort((left, right) => left.distance - right.distance)[0] ?? null
}

function findNearestConstraint(
  state: ReferenceImageCalibrationModeState,
  point: SketchPoint2D,
) {
  return getCalibrationState(state.draftState).constraints
    .map((constraint) => {
      const first = getSolvedAnchorPosition(state.draftState, constraint.firstAnchorId)
      const second = getSolvedAnchorPosition(state.draftState, constraint.secondAnchorId)
      return first && second
        ? {
            constraintId: constraint.constraintId,
            distance: pointToSegmentDistance(point, first, second),
          }
        : null
    })
    .flatMap((constraint) => constraint ? [constraint] : [])
    .filter((candidate) => candidate.distance <= CONSTRAINT_HIT_TOLERANCE)
    .sort((left, right) => left.distance - right.distance)[0] ?? null
}

function worldPointToUv(
  point: SketchPoint2D,
  placement: SolvedReferenceImageOperationState['placement'],
): SketchPoint2D | null {
  const dx = point[0] - placement.center[0]
  const dy = point[1] - placement.center[1]
  const cos = Math.cos(-placement.rotationRadians)
  const sin = Math.sin(-placement.rotationRadians)
  const localX = dx * cos - dy * sin
  const localY = dx * sin + dy * cos
  if (placement.width <= 0 || placement.height <= 0) {
    return null
  }

  const uv: SketchPoint2D = [
    localX / placement.width + 0.5,
    0.5 - localY / placement.height,
  ]
  return uv[0] >= 0 && uv[0] <= 1 && uv[1] >= 0 && uv[1] <= 1 ? uv : null
}

function createAnchorId(operationId: SketchAuthoringOperationId, index: number) {
  return `${operationId}:anchor:${index + 1}`
}

function createConstraintId(operationId: SketchAuthoringOperationId, index: number) {
  return `${operationId}:distance:${index + 1}`
}

function pointToSegmentDistance(
  point: SketchPoint2D,
  start: SketchPoint2D,
  end: SketchPoint2D,
) {
  const dx = end[0] - start[0]
  const dy = end[1] - start[1]
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared <= 1e-9) {
    return distanceBetween(point, start)
  }

  const t = Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared))
  return distanceBetween(point, [
    start[0] + dx * t,
    start[1] + dy * t,
  ])
}

function distanceBetween(first: SketchPoint2D, second: SketchPoint2D) {
  return Math.hypot(first[0] - second[0], first[1] - second[1])
}

function isReferenceImagePayload(value: unknown): value is SolvedReferenceImageOperationState['image'] {
  return typeof value === 'object'
    && value !== null
    && typeof (value as { mediaType?: unknown }).mediaType === 'string'
    && typeof (value as { pixelWidth?: unknown }).pixelWidth === 'number'
    && typeof (value as { pixelHeight?: unknown }).pixelHeight === 'number'
    && typeof (value as { base64Data?: unknown }).base64Data === 'string'
}
