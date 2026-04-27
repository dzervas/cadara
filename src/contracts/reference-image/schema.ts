import type { SketchPoint2D } from '@/contracts/sketch/schema'

export interface ReferenceImagePayload {
  mediaType: string
  fileName?: string
  pixelWidth: number
  pixelHeight: number
  base64Data: string
}

export interface ReferenceImagePlacement {
  center: SketchPoint2D
  width: number
  height: number
  rotationRadians: number
}

export interface ReferenceImageOperationState {
  kind: 'referenceImage'
  image: ReferenceImagePayload
  placement: ReferenceImagePlacement
}
