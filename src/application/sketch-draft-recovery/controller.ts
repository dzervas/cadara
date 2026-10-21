import type { EditorEventLoop } from "@/application/editor/editor-event-loop";
import type { EditorEvent } from "@/core/editor/state-machine";
import type { PersistedSketchDraft, SketchDraftCheckpoint, SketchDraftRecoveryStore } from "@/contracts/sketch/draft-recovery";
import { canOfferSketchDraft, shouldPersistSketchDraft } from "./rules";

type RecoveryEditor = Pick<EditorEventLoop, "getState" | "getSketchDraftCheckpoint" | "subscribe" | "dispatch">;

/** Local recovery observes accepted actions; it never calls the document port. */
export function createSketchDraftRecoveryController(
  editor: RecoveryEditor,
  store: SketchDraftRecoveryStore,
  now: () => number = Date.now,
) {
  let checkedDocument: string | null = null;
  let offer: PersistedSketchDraft | null = null;
  let active: SketchDraftCheckpoint | null = null;
  let persistedActions = 0;
  let persistedAt = now();
  const listeners = new Set<() => void>();
  const setOffer = (next: PersistedSketchDraft | null) => {
    if (offer === next) return;
    offer = next;
    for (const listener of listeners) listener();
  };

  function flush(force = false) {
    if (!active) return;
    const actions = active.completedActions - persistedActions;
    if (actions <= 0 || (!force && !shouldPersistSketchDraft(actions, now() - persistedAt))) return;
    const record: PersistedSketchDraft = { ...structuredClone(active), version: 1, persistedAt: now() };
    store.save(record);
    persistedAt = record.persistedAt;
    persistedActions = active.completedActions;
  }

  function observe(state = editor.getState(), event?: EditorEvent) {
    if (!state.snapshot) return;
    const documentId = state.snapshot.document.documentId;
    const freshFileOpen = event?.type === "document.replaced" && event.historyDisposition === "fresh-file-open";
    if (freshFileOpen) {
      store.clear(documentId);
      active = null;
      setOffer(null);
      checkedDocument = documentId;
      return;
    }
    if (checkedDocument !== documentId) {
      checkedDocument = documentId;
      const draft = store.load(documentId);
      if (draft && !canOfferSketchDraft(draft, state.snapshot)) store.clear(documentId);
      setOffer(draft && canOfferSketchDraft(draft, state.snapshot) ? draft : null);
    }
    if (offer && !canOfferSketchDraft(offer, state.snapshot)) {
      store.clear(documentId);
      setOffer(null);
    }
    const checkpoint = editor.getSketchDraftCheckpoint();
    if (!checkpoint) {
      if (active) store.clear(active.documentId); // Finish or deliberate sketch discard.
      active = null;
      return;
    }
    if (!active || active.sketchId !== checkpoint.sketchId) {
      active = checkpoint;
      persistedActions = checkpoint.completedActions;
      persistedAt = now();
      // Starting another sketch is an explicit choice instead of recovery.
      if (offer && event?.type !== "sketch.draftRecoveryRequested") {
        store.clear(documentId);
        setOffer(null);
      }
      return;
    }
    active = checkpoint;
    flush();
  }

  return {
    getOffer: () => offer,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    connect(onError: (error: unknown) => void) {
      const guard = (run: () => void) => {
        try { run(); } catch (error) { onError(error); }
      };
      guard(() => observe());
      const subscription = editor.subscribe((state, event) => guard(() => observe(state, event)));
      return () => { guard(() => flush(true)); subscription.unsubscribe(); };
    },
    tick: () => flush(),
    flush: () => flush(true),
    discard() {
      if (offer) store.clear(offer.documentId);
      setOffer(null);
    },
    resume() {
      const draft = offer;
      if (!draft) return;
      editor.dispatch({ type: "sketch.draftRecoveryRequested", draft });
      const state = editor.getState();
      // Normal sketch opening may first roll the document cursor back.
      if (state.kind === "editingSketch" || state.kind === "selectionCommand") setOffer(null);
    },
  };
}

export type SketchDraftRecoveryController = ReturnType<typeof createSketchDraftRecoveryController>;
