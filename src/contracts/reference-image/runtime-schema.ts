import { z } from 'zod'

import type {
  ReferenceImageCalibrationAnchor,
  ReferenceImageCalibrationConstraint,
  ReferenceImageCalibrationDiagnostic,
  ReferenceImageCalibrationScaleMode,
  ReferenceImageCalibrationSolveResult,
  ReferenceImageCalibrationSolvedAnchor,
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
  worldPosition: point2dSchema.nullable(),
}).transform((value) => value as ReferenceImageCalibrationAnchor)

export const referenceImageCalibrationConstraintSchema = z.object({
  constraintId: z.string().trim().min(1, 'Reference-image calibration constraint id must not be empty.'),
  kind: z.literal('distance'),
  label: z.string().trim().min(1, 'Reference-image calibration constraint label must not be empty.'),
  firstAnchorId: z.string().trim().min(1, 'Reference-image calibration constraints must reference a first anchor id.'),
  secondAnchorId: z.string().trim().min(1, 'Reference-image calibration constraints must reference a second anchor id.'),
  distance: positiveNumberSchema('Reference-image calibration distances must be positive.'),
}).transform((value) => value as ReferenceImageCalibrationConstraint)

export const referenceImageCalibrationDiagnosticSchema = z.object({
  code: z.string().trim().min(1, 'Reference-image calibration diagnostics must provide a code.'),
  severity: z.union([z.literal('info'), z.literal('warning'), z.literal('error')]),
  message: z.string().trim().min(1, 'Reference-image calibration diagnostics must provide a message.'),
}).transform((value) => value as ReferenceImageCalibrationDiagnostic)

export const referenceImageCalibrationSolvedAnchorSchema = z.object({
  anchorId: z.string().trim().min(1, 'Reference-image solved anchors must provide an anchor id.'),
  worldPosition: point2dSchema,
}).transform((value) => value as ReferenceImageCalibrationSolvedAnchor)

export const referenceImageCalibrationSolveResultSchema = z.object({
  placement: referenceImagePlacementSchema,
  anchors: z.array(referenceImageCalibrationSolvedAnchorSchema),
  diagnostics: z.array(referenceImageCalibrationDiagnosticSchema),
}).transform((value) => value as ReferenceImageCalibrationSolveResult)

export const referenceImageCalibrationStateSchema = z.object({
  scaleMode: referenceImageCalibrationScaleModeSchema,
  showExportedAnchorsInSketch: z.boolean(),
  anchors: z.array(referenceImageCalibrationAnchorSchema),
  constraints: z.array(referenceImageCalibrationConstraintSchema),
  solveResult: referenceImageCalibrationSolveResultSchema.nullable(),
}).transform((value) => value as ReferenceImageCalibrationState)

export const referenceImageOperationStateSchema = z.object({
  kind: z.literal('referenceImage'),
  image: referenceImagePayloadSchema,
  placement: referenceImagePlacementSchema,
  calibration: referenceImageCalibrationStateSchema.optional().default({
    scaleMode: 'lockedAspect',
    showExportedAnchorsInSketch: false,
    anchors: [],
    constraints: [],
    solveResult: null,
  }),
}).transform((value) => value as ReferenceImageOperationState)
