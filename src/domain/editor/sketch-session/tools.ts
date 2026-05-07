import type { SketchPoint } from '@/contracts/modeling/schema'
import type {
  ConstraintId,
  ReferenceId,
  SketchEntityId,
  SketchId,
  SketchPointId,
} from '@/contracts/shared/ids'
import type {
  ConstraintDefinition,
  ProjectedSketchGeometryConstraintOperand,
  ProjectedSketchGeometryRef,
  ReadOnlySketchCurveConstraintOperand,
  ReadOnlySketchPointConstraintOperand,
  SketchDefinition,
  SketchReferenceDefinition,
} from '@/contracts/sketch/schema'
import {
  type PrimitiveRef,
  primitiveRefEquals,
} from '@/core/editor/schema'
import {
  getSketchConstraintDefinition,
  inferDimensionAnnotationPlacement,
  isRegisteredSketchConstraintToolId,
} from '@/core/sketch-constraints/registry'
import type {
  SketchEditToolId,
  SketchEditToolSelectionRequirement,
} from '@/core/sketch-edit-tools/definition'
import {
  getSketchEditToolDefinition,
  isRegisteredSketchEditToolId,
} from '@/core/sketch-edit-tools/registry'
import {
  type SketchSnapCandidate,
  type SketchSnapSourceRef,
  collectSketchSnapGeometries,
  resolveSketchSnap,
} from '@/domain/sketch-snapping/snap-candidates'
import { buildSketchStylePresentation } from '@/domain/sketch-styles/definition'
import type {
  SketchDraftEntity,
  SketchToolCommitContribution,
  SketchToolId,
} from '@/core/sketch-tools/definition'
import type {
  SketchToolAnchorDescriptor,
  SketchToolControlValue,
  SketchToolOverlayDescriptor,
  SketchToolPresentationSchema,
} from '@/core/sketch-tools/editor-schema'
import {
  getSketchToolDefinition,
} from '@/core/sketch-tools/registry'
import type {
  SketchAuthoringToolId,
  SketchConstraintAuthoringState,
  SketchEditToolState,
  SketchSessionState,
} from './types'
import {
  applySketchHistoryContribution,
  createArcEntityDefinition,
  createAuthoringOperationFromContribution,
  createBezierCurveEntityDefinition,
  createCircleEntityDefinition,
  createConicEntityDefinition,
  createConstraintId,
  createDimensionId,
  createEllipseEntityDefinition,
  createEllipticalArcEntityDefinition,
  createEntityId,
  createLineEntityDefinition,
  createPointDefinition,
  createPointEntityDefinition,
  createPointId,
  createProfileTextEntityDefinition,
  createSplineEntityDefinition,
  deriveSolvedRegionsForSession,
  filterSketchDefinitionThroughCursor,
  getSessionSketchId,
  getSketchSessionRegionDiagnostics,
  getTargetKey,
  isDrawingSketchTool,
  rebuildSessionCommitRequest,
  withConstructionFlag,
} from './internals'
import {
  buildCommittedDimensionOverlays,
} from './annotations'
import {
  activateSketchConstraintTool,
  buildConstraintToolPresentation,
  isSketchConstraintReadyForValue,
} from './constraints'
import {
  selectSketchEditToolTarget,
} from './editing'
import {
  isSketchConstructionSelected,
} from './state'
import {
  getSketchStyleTargetDefinition,
} from './styles'
import {
  buildCommitRequest,
} from './history'

export function buildConstructionTargetPresentation(): SketchToolPresentationSchema {
  return {
    prompts: [
      {
        id: 'construction-prompt',
        text: 'Select sketch geometry to toggle construction',
      },
    ],
    steps: [{ id: 'construction-target', label: 'Sketch geometry' }],
    selectionGuide: {
      id: 'construction-selection-guide',
      label: 'Select sketch geometry',
      acceptedKinds: ['point', 'line', 'circle', 'arc'],
      selectedCount: 0,
      requiredCount: 1,
      hoverLabel: null,
    },
    completionHints: [
      {
        id: 'construction-completion',
        text: 'Select an edge or vertex to toggle construction',
        ready: false,
      },
    ],
  }
}

export function buildReferenceTargetPresentation(validationMessage: string | null = null): SketchToolPresentationSchema {
  return {
    prompts: [
      {
        id: 'reference-prompt',
        text: 'Select model or existing sketch geometry to reference',
      },
    ],
    steps: [{ id: 'reference-target', label: 'Reference geometry' }],
    selectionGuide: {
      id: 'reference-selection-guide',
      label: 'Select reference geometry',
      acceptedKinds: ['point', 'line', 'circle', 'arc'],
      selectedCount: 0,
      requiredCount: 1,
      hoverLabel: null,
    },
    validation: validationMessage
      ? [{
          id: 'reference-validation',
          message: validationMessage,
          severity: 'warning',
        }]
      : [],
    completionHints: [
      {
        id: 'reference-completion',
        text: 'Accepted references stay derived and read-only',
        ready: false,
      },
    ],
  }
}

export function beginSketchConstructionTool(session: SketchSessionState): SketchSessionState {
  if (isSketchConstructionSelected(session)) {
    return {
      ...session,
      activeTool: null,
      status: 'idle',
      constructionTargetPicking: false,
      referenceTargetPicking: false,
      constructionModifierActive: false,
      pointerDownPoint: null,
      livePoint: null,
      toolStagedEntities: [],
      validationMessage: null,
      toolPresentation: null,
      constraintAuthoring: null,
      activeAnnotationEdit: null,
      selectedAnnotation: null,
      activeEditTool: null,
      activeEditTarget: null,
      activeStyleFocus: null,
      activeDrag: null,
      activeSnap: null,
      drawStartSnap: null,
    }
  }

  return {
    ...session,
    activeTool: 'construction',
    status: 'collectingTargets',
    constructionTargetPicking: true,
    referenceTargetPicking: false,
    constructionModifierActive: false,
    pointerDownPoint: null,
    livePoint: null,
    toolStagedEntities: [],
    validationMessage: null,
    toolPresentation: buildConstructionTargetPresentation(),
    constraintAuthoring: null,
    activeAnnotationEdit: null,
    selectedAnnotation: null,
    activeEditTool: null,
    activeEditTarget: null,
    activeStyleFocus: null,
    activeDrag: null,
    activeSnap: null,
    drawStartSnap: null,
  }
}

export function beginSketchReferenceTool(session: SketchSessionState): SketchSessionState {
  if (session.referenceTargetPicking) {
    return clearActiveSketchTool(session)
  }

  return {
    ...session,
    activeTool: 'projectReference',
    status: 'collectingTargets',
    constructionTargetPicking: false,
    referenceTargetPicking: true,
    constructionModifierActive: false,
    pointerDownPoint: null,
    livePoint: null,
    toolStagedEntities: [],
    validationMessage: null,
    toolPresentation: buildReferenceTargetPresentation(),
    constraintAuthoring: null,
    activeAnnotationEdit: null,
    selectedAnnotation: null,
    activeEditTool: null,
    activeEditTarget: null,
    activeStyleFocus: null,
    activeDrag: null,
    activeSnap: null,
    drawStartSnap: null,
  }
}

export function buildSketchEditToolPresentation(
  state: SketchEditToolState,
  validationMessage: string | null = null,
  previewEntities: readonly SketchDraftEntity[] = [],
): SketchToolPresentationSchema {
  const isOffset = state.toolId === 'offset'
  const isTrim = state.toolId === 'trim'
  const definition = getSketchEditToolDefinition(state.toolId)
  const metadata = definition.metadata
  const selectedCount = state.selectedTargets.length
  const hasSelection = selectedCount > 0
  const hoverLabel = state.hoverTarget?.kind === 'sketchEntity' ? 'Sketch entity' : null
  const needsNumericValue =
    state.toolId === 'sketchFillet'
    || state.toolId === 'sketchChamfer'
    || state.toolId === 'sketchSlot'
    || state.toolId === 'sketchLinearPattern'
    || state.toolId === 'sketchCircularPattern'
    || state.toolId === 'sketchTransform'
  const numericLabel = state.toolId === 'sketchFillet'
    ? 'Radius'
    : state.toolId === 'sketchChamfer'
      ? 'Distance'
      : state.toolId === 'sketchSlot'
        ? 'Width'
        : state.toolId === 'sketchCircularPattern'
          ? 'Angle'
          : 'Distance'
  const numericUnit = state.toolId === 'sketchCircularPattern' ? 'rad' : 'mm'
  const isReady = hasSelection && previewEntities.length > 0 && validationMessage === null
  const promptText = isOffset
    ? hasSelection ? 'Set offset distance' : metadata.validationMessages.emptySelection
    : isTrim
      ? metadata.validationMessages.emptySelection
      : hasSelection
        ? needsNumericValue ? `Set ${numericLabel.toLowerCase()}` : `Accept ${metadata.name.toLowerCase()}`
        : metadata.validationMessages.emptySelection
  const validation = validationMessage
    ? [{ id: `${state.toolId}-validation`, message: validationMessage, severity: 'error' as const }]
    : []

  return {
    prompts: [{
      id: `${state.toolId}-prompt`,
      text: promptText,
      tone: validation.length > 0 ? 'warning' : 'neutral',
    }],
    selectionGuide: {
      id: `${state.toolId}-selection`,
      label: metadata.selection.label,
      acceptedKinds: metadata.selection.acceptedKinds,
      selectedCount,
      requiredCount: metadata.selection.requiredCount,
      hoverLabel,
    },
    controls: [
      ...(isOffset
        ? [
            {
              id: 'offset-distance',
              kind: 'numeric' as const,
              label: 'Distance',
              value: state.offsetDistance,
              unit: 'mm',
              disabled: !hasSelection,
              action: { type: 'patch' as const, patch: { intent: 'setOffsetDistance' } },
            },
            {
              id: 'offset-side',
              kind: 'option' as const,
              label: 'Side',
              value: state.offsetSide,
              options: [
                { value: 'left', label: 'Left / outward' },
                { value: 'right', label: 'Right / inward' },
              ],
              disabled: !hasSelection,
              action: { type: 'patch' as const, patch: { intent: 'setOffsetSide' } },
            },
          ]
        : []),
      ...(needsNumericValue
        ? [{
            id: `${state.toolId}-value`,
            kind: 'numeric' as const,
            label: numericLabel,
            value: state.toolValue,
            unit: numericUnit,
            disabled: !hasSelection,
            action: { type: 'patch' as const, patch: { intent: 'setSketchEditValue' } },
          }]
        : []),
    ],
    completionHints: [{
      id: `${state.toolId}-completion`,
      text: isOffset
        ? hasSelection ? 'Confirm to create offset geometry' : 'Select connected lines or one curve'
        : hasSelection ? `Confirm ${metadata.previewLabel.toLowerCase()}` : metadata.validationMessages.emptySelection,
      ready: Boolean(isReady),
    }],
    floatingInput: isOffset && hasSelection
      ? {
          id: 'offset-distance-input',
          label: 'Offset distance',
          value: state.offsetDistance,
          unit: 'mm',
          min: 0,
          confirmLabel: 'Create',
          cancelLabel: 'Cancel',
          placement: 'target',
          anchor: previewEntities[0]?.kind === 'line'
            ? {
                kind: 'sketchPoint' as const,
                point: [
                  (previewEntities[0].start[0] + previewEntities[0].end[0]) / 2,
                  (previewEntities[0].start[1] + previewEntities[0].end[1]) / 2,
                ],
                offset: { x: 18, y: -18 },
              }
            : previewEntities[0]?.kind === 'circle'
              ? { kind: 'sketchPoint' as const, point: previewEntities[0].center, offset: { x: 18, y: -18 } }
              : undefined,
          submitAction: { type: 'patch', patch: { intent: 'commitOffset' } },
          cancelAction: { type: 'patch', patch: { intent: 'cancelOffset' } },
        }
      : needsNumericValue && hasSelection
        ? {
            id: `${state.toolId}-value-input`,
            label: numericLabel,
            value: state.toolValue,
            unit: numericUnit,
            min: 0,
            confirmLabel: 'Create',
            cancelLabel: 'Cancel',
            placement: 'target',
            anchor: getPreviewAnchor(previewEntities),
            submitAction: { type: 'patch', patch: { intent: 'commitSketchEditOperator' } },
            cancelAction: { type: 'patch', patch: { intent: 'cancelSketchEditOperator' } },
          }
      : null,
    overlays: state.hoverTarget
      ? [{
          id: `${state.toolId}-target-feedback`,
          kind: 'referenceLabel',
          label: hoverLabel ?? 'Unsupported target',
          anchor: { kind: 'sketchPoint', point: [0, 0], offset: { x: 18, y: -18 } },
        }]
      : [],
    validation,
    extension: {
      id: `${state.toolId}-workflow`,
      payload: {
        toolId: state.toolId,
        hasSelection,
        selectedCount,
        mutationContract: metadata.mutationContract,
        previewEntityCount: previewEntities.length,
      },
    },
  }
}

export function getPreviewAnchor(previewEntities: readonly SketchDraftEntity[]): SketchToolAnchorDescriptor | undefined {
  const preview = previewEntities[0]
  if (!preview) {
    return undefined
  }

  if (preview.kind === 'line') {
    return {
      kind: 'sketchPoint',
      point: midpointSketchPoints(preview.start, preview.end),
      offset: { x: 18, y: -18 },
    }
  }

  if (preview.kind === 'circle') {
    return { kind: 'sketchPoint', point: preview.center, offset: { x: 18, y: -18 } }
  }

  const points = preview.kind === 'spline' || preview.kind === 'polyline' ? preview.points : []
  const point = points[Math.floor(points.length / 2)]
  return point ? { kind: 'sketchPoint', point, offset: { x: 18, y: -18 } } : undefined
}

export function midpointSketchPoints(left: SketchPoint, right: SketchPoint): SketchPoint {
  return [(left[0] + right[0]) / 2, (left[1] + right[1]) / 2]
}

export function getSketchEditSelectionKindForEntity(
  definition: SketchDefinition,
  entityId: SketchEntityId,
): SketchEditToolSelectionRequirement['acceptedKinds'][number] | null {
  const entity = definition.entities.find((entry) => entry.entityId === entityId)

  if (!entity) {
    return null
  }

  switch (entity.kind) {
    case 'point':
      return 'point'
    case 'lineSegment':
      return 'line'
    case 'circle':
      return 'circle'
    case 'arc':
      return 'arc'
    case 'spline':
      return 'spline'
    default:
      return null
  }
}

export function getSketchEditSelectionKindForProjectedGeometry(
  target: Extract<PrimitiveRef, { kind: 'projectedReferenceGeometry' }>,
): SketchEditToolSelectionRequirement['acceptedKinds'][number] | null {
  switch (target.geometryKind) {
    case 'lineSegment':
      return 'line'
    case 'circle':
      return 'circle'
    case 'arc':
      return 'arc'
    case 'spline':
      return 'spline'
    default:
      return null
  }
}

export function canAppendSketchEditToolActivationTarget(
  session: SketchSessionState,
  toolId: SketchEditToolId,
  selectedTargets: readonly PrimitiveRef[],
  target: PrimitiveRef,
) {
  const metadata = getSketchEditToolDefinition(toolId).metadata

  if (selectedTargets.some((selected) => primitiveRefEquals(selected, target))) {
    return false
  }

  if (!metadata.selection.allowsMultiple && selectedTargets.length >= metadata.selection.requiredCount) {
    return false
  }

  if (
    selectedTargets.some((selected) => selected.kind === 'projectedReferenceGeometry')
    || target.kind === 'projectedReferenceGeometry'
  ) {
    const selectionKind = target.kind === 'projectedReferenceGeometry'
      ? getSketchEditSelectionKindForProjectedGeometry(target)
      : null
    return toolId === 'offset'
      && selectedTargets.length === 0
      && target.kind === 'projectedReferenceGeometry'
      && selectionKind !== null
      && metadata.selection.acceptedKinds.includes(selectionKind)
  }

  if (target.kind !== 'sketchEntity') {
    return false
  }

  const selectionKind = getSketchEditSelectionKindForEntity(session.definition, target.entityId)
  return selectionKind !== null && metadata.selection.acceptedKinds.includes(selectionKind)
}

export function adoptCompatibleSketchEditToolTargets(
  session: SketchSessionState,
  toolId: SketchEditToolId,
  targets: readonly PrimitiveRef[],
): PrimitiveRef[] {
  const adoptedTargets: PrimitiveRef[] = []

  for (const target of targets) {
    if (!canAppendSketchEditToolActivationTarget(session, toolId, adoptedTargets, target)) {
      return []
    }

    adoptedTargets.push(target)
  }

  return adoptedTargets
}

export function beginSketchEditTool(
  session: SketchSessionState,
  toolId: SketchEditToolId,
  initialSelectedTargets: readonly PrimitiveRef[] = [],
): SketchSessionState {
  const activeEditTool: SketchEditToolState = {
    toolId,
    hoverTarget: null,
    selectedTarget: null,
    selectedTargets: [],
    offsetDistance: 1,
    offsetSide: 'left',
    toolValue: toolId === 'sketchSlot' ? 2 : 1,
  }

  let nextSession: SketchSessionState = {
    ...session,
    activeTool: toolId,
    activeEditTool,
    status: 'collectingTargets',
    constructionTargetPicking: false,
    referenceTargetPicking: false,
    constructionModifierActive: false,
    pointerDownPoint: null,
    livePoint: null,
    toolStagedEntities: [],
    validationMessage: null,
    toolPresentation: buildSketchEditToolPresentation(activeEditTool),
    constraintAuthoring: null,
    activeAnnotationEdit: null,
    selectedAnnotation: null,
    activeEditTarget: null,
    activeStyleFocus: null,
    activeDrag: null,
    activeSnap: null,
    drawStartSnap: null,
  }

  const adoptedTargets = adoptCompatibleSketchEditToolTargets(session, toolId, initialSelectedTargets)

  for (const target of adoptedTargets) {
    nextSession = selectSketchEditToolTarget(nextSession, target)
  }

  return nextSession
}

export function beginSketchTool(
  session: SketchSessionState,
  toolId: SketchAuthoringToolId,
  initialSelectedTargets: readonly PrimitiveRef[] = [],
): SketchSessionState {
  if (toolId === 'construction') {
    return beginSketchConstructionTool(session)
  }

  if (toolId === 'projectReference') {
    return beginSketchReferenceTool(session)
  }

  if (isRegisteredSketchConstraintToolId(toolId)) {
    return {
      ...activateSketchConstraintTool(session, toolId),
      constructionTargetPicking: false,
      referenceTargetPicking: false,
    }
  }

  if (isRegisteredSketchEditToolId(toolId)) {
    return beginSketchEditTool(session, toolId, initialSelectedTargets)
  }

  const toolDefinition = getSketchToolDefinition(toolId)
  const activation = toolDefinition.activate()
  const constructionModifierActive =
    session.constructionModifierActive || session.constructionTargetPicking

  return {
    ...session,
    activeTool: toolId,
    status: activation.state.status,
    constructionTargetPicking: false,
    referenceTargetPicking: false,
    constructionModifierActive,
    pointerDownPoint: activation.state.pointerDownPoint,
    livePoint: activation.state.livePoint,
    toolPlacedPoints: activation.state.placedPoints ?? [],
    toolSettings: activation.state.settings ?? {},
    toolStagedEntities: [],
    validationMessage: activation.state.validationMessage,
    toolPresentation: activation.presentation,
    constraintAuthoring: null,
    activeAnnotationEdit: null,
    selectedAnnotation: null,
    activeEditTool: null,
    activeEditTarget: null,
    activeStyleFocus: null,
    activeDrag: null,
    activeSnap: null,
    drawStartSnap: null,
  }
}

export function clearActiveSketchTool(session: SketchSessionState): SketchSessionState {
  if (
    session.activeTool === null
    && !isSketchConstructionSelected(session)
    && !session.referenceTargetPicking
    && !session.activeStyleFocus
  ) {
    return session
  }

  return {
    ...session,
    activeTool: null,
    status: 'idle',
    constructionTargetPicking: false,
    referenceTargetPicking: false,
    constructionModifierActive: false,
    pointerDownPoint: null,
    livePoint: null,
    toolPlacedPoints: [],
    toolSettings: {},
    toolStagedEntities: [],
    validationMessage: null,
    toolPresentation: null,
    constraintAuthoring: null,
    activeAnnotationEdit: null,
    selectedAnnotation: null,
    activeEditTool: null,
    activeEditTarget: null,
    activeStyleFocus: null,
    activeDrag: null,
    activeSnap: null,
    drawStartSnap: null,
  }
}

export function updateSketchPointer(
  session: SketchSessionState,
  point: SketchPoint | null,
): SketchSessionState {
  if (session.activeTool !== null && isRegisteredSketchConstraintToolId(session.activeTool)) {
    if (!session.constraintAuthoring) {
      return session
    }

    if (session.constraintAuthoring.isPreviewPinned) {
      return session
    }

    const pendingAnnotationPlacement = isSketchConstraintReadyForValue(
      getSketchConstraintDefinition(session.constraintAuthoring.toolId),
      session.constraintAuthoring.selectedTargets,
    )
      ? inferDimensionAnnotationPlacement(session.constraintAuthoring.selectedTargets, point)
      : session.constraintAuthoring.pendingAnnotationPlacement

    if (
      sketchPointsEqual(session.constraintAuthoring.pointer, point)
      && dimensionAnnotationPlacementsEqual(
        session.constraintAuthoring.pendingAnnotationPlacement,
        pendingAnnotationPlacement,
      )
    ) {
      return session
    }

    const nextAuthoring: SketchConstraintAuthoringState = {
      ...session.constraintAuthoring,
      pointer: point,
      pendingAnnotationPlacement,
    }

    return {
      ...session,
      toolPresentation: buildConstraintToolPresentation(nextAuthoring),
      constraintAuthoring: nextAuthoring,
      activeSnap: null,
    }
  }

  if (!isDrawingSketchTool(session.activeTool)) {
    return session.activeSnap || session.drawStartSnap
      ? { ...session, activeSnap: null, drawStartSnap: null }
      : session
  }

  const toolDefinition = getSketchToolDefinition(session.activeTool)
  const snap = resolveSessionSnap(session, point)
  const result = toolDefinition.pointerMove({
    state: getToolRuntimeState(session),
    point: snap.point,
  })

  const nextSession: SketchSessionState = {
    ...session,
    status: result.state.status,
    pointerDownPoint: result.state.pointerDownPoint,
    livePoint: result.state.livePoint,
    toolPlacedPoints: result.state.placedPoints ?? session.toolPlacedPoints,
    toolSettings: result.state.settings ?? session.toolSettings,
    toolStagedEntities: withConstructionFlag(result.stagedEntities, session.constructionModifierActive),
    validationMessage: result.state.validationMessage,
    toolPresentation: withSnapPresentation(result.presentation, snap.candidate),
    activeSnap: snap.candidate,
  }

  return sketchPointerPreviewStateEqual(session, nextSession) ? session : nextSession
}

function sketchPointerPreviewStateEqual(
  current: SketchSessionState,
  next: SketchSessionState,
) {
  return current.status === next.status
    && sketchPointsEqual(current.pointerDownPoint, next.pointerDownPoint)
    && sketchPointsEqual(current.livePoint, next.livePoint)
    && sketchPointArraysEqual(current.toolPlacedPoints, next.toolPlacedPoints)
    && current.toolSettings === next.toolSettings
    && current.validationMessage === next.validationMessage
    && current.activeSnap?.key === next.activeSnap?.key
    && sketchDraftEntitiesEqual(current.toolStagedEntities, next.toolStagedEntities)
    && JSON.stringify(current.toolPresentation) === JSON.stringify(next.toolPresentation)
}

function sketchPointsEqual(
  left: SketchPoint | null,
  right: SketchPoint | null,
) {
  if (left === right) {
    return true
  }

  if (!left || !right) {
    return false
  }

  return Math.abs(left[0] - right[0]) <= 1e-9
    && Math.abs(left[1] - right[1]) <= 1e-9
}

function sketchPointArraysEqual(
  left: readonly SketchPoint[],
  right: readonly SketchPoint[],
) {
  return left.length === right.length
    && left.every((point, index) => sketchPointsEqual(point, right[index] ?? null))
}

function dimensionAnnotationPlacementsEqual(
  left: import('@/contracts/sketch/schema').DimensionAnnotationPlacement | null,
  right: import('@/contracts/sketch/schema').DimensionAnnotationPlacement | null,
) {
  if (left === right) {
    return true
  }

  if (!left || !right) {
    return false
  }

  return JSON.stringify(left) === JSON.stringify(right)
}

function sketchDraftEntitiesEqual(
  left: readonly import('@/core/sketch-tools/definition').SketchDraftEntity[],
  right: readonly import('@/core/sketch-tools/definition').SketchDraftEntity[],
) {
  return JSON.stringify(left) === JSON.stringify(right)
}

export function selectSketchEditTarget(
  session: SketchSessionState,
  target: PrimitiveRef,
): SketchSessionState {
  if (target.kind !== 'sketchPoint') {
    return session
  }

  if (target.sketchId !== getSessionSketchId(session)) {
    return session
  }

  if (!session.definition.points.some((point) => point.pointId === target.pointId)) {
    return session
  }

  return {
    ...session,
    activeEditTarget: target,
    activeDrag: null,
    activeAnnotationEdit: null,
    selectedAnnotation: null,
    validationMessage: null,
  }
}

export function toggleSketchConstructionTarget(
  session: SketchSessionState,
  target: PrimitiveRef,
): SketchSessionState {
  if (
    !session.constructionTargetPicking
    || (target.kind !== 'sketchEntity' && target.kind !== 'sketchPoint')
    || target.sketchId !== getSessionSketchId(session)
  ) {
    return session
  }

  const nextFullDefinition = toggleConstructionTargetInDefinition(session.fullDefinition, target)

  if (nextFullDefinition === session.fullDefinition) {
    return session
  }

  const definition = filterSketchDefinitionThroughCursor(nextFullDefinition, session.historyCursor)

  return {
    ...session,
    activeTool: null,
    status: 'idle',
    constructionTargetPicking: false,
    referenceTargetPicking: false,
    constructionModifierActive: false,
    pointerDownPoint: null,
    livePoint: null,
    toolPlacedPoints: [],
    toolSettings: {},
    toolPresentation: null,
    constraintAuthoring: null,
    activeAnnotationEdit: null,
    selectedAnnotation: null,
    activeEditTarget: null,
    activeDrag: null,
    fullDefinition: nextFullDefinition,
    definition,
    toolStagedEntities: [],
    commitRequest: rebuildSessionCommitRequest(session, definition),
    solvedRegions: deriveSolvedRegionsForSession(session, definition),
    validationMessage: null,
  }
}

export function createReferenceId(sequence: number, target: PrimitiveRef): ReferenceId {
  return `ref_${sequence}_${getTargetKey(target).replaceAll(/[^a-zA-Z0-9_-]/g, '-')}` as ReferenceId
}

export function sourceMatchesTarget(reference: SketchReferenceDefinition, target: PrimitiveRef) {
  if (reference.kind === 'modelReference') {
    return getTargetKey(reference.source) === getTargetKey(target)
  }

  if (reference.kind === 'sketchReference') {
    return getTargetKey(reference.source) === getTargetKey(target)
  }

  if (reference.kind === 'constructionPlane') {
    return getTargetKey(reference.source) === getTargetKey(target)
  }

  return false
}

export function createReferenceDefinition(
  sequence: number,
  target: PrimitiveRef,
): SketchReferenceDefinition | { kind: 'unsupported'; message: string } {
  switch (target.kind) {
    case 'face':
    case 'edge':
    case 'vertex':
      return {
        referenceId: createReferenceId(sequence, target),
        kind: 'modelReference',
        label: `Reference ${target.kind}`,
        source: target,
        projectionMode: target.kind === 'face' ? 'useExistingCoplanarGeometry' : 'projectAlongPlaneNormal',
      }
    case 'sketch':
    case 'sketchEntity':
    case 'sketchPoint':
      return {
        referenceId: createReferenceId(sequence, target),
        kind: 'sketchReference',
        label: `Reference ${target.kind}`,
        source: target,
        projectionMode: 'useExistingCoplanarGeometry',
      }
    case 'construction':
      return {
        referenceId: createReferenceId(sequence, target),
        kind: 'constructionPlane',
        label: 'Reference construction plane',
        source: target,
        projectionMode: 'coplanar',
      }
    default:
      return {
        kind: 'unsupported',
        message: `${target.kind} cannot be referenced from a sketch.`,
      }
  }
}

export function appendReferenceDefinition(
  definition: SketchDefinition,
  reference: SketchReferenceDefinition,
): SketchDefinition {
  return {
    ...definition,
    referenceIds: [...definition.referenceIds, reference.referenceId],
    references: [...definition.references, reference],
  }
}

export function selectSketchReferenceTarget(
  session: SketchSessionState,
  target: PrimitiveRef,
): SketchSessionState {
  if (!session.referenceTargetPicking) {
    return session
  }

  if (
    (target.kind === 'sketch' || target.kind === 'sketchEntity' || target.kind === 'sketchPoint')
    && target.sketchId === getSessionSketchId(session)
  ) {
    const message = 'Reference geometry must come from model topology or another existing sketch.'
    return {
      ...session,
      validationMessage: message,
      toolPresentation: buildReferenceTargetPresentation(message),
    }
  }

  if (session.fullDefinition.references.some((reference) => sourceMatchesTarget(reference, target))) {
    const message = 'That reference is already authored in this sketch.'
    return {
      ...session,
      validationMessage: message,
      toolPresentation: buildReferenceTargetPresentation(message),
    }
  }

  const nextSequence = session.sequence + 1
  const reference = createReferenceDefinition(nextSequence, target)

  if (reference.kind === 'unsupported') {
    return {
      ...session,
      validationMessage: reference.message,
      toolPresentation: buildReferenceTargetPresentation(reference.message),
    }
  }

  const fullDefinition = appendReferenceDefinition(session.fullDefinition, reference)
  const definition = appendReferenceDefinition(session.definition, reference)

  return {
    ...session,
    activeTool: null,
    status: 'idle',
    constructionTargetPicking: false,
    referenceTargetPicking: false,
    constructionModifierActive: false,
    pointerDownPoint: null,
    livePoint: null,
    toolPlacedPoints: [],
    toolSettings: {},
    toolPresentation: null,
    constraintAuthoring: null,
    activeAnnotationEdit: null,
    selectedAnnotation: null,
    activeEditTarget: null,
    activeDrag: null,
    sequence: nextSequence,
    definition,
    fullDefinition,
    commitRequest: rebuildSessionCommitRequest(session, definition),
    solvedRegions: deriveSolvedRegionsForSession(session, definition),
    validationMessage: null,
  }
}

export function deleteSketchReferenceTarget(
  session: SketchSessionState,
  target: PrimitiveRef,
): SketchSessionState {
  if (target.kind !== 'projectedReferenceGeometry' && target.kind !== 'sketchExternalReference') {
    return session
  }

  const removeFromDefinition = (definition: SketchDefinition): SketchDefinition => ({
    ...definition,
    referenceIds: definition.referenceIds.filter((referenceId) => referenceId !== target.referenceId),
    references: definition.references.filter((reference) => reference.referenceId !== target.referenceId),
  })
  const fullDefinition = removeFromDefinition(session.fullDefinition)

  if (fullDefinition === session.fullDefinition) {
    return session
  }

  const definition = removeFromDefinition(session.definition)

  return {
    ...session,
    fullDefinition,
    definition,
    projectedReferences: session.projectedReferences.filter((reference) => reference.referenceId !== target.referenceId),
    projectionDiagnostics: session.projectionDiagnostics,
    commitRequest: rebuildSessionCommitRequest(session, definition),
    solvedRegions: deriveSolvedRegionsForSession({
      ...session,
      projectedReferences: session.projectedReferences.filter((reference) => reference.referenceId !== target.referenceId),
    }, definition),
    validationMessage: null,
  }
}

export function toggleConstructionTargetInDefinition(
  definition: SketchDefinition,
  target: PrimitiveRef,
): SketchDefinition {
  if (target.kind === 'sketchEntity') {
    const selectedEntity = definition.entities.find((entity) => entity.entityId === target.entityId)

    if (!selectedEntity) {
      return definition
    }

    const isConstruction = !selectedEntity.isConstruction
    const points =
      selectedEntity.kind === 'point'
        ? definition.points.map((point) =>
            point.pointId === selectedEntity.pointId ? { ...point, isConstruction } : point,
          )
        : definition.points

    return {
      ...definition,
      points,
      entities: definition.entities.map((entity) =>
        entity.entityId === target.entityId ? { ...entity, isConstruction } : entity,
      ),
    }
  }

  if (target.kind !== 'sketchPoint') {
    return definition
  }

  const selectedPoint = definition.points.find((point) => point.pointId === target.pointId)

  if (!selectedPoint) {
    return definition
  }

  const isConstruction = !selectedPoint.isConstruction

  return {
    ...definition,
    points: definition.points.map((point) =>
      point.pointId === target.pointId ? { ...point, isConstruction } : point,
    ),
    entities: definition.entities.map((entity) =>
      entity.kind === 'point' && entity.pointId === target.pointId
        ? { ...entity, isConstruction }
        : entity,
    ),
  }
}

export const SNAP_INFERENCE_EPSILON = 1e-6

export function pointsAlmostEqual(left: SketchPoint, right: SketchPoint) {
  return Math.hypot(left[0] - right[0], left[1] - right[1]) <= SNAP_INFERENCE_EPSILON
}

export function projectedKindForSource(source: Extract<SketchSnapSourceRef, { kind: 'projectedGeometry' }>): NonNullable<ProjectedSketchGeometryRef['kind']> {
  switch (source.geometryKind) {
    case 'point':
      return 'projectedPoint'
    case 'lineSegment':
      return 'projectedLineSegment'
    case 'circle':
      return 'projectedCircle'
    case 'arc':
      return 'projectedArc'
    case 'spline':
      return 'projectedSpline'
  }
}

export function projectedOperandFromSource(
  source: Extract<SketchSnapSourceRef, { kind: 'projectedGeometry' }>,
): ProjectedSketchGeometryConstraintOperand {
  return {
    kind: 'projectedGeometry',
    reference: {
      kind: projectedKindForSource(source),
      referenceId: source.referenceId,
      geometryId: source.geometryId,
    },
  }
}

export function pointReadOnlyOperandFromSource(
  source: Extract<SketchSnapSourceRef, { kind: 'projectedGeometry' | 'sketchDatum' }>,
): ReadOnlySketchPointConstraintOperand {
  if (source.kind === 'sketchDatum') {
    return {
      kind: 'sketchDatum',
      datum: source.datumId,
    }
  }

  return projectedOperandFromSource(source)
}

export function curveReadOnlyOperandFromSource(
  source: Extract<SketchSnapSourceRef, { kind: 'projectedGeometry' | 'sketchDatum' }>,
): ReadOnlySketchCurveConstraintOperand {
  if (source.kind === 'sketchDatum') {
    return {
      kind: 'sketchDatum',
      datum: source.datumId,
    }
  }

  return projectedOperandFromSource(source)
}

export function localPointOperand(pointId: SketchPointId): Extract<ConstraintDefinition, { kind: 'midpoint' }>['point'] {
  return { kind: 'localPoint', pointId }
}

export function localEntityOperand(entityId: SketchEntityId): Extract<ConstraintDefinition, { kind: 'midpoint' }>['line'] {
  return { kind: 'localEntity', entityId }
}

export function getEntityEndpointAtPoint(
  definition: SketchDefinition,
  entityId: SketchEntityId,
  point: SketchPoint,
): SketchPointId | null {
  const entity = definition.entities.find((entry) => entry.entityId === entityId)

  if (!entity) {
    return null
  }

  const candidatePointIds =
    entity.kind === 'lineSegment'
      ? [entity.startPointId, entity.endPointId]
      : entity.kind === 'arc'
        ? [entity.startPointId, entity.endPointId]
        : entity.kind === 'point'
          ? [entity.pointId]
          : []

  for (const pointId of candidatePointIds) {
    const candidate = definition.points.find((entry) => entry.pointId === pointId)
    if (candidate && pointsAlmostEqual(candidate.position, point)) {
      return pointId
    }
  }

  return null
}

export function getEntityCenterPointId(definition: SketchDefinition, entityId: SketchEntityId): SketchPointId | null {
  const entity = definition.entities.find((entry) => entry.entityId === entityId)

  return entity?.kind === 'circle' || entity?.kind === 'arc'
    ? entity.centerPointId
    : null
}

export function getPatchPointIdsAtPosition(
  patch: SketchToolCommitContribution,
  point: SketchPoint,
): SketchPointId[] {
  return patch.points
    .filter((candidate) => pointsAlmostEqual(candidate.position, point))
    .map((candidate) => candidate.pointId)
}

export function resolveReusableLocalSnapPointId(input: {
  previousDefinition: SketchDefinition
  candidate: SketchSnapCandidate | null
}): SketchPointId | null {
  const { candidate, previousDefinition } = input
  if (!candidate || candidate.kind !== 'endpoint') {
    return null
  }

  for (const source of candidate.sources) {
    if (source.kind === 'localPoint') {
      return source.pointId
    }

    if (source.kind === 'localEntity') {
      const pointId = getEntityEndpointAtPoint(previousDefinition, source.entityId, candidate.point)
      if (pointId) {
        return pointId
      }
    }
  }

  return null
}

export function normalizeLinePatchEndpointReuse(input: {
  previousDefinition: SketchDefinition
  patch: SketchToolCommitContribution
  startSnap: SketchSnapCandidate | null
  endSnap: SketchSnapCandidate | null
}): SketchToolCommitContribution {
  const lineEntity = input.patch.entities.find((entity) => entity.kind === 'lineSegment')
  if (!lineEntity) {
    return input.patch
  }

  const replacements = new Map<SketchPointId, SketchPointId>()
  const startPointId = resolveReusableLocalSnapPointId({
    previousDefinition: input.previousDefinition,
    candidate: input.startSnap,
  })
  const endPointId = resolveReusableLocalSnapPointId({
    previousDefinition: input.previousDefinition,
    candidate: input.endSnap,
  })

  if (startPointId && startPointId !== lineEntity.startPointId) {
    replacements.set(lineEntity.startPointId, startPointId)
  }

  if (endPointId && endPointId !== lineEntity.endPointId) {
    replacements.set(lineEntity.endPointId, endPointId)
  }

  if (replacements.size === 0) {
    return input.patch
  }

  return {
    ...input.patch,
    points: input.patch.points.filter((point) => !replacements.has(point.pointId)),
    entities: input.patch.entities.map((entity) => {
      if (entity.kind !== 'lineSegment') {
        return entity
      }

      return {
        ...entity,
        startPointId: replacements.get(entity.startPointId) ?? entity.startPointId,
        endPointId: replacements.get(entity.endPointId) ?? entity.endPointId,
      }
    }),
  }
}

export function getPatchLineEntityId(patch: SketchToolCommitContribution): SketchEntityId | null {
  return patch.entities.find((entity) => entity.kind === 'lineSegment')?.entityId ?? null
}

export function getPatchCircleLikeEntityAtCenter(
  patch: SketchToolCommitContribution,
  pointId: SketchPointId,
): SketchEntityId | null {
  return patch.entities.find((entity) =>
    (entity.kind === 'circle' || entity.kind === 'arc') && entity.centerPointId === pointId,
  )?.entityId ?? null
}

export function addConstraint(
  constraints: ConstraintDefinition[],
  constraint: ConstraintDefinition | null,
) {
  if (constraint) {
    constraints.push(constraint)
  }
}

export function inferPointSnapConstraints(input: {
  previousDefinition: SketchDefinition
  patch: SketchToolCommitContribution
  candidate: SketchSnapCandidate
  snapRole: 'start' | 'end'
  pointId: SketchPointId
  sequence: number
  createConstraintId: (suffix: string) => ConstraintId
}): ConstraintDefinition[] {
  const constraints: ConstraintDefinition[] = []
  const localPoint = localPointOperand(input.pointId)
  const createId = (suffix: string) =>
    input.createConstraintId(`${input.snapRole}-${input.pointId}-${suffix}`)
  const localCircleLikeEntityId = getPatchCircleLikeEntityAtCenter(input.patch, input.pointId)

  const addPointOnSource = (source: SketchSnapSourceRef, index: number) => {
    if (source.kind === 'localEntity') {
      addConstraint(constraints, {
        constraintId: createId(`inferred-point-on-${index}`),
        kind: 'pointOnCurve',
        label: `Inferred point on curve ${input.sequence}`,
        point: localPoint,
        curve: localEntityOperand(source.entityId),
      })
      return
    }

    if (source.kind === 'projectedGeometry') {
      addConstraint(constraints, {
        constraintId: createId(`inferred-point-on-projected-${index}`),
        kind: 'pointOnProjectedCurve',
        label: `Inferred point on projected curve ${input.sequence}`,
        point: localPoint,
        projectedCurve: projectedOperandFromSource(source),
      })
      return
    }

    if (source.kind === 'sketchDatum' && source.geometryKind === 'lineSegment') {
      addConstraint(constraints, {
        constraintId: createId(`inferred-point-on-datum-${index}`),
        kind: 'pointOnProjectedCurve',
        label: `Inferred point on sketch datum ${input.sequence}`,
        point: localPoint,
        projectedCurve: curveReadOnlyOperandFromSource(source),
      })
    }
  }

  input.candidate.sources.forEach((source, index) => {
    if (source.kind === 'transientAnchor') {
      return
    }

    if (source.kind === 'sketchDatum' && input.candidate.distance <= 1e-9) {
      return
    }

    if (input.candidate.kind === 'endpoint') {
      if (source.kind === 'localPoint') {
        addConstraint(constraints, {
          constraintId: createId(`inferred-coincident-${index}`),
          kind: 'coincident',
          label: `Inferred coincident ${input.sequence}`,
          pointIds: [input.pointId, source.pointId],
        })
        return
      }

      if (source.kind === 'localEntity') {
        const endpointId = getEntityEndpointAtPoint(input.previousDefinition, source.entityId, input.candidate.point)
        if (endpointId) {
          addConstraint(constraints, {
            constraintId: createId(`inferred-coincident-endpoint-${index}`),
            kind: 'coincident',
            label: `Inferred coincident ${input.sequence}`,
            pointIds: [input.pointId, endpointId],
          })
        }
        return
      }

      if (
        (source.kind === 'projectedGeometry' && source.geometryKind === 'point')
        || (source.kind === 'sketchDatum' && source.datumId === 'origin')
      ) {
        addConstraint(constraints, {
          constraintId: createId(source.kind === 'sketchDatum' ? `inferred-coincident-datum-${index}` : `inferred-coincident-projected-${index}`),
          kind: 'coincidentProjectedPoint',
          label: source.kind === 'sketchDatum'
            ? `Inferred coincident sketch datum ${input.sequence}`
            : `Inferred coincident projected point ${input.sequence}`,
          point: localPoint,
          projectedPoint: pointReadOnlyOperandFromSource(source),
        })
      }
      return
    }

    if (input.candidate.kind === 'center') {
      if (source.kind === 'localEntity') {
        if (localCircleLikeEntityId && (source.geometryKind === 'circle' || source.geometryKind === 'arc')) {
          addConstraint(constraints, {
            constraintId: createId(`inferred-concentric-${index}`),
            kind: 'concentric',
            label: `Inferred concentric ${input.sequence}`,
            entityIds: [localCircleLikeEntityId, source.entityId],
          })
          return
        }

        const centerPointId = getEntityCenterPointId(input.previousDefinition, source.entityId)
        if (centerPointId) {
          addConstraint(constraints, {
            constraintId: createId(`inferred-coincident-center-${index}`),
            kind: 'coincident',
            label: `Inferred center coincident ${input.sequence}`,
            pointIds: [input.pointId, centerPointId],
          })
        }
        return
      }

      if (
        source.kind === 'projectedGeometry'
        && localCircleLikeEntityId
        && (source.geometryKind === 'circle' || source.geometryKind === 'arc')
      ) {
        addConstraint(constraints, {
          constraintId: createId(`inferred-concentric-projected-${index}`),
          kind: 'concentricProjectedCurve',
          label: `Inferred concentric projected curve ${input.sequence}`,
          curve: localEntityOperand(localCircleLikeEntityId),
          projectedCurve: projectedOperandFromSource(source),
        })
        return
      }

      if (
        (source.kind === 'projectedGeometry' && source.geometryKind === 'point')
        || (source.kind === 'sketchDatum' && source.datumId === 'origin')
      ) {
        addConstraint(constraints, {
          constraintId: createId(source.kind === 'sketchDatum' ? `inferred-coincident-datum-center-${index}` : `inferred-coincident-projected-center-${index}`),
          kind: 'coincidentProjectedPoint',
          label: source.kind === 'sketchDatum'
            ? `Inferred sketch datum center coincident ${input.sequence}`
            : `Inferred projected center coincident ${input.sequence}`,
          point: localPoint,
          projectedPoint: pointReadOnlyOperandFromSource(source),
        })
      }
      return
    }

    if (input.candidate.kind === 'midpoint') {
      if (source.kind === 'localEntity' && source.geometryKind === 'lineSegment') {
        addConstraint(constraints, {
          constraintId: createId(`inferred-midpoint-${index}`),
          kind: 'midpoint',
          label: `Inferred midpoint ${input.sequence}`,
          point: localPoint,
          line: localEntityOperand(source.entityId),
        })
        return
      }

      if (
        (source.kind === 'projectedGeometry' && source.geometryKind === 'lineSegment')
        || (source.kind === 'sketchDatum' && source.geometryKind === 'lineSegment')
      ) {
        addConstraint(constraints, {
          constraintId: createId(source.kind === 'sketchDatum' ? `inferred-midpoint-datum-${index}` : `inferred-midpoint-projected-${index}`),
          kind: 'midpointProjectedLine',
          label: source.kind === 'sketchDatum'
            ? `Inferred sketch datum midpoint ${input.sequence}`
            : `Inferred projected midpoint ${input.sequence}`,
          point: localPoint,
          projectedLine: curveReadOnlyOperandFromSource(source),
        })
      }
      return
    }

    if (
      input.candidate.kind === 'nearestOnLine'
      || input.candidate.kind === 'nearestOnCircle'
      || input.candidate.kind === 'nearestOnArc'
      || input.candidate.kind === 'intersection'
    ) {
      addPointOnSource(source, index)
    }
  })

  return constraints
}

export function inferLineSnapConstraints(input: {
  patch: SketchToolCommitContribution
  candidate: SketchSnapCandidate | null
  endPointId: SketchPointId | null
  sequence: number
  createConstraintId: (suffix: string) => ConstraintId
}): ConstraintDefinition[] {
  const candidate = input.candidate
  const lineEntityId = getPatchLineEntityId(input.patch)
  if (!candidate || !lineEntityId || !input.endPointId) {
    return []
  }

  const constraints: ConstraintDefinition[] = []
  const localLine = localEntityOperand(lineEntityId)
  const localEndPoint = localPointOperand(input.endPointId)

  if (candidate.kind === 'horizontalAlignment') {
    addConstraint(constraints, {
      constraintId: input.createConstraintId('inferred-horizontal'),
      kind: 'horizontal',
      label: `Inferred horizontal ${input.sequence}`,
      entityId: lineEntityId,
    })
  }

  if (candidate.kind === 'verticalAlignment') {
    addConstraint(constraints, {
      constraintId: input.createConstraintId('inferred-vertical'),
      kind: 'vertical',
      label: `Inferred vertical ${input.sequence}`,
      entityId: lineEntityId,
    })
  }

  candidate.sources.forEach((source, index) => {
    if (source.kind === 'transientAnchor') {
      return
    }

    if (
      candidate.kind === 'perpendicularFoot'
      && (source.kind === 'localEntity' || source.kind === 'projectedGeometry' || source.kind === 'sketchDatum')
      && source.geometryKind === 'lineSegment'
    ) {
      if (source.kind === 'localEntity') {
        addConstraint(constraints, {
          constraintId: input.createConstraintId(`inferred-perpendicular-${index}`),
          kind: 'perpendicular',
          label: `Inferred perpendicular ${input.sequence}`,
          entityIds: [lineEntityId, source.entityId],
        })
        addConstraint(constraints, {
          constraintId: input.createConstraintId(`inferred-foot-on-line-${index}`),
          kind: 'pointOnCurve',
          label: `Inferred perpendicular foot ${input.sequence}`,
          point: localEndPoint,
          curve: localEntityOperand(source.entityId),
        })
        return
      }

      if (source.kind === 'projectedGeometry' || source.kind === 'sketchDatum') {
        addConstraint(constraints, {
          constraintId: input.createConstraintId(source.kind === 'sketchDatum' ? `inferred-perpendicular-datum-${index}` : `inferred-perpendicular-projected-${index}`),
          kind: 'perpendicularProjectedLine',
          label: source.kind === 'sketchDatum'
            ? `Inferred perpendicular sketch datum ${input.sequence}`
            : `Inferred perpendicular projected line ${input.sequence}`,
          line: localLine,
          projectedLine: curveReadOnlyOperandFromSource(source),
        })
        addConstraint(constraints, {
          constraintId: input.createConstraintId(source.kind === 'sketchDatum' ? `inferred-foot-on-datum-${index}` : `inferred-foot-on-projected-${index}`),
          kind: 'pointOnProjectedCurve',
          label: source.kind === 'sketchDatum'
            ? `Inferred perpendicular foot sketch datum ${input.sequence}`
            : `Inferred perpendicular foot projected ${input.sequence}`,
          point: localEndPoint,
          projectedCurve: curveReadOnlyOperandFromSource(source),
        })
      }
      return
    }

    if (
      candidate.kind === 'tangent'
      && (source.kind === 'localEntity' || source.kind === 'projectedGeometry')
      && (source.geometryKind === 'circle' || source.geometryKind === 'arc')
    ) {
      if (source.kind === 'localEntity') {
        addConstraint(constraints, {
          constraintId: input.createConstraintId(`inferred-tangent-${index}`),
          kind: 'tangent',
          label: `Inferred tangent ${input.sequence}`,
          entityIds: [lineEntityId, source.entityId],
          relation: 'external',
        })
        addConstraint(constraints, {
          constraintId: input.createConstraintId(`inferred-tangent-point-on-${index}`),
          kind: 'pointOnCurve',
          label: `Inferred tangent point ${input.sequence}`,
          point: localEndPoint,
          curve: localEntityOperand(source.entityId),
        })
        return
      }

      if (source.kind === 'projectedGeometry') {
        addConstraint(constraints, {
          constraintId: input.createConstraintId(`inferred-tangent-projected-${index}`),
          kind: 'tangentProjectedCurve',
          label: `Inferred tangent projected curve ${input.sequence}`,
          curve: localLine,
          projectedCurve: projectedOperandFromSource(source),
          relation: 'external',
        })
        addConstraint(constraints, {
          constraintId: input.createConstraintId(`inferred-tangent-point-projected-${index}`),
          kind: 'pointOnProjectedCurve',
          label: `Inferred tangent point projected ${input.sequence}`,
          point: localEndPoint,
          projectedCurve: projectedOperandFromSource(source),
        })
      }
    }
  })

  return constraints
}

export function appendInferredSnapConstraints(input: {
  previousDefinition: SketchDefinition
  patch: SketchToolCommitContribution
  activeTool: SketchToolId
  startSnap: SketchSnapCandidate | null
  endSnap: SketchSnapCandidate | null
  sequence: number
  createConstraintId: (suffix: string) => ConstraintId
}): SketchToolCommitContribution {
  const patch = input.activeTool === 'line'
    ? normalizeLinePatchEndpointReuse({
        previousDefinition: input.previousDefinition,
        patch: input.patch,
        startSnap: input.startSnap,
        endSnap: input.endSnap,
      })
    : input.patch
  const constraints = [...(patch.constraints ?? [])]

  for (const [snapRole, snap] of [
    ['start', input.startSnap],
    ['end', input.endSnap],
  ] as const) {
    if (!snap) {
      continue
    }

    for (const pointId of getPatchPointIdsAtPosition(patch, snap.point)) {
      constraints.push(...inferPointSnapConstraints({
        previousDefinition: input.previousDefinition,
        patch,
        candidate: snap,
        snapRole,
        pointId,
        sequence: input.sequence,
        createConstraintId: input.createConstraintId,
      }))
    }
  }

  if (input.activeTool === 'line') {
    const endPointId = patch.entities.find((entity) => entity.kind === 'lineSegment')?.endPointId ?? null
    constraints.push(...inferLineSnapConstraints({
      patch,
      candidate: input.endSnap,
      endPointId,
      sequence: input.sequence,
      createConstraintId: input.createConstraintId,
    }))
  }

  const uniqueConstraints = dedupeConstraints(constraints)

  return uniqueConstraints.length === (patch.constraints ?? []).length
    ? patch
    : {
        ...patch,
        constraints: uniqueConstraints,
      }
}

export function dedupeConstraints(constraints: ConstraintDefinition[]) {
  const seen = new Set<string>()
  const uniqueConstraints: ConstraintDefinition[] = []

  for (const constraint of constraints) {
    const key = getConstraintDedupeKey(constraint)
    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    uniqueConstraints.push(constraint)
  }

  return uniqueConstraints
}

export function getConstraintDedupeKey(constraint: ConstraintDefinition): string {
  const readOnlyOperandKey = (operand: { kind: string; reference?: { referenceId: ReferenceId; geometryId: string }; datum?: 'origin' | 'xAxis' | 'yAxis' }) =>
    operand.kind === 'projectedGeometry'
      ? `${operand.reference!.referenceId}:${operand.reference!.geometryId}`
      : `datum:${operand.datum}`

  switch (constraint.kind) {
    case 'coincident':
      return `${constraint.kind}:${[...constraint.pointIds].sort().join(':')}`
    case 'parallel':
    case 'perpendicular':
    case 'equalLength':
    case 'tangent':
    case 'concentric':
      return `${constraint.kind}:${[...constraint.entityIds].sort().join(':')}`
    case 'horizontal':
    case 'vertical':
      return `${constraint.kind}:${constraint.entityId}`
    case 'midpoint':
      return `${constraint.kind}:${constraint.point.pointId}:${constraint.line.entityId}`
    case 'pointOnCurve':
      return `${constraint.kind}:${constraint.point.pointId}:${constraint.curve.entityId}`
    case 'collinear':
      return `${constraint.kind}:${collinearTargetKey(constraint.target)}:${constraint.line.entityId}`
    case 'collinearProjectedLine':
      return `${constraint.kind}:${collinearTargetKey(constraint.target)}:${readOnlyOperandKey(constraint.projectedLine)}`
    case 'fixPoint':
      return `${constraint.kind}:${constraint.pointId}:${constraint.position.join(':')}`
    case 'angle':
      return `${constraint.kind}:${constraint.pointIds.join(':')}:${constraint.valueRadians}`
    case 'coincidentProjectedPoint':
      return `${constraint.kind}:${constraint.point.pointId}:${readOnlyOperandKey(constraint.projectedPoint)}`
    case 'pointOnProjectedCurve':
      return `${constraint.kind}:${constraint.point.pointId}:${readOnlyOperandKey(constraint.projectedCurve)}`
    case 'midpointProjectedLine':
      return `${constraint.kind}:${constraint.point.pointId}:${readOnlyOperandKey(constraint.projectedLine)}`
    case 'parallelProjectedLine':
    case 'perpendicularProjectedLine':
      return `${constraint.kind}:${constraint.line.entityId}:${readOnlyOperandKey(constraint.projectedLine)}`
    case 'tangentProjectedCurve':
    case 'concentricProjectedCurve':
      return `${constraint.kind}:${constraint.curve.entityId}:${constraint.projectedCurve.reference.referenceId}:${constraint.projectedCurve.reference.geometryId}`
    case 'normal':
      return `${constraint.kind}:${constraint.line.entityId}:${constraint.curve.entityId}:${constraint.point.pointId}`
    case 'normalProjectedCurve':
      return `${constraint.kind}:${constraint.line.entityId}:${constraint.projectedCurve.reference.referenceId}:${constraint.projectedCurve.reference.geometryId}:${constraint.point.pointId}`
    case 'symmetric':
      return `${constraint.kind}:${[...constraint.pointIds].sort().join(':')}:${constraint.axis.entityId}`
    case 'symmetricProjectedLine':
      return `${constraint.kind}:${[...constraint.pointIds].sort().join(':')}:${readOnlyOperandKey(constraint.projectedLine)}`
  }
}

function collinearTargetKey(operand: { kind: string; pointId?: string; entityId?: string }) {
  return operand.kind === 'localPoint'
    ? `point:${operand.pointId}`
    : `entity:${operand.entityId}`
}

export function startSketchDraw(session: SketchSessionState, point: SketchPoint): SketchSessionState {
  if (!isDrawingSketchTool(session.activeTool)) {
    return session
  }
  const toolDefinition = getSketchToolDefinition(session.activeTool)
  const snap = resolveSessionSnap(session, point)
  const result = toolDefinition.pointerRelease({
    state: {
      status: 'idle',
      pointerDownPoint: null,
      livePoint: null,
      placedPoints: [],
      settings: session.toolSettings,
      validationMessage: null,
    } satisfies import('@/core/sketch-tools/definition').SketchToolRuntimeState,
    point: snap.point,
  })

  return {
    ...session,
    status: result.state.status,
    pointerDownPoint: result.state.pointerDownPoint,
    livePoint: result.state.livePoint,
    toolPlacedPoints: result.state.placedPoints ?? session.toolPlacedPoints,
    toolSettings: result.state.settings ?? session.toolSettings,
    toolStagedEntities: withConstructionFlag(result.stagedEntities, session.constructionModifierActive),
    validationMessage: result.state.validationMessage,
    toolPresentation: withSnapPresentation(result.presentation, snap.candidate),
    activeSnap: snap.candidate,
    drawStartSnap: snap.candidate,
  }
}

export function acceptSketchDraw(session: SketchSessionState, point: SketchPoint): SketchSessionState {
  if (
    !isDrawingSketchTool(session.activeTool)
    || session.pointerDownPoint === null
  ) {
    return session
  }

  const startPoint = session.pointerDownPoint
  const toolDefinition = getSketchToolDefinition(session.activeTool)
  const snap = resolveSessionSnap(session, point)
  const endPoint = snap.point ?? point
  const result = toolDefinition.pointerRelease({
    state: getToolRuntimeState(session),
    point: endPoint,
  })

  if (result.state.validationMessage) {
    return {
      ...session,
      toolStagedEntities: [],
      status: result.state.status,
      pointerDownPoint: result.state.pointerDownPoint,
      livePoint: result.state.livePoint,
      toolPlacedPoints: result.state.placedPoints ?? session.toolPlacedPoints,
      toolSettings: result.state.settings ?? session.toolSettings,
      validationMessage: result.state.validationMessage,
      toolPresentation: withSnapPresentation(result.presentation, snap.candidate),
      activeSnap: snap.candidate,
    }
  }

  if (result.state.status !== 'idle') {
    return {
      ...session,
      toolStagedEntities: withConstructionFlag(result.stagedEntities, session.constructionModifierActive),
      status: result.state.status,
      pointerDownPoint: result.state.pointerDownPoint,
      livePoint: result.state.livePoint,
      toolPlacedPoints: result.state.placedPoints ?? session.toolPlacedPoints,
      toolSettings: result.state.settings ?? session.toolSettings,
      validationMessage: null,
      toolPresentation: withSnapPresentation(result.presentation, snap.candidate),
      activeSnap: snap.candidate,
    }
  }

  const nextSequence = session.sequence + 1
  const sketchId = session.sketchId ?? ('sketch_draft' as SketchId)
  const baseDefinitionPatch = toolDefinition.createCommitContribution({
    sequence: nextSequence,
    start: startPoint,
    end: endPoint,
    points: result.state.placedPoints ?? [startPoint, endPoint],
    settings: result.state.settings ?? session.toolSettings,
    isConstruction: session.constructionModifierActive,
    acceptedSnaps: {
      start: session.drawStartSnap,
      end: snap.candidate,
    },
    factories: {
      createPointId: (suffix) => createPointId(nextSequence, suffix),
      createEntityId: (suffix) => createEntityId(nextSequence, suffix),
      createConstraintId: (suffix) => createConstraintId(nextSequence, suffix),
      createDimensionId: (suffix) => createDimensionId(nextSequence, suffix),
      createPoint: (label, pointId, position) =>
        createPointDefinition(sketchId, pointId, label, position, session.constructionModifierActive),
      createLineEntity: (label, entityId, startPointId, endPointId) =>
        createLineEntityDefinition(sketchId, entityId, label, startPointId, endPointId, session.constructionModifierActive),
      createPointEntity: (label, entityId, pointId) =>
        createPointEntityDefinition(sketchId, entityId, label, pointId, session.constructionModifierActive),
      createCircleEntity: (label, entityId, centerPointId, radius) =>
        createCircleEntityDefinition(sketchId, entityId, label, centerPointId, radius, session.constructionModifierActive),
      createArcEntity: (label, entityId, centerPointId, startPointId, endPointId, sweepDirection) =>
        createArcEntityDefinition(sketchId, entityId, label, centerPointId, startPointId, endPointId, sweepDirection, session.constructionModifierActive),
      createSplineEntity: (label, entityId, fitPointIds, degree) =>
        createSplineEntityDefinition(sketchId, entityId, label, fitPointIds, session.constructionModifierActive, degree),
      createEllipseEntity: (label, entityId, centerPointId, majorAxisPointId, minorRadius) =>
        createEllipseEntityDefinition(sketchId, entityId, label, centerPointId, majorAxisPointId, minorRadius, session.constructionModifierActive),
      createEllipticalArcEntity: (label, entityId, centerPointId, majorAxisPointId, startPointId, endPointId, minorRadius, sweepDirection) =>
        createEllipticalArcEntityDefinition(sketchId, entityId, label, centerPointId, majorAxisPointId, startPointId, endPointId, minorRadius, sweepDirection, session.constructionModifierActive),
      createConicEntity: (label, entityId, startPointId, controlPointId, endPointId, rho) =>
        createConicEntityDefinition(sketchId, entityId, label, startPointId, controlPointId, endPointId, rho, session.constructionModifierActive),
      createBezierCurveEntity: (label, entityId, controlPointIds, degree) =>
        createBezierCurveEntityDefinition(sketchId, entityId, label, controlPointIds, degree, session.constructionModifierActive),
      createProfileTextEntity: (label, entityId, anchorPointId, text, height, rotationRadians, horizontalAlign, verticalAlign) =>
        createProfileTextEntityDefinition(sketchId, entityId, label, anchorPointId, text, height, rotationRadians, horizontalAlign, verticalAlign, session.constructionModifierActive),
    },
  })
  const definitionPatch = appendInferredSnapConstraints({
    previousDefinition: session.definition,
    patch: baseDefinitionPatch,
    activeTool: session.activeTool,
    startSnap: session.drawStartSnap,
    endSnap: snap.candidate,
    sequence: nextSequence,
    createConstraintId: (suffix) => createConstraintId(nextSequence, suffix),
  })
  const history = applySketchHistoryContribution(session, {
    ...definitionPatch,
    authoringOperation: createAuthoringOperationFromContribution(definitionPatch, {
      sequence: nextSequence,
      kind: session.activeTool,
      label: `${toolDefinition.metadata.name} ${nextSequence}`,
      suffix: session.activeTool,
    }),
  })

  return {
    ...session,
    toolStagedEntities: [],
    definition: history.definition,
    fullDefinition: history.fullDefinition,
    historyCursor: history.historyCursor,
    historyOperations: history.historyOperations,
    status: result.state.status,
    pointerDownPoint: result.state.pointerDownPoint,
    livePoint: result.state.livePoint,
    toolPlacedPoints: result.state.status === 'idle' ? [] : result.state.placedPoints ?? session.toolPlacedPoints,
    toolSettings: result.state.status === 'idle' ? {} : result.state.settings ?? session.toolSettings,
    sequence: nextSequence,
    commitRequest: buildCommitRequest({
      sketchId: session.sketchId,
      sketchLabel: session.sketchLabel,
      plane: session.plane,
      definition: history.definition,
    }),
    solvedRegions: deriveSolvedRegionsForSession(session, history.definition),
    validationMessage: null,
    toolPresentation: result.presentation,
    activeAnnotationEdit: null,
    selectedAnnotation: null,
    activeEditTool: null,
    activeEditTarget: null,
    activeDrag: null,
    activeSnap: null,
    drawStartSnap: null,
  }
}

export function resolveSessionSnap(
  session: SketchSessionState,
  point: SketchPoint | null,
): { point: SketchPoint | null; candidate: SketchSnapCandidate | null } {
  if (!point || !isDrawingSketchTool(session.activeTool)) {
    return { point, candidate: null }
  }

  const snap = resolveSketchSnap({
    pointer: point,
    geometries: collectSketchSnapGeometries({
      definition: session.definition,
      projectedReferences: session.projectedReferences,
    }),
    activeTool: session.activeTool,
    activeAnchor: session.status === 'drawing' ? session.pointerDownPoint : null,
    activeCandidateKey: session.activeSnap?.key ?? null,
  })

  return {
    point: snap.snappedPoint,
    candidate: snap.activeCandidate,
  }
}

export function withSnapPresentation(
  presentation: SketchToolPresentationSchema,
  candidate: SketchSnapCandidate | null,
): SketchToolPresentationSchema {
  if (!candidate) {
    return presentation
  }

  return {
    ...presentation,
    overlays: [
      ...(presentation.overlays ?? []),
      ...getSnapConstraintPreviewOverlays(candidate),
      {
        id: 'active-snap',
        kind: 'snapIndicator',
        label: candidate.preview.label,
        point: candidate.point,
        candidateKind: candidate.kind,
        glyphKind: candidate.preview.glyph,
      },
    ],
  }
}

export function getSnapConstraintPreviewOverlays(candidate: SketchSnapCandidate): SketchToolOverlayDescriptor[] {
  const detail = getSnapConstraintPreviewDetail(candidate)

  return detail
    ? [{
        id: 'active-snap-inferred-constraint',
        kind: 'constraintPreview',
        label: 'Inferred constraint',
        detail,
        anchor: { kind: 'sketchPoint', point: candidate.point, offset: { x: 18, y: 18 } },
      }]
    : []
}

export function getSnapConstraintPreviewDetail(candidate: SketchSnapCandidate) {
  switch (candidate.kind) {
    case 'endpoint':
      return 'Coincident'
    case 'center':
      return 'Concentric or coincident center'
    case 'midpoint':
      return 'Midpoint'
    case 'nearestOnLine':
      return 'Point on line'
    case 'nearestOnCircle':
      return 'Point on circle'
    case 'nearestOnArc':
      return 'Point on arc'
    case 'intersection':
      return 'Point on intersecting curves'
    case 'horizontalAlignment':
      return 'Horizontal'
    case 'verticalAlignment':
      return 'Vertical'
    case 'perpendicularFoot':
      return 'Perpendicular'
    case 'tangent':
      return 'Tangent'
  }
}

export function getToolRuntimeState(session: SketchSessionState): import('@/core/sketch-tools/definition').SketchToolRuntimeState {
  return {
    status: session.status === 'drawing' ? 'drawing' : 'idle',
    pointerDownPoint: session.pointerDownPoint,
    livePoint: session.livePoint,
    placedPoints: session.toolPlacedPoints,
    settings: session.toolSettings,
    validationMessage: session.validationMessage,
  }
}

export function getSketchSessionPreviewLabel(session: SketchSessionState): string {
  if (session.activeAnnotationEdit) {
    return session.toolPresentation?.prompts[0]?.text ?? 'Edit annotation value'
  }

  if (session.activeSpecialMode) {
    return 'Sketch special mode active'
  }

  if (session.constraintAuthoring) {
    const definition = getSketchConstraintDefinition(session.constraintAuthoring.toolId)
    const valueSpec = definition.getValueSpec?.(session.constraintAuthoring.selectedTargets) ?? definition.valueSpec

    if (session.status === 'awaitingValue') {
      return session.constraintAuthoring.isPreviewPinned
        ? `Enter ${valueSpec?.label.toLowerCase() ?? 'value'}`
        : `Place ${valueSpec?.label.toLowerCase() ?? 'value'} annotation`
    }

    const step =
      definition.steps[
        Math.min(
          session.constraintAuthoring.selectedTargets.length,
          definition.steps.length - 1,
        )
      ]

    return step?.label ?? definition.metadata.name
  }

  const primaryPrompt = session.toolPresentation?.validation?.[0]?.message
    ?? session.toolPresentation?.prompts[0]?.text

  if (primaryPrompt) {
    return primaryPrompt
  }

  if (session.validationMessage) {
    return session.validationMessage
  }

  if (session.projectionDiagnostics.length > 0) {
    return session.projectionDiagnostics[0]?.message ?? 'Sketch reference projection has diagnostics'
  }

  const regionDiagnostic = getSketchSessionRegionDiagnostics(session).find((diagnostic) => diagnostic.severity !== 'info')
  if (regionDiagnostic) {
    return regionDiagnostic.message
  }

  if (session.activeDrag?.status === 'dragging') {
    return 'Dragging sketch point'
  }

  if (session.activeEditTarget) {
    return 'Sketch point selected'
  }

  if (session.activeStyleFocus) {
    return session.activeStyleFocus.target
      ? 'Sketch style controls active'
      : 'Select sketch geometry to edit style'
  }

  if (session.constructionTargetPicking) {
    return 'Select sketch geometry to toggle construction'
  }

  if (session.activeTool === null) {
    return session.definition.entityIds.length > 0
      ? `Sketch has ${session.definition.entityIds.length} authored entities`
      : 'Sketch session ready'
  }

  if (session.status === 'drawing') {
    return `${session.activeTool} preview active, click again to accept`
  }

  return `Ready to place ${session.activeTool}, click to set first point`
}

export function getSketchToolPresentation(session: SketchSessionState): SketchToolPresentationSchema | null {
  if (session.activeSpecialMode) {
    return null
  }

  if (session.activeAnnotationEdit) {
    return session.toolPresentation
  }

  if (session.activeTool === 'construction') {
    return session.toolPresentation
  }

  if (session.constraintAuthoring) {
    return session.toolPresentation
  }

  if (session.activeEditTool) {
    return session.toolPresentation
  }

  if (session.activeStyleFocus) {
    return buildSketchStylePresentation(
      session.activeStyleFocus,
      getSketchStyleTargetDefinition(session, session.activeStyleFocus.target)?.style,
    )
  }

  if (!isDrawingSketchTool(session.activeTool)) {
    if (!session.activeEditTarget) {
      const overlays = buildCommittedDimensionOverlays(session, session.definition)
      return overlays.length > 0 ? { prompts: [], overlays } : null
    }

    const overlays = buildCommittedDimensionOverlays(session, session.definition)
    return overlays.length > 0 ? { prompts: [], overlays } : null
  }

  return session.toolPresentation
    ?? getSketchToolDefinition(session.activeTool).getPresentation(getToolRuntimeState(session))
}

export function patchSketchDrawingToolValue(
  session: SketchSessionState,
  patch: Record<string, unknown>,
): SketchSessionState {
  if (!isDrawingSketchTool(session.activeTool) || patch.intent !== 'setToolSetting') {
    return session
  }

  const key = typeof patch.key === 'string' ? patch.key : null
  if (!key) {
    return session
  }

  const nextSettings = {
    ...session.toolSettings,
    [key]: (patch.value ?? null) as SketchToolControlValue,
  }
  const toolDefinition = getSketchToolDefinition(session.activeTool)
  const runtimeState = {
    ...getToolRuntimeState(session),
    settings: nextSettings,
  }

  return {
    ...session,
    toolSettings: nextSettings,
    toolStagedEntities: withConstructionFlag(toolDefinition.getStagedEntities(runtimeState), session.constructionModifierActive),
    toolPresentation: toolDefinition.getPresentation(runtimeState),
  }
}
