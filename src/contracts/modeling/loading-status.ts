export type LoadingPhase =
  | "preparing-engine"
  | "opening-document"
  | "preparing-geometry"
  | "ready"
  | "failed";

export interface LoadingStatusSource {
  getSnapshot(): LoadingPhase;
  subscribe(listener: () => void): () => void;
}

/** Retains the latest real boundary for observers arriving after eager startup. */
export function createLoadingStatus(initial: LoadingPhase) {
  let phase = initial;
  let disposed = false;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => phase,
    subscribe(listener: () => void) {
      if (disposed) return () => undefined;
      listeners.add(listener);
      listener();
      return () => {
        listeners.delete(listener);
      };
    },
    set(next: LoadingPhase) {
      if (disposed || next === phase) return;
      phase = next;
      for (const listener of listeners) listener();
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
