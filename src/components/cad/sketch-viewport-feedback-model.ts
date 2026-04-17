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
      return anchor ? [{ id: getOverlayProjectionId(overlay.id), anchor }] : []
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

export function getFloatingInputProjectionId(id: string) {
  return `floating-input:${id}`
}

function getOverlayAnchor(overlay: SketchToolOverlayDescriptor): SketchToolAnchorDescriptor | null {
  switch (overlay.kind) {
    case 'measurement':
    case 'constraintPreview':
      return overlay.anchor
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
