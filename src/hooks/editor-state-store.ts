import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

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
  /**
   * Makes `value` the snapshot without notifying: selector components that
   * re-render in the same pass as the provider (for their props) read it
   * there, instead of rendering again when it is published.
   */
  stage(value: EditorContextValue): void;
  /** Notifies the subscribers once per new value. */
  publish(value: EditorContextValue): void;
}

export function createEditorStateStore(
  initial: EditorContextValue,
): EditorStateStore {
  let current = initial;
  let published = initial;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    stage(value) {
      current = value;
    },
    publish(value) {
      current = value;
      if (value === published) return;
      published = value;
      listeners.forEach((listener) => listener());
    },
  };
}

/**
 * The store `EditorProvider` provides for its current value. A delivered
 * snapshot re-renders the workbench and the children whose props changed
 * (the parts tree, the timeline); the value is staged, so they read their
 * selected slices of it in that same pass. The other subscribers re-render
 * (synchronously, before paint) when it is published after the commit, and
 * only if their slice changed. Editor updates render synchronously, so no
 * discarded render leaves a staged value behind; the next publish replaces
 * it in any case.
 */
export function useEditorStateStore(value: EditorContextValue) {
  const [store] = useState(() => createEditorStateStore(value));
  store.stage(value);
  useLayoutEffect(() => store.publish(value), [store, value]);
  return store;
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
  // A value staged for the provider's render pass (useEditorStateStore) is
  // published in a layout effect, before React records which slice this
  // component rendered in that pass; a component that already rendered
  // the published slice is not notified again.
  const latestRef = useRef({ getSelected, rendered: null as { slice: T } | null });
  const subscribe = useCallback(
    (listener: () => void) =>
      store.subscribe(() => {
        const { getSelected, rendered } = latestRef.current;
        if (rendered === null || getSelected() !== rendered.slice) listener();
      }),
    [store],
  );
  const slice = useSyncExternalStore(subscribe, getSelected, getSelected);
  // Children's layout effects run before the provider's publish.
  useLayoutEffect(() => {
    latestRef.current = { getSelected, rendered: { slice } };
  });
  return slice;
}

/** The selection inputs the parts tree and the timeline rows render from. */
export function selectSelectionState({ state }: EditorContextValue) {
  return {
    selection: state.selection,
    selectionFilter: state.selectionFilter,
    selectionCatalog: state.selectionCatalog,
  };
}

/** No tool, gesture session or mode is active: account offers may show. */
export function selectEditorIdle({ machineState }: EditorContextValue) {
  return machineState.kind === "idle";
}
