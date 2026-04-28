import { z } from 'zod'

import type {
  ReferenceImageCalibrationAnchor,
  ReferenceImageCalibrationConstraint,
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

const referenceImageCalibrationAnchorBindingSchema = z.object({
  anchorId: z.string().trim().min(1, 'Reference-image anchor id must not be empty.'),
  label: z.string().trim().min(1, 'Reference-image anchor label must not be empty.'),
  uv: point2dSchema,
  pointId: z.string().trim().min(1, 'Reference-image anchors must bind to a local point id.'),
  legacyWorldPosition: point2dSchema.nullable().optional(),
})

const referenceImageLegacyCalibrationAnchorSchema = z.object({
  anchorId: z.string().trim().min(1, 'Reference-image anchor id must not be empty.'),
  label: z.string().trim().min(1, 'Reference-image anchor label must not be empty.'),
  uv: point2dSchema,
  worldPosition: point2dSchema.nullable(),
})

export const referenceImageCalibrationAnchorSchema = z.union([
  referenceImageCalibrationAnchorBindingSchema,
  referenceImageLegacyCalibrationAnchorSchema,
]).transform((value) => {
  if ('pointId' in value) {
    return value as ReferenceImageCalibrationAnchor
  }

  return {
    anchorId: value.anchorId,
    label: value.label,
    uv: value.uv,
    pointId: `sketch_point_reference_image_legacy_${value.anchorId}`,
    legacyWorldPosition: value.worldPosition,
  } satisfies ReferenceImageCalibrationAnchor
})

export const referenceImageCalibrationConstraintSchema = z.object({
  constraintId: z.string().trim().min(1, 'Reference-image calibration constraint id must not be empty.'),
  kind: z.literal('distance'),
  label: z.string().trim().min(1, 'Reference-image calibration constraint label must not be empty.'),
  firstAnchorId: z.string().trim().min(1, 'Reference-image calibration constraints must reference a first anchor id.'),
  secondAnchorId: z.string().trim().min(1, 'Reference-image calibration constraints must reference a second anchor id.'),
  distance: positiveNumberSchema('Reference-image calibration distances must be positive.'),
}).transform((value) => value as ReferenceImageCalibrationConstraint)

export const referenceImageCalibrationStateSchema = z.object({
  scaleMode: referenceImageCalibrationScaleModeSchema,
  anchors: z.array(referenceImageCalibrationAnchorSchema),
  constraints: z.array(referenceImageCalibrationConstraintSchema).optional(),
  legacyConstraints: z.array(referenceImageCalibrationConstraintSchema).optional(),
  showExportedAnchorsInSketch: z.boolean().optional(),
}).transform((value) => ({
  scaleMode: value.scaleMode,
  showExportedAnchorsInSketch: value.showExportedAnchorsInSketch ?? true,
  anchors: value.anchors,
  ...(value.legacyConstraints && value.legacyConstraints.length > 0
    ? { legacyConstraints: value.legacyConstraints }
    : value.constraints && value.constraints.length > 0
      ? { legacyConstraints: value.constraints }
      : {}),
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
