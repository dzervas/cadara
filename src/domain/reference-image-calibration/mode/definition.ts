import type {
  ReferenceImageCalibrationAnchor,
  ReferenceImageOperationState,
  SolvedReferenceImageCalibrationState,
  SolvedReferenceImageOperationState,
} from '@/contracts/reference-image/schema'
import type { SketchEntityDefinition, SketchPointDefinition, SketchPoint2D } from '@/contracts/sketch/schema'
import type { SketchAuthoringOperationId, SketchEntityId, SketchId, SketchPointId } from '@/contracts/shared/ids'
import type { PrimitiveRef } from '@/core/editor/schema'

import {
  createSketchSpecialModeHandleRef,
  createSketchSpecialModeTargetRef,
} from '@/core/sketch-special-modes/presentation'
import type {
  SketchSpecialModeDefinition,
  SketchSpecialModePanelButton,
  SketchSpecialModePanelField,
  SketchSpecialModePanelSchema,
  SketchSpecialModePanelSection,
  SketchSpecialModeViewportOverlay,
  SketchSpecialModeViewportPresentation,
} from '@/core/sketch-special-modes/schema'
import {
  collectActiveReferenceImageOperations,
} from '@/domain/reference-image/operations'
import {
  createReferenceImageCalibrationAnchor,
  replaceReferenceImagePayloadPreservingCalibration,
  solveReferenceImageOperationState,
} from '@/domain/reference-image-calibration/state'
import {
  REFERENCE_IMAGE_CALIBRATION_MODE_ID,
  type ReferenceImageCalibrationModeState,
} from '@/domain/reference-image-calibration/mode/shared'
import { updateReferenceImageOperationStates } from '@/domain/editor/sketch-session'

const ANCHOR_HIT_TOLERANCE = 10

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

    const draftPoints = collectDraftPoints(
      sketchSession.sketchId ?? 'sketch_draft',
      sketchSession.definition.points,
      activeOperation.state,
    )

    return {
      state: {
        sketchId: sketchSession.sketchId ?? 'sketch_draft',
        operationId: operationTarget.operationId,
        draftState: solveReferenceImageOperationState(activeOperation.state, {
          pointPositionsById: createPointPositionMap(draftPoints),
        }),
        draftPoints,
        selectedAnchorId: null,
        pendingAnchorPlacement: false,
      } satisfies ReferenceImageCalibrationModeState,
    }
  },
  buildPanel: ({ activeMode }) => buildPanel(activeMode.state as ReferenceImageCalibrationModeState),
  buildViewport: ({ activeMode }) => buildViewport(activeMode.state as ReferenceImageCalibrationModeState),
  handleClick: ({ sketchSession, activeMode, point, target }) =>
    handleClick(sketchSession.definition.points, activeMode.state as ReferenceImageCalibrationModeState, point, target),
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
              selectedAnchorId: null,
            },
          }
        case 'rebind-anchor':
          return {
            state: state.selectedAnchorId
              ? {
                  ...state,
                  pendingAnchorPlacement: true,
                }
              : state,
          }
        case 'remove-anchor':
          return {
            state: removeSelectedAnchor(state),
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
          pointPositionsById: createPointPositionMap(state.draftPoints),
        }),
      },
      effect: null,
    }
  },
  commit: ({ sketchSession, activeMode }) => {
    const state = activeMode.state as ReferenceImageCalibrationModeState
    const existingPointIds = new Set(sketchSession.definition.pointIds)
    const existingEntityIds = new Set(sketchSession.definition.entityIds)
    const createdPoints = state.draftPoints.filter((point) => !existingPointIds.has(point.pointId))
    const createdEntities = createdPoints.flatMap((point) => {
      const entity = createDraftPointEntity(state.sketchId, state.operationId, point)
      return existingEntityIds.has(entity.entityId) ? [] : [entity]
    })
    const nextSession = updateReferenceImageOperationStates({
      session: sketchSession,
      updates: [{
        operationId: state.operationId,
        state: state.draftState,
        label: state.draftState.image.fileName,
        createdPoints,
        createdEntities,
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
  const diagnostics = calibration.solveResult.diagnostics
  const anchorOptions = calibration.anchors.map((anchor) => ({
    value: anchor.anchorId,
    label: anchor.label,
  }))
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
      label: 'Show bound anchors in sketch',
      value: calibration.showExportedAnchorsInSketch,
      action: { kind: 'patch', patch: { field: 'showExportedAnchorsInSketch' } },
    },
    {
      id: 'anchor-count',
      kind: 'readout',
      label: 'Bound anchors',
      value: String(calibration.anchors.length),
    },
  ]
  const anchorFields: SketchSpecialModePanelField[] = [
    {
      id: 'anchor-selection',
      kind: 'option',
      label: 'Selected anchor',
      value: state.selectedAnchorId,
      options: anchorOptions,
      helper: calibration.anchors.length > 0 ? `${calibration.anchors.length} bound anchors available.` : 'No anchors yet.',
      disabled: calibration.anchors.length === 0,
      action: { kind: 'patch', patch: { field: 'selectedAnchorId' } },
    },
    ...(selectedAnchor
      ? ([
          {
            id: 'anchor-label',
            kind: 'text',
            label: 'Label',
            value: selectedAnchor.label,
            action: { kind: 'patch', patch: { field: 'anchorLabel' } },
          },
          {
            id: 'anchor-point-id',
            kind: 'readout',
            label: 'Point binding',
            value: selectedAnchor.pointId,
          },
        ] satisfies SketchSpecialModePanelField[])
      : []),
  ]
  const anchorButtons: SketchSpecialModePanelButton[] = [
    {
      id: 'add-anchor',
      label: 'Add Anchor',
      tone: 'primary',
      action: { kind: 'invoke', actionId: 'add-anchor' },
    },
    {
      id: 'rebind-anchor',
      label: state.pendingAnchorPlacement && state.selectedAnchorId ? 'Picking Binding' : 'Rebind Anchor',
      disabled: state.selectedAnchorId === null,
      action: { kind: 'invoke', actionId: 'rebind-anchor' },
    },
    {
      id: 'remove-anchor',
      label: 'Remove Anchor',
      disabled: selectedAnchor === null,
      action: { kind: 'invoke', actionId: 'remove-anchor' },
    },
  ]
  const sections: SketchSpecialModePanelSection[] = [
    {
      id: 'solve',
      title: 'Placement',
      description: 'Reference-image placement is recovered from solved sketch point bindings after ordinary sketch solving.',
      fields: solveFields,
    },
    {
      id: 'anchors',
      title: 'Anchors',
      description: state.pendingAnchorPlacement
        ? state.selectedAnchorId
          ? 'Click an existing sketch point to rebind, or click the image to create a new construction point binding.'
          : 'Click the image to place a new bound construction point.'
        : 'Anchors bind the image to ordinary sketch points.',
      fields: anchorFields,
      buttons: anchorButtons,
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
  const overlays: SketchSpecialModeViewportOverlay[] = calibration.anchors.flatMap((anchor) => {
    const solved = solvedByAnchorId.get(anchor.anchorId)
    return solved
      ? [{
          id: `anchor:${anchor.anchorId}`,
          kind: 'handle' as const,
          label: anchor.label,
          anchor: { kind: 'sketchPoint' as const, point: solved },
          handle: createSketchSpecialModeHandleRef(state.operationId, anchor.anchorId),
          tone: state.selectedAnchorId === anchor.anchorId ? 'success' as const : 'neutral' as const,
          draggable: false,
        }]
      : []
  })

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
  definitionPoints: readonly SketchPointDefinition[],
  state: ReferenceImageCalibrationModeState,
  point: SketchPoint2D,
  target: PrimitiveRef | null,
) {
  if (state.pendingAnchorPlacement) {
    if (state.selectedAnchorId && target?.kind === 'sketchPoint') {
      const boundPoint = definitionPoints.find((candidate) => candidate.pointId === target.pointId)
      return boundPoint
        ? {
            state: solveModeState({
              ...state,
              draftPoints: upsertDraftPoint(state.draftPoints, boundPoint),
              draftState: {
                ...state.draftState,
                calibration: {
                  ...getCalibrationState(state.draftState),
                  anchors: getCalibrationState(state.draftState).anchors.map((anchor) =>
                    anchor.anchorId === state.selectedAnchorId
                      ? { ...anchor, pointId: target.pointId }
                      : anchor,
                  ),
                },
              },
              pendingAnchorPlacement: false,
            }),
          }
        : { state }
    }

    const uv = worldPointToUv(point, state.draftState.placement)
    if (!uv || target?.kind !== 'sketchOperation' || target.operationId !== state.operationId) {
      return { state }
    }

    const calibration = getCalibrationState(state.draftState)

    if (state.selectedAnchorId) {
      const pointId = createAnchorPointId(state.operationId, state.selectedAnchorId)
      const nextPoint = createDraftPoint(
        state.sketchId,
        pointId,
        getAnchorLabel(getAnchorOrdinalFromId(state.selectedAnchorId) - 1),
        point,
      )

      return {
        state: solveModeState({
          ...state,
          draftPoints: upsertDraftPoint(removeUnusedDraftPoint(state), nextPoint),
          draftState: {
            ...state.draftState,
            calibration: {
              ...calibration,
              anchors: calibration.anchors.map((anchor) =>
                anchor.anchorId === state.selectedAnchorId
                  ? {
                      ...anchor,
                      uv,
                      pointId,
                    }
                  : anchor,
              ),
            },
          },
          pendingAnchorPlacement: false,
        }),
      }
    }

    const nextAnchorOrdinal = getNextAnchorOrdinal(state.operationId, calibration.anchors)
    const nextAnchorId = createAnchorId(state.operationId, nextAnchorOrdinal)
    const nextPoint = createDraftPoint(
      state.sketchId,
      createAnchorPointId(state.operationId, nextAnchorId),
      getAnchorLabel(nextAnchorOrdinal - 1),
      point,
    )
    const nextAnchor = createReferenceImageCalibrationAnchor({
      anchorId: nextAnchorId,
      anchorIndex: nextAnchorOrdinal - 1,
      uv,
      pointId: nextPoint.pointId,
    })

    return {
      state: solveModeState({
        ...state,
        draftPoints: [...state.draftPoints, nextPoint],
        draftState: {
          ...state.draftState,
          calibration: {
            ...calibration,
            anchors: [...calibration.anchors, nextAnchor],
          },
        },
        selectedAnchorId: nextAnchor.anchorId,
        pendingAnchorPlacement: false,
      }),
    }
  }

  const selectedAnchor = findNearestAnchor(state, point)
  if (selectedAnchor) {
    return {
      state: {
        ...state,
        selectedAnchorId: selectedAnchor.anchorId,
        pendingAnchorPlacement: false,
      },
    }
  }

  return {
    state: {
      ...state,
      selectedAnchorId: null,
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
    return solveModeState({
      ...state,
      draftState: {
        ...state.draftState,
        calibration: {
          ...calibration,
          scaleMode: value,
        },
      },
    })
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

  if (field === 'selectedAnchorId') {
    return {
      ...state,
      selectedAnchorId: typeof value === 'string' && calibration.anchors.some((anchor) => anchor.anchorId === value)
        ? value
        : null,
      pendingAnchorPlacement: false,
    }
  }

  if (field === 'anchorLabel' && typeof value === 'string' && state.selectedAnchorId) {
    return solveModeState({
      ...state,
      draftState: {
        ...state.draftState,
        calibration: {
          ...calibration,
          anchors: calibration.anchors.map((anchor) =>
            anchor.anchorId === state.selectedAnchorId
              ? { ...anchor, label: value.trim() || anchor.label }
              : anchor,
          ),
        },
      },
    })
  }

  return state
}

function removeSelectedAnchor(state: ReferenceImageCalibrationModeState) {
  if (!state.selectedAnchorId) {
    return state
  }

  const calibration = getCalibrationState(state.draftState)
  const anchorToRemove = calibration.anchors.find((anchor) => anchor.anchorId === state.selectedAnchorId)
  if (!anchorToRemove) {
    return state
  }

  const nextAnchors = calibration.anchors.filter((anchor) => anchor.anchorId !== state.selectedAnchorId)
  const nextDraftPoints = state.draftPoints.filter((point) =>
    point.pointId !== anchorToRemove.pointId
      || nextAnchors.some((anchor) => anchor.pointId === point.pointId),
  )

  return solveModeState({
    ...state,
    draftPoints: nextDraftPoints,
    draftState: {
      ...state.draftState,
      calibration: {
        ...calibration,
        anchors: nextAnchors,
      },
    },
    selectedAnchorId: null,
    pendingAnchorPlacement: false,
  })
}

function getSelectedAnchor(state: ReferenceImageCalibrationModeState) {
  return getCalibrationState(state.draftState).anchors.find((anchor) => anchor.anchorId === state.selectedAnchorId) ?? null
}

function solveModeState(
  state: ReferenceImageCalibrationModeState,
): ReferenceImageCalibrationModeState {
  return {
    ...state,
    draftState: solveReferenceImageOperationState(state.draftState, {
      pointPositionsById: createPointPositionMap(state.draftPoints),
    }),
  }
}

function collectDraftPoints(
  sketchId: SketchId,
  definitionPoints: readonly SketchPointDefinition[],
  state: Pick<ReferenceImageOperationState, 'calibration'>,
) {
  const calibration = state.calibration ?? { anchors: [] }
  const pointLookup = new Map(definitionPoints.map((point) => [point.pointId, point] as const))

  return calibration.anchors.flatMap((anchor, index) => {
    const point = pointLookup.get(anchor.pointId as SketchPointId)
    if (point) {
      return [point]
    }

    if (anchor.legacyWorldPosition) {
      return [createDraftPoint(sketchId, anchor.pointId as SketchPointId, anchor.label || getAnchorLabel(index), anchor.legacyWorldPosition)]
    }

    return []
  })
}

function createPointPositionMap(points: readonly SketchPointDefinition[]) {
  return new Map(points.map((point) => [point.pointId, point.position] as const))
}

function upsertDraftPoint(
  draftPoints: readonly SketchPointDefinition[],
  point: SketchPointDefinition,
) {
  const nextPoints = draftPoints.filter((candidate) => candidate.pointId !== point.pointId)
  nextPoints.push(point)
  return nextPoints
}

function removeUnusedDraftPoint(state: ReferenceImageCalibrationModeState) {
  const selectedAnchor = getSelectedAnchor(state)
  if (!selectedAnchor) {
    return state.draftPoints
  }

  const remainingAnchors = getCalibrationState(state.draftState).anchors.filter((anchor) =>
    anchor.anchorId !== selectedAnchor.anchorId && anchor.pointId === selectedAnchor.pointId
  )
  return remainingAnchors.length > 0
    ? state.draftPoints
    : state.draftPoints.filter((point) => point.pointId !== selectedAnchor.pointId)
}

function createDraftPoint(
  sketchId: SketchId,
  pointId: SketchPointId,
  label: string,
  position: SketchPoint2D,
): SketchPointDefinition {
  return {
    pointId,
    label,
    target: {
      kind: 'sketchPoint',
      sketchId,
      pointId,
    },
    position,
    isConstruction: true,
  }
}

function createDraftPointEntity(
  sketchId: SketchId,
  operationId: SketchAuthoringOperationId,
  point: SketchPointDefinition,
): SketchEntityDefinition {
  const entityId = (
    `sketch_entity_${operationId.replace(/[^a-zA-Z0-9]+/g, '_')}_${point.pointId.replace(/[^a-zA-Z0-9]+/g, '_')}_point`
  ) as SketchEntityId
  return {
    kind: 'point',
    entityId,
    label: point.label,
    target: {
      kind: 'sketchEntity',
      sketchId,
      entityId,
    },
    isConstruction: true,
    pointId: point.pointId,
  }
}

function findNearestAnchor(
  state: ReferenceImageCalibrationModeState,
  point: SketchPoint2D,
) {
  const solvedByAnchorId = new Map(
    getCalibrationState(state.draftState).solveResult.anchors.map((anchor) => [anchor.anchorId, anchor.worldPosition] as const),
  )

  let nearest: ReferenceImageCalibrationAnchor | null = null
  let bestDistance = Number.POSITIVE_INFINITY

  for (const anchor of getCalibrationState(state.draftState).anchors) {
    const solved = solvedByAnchorId.get(anchor.anchorId)
    if (!solved) {
      continue
    }

    const delta = distanceBetween(solved, point)
    if (delta <= ANCHOR_HIT_TOLERANCE && delta < bestDistance) {
      nearest = anchor
      bestDistance = delta
    }
  }

  return nearest
}

function buildPrompt(
  state: ReferenceImageCalibrationModeState,
  surface: 'panel' | 'viewport',
) {
  if (state.pendingAnchorPlacement) {
    return {
      id: `reference-image-calibration-${surface}-prompt`,
      text: state.selectedAnchorId
        ? 'Select a sketch point to rebind, or click the image to create a new bound construction point.'
        : 'Click the image to place a bound construction point.',
    }
  }

  return {
    id: `reference-image-calibration-${surface}-prompt`,
    text: 'Manage image anchor bindings, then return to normal sketch tools for constraints and dimensions.',
  }
}

function isReferenceImagePayload(
  value: unknown,
): value is SolvedReferenceImageOperationState['image'] {
  return typeof value === 'object'
    && value !== null
    && typeof (value as { mediaType?: unknown }).mediaType === 'string'
    && typeof (value as { pixelWidth?: unknown }).pixelWidth === 'number'
    && typeof (value as { pixelHeight?: unknown }).pixelHeight === 'number'
    && typeof (value as { base64Data?: unknown }).base64Data === 'string'
}

function worldPointToUv(
  point: SketchPoint2D,
  placement: SolvedReferenceImageOperationState['placement'],
) {
  const dx = point[0] - placement.center[0]
  const dy = point[1] - placement.center[1]
  const cos = Math.cos(-placement.rotationRadians)
  const sin = Math.sin(-placement.rotationRadians)
  const localX = dx * cos - dy * sin
  const localY = dx * sin + dy * cos

  if (placement.width <= 0 || placement.height <= 0) {
    return null
  }

  const u = localX / placement.width + 0.5
  const v = 0.5 - localY / placement.height

  return u >= 0 && u <= 1 && v >= 0 && v <= 1
    ? [u, v] as SketchPoint2D
    : null
}

function distanceBetween(first: SketchPoint2D, second: SketchPoint2D) {
  return Math.hypot(first[0] - second[0], first[1] - second[1])
}

function createAnchorId(
  operationId: SketchAuthoringOperationId,
  ordinal: number,
) {
  return `${operationId}_anchor_${ordinal}`
}

function createAnchorPointId(
  operationId: SketchAuthoringOperationId,
  anchorKey: string,
) {
  return `sketch_point_${operationId.replace(/[^a-zA-Z0-9]+/g, '_')}_${anchorKey.replace(/[^a-zA-Z0-9]+/g, '_')}` as SketchPointId
}

function getNextAnchorOrdinal(
  operationId: SketchAuthoringOperationId,
  anchors: readonly ReferenceImageCalibrationAnchor[],
) {
  return anchors.reduce((maxOrdinal, anchor) => {
    const ordinal = getAnchorOrdinalFromId(anchor.anchorId, operationId)
    return ordinal > maxOrdinal ? ordinal : maxOrdinal
  }, 0) + 1
}

function getAnchorOrdinalFromId(
  anchorId: string,
  operationId?: SketchAuthoringOperationId,
) {
  const pattern = operationId
    ? new RegExp(`^${escapeRegExp(operationId)}_anchor_(\\d+)$`)
    : /_anchor_(\d+)$/
  const match = pattern.exec(anchorId)
  const ordinal = match ? Number.parseInt(match[1] ?? '', 10) : Number.NaN
  return Number.isFinite(ordinal) && ordinal > 0 ? ordinal : 1
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function getAnchorLabel(index: number) {
  return `Anchor ${index + 1}`
}
