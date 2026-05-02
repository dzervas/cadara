import { z } from 'zod'

import type {
  ReferenceImageCalibrationAnchor,
  ReferenceImageCalibrationScaleMode,
  ReferenceImageCalibrationState,
  ReferenceImageOperationState,
} from '@/contracts/reference-image/schema'
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

export const referenceImageCalibrationScaleModeSchema = z.union([
  z.literal('lockedAspect'),
  z.literal('independent'),
]).transform((value) => value as ReferenceImageCalibrationScaleMode)

export const referenceImageCalibrationAnchorSchema = z.object({
  anchorId: z.string().trim().min(1, 'Reference-image anchor id must not be empty.'),
  label: z.string().trim().min(1, 'Reference-image anchor label must not be empty.'),
  uv: point2dSchema,
  pointId: z.string().trim().min(1, 'Reference-image anchors must bind to a local point id.'),
}).strict().transform((value) => value as ReferenceImageCalibrationAnchor)

export const referenceImageCalibrationStateSchema = z.object({
  scaleMode: referenceImageCalibrationScaleModeSchema,
  anchors: z.array(referenceImageCalibrationAnchorSchema),
  showExportedAnchorsInSketch: z.boolean().optional(),
}).strict().transform((value) => ({
  scaleMode: value.scaleMode,
  showExportedAnchorsInSketch: value.showExportedAnchorsInSketch ?? true,
  anchors: value.anchors,
}) as ReferenceImageCalibrationState)

export const referenceImageOperationStateSchema = z.object({
  kind: z.literal('referenceImage'),
  image: referenceImagePayloadSchema,
  placement: referenceImagePlacementSchema,
  calibration: referenceImageCalibrationStateSchema.optional().default({
    scaleMode: 'lockedAspect',
    showExportedAnchorsInSketch: true,
    anchors: [],
  }),
}).transform((value) => value as ReferenceImageOperationState)
