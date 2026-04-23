import type { SketchDimensionAnnotationDragHandle } from '@/domain/editor/sketch-session'

export function createDimensionAnnotationPlacementPatch(
  handle: SketchDimensionAnnotationDragHandle,
  point: readonly [number, number],
) {
  return {
    intent: 'setDimensionAnnotationPlacement' as const,
    handleId: handle.id,
    dimensionId: handle.dimensionId,
    point,
  }
}
