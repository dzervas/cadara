import type {
  SketchToolAnchorDescriptor,
  SketchToolOverlayDescriptor,
  SketchToolPresentationSchema,
} from '@/domain/sketch-tools/editor-schema'

export interface SketchViewportFeedbackProjection {
  id: string
  x: number
  y: number
}

export interface SketchViewportFeedbackLayoutProjection extends SketchViewportFeedbackProjection {
  sourceX: number
  sourceY: number
}

interface SketchViewportFeedbackAnchor {
  id: string
  anchor: SketchToolAnchorDescriptor
}

export function collectSketchViewportFeedbackAnchors(
  schema: SketchToolPresentationSchema | null,
): readonly SketchViewportFeedbackAnchor[] {
  if (!schema) {
    return []
  }

  return [
    ...(schema.overlays ?? []).flatMap((overlay) => {
      const anchor = getOverlayAnchor(overlay)
      return [
        ...(anchor ? [{ id: getOverlayProjectionId(overlay.id), anchor }] : []),
        ...getOverlayGeometryAnchors(overlay),
      ]
    }),
    ...(schema.floatingInput?.anchor
      ? [{
          id: getFloatingInputProjectionId(schema.floatingInput.id),
          anchor: schema.floatingInput.anchor,
        }]
      : []),
  ]
}

export function getOverlayProjectionId(id: string) {
  return `overlay:${id}`
}

export function getOverlayGeometryProjectionId(id: string, point: string) {
  return `overlay-geometry:${id}:${point}`
}

export function getFloatingInputProjectionId(id: string) {
  return `floating-input:${id}`
}

export function getAnnotationProjectionId(annotationId: string) {
  return `annotation:${annotationId}`
}

export function layoutSketchAnnotationProjections(
  projections: readonly SketchViewportFeedbackProjection[],
): SketchViewportFeedbackLayoutProjection[] {
  const placed: SketchViewportFeedbackLayoutProjection[] = []

  for (const projection of projections) {
    const candidate = findNonOverlappingAnnotationPosition(projection, placed, projections.length)
    placed.push({
      ...projection,
      sourceX: projection.x,
      sourceY: projection.y,
      x: candidate.x,
      y: candidate.y,
    })
  }

  return placed
}

const ANNOTATION_LABEL_SIZE_PX = 32
const ANNOTATION_LABEL_GAP_PX = 6
const ANNOTATION_LABEL_STEP_PX = ANNOTATION_LABEL_SIZE_PX + ANNOTATION_LABEL_GAP_PX

function findNonOverlappingAnnotationPosition(
  projection: SketchViewportFeedbackProjection,
  placed: readonly SketchViewportFeedbackLayoutProjection[],
  totalProjectionCount: number,
) {
  const candidates = createAnnotationLayoutCandidates(totalProjectionCount)
    .map((offset) => ({
      x: projection.x + offset.x,
      y: projection.y + offset.y,
    }))

  return candidates.find((candidate) => !placed.some((entry) => annotationLabelsOverlap(candidate, entry)))
    ?? candidates[0]
    ?? projection
}

function createAnnotationLayoutCandidates(totalProjectionCount: number) {
  const candidates = [{ x: 0, y: 0 }]
  const ringCount = Math.max(totalProjectionCount, 1)

  for (let ring = 1; ring <= ringCount; ring += 1) {
    const radius = ring * ANNOTATION_LABEL_STEP_PX

    candidates.push(
      { x: radius, y: 0 },
      { x: 0, y: -radius },
      { x: -radius, y: 0 },
      { x: 0, y: radius },
      { x: radius, y: -radius },
      { x: -radius, y: -radius },
      { x: -radius, y: radius },
      { x: radius, y: radius },
    )
  }

  return candidates
}

function annotationLabelsOverlap(
  left: Pick<SketchViewportFeedbackProjection, 'x' | 'y'>,
  right: Pick<SketchViewportFeedbackProjection, 'x' | 'y'>,
) {
  return Math.abs(left.x - right.x) < ANNOTATION_LABEL_STEP_PX
    && Math.abs(left.y - right.y) < ANNOTATION_LABEL_STEP_PX
}

function getOverlayAnchor(overlay: SketchToolOverlayDescriptor): SketchToolAnchorDescriptor | null {
  switch (overlay.kind) {
    case 'measurement':
    case 'constraintPreview':
      return overlay.anchor
    case 'dimensionLine':
    case 'angleArc':
      return overlay.labelAnchor
    case 'referenceLabel':
      return overlay.anchor
    case 'extensionLine':
      return null
    case 'anchor':
    case 'helperMarker':
    case 'snapIndicator':
      return { kind: 'sketchPoint', point: overlay.point }
    case 'completionCue':
      return {
        kind: 'sketchPoint',
        point: overlay.point,
        offset: { x: 0, y: 26 },
      }
  }
}

function getOverlayGeometryAnchors(overlay: SketchToolOverlayDescriptor): readonly SketchViewportFeedbackAnchor[] {
  switch (overlay.kind) {
    case 'dimensionLine':
      return [
        {
          id: getOverlayGeometryProjectionId(overlay.id, 'start'),
          anchor: getSketchPointAnchor(overlay.start),
        },
        {
          id: getOverlayGeometryProjectionId(overlay.id, 'end'),
          anchor: getSketchPointAnchor(overlay.end),
        },
        ...(overlay.extensionLines ?? []).flatMap((line) => [
          {
            id: getOverlayGeometryProjectionId(line.id, 'start'),
            anchor: getSketchPointAnchor(line.start),
          },
          {
            id: getOverlayGeometryProjectionId(line.id, 'end'),
            anchor: getSketchPointAnchor(line.end),
          },
        ]),
      ]
    case 'extensionLine':
      return [
        {
          id: getOverlayGeometryProjectionId(overlay.id, 'start'),
          anchor: getSketchPointAnchor(overlay.start),
        },
        {
          id: getOverlayGeometryProjectionId(overlay.id, 'end'),
          anchor: getSketchPointAnchor(overlay.end),
        },
      ]
    case 'angleArc':
      return [
        {
          id: getOverlayGeometryProjectionId(overlay.id, 'center'),
          anchor: getSketchPointAnchor(overlay.center),
        },
        {
          id: getOverlayGeometryProjectionId(overlay.id, 'start'),
          anchor: getSketchPointAnchor(overlay.start),
        },
        {
          id: getOverlayGeometryProjectionId(overlay.id, 'end'),
          anchor: getSketchPointAnchor(overlay.end),
        },
      ]
    default:
      return []
  }
}

function getSketchPointAnchor(point: readonly [number, number]): SketchToolAnchorDescriptor {
  return { kind: 'sketchPoint', point }
}
