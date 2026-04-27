import type { ReferenceImageOperationState } from '@/contracts/reference-image/schema'
import type { ReferenceImagePayload } from '@/contracts/reference-image/schema'
import type { SketchPoint2D } from '@/contracts/sketch/schema'
import type { SketchAuthoringOperationId } from '@/contracts/shared/ids'

export function getReferenceImageCornerPoints(
  state: ReferenceImageOperationState,
): readonly [SketchPoint2D, SketchPoint2D, SketchPoint2D, SketchPoint2D] {
  const halfWidth = state.placement.width / 2
  const halfHeight = state.placement.height / 2
  const corners: readonly [SketchPoint2D, SketchPoint2D, SketchPoint2D, SketchPoint2D] = [
    [-halfWidth, halfHeight],
    [halfWidth, halfHeight],
    [halfWidth, -halfHeight],
    [-halfWidth, -halfHeight],
  ]

  const sin = Math.sin(state.placement.rotationRadians)
  const cos = Math.cos(state.placement.rotationRadians)

  const [topLeft, topRight, bottomRight, bottomLeft] = corners

  return [topLeft, topRight, bottomRight, bottomLeft].map(([x, y]) => ([
    state.placement.center[0] + x * cos - y * sin,
    state.placement.center[1] + x * sin + y * cos,
  ] as SketchPoint2D)) as unknown as readonly [SketchPoint2D, SketchPoint2D, SketchPoint2D, SketchPoint2D]
}

export function createReferenceImageDataUrl(image: Pick<ReferenceImagePayload, 'mediaType' | 'base64Data'>) {
  return `data:${image.mediaType};base64,${image.base64Data}`
}

export function createReferenceImageTextureSourceKey(input: {
  operationId: SketchAuthoringOperationId
  state: ReferenceImageOperationState
}) {
  return [
    input.operationId,
    input.state.image.mediaType,
    input.state.image.fileName ?? 'reference-image',
    `${input.state.image.pixelWidth}x${input.state.image.pixelHeight}`,
  ].join(':')
}
