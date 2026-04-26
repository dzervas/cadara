import { z } from 'zod'

import type {
  AddDocumentVariableRequest,
  CommitSketchRequest,
  CreateFeatureRequest,
} from '@/contracts/modeling/schema'
import { featureDefinitionSchema, modelingMutationRequestEnvelopeSchema } from '@/contracts/modeling/runtime-schema'
import { sketchDefinitionSchema } from '@/contracts/sketch/runtime-schema'
import { sketchPlaneDefinitionSchema, sketchPlaneSupportRefSchema } from '@/contracts/shared/sketch-plane.runtime-schema'
import {
  documentVariableIdSchema,
  requestIdSchema,
  sketchIdSchema,
  stringSchema,
} from '@/contracts/shared/runtime-schema'
import type { ImportPreparedActions } from '@/contracts/import/actions'
export {
  importBindingSchema,
  importDiagnosticSchema,
  importSourceFingerprintSchema,
  importSourceSchema,
  resolvedImportSourceSchema,
} from '@/contracts/import/base-validation'
import {
  importBindingSchema,
  importDiagnosticSchema,
} from '@/contracts/import/base-validation'

const createFeatureRequestSchema = modelingMutationRequestEnvelopeSchema.extend({
  featureLabel: stringSchema.optional(),
  definition: featureDefinitionSchema,
}).transform((value) => value as CreateFeatureRequest)

const commitSketchRequestSchema = modelingMutationRequestEnvelopeSchema.extend({
  solverCorrelation: z.object({
    requestId: requestIdSchema,
    projectionRequestId: requestIdSchema,
    validationRequestId: requestIdSchema,
    solveRequestId: requestIdSchema,
    regionRequestId: requestIdSchema,
  }).nullable(),
  sketchId: sketchIdSchema.nullable(),
  sketchLabel: stringSchema,
  plane: sketchPlaneDefinitionSchema,
  planeTarget: sketchPlaneSupportRefSchema,
  planeKey: z.union([z.literal('xy'), z.literal('yz'), z.literal('xz')]).nullable(),
  definition: sketchDefinitionSchema,
}).transform((value) => value as CommitSketchRequest)

const addDocumentVariableRequestSchema = modelingMutationRequestEnvelopeSchema.extend({
  variableId: documentVariableIdSchema.optional(),
  name: stringSchema,
  valueText: stringSchema,
}).transform((value) => value as AddDocumentVariableRequest)

export const importPreparedActionsSchema = z.object({
  createFeatures: z.array(createFeatureRequestSchema).optional(),
  commitSketches: z.array(commitSketchRequestSchema).optional(),
  addDocumentVariables: z.array(addDocumentVariableRequestSchema).optional(),
  binding: importBindingSchema.optional(),
  diagnostics: z.array(importDiagnosticSchema).optional(),
}).strict().transform((value) => value as ImportPreparedActions)
