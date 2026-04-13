import { z } from 'zod'

import type {
  CommitSketchResponse,
  CreateFeatureResponse,
  DeleteFeatureResponse,
  DocumentFeatureCursor,
  DocumentSnapshot,
  EvaluatePreviewResponse,
  FeatureDefinition,
  GetDocumentSnapshotResponse,
  InvalidReferenceDetailPayload,
  KernelDocumentSnapshot,
  ModelingDiagnostic,
  MutationRevisionState,
  RebuildResult,
  ReferenceRecord,
  ResolvedReferenceRecord,
  ResolveReferenceResponse,
  ReorderFeatureResponse,
  SetFeatureCursorResponse,
  UpdateFeatureResponse,
  WorkspaceSnapshot,
} from '@/contracts/modeling/schema'
import {
  ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
  type AdvancedParticipantRole,
  type AdvancedSolidFeatureDefinition,
  type AdvancedSolidOperationIntent,
} from '@/contracts/modeling/advanced-solid'
import { renderExportSchema } from '@/contracts/render/runtime-schema'
import { sketchDefinitionSchema } from '@/contracts/sketch/runtime-schema'
import { durableRefSchema } from '@/contracts/shared/references.runtime-schema'
import { sketchPlaneDefinitionSchema } from '@/contracts/shared/sketch-plane.runtime-schema'
import {
  bodyIdSchema,
  contractVersionSchema,
  documentIdSchema,
  featureIdSchema,
  literalVersionSchema,
  numberSchema,
  positiveNumberSchema,
  previewIdSchema,
  revisionIdSchema,
  sketchIdSchema,
  stringSchema,
} from '@/contracts/shared/runtime-schema'
import type {
  ExtrudeFeatureSchemaVersion,
  FilletFeatureSchemaVersion,
  PlaneFeatureSchemaVersion,
  RevolveFeatureSchemaVersion,
  ShellFeatureSchemaVersion,
  SnapshotSchemaVersion,
} from '@/contracts/shared/versioning'
import {
  EXTRUDE_FEATURE_SCHEMA_VERSION,
  FILLET_FEATURE_SCHEMA_VERSION,
  PLANE_FEATURE_SCHEMA_VERSION,
  REVOLVE_FEATURE_SCHEMA_VERSION,
  SHELL_FEATURE_SCHEMA_VERSION,
  SNAPSHOT_SCHEMA_VERSION,
} from '@/contracts/shared/versioning'

export const snapshotSchemaVersionSchema = literalVersionSchema<SnapshotSchemaVersion>(
  SNAPSHOT_SCHEMA_VERSION,
  'schemaVersion',
  'Unsupported snapshot schema version',
)

const documentFeatureCursorSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('empty'),
  }),
  z.object({
    kind: z.literal('feature'),
    featureId: featureIdSchema,
  }),
]).transform((value) => value as DocumentFeatureCursor)

const advancedParticipantRoleSchema = z.union([
  z.literal('profile'),
  z.literal('path'),
  z.literal('guideCurve'),
  z.literal('face'),
  z.literal('edge'),
  z.literal('body'),
  z.literal('toolBody'),
  z.literal('targetBody'),
  z.literal('plane'),
  z.literal('axis'),
  z.literal('transformReference'),
  z.literal('enclosingRegionSeed'),
]).transform((value) => value as AdvancedParticipantRole)

const advancedOperationIntentSchema = z.union([
  z.literal('create'),
  z.literal('add'),
  z.literal('subtract'),
  z.literal('intersect'),
]).transform((value) => value as AdvancedSolidOperationIntent)

const extrudeDefinitionSchema = z.object({
  kind: z.literal('extrude'),
  featureTypeVersion: z.literal(EXTRUDE_FEATURE_SCHEMA_VERSION).transform((value) => value as ExtrudeFeatureSchemaVersion),
  parameters: z.object({
    profiles: z.array(z.union([
      z.object({ kind: z.literal('region'), sketchId: sketchIdSchema, regionId: z.string() }),
      z.object({ kind: z.literal('face'), bodyId: z.string(), faceId: z.string() }),
    ])).nonempty('Extrude profiles must be non-empty.'),
    startExtent: z.object({ kind: z.string() }).passthrough(),
    endExtent: z.object({
      kind: z.literal('blind'),
      direction: z.union([z.literal('positive'), z.literal('negative')]),
      distance: positiveNumberSchema('Extrude distance must be positive.'),
    }).passthrough(),
    operation: z.union([z.literal('newBody'), z.literal('join'), z.literal('cut'), z.literal('intersect')]),
    booleanScope: z.object({ kind: z.string() }).passthrough(),
  }).passthrough(),
})

const revolveDefinitionSchema = z.object({
  kind: z.literal('revolve'),
  featureTypeVersion: z.literal(REVOLVE_FEATURE_SCHEMA_VERSION).transform((value) => value as RevolveFeatureSchemaVersion),
  parameters: z.object({
    profiles: z.array(z.unknown()).nonempty('Revolve profiles must be non-empty.'),
    axis: z.unknown(),
    startAngle: z.number(),
    extent: z.object({
      kind: z.literal('angle'),
      direction: z.union([z.literal('clockwise'), z.literal('counterClockwise')]),
      radians: z.number(),
    }).passthrough(),
    operation: z.union([z.literal('newBody'), z.literal('join'), z.literal('cut'), z.literal('intersect')]),
    booleanScope: z.object({ kind: z.string() }).passthrough(),
  }).passthrough(),
})

const filletDefinitionSchema = z.object({
  kind: z.literal('fillet'),
  featureTypeVersion: z.literal(FILLET_FEATURE_SCHEMA_VERSION).transform((value) => value as FilletFeatureSchemaVersion),
  parameters: z.object({
    edgeTargets: z.array(z.unknown()),
    radius: positiveNumberSchema('Fillet radius must be positive.'),
  }).passthrough(),
})

const planeDefinitionSchema = z.object({
  kind: z.literal('plane'),
  featureTypeVersion: z.literal(PLANE_FEATURE_SCHEMA_VERSION).transform((value) => value as PlaneFeatureSchemaVersion),
  parameters: z.object({
    mode: z.literal('coplanar'),
    reference: z.object({
      target: durableRefSchema,
    }),
  }).passthrough(),
})

const shellDefinitionSchema = z.object({
  kind: z.literal('shell'),
  featureTypeVersion: z.literal(SHELL_FEATURE_SCHEMA_VERSION).transform((value) => value as ShellFeatureSchemaVersion),
  parameters: z.object({
    faces: z.array(z.unknown()),
    thickness: positiveNumberSchema('Shell thickness must be positive.'),
  }).passthrough(),
})

const advancedDefinitionSchema = z.object({
  kind: z.union([
    z.literal('sweep'),
    z.literal('loft'),
    z.literal('wrap'),
    z.literal('thicken'),
    z.literal('enclose'),
    z.literal('split'),
    z.literal('deleteSolid'),
    z.literal('faceBlend'),
    z.literal('chamfer'),
    z.literal('hole'),
    z.literal('externalThread'),
    z.literal('mirror'),
    z.literal('transform'),
  ]),
  featureTypeVersion: z.literal(ADVANCED_SOLID_FEATURE_SCHEMA_VERSION),
  parameters: z.object({
    participants: z.array(z.object({
      role: advancedParticipantRoleSchema,
      targets: z.array(durableRefSchema),
    })),
    operationIntent: advancedOperationIntentSchema.optional(),
    options: z.record(z.string(), z.unknown()).optional(),
  }),
}).transform((value) => value as AdvancedSolidFeatureDefinition)

export const featureDefinitionSchema = z.union([
  extrudeDefinitionSchema,
  revolveDefinitionSchema,
  filletDefinitionSchema,
  planeDefinitionSchema,
  shellDefinitionSchema,
  advancedDefinitionSchema,
]).transform((value) => value as FeatureDefinition)

const invalidReferenceDetailSchema = z.object({
  reason: stringSchema,
  target: durableRefSchema,
  ownerFeatureId: featureIdSchema.nullable(),
  ownerSketchId: sketchIdSchema.nullable(),
  sourceTarget: durableRefSchema.nullable(),
}).transform((value) => value as InvalidReferenceDetailPayload)

export const modelingDiagnosticSchema = z.object({
  code: stringSchema,
  severity: z.union([z.literal('info'), z.literal('warning'), z.literal('error')]),
  message: stringSchema,
  target: durableRefSchema.nullable(),
  detail: z.object({
    kind: stringSchema,
  }).passthrough().nullable(),
}).transform((value) => value as ModelingDiagnostic)

export const mutationRevisionStateSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('accepted'),
    baseRevisionId: revisionIdSchema,
  }),
  z.object({
    kind: z.literal('conflict'),
    expectedRevisionId: revisionIdSchema,
    actualRevisionId: revisionIdSchema,
  }),
  z.object({
    kind: z.literal('rejected'),
    baseRevisionId: revisionIdSchema,
    reasonCode: stringSchema,
  }),
]).transform((value) => value as MutationRevisionState)

export const rebuildResultSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('rebuilt'),
    revisionId: revisionIdSchema,
    invalidatedTargets: z.array(durableRefSchema),
    diagnostics: z.array(modelingDiagnosticSchema),
  }),
  z.object({
    kind: z.literal('skipped'),
    reasonCode: z.union([z.literal('revisionConflict'), z.literal('validationRejected'), z.literal('noOp')]),
    invalidatedTargets: z.array(durableRefSchema),
    diagnostics: z.array(modelingDiagnosticSchema),
  }),
  z.object({
    kind: z.literal('failed'),
    revisionId: revisionIdSchema,
    reasonCode: stringSchema,
    invalidatedTargets: z.array(durableRefSchema),
    diagnostics: z.array(modelingDiagnosticSchema),
  }),
]).transform((value) => value as RebuildResult)

export const previewFreshnessSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('fresh'),
    baseRevisionId: revisionIdSchema,
  }),
  z.object({
    kind: z.literal('stale'),
    requestedRevisionId: revisionIdSchema,
    currentRevisionId: revisionIdSchema,
  }),
])

const featureSnapshotRecordSchema = z.object({
  featureId: featureIdSchema,
  definition: featureDefinitionSchema,
}).passthrough()

const sketchSnapshotRecordSchema = z.object({
  sketchId: sketchIdSchema,
  sketch: z.object({
    definition: sketchDefinitionSchema,
  }).passthrough(),
  plane: sketchPlaneDefinitionSchema,
  planeTarget: durableRefSchema,
  planeKey: z.union([z.literal('xy'), z.literal('yz'), z.literal('xz')]).nullable(),
}).passthrough()

export const kernelDocumentSnapshotSchema = z.object({
  contractVersion: contractVersionSchema,
  schemaVersion: snapshotSchemaVersionSchema,
  documentId: documentIdSchema,
  revisionId: revisionIdSchema,
  settings: z.object({
    linearUnit: z.literal('millimeter'),
    modelingTolerance: numberSchema,
    angularToleranceRadians: numberSchema,
  }),
  capabilities: z.object({
    supportedFeatureKinds: z.array(z.string()),
    previewableFeatureKinds: z.array(z.string()),
    supportedProfileKinds: z.array(z.string()),
    supportsFaceBackedSketchPlanes: z.boolean(),
    supportsDurableTopologyNaming: z.boolean(),
  }),
  featureTree: z.array(z.unknown()),
  objects: z.array(z.unknown()),
  features: z.array(featureSnapshotRecordSchema),
  cursor: documentFeatureCursorSchema,
  sketches: z.array(sketchSnapshotRecordSchema),
  bodies: z.array(z.unknown()),
  constructions: z.array(z.unknown()),
  entities: z.array(z.unknown()),
  references: z.array(z.unknown()).transform((value) => value as ReferenceRecord[]),
  diagnostics: z.array(modelingDiagnosticSchema),
  render: renderExportSchema,
}).transform((value) => value as unknown as KernelDocumentSnapshot)

export const workspaceSnapshotSchema = z.object({
  document: kernelDocumentSnapshotSchema,
  presentation: z.object({
    featureTree: z.array(z.unknown()),
    objects: z.array(z.unknown()),
    entities: z.array(z.unknown()),
  }),
}).transform((value) => {
  const document = value.document
  const presentation = value.presentation

  return {
    document,
    presentation,
    contractVersion: document.contractVersion,
    schemaVersion: document.schemaVersion,
    documentId: document.documentId,
    revisionId: document.revisionId,
    settings: document.settings,
    capabilities: document.capabilities,
    featureTree: presentation.featureTree,
    objects: presentation.objects,
    features: document.features,
    cursor: document.cursor,
    sketches: document.sketches,
    bodies: document.bodies,
    constructions: document.constructions,
    entities: presentation.entities,
    references: document.references,
    diagnostics: document.diagnostics,
    render: document.render,
  } as WorkspaceSnapshot
})

export const getDocumentSnapshotResponseSchema = z.object({
  contractVersion: contractVersionSchema,
  snapshot: workspaceSnapshotSchema,
}).transform((value) => value as GetDocumentSnapshotResponse)

const modelingOperationResponseBaseSchema = z.object({
  contractVersion: contractVersionSchema,
  documentId: documentIdSchema,
  revisionId: revisionIdSchema,
  revisionState: mutationRevisionStateSchema,
  rebuildResult: rebuildResultSchema,
  changedTargets: z.array(durableRefSchema),
  diagnostics: z.array(modelingDiagnosticSchema),
})

export const createFeatureResponseSchema = modelingOperationResponseBaseSchema.extend({
  featureId: featureIdSchema,
}).transform((value) => value as CreateFeatureResponse)

export const updateFeatureResponseSchema = modelingOperationResponseBaseSchema.extend({
  featureId: featureIdSchema,
}).transform((value) => value as UpdateFeatureResponse)

export const deleteFeatureResponseSchema = modelingOperationResponseBaseSchema.extend({
  deletedFeatureId: featureIdSchema,
}).transform((value) => value as DeleteFeatureResponse)

export const reorderFeatureResponseSchema = modelingOperationResponseBaseSchema.extend({
  featureId: featureIdSchema,
  beforeFeatureId: featureIdSchema.nullable(),
}).transform((value) => value as ReorderFeatureResponse)

export const setFeatureCursorResponseSchema = modelingOperationResponseBaseSchema.extend({
  cursor: documentFeatureCursorSchema,
}).transform((value) => value as SetFeatureCursorResponse)

export const commitSketchResponseSchema = modelingOperationResponseBaseSchema.extend({
  sketchId: sketchIdSchema,
}).transform((value) => value as CommitSketchResponse)

export const evaluatePreviewResponseSchema = z.object({
  contractVersion: contractVersionSchema,
  documentId: documentIdSchema,
  revisionId: revisionIdSchema,
  previewId: previewIdSchema,
  freshness: previewFreshnessSchema,
  render: renderExportSchema,
  diagnostics: z.array(modelingDiagnosticSchema),
}).transform((value) => value as EvaluatePreviewResponse)

export const resolvedReferenceRecordSchema = z.object({
  label: stringSchema,
  target: durableRefSchema,
  ownerDocumentId: documentIdSchema,
  ownerRevisionId: revisionIdSchema,
  ownerFeatureId: featureIdSchema.nullable(),
  ownerSketchId: sketchIdSchema.nullable(),
  ownerBodyId: bodyIdSchema.nullable(),
  invalidation: invalidReferenceDetailSchema.nullable(),
}).transform((value) => value as ResolvedReferenceRecord)

export const resolveReferenceResponseSchema = z.object({
  contractVersion: contractVersionSchema,
  resolution: resolvedReferenceRecordSchema,
  diagnostics: z.array(modelingDiagnosticSchema),
}).transform((value) => value as ResolveReferenceResponse)

export const modelingDocumentRequestEnvelopeSchema = z.object({
  contractVersion: contractVersionSchema,
  documentId: documentIdSchema,
}).passthrough()

export const modelingMutationRequestEnvelopeSchema = modelingDocumentRequestEnvelopeSchema.extend({
  baseRevisionId: revisionIdSchema,
}).passthrough()

export function parseWorkspaceSnapshot(value: unknown): DocumentSnapshot {
  return workspaceSnapshotSchema.parse(value) as DocumentSnapshot
}
