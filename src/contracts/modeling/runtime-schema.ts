import { z } from 'zod'

import type {
  CommitSketchResponse,
  AddDocumentVariableResponse,
  CreateFeatureResponse,
  DeleteFeatureResponse,
  DocumentVariableRecord,
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
  RenameBodyResponse,
  ResolvedReferenceRecord,
  ResolveReferenceResponse,
  ReorderDocumentHistoryResponse,
  ReorderFeatureResponse,
  SetFeatureCursorResponse,
  UpdateDocumentVariableResponse,
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
import { durableRefSchema, edgeRefSchema, vertexRefSchema } from '@/contracts/shared/references.runtime-schema'
import { sketchPlaneDefinitionSchema } from '@/contracts/shared/sketch-plane.runtime-schema'
import {
  bodyIdSchema,
  contractVersionSchema,
  documentIdSchema,
  documentVariableIdSchema,
  faceIdSchema,
  featureIdSchema,
  literalVersionSchema,
  numberSchema,
  positiveNumberSchema,
  previewIdSchema,
  revisionIdSchema,
  sketchIdSchema,
  stringSchema,
  vertexIdSchema,
} from '@/contracts/shared/runtime-schema'
import type {
  ExtrudeFeatureSchemaVersion,
  FilletFeatureSchemaVersion,
  PlaneFeatureSchemaVersion,
  RevolveFeatureSchemaVersion,
  ShellFeatureSchemaVersion,
  SnapshotSchemaVersion,
} from '@/contracts/shared/versioning'
import type { AuthoredValue } from '@/contracts/modeling/authored-values'
import {
  EXTRUDE_FEATURE_SCHEMA_VERSION,
  FILLET_FEATURE_SCHEMA_VERSION,
  PLANE_FEATURE_SCHEMA_VERSION,
  REVOLVE_FEATURE_SCHEMA_VERSION,
  SHELL_FEATURE_SCHEMA_VERSION,
  SNAPSHOT_SCHEMA_VERSION,
  STEP_IMPORT_FEATURE_SCHEMA_VERSION,
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
    kind: z.literal('sketch'),
    sketchId: sketchIdSchema,
  }),
  z.object({
    kind: z.literal('feature'),
    featureId: featureIdSchema,
  }),
]).transform((value) => value as DocumentFeatureCursor)

const documentHistoryOrderEntrySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('sketch'),
    sketchId: sketchIdSchema,
  }),
  z.object({
    kind: z.literal('feature'),
    featureId: featureIdSchema,
  }),
])

const advancedParticipantRoleSchema = z.union([
  z.literal('profile'),
  z.literal('path'),
  z.literal('guideCurve'),
  z.literal('lockProfileFace'),
  z.literal('lockProfileDirection'),
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

function authoredValueSchema<TValue>(valueSchema: z.ZodType<TValue>, label: string) {
  return z.union([
    z.object({
      source: z.literal('literal'),
      value: valueSchema,
    }).strict(),
    z.object({
      source: z.literal('expression'),
      valueText: z.string().trim().min(1, `${label} expression text is required.`),
    }).strict(),
    valueSchema.transform((value) => ({ source: 'literal' as const, value })),
  ]).transform((value) => value as AuthoredValue<TValue>)
}

function authoredEnumValueSchema<const TValues extends readonly [string, ...string[]]>(
  values: TValues,
  label: string,
) {
  return authoredValueSchema(z.enum(values), label)
}

const authoredPositiveNumberSchema = (message: string) =>
  authoredValueSchema(positiveNumberSchema(message), message)

const authoredNumberSchema = (label: string) => authoredValueSchema(numberSchema, label)
const authoredPositiveIntegerSchema = (label: string) =>
  authoredValueSchema(z.number().int().positive(`${label} must be a positive integer.`), label)
const authoredBooleanSchema = (label: string) => authoredValueSchema(z.boolean(), label)

const booleanOperationAuthoredSchema = authoredEnumValueSchema(['newBody', 'join', 'cut', 'intersect'], 'Boolean operation')
const advancedOperationIntentAuthoredSchema = authoredEnumValueSchema(['create', 'add', 'subtract', 'intersect'], 'Advanced operation intent')
const thickenSideAuthoredSchema = authoredEnumValueSchema(['oneSide', 'symmetric'], 'Thicken side')
const linearDirectionSchema = z.union([z.literal('positive'), z.literal('negative')])
const angularDirectionSchema = z.union([z.literal('clockwise'), z.literal('counterClockwise')])
const upToOffsetDirectionSchema = z.union([z.literal('shorten'), z.literal('extend')])
const linearUpToOffsetSchema = z.object({
  distance: authoredNumberSchema('Up-to offset'),
  direction: upToOffsetDirectionSchema,
}).strict()
const angularUpToOffsetSchema = z.object({
  angle: authoredNumberSchema('Up-to offset angle'),
  direction: upToOffsetDirectionSchema,
}).strict()
const extrudeBlindEndSchema = z.object({
  kind: z.literal('blind'),
  direction: linearDirectionSchema,
  distance: authoredPositiveNumberSchema('Extrude distance must be positive.'),
  draftAngle: authoredNumberSchema('Extrude draft angle').optional(),
}).strict()
const extrudeThroughAllEndSchema = z.object({
  kind: z.literal('throughAll'),
  direction: linearDirectionSchema,
  draftAngle: authoredNumberSchema('Extrude draft angle').optional(),
}).strict()
const extrudeEndSchema = z.discriminatedUnion('kind', [
  extrudeBlindEndSchema,
  z.object({
    kind: z.literal('upToNext'),
    direction: linearDirectionSchema,
    offset: linearUpToOffsetSchema.optional(),
    draftAngle: authoredNumberSchema('Extrude draft angle').optional(),
  }).strict(),
  z.object({
    kind: z.literal('upToFace'),
    direction: linearDirectionSchema,
    target: z.object({ kind: z.literal('face'), bodyId: bodyIdSchema, faceId: faceIdSchema }),
    offset: linearUpToOffsetSchema.optional(),
    draftAngle: authoredNumberSchema('Extrude draft angle').optional(),
  }).strict(),
  z.object({
    kind: z.literal('upToPart'),
    direction: linearDirectionSchema,
    target: z.object({ kind: z.literal('body'), bodyId: bodyIdSchema }),
    offset: linearUpToOffsetSchema.optional(),
    draftAngle: authoredNumberSchema('Extrude draft angle').optional(),
  }).strict(),
  z.object({
    kind: z.literal('upToVertex'),
    direction: linearDirectionSchema,
    target: z.object({ kind: z.literal('vertex'), bodyId: bodyIdSchema, vertexId: vertexIdSchema }),
    offset: linearUpToOffsetSchema.optional(),
    draftAngle: authoredNumberSchema('Extrude draft angle').optional(),
  }).strict(),
  extrudeThroughAllEndSchema,
])
const extrudeExtentSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('oneSide'),
    end: extrudeEndSchema,
  }).strict(),
  z.object({
    mode: z.literal('symmetric'),
    end: z.union([extrudeBlindEndSchema, extrudeThroughAllEndSchema]),
  }).strict(),
  z.object({
    mode: z.literal('twoSide'),
    firstEnd: extrudeEndSchema,
    secondEnd: extrudeEndSchema,
  }).strict(),
])
const legacyExtrudeEndExtentSchema = extrudeBlindEndSchema.transform((value) => ({
  kind: value.kind,
  direction: value.direction,
  distance: value.distance,
}))
const revolveBlindEndSchema = z.object({
  kind: z.literal('blind'),
  direction: angularDirectionSchema,
  angle: authoredPositiveNumberSchema('Revolve angle must be positive.'),
}).strict()
const revolveUpToEndSchemas = [
  z.object({
    kind: z.literal('upToNext'),
    direction: angularDirectionSchema,
    offset: angularUpToOffsetSchema.optional(),
  }).strict(),
  z.object({
    kind: z.literal('upToFace'),
    direction: angularDirectionSchema,
    target: z.object({ kind: z.literal('face'), bodyId: bodyIdSchema, faceId: faceIdSchema }),
    offset: angularUpToOffsetSchema.optional(),
  }).strict(),
  z.object({
    kind: z.literal('upToPart'),
    direction: angularDirectionSchema,
    target: z.object({ kind: z.literal('body'), bodyId: bodyIdSchema }),
    offset: angularUpToOffsetSchema.optional(),
  }).strict(),
  z.object({
    kind: z.literal('upToVertex'),
    direction: angularDirectionSchema,
    target: z.object({ kind: z.literal('vertex'), bodyId: bodyIdSchema, vertexId: vertexIdSchema }),
    offset: angularUpToOffsetSchema.optional(),
  }).strict(),
] as const
const revolveEndSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('full') }).strict(),
  revolveBlindEndSchema,
  ...revolveUpToEndSchemas,
])
const nonFullRevolveEndSchema = z.discriminatedUnion('kind', [
  revolveBlindEndSchema,
  ...revolveUpToEndSchemas,
])
const revolveExplicitExtentSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('oneSide'),
    end: revolveEndSchema,
  }).strict(),
  z.object({
    mode: z.literal('symmetric'),
    end: revolveBlindEndSchema,
  }).strict(),
  z.object({
    mode: z.literal('twoSide'),
    firstEnd: nonFullRevolveEndSchema,
    secondEnd: nonFullRevolveEndSchema,
  }).strict(),
])
const legacyRevolveAngleExtentSchema = z.object({
  kind: z.literal('angle'),
  direction: angularDirectionSchema,
  radians: authoredPositiveNumberSchema('Revolve angle must be positive.'),
}).passthrough()

const extrudeDefinitionSchema = z.object({
  kind: z.literal('extrude'),
  featureTypeVersion: z.literal(EXTRUDE_FEATURE_SCHEMA_VERSION).transform((value) => value as ExtrudeFeatureSchemaVersion),
  parameters: z.object({
    profiles: z.array(z.union([
      z.object({ kind: z.literal('region'), sketchId: sketchIdSchema, regionId: z.string() }),
      z.object({ kind: z.literal('face'), bodyId: z.string(), faceId: z.string() }),
    ])).nonempty('Extrude profiles must be non-empty.'),
    startExtent: z.object({ kind: z.string() }).passthrough(),
    extent: extrudeExtentSchema.optional(),
    endExtent: legacyExtrudeEndExtentSchema.optional(),
    operation: booleanOperationAuthoredSchema,
    booleanScope: z.object({ kind: z.string() }).passthrough(),
  }).passthrough().superRefine((value, ctx) => {
    if (!value.extent && !value.endExtent) {
      ctx.addIssue({
        code: 'custom',
        message: 'Extrude parameters must include extent or legacy endExtent.',
      })
    }
  }),
})

const revolveDefinitionSchema = z.object({
  kind: z.literal('revolve'),
  featureTypeVersion: z.literal(REVOLVE_FEATURE_SCHEMA_VERSION).transform((value) => value as RevolveFeatureSchemaVersion),
  parameters: z.object({
    profiles: z.array(z.unknown()).nonempty('Revolve profiles must be non-empty.'),
    axis: z.unknown(),
    startAngle: authoredNumberSchema('Revolve start angle'),
    extent: z.union([revolveExplicitExtentSchema, legacyRevolveAngleExtentSchema]),
    angle: authoredPositiveNumberSchema('Revolve angle must be positive.').optional(),
    operation: booleanOperationAuthoredSchema,
    booleanScope: z.object({ kind: z.string() }).passthrough(),
  }).passthrough(),
})

const filletDefinitionSchema = z.object({
  kind: z.literal('fillet'),
  featureTypeVersion: z.literal(FILLET_FEATURE_SCHEMA_VERSION).transform((value) => value as FilletFeatureSchemaVersion),
  parameters: z.object({
    edgeTargets: z.array(z.unknown()),
    radius: authoredPositiveNumberSchema('Fillet radius must be positive.'),
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
    bodyTarget: z.object({ kind: z.literal('body'), bodyId: bodyIdSchema }),
    faceTargets: z.array(z.object({ kind: z.literal('face'), bodyId: bodyIdSchema, faceId: faceIdSchema })),
    thickness: authoredPositiveNumberSchema('Shell thickness must be positive.'),
    direction: z.union([z.literal('inside'), z.literal('outside')]).optional(),
    operation: booleanOperationAuthoredSchema.optional(),
    booleanScope: z.object({ kind: z.string() }).passthrough(),
  }).passthrough(),
})

const stepImportDefinitionSchema = z.object({
  kind: z.literal('stepImport'),
  featureTypeVersion: z.literal(STEP_IMPORT_FEATURE_SCHEMA_VERSION),
  parameters: z.object({
    assetId: z.string().regex(/^asset_.+$/, 'STEP import asset ID is invalid.'),
    unit: z.object({
      source: z.union([z.literal('file'), z.literal('user')]),
      resolvedUnit: z.union([
        z.literal('millimeter'),
        z.literal('centimeter'),
        z.literal('meter'),
        z.literal('inch'),
        z.literal('foot'),
      ]),
      scaleToDocument: positiveNumberSchema('STEP import unit scale must be positive.'),
    }).strict(),
    orientation: z.object({
      upAxis: z.union([z.literal('z'), z.literal('y')]),
      handedness: z.literal('rightHanded'),
    }).strict(),
    placement: z.object({
      translation: z.tuple([numberSchema, numberSchema, numberSchema]),
      rotationEulerRadians: z.tuple([numberSchema, numberSchema, numberSchema]),
      scale: positiveNumberSchema('STEP import placement scale must be positive.'),
    }).strict(),
    label: stringSchema.trim().min(1, 'STEP import label is required.'),
  }).strict(),
}).transform((value) => value as FeatureDefinition)

const advancedOptionsAuthoredSchema = z.record(z.string(), z.unknown()).optional().transform((options) => {
  if (!options) {
    return options
  }

  const next = { ...options }
  if ('distance' in next) {
    next.distance = authoredPositiveNumberSchema('Advanced distance must be positive.').parse(next.distance)
  }
  if ('thickness' in next) {
    next.thickness = authoredPositiveNumberSchema('Advanced thickness must be positive.').parse(next.thickness)
  }
  if ('copy' in next) {
    next.copy = authoredBooleanSchema('Mirror copy').parse(next.copy)
  }
  if ('path' in next) {
    next.path = z.object({
      sectionCount: authoredPositiveIntegerSchema('Section count'),
    }).strict().parse(next.path)
  }
  if ('sectionCount' in next) {
    next.sectionCount = authoredPositiveIntegerSchema('Section count').parse(next.sectionCount)
  }
  if ('guideContinuity' in next) {
    next.guideContinuity = authoredEnumValueSchema(
      ['none', 'normalToGuide', 'tangentToGuide', 'matchTangent', 'matchCurvature'],
      'Loft guide continuity',
    ).parse(next.guideContinuity)
  }
  if ('profileConditions' in next) {
    next.profileConditions = z.object({
      startCondition: authoredEnumValueSchema(['none', 'normal', 'tangent'], 'Loft start condition'),
      startMagnitude: authoredPositiveNumberSchema('Loft start condition magnitude').optional(),
      endCondition: authoredEnumValueSchema(['none', 'normal', 'tangent'], 'Loft end condition'),
      endMagnitude: authoredPositiveNumberSchema('Loft end condition magnitude').optional(),
    }).strict().parse(next.profileConditions)
  }
  if ('matchConnections' in next) {
    next.matchConnections = z.array(z.object({
      from: z.union([edgeRefSchema, vertexRefSchema]),
      to: z.union([edgeRefSchema, vertexRefSchema]),
    }).strict()).parse(next.matchConnections)
  }
  if ('profileControl' in next) {
    next.profileControl = authoredEnumValueSchema(
      ['none', 'keepProfileOrientation', 'lockProfileFaces', 'lockProfileDirection'],
      'Sweep profile control',
    ).parse(next.profileControl)
  }
  if ('twist' in next) {
    next.twist = z.discriminatedUnion('type', [
      z.object({ type: z.literal('none') }).strict(),
      z.object({
        type: z.literal('turns'),
        turns: authoredPositiveNumberSchema('Sweep twist turns must be positive.'),
      }).strict(),
      z.object({
        type: z.literal('angle'),
        angle: authoredNumberSchema('Sweep twist angle'),
      }).strict(),
      z.object({
        type: z.literal('pitch'),
        pitch: authoredPositiveNumberSchema('Sweep twist pitch must be positive.'),
      }).strict(),
    ]).parse(next.twist)
  }
  if ('endScale' in next) {
    next.endScale = authoredPositiveNumberSchema('Sweep end scale must be positive.').parse(next.endScale)
  }
  if ('side' in next) {
    next.side = thickenSideAuthoredSchema.parse(next.side)
  }

  return next
})

const advancedDefinitionSchema = z.object({
  kind: z.union([
    z.literal('combine'),
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
    operationIntent: z.union([advancedOperationIntentAuthoredSchema, advancedOperationIntentSchema]).optional(),
    options: advancedOptionsAuthoredSchema,
  }),
}).transform((value) => value as AdvancedSolidFeatureDefinition)

export const featureDefinitionSchema = z.union([
  extrudeDefinitionSchema,
  revolveDefinitionSchema,
  filletDefinitionSchema,
  planeDefinitionSchema,
  shellDefinitionSchema,
  stepImportDefinitionSchema,
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
  featureId: featureIdSchema.nullable().optional(),
  fieldId: stringSchema.nullable().optional(),
  fieldPath: z.array(z.union([stringSchema, z.number().int().nonnegative()])).optional(),
  repairGuidance: stringSchema.nullable().optional(),
  target: durableRefSchema.nullable(),
  detail: z.object({
    kind: stringSchema,
  }).passthrough().nullable(),
}).transform((value) => value as ModelingDiagnostic)

export const documentVariableRecordSchema = z.object({
  variableId: documentVariableIdSchema,
  name: stringSchema,
  valueText: stringSchema,
}).strict().transform((value) => value as DocumentVariableRecord)

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
  variables: z.array(documentVariableRecordSchema),
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
    documentHistory: z.array(z.unknown()),
    entities: z.array(z.unknown()),
  }),
  provenance: z.object({
    repositoryHeads: z.array(z.string()),
    repositorySource: z.union([
      z.literal('local'),
      z.literal('peer'),
      z.literal('restore'),
      z.literal('seed'),
      z.literal('reset'),
    ]).nullable(),
  }).nullable().optional(),
}).transform((value) => {
  const document = value.document
  const presentation = value.presentation

  return {
    document,
    presentation,
    provenance: value.provenance ?? null,
    contractVersion: document.contractVersion,
    schemaVersion: document.schemaVersion,
    documentId: document.documentId,
    revisionId: document.revisionId,
    settings: document.settings,
    capabilities: document.capabilities,
    featureTree: presentation.featureTree,
    objects: presentation.objects,
    documentHistory: presentation.documentHistory,
    features: document.features,
    cursor: document.cursor,
    sketches: document.sketches,
    bodies: document.bodies,
    constructions: document.constructions,
    variables: document.variables,
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

export const renameBodyResponseSchema = modelingOperationResponseBaseSchema.extend({
  bodyId: bodyIdSchema,
}).transform((value) => value as RenameBodyResponse)

export const addDocumentVariableResponseSchema = modelingOperationResponseBaseSchema.extend({
  variableId: documentVariableIdSchema,
}).transform((value) => value as AddDocumentVariableResponse)

export const updateDocumentVariableResponseSchema = modelingOperationResponseBaseSchema.extend({
  variableId: documentVariableIdSchema,
}).transform((value) => value as UpdateDocumentVariableResponse)

export const reorderFeatureResponseSchema = modelingOperationResponseBaseSchema.extend({
  featureId: featureIdSchema,
  beforeFeatureId: featureIdSchema.nullable(),
}).transform((value) => value as ReorderFeatureResponse)

export const reorderDocumentHistoryResponseSchema = modelingOperationResponseBaseSchema.extend({
  item: documentHistoryOrderEntrySchema,
  beforeItem: documentHistoryOrderEntrySchema.nullable(),
}).transform((value) => value as ReorderDocumentHistoryResponse)

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
