import {
  createConsoleErrorReporter,
  normalizeUnknownError,
  type ErrorReporter,
  type ErrorReportVisibility,
} from "@/contracts/errors";
import {
  createEditorEffectFailureEvent,
  defaultEditorExtensionDependencies,
  emitPendingSketchEditQuery,
  emitPendingSketchSnapQuery,
  emitPendingSketchOffsetPreviewPublication,
  emitPendingSketchRegionDerivation,
  initialEditorState,
  transitionEditorState,
  type EditorExtensionDependencies,
  type EditorEffect,
  type EditorEffectRuntime,
  type EditorEvent,
  type EditorState,
} from "@/core/editor/state-machine";
import {
  createEffectCompletedTraceEntry,
  createEffectFailedTraceEntry,
  createEffectStartedTraceEntry,
  createEventDispatchedTraceEntry,
  type EditorEventLoopTraceListener,
} from "./editor-debug-trace";
import { runEditorEffect } from "./effect-registry";
import { SketchAuthoredActions } from "./sketch-authored-actions";

export type EditorEventLoopListener = (state: EditorState) => void;

/**
 * [TECH] T17-11: a failed snap query only removes an inference hint (nothing
 * authored or blocked), so it is a developer report. Every other effect's
 * failure event has a user-visible surface (T17o failure-feedback audit).
 */
export function getEditorInvocationFailureVisibility(
  effect: Pick<EditorEffect, "type">,
): ErrorReportVisibility {
  return effect.type === "sketch.querySnapIntersections" ? "developer" : "user";
}

export class EditorEventLoop {
  private readonly runtime: EditorEffectRuntime;
  private readonly dependencies: EditorExtensionDependencies;
  private readonly errorReporter: ErrorReporter;
  private readonly executeEffect: (
    effect: EditorEffect,
    runtime: EditorEffectRuntime,
    runSignal: AbortSignal,
  ) => Promise<EditorEvent>;
  private state: EditorState = initialEditorState;
  private readonly sketchActions: SketchAuthoredActions;
  private cursorRecovery: { requestId: string; state: EditorState } | null = null;
  private readonly interactionQueries = new Map<EditorEffect, AbortController>();

  private transition(event: EditorEvent) {
    if (
      (event.type === "effect.documentCursorMoveFailed" ||
        event.type === "effect.documentCursorMoved") &&
      this.cursorRecovery?.requestId === event.requestId &&
      this.state.pendingHistoryCursorRequestId === event.requestId &&
      this.state.document.documentId === event.documentId &&
      this.state.document.revisionId === event.baseRevisionId
    ) {
      const previous = this.cursorRecovery.state;
      this.cursorRecovery = null;
      if (event.type === "effect.documentCursorMoveFailed" || !event.accepted) {
        // A refused transient rollback/restore must not strand the editor in
        // its intermediate phase. Keep the allocated IDs monotonic and let
        // the normal failure transition surface the error (or refresh a conflict).
        this.state = {
          ...previous,
          nextCommandSequence: this.state.nextCommandSequence,
          nextRequestSequence: this.state.nextRequestSequence,
          pendingHistoryCursorRequestId: event.requestId,
          // Leaving the sketch released these waits. Recovery must reissue
          // them rather than resurrect records for cancelled requests.
          ...(previous.kind === "editingSketch"
            ? { pendingEditQueryRequest: null, pendingSnapQueryRequest: null }
            : {}),
        };
      }
    }
    // Authored-action restores (undo/redo, gesture exits) happen after the
    // reducer, so the live region hook runs again on the final result.
    return emitPendingSketchSnapQuery(
      emitPendingSketchEditQuery(
        emitPendingSketchOffsetPreviewPublication(
          emitPendingSketchRegionDerivation(
            this.sketchActions.transition(this.state, event, (state) =>
              transitionEditorState(state, event, this.dependencies),
            ),
            {
              supersede: this.runtime.supersedesSketchRegionDerivation === true,
            },
          ),
        ),
      ),
    );
  }
  private readonly effectQueue: EditorEffect[] = [];
  /** Detached effects (U11) waiting to start off the serial queue. */
  private readonly backgroundEffects: EditorEffect[] = [];
  private readonly listeners = new Set<EditorEventLoopListener>();
  private readonly traceListeners = new Set<EditorEventLoopTraceListener>();
  private processing = false;
  private running = false;
  private runToken = 0;
  /** Aborted by stop(): in-flight effects observe that their run is stale. */
  private runAbort = new AbortController();
  private traceSequence = 0;
  private currentCorrelation: string | null = null;
  private readonly effectCorrelations = new WeakMap<EditorEffect, string>();
  private readonly settlements = new Map<string, { pending: number; events: EditorEvent[]; resolve: (events: readonly EditorEvent[]) => void }>();
  private activeEffects = 0;
  private readonly drainWaiters = new Set<() => void>();

  /** Observe real terminal effect events, including typed failures and descendants. */
  dispatchAndSettle(commandId: string, event: EditorEvent): Promise<readonly EditorEvent[]> {
    if (!this.running) return Promise.reject(new Error("Editor event loop is stopped."));
    if (this.settlements.has(commandId)) return Promise.reject(new Error("Duplicate editor correlation."));
    const completion = new Promise<readonly EditorEvent[]>((resolve) => {
      this.settlements.set(commandId, { pending: 0, events: [], resolve });
    });
    this.currentCorrelation = commandId;
    try { this.dispatch(event); } finally { this.currentCorrelation = null; }
    this.settleCorrelation(commandId);
    return completion;
  }

  /** Drain serial and detached work and descendants without invalidating outcomes. */
  drain(): Promise<void> {
    if (this.isDrained()) return Promise.resolve();
    return new Promise(resolve => this.drainWaiters.add(resolve));
  }

  private isDrained() {
    return this.activeEffects === 0 && !this.processing && this.effectQueue.length === 0 && this.backgroundEffects.length === 0;
  }

  private notifyDrained() {
    if (!this.isDrained()) return;
    for (const resolve of this.drainWaiters) resolve();
    this.drainWaiters.clear();
  }

  private settleCorrelation(id: string) {
    const settlement = this.settlements.get(id);
    if (!settlement || settlement.pending !== 0) return;
    this.settlements.delete(id);
    settlement.resolve(settlement.events);
  }

  constructor(
    runtime: EditorEffectRuntime,
    dependencies: EditorExtensionDependencies,
    errorReporter: ErrorReporter,
    executeEffect: (
      effect: EditorEffect,
      runtime: EditorEffectRuntime,
      runSignal: AbortSignal,
    ) => Promise<EditorEvent>,
    sketchActions: SketchAuthoredActions = new SketchAuthoredActions(),
  ) {
    this.runtime = runtime;
    this.dependencies = dependencies;
    this.errorReporter = errorReporter;
    this.executeEffect = executeEffect;
    this.sketchActions = sketchActions;
  }

  dispatch(event: EditorEvent) {
    if (!this.running) {
      return;
    }

    const result = this.transition(event);
    this.applyTransitionResult(result);
    this.emitTrace(
      createEventDispatchedTraceEntry({
        sequence: this.nextTraceSequence(),
        event,
        state: this.state,
        emittedEffects: result.effects,
      }),
    );
    this.scheduleDrain();
  }

  subscribe(listener: EditorEventLoopListener) {
    this.listeners.add(listener);

    return {
      unsubscribe: () => {
        this.listeners.delete(listener);
      },
    };
  }

  subscribeToTrace(listener: EditorEventLoopTraceListener) {
    this.traceListeners.add(listener);

    return {
      unsubscribe: () => {
        this.traceListeners.delete(listener);
      },
    };
  }

  getState() {
    return this.state;
  }

  startAndSettle(commandId: string): Promise<readonly EditorEvent[]> {
    if (this.running) return Promise.reject(new Error("Editor event loop already started."));
    this.running = true;
    this.runToken += 1;
    this.runAbort = new AbortController();
    return this.dispatchAndSettle(commandId, { type: "session.started" });
  }

  start() {
    if (this.running) {
      return;
    }

    this.running = true;
    this.runToken += 1;
    this.runAbort = new AbortController();
    this.dispatch({ type: "session.started" });
  }

  stop() {
    if (!this.running && !this.processing && this.effectQueue.length === 0) {
      return;
    }

    this.running = false;
    this.runToken += 1;
    this.runAbort.abort(new Error("Editor event loop run stopped."));
    for (const effect of [...this.effectQueue, ...this.backgroundEffects]) {
      const id = this.effectCorrelations.get(effect);
      if (id) {
        const settlement = this.settlements.get(id);
        if (settlement) settlement.pending -= 1;
        this.settleCorrelation(id);
      }
    }
    this.effectQueue.length = 0;
    this.backgroundEffects.length = 0;
    this.notifyDrained();
    // The run token drops in-flight derivation results; release the request so
    // the post-transition hook re-derives after a restart.
    this.cursorRecovery = null;
    if (this.state.kind === "editingSketch") {
      this.state = {
        ...this.state,
        pendingRegionRequest: null,
        pendingEditQueryRequest: null,
        pendingSnapQueryRequest: null,
      };
    }
  }

  private applyTransitionResult(
    result: ReturnType<typeof transitionEditorState>,
  ) {
    for (const effect of result.effects) {
      if (effect.type === "document.moveHistoryCursor" && effect.transient) {
        this.cursorRecovery = {
          requestId: effect.requestId,
          state: {
            ...this.state,
            document: result.state.document,
            snapshot: result.state.snapshot,
            selectionCatalog: result.state.selectionCatalog,
          },
        };
      }
    }
    this.state = result.state;
    if (
      this.cursorRecovery?.requestId !== this.state.pendingHistoryCursorRequestId
    ) {
      this.cursorRecovery = null;
    }
    for (const [effect, controller] of this.interactionQueries) {
      const pending =
        this.state.kind === "editingSketch"
          ? effect.type === "sketch.queryEditIntersections"
            ? this.state.pendingEditQueryRequest
            : this.state.pendingSnapQueryRequest
          : null;
      if (pending?.requestId !== effect.requestId) {
        controller.abort(
          new Error("Sketch interaction query is no longer owned."),
        );
      }
    }
    for (const effect of result.effects) {
      if (this.currentCorrelation) {
        this.effectCorrelations.set(effect, this.currentCorrelation);
        const settlement = this.settlements.get(this.currentCorrelation);
        if (settlement) settlement.pending += 1;
      }
      if ("background" in effect && effect.background) {
        this.backgroundEffects.push(effect);
      } else {
        this.effectQueue.push(effect);
      }
    }

    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  private scheduleDrain() {
    this.startBackgroundEffects();

    if (this.processing || !this.running || this.effectQueue.length === 0) {
      return;
    }

    void this.drainEffects(this.runToken);
  }

  /**
   * Starts detached effects without awaiting them, so a slow derivation never
   * delays Finish or projection effects queued behind it. Completion and
   * rejection go through the same guarded path as serial effects.
   */
  private startBackgroundEffects() {
    if (!this.running) {
      return;
    }

    const runToken = this.runToken;
    for (const effect of this.backgroundEffects.splice(0)) {
      void this.runEffect(effect, runToken).then(() => {
        if (this.running && runToken === this.runToken) {
          this.scheduleDrain();
        }
      });
    }
  }

  private async drainEffects(runToken: number) {
    if (this.processing || !this.running || runToken !== this.runToken) {
      return;
    }

    this.processing = true;

    try {
      while (this.running && runToken === this.runToken) {
        const effect = this.effectQueue.shift();

        if (!effect) {
          break;
        }

        const completed = await this.runEffect(effect, runToken);
        if (!completed) {
          break;
        }
        this.startBackgroundEffects();
      }
    } finally {
      this.processing = false;
      this.notifyDrained();
      if (this.running && this.effectQueue.length > 0) {
        this.scheduleDrain();
      }
    }
  }

  /** Runs one effect and applies its completion; false once the run is stopped. */
  private async runEffect(effect: EditorEffect, runToken: number) {
    this.activeEffects += 1;
    const queryAbort =
      effect.type === "sketch.queryEditIntersections" ||
      effect.type === "sketch.querySnapIntersections"
        ? new AbortController()
        : null;
    if (queryAbort) this.interactionQueries.set(effect, queryAbort);
    const runSignal = queryAbort
      ? AbortSignal.any([this.runAbort.signal, queryAbort.signal])
      : this.runAbort.signal;
    let removeAbortListener = () => {};
    const correlation = this.effectCorrelations.get(effect);
    this.emitTrace(
      createEffectStartedTraceEntry({
        sequence: this.nextTraceSequence(),
        effect,
        queueDepthAfterStart: this.effectQueue.length,
      }),
    );

    try {
      const completion = this.executeEffect(
        effect,
        this.runtime,
        runSignal,
      );
      // The worker pool has no per-request abort API. Release this owner's
      // wait immediately, while the race observes/discards any late outcome.
      const effectEvent = await (queryAbort
        ? Promise.race([
            completion,
            new Promise<never>((_, reject) => {
              const abort = () => reject(runSignal.reason);
              removeAbortListener = () =>
                runSignal.removeEventListener("abort", abort);
              runSignal.addEventListener("abort", abort, { once: true });
              if (runSignal.aborted) abort();
            }),
          ])
        : completion);
      if (correlation) this.settlements.get(correlation)?.events.push(effectEvent);

      if (!this.running || runToken !== this.runToken) {
        return false;
      }

      this.currentCorrelation = correlation ?? null;
      let result: ReturnType<typeof transitionEditorState>;
      try {
        result = this.transition(effectEvent);
        this.applyTransitionResult(result);
      } finally { this.currentCorrelation = null; }
      this.emitTrace(
        createEffectCompletedTraceEntry({
          sequence: this.nextTraceSequence(),
          effect,
          completion: effectEvent,
          state: this.state,
          emittedEffects: result.effects,
        }),
      );
    } catch (error: unknown) {
      // An effect that observed stop() dropped its stale continuation (e.g.
      // a read from the stopped document's disposed service, cadara-4x2).
      // Only this run's own abort reason is dropped; real failures report.
      if (runSignal.aborted && error === runSignal.reason) return false;
      const appError = normalizeUnknownError(error, {
        code: "editor/invocation-failed",
        fallbackMessage: "Editor runtime invocation failed.",
        context: [
          { key: "operation", value: effect.type },
          { key: "requestId", value: effect.requestId },
        ],
        requestId: effect.requestId,
      });

      this.errorReporter.report(appError, {
        source: "editor-runtime",
        visibility: getEditorInvocationFailureVisibility(effect),
        dedupeKey: `${effect.type}:${appError.requestId ?? appError.message}`,
      });

      const failureEvent = createEditorEffectFailureEvent(
        effect,
        appError,
        "Editor runtime invocation failed.",
      );
      if (correlation) this.settlements.get(correlation)?.events.push(failureEvent);
      if (!this.running || runToken !== this.runToken) return false;
      this.currentCorrelation = correlation ?? null;
      const result = this.transition(failureEvent);
      try { this.applyTransitionResult(result); } finally { this.currentCorrelation = null; }
      this.emitTrace(
        createEffectFailedTraceEntry({
          sequence: this.nextTraceSequence(),
          effect,
          failureEvent,
          error: appError,
          state: this.state,
          emittedEffects: result.effects,
        }),
      );
    } finally {
      removeAbortListener();
      this.interactionQueries.delete(effect);
      this.activeEffects -= 1;
      if (correlation) {
        const settlement = this.settlements.get(correlation);
        if (settlement) settlement.pending -= 1;
        this.settleCorrelation(correlation);
      }
      this.notifyDrained();
    }

    return true;
  }

  private nextTraceSequence() {
    this.traceSequence += 1;
    return this.traceSequence;
  }

  private emitTrace(
    entry: ReturnType<
      | typeof createEventDispatchedTraceEntry
      | typeof createEffectStartedTraceEntry
      | typeof createEffectCompletedTraceEntry
      | typeof createEffectFailedTraceEntry
    >,
  ) {
    if (this.traceListeners.size === 0) {
      return;
    }

    for (const listener of this.traceListeners) {
      try {
        listener(entry);
      } catch (error: unknown) {
        const appError = normalizeUnknownError(error, {
          code: "app/unknown",
          fallbackMessage: "Editor debug trace listener failed.",
          context: [{ key: "traceKind", value: entry.kind }],
        });

        this.errorReporter.report(appError, {
          source: "editor-runtime",
          visibility: "developer",
          dedupeKey: `debug-trace:${entry.kind}:${appError.message}`,
        });
      }
    }
  }
}

export function createEditorEventLoop(
  runtime: EditorEffectRuntime,
  errorReporter: ErrorReporter = createConsoleErrorReporter(),
  executeEffect: (
    effect: EditorEffect,
    runtime: EditorEffectRuntime,
    runSignal: AbortSignal,
  ) => Promise<EditorEvent> = runEditorEffect,
  dependencies: EditorExtensionDependencies = defaultEditorExtensionDependencies,
  sketchActions?: SketchAuthoredActions,
) {
  return new EditorEventLoop(
    runtime,
    dependencies,
    errorReporter,
    executeEffect,
    sketchActions,
  );
}
