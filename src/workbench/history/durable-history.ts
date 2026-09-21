import type { DurableHistoryAvailability } from "@/contracts/modeling/durable-history";
import type { DocumentId } from "@/contracts/shared/ids";
import type { WorkspaceSnapshot } from "@/contracts/modeling/schema";
import type { ModelingService } from "@/domain/modeling/modeling-service";
import type {
  DocumentRepository,
  DocumentRepositoryMetadata,
} from "@/domain/modeling/document-repository";
export interface DurableHistoryActionResult {
  context: "document";
  snapshot: WorkspaceSnapshot;
  availability: DurableHistoryAvailability;
}
export interface DurableHistoryService {
  getAvailability(input: {
    documentId: DocumentId;
  }): Promise<DurableHistoryAvailability>;
  undo(input: {
    documentId: DocumentId;
    actionSequence?: number;
  }): Promise<DurableHistoryActionResult | null>;
  redo(input: {
    documentId: DocumentId;
    actionSequence?: number;
  }): Promise<DurableHistoryActionResult | null>;
}
export const DEFAULT_REPOSITORY_SYNCHRONIZATION_TIMEOUT_MS = 90_000;
export function createDurableHistoryService(input: {
  documentRepository: DocumentRepository | null;
  modelingService: ModelingService;
  repositorySynchronizationTimeoutMs?: number;
}): DurableHistoryService {
  const { documentRepository, modelingService } = input;
  const repositorySynchronizationTimeoutMs =
    input.repositorySynchronizationTimeoutMs ??
    DEFAULT_REPOSITORY_SYNCHRONIZATION_TIMEOUT_MS;
  function sameRepositoryHeads(
    left: readonly string[],
    right: readonly string[],
  ) {
    return (
      left.length === right.length &&
      [...left].sort().every((head, index) => head === [...right].sort()[index])
    );
  }

  function repositoryChangeMatches(
    event: Parameters<
      ModelingService["subscribeToDocumentChanges"]
    >[0] extends (event: infer TEvent) => void
      ? TEvent
      : never,
    metadata: Pick<
      DocumentRepositoryMetadata,
      "documentId" | "heads" | "source"
    >,
  ) {
    return (
      event.documentId === metadata.documentId &&
      event.metadata.source === metadata.source &&
      sameRepositoryHeads(event.metadata.heads, metadata.heads)
    );
  }

  function createRepositoryChangeWaiter(documentId: DocumentId) {
    type DocumentChangeEvent = Parameters<
      ModelingService["subscribeToDocumentChanges"]
    >[0] extends (event: infer TEvent) => void
      ? TEvent
      : never;

    const seenEvents: DocumentChangeEvent[] = [];
    const pendingWaits = new Set<{
      metadata: Pick<
        DocumentRepositoryMetadata,
        "documentId" | "heads" | "source"
      >;
      resolve: () => void;
      reject: (error: Error) => void;
      timeoutId: ReturnType<typeof setTimeout>;
    }>();

    const unsubscribe = modelingService.subscribeToDocumentChanges((event) => {
      if (event.documentId !== documentId) {
        return;
      }

      seenEvents.push(event);
      for (const pending of pendingWaits) {
        if (!repositoryChangeMatches(event, pending.metadata)) {
          continue;
        }

        clearTimeout(pending.timeoutId);
        pendingWaits.delete(pending);
        pending.resolve();
      }
    });

    return {
      waitFor(
        metadata: Pick<
          DocumentRepositoryMetadata,
          "documentId" | "heads" | "source"
        >,
      ) {
        if (
          seenEvents.some((event) => repositoryChangeMatches(event, metadata))
        ) {
          return Promise.resolve();
        }

        return new Promise<void>((resolve, reject) => {
          const pending = {
            metadata,
            resolve,
            reject,
            timeoutId: setTimeout(() => {
              pendingWaits.delete(pending);
              reject(
                new Error(
                  `Timed out waiting for repository ${metadata.source} synchronization after ${repositorySynchronizationTimeoutMs}ms.`,
                ),
              );
            }, repositorySynchronizationTimeoutMs),
          };
          pendingWaits.add(pending);
        });
      },
      dispose() {
        unsubscribe();
        for (const pending of pendingWaits) {
          clearTimeout(pending.timeoutId);
        }
        pendingWaits.clear();
      },
    };
  }

  async function getAvailability({ documentId }: { documentId: DocumentId }) {
    if (!documentRepository) return { canUndo: false, canRedo: false };
    await modelingService.waitForPersistence();
    return documentRepository.getDurableHistoryAvailability(documentId);
  }
  async function compensate(
    documentId: DocumentId,
    direction: "undo" | "redo",
    actionSequence?: number,
  ): Promise<DurableHistoryActionResult | null> {
    if (!documentRepository) return null;
    await modelingService.waitForPersistence();
    const waiter = createRepositoryChangeWaiter(documentId);
    try {
      const result = await (direction === "undo"
        ? documentRepository.undoDurableHistory(documentId, actionSequence)
        : documentRepository.redoDurableHistory(documentId, actionSequence));
      if (!result) return null;
      if (!result.ok)
        throw new Error(
          result.status.kind === "failed"
            ? result.status.diagnostic.message
            : "History compensation failed.",
        );
      await waiter.waitFor(result.metadata);
      return {
        context: "document",
        snapshot: await modelingService.getCurrentDocumentSnapshot(),
        availability: await getAvailability({ documentId }),
      };
    } finally {
      waiter.dispose();
    }
  }
  return {
    getAvailability,
    undo: ({ documentId, actionSequence }) =>
      compensate(documentId, "undo", actionSequence),
    redo: ({ documentId, actionSequence }) =>
      compensate(documentId, "redo", actionSequence),
  };
}
