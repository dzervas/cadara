import { z } from 'zod'

import type {
  DeriveSketchRegionsRequest,
  ProjectSketchExternalReferencesRequest,
  ResolveSketchReferenceRequest,
  SolveSketchRequest,
  SolverSchemaVersion,
  ValidateSketchRequest,
} from '@/contracts/solver/schema'
import { sketchDefinitionSchema, solvedSketchSnapshotSchema } from '@/contracts/sketch/runtime-schema'
import { contractVersionSchema, documentIdSchema, literalVersionSchema, requestIdSchema, revisionIdSchema, sketchIdSchema } from '@/contracts/shared/runtime-schema'
import { SOLVER_SCHEMA_VERSION } from '@/contracts/solver/schema'

export const solverSchemaVersionSchema = literalVersionSchema<SolverSchemaVersion>(
  SOLVER_SCHEMA_VERSION,
  'solverSchemaVersion',
  'Unsupported solver schema version',
)

export const sketchSolverEnvelopeSchema = z.object({
  contractVersion: contractVersionSchema,
  solverSchemaVersion: solverSchemaVersionSchema,
  requestId: requestIdSchema,
  documentId: documentIdSchema,
  revisionId: revisionIdSchema,
  sketchId: sketchIdSchema,
}).passthrough()

export const projectSketchExternalReferencesRequestSchema = sketchSolverEnvelopeSchema.extend({
  references: z.array(z.unknown()),
  sketchPlane: z.unknown().optional(),
}).transform((value) => value as unknown as ProjectSketchExternalReferencesRequest)

export const validateSketchRequestSchema = sketchSolverEnvelopeSchema.extend({
  definition: sketchDefinitionSchema,
  tolerances: z.unknown(),
}).transform((value) => value as unknown as ValidateSketchRequest)

export const solveSketchRequestSchema = sketchSolverEnvelopeSchema.extend({
  definition: sketchDefinitionSchema,
  tolerances: z.unknown(),
  partialSolvePolicy: z.union([z.literal('bestEffort'), z.literal('failOnConflict')]),
  incrementalEdit: z.unknown().optional(),
}).transform((value) => value as unknown as SolveSketchRequest)

export const deriveSketchRegionsRequestSchema = sketchSolverEnvelopeSchema.extend({
  definition: sketchDefinitionSchema,
  solvedSnapshot: solvedSketchSnapshotSchema,
}).transform((value) => value as unknown as DeriveSketchRegionsRequest)

export const resolveSketchReferenceRequestSchema = sketchSolverEnvelopeSchema.extend({
  definition: sketchDefinitionSchema,
  target: z.unknown(),
}).transform((value) => value as unknown as ResolveSketchReferenceRequest)
