import { z } from 'zod'

import type { ReferenceImageOperationState } from '@/contracts/reference-image/schema'
import { point2dSchema, positiveNumberSchema } from '@/contracts/shared/runtime-schema'

const base64Pattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

export const referenceImagePayloadSchema = z.object({
  mediaType: z.string().trim().min(1, 'Reference-image media type must not be empty.'),
  fileName: z.string().trim().min(1).optional(),
  pixelWidth: positiveNumberSchema('Reference-image pixel width must be positive.'),
  pixelHeight: positiveNumberSchema('Reference-image pixel height must be positive.'),
  base64Data: z.string().trim().min(1, 'Reference-image base64 payload must not be empty.')
    .regex(base64Pattern, 'Reference-image payload must be valid base64.'),
})

export const referenceImagePlacementSchema = z.object({
  center: point2dSchema,
  width: positiveNumberSchema('Reference-image width must be positive.'),
  height: positiveNumberSchema('Reference-image height must be positive.'),
  rotationRadians: z.number(),
})

export const referenceImageOperationStateSchema = z.object({
  kind: z.literal('referenceImage'),
  image: referenceImagePayloadSchema,
  placement: referenceImagePlacementSchema,
}).transform((value) => value as ReferenceImageOperationState)
