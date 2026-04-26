import { z } from 'zod'

import {
  literalVersionSchema,
  stringSchema,
} from '@/contracts/shared/runtime-schema'
import type { ImportBinding } from '@/contracts/import/binding'
import type { ImportDiagnostic } from '@/contracts/import/diagnostics'
import type { ImportSource, ImportSourceFingerprint, ResolvedImportSource } from '@/contracts/import/source'
import {
  IMPORT_CONTRACT_SCHEMA_VERSION,
  type ImportContractSchemaVersion,
} from '@/contracts/shared/versioning'

const importContractSchemaVersionSchema = literalVersionSchema<ImportContractSchemaVersion>(
  IMPORT_CONTRACT_SCHEMA_VERSION,
  'schemaVersion',
  'Unsupported import contract schema version',
)

export const importSourceFingerprintSchema = z
  .string()
  .regex(/^sha256:[a-f0-9]{64}$/, 'Import source fingerprint must be a sha256:<hex> content hash.')
  .transform((value) => value as ImportSourceFingerprint)

const localFileImportSourceSchema = z.object({
  kind: z.literal('localFile'),
  fileName: stringSchema.min(1),
  pathHint: stringSchema.min(1).optional(),
}).strict()

const urlImportSourceSchema = z.object({
  kind: z.literal('url'),
  url: z.string().url('Import source URL must be a valid absolute URL.'),
}).strict()

const cloudObjectImportSourceSchema = z.object({
  kind: z.literal('cloudObject'),
  service: stringSchema.min(1),
  objectId: stringSchema.min(1),
  versionId: stringSchema.min(1).optional(),
}).strict()

export const importSourceSchema = z.discriminatedUnion('kind', [
  localFileImportSourceSchema,
  urlImportSourceSchema,
  cloudObjectImportSourceSchema,
]).transform((value) => value as ImportSource)

export const resolvedImportSourceSchema = z.object({
  name: stringSchema.min(1),
  origin: importSourceSchema,
  mediaType: stringSchema.min(1).nullable(),
  bytes: z.instanceof(Uint8Array),
  fingerprint: importSourceFingerprintSchema,
}).strict().transform((value) => value as ResolvedImportSource)

const importRefreshPolicySchema = z.literal('manual')

export const importBindingSchema = z.discriminatedUnion('kind', [
  z.object({
    schemaVersion: importContractSchemaVersionSchema,
    kind: z.literal('localFile'),
    fileName: stringSchema.min(1),
    pathHint: stringSchema.min(1).optional(),
    fingerprint: importSourceFingerprintSchema,
    refreshPolicy: importRefreshPolicySchema,
  }).strict(),
  z.object({
    schemaVersion: importContractSchemaVersionSchema,
    kind: z.literal('url'),
    url: z.string().url('Import binding URL must be a valid absolute URL.'),
    fingerprint: importSourceFingerprintSchema,
    refreshPolicy: importRefreshPolicySchema,
  }).strict(),
  z.object({
    schemaVersion: importContractSchemaVersionSchema,
    kind: z.literal('cloudObject'),
    service: stringSchema.min(1),
    objectId: stringSchema.min(1),
    versionId: stringSchema.min(1).optional(),
    fingerprint: importSourceFingerprintSchema,
    refreshPolicy: importRefreshPolicySchema,
  }).strict(),
]).transform((value) => value as ImportBinding)

export const importDiagnosticSchema = z.object({
  severity: z.union([z.literal('info'), z.literal('warning'), z.literal('error')]),
  message: stringSchema.min(1),
  code: stringSchema.min(1).optional(),
}).strict().transform((value) => value as ImportDiagnostic)
