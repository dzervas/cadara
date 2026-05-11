import typia from "typia";

import type {
  DocumentLocalDurableHistoryState,
  DurableHistoryAvailability,
  PersistedSketchDraftSession,
} from "@/contracts/modeling/durable-history";
import { validateContract } from "@/contracts/shared/validation";

const persistedSketchDraftSessionValidator =
  typia.createValidateEquals<PersistedSketchDraftSession>();
const documentLocalDurableHistoryStateValidator =
  typia.createValidateEquals<DocumentLocalDurableHistoryState>();

export function validatePersistedSketchDraftSession(
  value: unknown,
) {
  return validateContract(persistedSketchDraftSessionValidator, value);
}

export function parseDocumentLocalDurableHistoryState(value: unknown) {
  const result = validateContract(
    documentLocalDurableHistoryStateValidator,
    value,
  );
  if (!result.success) {
    return {
      ok: false as const,
      message:
        result.issues[0]?.message ?? "Durable history payload is invalid.",
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
