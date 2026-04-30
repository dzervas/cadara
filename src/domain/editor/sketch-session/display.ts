import type { SketchPoint } from '@/contracts/modeling/schema'
import type { ReferenceImageOperationState } from '@/contracts/reference-image/schema'
import type {
  ReferenceId,
  RenderableId,
  SketchEntityId,
  SketchId,
  SketchPointId,
} from '@/contracts/shared/ids'
import type {
  RegionLoopRecord,
  RegionRecord,
  SketchAuthoringOperation,
  SketchDefinition,
  SketchEntityDefinition,
  SketchStyleDefinition,
  SketchStyleRecord,
} from '@/contracts/sketch/schema'
import {
  solveSketchDefinitionCore,
} from '@/contracts/sketch/solver-core'
import type { ProjectedSketchReferenceRecord } from '@/contracts/solver/schema'
import type { PrimitiveRef } from '@/domain/editor/schema'
import {
  solveReferenceImageOperationState,
} from '@/domain/reference-image-calibration/state'
import {
  collectActiveReferenceImageOperations,
  createReferenceImageOperationTarget,
} from '@/domain/reference-image/operations'
import {
  createReferenceImageTextureSourceKey,
  getReferenceImageCornerPoints,
} from '@/domain/reference-image/rendering'
import type { SketchDraftEntity } from '@/domain/sketch-tools/definition'
import {
  ShapeUtils,
  Vector2,
} from 'three'
import type {
  SketchConstraintDisplaySummary,
  SketchDisplayPaintStyle,
  SketchDisplayStrokeStyle,
  SketchSessionDisplayRenderable,
  SketchSessionState,
} from './types'
import {
  REFERENCE_IMAGE_ANCHOR_MARKER_COLOR,
  REFERENCE_IMAGE_ANCHOR_MARKER_RADIUS,
  REFERENCE_IMAGE_ANCHOR_OVERLAY_RADIUS,
  SKETCH_DIRECT_EDIT_TOLERANCES,
  collectVisibleReferenceImageAnchorLabels,
  collectVisibleReferenceImageAnchorPointIds,
  createSketchEntityRef,
  createSketchPointRef,
  getDefinitionSketchId,
  getReferenceImageOperationOverrides,
  getSketchSessionDisplayDefinition,
  getSketchSessionDisplayProjectedReferences,
  mapDefinitionEntityToDraftEntity,
} from './internals'
import {
  deriveSketchDisplayEntities,
  mapSketchPointToWorld,
} from './state'
import {
  getSketchConstraintDisplayForTarget,
  getSketchConstraintDisplaySummary,
} from './annotation-display'
import {
  getSketchDatumGuideExtent,
} from './definition-patches'
import {
  isSketchSvgRenderingEnabled,
} from './styles'

export function sampleSplinePoints(points: readonly SketchPoint[]): SketchPoint[] {
  if (points.length < 3) {
    return [...points]
  }

  const [start, control, end] = points
  return Array.from({ length: 25 }, (_, index) => {
    const t = index / 24
    const oneMinusT = 1 - t
    return [
      oneMinusT * oneMinusT * start![0] + 2 * oneMinusT * t * control![0] + t * t * end![0],
      oneMinusT * oneMinusT * start![1] + 2 * oneMinusT * t * control![1] + t * t * end![1],
    ] as const
  })
}

export function sketchSessionHasReferenceImage(session: SketchSessionState): boolean {
  return collectActiveReferenceImageOperations(session.definition).length > 0
}

export function getSketchSessionDisplayRenderables(session: SketchSessionState): SketchSessionDisplayRenderable[] {
  const sketchId = session.sketchId ?? ('sketch_draft' as SketchId)
  const svgRenderingEnabled = isSketchSvgRenderingEnabled(session)
  const localStyleLookup = svgRenderingEnabled ? createSketchEntityStyleLookup(session) : new Map<SketchEntityId, SketchEntityDisplayStyle>()
  const pointStyleLookup = svgRenderingEnabled ? createSketchPointStyleLookup(session) : new Map<SketchPointId, SketchEntityDisplayStyle>()
  const regionStyleLookup = svgRenderingEnabled ? createSketchRegionStyleLookup(session) : new Map<RegionRecord['regionId'], SketchEntityDisplayStyle>()
  const displayDefinition = getSketchSessionDisplayDefinition(session)
  const displayProjectedReferences = getSketchSessionDisplayProjectedReferences(session, displayDefinition)
  const datumGuideExtent = getSketchDatumGuideExtent(displayDefinition, displayProjectedReferences)
  const referenceImageOperationOverrides = getReferenceImageOperationOverrides(session)
  const visibleReferenceImageAnchorPointIds = collectVisibleReferenceImageAnchorPointIds(
    displayDefinition,
    referenceImageOperationOverrides,
  )
  const visibleReferenceImageAnchorLabels = collectVisibleReferenceImageAnchorLabels(
    displayDefinition,
    referenceImageOperationOverrides,
  )
  const solved = solveSketchDefinitionCore({
    definition: displayDefinition,
    projectedReferences: displayProjectedReferences,
    tolerances: SKETCH_DIRECT_EDIT_TOLERANCES,
    partialSolvePolicy: 'bestEffort',
  })
  const constraintDisplaySummary = getSketchConstraintDisplaySummary({
    sketchId,
    definition: displayDefinition,
    solvedSnapshot: solved.solvedSnapshot,
  })
  const solvedPointPositionsById = new Map(
    solved.solvedSnapshot.solvedPoints.map((point) => [point.pointId, point.solvedPosition] as const),
  )
  const regionRenderables = session.solvedRegions.flatMap((region, index) => {
    const renderable = createDisplayRenderableForRegion(session, displayDefinition, region, index, regionStyleLookup.get(region.regionId))
    return renderable
      ? [withSketchConstraintDisplay(renderable, constraintDisplaySummary)]
      : []
  })
  const pointRenderables = displayDefinition.points.map((point) => {
    const style = pointStyleLookup.get(point.pointId)
    const isVisibleReferenceImageAnchor = visibleReferenceImageAnchorPointIds.has(point.pointId)
    const referenceImageAnchorStyle = isVisibleReferenceImageAnchor
      ? {
          paintStyle: { color: REFERENCE_IMAGE_ANCHOR_MARKER_COLOR, opacity: 1 } satisfies SketchDisplayPaintStyle,
          strokeStyle: { color: REFERENCE_IMAGE_ANCHOR_MARKER_COLOR, opacity: 1 } satisfies SketchDisplayStrokeStyle,
        }
      : null

    return withSketchConstraintDisplay({
      id: `renderable_sketch_point_${point.pointId}` as RenderableId,
      label: point.label,
      target: createSketchPointRef(sketchId, point.pointId),
      geometry: {
        kind: 'marker' as const,
        position: mapSketchPointToWorld(session.plane, point.position),
        displayRadius: isVisibleReferenceImageAnchor ? REFERENCE_IMAGE_ANCHOR_MARKER_RADIUS : 0.16,
      },
      linePattern: 'solid' as const,
      role: 'local' as const,
      paintStyle: style?.paintStyle ?? referenceImageAnchorStyle?.paintStyle,
      strokeStyle: style?.strokeStyle ?? referenceImageAnchorStyle?.strokeStyle,
    }, constraintDisplaySummary)
  })
  const referenceImageAnchorOverlayRenderables = displayDefinition.points.flatMap((point) => {
    if (!visibleReferenceImageAnchorPointIds.has(point.pointId)) {
      return []
    }

    return [withSketchConstraintDisplay({
      id: `renderable_reference_image_anchor_overlay_${point.pointId}` as RenderableId,
      label: visibleReferenceImageAnchorLabels.get(point.pointId) ?? point.label,
      target: createSketchPointRef(sketchId, point.pointId),
      geometry: {
        kind: 'marker' as const,
        position: mapSketchPointToWorld(session.plane, point.position),
        displayRadius: REFERENCE_IMAGE_ANCHOR_OVERLAY_RADIUS,
      },
      linePattern: 'solid' as const,
      role: 'local' as const,
      markerLayer: 'overlay' as const,
      paintStyle: { color: REFERENCE_IMAGE_ANCHOR_MARKER_COLOR, opacity: 1 },
      strokeStyle: { color: REFERENCE_IMAGE_ANCHOR_MARKER_COLOR, opacity: 1 },
    }, constraintDisplaySummary)]
  })
  const referenceImageRenderables = collectActiveReferenceImageOperations(
    displayDefinition,
    referenceImageOperationOverrides,
  ).map(({ operation, state }, index) =>
    createDisplayRenderableForReferenceImageOperation(
      session,
      operation,
      hasSolvedReferenceImageCalibration(state)
        ? state
        : solveReferenceImageOperationState(state, { pointPositionsById: solvedPointPositionsById }),
      index,
    ),
  )
  const entityRenderables = deriveSketchDisplayEntities(session).map((entity, index) =>
    withSketchConstraintDisplay(
      createDisplayRenderableForEntity(
        session,
        entity,
        index,
        entity.entityId ? localStyleLookup.get(entity.entityId) : undefined,
      ),
      constraintDisplaySummary,
    ),
  )

  return [
    ...regionRenderables,
    ...referenceImageRenderables,
    createDisplayRenderableForSketchDatum(session, sketchId, 'origin', datumGuideExtent),
    createDisplayRenderableForSketchDatum(session, sketchId, 'xAxis', datumGuideExtent),
    createDisplayRenderableForSketchDatum(session, sketchId, 'yAxis', datumGuideExtent),
    ...pointRenderables,
    ...referenceImageAnchorOverlayRenderables,
    ...entityRenderables,
    ...entityRenderables.flatMap(createOverconstraintDiagnosticRenderable),
    ...displayDefinition.references.flatMap((reference, index) => {
      if (reference.kind === 'referenceImageAnchor') {
        return []
      }

      const projectedReference = displayProjectedReferences.find((entry) => entry.referenceId === reference.referenceId)
      if (projectedReference && projectedReference.status === 'projected' && projectedReference.geometry.length > 0) {
        return []
      }

      return [createDisplayRenderableForReferenceRecord(session, reference.referenceId, index)]
    }),
    ...displayProjectedReferences
      .filter((reference) => shouldRenderProjectedReference(session, displayDefinition, reference.referenceId))
      .flatMap((reference) =>
      reference.geometry.map((geometry, index) =>
        createDisplayRenderableForProjectedGeometry(session, reference.referenceId, geometry, index),
      ),
      ),
  ]
}

export function shouldRenderProjectedReference(
  session: SketchSessionState,
  definition: SketchDefinition,
  referenceId: ReferenceId,
) {
  void session
  void definition
  void referenceId
  return true
}

export function withSketchConstraintDisplay(
  renderable: SketchSessionDisplayRenderable,
  summary: SketchConstraintDisplaySummary,
): SketchSessionDisplayRenderable {
  if (renderable.role === 'reference') {
    return renderable
  }

  return {
    ...renderable,
    constraintDisplay: getSketchConstraintDisplayForTarget(renderable.target, summary),
  }
}

export function createOverconstraintDiagnosticRenderable(
  renderable: SketchSessionDisplayRenderable,
): SketchSessionDisplayRenderable[] {
  if (
    renderable.geometry.kind !== 'polyline'
    || renderable.role !== 'local'
    || renderable.target?.kind !== 'sketchEntity'
    || !renderable.constraintDisplay?.isAffectedOverconstraint
  ) {
    return []
  }

  return [{
    ...renderable,
    id: `${renderable.id}_overconstraint_diagnostic` as RenderableId,
    label: `${renderable.label} overconstraint diagnostic`,
    linePattern: 'solid',
    paintStyle: undefined,
    strokeStyle: undefined,
    diagnosticStyle: { kind: 'overconstraint' },
  }]
}

export function createDisplayRenderableForRegion(
  session: SketchSessionState,
  definition: SketchDefinition,
  region: RegionRecord,
  index: number,
  style: SketchEntityDisplayStyle | undefined,
): SketchSessionDisplayRenderable | null {
  const triangulated = triangulateSketchRegionLoops(definition, region)
  if (!triangulated) {
    return null
  }

  return {
    id: `renderable_sketch_region_${region.regionId}_${index}` as RenderableId,
    label: region.label,
    target: region.target,
    geometry: {
      kind: 'mesh',
      vertexPositions: triangulated.points.map((point) => mapSketchPointToWorld(session.plane, point)),
      vertexNormals: triangulated.points.map(() => session.plane.frame.normal),
      triangleIndices: triangulated.triangleIndices,
    },
    linePattern: 'solid',
    role: 'local',
    semanticClass: 'region',
    paintStyle: style?.paintStyle,
    strokeStyle: style?.strokeStyle,
  }
}

export function triangulateSketchRegionLoops(
  definition: SketchDefinition,
  region: RegionRecord,
): { points: SketchPoint[]; triangleIndices: Array<readonly [number, number, number]> } | null {
  const outerLoop = region.loops.find((loop) => loop.role === 'outer')
  if (!outerLoop) {
    return null
  }

  const outerPoints = orientSketchLoopPoints(
    normalizeClosedSketchLoopPoints(getRegionLoopSketchPoints(definition, outerLoop)),
    'counterClockwise',
  )
  if (outerPoints.length < 3) {
    return null
  }

  const innerLoops = region.loops.filter((loop) => loop.role === 'inner')
  const innerPoints = innerLoops.map((loop) =>
    orientSketchLoopPoints(
      normalizeClosedSketchLoopPoints(getRegionLoopSketchPoints(definition, loop)),
      'clockwise',
    ),
  )
  if (innerPoints.some((points) => points.length < 3)) {
    return null
  }

  const triangleIndices = ShapeUtils.triangulateShape(
    outerPoints.map(pointToVector2),
    innerPoints.map((loop) => loop.map(pointToVector2)),
  ).map((triangle) => [triangle[0]!, triangle[1]!, triangle[2]!] as const)

  if (triangleIndices.length === 0) {
    return null
  }

  return {
    points: [outerPoints, ...innerPoints].flat(),
    triangleIndices,
  }
}

export function pointToVector2(point: SketchPoint) {
  return new Vector2(point[0], point[1])
}

export function orientSketchLoopPoints(points: SketchPoint[], orientation: 'clockwise' | 'counterClockwise') {
  const isClockwise = getSketchLoopSignedArea(points) < 0
  const shouldBeClockwise = orientation === 'clockwise'
  return shouldBeClockwise === isClockwise ? points : [...points].reverse()
}

export function normalizeClosedSketchLoopPoints(points: readonly SketchPoint[]): SketchPoint[] {
  if (points.length < 2) {
    return [...points]
  }

  const first = points[0]
  const last = points[points.length - 1]
  if (
    first
    && last
    && Math.hypot(first[0] - last[0], first[1] - last[1]) <= 1e-9
  ) {
    return points.slice(0, -1)
  }

  return [...points]
}

export function getRegionLoopSketchPoints(
  definition: SketchDefinition,
  loop: RegionLoopRecord,
): SketchPoint[] {
  if (loop.boundaryPointIds.length >= 3) {
    const pointById = new Map(definition.points.map((point) => [point.pointId, point.position] as const))
    return loop.boundaryPointIds.flatMap((pointId) => {
      const position = pointById.get(pointId)
      return position ? [position] : []
    })
  }

  if (loop.segments.length !== 1) {
    return []
  }

  const source = loop.segments[0]?.source
  if (!source || source.kind !== 'entity') {
    return []
  }

  return getClosedEntityLoopPoints(definition, source.entityId)
}

export function getClosedEntityLoopPoints(
  definition: SketchDefinition,
  entityId: SketchEntityId,
): SketchPoint[] {
  const entity = definition.entities.find((entry) => entry.entityId === entityId)
  if (!entity) {
    return []
  }

  const draftEntity = mapDefinitionEntityToDraftEntity(getDefinitionSketchId(definition), definition.points, entity)[0]
  if (!draftEntity) {
    return []
  }

  if (draftEntity.kind === 'circle') {
    const pointCount = 48
    return Array.from({ length: pointCount }, (_, pointIndex) => {
      const angle = (Math.PI * 2 * pointIndex) / pointCount
      return [
        draftEntity.center[0] + Math.cos(angle) * draftEntity.radius,
        draftEntity.center[1] + Math.sin(angle) * draftEntity.radius,
      ] as const
    })
  }

  if (draftEntity.kind === 'polyline' && draftEntity.isClosed) {
    return [...draftEntity.points]
  }

  return []
}

export function getSketchLoopSignedArea(points: readonly SketchPoint[]) {
  let area = 0
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!
    const next = points[(index + 1) % points.length]!
    area += current[0] * next[1] - next[0] * current[1]
  }
  return area / 2
}

export function createDisplayRenderableForEntity(
  session: SketchSessionState,
  entity: SketchDraftEntity,
  index: number,
  style: SketchEntityDisplayStyle | undefined,
): SketchSessionDisplayRenderable {
  if (entity.kind === 'line') {
    return {
      id: `renderable_sketch_line_${index}` as RenderableId,
      label: entity.label,
      target: entity.entityId
        ? createSketchEntityRef(session.sketchId ?? ('sketch_draft' as SketchId), entity.entityId)
        : null,
      geometry: {
        kind: 'polyline',
        points: [
          mapSketchPointToWorld(session.plane, entity.start),
          mapSketchPointToWorld(session.plane, entity.end),
        ],
        isClosed: false,
      },
      linePattern: entity.isConstruction ? 'dashed' : 'solid',
      role: 'local',
      paintStyle: style?.paintStyle,
      strokeStyle: style?.strokeStyle,
    }
  }

  if (entity.kind === 'spline') {
    return {
      id: `renderable_sketch_spline_${index}` as RenderableId,
      label: entity.label,
      target: entity.entityId
        ? createSketchEntityRef(session.sketchId ?? ('sketch_draft' as SketchId), entity.entityId)
        : null,
      geometry: {
        kind: 'polyline',
        points: sampleSplinePoints(entity.points).map((point) => mapSketchPointToWorld(session.plane, point)),
        isClosed: false,
      },
      linePattern: entity.isConstruction ? 'dashed' : 'solid',
      role: 'local',
      paintStyle: style?.paintStyle,
      strokeStyle: style?.strokeStyle,
    }
  }

  if (entity.kind === 'polyline') {
    return {
      id: `renderable_sketch_polyline_${index}` as RenderableId,
      label: entity.label,
      target: entity.entityId
        ? createSketchEntityRef(session.sketchId ?? ('sketch_draft' as SketchId), entity.entityId)
        : null,
      geometry: {
        kind: 'polyline',
        points: entity.points.map((point) => mapSketchPointToWorld(session.plane, point)),
        isClosed: entity.isClosed,
      },
      linePattern: entity.isConstruction ? 'dashed' : 'solid',
      role: 'local',
      paintStyle: style?.paintStyle,
      strokeStyle: style?.strokeStyle,
    }
  }

  const pointCount = 48
  const points = Array.from({ length: pointCount + 1 }, (_, pointIndex) => {
    const angle = (Math.PI * 2 * pointIndex) / pointCount
    return mapSketchPointToWorld(session.plane, [
      entity.center[0] + Math.cos(angle) * entity.radius,
      entity.center[1] + Math.sin(angle) * entity.radius,
    ])
  })

  return {
    id: `renderable_sketch_circle_${index}` as RenderableId,
    label: entity.label,
    target: entity.entityId
      ? createSketchEntityRef(session.sketchId ?? ('sketch_draft' as SketchId), entity.entityId)
      : null,
    geometry: {
      kind: 'polyline',
      points,
      isClosed: true,
    },
    linePattern: entity.isConstruction ? 'dashed' : 'solid',
    role: 'local',
    paintStyle: style?.paintStyle,
    strokeStyle: style?.strokeStyle,
  }
}

export function createDisplayRenderableForReferenceImageOperation(
  session: SketchSessionState,
  operation: SketchAuthoringOperation,
  state: NonNullable<SketchAuthoringOperation['ownedState']>,
  index: number,
): SketchSessionDisplayRenderable {
  const corners = getReferenceImageCornerPoints(state).map((point) => mapSketchPointToWorld(session.plane, point))

  return {
    id: `renderable_sketch_reference_image_${index}` as RenderableId,
    label: operation.label,
    target: createReferenceImageOperationTarget(
      session.sketchId ?? ('sketch_draft' as SketchId),
      operation.operationId,
    ),
    geometry: {
      kind: 'mesh',
      vertexPositions: corners,
      vertexNormals: corners.map(() => session.plane.frame.normal),
      triangleIndices: [[0, 1, 2], [0, 2, 3]],
    },
    linePattern: 'solid',
    role: 'local',
    semanticClass: 'sketchImage',
    textureFill: {
      kind: 'inlineImage',
      sourceKey: createReferenceImageTextureSourceKey({
        operationId: operation.operationId,
        state,
      }),
      mediaType: state.image.mediaType,
      base64Data: state.image.base64Data,
      uvCoordinates: [
        [0, 1],
        [1, 1],
        [1, 0],
        [0, 0],
      ],
      opacity: 0.55,
    },
  }
}

export function hasSolvedReferenceImageCalibration(
  state: ReferenceImageOperationState,
): state is ReturnType<typeof solveReferenceImageOperationState> {
  return typeof state.calibration === 'object'
    && state.calibration !== null
    && 'solveResult' in state.calibration
}

export interface SketchEntityDisplayStyle {
  paintStyle?: SketchDisplayPaintStyle
  strokeStyle?: SketchDisplayStrokeStyle
}

export function createSketchEntityStyleLookup(session: SketchSessionState): Map<SketchEntityId, SketchEntityDisplayStyle> {
  const styleRecords = getPersistedSketchStyleRecords(session.fullDefinition)
  const entityStyleById = new Map<SketchEntityId, SketchEntityDisplayStyle>()
  for (const entity of session.fullDefinition.entities) {
    const localStyle = parseSketchStyleDefinition(entity.style)
    const styleId = getEntityStyleId(entity)
    const persistedStyle = styleId ? styleRecords.get(styleId) : undefined
    const style = mergeSketchEntityDisplayStyle(persistedStyle, localStyle)
    if (!style) {
      continue
    }

    entityStyleById.set(entity.entityId, style)
  }

  return entityStyleById
}

export function createSketchPointStyleLookup(session: SketchSessionState): Map<SketchPointId, SketchEntityDisplayStyle> {
  const pointStyleById = new Map<SketchPointId, SketchEntityDisplayStyle>()

  for (const point of session.fullDefinition.points) {
    const style = parseSketchStyleDefinition(point.style)
    if (!style) {
      continue
    }

    pointStyleById.set(point.pointId, style)
  }

  return pointStyleById
}

export function createSketchRegionStyleLookup(session: SketchSessionState): Map<RegionRecord['regionId'], SketchEntityDisplayStyle> {
  const regionStyleById = new Map<RegionRecord['regionId'], SketchEntityDisplayStyle>()

  for (const styleRecord of session.fullDefinition.styles ?? []) {
    if (!styleRecord.target || styleRecord.target.kind !== 'region') {
      continue
    }

    const style = parseSketchStyleRecord(styleRecord)
    if (!style) {
      continue
    }

    regionStyleById.set(styleRecord.target.regionId, style)
  }

  return regionStyleById
}

export function mergeSketchEntityDisplayStyle(
  base: SketchEntityDisplayStyle | undefined,
  override: SketchEntityDisplayStyle | undefined,
): SketchEntityDisplayStyle | undefined {
  if (!base) {
    return override
  }

  if (!override) {
    return base
  }

  return {
    paintStyle: override.paintStyle ?? base.paintStyle,
    strokeStyle: override.strokeStyle ?? base.strokeStyle,
  }
}

export function parseSketchStyleDefinition(style: SketchStyleDefinition | undefined): SketchEntityDisplayStyle | undefined {
  if (!style) {
    return undefined
  }

  const paintStyle = parseLocalPaintStyle(style)
  const strokeStyle = parseLocalStrokeStyle(style)

  if (!paintStyle && !strokeStyle) {
    return undefined
  }

  return { paintStyle, strokeStyle }
}

export function parseSketchStyleRecord(style: SketchStyleRecord): SketchEntityDisplayStyle | undefined {
  const paintStyle = parseSketchStyleRecordFill(style.fill)
  const strokeStyle = parseSketchStyleRecordStroke(style.stroke)

  if (!paintStyle && !strokeStyle) {
    return undefined
  }

  return { paintStyle, strokeStyle }
}

export function parseSketchStyleRecordFill(fill: SketchStyleRecord['fill']): SketchDisplayPaintStyle | undefined {
  if (fill.kind === 'none') {
    return undefined
  }

  if (fill.kind === 'solid') {
    return {
      color: parseColorValue(fill.color) ?? 0x48b6ff,
      opacity: fill.opacity,
    }
  }

  return {
    color: parseColorValue(fill.gradient.startColor) ?? 0x48b6ff,
    opacity: fill.gradient.startOpacity,
  }
}

export function parseSketchStyleRecordStroke(stroke: SketchStyleRecord['stroke']): SketchDisplayStrokeStyle | undefined {
  if (stroke.opacity <= 0 || stroke.width <= 0) {
    return undefined
  }

  return {
    color: parseColorValue(stroke.color) ?? 0xdde7f0,
    opacity: stroke.opacity,
    width: stroke.width,
    lineCap: stroke.lineCap,
    lineJoin: stroke.lineJoin,
    miterLimit: stroke.miterLimit,
    dashSize: stroke.dashSize,
    gapSize: stroke.gapSize,
  }
}

export function parseLocalPaintStyle(style: SketchStyleDefinition): SketchDisplayPaintStyle | undefined {
  if (style.fillMode === undefined || style.fillMode === 'none') {
    return undefined
  }

  const color =
    parseColorValue(style.fillColor)
    ?? (style.fillMode === 'gradient' ? parseColorValue(style.gradientStartColor) : null)
    ?? 0x48b6ff

  return {
    color,
    opacity: style.fillMode === 'gradient' ? 0.32 : 0.42,
  }
}

export function parseLocalStrokeStyle(style: SketchStyleDefinition): SketchDisplayStrokeStyle | undefined {
  if (style.strokeEnabled !== true) {
    return undefined
  }

  return {
    color: parseColorValue(style.strokeColor) ?? 0xdde7f0,
    opacity: 0.95,
    width: style.strokeWidth,
    lineCap: style.strokeCap,
    lineJoin: style.strokeJoin,
    miterLimit: style.strokeMiterLimit,
    dashSize: style.strokeDashSize,
    gapSize: style.strokeGapSize,
  }
}

export function getPersistedSketchStyleRecords(definition: SketchDefinition): Map<string, SketchEntityDisplayStyle> {
  const rawDefinition = definition as SketchDefinition & {
    styles?: unknown
    styleDefinitions?: unknown
  }
  const styleEntries = Array.isArray(rawDefinition.styles)
    ? rawDefinition.styles
    : Array.isArray(rawDefinition.styleDefinitions)
      ? rawDefinition.styleDefinitions
      : []
  const records = new Map<string, SketchEntityDisplayStyle>()

  for (const entry of styleEntries) {
    if (!entry || typeof entry !== 'object') {
      continue
    }

    const styleId = getRecordStringValue(entry, 'styleId')
    if (!styleId) {
      continue
    }

    const paintStyle = parsePaintStyle(getRecordObjectValue(entry, 'paint') ?? getRecordObjectValue(entry, 'fill'))
    const strokeStyle = parseStrokeStyle(getRecordObjectValue(entry, 'stroke'))
    if (!paintStyle && !strokeStyle) {
      continue
    }

    records.set(styleId, { paintStyle, strokeStyle })
  }

  return records
}

export function getEntityStyleId(entity: SketchEntityDefinition): string | null {
  const rawEntity = entity as SketchEntityDefinition & {
    styleId?: unknown
    style?: unknown
    displayStyleId?: unknown
  }
  const styleId = getOptionalString(rawEntity.styleId) ?? getOptionalString(rawEntity.displayStyleId)
  if (styleId) {
    return styleId
  }

  const styleRecord = getRecordObjectValue(rawEntity, 'style')
  if (!styleRecord) {
    return null
  }

  return getRecordStringValue(styleRecord, 'styleId')
}

export function parsePaintStyle(value: Record<string, unknown> | null): SketchDisplayPaintStyle | undefined {
  if (!value) {
    return undefined
  }

  const color = parseColorValue(value.color)
  if (color === null) {
    return undefined
  }

  return {
    color,
    opacity: getOptionalNumber(value.opacity) ?? 1,
  }
}

export function parseStrokeStyle(value: Record<string, unknown> | null): SketchDisplayStrokeStyle | undefined {
  if (!value) {
    return undefined
  }

  const color = parseColorValue(value.color)
  if (color === null) {
    return undefined
  }

  return {
    color,
    opacity: getOptionalNumber(value.opacity) ?? 1,
    width: getOptionalNumber(value.width) ?? getOptionalNumber(value.thickness),
    lineCap: getOptionalStrokeCap(value.lineCap),
    lineJoin: getOptionalStrokeJoin(value.lineJoin),
    miterLimit: getOptionalNumber(value.miterLimit),
    dashSize: getOptionalNumber(value.dashSize),
    gapSize: getOptionalNumber(value.gapSize),
  }
}

export function getOptionalStrokeCap(value: unknown): SketchDisplayStrokeStyle['lineCap'] | undefined {
  return value === 'butt' || value === 'round' || value === 'square' ? value : undefined
}

export function getOptionalStrokeJoin(value: unknown): SketchDisplayStrokeStyle['lineJoin'] | undefined {
  return value === 'miter' || value === 'round' || value === 'bevel' ? value : undefined
}

export function parseColorValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  const hex = normalized.startsWith('#') ? normalized.slice(1) : normalized
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) {
    return null
  }

  return Number.parseInt(hex, 16)
}

export function getRecordObjectValue(
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> | null {
  const value = record[key]
  return value && typeof value === 'object' ? value as Record<string, unknown> : null
}

export function getRecordStringValue(record: Record<string, unknown>, key: string): string | null {
  return getOptionalString(record[key])
}

export function getOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

export function getOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function createReferenceRecordTarget(referenceId: ReferenceId): PrimitiveRef {
  return {
    kind: 'sketchExternalReference',
    referenceId,
  }
}

export function createSketchDatumReferenceTarget(
  sketchId: SketchId,
  datumId: 'origin' | 'xAxis' | 'yAxis',
  geometryKind: 'point' | 'lineSegment',
): PrimitiveRef {
  return {
    kind: 'sketchDatumReference',
    sketchId,
    datumId,
    geometryKind,
  }
}

export function createDisplayRenderableForSketchDatum(
  session: SketchSessionState,
  sketchId: SketchId,
  datumId: 'origin' | 'xAxis' | 'yAxis',
  extent: number,
): SketchSessionDisplayRenderable {
  if (datumId === 'origin') {
    return {
      id: `renderable_sketch_datum_origin_${sketchId}` as RenderableId,
      label: 'Sketch origin',
      target: createSketchDatumReferenceTarget(sketchId, 'origin', 'point'),
      geometry: {
        kind: 'marker',
        position: mapSketchPointToWorld(session.plane, [0, 0]),
        displayRadius: 0.18,
      },
      linePattern: 'solid',
      role: 'reference',
    }
  }

  const start: SketchPoint = datumId === 'xAxis' ? [-extent, 0] : [0, -extent]
  const end: SketchPoint = datumId === 'xAxis' ? [extent, 0] : [0, extent]

  return {
    id: `renderable_sketch_datum_${datumId}_${sketchId}` as RenderableId,
    label: datumId === 'xAxis' ? 'Sketch X axis' : 'Sketch Y axis',
    target: createSketchDatumReferenceTarget(sketchId, datumId, 'lineSegment'),
    geometry: {
      kind: 'polyline',
      points: [
        mapSketchPointToWorld(session.plane, start),
        mapSketchPointToWorld(session.plane, end),
      ],
      isClosed: false,
    },
    linePattern: 'dashed',
    role: 'reference',
  }
}

export function createDisplayRenderableForReferenceRecord(
  session: SketchSessionState,
  referenceId: ReferenceId,
  index: number,
): SketchSessionDisplayRenderable {
  const column = index % 6
  const row = Math.floor(index / 6)

  return {
    id: `renderable_reference_marker_${referenceId}` as RenderableId,
    label: `Reference ${referenceId}`,
    target: createReferenceRecordTarget(referenceId),
    geometry: {
      kind: 'marker',
      position: mapSketchPointToWorld(session.plane, [
        -0.72 + column * 0.24,
        -0.72 - row * 0.24,
      ]),
      displayRadius: 0.12,
    },
    linePattern: 'solid',
    role: 'reference',
  }
}

export function createProjectedGeometryTarget(
  referenceId: ReferenceId,
  geometry: ProjectedSketchReferenceRecord['geometry'][number],
): PrimitiveRef {
  return {
    kind: 'projectedReferenceGeometry',
    referenceId,
    geometryId: geometry.geometryId,
    geometryKind: geometry.kind,
  }
}

export function createDisplayRenderableForProjectedGeometry(
  session: SketchSessionState,
  referenceId: ReferenceId,
  geometry: ProjectedSketchReferenceRecord['geometry'][number],
  index: number,
): SketchSessionDisplayRenderable {
  const target = createProjectedGeometryTarget(referenceId, geometry)

  if (geometry.kind === 'point') {
    return {
      id: `renderable_projected_${referenceId}_${geometry.geometryId}_${index}` as RenderableId,
      label: `Projected ${geometry.geometryId}`,
      target,
      geometry: {
        kind: 'marker',
        position: mapSketchPointToWorld(session.plane, geometry.position),
        displayRadius: 0.14,
      },
      linePattern: 'dashed',
      role: 'reference',
    }
  }

  if (geometry.kind === 'lineSegment') {
    return {
      id: `renderable_projected_${referenceId}_${geometry.geometryId}_${index}` as RenderableId,
      label: `Projected ${geometry.geometryId}`,
      target,
      geometry: {
        kind: 'polyline',
        points: [
          mapSketchPointToWorld(session.plane, geometry.startPosition),
          mapSketchPointToWorld(session.plane, geometry.endPosition),
        ],
        isClosed: false,
      },
      linePattern: 'dashed',
      role: 'reference',
    }
  }

  if (geometry.kind === 'circle') {
    const pointCount = 48
    return {
      id: `renderable_projected_${referenceId}_${geometry.geometryId}_${index}` as RenderableId,
      label: `Projected ${geometry.geometryId}`,
      target,
      geometry: {
        kind: 'polyline',
        points: Array.from({ length: pointCount + 1 }, (_, pointIndex) => {
          const angle = (Math.PI * 2 * pointIndex) / pointCount
          return mapSketchPointToWorld(session.plane, [
            geometry.centerPosition[0] + Math.cos(angle) * geometry.radius,
            geometry.centerPosition[1] + Math.sin(angle) * geometry.radius,
          ])
        }),
        isClosed: true,
      },
      linePattern: 'dashed',
      role: 'reference',
    }
  }

  if (geometry.kind === 'spline') {
    return {
      id: `renderable_projected_${referenceId}_${geometry.geometryId}_${index}` as RenderableId,
      label: `Projected ${geometry.geometryId}`,
      target,
      geometry: {
        kind: 'polyline',
        points: geometry.fitPoints.map((point) => mapSketchPointToWorld(session.plane, point)),
        isClosed: geometry.isClosed,
      },
      linePattern: 'dashed',
      role: 'reference',
    }
  }

  const startAngle = Math.atan2(
    geometry.startPosition[1] - geometry.centerPosition[1],
    geometry.startPosition[0] - geometry.centerPosition[0],
  )
  const endAngle = Math.atan2(
    geometry.endPosition[1] - geometry.centerPosition[1],
    geometry.endPosition[0] - geometry.centerPosition[0],
  )
  const radius = Math.hypot(
    geometry.startPosition[0] - geometry.centerPosition[0],
    geometry.startPosition[1] - geometry.centerPosition[1],
  )
  const normalizedEnd = geometry.sweepDirection === 'counterClockwise' && endAngle < startAngle
    ? endAngle + Math.PI * 2
    : geometry.sweepDirection === 'clockwise' && endAngle > startAngle
      ? endAngle - Math.PI * 2
      : endAngle
  const pointCount = 32

  return {
    id: `renderable_projected_${referenceId}_${geometry.geometryId}_${index}` as RenderableId,
    label: `Projected ${geometry.geometryId}`,
    target,
    geometry: {
      kind: 'polyline',
      points: Array.from({ length: pointCount + 1 }, (_, pointIndex) => {
        const angle = startAngle + (normalizedEnd - startAngle) * pointIndex / pointCount
        return mapSketchPointToWorld(session.plane, [
          geometry.centerPosition[0] + Math.cos(angle) * radius,
          geometry.centerPosition[1] + Math.sin(angle) * radius,
        ])
      }),
      isClosed: false,
    },
    linePattern: 'dashed',
    role: 'reference',
  }
}
