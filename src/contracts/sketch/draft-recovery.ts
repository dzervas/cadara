import type { DocumentId, SketchId } from "@/contracts/shared/ids";
import type { SketchPlaneDefinition } from "@/contracts/shared/sketch-plane";
import type { SketchDefinition } from "./schema";

/** Local-only authored data. Never contains cached solves, regions or gestures. */
export interface SketchDraftCheckpoint {
  documentId: DocumentId;
  sketchId: SketchId;
  publishedRevision: string | null;
  published: boolean;
  label: string;
  plane: SketchPlaneDefinition;
  definition: SketchDefinition;
  sequence: number;
  completedActions: number;
}

export interface PersistedSketchDraft extends SketchDraftCheckpoint {
  version: 1;
  persistedAt: number;
}

export interface SketchDraftRecoveryStore {
  load(documentId: DocumentId): PersistedSketchDraft | null;
  save(draft: PersistedSketchDraft): void;
  clear(documentId: DocumentId): void;
}
