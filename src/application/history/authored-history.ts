import type { DurableHistoryAvailability } from "@/contracts/modeling/durable-history";
import type { DocumentId, RevisionId } from "@/contracts/shared/ids";
import type { AuthoredModelDocument } from "@/contracts/modeling/authored-document";
import type { WorkspaceSnapshot } from "@/contracts/modeling/schema";
import type { AuthoredActionResult } from "@/contracts/modeling/authored-actions";

export interface HistoryCompensationReceipt {
  /** Populated only after exact repository synchronization has been verified. */
  liveRevisionId?: RevisionId;
  kind: "committed" | "failed";
  failureReason?: string;
  document: AuthoredModelDocument | null;
  metadata: {
    documentId: DocumentId;
    heads: readonly string[];
    source: string;
  } | null;
}
export class HistoryOperationError extends Error {
  readonly compensation: HistoryCompensationReceipt | null;
  readonly snapshot: WorkspaceSnapshot | undefined;
  constructor(
    message: string,
    compensation: HistoryCompensationReceipt | null,
    snapshot?: WorkspaceSnapshot,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.compensation = compensation;
    this.snapshot = snapshot;
  }
}
type AuthoredActionConflictReason = Extract<
  AuthoredActionResult,
  { status: "blocked" }
>["reason"];
// Keyed by the whole contract union, so a new blocked reason must be added here.
const authoredActionConflictReasons = {
  "identity-mismatch": true,
  "context-missing": true,
  "expected-state-changed": true,
  "dependent-record-changed": true,
  "later-action-overlap": true,
  "action-not-found": true,
} as const satisfies Record<AuthoredActionConflictReason, true>;
/**
 * The authored-action reason when an undo/redo was refused because the
 * document no longer allows it (nothing was written). Persistence,
 * synchronization and unknown failures return null.
 */
export function authoredActionConflictReason(
  error: unknown,
): AuthoredActionConflictReason | null {
  if (!(error instanceof HistoryOperationError)) return null;
  if (error.compensation?.document !== null) return null;
  const reason = error.compensation.failureReason;
  return reason !== undefined &&
    Object.hasOwn(authoredActionConflictReasons, reason)
    ? (reason as AuthoredActionConflictReason)
    : null;
}
export interface DurableHistoryActionResult {
  context: "document";
  compensation?: HistoryCompensationReceipt;
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
export interface AuthoredHistoryRequest {
  direction: "undo" | "redo";
  commandId: string;
  actionSequence?: number;
}

/** One routing owner: an empty private history must never undo shared document state. */
export function createAuthoredHistoryOperation(input: {
  documentHistory: DurableHistoryService;
  getContext():
    | { kind: "sketch" }
    | { kind: "document"; documentId: DocumentId; revisionId?: RevisionId }
    | null;
  privateHistory(request: AuthoredHistoryRequest): Promise<void>;
  handoff(snapshot: WorkspaceSnapshot, commandId: string): Promise<void>;
}) {
  return {
    async execute(
      request: AuthoredHistoryRequest,
    ): Promise<DurableHistoryActionResult | { context: "sketch" } | null> {
      const context = input.getContext();
      if (!context) return null;
      if (context.kind === "sketch") {
        await input.privateHistory(request);
        return { context: "sketch" };
      }
      const documentContext = context;
      async function handoff(snapshot: WorkspaceSnapshot) {
        const active = input.getContext();
        if (
          active?.kind !== "document" ||
          active.documentId !== documentContext.documentId ||
          (active.revisionId &&
            active.revisionId !== documentContext.revisionId &&
            active.revisionId !== snapshot.document.revisionId)
        )
          throw new Error(
            "History editing context changed before snapshot handoff.",
          );
        await input.handoff(snapshot, request.commandId);
      }
      let result: DurableHistoryActionResult | null;
      try {
        result = await input.documentHistory[request.direction]({
          documentId: context.documentId,
          actionSequence: request.actionSequence,
        });
      } catch (error) {
        // A failed durable write can still have applied the compensation live.
        // Hand off only its synchronized snapshot, never an inferred rollback.
        if (error instanceof HistoryOperationError && error.snapshot) {
          try {
            await handoff(error.snapshot);
          } catch (handoffError) {
            throw new HistoryOperationError(
              handoffError instanceof Error
                ? handoffError.message
                : String(handoffError),
              error.compensation,
              undefined,
              { cause: error },
            );
          }
        }
        throw error;
      }
      if (result) {
        try {
          await handoff(result.snapshot);
        } catch (error) {
          throw new HistoryOperationError(
            error instanceof Error ? error.message : String(error),
            result.compensation ?? null,
            result.snapshot,
            { cause: error },
          );
        }
      }
      return result;
    },
  };
}
