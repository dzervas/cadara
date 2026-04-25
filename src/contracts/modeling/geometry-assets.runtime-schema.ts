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

const point3Schema = z.tuple([z.number(), z.number(), z.number()])
const triangleIndexSchema = z.tuple([
  z.number().int().nonnegative(),
  z.number().int().nonnegative(),
  z.number().int().nonnegative(),
])
const indexPairSchema = z.tuple([
  z.number().int().nonnegative(),
  z.number().int().nonnegative(),
])

const cadaraBrepTopologySchema = z.object({
  vertices: z.array(z.object({
    vertexKey: stringSchema.min(1),
    point: point3Schema,
  }).strict()).min(4),
  edges: z.array(z.object({
    edgeKey: stringSchema.min(1),
    vertices: indexPairSchema,
    curve: z.object({
      kind: z.literal('lineSegment'),
    }).strict(),
  }).strict()).min(6),
  coedges: z.array(z.object({
    coedgeKey: stringSchema.min(1),
    edgeIndex: z.number().int().nonnegative(),
    reversed: z.boolean(),
  }).strict()).min(1),
  loops: z.array(z.object({
    loopKey: stringSchema.min(1),
    coedgeIndices: z.array(z.number().int().nonnegative()).min(3),
  }).strict()).min(1),
  faces: z.array(z.object({
    faceKey: stringSchema.min(1),
    outerLoopIndex: z.number().int().nonnegative(),
    surface: z.object({
      kind: z.literal('plane'),
      origin: point3Schema,
      normal: point3Schema,
    }).strict(),
    triangles: z.array(triangleIndexSchema).min(1),
  }).strict()).min(4),
  shells: z.array(z.object({
    shellKey: stringSchema.min(1),
    faceIndices: z.array(z.number().int().nonnegative()).min(4),
    closed: z.literal(true),
  }).strict()).min(1),
  solids: z.array(z.object({
    solidKey: stringSchema.min(1),
    shellIndices: z.array(z.number().int().nonnegative()).min(1),
  }).strict()).min(1),
}).strict().superRefine((topology, ctx) => {
  for (const [index, edge] of topology.edges.entries()) {
    for (const vertexIndex of edge.vertices) {
      if (vertexIndex >= topology.vertices.length) {
        ctx.addIssue({
          code: 'custom',
          message: 'Cadara B-rep edge references a missing vertex.',
          path: ['edges', index, 'vertices'],
        })
      }
    }
  }

  for (const [index, coedge] of topology.coedges.entries()) {
    if (coedge.edgeIndex >= topology.edges.length) {
      ctx.addIssue({
        code: 'custom',
        message: 'Cadara B-rep coedge references a missing edge.',
        path: ['coedges', index, 'edgeIndex'],
      })
    }
  }

  for (const [index, loop] of topology.loops.entries()) {
    for (const coedgeIndex of loop.coedgeIndices) {
      if (coedgeIndex >= topology.coedges.length) {
        ctx.addIssue({
          code: 'custom',
          message: 'Cadara B-rep loop references a missing coedge.',
          path: ['loops', index, 'coedgeIndices'],
        })
      }
    }
  }

  for (const [index, face] of topology.faces.entries()) {
    if (face.outerLoopIndex >= topology.loops.length) {
      ctx.addIssue({
        code: 'custom',
        message: 'Cadara B-rep face references a missing loop.',
        path: ['faces', index, 'outerLoopIndex'],
      })
    }
    for (const triangle of face.triangles) {
      for (const vertexIndex of triangle) {
        if (vertexIndex >= topology.vertices.length) {
          ctx.addIssue({
            code: 'custom',
            message: 'Cadara B-rep face triangle references a missing vertex.',
            path: ['faces', index, 'triangles'],
          })
        }
      }
    }
  }

  for (const [index, shell] of topology.shells.entries()) {
    for (const faceIndex of shell.faceIndices) {
      if (faceIndex >= topology.faces.length) {
        ctx.addIssue({
          code: 'custom',
          message: 'Cadara B-rep shell references a missing face.',
          path: ['shells', index, 'faceIndices'],
        })
      }
    }
  }

  for (const [index, solid] of topology.solids.entries()) {
    for (const shellIndex of solid.shellIndices) {
      if (shellIndex >= topology.shells.length) {
        ctx.addIssue({
          code: 'custom',
          message: 'Cadara B-rep solid references a missing shell.',
          path: ['solids', index, 'shellIndices'],
        })
      }
    }
  }
})

const geometryAssetDataSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('cadaraBrep'),
    schemaVersion: z.literal('cadara-brep/v1alpha1'),
    source: z.object({
      importedFormat: z.literal('step'),
      sourceStored: z.literal(false),
      rootDocumentName: stringSchema.min(1).optional(),
    }).strict(),
    bodies: z.array(z.object({
      bodyKey: stringSchema.min(1),
      label: stringSchema.min(1),
      solidKey: stringSchema.min(1).optional(),
      topology: cadaraBrepTopologySchema,
    }).strict()).min(1),
  }).strict(),
  z.object({
    kind: z.literal('bakedMeshGeometry'),
    schemaVersion: z.literal('baked-mesh-geometry/v1alpha1'),
    vertices: z.array(point3Schema),
    indices: z.array(triangleIndexSchema),
  }).strict(),
])

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
    z.literal('cadara-brep'),
  ]),
  mediaType: stringSchema.min(1),
  provenance: z.object({
    kind: z.union([z.literal('imported'), z.literal('generated')]),
    sourceName: stringSchema.min(1).optional(),
    selectedFileName: stringSchema.min(1).optional(),
    stepDocumentName: stringSchema.min(1).optional(),
    sourceHash: geometryAssetHashSchema.optional(),
    sourceFormat: z.union([z.literal('step'), z.literal('stl'), z.literal('3mf')]).optional(),
    sourceStored: z.literal(false).optional(),
    generator: stringSchema.min(1).optional(),
    reconstruction: createMeshReconstructionProvenanceSchema(geometryAssetHashSchema).optional(),
  }).strict(),
  data: geometryAssetDataSchema.optional(),
  ownerFeatureIds: z.array(featureIdSchema),
}).strict().superRefine((record, ctx) => {
  if (record.format === 'cadara-brep' && record.data?.kind !== 'cadaraBrep') {
    ctx.addIssue({
      code: 'custom',
      message: 'STEP-imported geometry must be stored as translated Cadara B-rep JSON data.',
      path: ['data'],
    })
  }

  if (record.format === 'baked-mesh' && record.data?.kind !== 'bakedMeshGeometry') {
    ctx.addIssue({
      code: 'custom',
      message: 'Baked mesh geometry must be stored as structured JSON data.',
      path: ['data'],
    })
  }

  if (record.format !== 'cadara-brep' && record.format !== 'baked-mesh') {
    ctx.addIssue({
      code: 'custom',
      message: 'Only translated Cadara B-rep geometry and structured baked mesh geometry may be retained in authored documents.',
      path: ['format'],
    })
  }
}).transform((value) => value as GeometryAssetRecord)

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
    && (left.provenance.selectedFileName ?? null) === (right.provenance.selectedFileName ?? null)
    && (left.provenance.stepDocumentName ?? null) === (right.provenance.stepDocumentName ?? null)
    && (left.provenance.sourceHash ?? null) === (right.provenance.sourceHash ?? null)
    && (left.provenance.sourceFormat ?? null) === (right.provenance.sourceFormat ?? null)
    && (left.provenance.sourceStored ?? null) === (right.provenance.sourceStored ?? null)
    && (left.provenance.generator ?? null) === (right.provenance.generator ?? null)
    && JSON.stringify(left.provenance.reconstruction ?? null) === JSON.stringify(right.provenance.reconstruction ?? null)
    && JSON.stringify(left.data ?? null) === JSON.stringify(right.data ?? null)
}
