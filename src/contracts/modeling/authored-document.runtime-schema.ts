import { z, type ZodIssue } from 'zod'

import {
  AUTHORED_MODEL_DOCUMENT_SCHEMA_VERSION,
  CONTRACT_VERSION,
  type AuthoredModelDocumentSchemaVersion,
} from '@/contracts/shared/versioning'
import {
  bodyIdSchema,
  contractVersionSchema,
  documentIdSchema,
  featureIdSchema,
  literalVersionSchema,
  numberSchema,
  revisionIdSchema,
  sketchIdSchema,
  stringSchema,
} from '@/contracts/shared/runtime-schema'
import { featureDefinitionSchema } from '@/contracts/modeling/runtime-schema'
import { sketchPlaneDefinitionSchema, sketchPlaneSupportRefSchema } from '@/contracts/shared/sketch-plane.runtime-schema'
import { sketchDefinitionSchema } from '@/contracts/sketch/runtime-schema'
import type {
  AuthoredModelDocument,
  AuthoredModelDocumentMigrationResult,
} from '@/contracts/modeling/authored-document'

const authoredModelDocumentSchemaVersionSchema = literalVersionSchema<AuthoredModelDocumentSchemaVersion>(
  AUTHORED_MODEL_DOCUMENT_SCHEMA_VERSION,
  'schemaVersion',
  'Unsupported authored model document schema version',
)

const modelingDocumentSettingsSchema = z.object({
  linearUnit: z.literal('millimeter'),
  modelingTolerance: numberSchema,
  angularToleranceRadians: numberSchema,
}).strict()

const authoredSketchRecordSchema = z.object({
  sketchId: sketchIdSchema,
  label: stringSchema,
  plane: sketchPlaneDefinitionSchema,
  planeTarget: sketchPlaneSupportRefSchema,
  planeKey: z.union([z.literal('xy'), z.literal('yz'), z.literal('xz')]).nullable(),
  definition: sketchDefinitionSchema,
}).strict()

const authoredFeatureRecordSchema = z.object({
  featureId: featureIdSchema,
  label: stringSchema,
  definition: featureDefinitionSchema,
}).strict()

const authoredBodyLabelRecordSchema = z.object({
  bodyId: bodyIdSchema,
  label: stringSchema,
}).strict()

const authoredDocumentFeatureCursorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('empty') }).strict(),
  z.object({ kind: z.literal('sketch'), sketchId: sketchIdSchema }).strict(),
  z.object({ kind: z.literal('feature'), featureId: featureIdSchema }).strict(),
])

export const authoredModelDocumentSchema = z.object({
  contractVersion: contractVersionSchema,
  schemaVersion: authoredModelDocumentSchemaVersionSchema,
  documentId: documentIdSchema,
  revisionId: revisionIdSchema,
  settings: modelingDocumentSettingsSchema,
  variables: z.array(z.object({
    variableId: z.string().regex(/^variable_.+$/, 'Document variable ID is invalid.'),
    name: stringSchema,
    valueText: stringSchema,
  }).strict()),
  sketches: z.array(authoredSketchRecordSchema),
  features: z.array(authoredFeatureRecordSchema),
  featureOrder: z.array(featureIdSchema),
  cursor: authoredDocumentFeatureCursorSchema,
  bodyLabels: z.array(authoredBodyLabelRecordSchema),
}).strict().superRefine((value, ctx) => {
  const featureIds = value.features.map((feature) => feature.featureId)
  const featureIdSet = new Set(featureIds)
  const orderIdSet = new Set(value.featureOrder)

  if (featureIds.length !== featureIdSet.size) {
    ctx.addIssue({
      code: 'custom',
      message: 'Authored model document contains duplicate feature IDs.',
      path: ['features'],
    })
  }

  if (value.featureOrder.length !== orderIdSet.size || featureIds.some((featureId) => !orderIdSet.has(featureId))) {
    ctx.addIssue({
      code: 'custom',
      message: 'Authored model document featureOrder must contain each feature exactly once.',
      path: ['featureOrder'],
    })
  }

  const sketchIds = new Set(value.sketches.map((sketch) => sketch.sketchId))
  if (value.cursor.kind === 'feature' && !featureIdSet.has(value.cursor.featureId)) {
    ctx.addIssue({
      code: 'custom',
      message: 'Authored model document cursor references a missing feature.',
      path: ['cursor'],
    })
  }
  if (value.cursor.kind === 'sketch' && !sketchIds.has(value.cursor.sketchId)) {
    ctx.addIssue({
      code: 'custom',
      message: 'Authored model document cursor references a missing sketch.',
      path: ['cursor'],
    })
  }

}).transform((value) => ({
  ...value,
  contractVersion: CONTRACT_VERSION,
  schemaVersion: AUTHORED_MODEL_DOCUMENT_SCHEMA_VERSION,
}) as AuthoredModelDocument)

function firstIssueMessage(issue: ZodIssue) {
  if (issue.message.startsWith('Unsupported authored model document schema version')) {
    return {
      reasonCode: 'unsupported-schema-version',
      message: 'Authored model document schema version is not supported.',
    }
  }

  if (issue.message.startsWith('Unsupported contract version')) {
    return {
      reasonCode: 'unsupported-contract-version',
      message: 'Authored model document contract version is not supported.',
    }
  }

  if (issue.code === 'unrecognized_keys') {
    return {
      reasonCode: 'derived-field-leak',
      message: 'Authored model document contains fields outside the persisted authored contract.',
    }
  }

  return {
    reasonCode: 'invalid-authored-document',
    message: issue.message,
  }
}

export function migrateAuthoredModelDocument(value: unknown): AuthoredModelDocumentMigrationResult {
  const result = authoredModelDocumentSchema.safeParse(value)
  if (!result.success) {
    return {
      ok: false,
      diagnostic: firstIssueMessage(result.error.issues[0]!),
    }
  }

  return {
    ok: true,
    document: result.data,
    migrated: false,
  }
}

export function parseAuthoredModelDocument(value: unknown): AuthoredModelDocumentMigrationResult {
  return migrateAuthoredModelDocument(value)
}
