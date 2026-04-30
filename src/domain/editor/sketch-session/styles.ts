import type {
  SketchDefinition,
  SketchStyleDefinition,
} from '@/contracts/sketch/schema'
import {
  type PrimitiveRef,
  primitiveRefEquals,
} from '@/domain/editor/schema'
import {
  type SketchStyleToolId,
  isSketchStyleTarget,
  parseSketchStylePatch,
} from '@/domain/sketch-styles/definition'
import type {
  SketchSessionState,
} from './types'
import {
  deriveSolvedRegionsForSession,
  filterSketchDefinitionThroughCursor,
  getSessionSketchId,
  rebuildSessionCommitRequest,
} from './internals'
import {
  applyStylePatchToDefinition,
  isFillStylePatch,
  sketchStyleRecordToDefinition,
} from './annotations'

export function focusSketchStyleTool(
  session: SketchSessionState,
  selectedTargets: readonly PrimitiveRef[],
  toolId: SketchStyleToolId,
): SketchSessionState {
  const target = getFirstSketchStyleTarget(session, selectedTargets, toolId)

  return {
    ...session,
    activeStyleFocus: { toolId, target },
    status: 'idle',
    constructionTargetPicking: false,
    referenceTargetPicking: false,
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
    activeDrag: null,
    activeSnap: null,
    drawStartSnap: null,
  }
}

export function updateSketchStyleFocusTarget(
  session: SketchSessionState,
  selectedTargets: readonly PrimitiveRef[],
): SketchSessionState {
  if (!session.activeStyleFocus) {
    return session
  }

  const target = getFirstSketchStyleTarget(session, selectedTargets, session.activeStyleFocus.toolId)

  if (
    (target === null && session.activeStyleFocus.target === null)
    || (target !== null && session.activeStyleFocus.target !== null && primitiveRefEquals(target, session.activeStyleFocus.target))
  ) {
    return session
  }

  return {
    ...session,
    activeStyleFocus: {
      ...session.activeStyleFocus,
      target,
    },
    activeEditTarget: null,
    validationMessage: null,
  }
}

export function getActiveSketchStyleToolId(session: SketchSessionState): SketchStyleToolId | null {
  return session.activeStyleFocus?.toolId ?? null
}

export function hasSketchStyleTarget(
  session: SketchSessionState,
  selectedTargets: readonly PrimitiveRef[],
  toolId: SketchStyleToolId,
): boolean {
  return getFirstSketchStyleTarget(session, selectedTargets, toolId) !== null
}

export function isSketchSvgRenderingEnabled(session: SketchSessionState): boolean {
  return session.fullDefinition.svgRenderingEnabled ?? true
}

export function toggleSketchSvgRendering(session: SketchSessionState): SketchSessionState {
  const enabled = !isSketchSvgRenderingEnabled(session)
  const nextFullDefinition: SketchDefinition = {
    ...session.fullDefinition,
    svgRenderingEnabled: enabled,
  }
  const nextDefinition = filterSketchDefinitionThroughCursor(nextFullDefinition, session.historyCursor)

  return {
    ...session,
    fullDefinition: nextFullDefinition,
    definition: nextDefinition,
    activeStyleFocus: enabled ? session.activeStyleFocus : null,
    activeEditTarget: null,
    validationMessage: null,
    commitRequest: rebuildSessionCommitRequest(session, nextDefinition),
  }
}

export function getFirstSketchStyleTarget(
  session: SketchSessionState,
  selectedTargets: readonly PrimitiveRef[],
  toolId: SketchStyleToolId,
): Extract<PrimitiveRef, { kind: 'region' | 'sketchEntity' }> | null {
  const sketchId = getSessionSketchId(session)
  const target = selectedTargets.find((candidate) => isSketchStyleTarget(candidate, sketchId, toolId)) ?? null

  if (!target) {
    return null
  }

  if (toolId === 'fill') {
    return target.kind === 'region' && session.solvedRegions.some((region) => region.target.regionId === target.regionId)
      ? target
      : null
  }

  return target.kind === 'sketchEntity' && session.definition.entities.some((entity) => entity.entityId === target.entityId)
    ? target
    : null
}

export function getSketchStyleTargetDefinition(
  session: SketchSessionState,
  target: Extract<PrimitiveRef, { kind: 'region' | 'sketchEntity' }> | null,
): { style?: SketchStyleDefinition } | null {
  if (!target) {
    return null
  }

  if (target.kind === 'region') {
    const styleRecord = session.fullDefinition.styles?.find((record) =>
      record.target.kind === 'region' && record.target.regionId === target.regionId,
    )

    return { style: sketchStyleRecordToDefinition(styleRecord) }
  }

  return session.definition.entities.find((entity) => entity.entityId === target.entityId) ?? null
}

export function patchSketchStyleValue(
  session: SketchSessionState,
  selectedTargets: readonly PrimitiveRef[],
  patch: Record<string, unknown>,
): SketchSessionState {
  const parsedPatch = parseSketchStylePatch(patch)

  if (!parsedPatch) {
    return session
  }

  const sketchId = getSessionSketchId(session)
  const toolId = session.activeStyleFocus?.toolId ?? (isFillStylePatch(parsedPatch) ? 'fill' : 'stroke')
  const localTargets = selectedTargets.filter((target) => isSketchStyleTarget(target, sketchId, toolId))

  if (localTargets.length === 0) {
    return session
  }

  const nextFullDefinition = applyStylePatchToDefinition(session.fullDefinition, session.solvedRegions, localTargets, parsedPatch, toolId)

  if (nextFullDefinition === session.fullDefinition) {
    return session
  }

  const nextDefinition = filterSketchDefinitionThroughCursor(nextFullDefinition, session.historyCursor)

  return {
    ...session,
    fullDefinition: nextFullDefinition,
    definition: nextDefinition,
    commitRequest: rebuildSessionCommitRequest(session, nextDefinition),
    solvedRegions: deriveSolvedRegionsForSession(session, nextDefinition),
  }
}
