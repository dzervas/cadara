import { expect, test, vi } from "vitest";
import { createSketchDraftRecoveryController } from "./controller";
import { makeSketchDraftRecoveryFixture } from "./recovery.fixtures";
import { initialEditorState, type EditorState, type EditorEvent } from "@/core/editor/state-machine";
import type { EditorEventLoopListener } from "@/application/editor/editor-event-loop";
import type { SketchDraftCheckpoint } from "@/contracts/sketch/draft-recovery";

test("subscription checkpoints ten actions, timer checkpoints later changes, clean exit clears, failures report", async () => {
  const { snapshot, draft } = await makeSketchDraftRecoveryFixture();
  let time = 0;
  let checkpoint: SketchDraftCheckpoint | null = null;
  const state: EditorState = { ...initialEditorState, snapshot };
  const listeners = new Set<EditorEventLoopListener>();
  const store = { load: vi.fn(() => null), save: vi.fn(), clear: vi.fn() };
  const editor = {
    getState: () => state, getSketchDraftCheckpoint: () => checkpoint, dispatch: vi.fn(),
    subscribe: (listener: EditorEventLoopListener) => { listeners.add(listener); return { unsubscribe: () => listeners.delete(listener) }; },
  };
  const recovery = createSketchDraftRecoveryController(editor, store, () => time);
  const onError = vi.fn();
  const disconnect = recovery.connect(onError);
  const emit = (event: EditorEvent = { type: "sketch.activeToolCleared" }) => { for (const listener of listeners) listener(state, event); };
  checkpoint = { ...draft, completedActions: 0 };
  emit();
  checkpoint = { ...draft, completedActions: 9 }; emit();
  time = 59_999; recovery.tick();
  expect(store.save).not.toHaveBeenCalled();
  checkpoint = { ...draft, completedActions: 10 }; emit();
  expect(store.save).toHaveBeenCalledTimes(1);
  checkpoint = { ...draft, completedActions: 11 }; emit();
  time = 119_998; recovery.tick();
  expect(store.save).toHaveBeenCalledTimes(1);
  time = 119_999; recovery.tick();
  expect(store.save).toHaveBeenCalledTimes(2);
  recovery.tick(); expect(store.save).toHaveBeenCalledTimes(2);
  checkpoint = { ...draft, completedActions: 12 }; emit(); recovery.flush();
  expect(store.save).toHaveBeenCalledTimes(3);
  checkpoint = null; emit();
  expect(store.clear).toHaveBeenCalledWith(draft.documentId);
  store.load.mockImplementationOnce(() => { throw new Error("storage denied"); });
  disconnect();
  const broken = createSketchDraftRecoveryController(editor, store);
  broken.connect(onError)();
  expect(onError).toHaveBeenCalledWith(new Error("storage denied"));
});

test("load offers once, Discard removes it; stale and explicit-open records are silently cleared", async () => {
  const { snapshot, draft } = await makeSketchDraftRecoveryFixture(true);
  const state: EditorState = { ...initialEditorState, snapshot };
  let observer: EditorEventLoopListener = () => {};
  const store = { load: vi.fn(() => draft), save: vi.fn(), clear: vi.fn() };
  const editor = { getState: () => state, getSketchDraftCheckpoint: () => null, dispatch: vi.fn(),
    subscribe: (listener: EditorEventLoopListener) => { observer = listener; return { unsubscribe() {} }; } };
  const recovery = createSketchDraftRecoveryController(editor, store);
  const disconnect = recovery.connect(error => { throw error; });
  expect(recovery.getOffer()).toEqual(draft);
  observer(state, { type: "document.replaced", snapshot, historyDisposition: "fresh-file-open" });
  expect(recovery.getOffer()).toBeNull();
  expect(store.clear).toHaveBeenCalledWith(draft.documentId);
  disconnect();
  const next = createSketchDraftRecoveryController(editor, store);
  next.connect(error => { throw error; })();
  next.discard(); expect(next.getOffer()).toBeNull();
  store.load.mockReturnValueOnce({ ...draft, publishedRevision: "changed" });
  const stale = createSketchDraftRecoveryController(editor, store);
  stale.connect(error => { throw error; })();
  expect(stale.getOffer()).toBeNull();
});
