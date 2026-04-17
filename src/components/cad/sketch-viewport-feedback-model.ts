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
