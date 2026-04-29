import type { SketchPoint } from '@/contracts/modeling/schema'
import type {
  SketchEntityId,
  SketchId,
  SketchPointId,
  SketchStyleId,
} from '@/contracts/shared/ids'
import type {
  SketchConstraintRef,
  SketchDimensionRef,
} from '@/contracts/shared/references'
import type {
  ConstraintDefinition,
  DimensionAnnotationPlacement,
  DimensionDefinition,
  ProjectedSketchGeometryRef,
  RegionRecord,
  SketchAuthoringOperationGraphSnapshot,
  SketchDefinition,
  SketchStyleDefinition,
  SketchStyleRecord,
} from '@/contracts/sketch/schema'
import {
  solveSketchDefinitionCore,
} from '@/contracts/sketch/solver-core'
import type { ProjectedSketchReferenceRecord } from '@/contracts/solver/schema'
import type { PrimitiveRef } from '@/domain/editor/schema'
import type {
  SketchStylePatch,
  SketchStyleToolId,
} from '@/domain/sketch-styles/definition'
import type {
  SketchToolAnchorDescriptor,
  SketchToolOverlayDescriptor,
  SketchToolPresentationSchema,
} from '@/domain/sketch-tools/editor-schema'
import type {
  SketchAnnotationDescriptor,
  SketchAnnotationEditState,
  SketchAnnotationGlyphKind,
  SketchDimensionAnnotationDragHandle,
  SketchSessionState,
} from './types'
import {
  ANNOTATION_EDIT_SOLVE_BLOCKED_MESSAGE,
  SKETCH_DIRECT_EDIT_TOLERANCES,
  createDeleteAuthoringOperation,
  createSketchConstraintRef,
  createSketchDimensionRef,
  createSketchEntityRef,
  createSketchPointRef,
  deriveSolvedRegionsForSession,
  filterSketchDefinitionThroughCursor,
  getAppendBaseAuthoringOperations,
  getTargetKey,
  normalizeConstraintValue,
  rebuildSessionCommitRequest,
} from './internals'
import {
  addAnchorOffset,
} from './constraints'
import {
  getSketchDatumGuideExtent,
} from './display'
import {
  applyPointPositionsToDefinition,
} from './editing'
import {
  createTailSketchHistoryCursor,
  getSketchConstraintDisplayForTarget,
  getSketchConstraintDisplaySummary,
} from './state'

export function beginSketchAnnotationEdit(
  session: SketchSessionState,
  target: SketchConstraintRef | SketchDimensionRef,
): SketchSessionState {
  const editable = getEditableAnnotationValue(session, target)

  if (!editable) {
    return {
      ...session,
      status: 'idle',
      toolPresentation: null,
      activeAnnotationEdit: null,
      selectedAnnotation: target,
      activeEditTarget: null,
      activeDrag: null,
      validationMessage: null,
    }
  }

  const edit: SketchAnnotationEditState = {
    target,
    pendingValue: editable.value,
  }

  return {
    ...session,
    activeTool: null,
    status: 'awaitingValue',
    pointerDownPoint: null,
    livePoint: null,
    toolPlacedPoints: [],
    toolSettings: {},
    toolPresentation: buildAnnotationEditPresentation(session, edit),
    constraintAuthoring: null,
    activeAnnotationEdit: edit,
    selectedAnnotation: target,
    activeEditTarget: null,
    activeDrag: null,
    validationMessage: null,
  }
}

export function patchSketchAnnotationEditValue(
  session: SketchSessionState,
  patch: Record<string, unknown>,
): SketchSessionState {
  const edit = session.activeAnnotationEdit

  if (!edit) {
    return session
  }

  const intent = patch.intent

  if (intent === 'cancelAnnotationValue') {
    return clearSketchAnnotationEdit(session)
  }

  if ('value' in patch) {
    const nextEdit = {
      ...edit,
      pendingValue: normalizeConstraintValue(patch.value as number | null | undefined),
    }

    return {
      ...session,
      activeAnnotationEdit: nextEdit,
      toolPresentation: buildAnnotationEditPresentation(session, nextEdit),
    }
  }

  if (intent !== 'commitAnnotationValue') {
    return session
  }

  if (edit.pendingValue === null) {
    return {
      ...session,
      toolPresentation: buildAnnotationEditPresentation(session, edit, 'Enter a value before saving.'),
    }
  }

  return commitSketchAnnotationEditValue(session, {
    ...edit,
    pendingValue: edit.pendingValue,
  })
}

export function applyStylePatchToDefinition(
  definition: SketchDefinition,
  solvedRegions: readonly RegionRecord[],
  targets: readonly Extract<PrimitiveRef, { kind: 'region' | 'sketchEntity' }>[],
  patch: SketchStylePatch,
  toolId: SketchStyleToolId,
): SketchDefinition {
  if (toolId === 'fill') {
    return applyFillStylePatchToDefinition(definition, solvedRegions, targets, patch)
  }

  if (isFillStylePatch(patch)) {
    return definition
  }

  const entityIds = new Set(
    targets
      .filter((target): target is Extract<PrimitiveRef, { kind: 'sketchEntity' }> => target.kind === 'sketchEntity')
      .map((target) => target.entityId),
  )

  let didChange = false

  const entities = definition.entities.map((entity) => {
    if (!entityIds.has(entity.entityId)) {
      return entity
    }

    const nextStyle = applySketchStyleDefinitionPatch(entity.style, patch)
    if (nextStyle === entity.style) {
      return entity
    }

    didChange = true
    return { ...entity, style: nextStyle }
  })

  if (!didChange) {
    return definition
  }

  return {
    ...definition,
    entities,
  }
}

export function applyFillStylePatchToDefinition(
  definition: SketchDefinition,
  solvedRegions: readonly RegionRecord[],
  targets: readonly Extract<PrimitiveRef, { kind: 'region' | 'sketchEntity' }>[],
  patch: SketchStylePatch,
): SketchDefinition {
  if (!isFillStylePatch(patch)) {
    return definition
  }

  const liveRegionIds = new Set(solvedRegions.map((region) => region.regionId))
  const regionIds = targets.flatMap((target) =>
    target.kind === 'region' && liveRegionIds.has(target.regionId) ? [target.regionId] : [],
  )

  if (regionIds.length === 0) {
    return definition
  }

  const styles = [...(definition.styles ?? [])]
  const styleIds = [...(definition.styleIds ?? [])]
  let didChange = false

  for (const regionId of regionIds) {
    const index = styles.findIndex((style) => style.target.kind === 'region' && style.target.regionId === regionId)
    const current = index >= 0 ? styles[index]! : createDefaultRegionStyleRecord(regionId)
    const next = applyRegionFillPatch(current, patch)
    if (next === current) {
      continue
    }

    if (!styleIds.includes(next.styleId)) {
      styleIds.push(next.styleId)
    }

    if (index >= 0) {
      styles[index] = next
    } else {
      styles.push(next)
    }
    didChange = true
  }

  return didChange
    ? {
        ...definition,
        styleIds,
        styles,
      }
    : definition
}

export function isFillStylePatch(
  patch: SketchStylePatch,
): patch is Extract<SketchStylePatch, { field: 'fillMode' | 'fillColor' | 'gradientStartColor' | 'gradientEndColor' }> {
  return patch.field === 'fillMode'
    || patch.field === 'fillColor'
    || patch.field === 'gradientStartColor'
    || patch.field === 'gradientEndColor'
}

export function createDefaultRegionStyleRecord(regionId: RegionRecord['regionId']): SketchStyleRecord {
  return {
    styleId: `sketch_style_${regionId}` as SketchStyleId,
    label: `Region ${regionId} style`,
    target: { kind: 'region', regionId },
    fill: { kind: 'none' },
    stroke: {
      color: 'var(--cad-foreground)',
      opacity: 0,
      width: 0,
      lineCap: 'round',
      lineJoin: 'round',
      miterLimit: 4,
    },
  }
}

export function applyRegionFillPatch(
  style: SketchStyleRecord,
  patch: Extract<SketchStylePatch, { field: 'fillMode' | 'fillColor' | 'gradientStartColor' | 'gradientEndColor' }>,
): SketchStyleRecord {
  const current = sketchStyleRecordToDefinition(style)
  const nextDefinition = applySketchStyleDefinitionPatch(current, patch)
  const nextFill = sketchStyleDefinitionToFill(nextDefinition)

  if (JSON.stringify(style.fill) === JSON.stringify(nextFill)) {
    return style
  }

  return {
    ...style,
    fill: nextFill,
  }
}

export function applySketchStyleDefinitionPatch(
  style: SketchStyleDefinition | undefined,
  patch: SketchStylePatch,
): SketchStyleDefinition {
  const next = { ...(style ?? {}) }

  switch (patch.field) {
    case 'fillMode':
      if (next.fillMode === patch.value) {
        return style ?? next
      }
      next.fillMode = patch.value
      break
    case 'fillColor':
      if (next.fillColor === patch.value) {
        return style ?? next
      }
      next.fillColor = patch.value
      break
    case 'gradientStartColor':
      if (next.gradientStartColor === patch.value) {
        return style ?? next
      }
      next.gradientStartColor = patch.value
      break
    case 'gradientEndColor':
      if (next.gradientEndColor === patch.value) {
        return style ?? next
      }
      next.gradientEndColor = patch.value
      break
    case 'strokeEnabled':
      if (next.strokeEnabled === patch.value) {
        return style ?? next
      }
      next.strokeEnabled = patch.value
      break
    case 'strokeColor':
      if (next.strokeColor === patch.value) {
        return style ?? next
      }
      next.strokeColor = patch.value
      break
    case 'strokeWidth':
      if (next.strokeWidth === patch.value) {
        return style ?? next
      }
      next.strokeWidth = patch.value
      break
    case 'strokeCap':
      if (next.strokeCap === patch.value) {
        return style ?? next
      }
      next.strokeCap = patch.value
      break
    case 'strokeJoin':
      if (next.strokeJoin === patch.value) {
        return style ?? next
      }
      next.strokeJoin = patch.value
      break
    case 'strokeMiterLimit':
      if (next.strokeMiterLimit === patch.value) {
        return style ?? next
      }
      next.strokeMiterLimit = patch.value
      break
    case 'strokeDashSize':
      if (next.strokeDashSize === patch.value) {
        return style ?? next
      }
      next.strokeDashSize = patch.value
      break
    case 'strokeGapSize':
      if (next.strokeGapSize === patch.value) {
        return style ?? next
      }
      next.strokeGapSize = patch.value
      break
  }

  return next
}

export function sketchStyleRecordToDefinition(style: SketchStyleRecord | undefined): SketchStyleDefinition | undefined {
  if (!style) {
    return undefined
  }

  return {
    ...sketchStyleFillToDefinition(style.fill),
    strokeEnabled: style.stroke.opacity > 0 && style.stroke.width > 0,
    strokeColor: style.stroke.color,
    strokeWidth: style.stroke.width,
    strokeCap: style.stroke.lineCap,
    strokeJoin: style.stroke.lineJoin,
    strokeMiterLimit: style.stroke.miterLimit,
    strokeDashSize: style.stroke.dashSize,
    strokeGapSize: style.stroke.gapSize,
  }
}

export function sketchStyleFillToDefinition(fill: SketchStyleRecord['fill']): SketchStyleDefinition {
  if (fill.kind === 'none') {
    return { fillMode: 'none' }
  }

  if (fill.kind === 'solid') {
    return {
      fillMode: 'solid',
      fillColor: fill.color,
    }
  }

  return {
    fillMode: 'gradient',
    gradientStartColor: fill.gradient.startColor,
    gradientEndColor: fill.gradient.endColor,
  }
}

export function sketchStyleDefinitionToFill(style: SketchStyleDefinition): SketchStyleRecord['fill'] {
  if (style.fillMode === 'none' || style.fillMode === undefined) {
    return { kind: 'none' }
  }

  if (style.fillMode === 'gradient') {
    return {
      kind: 'gradient',
      gradient: {
        kind: 'linear',
        angleRadians: 0,
        startColor: style.gradientStartColor ?? style.fillColor ?? 'var(--cad-accent)',
        startOpacity: 0.42,
        endColor: style.gradientEndColor ?? 'var(--cad-surface)',
        endOpacity: 0.28,
      },
    }
  }

  return {
    kind: 'solid',
    color: style.fillColor ?? 'var(--cad-accent)',
    opacity: 0.42,
  }
}

export function clearSketchAnnotationEdit(session: SketchSessionState): SketchSessionState {
  return {
    ...session,
    status: 'idle',
    toolPresentation: null,
    activeAnnotationEdit: null,
    validationMessage: null,
  }
}

export function commitSketchAnnotationEditValue(
  session: SketchSessionState,
  edit: SketchAnnotationEditState & { pendingValue: number },
): SketchSessionState {
  const updatedFullDefinition = updateAnnotationValueInDefinition(
    session.fullDefinition,
    edit.target,
    edit.pendingValue,
  )

  if (updatedFullDefinition === session.fullDefinition) {
    return session
  }

  const solved = solveEditedAnnotationDefinition(updatedFullDefinition, session.projectedReferences)

  if (solved.kind === 'blocked') {
    return {
      ...session,
      toolPresentation: buildAnnotationEditPresentation(session, edit, solved.message),
      validationMessage: solved.message,
    }
  }

  const nextFullDefinition = solved.definition
  const nextDefinition = filterSketchDefinitionThroughCursor(nextFullDefinition, session.historyCursor)

  return {
    ...session,
    fullDefinition: nextFullDefinition,
    definition: nextDefinition,
    toolStagedEntities: [],
    status: 'idle',
    toolPresentation: null,
    activeAnnotationEdit: null,
    activeEditTarget: null,
    activeDrag: null,
    validationMessage: null,
    commitRequest: rebuildSessionCommitRequest(session, nextDefinition),
    solvedRegions: deriveSolvedRegionsForSession(session, nextDefinition, solved.solvedSnapshot),
  }
}

export function solveEditedAnnotationDefinition(
  definition: SketchDefinition,
  projectedReferences: readonly ProjectedSketchReferenceRecord[],
) {
  const solved = solveSketchDefinitionCore({
    definition,
    projectedReferences,
    tolerances: SKETCH_DIRECT_EDIT_TOLERANCES,
    partialSolvePolicy: 'failOnConflict',
  })
  const constraintsSatisfied = solved.solvedSnapshot.constraintStatuses.every((status) => status.status === 'satisfied')
  const dimensionsSatisfied = solved.solvedSnapshot.dimensionStatuses.every((status) => status.status !== 'unsatisfied')

  if (
    solved.status.solveState !== 'solved'
    || !constraintsSatisfied
    || !dimensionsSatisfied
  ) {
    return {
      kind: 'blocked' as const,
      message: solved.diagnostics[0]?.message ?? ANNOTATION_EDIT_SOLVE_BLOCKED_MESSAGE,
    }
  }

  return {
    kind: 'accepted' as const,
    definition: applyPointPositionsToDefinition(
      definition,
      solved.solvedSnapshot.solvedPoints.map((point) => ({
        pointId: point.pointId,
        position: point.solvedPosition,
      })),
    ),
    solvedSnapshot: solved.solvedSnapshot,
  }
}

export function updateAuthoringOperationsForAnnotationEdit(
  operations: SketchDefinition['authoringOperations'],
  target: SketchConstraintRef | SketchDimensionRef,
  graph: Pick<SketchAuthoringOperationGraphSnapshot, 'constraints' | 'dimensions' | 'entities'>,
) {
  if (!operations || operations.length === 0) {
    return operations
  }

  return operations.map((operation) => {
    const createdGraph = operation.createdGraph
    if (!createdGraph) {
      return operation
    }

    if (target.kind === 'constraint') {
      const replacement = graph.constraints?.find((constraint) => constraint.constraintId === target.constraintId)
      const constraints = replacement
        ? createdGraph.constraints?.map((constraint) =>
            constraint.constraintId === target.constraintId ? replacement : constraint,
          )
        : createdGraph.constraints
      const edited = constraints?.some((constraint, index) => constraint !== createdGraph.constraints?.[index]) ?? false

      return edited
        ? {
            ...operation,
            targets: {
              ...operation.targets,
              edited: [
                ...(operation.targets.edited ?? []),
                { kind: 'constraint' as const, constraintId: target.constraintId },
              ],
            },
            createdGraph: {
              ...createdGraph,
              constraints,
            },
          }
        : operation
    }

    const replacementDimension = graph.dimensions?.find((dimension) => dimension.dimensionId === target.dimensionId)
    const dimensions = replacementDimension
      ? createdGraph.dimensions?.map((dimension) =>
          dimension.dimensionId === target.dimensionId ? replacementDimension : dimension,
        )
      : createdGraph.dimensions
    const editedDimension = dimensions?.some((dimension, index) => dimension !== createdGraph.dimensions?.[index]) ?? false
    const editedEntityIds = new Set(
      replacementDimension?.kind === 'circleRadius' ? [replacementDimension.entityId] : [],
    )
    const entities = editedEntityIds.size > 0
      ? createdGraph.entities?.map((entity) =>
          editedEntityIds.has(entity.entityId)
            ? graph.entities?.find((candidate) => candidate.entityId === entity.entityId) ?? entity
            : entity,
        )
      : createdGraph.entities

    return editedDimension
      ? {
          ...operation,
          targets: {
            ...operation.targets,
            edited: [
              ...(operation.targets.edited ?? []),
              { kind: 'dimension' as const, dimensionId: target.dimensionId },
            ],
          },
          createdGraph: {
            ...createdGraph,
            dimensions,
            entities,
          },
        }
      : operation
  })
}

export function updateAnnotationValueInDefinition(
  definition: SketchDefinition,
  target: SketchConstraintRef | SketchDimensionRef,
  value: number,
): SketchDefinition {
  if (target.kind === 'constraint') {
    const constraints = definition.constraints.map((constraint) => {
      if (constraint.constraintId !== target.constraintId || constraint.kind !== 'angle') {
        return constraint
      }

      return {
        ...constraint,
        valueRadians: value * Math.PI / 180,
      }
    })
    const edited = constraints.some((constraint, index) => constraint !== definition.constraints[index])

    return edited
      ? {
          ...definition,
          constraints,
          authoringOperations: updateAuthoringOperationsForAnnotationEdit(
            definition.authoringOperations,
            target,
            { constraints },
          ),
        }
      : definition
  }

  let editedCircleRadiusEntityId: SketchEntityId | null = null
  const dimensions = definition.dimensions.map((dimension) => {
    if (dimension.dimensionId !== target.dimensionId) {
      return dimension
    }

    switch (dimension.kind) {
      case 'distance':
      case 'pointDatumDistance':
      case 'horizontalDistance':
      case 'verticalDistance':
      case 'circleRadius':
      case 'diameter':
      case 'lineLength':
      case 'lineDistance':
      case 'linePointDistance':
        if (dimension.kind === 'circleRadius') {
          editedCircleRadiusEntityId = dimension.entityId
        }

        return {
          ...dimension,
          value,
        }
      case 'lineAngle':
        return {
          ...dimension,
          valueRadians: value * Math.PI / 180,
        }
      case 'arcStartPointCoincident':
      case 'arcEndPointCoincident':
        return dimension
      default: {
        const exhaustive: never = dimension
        return exhaustive
      }
    }
  })
  const edited = dimensions.some((dimension, index) => dimension !== definition.dimensions[index])

  return edited
    ? {
        ...definition,
        entities: editedCircleRadiusEntityId
          ? definition.entities.map((entity) =>
              entity.entityId === editedCircleRadiusEntityId && entity.kind === 'circle'
                ? { ...entity, radius: value }
                : entity,
            )
          : definition.entities,
        dimensions,
        authoringOperations: updateAuthoringOperationsForAnnotationEdit(
          definition.authoringOperations,
          target,
          {
            dimensions,
            entities: editedCircleRadiusEntityId
              ? definition.entities.map((entity) =>
                  entity.entityId === editedCircleRadiusEntityId && entity.kind === 'circle'
                    ? { ...entity, radius: value }
                    : entity,
                )
              : definition.entities,
          },
        ),
      }
    : definition
}

export function updateDimensionAnnotationPlacementInDefinition(
  session: SketchSessionState,
  definition: SketchDefinition,
  target: SketchDimensionRef,
  point: SketchPoint,
): SketchDefinition {
  const dimensions = definition.dimensions.map((dimension) => {
    if (dimension.dimensionId !== target.dimensionId) {
      return dimension
    }

    const placement = inferCommittedDimensionAnnotationPlacement(session, definition, dimension, point)
    if (!placement) {
      return dimension
    }

    switch (dimension.kind) {
      case 'distance':
      case 'pointDatumDistance':
      case 'horizontalDistance':
      case 'verticalDistance':
      case 'circleRadius':
      case 'diameter':
      case 'lineLength':
      case 'lineDistance':
      case 'linePointDistance':
        return placement.kind === 'dimensionLine'
          ? { ...dimension, annotationPlacement: placement }
          : dimension
      case 'lineAngle':
        return placement.kind === 'angleArc'
          ? { ...dimension, annotationPlacement: placement }
          : dimension
      case 'arcStartPointCoincident':
      case 'arcEndPointCoincident':
        return dimension
    }
  })
  const edited = dimensions.some((dimension, index) => dimension !== definition.dimensions[index])

  return edited
    ? {
        ...definition,
        dimensions,
        authoringOperations: updateAuthoringOperationsForAnnotationEdit(
          definition.authoringOperations,
          target,
          { dimensions },
        ),
      }
    : definition
}

export function inferCommittedDimensionAnnotationPlacement(
  session: SketchSessionState,
  definition: SketchDefinition,
  dimension: DimensionDefinition,
  point: SketchPoint,
): DimensionAnnotationPlacement | null {
  switch (dimension.kind) {
    case 'distance':
    case 'horizontalDistance':
    case 'verticalDistance': {
      const first = getPointPosition(definition, dimension.pointIds[0])
      const second = getPointPosition(definition, dimension.pointIds[1])
      if (!first || !second) {
        return null
      }

      const axis = dimension.kind === 'distance'
        ? dimension.axis
        : dimension.kind === 'horizontalDistance'
          ? 'horizontal'
          : 'vertical'
      return getPointPairAnnotationPlacementFromPoint(first, second, axis, point)
    }
    case 'pointDatumDistance': {
      const first = getReferencePointGeometry(definition, session, dimension.point)
      const second = getReferencePointGeometry(definition, session, dimension.datum)
      return first && second ? getPointPairAnnotationPlacementFromPoint(first, second, dimension.axis, point) : null
    }
    case 'circleRadius':
    case 'diameter': {
      const circle = getCircleLikeGeometry(definition, dimension.entityId)
      if (!circle) {
        return null
      }

      return {
        kind: 'dimensionLine',
        offset: 0,
        angleRadians: Math.atan2(point[1] - circle.center[1], point[0] - circle.center[0]),
      }
    }
    case 'lineLength': {
      const line = getLineSegmentGeometry(definition, dimension.entityId)
      return line ? getLineAnnotationPlacementFromPoint(line, point) : null
    }
    case 'lineDistance': {
      const line = getReferenceLineGeometry(definition, session, dimension.lines[0])
      return line ? getLineAnnotationPlacementFromPoint(line, point) : null
    }
    case 'linePointDistance': {
      const line = getReferenceLineGeometry(definition, session, dimension.line)
      return line ? getLineAnnotationPlacementFromPoint(line, point) : null
    }
    case 'lineAngle': {
      const first = getReferenceLineGeometry(definition, session, dimension.lines[0])
      const second = getReferenceLineGeometry(definition, session, dimension.lines[1])
      if (!first || !second) {
        return null
      }

      const center = getSketchLineIntersection(first, second) ?? first.start
      const firstVector = getSketchLineDirectionFromCenter(first, center)
      const secondVector = getSketchLineDirectionFromCenter(second, center)
      return {
        kind: 'angleArc',
        radius: Math.max(0.1, Math.hypot(point[0] - center[0], point[1] - center[1])),
        side: getSketchAngleArcSide({
          center,
          startVector: firstVector,
          endVector: secondVector,
          point,
        }),
      }
    }
    case 'arcStartPointCoincident':
    case 'arcEndPointCoincident':
      return null
    default: {
      const exhaustive: never = dimension
      return exhaustive
    }
  }
}

export function buildAnnotationEditPresentation(
  session: SketchSessionState,
  edit: SketchAnnotationEditState,
  validationMessage: string | null = null,
): SketchToolPresentationSchema {
  const editable = getEditableAnnotationValue(session, edit.target)
  const label = editable?.label ?? 'Value'

  return {
    prompts: [
      {
        id: 'annotation-edit-prompt',
        text: `Edit ${label.toLowerCase()}`,
      },
    ],
    floatingInput: {
      id: `annotation-edit-${getTargetKey(edit.target)}`,
      label,
      value: edit.pendingValue,
      unit: editable?.unit,
      min: editable?.min,
      confirmLabel: 'Save',
      cancelLabel: 'Cancel',
      anchor: editable?.anchor,
      placement: 'target',
      submitAction: { type: 'patch', patch: { intent: 'commitAnnotationValue' } },
      cancelAction: { type: 'patch', patch: { intent: 'cancelAnnotationValue' } },
    },
    validation: validationMessage
      ? [{
          id: 'annotation-edit-value-required',
          message: validationMessage,
          severity: 'error',
        }]
      : [],
  }
}

export function getEditableAnnotationValue(
  session: SketchSessionState,
  target: SketchConstraintRef | SketchDimensionRef,
): {
  label: string
  value: number
  unit?: string
  min?: number
  anchor?: SketchToolAnchorDescriptor
} | null {
  const annotation = getSketchAnnotationDescriptors(session).find(
    (entry) => getTargetKey(entry.target) === getTargetKey(target),
  )

  if (target.kind === 'constraint') {
    const constraint = session.definition.constraints.find((entry) => entry.constraintId === target.constraintId)

    if (constraint?.kind !== 'angle') {
      return null
    }

    return {
      label: 'Angle',
      value: constraint.valueRadians * 180 / Math.PI,
      unit: 'deg',
      anchor: annotation ? addAnchorOffset(annotation.anchor, { x: 18, y: -18 }) : undefined,
    }
  }

  const dimension = session.definition.dimensions.find((entry) => entry.dimensionId === target.dimensionId)

  if (!dimension) {
    return null
  }

  switch (dimension.kind) {
    case 'distance':
    case 'pointDatumDistance':
      return {
        label: dimension.axis === 'horizontal'
          ? 'Horizontal distance'
          : dimension.axis === 'vertical'
            ? 'Vertical distance'
            : 'Distance',
        value: dimension.value,
        unit: 'mm',
        min: 0.01,
        anchor: annotation ? addAnchorOffset(annotation.anchor, { x: 18, y: -18 }) : undefined,
      }
    case 'horizontalDistance':
      return {
        label: 'Horizontal distance',
        value: dimension.value,
        unit: 'mm',
        min: 0.01,
        anchor: annotation ? addAnchorOffset(annotation.anchor, { x: 18, y: -18 }) : undefined,
      }
    case 'verticalDistance':
      return {
        label: 'Vertical distance',
        value: dimension.value,
        unit: 'mm',
        min: 0.01,
        anchor: annotation ? addAnchorOffset(annotation.anchor, { x: 18, y: -18 }) : undefined,
      }
    case 'circleRadius':
      return {
        label: 'Radius',
        value: dimension.value,
        unit: 'mm',
        min: 0.01,
        anchor: annotation ? addAnchorOffset(annotation.anchor, { x: 18, y: -18 }) : undefined,
      }
    case 'diameter':
      return {
        label: 'Diameter',
        value: dimension.value,
        unit: 'mm',
        min: 0.01,
        anchor: annotation ? addAnchorOffset(annotation.anchor, { x: 18, y: -18 }) : undefined,
      }
    case 'lineLength':
      return {
        label: 'Length',
        value: dimension.value,
        unit: 'mm',
        min: 0.01,
        anchor: annotation ? addAnchorOffset(annotation.anchor, { x: 18, y: -18 }) : undefined,
      }
    case 'lineDistance':
    case 'linePointDistance':
      return {
        label: 'Distance',
        value: dimension.value,
        unit: 'mm',
        min: 0.01,
        anchor: annotation ? addAnchorOffset(annotation.anchor, { x: 18, y: -18 }) : undefined,
      }
    case 'lineAngle':
      return {
        label: 'Angle',
        value: dimension.valueRadians * 180 / Math.PI,
        unit: 'deg',
        min: 0.1,
        anchor: annotation ? addAnchorOffset(annotation.anchor, { x: 18, y: -18 }) : undefined,
      }
    case 'arcStartPointCoincident':
    case 'arcEndPointCoincident':
      return null
  }
}

export function selectSketchAnnotation(
  session: SketchSessionState,
  target: SketchConstraintRef | SketchDimensionRef | null,
): SketchSessionState {
  return {
    ...session,
    selectedAnnotation: target,
    activeAnnotationEdit: null,
    activeEditTarget: null,
    activeDrag: null,
  }
}

export function deleteSelectedSketchAnnotation(session: SketchSessionState): SketchSessionState {
  const selectedAnnotation = session.selectedAnnotation

  if (!selectedAnnotation) {
    return session
  }

  const deleteOperation = createDeleteAuthoringOperation({
    sequence: session.sequence + 1,
    removedGraph: selectedAnnotation.kind === 'constraint'
      ? {
          constraints: session.fullDefinition.constraints.filter(
            (constraint) => constraint.constraintId === selectedAnnotation.constraintId,
          ),
        }
      : {
          dimensions: session.fullDefinition.dimensions.filter(
            (dimension) => dimension.dimensionId === selectedAnnotation.dimensionId,
          ),
        },
  })
  const nextFullDefinition =
    selectedAnnotation.kind === 'constraint'
      ? {
          ...session.fullDefinition,
          constraintIds: session.fullDefinition.constraintIds.filter(
            (constraintId) => constraintId !== selectedAnnotation.constraintId,
          ),
          constraints: session.fullDefinition.constraints.filter(
            (constraint) => constraint.constraintId !== selectedAnnotation.constraintId,
          ),
          authoringOperations: [
            ...getAppendBaseAuthoringOperations(session.fullDefinition),
            deleteOperation,
          ],
        }
      : {
          ...session.fullDefinition,
          dimensionIds: session.fullDefinition.dimensionIds.filter(
            (dimensionId) => dimensionId !== selectedAnnotation.dimensionId,
          ),
          dimensions: session.fullDefinition.dimensions.filter(
            (dimension) => dimension.dimensionId !== selectedAnnotation.dimensionId,
          ),
          authoringOperations: [
            ...getAppendBaseAuthoringOperations(session.fullDefinition),
            deleteOperation,
          ],
        }
  const historyCursor = createTailSketchHistoryCursor(nextFullDefinition)
  const nextDefinition = filterSketchDefinitionThroughCursor(nextFullDefinition, historyCursor)

  return {
    ...session,
    fullDefinition: nextFullDefinition,
    definition: nextDefinition,
    historyCursor,
    sequence: session.sequence + 1,
    toolStagedEntities: [],
    activeAnnotationEdit: null,
    selectedAnnotation: null,
    activeEditTarget: null,
    activeSpecialMode: null,
    activeDrag: null,
    validationMessage: null,
    commitRequest: rebuildSessionCommitRequest(session, nextDefinition),
    solvedRegions: deriveSolvedRegionsForSession(session, nextDefinition),
  }
}

export function getSketchAnnotationDescriptors(
  session: SketchSessionState,
): SketchAnnotationDescriptor[] {
  const sketchId = session.sketchId ?? ('sketch_draft' as SketchId)
  const solved = solveSketchDefinitionCore({
    definition: session.definition,
    projectedReferences: session.projectedReferences,
    tolerances: SKETCH_DIRECT_EDIT_TOLERANCES,
    partialSolvePolicy: 'bestEffort',
  })
  const constraintDisplaySummary = getSketchConstraintDisplaySummary({
    sketchId,
    definition: session.definition,
    solvedSnapshot: solved.solvedSnapshot,
  })

  return [
    ...session.definition.constraints.map((constraint) => ({
      id: constraint.constraintId,
      target: createSketchConstraintRef(sketchId, constraint.constraintId),
      glyphKind: getConstraintGlyphKind(constraint),
      anchor: createConstraintAnnotationAnchor(session, constraint),
      affectedGeometryRefs: getConstraintAffectedGeometryRefs(sketchId, constraint),
      constraintDisplay: getSketchConstraintDisplayForTarget(
        createSketchConstraintRef(sketchId, constraint.constraintId),
        constraintDisplaySummary,
      ),
      label: constraint.label,
      detail: describeConstraint(constraint),
      status: 'constraint' as const,
    })),
    ...session.definition.dimensions.map((dimension) => ({
      id: dimension.dimensionId,
      target: createSketchDimensionRef(sketchId, dimension.dimensionId),
      glyphKind: getDimensionGlyphKind(dimension),
      anchor: createDimensionAnnotationAnchor(session, session.definition, dimension),
      affectedGeometryRefs: getDimensionAffectedGeometryRefs(sketchId, dimension),
      constraintDisplay: getSketchConstraintDisplayForTarget(
        createSketchDimensionRef(sketchId, dimension.dimensionId),
        constraintDisplaySummary,
      ),
      label: dimension.label,
      detail: describeDimension(dimension),
      status: 'dimension' as const,
      visibleLabel: formatDimensionVisibleLabel(dimension),
      dragHandle: createDimensionAnnotationDragHandle(dimension),
    })),
  ]
}

export function createDimensionAnnotationDragHandle(
  dimension: DimensionDefinition,
): SketchDimensionAnnotationDragHandle | undefined {
  switch (dimension.kind) {
    case 'distance':
    case 'horizontalDistance':
    case 'verticalDistance':
    case 'circleRadius':
    case 'diameter':
    case 'lineLength':
    case 'lineDistance':
    case 'linePointDistance':
    case 'lineAngle':
      return { id: `${dimension.dimensionId}-annotation-drag`, dimensionId: dimension.dimensionId }
    case 'arcStartPointCoincident':
    case 'arcEndPointCoincident':
      return undefined
  }
}

export function getConstraintGlyphKind(constraint: ConstraintDefinition): SketchAnnotationGlyphKind {
  switch (constraint.kind) {
    case 'coincident':
      return 'constraintCoincident'
    case 'parallel':
      return 'constraintParallel'
    case 'equalLength':
      return 'constraintEqual'
    case 'horizontal':
      return 'constraintHorizontal'
    case 'vertical':
      return 'constraintVertical'
    case 'fixPoint':
      return 'constraintFixed'
    case 'angle':
      return 'constraintAngle'
    case 'perpendicular':
    case 'perpendicularProjectedLine':
      return 'constraintPerpendicular'
    case 'tangentProjectedCurve':
    case 'tangent':
      return 'constraintTangent'
    case 'midpoint':
    case 'midpointProjectedLine':
      return 'constraintMidpoint'
    case 'normal':
    case 'normalProjectedCurve':
      return 'constraintNormal'
    case 'symmetric':
    case 'symmetricProjectedLine':
      return 'constraintSymmetric'
    case 'pointOnProjectedCurve':
    case 'pointOnCurve':
      return 'constraintPierce'
    case 'coincidentProjectedPoint':
      return 'constraintCoincident'
    case 'parallelProjectedLine':
      return 'constraintParallel'
    case 'concentric':
    case 'concentricProjectedCurve':
      return 'constraintConcentric'
  }
}

export function getDimensionGlyphKind(dimension: DimensionDefinition): SketchAnnotationGlyphKind {
  switch (dimension.kind) {
    case 'distance':
    case 'pointDatumDistance':
      if (dimension.axis === 'horizontal') {
        return 'dimensionHorizontal'
      }

      if (dimension.axis === 'vertical') {
        return 'dimensionVertical'
      }

      return 'dimensionDistance'
    case 'horizontalDistance':
      return 'dimensionHorizontal'
    case 'verticalDistance':
      return 'dimensionVertical'
    case 'circleRadius':
    case 'diameter':
      return 'dimensionRadius'
    case 'lineLength':
    case 'lineDistance':
    case 'linePointDistance':
      return 'dimensionDistance'
    case 'lineAngle':
      return 'dimensionAngle'
    case 'arcStartPointCoincident':
    case 'arcEndPointCoincident':
      return 'dimensionCoincident'
  }
}

export function getConstraintAffectedGeometryRefs(
  sketchId: SketchId,
  constraint: ConstraintDefinition,
): readonly PrimitiveRef[] {
  switch (constraint.kind) {
    case 'coincident':
    case 'angle':
      return constraint.pointIds.map((pointId) => createSketchPointRef(sketchId, pointId))
    case 'fixPoint':
      return [createSketchPointRef(sketchId, constraint.pointId)]
    case 'horizontal':
    case 'vertical':
      return [createSketchEntityRef(sketchId, constraint.entityId)]
    case 'parallel':
    case 'perpendicular':
    case 'equalLength':
    case 'tangent':
    case 'concentric':
      return constraint.entityIds.map((entityId) => createSketchEntityRef(sketchId, entityId))
    case 'midpoint':
      return [
        createSketchPointRef(sketchId, constraint.point.pointId),
        createSketchEntityRef(sketchId, constraint.line.entityId),
      ]
    case 'midpointProjectedLine':
      return [
        createSketchPointRef(sketchId, constraint.point.pointId),
        createReferencePrimitiveRef(constraint.projectedLine, sketchId)!,
      ]
    case 'pointOnCurve':
      return [
        createSketchPointRef(sketchId, constraint.point.pointId),
        createSketchEntityRef(sketchId, constraint.curve.entityId),
      ]
    case 'normal':
      return [
        createSketchPointRef(sketchId, constraint.point.pointId),
        createSketchEntityRef(sketchId, constraint.line.entityId),
        createSketchEntityRef(sketchId, constraint.curve.entityId),
      ]
    case 'normalProjectedCurve':
      return [
        createSketchPointRef(sketchId, constraint.point.pointId),
        createSketchEntityRef(sketchId, constraint.line.entityId),
        createReferencePrimitiveRef(constraint.projectedCurve, sketchId)!,
      ]
    case 'symmetric':
      return [
        ...constraint.pointIds.map((pointId) => createSketchPointRef(sketchId, pointId)),
        createSketchEntityRef(sketchId, constraint.axis.entityId),
      ]
    case 'symmetricProjectedLine':
      return [
        ...constraint.pointIds.map((pointId) => createSketchPointRef(sketchId, pointId)),
        createReferencePrimitiveRef(constraint.projectedLine, sketchId)!,
      ]
    case 'coincidentProjectedPoint':
      return [
        createSketchPointRef(sketchId, constraint.point.pointId),
        createReferencePrimitiveRef(constraint.projectedPoint, sketchId)!,
      ]
    case 'pointOnProjectedCurve':
      return [
        createSketchPointRef(sketchId, constraint.point.pointId),
        createReferencePrimitiveRef(constraint.projectedCurve, sketchId)!,
      ]
    case 'parallelProjectedLine':
    case 'perpendicularProjectedLine':
      return [
        createSketchEntityRef(sketchId, constraint.line.entityId),
        createReferencePrimitiveRef(constraint.projectedLine, sketchId)!,
      ]
    case 'tangentProjectedCurve':
      return [
        createSketchEntityRef(sketchId, constraint.curve.entityId),
        createReferencePrimitiveRef(constraint.projectedCurve, sketchId)!,
      ]
    case 'concentricProjectedCurve':
      return [
        createSketchEntityRef(sketchId, constraint.curve.entityId),
        createReferencePrimitiveRef(constraint.projectedCurve, sketchId)!,
      ]
  }
}

export function getDimensionAffectedGeometryRefs(
  sketchId: SketchId,
  dimension: DimensionDefinition,
): readonly PrimitiveRef[] {
  const operandRef = (
    operand: {
      kind: string
      pointId?: SketchPointId
      entityId?: SketchEntityId
      reference?: ProjectedSketchGeometryRef & { kind: NonNullable<ProjectedSketchGeometryRef['kind']> }
      datum?: 'origin' | 'xAxis' | 'yAxis'
    },
  ): PrimitiveRef | null => {
    if (operand.kind === 'localPoint' && operand.pointId) {
      return createSketchPointRef(sketchId, operand.pointId)
    }

    if (operand.kind === 'localEntity' && operand.entityId) {
      return createSketchEntityRef(sketchId, operand.entityId)
    }

    if (operand.kind === 'projectedGeometry' && operand.reference) {
      return createProjectedPrimitiveRef(operand.reference)
    }

    if (operand.kind === 'sketchDatum' && operand.datum) {
      return {
        kind: 'sketchDatumReference',
        sketchId,
        datumId: operand.datum,
        geometryKind: operand.datum === 'origin' ? 'point' : 'lineSegment',
      }
    }

    return null
  }

  switch (dimension.kind) {
    case 'distance':
    case 'horizontalDistance':
    case 'verticalDistance':
      return dimension.pointIds.map((pointId) => createSketchPointRef(sketchId, pointId))
    case 'pointDatumDistance':
      return [
        createSketchPointRef(sketchId, dimension.point.pointId),
        createReferencePrimitiveRef(dimension.datum, sketchId)!,
      ]
    case 'circleRadius':
    case 'diameter':
      return [createSketchEntityRef(sketchId, dimension.entityId)]
    case 'lineLength':
      return [createSketchEntityRef(sketchId, dimension.entityId)]
    case 'lineDistance':
    case 'lineAngle':
      return dimension.lines.map(operandRef).filter((ref): ref is PrimitiveRef => ref !== null)
    case 'linePointDistance':
      return [operandRef(dimension.line), operandRef(dimension.point)].filter((ref): ref is PrimitiveRef => ref !== null)
    case 'arcStartPointCoincident':
    case 'arcEndPointCoincident':
      return [
        createSketchEntityRef(sketchId, dimension.entityId),
        createSketchPointRef(sketchId, dimension.pointId),
      ]
  }
}

export function createConstraintAnnotationAnchor(
  session: SketchSessionState,
  constraint: ConstraintDefinition,
): SketchToolAnchorDescriptor {
  const definition = session.definition
  switch (constraint.kind) {
    case 'coincident':
    case 'angle':
      return createOffsetAnnotationAnchor(getAveragePointPosition(definition, constraint.pointIds))
    case 'fixPoint':
      return createOffsetAnnotationAnchor(getPointPosition(definition, constraint.pointId))
    case 'horizontal':
    case 'vertical':
      return createOffsetAnnotationAnchor(getEntityAnchor(definition, constraint.entityId))
    case 'parallel':
    case 'perpendicular':
    case 'equalLength':
    case 'tangent':
    case 'concentric':
      return createOffsetAnnotationAnchor(getAverageEntityAnchor(definition, constraint.entityIds))
    case 'midpoint':
      return createOffsetAnnotationAnchor(getAverageSketchPoint([
        getPointPosition(definition, constraint.point.pointId),
        getEntityAnchor(definition, constraint.line.entityId),
      ].filter((point): point is SketchPoint => point !== null)))
    case 'midpointProjectedLine':
      return createOffsetAnnotationAnchor(getAverageSketchPoint([
        getPointPosition(definition, constraint.point.pointId),
        getReferenceGeometryAnchor(session, constraint.projectedLine),
      ].filter((point): point is SketchPoint => point !== null)))
    case 'pointOnCurve':
      return createOffsetAnnotationAnchor(getAverageSketchPoint([
        getPointPosition(definition, constraint.point.pointId),
        getEntityAnchor(definition, constraint.curve.entityId),
      ].filter((point): point is SketchPoint => point !== null)))
    case 'normal':
      return createOffsetAnnotationAnchor(getAverageSketchPoint([
        getPointPosition(definition, constraint.point.pointId),
        getEntityAnchor(definition, constraint.line.entityId),
        getEntityAnchor(definition, constraint.curve.entityId),
      ].filter((point): point is SketchPoint => point !== null)))
    case 'normalProjectedCurve':
      return createOffsetAnnotationAnchor(getAverageSketchPoint([
        getPointPosition(definition, constraint.point.pointId),
        getEntityAnchor(definition, constraint.line.entityId),
        getReferenceGeometryAnchor(session, constraint.projectedCurve),
      ].filter((point): point is SketchPoint => point !== null)))
    case 'symmetric':
      return createOffsetAnnotationAnchor(getAverageSketchPoint([
        getAveragePointPosition(definition, constraint.pointIds),
        getEntityAnchor(definition, constraint.axis.entityId),
      ].filter((point): point is SketchPoint => point !== null)))
    case 'symmetricProjectedLine':
      return createOffsetAnnotationAnchor(getAverageSketchPoint([
        getAveragePointPosition(definition, constraint.pointIds),
        getReferenceGeometryAnchor(session, constraint.projectedLine),
      ].filter((point): point is SketchPoint => point !== null)))
    case 'coincidentProjectedPoint':
      return createOffsetAnnotationAnchor(getAverageSketchPoint([
        getPointPosition(definition, constraint.point.pointId),
        getReferenceGeometryAnchor(session, constraint.projectedPoint),
      ].filter((point): point is SketchPoint => point !== null)))
    case 'pointOnProjectedCurve':
      return createOffsetAnnotationAnchor(getAverageSketchPoint([
        getPointPosition(definition, constraint.point.pointId),
        getReferenceGeometryAnchor(session, constraint.projectedCurve),
      ].filter((point): point is SketchPoint => point !== null)))
    case 'parallelProjectedLine':
    case 'perpendicularProjectedLine':
      return createOffsetAnnotationAnchor(getAverageSketchPoint([
        getEntityAnchor(definition, constraint.line.entityId),
        getReferenceGeometryAnchor(session, constraint.projectedLine),
      ].filter((point): point is SketchPoint => point !== null)))
    case 'tangentProjectedCurve':
      return createOffsetAnnotationAnchor(getAverageSketchPoint([
        getEntityAnchor(definition, constraint.curve.entityId),
        getReferenceGeometryAnchor(session, constraint.projectedCurve),
      ].filter((point): point is SketchPoint => point !== null)))
    case 'concentricProjectedCurve':
      return createOffsetAnnotationAnchor(getAverageSketchPoint([
        getEntityAnchor(definition, constraint.curve.entityId),
        getReferenceGeometryAnchor(session, constraint.projectedCurve),
      ].filter((point): point is SketchPoint => point !== null)))
  }
}

export function createDimensionAnnotationAnchor(
  session: SketchSessionState,
  definition: SketchDefinition,
  dimension: DimensionDefinition,
): SketchToolAnchorDescriptor {
  switch (dimension.kind) {
    case 'distance':
    case 'horizontalDistance':
    case 'verticalDistance': {
      const first = getPointPosition(definition, dimension.pointIds[0])
      const second = getPointPosition(definition, dimension.pointIds[1])
      if (!first || !second) {
        return createOffsetAnnotationAnchor(null, { x: 0, y: -28 })
      }

      const axis = dimension.kind === 'distance' ? dimension.axis : dimension.kind === 'horizontalDistance' ? 'horizontal' : 'vertical'
      const line = createPlacedPointDimensionLine(first, second, axis, dimension.annotationPlacement)
      return { kind: 'sketchPoint', point: getSketchMidpoint(line.start, line.end), offset: { x: 0, y: -18 } }
    }
    case 'pointDatumDistance': {
      const first = getReferencePointGeometry(definition, session, dimension.point)
      const second = getReferencePointGeometry(definition, session, dimension.datum)
      if (!first || !second) {
        return createOffsetAnnotationAnchor(null, { x: 0, y: -28 })
      }

      const line = createPlacedPointDimensionLine(first, second, dimension.axis, dimension.annotationPlacement)
      return { kind: 'sketchPoint', point: getSketchMidpoint(line.start, line.end), offset: { x: 0, y: -18 } }
    }
    case 'circleRadius':
    case 'diameter': {
      const circle = getCircleLikeGeometry(definition, dimension.entityId)
      if (!circle) {
        return createOffsetAnnotationAnchor(getEntityAnchor(definition, dimension.entityId), { x: 22, y: -22 })
      }

      const angle = dimension.annotationPlacement?.angleRadians ?? 0
      const end: SketchPoint = [
        circle.center[0] + Math.cos(angle) * circle.radius,
        circle.center[1] + Math.sin(angle) * circle.radius,
      ]
      return { kind: 'sketchPoint', point: end, offset: { x: 16, y: -16 } }
    }
    case 'lineLength': {
      const lineGeometry = getLineSegmentGeometry(definition, dimension.entityId)
      if (!lineGeometry) {
        return createOffsetAnnotationAnchor(getEntityAnchor(definition, dimension.entityId), { x: 0, y: -28 })
      }

      const line = createPlacedLineLength(lineGeometry, dimension.annotationPlacement)
      return { kind: 'sketchPoint', point: getSketchMidpoint(line.start, line.end), offset: { x: 0, y: -18 } }
    }
    case 'lineDistance': {
      const first = getReferenceLineGeometry(definition, session, dimension.lines[0])
      const second = getReferenceLineGeometry(definition, session, dimension.lines[1])
      if (!first || !second) {
        return createOffsetAnnotationAnchor(null, { x: 0, y: -28 })
      }

      const line = createPlacedLineDistance(first, getSketchMidpoint(second.start, second.end), dimension.annotationPlacement)
      return { kind: 'sketchPoint', point: getSketchMidpoint(line.start, line.end), offset: { x: 0, y: -18 } }
    }
    case 'linePointDistance': {
      const lineGeometry = getReferenceLineGeometry(definition, session, dimension.line)
      const point = getReferencePointGeometry(definition, session, dimension.point)
      if (!lineGeometry || !point) {
        return createOffsetAnnotationAnchor(null, { x: 0, y: -28 })
      }

      const line = createPlacedLineDistance(lineGeometry, point, dimension.annotationPlacement)
      return { kind: 'sketchPoint', point: getSketchMidpoint(line.start, line.end), offset: { x: 0, y: -18 } }
    }
    case 'lineAngle': {
      const first = getReferenceLineGeometry(definition, session, dimension.lines[0])
      const second = getReferenceLineGeometry(definition, session, dimension.lines[1])
      if (!first || !second) {
        return createOffsetAnnotationAnchor(null, { x: 0, y: -28 })
      }

      const center = getSketchLineIntersection(first, second) ?? first.start
      const firstVector = getSketchLineDirectionFromCenter(first, center)
      const secondVector = getSketchLineDirectionFromCenter(second, center)
      const radius = dimension.annotationPlacement?.radius ?? 1
      const side = dimension.annotationPlacement?.side ?? 'minor'
      return {
        kind: 'sketchPoint',
        point: getSketchAngleLabelPoint(center, firstVector, secondVector, radius, side),
        offset: { x: 12, y: -12 },
      }
    }
    case 'arcStartPointCoincident':
    case 'arcEndPointCoincident':
      return createOffsetAnnotationAnchor(
        getAveragePointPosition(definition, [
          getEntityAnchorPointId(definition, dimension.entityId),
          dimension.pointId,
        ].filter((pointId): pointId is SketchPointId => Boolean(pointId))),
      )
  }
}

export function buildCommittedDimensionOverlays(
  session: SketchSessionState,
  definition: SketchDefinition,
): readonly SketchToolOverlayDescriptor[] {
  return definition.dimensions.flatMap((dimension): SketchToolOverlayDescriptor[] => {
    switch (dimension.kind) {
      case 'distance':
      case 'horizontalDistance':
      case 'verticalDistance': {
        const first = getPointPosition(definition, dimension.pointIds[0])
        const second = getPointPosition(definition, dimension.pointIds[1])
        if (!first || !second) {
          return []
        }

        const axis = dimension.kind === 'distance' ? dimension.axis : dimension.kind === 'horizontalDistance' ? 'horizontal' : 'vertical'
        const line = createPlacedPointDimensionLine(first, second, axis, dimension.annotationPlacement)
        return [{
          id: `${dimension.dimensionId}-overlay`,
          kind: 'dimensionLine',
          label: dimension.label,
          referenceKind: axis,
          start: line.start,
          end: line.end,
          value: dimension.value,
          unit: 'mm',
          labelAnchor: { kind: 'sketchPoint', point: getSketchMidpoint(line.start, line.end), offset: { x: 0, y: -18 } },
          extensionLines: [
            { id: `${dimension.dimensionId}-extension-a`, label: 'Extension', start: first, end: line.start },
            { id: `${dimension.dimensionId}-extension-b`, label: 'Extension', start: second, end: line.end },
          ],
        }]
      }
      case 'pointDatumDistance': {
        const first = getReferencePointGeometry(definition, session, dimension.point)
        const second = getReferencePointGeometry(definition, session, dimension.datum)
        if (!first || !second) {
          return []
        }

        const line = createPlacedPointDimensionLine(first, second, dimension.axis, dimension.annotationPlacement)
        return [{
          id: `${dimension.dimensionId}-overlay`,
          kind: 'dimensionLine',
          label: dimension.label,
          referenceKind: dimension.axis,
          start: line.start,
          end: line.end,
          value: dimension.value,
          unit: 'mm',
          labelAnchor: { kind: 'sketchPoint', point: getSketchMidpoint(line.start, line.end), offset: { x: 0, y: -18 } },
          extensionLines: [
            { id: `${dimension.dimensionId}-extension-a`, label: 'Extension', start: first, end: line.start },
            { id: `${dimension.dimensionId}-extension-b`, label: 'Extension', start: second, end: line.end },
          ],
        }]
      }
      case 'circleRadius':
      case 'diameter': {
        const circle = getCircleLikeGeometry(definition, dimension.entityId)
        if (!circle) {
          return []
        }

        const angle = dimension.annotationPlacement?.angleRadians ?? 0
        const direction: SketchPoint = [Math.cos(angle), Math.sin(angle)]
        const start: SketchPoint = dimension.kind === 'diameter'
          ? [circle.center[0] - direction[0] * circle.radius, circle.center[1] - direction[1] * circle.radius]
          : circle.center
        const end: SketchPoint = [circle.center[0] + direction[0] * circle.radius, circle.center[1] + direction[1] * circle.radius]
        return [{
          id: `${dimension.dimensionId}-overlay`,
          kind: 'dimensionLine',
          label: dimension.label,
          referenceKind: dimension.kind === 'diameter' ? 'diameter' : 'radius',
          start,
          end,
          value: dimension.value,
          unit: 'mm',
          labelAnchor: { kind: 'sketchPoint', point: end, offset: { x: 16, y: -16 } },
        }]
      }
      case 'lineLength': {
        const lineGeometry = getLineSegmentGeometry(definition, dimension.entityId)
        if (!lineGeometry) {
          return []
        }

        const line = createPlacedLineLength(lineGeometry, dimension.annotationPlacement)
        return [{
          id: `${dimension.dimensionId}-overlay`,
          kind: 'dimensionLine',
          label: dimension.label,
          referenceKind: 'lineLength',
          start: line.start,
          end: line.end,
          value: dimension.value,
          unit: 'mm',
          labelAnchor: { kind: 'sketchPoint', point: getSketchMidpoint(line.start, line.end), offset: { x: 0, y: -18 } },
          extensionLines: line.offset === 0
            ? []
            : [
                { id: `${dimension.dimensionId}-extension-a`, label: 'Extension', start: lineGeometry.start, end: line.start },
                { id: `${dimension.dimensionId}-extension-b`, label: 'Extension', start: lineGeometry.end, end: line.end },
              ],
        }]
      }
      case 'lineDistance': {
        const first = getReferenceLineGeometry(definition, session, dimension.lines[0])
        const second = getReferenceLineGeometry(definition, session, dimension.lines[1])
        if (!first || !second) {
          return []
        }

        const line = createPlacedLineDistance(first, getSketchMidpoint(second.start, second.end), dimension.annotationPlacement)
        return [{
          id: `${dimension.dimensionId}-overlay`,
          kind: 'dimensionLine',
          label: dimension.label,
          referenceKind: 'lineDistance',
          start: line.start,
          end: line.end,
          value: dimension.value,
          unit: 'mm',
          labelAnchor: { kind: 'sketchPoint', point: getSketchMidpoint(line.start, line.end), offset: { x: 0, y: -18 } },
        }]
      }
      case 'linePointDistance': {
        const lineGeometry = getReferenceLineGeometry(definition, session, dimension.line)
        const point = getReferencePointGeometry(definition, session, dimension.point)
        if (!lineGeometry || !point) {
          return []
        }

        const line = createPlacedLineDistance(lineGeometry, point, dimension.annotationPlacement)
        return [{
          id: `${dimension.dimensionId}-overlay`,
          kind: 'dimensionLine',
          label: dimension.label,
          referenceKind: 'pointLineDistance',
          start: line.start,
          end: line.end,
          value: dimension.value,
          unit: 'mm',
          labelAnchor: { kind: 'sketchPoint', point: getSketchMidpoint(line.start, line.end), offset: { x: 0, y: -18 } },
        }]
      }
      case 'lineAngle': {
        const first = getReferenceLineGeometry(definition, session, dimension.lines[0])
        const second = getReferenceLineGeometry(definition, session, dimension.lines[1])
        if (!first || !second) {
          return []
        }

        const center = getSketchLineIntersection(first, second) ?? first.start
        const firstVector = getSketchLineDirectionFromCenter(first, center)
        const secondVector = getSketchLineDirectionFromCenter(second, center)
        const radius = dimension.annotationPlacement?.radius ?? 1
        const side = dimension.annotationPlacement?.side ?? 'minor'
        const start: SketchPoint = [center[0] + firstVector[0] * radius, center[1] + firstVector[1] * radius]
        const end: SketchPoint = [center[0] + secondVector[0] * radius, center[1] + secondVector[1] * radius]
        return [{
          id: `${dimension.dimensionId}-overlay`,
          kind: 'angleArc',
          label: dimension.label,
          center,
          start,
          end,
          radius,
          side,
          witnessLines: createAngleWitnessLines(`${dimension.dimensionId}-overlay`, first, second, start, end),
          labelAnchor: {
            kind: 'sketchPoint',
            point: getSketchAngleLabelPoint(center, firstVector, secondVector, radius, side),
            offset: { x: 12, y: -12 },
          },
        }]
      }
      case 'arcStartPointCoincident':
      case 'arcEndPointCoincident':
        return []
    }
  })
}

export function getSketchMidpoint(first: SketchPoint, second: SketchPoint): SketchPoint {
  return [(first[0] + second[0]) / 2, (first[1] + second[1]) / 2]
}

export function normalizeSketchVector(vector: SketchPoint): SketchPoint {
  const length = Math.hypot(vector[0], vector[1])
  return length <= 1e-6 ? [1, 0] : [vector[0] / length, vector[1] / length]
}

export function projectPointOntoLineSegment(
  line: { start: SketchPoint; end: SketchPoint },
  point: SketchPoint,
): SketchPoint {
  const vector: SketchPoint = [line.end[0] - line.start[0], line.end[1] - line.start[1]]
  const lengthSquared = vector[0] * vector[0] + vector[1] * vector[1]

  if (lengthSquared <= 1e-9) {
    return line.start
  }

  const offset: SketchPoint = [point[0] - line.start[0], point[1] - line.start[1]]
  const ratio = Math.max(
    0,
    Math.min(1, (offset[0] * vector[0] + offset[1] * vector[1]) / lengthSquared),
  )

  return [
    line.start[0] + vector[0] * ratio,
    line.start[1] + vector[1] * ratio,
  ]
}

export function createAngleWitnessLines(
  id: string,
  first: { start: SketchPoint; end: SketchPoint },
  second: { start: SketchPoint; end: SketchPoint },
  start: SketchPoint,
  end: SketchPoint,
) {
  return [
    createAngleWitnessLine(`${id}-witness-a`, first, start),
    createAngleWitnessLine(`${id}-witness-b`, second, end),
  ].filter((line): line is NonNullable<typeof line> => line !== null)
}

export function createAngleWitnessLine(
  id: string,
  line: { start: SketchPoint; end: SketchPoint },
  point: SketchPoint,
) {
  const anchor = projectPointOntoLineSegment(line, point)

  return Math.hypot(point[0] - anchor[0], point[1] - anchor[1]) <= 1e-6
    ? null
    : {
        id,
        label: 'Witness',
        start: anchor,
        end: point,
      }
}

export function getSketchCrossProduct(first: SketchPoint, second: SketchPoint) {
  return first[0] * second[1] - first[1] * second[0]
}

export function getSketchLineIntersection(
  first: { start: SketchPoint; end: SketchPoint },
  second: { start: SketchPoint; end: SketchPoint },
): SketchPoint | null {
  const firstVector: SketchPoint = [first.end[0] - first.start[0], first.end[1] - first.start[1]]
  const secondVector: SketchPoint = [second.end[0] - second.start[0], second.end[1] - second.start[1]]
  const denominator = getSketchCrossProduct(firstVector, secondVector)

  if (Math.abs(denominator) <= 1e-9) {
    return null
  }

  const delta: SketchPoint = [second.start[0] - first.start[0], second.start[1] - first.start[1]]
  const t = getSketchCrossProduct(delta, secondVector) / denominator

  return [
    first.start[0] + firstVector[0] * t,
    first.start[1] + firstVector[1] * t,
  ]
}

export function getSketchLineDirectionFromCenter(
  line: { start: SketchPoint; end: SketchPoint },
  center: SketchPoint,
): SketchPoint {
  const midpoint = getSketchMidpoint(line.start, line.end)
  const towardMidpoint = normalizeSketchVector([midpoint[0] - center[0], midpoint[1] - center[1]])
  const lineUnit = normalizeSketchVector([line.end[0] - line.start[0], line.end[1] - line.start[1]])
  const dot = towardMidpoint[0] * lineUnit[0] + towardMidpoint[1] * lineUnit[1]

  return dot >= 0 ? lineUnit : [-lineUnit[0], -lineUnit[1]]
}

export function normalizeSketchSignedAngleDelta(delta: number) {
  if (delta > Math.PI) {
    return delta - Math.PI * 2
  }

  if (delta < -Math.PI) {
    return delta + Math.PI * 2
  }

  return delta
}

export function normalizeSketchPositiveAngleDelta(delta: number) {
  const normalized = delta % (Math.PI * 2)
  return normalized < 0 ? normalized + Math.PI * 2 : normalized
}

export function getSketchAngleArcSide(input: {
  center: SketchPoint
  startVector: SketchPoint
  endVector: SketchPoint
  point: SketchPoint
}): 'minor' | 'major' {
  const startAngle = Math.atan2(input.startVector[1], input.startVector[0])
  const endAngle = Math.atan2(input.endVector[1], input.endVector[0])
  const pointAngle = Math.atan2(input.point[1] - input.center[1], input.point[0] - input.center[0])
  const minorDelta = normalizeSketchSignedAngleDelta(endAngle - startAngle)
  const minorSweep = Math.abs(minorDelta)

  if (minorSweep <= 1e-9) {
    return 'minor'
  }

  const pointSweep = minorDelta >= 0
    ? normalizeSketchPositiveAngleDelta(pointAngle - startAngle)
    : normalizeSketchPositiveAngleDelta(startAngle - pointAngle)

  return pointSweep <= minorSweep ? 'minor' : 'major'
}

export function getSketchAngleLabelPoint(
  center: SketchPoint,
  firstVector: SketchPoint,
  secondVector: SketchPoint,
  radius: number,
  side: 'minor' | 'major',
): SketchPoint {
  const labelDirection = normalizeSketchVector(
    side === 'major'
      ? [-(firstVector[0] + secondVector[0]), -(firstVector[1] + secondVector[1])]
      : [firstVector[0] + secondVector[0], firstVector[1] + secondVector[1]],
  )

  return [
    center[0] + labelDirection[0] * radius,
    center[1] + labelDirection[1] * radius,
  ]
}

export function getPointPairAnnotationPlacementFromPoint(
  first: SketchPoint,
  second: SketchPoint,
  axis: 'aligned' | 'horizontal' | 'vertical',
  point: SketchPoint,
): DimensionAnnotationPlacement {
  if (axis === 'horizontal') {
    return { kind: 'dimensionLine', offset: point[1] - first[1] }
  }

  if (axis === 'vertical') {
    return { kind: 'dimensionLine', offset: point[0] - first[0] }
  }

  const axisVector = normalizeSketchVector([second[0] - first[0], second[1] - first[1]])
  const normal: SketchPoint = [-axisVector[1], axisVector[0]]
  return {
    kind: 'dimensionLine',
    offset: (point[0] - first[0]) * normal[0] + (point[1] - first[1]) * normal[1],
  }
}

export function getLineAnnotationPlacementFromPoint(
  line: { start: SketchPoint; end: SketchPoint },
  point: SketchPoint,
): DimensionAnnotationPlacement {
  return {
    kind: 'dimensionLine',
    offset: getSketchLineSignedDistance(point, line),
  }
}

export function getSketchLineSignedDistance(
  point: SketchPoint,
  line: { start: SketchPoint; end: SketchPoint },
) {
  const axisVector = normalizeSketchVector([line.end[0] - line.start[0], line.end[1] - line.start[1]])
  const normal: SketchPoint = [-axisVector[1], axisVector[0]]
  return (point[0] - line.start[0]) * normal[0] + (point[1] - line.start[1]) * normal[1]
}

export function getLineSegmentGeometry(definition: SketchDefinition, entityId: SketchEntityId): { start: SketchPoint; end: SketchPoint } | null {
  const entity = definition.entities.find((candidate) => candidate.entityId === entityId)
  if (!entity || entity.kind !== 'lineSegment') {
    return null
  }

  const start = getPointPosition(definition, entity.startPointId)
  const end = getPointPosition(definition, entity.endPointId)
  return start && end ? { start, end } : null
}

export function getCircleLikeGeometry(definition: SketchDefinition, entityId: SketchEntityId): { center: SketchPoint; radius: number } | null {
  const entity = definition.entities.find((candidate) => candidate.entityId === entityId)
  if (!entity || (entity.kind !== 'circle' && entity.kind !== 'arc')) {
    return null
  }

  const center = getPointPosition(definition, entity.centerPointId)
  if (!center) {
    return null
  }

  if (entity.kind === 'circle') {
    return { center, radius: entity.radius }
  }

  const start = getPointPosition(definition, entity.startPointId)
  return start ? { center, radius: Math.hypot(start[0] - center[0], start[1] - center[1]) } : null
}

export function createPlacedPointDimensionLine(
  first: SketchPoint,
  second: SketchPoint,
  axis: 'aligned' | 'horizontal' | 'vertical',
  placement: DimensionAnnotationPlacement | undefined,
): { start: SketchPoint; end: SketchPoint } {
  if (axis === 'horizontal') {
    const y = first[1] + (placement?.kind === 'dimensionLine' ? placement.offset : -1)
    return { start: [first[0], y], end: [second[0], y] }
  }

  if (axis === 'vertical') {
    const x = first[0] + (placement?.kind === 'dimensionLine' ? placement.offset : 1)
    return { start: [x, first[1]], end: [x, second[1]] }
  }

  const axisVector = normalizeSketchVector([second[0] - first[0], second[1] - first[1]])
  const normal: SketchPoint = [-axisVector[1], axisVector[0]]
  const offset = placement?.kind === 'dimensionLine' ? placement.offset : 0
  return {
    start: [first[0] + normal[0] * offset, first[1] + normal[1] * offset],
    end: [second[0] + normal[0] * offset, second[1] + normal[1] * offset],
  }
}

export function createPlacedLineDistance(
  line: { start: SketchPoint; end: SketchPoint },
  point: SketchPoint,
  placement: DimensionAnnotationPlacement | undefined,
): { start: SketchPoint; end: SketchPoint } {
  const axisVector = normalizeSketchVector([line.end[0] - line.start[0], line.end[1] - line.start[1]])
  const normal: SketchPoint = [-axisVector[1], axisVector[0]]
  const signedDistance = (point[0] - line.start[0]) * normal[0] + (point[1] - line.start[1]) * normal[1]
  const offset = placement?.kind === 'dimensionLine' ? placement.offset : signedDistance
  const projected: SketchPoint = [point[0] - normal[0] * signedDistance, point[1] - normal[1] * signedDistance]
  return {
    start: [projected[0] + normal[0] * offset, projected[1] + normal[1] * offset],
    end: [point[0] + normal[0] * (offset - signedDistance), point[1] + normal[1] * (offset - signedDistance)],
  }
}

export function createPlacedLineLength(
  line: { start: SketchPoint; end: SketchPoint },
  placement: DimensionAnnotationPlacement | undefined,
): { start: SketchPoint; end: SketchPoint; offset: number } {
  const axisVector = normalizeSketchVector([line.end[0] - line.start[0], line.end[1] - line.start[1]])
  const normal: SketchPoint = [-axisVector[1], axisVector[0]]
  const offset = placement?.kind === 'dimensionLine' ? placement.offset : 0

  return {
    start: [line.start[0] + normal[0] * offset, line.start[1] + normal[1] * offset],
    end: [line.end[0] + normal[0] * offset, line.end[1] + normal[1] * offset],
    offset,
  }
}

export function createOffsetAnnotationAnchor(
  point: SketchPoint | null,
  offset = { x: 18, y: -18 },
): SketchToolAnchorDescriptor {
  return {
    kind: 'sketchPoint',
    point: point ?? [0, 0],
    offset,
  }
}

export function createProjectedPrimitiveRef(
  reference: ProjectedSketchGeometryRef & { kind: NonNullable<ProjectedSketchGeometryRef['kind']> },
): PrimitiveRef {
  return {
    kind: 'projectedReferenceGeometry',
    referenceId: reference.referenceId,
    geometryId: reference.geometryId,
    geometryKind: reference.kind === 'projectedPoint'
      ? 'point'
      : reference.kind === 'projectedLineSegment'
        ? 'lineSegment'
        : reference.kind === 'projectedCircle'
          ? 'circle'
          : reference.kind === 'projectedArc'
            ? 'arc'
            : 'spline',
  }
}

export function createReferencePrimitiveRef(
  operand: {
    kind: string
    reference?: ProjectedSketchGeometryRef & { kind: NonNullable<ProjectedSketchGeometryRef['kind']> }
    datum?: 'origin' | 'xAxis' | 'yAxis'
  },
  sketchId: SketchId,
): PrimitiveRef | null {
  if (operand.kind === 'projectedGeometry' && operand.reference) {
    return createProjectedPrimitiveRef(operand.reference)
  }

  if (operand.kind === 'sketchDatum' && operand.datum) {
    return {
      kind: 'sketchDatumReference',
      sketchId,
      datumId: operand.datum,
      geometryKind: operand.datum === 'origin' ? 'point' : 'lineSegment',
    }
  }

  return null
}

export function getDatumAnchor(datum: 'origin' | 'xAxis' | 'yAxis'): SketchPoint {
  switch (datum) {
    case 'origin':
      return [0, 0]
    case 'xAxis':
    case 'yAxis':
      return [0, 0]
  }
}

export function getProjectedGeometryAnchor(
  session: SketchSessionState,
  reference: ProjectedSketchGeometryRef & { kind: NonNullable<ProjectedSketchGeometryRef['kind']> },
): SketchPoint | null {
  const projectedReference = session.projectedReferences.find((entry) => entry.referenceId === reference.referenceId)

  if (!projectedReference || projectedReference.status !== 'projected') {
    return null
  }

  const geometry = projectedReference.geometry.find((entry) => entry.geometryId === reference.geometryId)

  if (!geometry) {
    return null
  }

  switch (geometry.kind) {
    case 'point':
      return geometry.position
    case 'lineSegment':
      return [
        (geometry.startPosition[0] + geometry.endPosition[0]) / 2,
        (geometry.startPosition[1] + geometry.endPosition[1]) / 2,
      ]
    case 'circle':
    case 'arc':
      return geometry.centerPosition
    case 'spline':
      return geometry.fitPoints[0] ?? null
  }
}

export function getReferenceGeometryAnchor(
  session: SketchSessionState,
  operand: {
    kind: string
    reference?: ProjectedSketchGeometryRef & { kind: NonNullable<ProjectedSketchGeometryRef['kind']> }
    datum?: 'origin' | 'xAxis' | 'yAxis'
  },
): SketchPoint | null {
  if (operand.kind === 'projectedGeometry' && operand.reference) {
    return getProjectedGeometryAnchor(session, operand.reference)
  }

  if (operand.kind === 'sketchDatum' && operand.datum) {
    return getDatumAnchor(operand.datum)
  }

  return null
}

export function getReferenceLineGeometry(
  definition: SketchDefinition,
  session: SketchSessionState,
  operand: {
    kind: string
    entityId?: SketchEntityId
    reference?: ProjectedSketchGeometryRef & { kind: NonNullable<ProjectedSketchGeometryRef['kind']> }
    datum?: 'origin' | 'xAxis' | 'yAxis'
  },
): { start: SketchPoint; end: SketchPoint } | null {
  if (operand.kind === 'localEntity' && operand.entityId) {
    return getLineSegmentGeometry(definition, operand.entityId)
  }

  if (operand.kind === 'projectedGeometry' && operand.reference) {
    const reference = operand.reference
    const projectedReference = session.projectedReferences.find((entry) => entry.referenceId === reference.referenceId)
    const geometry = projectedReference?.geometry.find((entry) => entry.geometryId === reference.geometryId)
    return geometry?.kind === 'lineSegment'
      ? { start: geometry.startPosition, end: geometry.endPosition }
      : null
  }

  if (operand.kind === 'sketchDatum' && operand.datum && operand.datum !== 'origin') {
    const extent = getSketchDatumGuideExtent(definition, session.projectedReferences)
    return operand.datum === 'xAxis'
      ? { start: [-extent, 0], end: [extent, 0] }
      : { start: [0, -extent], end: [0, extent] }
  }

  return null
}

export function getReferencePointGeometry(
  definition: SketchDefinition,
  session: SketchSessionState,
  operand: {
    kind: string
    pointId?: SketchPointId
    reference?: ProjectedSketchGeometryRef & { kind: NonNullable<ProjectedSketchGeometryRef['kind']> }
    datum?: 'origin' | 'xAxis' | 'yAxis'
  },
): SketchPoint | null {
  if (operand.kind === 'localPoint' && operand.pointId) {
    return getPointPosition(definition, operand.pointId)
  }

  return getReferenceGeometryAnchor(session, operand)
}

export function getPointPosition(definition: SketchDefinition, pointId: SketchPointId): SketchPoint | null {
  return definition.points.find((point) => point.pointId === pointId)?.position ?? null
}

export function getAveragePointPosition(
  definition: SketchDefinition,
  pointIds: readonly SketchPointId[],
): SketchPoint | null {
  const points = pointIds.flatMap((pointId) => {
    const position = getPointPosition(definition, pointId)
    return position ? [position] : []
  })

  return getAverageSketchPoint(points)
}

export function getAverageEntityAnchor(
  definition: SketchDefinition,
  entityIds: readonly SketchEntityId[],
): SketchPoint | null {
  const points = entityIds.flatMap((entityId) => {
    const position = getEntityAnchor(definition, entityId)
    return position ? [position] : []
  })

  return getAverageSketchPoint(points)
}

export function getEntityAnchor(definition: SketchDefinition, entityId: SketchEntityId): SketchPoint | null {
  const entity = definition.entities.find((entry) => entry.entityId === entityId)

  if (!entity) {
    return null
  }

  switch (entity.kind) {
    case 'lineSegment':
      return getAveragePointPosition(definition, [entity.startPointId, entity.endPointId])
    case 'point':
      return getPointPosition(definition, entity.pointId)
    case 'circle':
      return getPointPosition(definition, entity.centerPointId)
    case 'arc':
      return getPointPosition(definition, entity.centerPointId)
    case 'spline':
      return getAveragePointPosition(definition, entity.fitPointIds)
    case 'ellipse':
      return getPointPosition(definition, entity.centerPointId)
    case 'ellipticalArc':
      return getPointPosition(definition, entity.centerPointId)
    case 'conic':
      return getAveragePointPosition(definition, [entity.startPointId, entity.controlPointId, entity.endPointId])
    case 'bezierCurve':
      return getAveragePointPosition(definition, entity.controlPointIds)
    case 'profileText':
      return getPointPosition(definition, entity.anchorPointId)
  }
}

export function getEntityAnchorPointId(
  definition: SketchDefinition,
  entityId: SketchEntityId,
): SketchPointId | null {
  const entity = definition.entities.find((entry) => entry.entityId === entityId)

  if (!entity) {
    return null
  }

  switch (entity.kind) {
    case 'lineSegment':
      return entity.startPointId
    case 'point':
      return entity.pointId
    case 'circle':
    case 'arc':
      return entity.centerPointId
    case 'spline':
      return entity.fitPointIds[0] ?? null
    case 'ellipse':
    case 'ellipticalArc':
      return entity.centerPointId
    case 'conic':
      return entity.startPointId
    case 'bezierCurve':
      return entity.controlPointIds[0] ?? null
    case 'profileText':
      return entity.anchorPointId
  }
}

export function getAverageSketchPoint(points: readonly SketchPoint[]): SketchPoint | null {
  if (points.length === 0) {
    return null
  }

  return [
    points.reduce((sum, point) => sum + point[0], 0) / points.length,
    points.reduce((sum, point) => sum + point[1], 0) / points.length,
  ]
}

export function describeConstraint(constraint: ConstraintDefinition) {
  switch (constraint.kind) {
    case 'coincident':
      return 'Coincident points'
    case 'parallel':
      return 'Parallel lines'
    case 'equalLength':
      return 'Equal-length lines'
    case 'horizontal':
      return 'Horizontal line'
    case 'vertical':
      return 'Vertical line'
    case 'fixPoint':
      return 'Fixed point'
    case 'angle':
      return `${(constraint.valueRadians * 180 / Math.PI).toFixed(1)} deg`
    case 'perpendicular':
      return 'Perpendicular lines'
    case 'midpoint':
      return 'Point at midpoint'
    case 'midpointProjectedLine':
      return 'Point at projected midpoint'
    case 'pointOnCurve':
      return 'Point on curve'
    case 'coincidentProjectedPoint':
      return 'Coincident projected point'
    case 'pointOnProjectedCurve':
      return 'Point on projected curve'
    case 'parallelProjectedLine':
      return 'Parallel to projected line'
    case 'perpendicularProjectedLine':
      return 'Perpendicular to projected line'
    case 'tangentProjectedCurve':
      return 'Tangent to projected curve'
    case 'tangent':
      return 'Tangent curves'
    case 'concentric':
      return 'Concentric curves'
    case 'concentricProjectedCurve':
      return 'Concentric with projected curve'
    case 'normal':
      return 'Line normal to curve'
    case 'normalProjectedCurve':
      return 'Line normal to projected curve'
    case 'symmetric':
      return 'Symmetric points'
    case 'symmetricProjectedLine':
      return 'Symmetric points about projected line'
  }
}

export function describeDimension(dimension: DimensionDefinition) {
  switch (dimension.kind) {
    case 'distance':
    case 'pointDatumDistance':
      return `${dimension.value.toFixed(2)} mm distance`
    case 'horizontalDistance':
    case 'verticalDistance':
      return `${dimension.value.toFixed(2)} mm distance`
    case 'circleRadius':
      return `${dimension.value.toFixed(2)} mm radius`
    case 'diameter':
      return `${dimension.value.toFixed(2)} mm diameter`
    case 'lineLength':
      return `${dimension.value.toFixed(2)} mm length`
    case 'lineDistance':
    case 'linePointDistance':
      return `${dimension.value.toFixed(2)} mm distance`
    case 'lineAngle':
      return `${(dimension.valueRadians * 180 / Math.PI).toFixed(1)} deg angle`
    case 'arcStartPointCoincident':
      return 'Arc start coincident'
    case 'arcEndPointCoincident':
      return 'Arc end coincident'
  }
}

export function formatDimensionVisibleLabel(dimension: DimensionDefinition) {
  switch (dimension.kind) {
    case 'distance':
    case 'pointDatumDistance':
    case 'horizontalDistance':
    case 'verticalDistance':
    case 'circleRadius':
    case 'diameter':
    case 'lineLength':
    case 'lineDistance':
    case 'linePointDistance':
      return dimension.value.toFixed(2)
    case 'lineAngle':
      return `${(dimension.valueRadians * 180 / Math.PI).toFixed(1)}°`
    case 'arcStartPointCoincident':
    case 'arcEndPointCoincident':
      return 'Coincident'
  }
}

