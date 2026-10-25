export type LoadingPhase =
  | "preparing-engine"
  | "opening-document"
  | "preparing-geometry"
  | "ready"
  | "failed";

/**
 * Measured progress within the current phase, reported only at real producer
 * boundaries (cadara-ku5k): the kernel's feature rebuild during a document
 * restore posts one update before each feature it evaluates, and a slow
 * kernel wasm download reports decoded bytes (cadara-5hlf).
 */
export type LoadingProgress =
  | {
      stage: "rebuilding-features";
      /** Features evaluated so far (failed and suppressed ones included). */
      completed: number;
      total: number;
      /** The feature evaluated next; null once all are done. */
      label: string | null;
    }
  | { stage: "downloading-engine"; completed: number; total: number; label: null };

export interface LoadingStatusSource {
  getSnapshot(): LoadingPhase;
  /** Null whenever the current phase has no measured total. */
  getProgress(): LoadingProgress | null;
  subscribe(listener: () => void): () => void;
}

/** Retains the latest real boundary for observers arriving after eager startup. */
export function createLoadingStatus(initial: LoadingPhase) {
  let phase = initial;
  let progress: LoadingProgress | null = null;
  let disposed = false;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  return {
    getSnapshot: () => phase,
    getProgress: () => progress,
    subscribe(listener: () => void) {
      if (disposed) return () => undefined;
      listeners.add(listener);
      listener();
      return () => {
        listeners.delete(listener);
      };
    },
    /** A new phase ends the previous phase's measured progress. */
    set(next: LoadingPhase) {
      if (disposed || next === phase) return;
      phase = next;
      progress = null;
      notify();
    },
    /**
     * Clamped to the total and monotonic for an unchanged stage and total;
     * null returns the phase to unmeasured work.
     */
    setProgress(next: LoadingProgress | null) {
      if (disposed || phase === "ready" || phase === "failed") return;
      if (next === null) {
        if (progress === null) return;
        progress = null;
        notify();
        return;
      }
      const total = Math.max(0, Math.floor(next.total));
      const completed = Math.min(total, Math.max(0, Math.floor(next.completed)));
      if (
        progress &&
        progress.stage === next.stage &&
        progress.total === total &&
        progress.completed > completed
      ) {
        return;
      }
      progress = { ...next, completed, total };
      notify();
    },
    dispose() {
      disposed = true;
      listeners.clear();
    },
  };
}

export function selectInitialLoadingPhase(
  engine: LoadingPhase,
  document: LoadingPhase,
): LoadingPhase {
  if (document === "ready" || document === "failed") return document;
  if (engine === "failed") return "failed";
  return engine === "preparing-engine" ? engine : document;
}
