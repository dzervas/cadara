import type { ModelingDiagnostic } from "@/contracts/modeling/schema";
import type {
  SemanticCommand,
  SemanticPersistenceReceipt,
  SemanticResult,
  SemanticState,
} from "@/contracts/semantic/schema";

/**
 * Application API, independent of recipe/terminal encoding. Validated commands
 * execute sequentially; reject concurrent execution rather than inventing a
 * shared multi-writer guarantee. A command ID identifies one intent, including
 * every serial/detached follow-up, final solve/derivation and snapshot handoff.
 * Correlation intent is derived by the application from the validated operation;
 * clients cannot upgrade an ordinary geometry request to author-invalid on failure.
 * Expected failures resolve as results; unexpected programming exceptions remain
 * observable (never swallowed). Family command inputs extend the closed contract
 * union in later tickets, not arbitrary editor events or internal sketch records.
 */
export interface SemanticSession {
  execute(
    command: SemanticCommand,
    options?: { signal?: AbortSignal },
  ): Promise<SemanticResult>;
  /**
   * Idempotent awaitable settlement, not EditorEventLoop.stop()/service.dispose().
   * Reject new commands as unavailable once closing; queued/not-started commands
   * resolve canceled. In-flight commands settle truthfully, including work whose
   * editor run-token would discard the result. No caller promise may be stranded.
   * Abort before application -> canceled. After application -> actual terminal
   * outcome + applied state; no rollback guarantee. Do not promise preemption of
   * synchronous local solver/OCC. Drain those operations before releasing owners.
   *
   * Await serial AND detached effects, correlated repository/file obligations,
   * unsubscribe, then dispose exactly once in reverse acquisition order. Service
   * owns its adapter: composition must not double-dispose it. No automatic file
   * save on close; flush only writes actually requested. Return failed cleanup
   * truth if a flush/release fails, not a fake clean exit. Repeated close observes
   * the same settlement; it must not launch a second disposal.
   */
  close(): Promise<SemanticCloseResult>;
}

export type SemanticCloseResult =
  | {
      kind: "closed";
      /** Terminal results of commands outstanding when close began, exactly once. */
      settled: readonly SemanticResult[];
      resourcesReleased: true;
    }
  | {
      kind: "failed";
      settled: readonly SemanticResult[];
      resourcesReleased: boolean;
      failures: readonly ("command" | "flush" | "release")[];
      diagnostics: readonly ModelingDiagnostic[];
    };

/**
 * Explicit initialization evidence: a fulfilled ensureInitialized() is not proof
 * of successful restore (the current service catches startup failures). Only a
 * ready receipt permits command execution. Composition cleans up only acquired
 * resources after partial startup failure, awaiting work before owner release.
 */
export interface SemanticSessionFactory {
  /** Aborted startup settles after partial cleanup; local native work may drain. */
  open(options?: { signal?: AbortSignal }): Promise<
    | {
        kind: "ready";
        session: SemanticSession;
        initialization: { kind: "initialized"; state: SemanticState };
      }
    | {
        kind: "failed" | "canceled";
        diagnostics: readonly ModelingDiagnostic[];
        cleanup: SemanticCloseResult;
      }
  >;
}

/**
 * Adapter port for a specific accepted repository transaction, not the global
 * persistence tail or historyRestoreState. No receipt is inferred from elapsed
 * time, idle queues, diagnostics absence or successful promise fulfillment.
 * Failure preserves that transaction's actual state/appliedLive; do not read
 * whatever revision happens to be current later. A memory commit is repository
 * synchronization only; disk saving has its separate file receipt.
 * Concrete receipt production/service changes belong to lifecycle/family tickets.
 */
export interface SemanticPersistencePort {
  settle(input: {
    commandId: string;
    transactionId: string;
    state: SemanticState;
  }): Promise<Exclude<SemanticPersistenceReceipt, { kind: "not-required" }>>;
}

/**
 * Acceptance cases for runtime implementations, observed via execute/open/close
 * (logic lane, not private queue sizes or trace choreography):
 * - deferred initial restore fails -> no ready session; acquired owners released;
 * - deferred final-generation derivation -> execute stays pending; stale result
 *   cannot supply profiles; offset replan must settle its new generation;
 * - mutation accepted then requested rebuild fails -> failed + actual live basis;
 * - late snapshot/cursor handoff failure -> failed, no stale discovery;
 * - persistence promise resolves with failed write -> failed transaction receipt,
 *   preserving live state, not completed; similarly file write fails after export;
 * - pre-aborted command -> canceled/no application; abort after accepted mutation
 *   cannot imply rollback; non-preemptible solver/native work drains;
 * - close with queued/serial/detached work -> every promise settles before resource
 *   release; repeated close does not release twice; cleanup errors are observable;
 * - sequential recipe adapter awaits terminal result, stops first failure, keeps
 *   prior changes, never resolves aliases against stale/failed discovery;
 * - deliberately author-invalid and inspect-invalid do not certify usable geometry;
 * - private-first undo never falls through empty draft history; fresh file resets
 *   owner and does not resurrect previous session undo.
 *
 * Static acceptance policy (separate static lane, not geometry evidence):
 * commands import shared application/contracts, never concrete kernel/service,
 * repository, editor-loop or browser/workbench owners. Dedicated composition may
 * construct infrastructure implementations of these ports. Shared modules never
 * import CLI. Contracts depend on contracts; application depends on contracts/core
 * (no ModelingService Pick to hide a domain dependency). From actual runtime and
 * command roots, resolve transitive relative/alias imports, exports and runtime
 * dynamic imports; distinguish type-only import queries. Refuse browser/UI roots,
 * React, rendering/viewport and DOM/worker/storage bootstrap dependencies. Do not
 * weaken policy for incidental transitive display helpers: extract necessary
 * pure math instead. Real Bun startup complements, not replaces, this guard.
 * Concrete root/import guard arrives with ticket 03 composition; this file does
 * not claim that current editor/service graphs already satisfy that policy.
 */
