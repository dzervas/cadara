import { snapshotRepresentsRepositoryDocument } from "@/contracts/modeling/repository-basis";
import type { DurableHistoryAvailability } from "@/contracts/modeling/durable-history";
import type { DocumentId } from "@/contracts/shared/ids";
import type { WorkspaceSnapshot } from "@/contracts/modeling/schema";
import type { AuthoredModelDocument } from "@/contracts/modeling/authored-document";
import { HistoryOperationError, type HistoryCompensationReceipt, type DurableHistoryActionResult, type DurableHistoryService } from "./authored-history";
export type { DurableHistoryActionResult, DurableHistoryService } from "./authored-history";

interface RepositoryMetadata {
  documentId: DocumentId;
  heads: readonly string[];
  source: string;
}
type CompensationResult =
  | { ok: true; document: AuthoredModelDocument; metadata: RepositoryMetadata }
  | { ok: false; status: { kind: "failed"; diagnostic: { message: string; reasonCode?: string } }; appliedLive?: { document: AuthoredModelDocument; metadata: RepositoryMetadata } };
interface HistoryRepository {
  getDurableHistoryAvailability(documentId: DocumentId): Promise<DurableHistoryAvailability>;
  undoDurableHistory(documentId: DocumentId, actionSequence?: number): Promise<CompensationResult | null>;
  redoDurableHistory(documentId: DocumentId, actionSequence?: number): Promise<CompensationResult | null>;
}
interface HistoryModel {
  waitForPersistence(): Promise<void>;
  waitForLocalMutations(): Promise<void>;
  trackLocalSave(work: Promise<unknown>): void;
  getCurrentDocumentSnapshot(): Promise<WorkspaceSnapshot>;
  subscribeToDocumentChanges(listener: (event: { documentId: DocumentId; metadata: RepositoryMetadata }) => void): () => void;
}
export const DEFAULT_REPOSITORY_SYNCHRONIZATION_TIMEOUT_MS = 90_000;
export function createDurableHistoryService(input: {
  documentRepository: HistoryRepository | null;
  modelingService: HistoryModel;
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
      HistoryModel["subscribeToDocumentChanges"]
    >[0] extends (event: infer TEvent) => void
      ? TEvent
      : never,
    metadata: Pick<
      RepositoryMetadata,
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
      HistoryModel["subscribeToDocumentChanges"]
    >[0] extends (event: infer TEvent) => void
      ? TEvent
      : never;

    const seenEvents: DocumentChangeEvent[] = [];
    const pendingWaits = new Set<{
      metadata: Pick<
        RepositoryMetadata,
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
          RepositoryMetadata,
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
    // cadara-l99p: the repository sends the stored document URL with the
    // compensation; a New or Import still in flight stores a new one, which
    // the worker would otherwise see as another tab's replacement.
    await modelingService.waitForLocalMutations();
    await modelingService.waitForPersistence();
    const waiter = createRepositoryChangeWaiter(documentId);
    try {
      const write =
        direction === "undo"
          ? documentRepository.undoDurableHistory(documentId, actionSequence)
          : documentRepository.redoDurableHistory(documentId, actionSequence);
      // The compensation is a user edit: leaving before it is stored loses it.
      modelingService.trackLocalSave(write);
      const result = await write;
      if (!result) return null;
      const applied = result.ok ? result : result.appliedLive;
      const compensation: HistoryCompensationReceipt = {
        kind: result.ok ? "committed" : "failed",
        ...(!result.ok ? { failureReason: result.status.diagnostic.reasonCode } : {}),
        document: applied?.document ?? null,
        metadata: applied?.metadata ?? null,
      };
      let snapshot: WorkspaceSnapshot | undefined;
      try {
        if (applied) {
          await waiter.waitFor(applied.metadata);
          const current = await modelingService.getCurrentDocumentSnapshot();
          if (!snapshotRepresentsRepositoryDocument(current, applied))
            throw new Error("History snapshot does not match the exact compensated repository heads.");
          snapshot = current;
          compensation.liveRevisionId = current.document.revisionId;
        }
        if (!result.ok) throw new Error(result.status.diagnostic.message);
        return {
          context: "document",
          compensation,
          snapshot: snapshot!,
          availability: await getAvailability({ documentId }),
        };
      } catch (error) {
        throw new HistoryOperationError(error instanceof Error ? error.message : String(error), compensation, snapshot, { cause: error });
      }
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
