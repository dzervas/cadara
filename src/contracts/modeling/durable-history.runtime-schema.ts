import { z } from "zod";

import type {
  DocumentLocalDurableHistoryState,
  DurableHistoryAvailability,
  PersistedSketchDraftSession,
  PersistedSketchHistoryCursor,
  PersistedSketchHistoryOperation,
} from "@/contracts/modeling/durable-history";
import { authoredModelDocumentSchema } from "@/contracts/modeling/authored-document.runtime-schema";
import { sketchIdSchema } from "@/contracts/shared/runtime-schema";
import { sketchPlaneDefinitionSchema } from "@/contracts/shared/sketch-plane.runtime-schema";
import { sketchDefinitionSchema } from "@/contracts/sketch/runtime-schema";
import { stringSchema } from "@/contracts/shared/runtime-schema";

const persistedSketchHistoryCursorSchema = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("empty") }).strict(),
    z.object({ kind: z.literal("item"), itemId: stringSchema }).strict(),
  ])
  .transform((value) => value as PersistedSketchHistoryCursor);

const persistedSketchHistoryOperationSchema = z
  .object({
    itemId: stringSchema,
    beforeCursor: persistedSketchHistoryCursorSchema,
    beforeDefinition: sketchDefinitionSchema,
    afterDefinition: sketchDefinitionSchema,
  })
  .strict()
  .transform((value) => value as PersistedSketchHistoryOperation);

const persistedSketchCommitRequestSchema = z
  .object({
    solverCorrelation: z.null(),
    sketchId: sketchIdSchema.nullable(),
    sketchLabel: stringSchema,
    plane: sketchPlaneDefinitionSchema,
    definition: sketchDefinitionSchema,
  })
  .strict()
  .transform((value) => value as PersistedSketchDraftSession["commitRequest"]);

export const persistedSketchDraftSessionSchema = z
  .object({
    sketchId: sketchIdSchema.nullable(),
    sketchLabel: stringSchema,
    plane: sketchPlaneDefinitionSchema,
    definition: sketchDefinitionSchema,
    fullDefinition: sketchDefinitionSchema,
    historyCursor: persistedSketchHistoryCursorSchema,
    historyOperations: z.array(persistedSketchHistoryOperationSchema),
    sequence: z.number().int().nonnegative(),
    commitRequest: persistedSketchCommitRequestSchema.nullable(),
  })
  .strict()
  .transform((value) => value as PersistedSketchDraftSession);

const authoredDocumentStackSchema = z.array(authoredModelDocumentSchema);
const draftHistoryEntrySchema = z
  .object({
    current: persistedSketchDraftSessionSchema,
    undoStack: z.array(persistedSketchDraftSessionSchema),
    redoStack: z.array(persistedSketchDraftSessionSchema),
  })
  .strict();

export const documentLocalDurableHistoryStateSchema = z
  .object({
    undoStack: authoredDocumentStackSchema,
    redoStack: authoredDocumentStackSchema,
    draftSessions: z.record(stringSchema, draftHistoryEntrySchema),
  })
  .strict()
  .transform((value) => value as DocumentLocalDurableHistoryState);

export function parseDocumentLocalDurableHistoryState(value: unknown) {
  const result = documentLocalDurableHistoryStateSchema.safeParse(value);
  if (!result.success) {
    return {
      ok: false as const,
      message:
        result.error.issues[0]?.message ??
        "Durable history payload is invalid.",
    };
  }

  return {
    ok: true as const,
    state: result.data,
  };
}

export function createDurableHistoryAvailability(
  input: DurableHistoryAvailability,
): DurableHistoryAvailability {
  return {
    canUndo: input.canUndo,
    canRedo: input.canRedo,
  };
}
