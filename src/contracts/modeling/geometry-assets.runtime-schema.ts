import { z } from 'zod'

import {
  GEOMETRY_ASSET_MANIFEST_SCHEMA_VERSION,
  GEOMETRY_ASSET_SCHEMA_VERSION,
  type GeometryAssetManifestSchemaVersion,
  type GeometryAssetSchemaVersion,
} from '@/contracts/shared/versioning'
import {
  featureIdSchema,
  geometryAssetIdSchema,
  literalVersionSchema,
  stringSchema,
} from '@/contracts/shared/runtime-schema'
import type {
  GeometryAssetHash,
  GeometryAssetManifest,
  GeometryAssetRecord,
} from '@/contracts/modeling/geometry-assets'
import { normalizeGeometryAssetManifest } from '@/contracts/modeling/geometry-assets'
import { createMeshReconstructionProvenanceSchema } from '@/contracts/modeling/mesh-reconstruction.runtime-schema'

const geometryAssetSchemaVersionSchema = literalVersionSchema<GeometryAssetSchemaVersion>(
  GEOMETRY_ASSET_SCHEMA_VERSION,
  'schemaVersion',
  'Unsupported geometry asset schema version',
)

const geometryAssetManifestSchemaVersionSchema = literalVersionSchema<GeometryAssetManifestSchemaVersion>(
  GEOMETRY_ASSET_MANIFEST_SCHEMA_VERSION,
  'schemaVersion',
  'Unsupported geometry asset manifest schema version',
)

export const geometryAssetHashSchema = z
  .string()
  .regex(/^sha256:[a-f0-9]{64}$/, 'Geometry asset hash must be a sha256:<hex> content hash.')
  .transform((value) => value as GeometryAssetHash)

export const geometryAssetRecordSchema = z.object({
  schemaVersion: geometryAssetSchemaVersionSchema,
  assetId: geometryAssetIdSchema,
  hash: geometryAssetHashSchema,
  byteLength: z.number().int().positive('Geometry asset byte length must be positive.'),
  format: z.union([
    z.literal('step'),
    z.literal('stl'),
    z.literal('3mf'),
    z.literal('baked-occ'),
    z.literal('baked-mesh'),
  ]),
  mediaType: stringSchema.min(1),
  provenance: z.object({
    kind: z.union([z.literal('imported'), z.literal('generated')]),
    sourceName: stringSchema.min(1).optional(),
    sourceHash: geometryAssetHashSchema.optional(),
    sourceFormat: z.union([z.literal('step'), z.literal('stl'), z.literal('3mf')]).optional(),
    sourceStored: z.literal(false).optional(),
    generator: stringSchema.min(1).optional(),
    reconstruction: createMeshReconstructionProvenanceSchema(geometryAssetHashSchema).optional(),
  }).strict(),
  ownerFeatureIds: z.array(featureIdSchema),
}).strict().transform((value) => value as GeometryAssetRecord)

export const geometryAssetManifestSchema = z.object({
  schemaVersion: geometryAssetManifestSchemaVersionSchema,
  records: z.array(geometryAssetRecordSchema),
}).strict().superRefine((manifest, ctx) => {
  rejectConflictingAssetRecords(manifest.records, ctx, ['records'])
}).transform((value) => normalizeGeometryAssetManifest(value) as GeometryAssetManifest)

export const legacyGeometryAssetManifestSchema = z.array(geometryAssetRecordSchema).superRefine((records, ctx) => {
  rejectConflictingAssetRecords(records, ctx, [])
}).transform((records) =>
  normalizeGeometryAssetManifest({
    schemaVersion: GEOMETRY_ASSET_MANIFEST_SCHEMA_VERSION,
    records,
  }),
)

function rejectConflictingAssetRecords(
  records: readonly GeometryAssetRecord[],
  ctx: z.RefinementCtx,
  pathPrefix: (string | number)[],
) {
  const recordsById = new Map<string, GeometryAssetRecord>()
  for (const [index, record] of records.entries()) {
    const existing = recordsById.get(record.assetId)
    if (!existing) {
      recordsById.set(record.assetId, record)
      continue
    }

    if (!sameAssetContentMetadata(existing, record)) {
      ctx.addIssue({
        code: 'custom',
        message: `Geometry asset ${record.assetId} has conflicting content metadata.`,
        path: [...pathPrefix, index],
      })
    }
  }
}

function sameAssetContentMetadata(left: GeometryAssetRecord, right: GeometryAssetRecord) {
  return left.hash === right.hash
    && left.byteLength === right.byteLength
    && left.format === right.format
    && left.mediaType === right.mediaType
    && left.provenance.kind === right.provenance.kind
    && (left.provenance.sourceName ?? null) === (right.provenance.sourceName ?? null)
    && (left.provenance.sourceHash ?? null) === (right.provenance.sourceHash ?? null)
    && (left.provenance.sourceFormat ?? null) === (right.provenance.sourceFormat ?? null)
    && (left.provenance.sourceStored ?? null) === (right.provenance.sourceStored ?? null)
    && (left.provenance.generator ?? null) === (right.provenance.generator ?? null)
    && JSON.stringify(left.provenance.reconstruction ?? null) === JSON.stringify(right.provenance.reconstruction ?? null)
}
