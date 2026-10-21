import typia from "typia";
import type { PersistedSketchDraft } from "./draft-recovery";

export const validatePersistedSketchDraft = typia.createValidateEquals<PersistedSketchDraft>();
