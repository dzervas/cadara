import { z } from 'zod'

import type {
  CadaraExportOptions,
  DocumentExportFormat,
  DocumentExportOptions,
  DocumentExportRequest,
  DocumentExportResult,
  MeshExportAccuracyOptions,
  StlExportOptions,
  StepExportOptions,
  ThreeMfExportOptions,
} from '@/contracts/modeling/export'
import { durableRefSchema } from '@/contracts/shared/references.runtime-schema'
import {
  contractVersionSchema,
  revisionIdSchema,
  stringSchema,
} from '@/contracts/shared/runtime-schema'

export const documentExportFormatSchema = z.union([
  z.literal('stl'),
  z.literal('step'),
  z.literal('3mf'),
  z.literal('cadara'),
]).transform((value) => value as DocumentExportFormat)

export const meshExportAccuracyOptionsSchema = z.object({
  chordTolerance: z.number().positive('Mesh chord tolerance must be positive.'),
  angleToleranceRadians: z.number().positive('Mesh angle tolerance must be positive.'),
}).strict().transform((value) => value as MeshExportAccuracyOptions)

const stlExportOptionsBaseSchema = z.object({
  meshAccuracy: meshExportAccuracyOptionsSchema,
  encoding: z.union([z.literal('binary'), z.literal('ascii')]),
}).strict()

export const stlExportOptionsSchema = stlExportOptionsBaseSchema.transform((value) => value as StlExportOptions)

const threeMfExportOptionsBaseSchema = z.object({
  meshAccuracy: meshExportAccuracyOptionsSchema,
  unit: z.literal('millimeter'),
  includeMetadata: z.boolean(),
}).strict()

export const threeMfExportOptionsSchema = threeMfExportOptionsBaseSchema.transform((value) => value as ThreeMfExportOptions)

const stepExportOptionsBaseSchema = z.object({
  schema: z.union([z.literal('AP203'), z.literal('AP214'), z.literal('AP242')]),
  unit: z.literal('millimeter'),
}).strict()

export const stepExportOptionsSchema = stepExportOptionsBaseSchema.transform((value) => value as StepExportOptions)

const cadaraExportOptionsBaseSchema = z.object({
  pretty: z.boolean(),
}).strict()

export const cadaraExportOptionsSchema = cadaraExportOptionsBaseSchema.transform((value) => value as CadaraExportOptions)

export const documentExportOptionsSchema = z.discriminatedUnion('format', [
  stlExportOptionsBaseSchema.extend({ format: z.literal('stl') }),
  stepExportOptionsBaseSchema.extend({ format: z.literal('step') }),
  threeMfExportOptionsBaseSchema.extend({ format: z.literal('3mf') }),
  cadaraExportOptionsBaseSchema.extend({ format: z.literal('cadara') }),
]).transform((value) => value as DocumentExportOptions)

const baseDocumentExportRequestSchema = z.object({
  contractVersion: contractVersionSchema,
  documentId: stringSchema,
  baseRevisionId: revisionIdSchema,
  target: durableRefSchema,
  targetLabel: stringSchema,
})

export const documentExportRequestSchema = z.discriminatedUnion('format', [
  baseDocumentExportRequestSchema.extend({
    format: z.literal('stl'),
    options: stlExportOptionsBaseSchema,
  }),
  baseDocumentExportRequestSchema.extend({
    format: z.literal('step'),
    options: stepExportOptionsBaseSchema,
  }),
  baseDocumentExportRequestSchema.extend({
    format: z.literal('3mf'),
    options: threeMfExportOptionsBaseSchema,
  }),
  baseDocumentExportRequestSchema.extend({
    format: z.literal('cadara'),
    options: cadaraExportOptionsBaseSchema,
  }),
]).transform((value) => value as DocumentExportRequest)

const documentExportDiagnosticSchema = z.object({
  code: stringSchema,
  severity: z.union([z.literal('info'), z.literal('warning'), z.literal('error')]),
  message: stringSchema,
  target: durableRefSchema.nullable(),
})

export const documentExportResultSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    format: documentExportFormatSchema,
    filename: stringSchema,
    extension: stringSchema,
    mimeType: stringSchema,
    payload: z.union([z.string(), z.instanceof(Uint8Array)]),
    diagnostics: z.array(documentExportDiagnosticSchema),
  }),
  z.object({
    ok: z.literal(false),
    format: documentExportFormatSchema,
    diagnostics: z.array(documentExportDiagnosticSchema),
  }),
]).transform((value) => value as DocumentExportResult)

export function getDefaultMeshExportAccuracyOptions(): MeshExportAccuracyOptions {
  return {
    chordTolerance: 0.05,
    angleToleranceRadians: 0.1,
  }
}

export function getDefaultStlExportOptions(): StlExportOptions {
  return {
    meshAccuracy: getDefaultMeshExportAccuracyOptions(),
    encoding: 'binary',
  }
}

export function getDefaultThreeMfExportOptions(): ThreeMfExportOptions {
  return {
    meshAccuracy: getDefaultMeshExportAccuracyOptions(),
    unit: 'millimeter',
    includeMetadata: true,
  }
}

export function getDefaultStepExportOptions(): StepExportOptions {
  return {
    schema: 'AP242',
    unit: 'millimeter',
  }
}

export function getDefaultCadaraExportOptions(): CadaraExportOptions {
  return {
    pretty: true,
  }
}

export function getDefaultDocumentExportOptions(format: 'stl'): StlExportOptions
export function getDefaultDocumentExportOptions(format: 'step'): StepExportOptions
export function getDefaultDocumentExportOptions(format: '3mf'): ThreeMfExportOptions
export function getDefaultDocumentExportOptions(format: 'cadara'): CadaraExportOptions
export function getDefaultDocumentExportOptions(format: DocumentExportFormat) {
  switch (format) {
    case 'stl':
      return getDefaultStlExportOptions()
    case 'step':
      return getDefaultStepExportOptions()
    case '3mf':
      return getDefaultThreeMfExportOptions()
    case 'cadara':
      return getDefaultCadaraExportOptions()
  }
}
