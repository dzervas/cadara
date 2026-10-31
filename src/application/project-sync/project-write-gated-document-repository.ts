import type {
  DocumentRepository,
  DocumentRepositoryMutationResult,
} from "@/contracts/modeling/document-repository";
import type { DocumentId } from "@/contracts/shared/ids";
import {
  PROJECT_READ_ONLY_MESSAGE,
  PROJECT_READ_ONLY_REASON_CODE,
  type ProjectWriteGate,
} from "./project-write-gate";

function refusedStatus(documentId: DocumentId) {
  return {
    kind: "failed" as const,
    documentId,
    diagnostic: {
      reasonCode: PROJECT_READ_ONLY_REASON_CODE,
      message: PROJECT_READ_ONLY_MESSAGE,
    },
  };
}

function refused(documentId: DocumentId): DocumentRepositoryMutationResult {
  return { ok: false, status: refusedStatus(documentId) };
}

/**
 * Part documents' repository behind the project write gate: every write
 * (an edit, a replayed journal, an Undo or Redo, a new document) and the
 * reset that deletes this browser's copy are refused while the role cannot
 * edit parts. Reads, loads and the repository's other capabilities
 * (geometry assets, local files) pass through unchanged.
 */
export function createProjectWriteGatedDocumentRepository<
  T extends DocumentRepository | null,
>(repository: T, gate: Pick<ProjectWriteGate, "authorize">): T {
  if (!repository) return repository;
  const gated: Pick<
    DocumentRepository,
    | "initialize"
    | "mutate"
    | "undoDurableHistory"
    | "redoDurableHistory"
    | "reset"
  > = {
    initialize: (input) =>
      gate.authorize("part")
        ? repository.initialize(input)
        : Promise.resolve(refused(input.documentId)),
    mutate: (input) =>
      gate.authorize("part")
        ? repository.mutate(input)
        : Promise.resolve(refused(input.documentId)),
    undoDurableHistory: (documentId, actionSequence) =>
      gate.authorize("part")
        ? repository.undoDurableHistory(documentId, actionSequence)
        : Promise.resolve(refused(documentId)),
    redoDurableHistory: (documentId, actionSequence) =>
      gate.authorize("part")
        ? repository.redoDurableHistory(documentId, actionSequence)
        : Promise.resolve(refused(documentId)),
    reset: (documentId) =>
      gate.authorize("part")
        ? repository.reset(documentId)
        : Promise.resolve(refusedStatus(documentId)),
  };
  return new Proxy(repository, {
    get(target, property, receiver) {
      if (Object.hasOwn(gated, property))
        return gated[property as keyof typeof gated];
      const value: unknown = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
