import { createContext, useContext, useRef, useSyncExternalStore } from "react";

import type { EditorContextValue } from "@/hooks/editor-context";

/**
 * The editor context value as a subscribable store. `useEditorState()`
 * re-renders its component on every editor state change (each sketch drag
 * move); `useEditorStateSelector` re-renders only when the selected slice
 * changes, so a memoized component reading it is skipped otherwise.
 */
export interface EditorStateStore {
  getSnapshot(): EditorContextValue;
  subscribe(listener: () => void): () => void;
  publish(value: EditorContextValue): void;
}

export function createEditorStateStore(
  initial: EditorContextValue,
): EditorStateStore {
  let current = initial;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    publish(value) {
      if (value === current) return;
      current = value;
      listeners.forEach((listener) => listener());
    },
  };
}

export const EditorStateStoreContext = createContext<EditorStateStore | null>(
  null,
);

/** Equal when both records hold the same keys with identical values. */
export function shallowEqualRecords<T extends object>(left: T, right: T) {
  const leftKeys = Object.keys(left) as (keyof T)[];
  return (
    leftKeys.length === Object.keys(right).length &&
    leftKeys.every((key) => Object.is(left[key], right[key]))
  );
}

/**
 * The slice `select` reads from the editor context value; the component
 * re-renders when `isEqual` says the slice changed (by reference unless
 * given, e.g. `shallowEqualRecords` for a selected record). `select` reads
 * only the value, never props: a slice is reused while the value is the same.
 */
export function useEditorStateSelector<T>(
  select: (value: EditorContextValue) => T,
  isEqual: (left: T, right: T) => boolean = Object.is,
): T {
  const store = useContext(EditorStateStoreContext);
  if (!store) {
    throw new Error(
      "useEditorStateSelector must be used inside EditorProvider.",
    );
  }
  // The last selected slice and the value it came from: an unchanged value
  // or an equal slice returns the previous slice object, as
  // useSyncExternalStore requires of a snapshot.
  const selectedRef = useRef<{ source: EditorContextValue; slice: T } | null>(
    null,
  );
  const getSelected = () => {
    const source = store.getSnapshot();
    const previous = selectedRef.current;
    if (previous?.source === source) return previous.slice;
    const slice = select(source);
    const kept =
      previous !== null && isEqual(previous.slice, slice)
        ? previous.slice
        : slice;
    selectedRef.current = { source, slice: kept };
    return kept;
  };
  return useSyncExternalStore(store.subscribe, getSelected, getSelected);
}

/** The selection inputs the parts tree and the timeline rows render from. */
export function selectSelectionState({ state }: EditorContextValue) {
  return {
    selection: state.selection,
    selectionFilter: state.selectionFilter,
    selectionCatalog: state.selectionCatalog,
  };
}
