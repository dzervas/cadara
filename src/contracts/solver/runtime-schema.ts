import { z } from "zod";

import type {
  DeriveSketchRegionsRequest,
  DisposeInteractiveSketchSolveSessionRequest,
  FinalizeInteractiveSketchSolveSessionRequest,
  ProjectSketchExternalReferencesRequest,
  ResolveSketchReferenceRequest,
  SolveSketchRequest,
  SolverSchemaVersion,
  StartInteractiveSketchSolveSessionRequest,
  UpdateInteractiveSketchSolveSessionRequest,
  ValidateSketchRequest,
} from "@/contracts/solver/schema";
import {
  sketchDefinitionSchema,
  solvedSketchSnapshotSchema,
} from "@/contracts/sketch/runtime-schema";
import { sketchPlaneFrameSchema } from "@/contracts/shared/sketch-plane.runtime-schema";
import {
  contractVersionSchema,
  documentIdSchema,
  literalVersionSchema,
  point2dSchema,
  requestIdSchema,
  revisionIdSchema,
  sketchIdSchema,
  sketchPointIdSchema,
} from "@/contracts/shared/runtime-schema";
import { SOLVER_SCHEMA_VERSION } from "@/contracts/solver/schema";

export const solverSchemaVersionSchema =
  literalVersionSchema<SolverSchemaVersion>(
    SOLVER_SCHEMA_VERSION,
    "solverSchemaVersion",
    "Unsupported solver schema version",
  );

export const sketchSolverEnvelopeSchema = z
  .object({
    contractVersion: contractVersionSchema,
    solverSchemaVersion: solverSchemaVersionSchema,
    requestId: requestIdSchema,
    documentId: documentIdSchema,
    revisionId: revisionIdSchema,
    sketchId: sketchIdSchema,
  })
  .passthrough();

export const projectSketchExternalReferencesRequestSchema =
  sketchSolverEnvelopeSchema
    .extend({
      plane: sketchPlaneFrameSchema,
      tolerances: z.unknown(),
      references: z.array(z.unknown()),
    })
    .transform(
      (value) => value as unknown as ProjectSketchExternalReferencesRequest,
    );

export const validateSketchRequestSchema = sketchSolverEnvelopeSchema
  .extend({
    plane: sketchPlaneFrameSchema,
    definition: sketchDefinitionSchema,
    tolerances: z.unknown(),
    projectedReferences: z.array(z.unknown()),
  })
  .transform((value) => value as unknown as ValidateSketchRequest);

export const solveSketchRequestSchema = sketchSolverEnvelopeSchema
  .extend({
    plane: sketchPlaneFrameSchema,
    definition: sketchDefinitionSchema,
    tolerances: z.unknown(),
    partialSolvePolicy: z.union([
      z.literal("bestEffort"),
      z.literal("failOnConflict"),
    ]),
    projectedReferences: z.array(z.unknown()),
    includeRegions: z.boolean().optional(),
  })
  .transform((value) => value as unknown as SolveSketchRequest);

const interactiveSketchSolveSessionIdSchema = z
  .string()
  .regex(
    /^interactive_sketch_solve_.+$/,
    "Interactive solve session ID is invalid.",
  );

const solverDraggedSketchPointTargetSchema = z.object({
  kind: z.literal("sketchPoint"),
  pointId: sketchPointIdSchema,
  position: point2dSchema,
});

export const startInteractiveSketchSolveSessionRequestSchema =
  sketchSolverEnvelopeSchema
    .extend({
      plane: sketchPlaneFrameSchema,
      definition: sketchDefinitionSchema,
      tolerances: z.unknown(),
      partialSolvePolicy: z.union([
        z.literal("bestEffort"),
        z.literal("failOnConflict"),
      ]),
      projectedReferences: z.array(z.unknown()),
      priorSolvedSnapshot: solvedSketchSnapshotSchema.nullish(),
      strategy: z
        .union([
          z.literal("bfgs"),
          z.literal("gradientDescent"),
          z.literal("gaussNewton"),
          z.literal("levenbergMarquardt"),
        ])
        .optional(),
    })
    .transform(
      (value) => value as unknown as StartInteractiveSketchSolveSessionRequest,
    );

export const updateInteractiveSketchSolveSessionRequestSchema =
  sketchSolverEnvelopeSchema
    .extend({
      sessionId: interactiveSketchSolveSessionIdSchema,
      dragTarget: solverDraggedSketchPointTargetSchema,
    })
    .transform(
      (value) => value as unknown as UpdateInteractiveSketchSolveSessionRequest,
    );

export const finalizeInteractiveSketchSolveSessionRequestSchema =
  sketchSolverEnvelopeSchema
    .extend({
      sessionId: interactiveSketchSolveSessionIdSchema,
    })
    .transform(
      (value) =>
        value as unknown as FinalizeInteractiveSketchSolveSessionRequest,
    );

export const disposeInteractiveSketchSolveSessionRequestSchema =
  sketchSolverEnvelopeSchema
    .extend({
      sessionId: interactiveSketchSolveSessionIdSchema,
    })
    .transform(
      (value) =>
        value as unknown as DisposeInteractiveSketchSolveSessionRequest,
    );

export const deriveSketchRegionsRequestSchema = sketchSolverEnvelopeSchema
  .extend({
    definition: sketchDefinitionSchema,
    solvedSnapshot: solvedSketchSnapshotSchema,
    projectedReferences: z.array(z.unknown()),
  })
  .transform((value) => value as unknown as DeriveSketchRegionsRequest);

export const resolveSketchReferenceRequestSchema = sketchSolverEnvelopeSchema
  .extend({
    definition: sketchDefinitionSchema,
    target: z.unknown(),
  })
  .transform((value) => value as unknown as ResolveSketchReferenceRequest);
