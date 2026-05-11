import type { AuthoredModelDocument } from "@/contracts/modeling/authored-document";
import type { CommitSketchRequest } from "@/contracts/modeling/schema";
import type { SketchPlaneDefinition } from "@/contracts/shared/sketch-plane";
import type { SketchId } from "@/contracts/shared/ids";
import type { SketchDefinition } from "@/contracts/sketch/schema";

export interface DurableHistoryAvailability {
  canUndo: boolean;
  canRedo: boolean;
}

export type PersistedSketchHistoryCursor =
  | { kind: "empty" }
  | { kind: "item"; itemId: string };

export interface PersistedSketchHistoryOperation {
  itemId: string;
  beforeCursor: PersistedSketchHistoryCursor;
  beforeDefinition: SketchDefinition;
  afterDefinition: SketchDefinition;
}

export interface PersistedSketchDraftSession {
  sketchId: SketchId | null;
  sketchLabel: string;
  plane: SketchPlaneDefinition;
  definition: SketchDefinition;
  fullDefinition: SketchDefinition;
  historyCursor: PersistedSketchHistoryCursor;
  historyOperations: PersistedSketchHistoryOperation[];
  sequence: number;
  commitRequest: Omit<
    CommitSketchRequest,
    "contractVersion" | "documentId" | "baseRevisionId"
  > | null;
}

export interface DraftHistoryEntry<TSession> {
  current: TSession;
  undoStack: TSession[];
  redoStack: TSession[];
}

export interface DocumentLocalDurableHistoryState {
  undoStack: AuthoredModelDocument[];
  redoStack: AuthoredModelDocument[];
  draftSessions: Record<string, DraftHistoryEntry<PersistedSketchDraftSession>>;
}

export function createEmptyDocumentLocalDurableHistoryState(): DocumentLocalDurableHistoryState {
  return {
    undoStack: [],
    redoStack: [],
    draftSessions: {},
  };
}
