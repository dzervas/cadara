import { useEffect, useMemo, useState } from "react";

// Crossing a vertex briefly stacks its point and incident lines. Wait for
// deliberate interest, without introducing animation or delaying click hints.
export const SKETCH_HINT_DWELL_MS = 250;
export const SKETCH_HINT_LINGER_MS = 2_000;

/** UI-local timing seam shared by overlap and near-gap hints. */
export function createDwellHint<T>(publish: (value: T | null) => void) {
  let key: string | null = null;
  let visibleKey: string | null = null;
  let pending: ReturnType<typeof setTimeout> | undefined;
  let expiry: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => {
    clearTimeout(pending);
    clearTimeout(expiry);
    pending = expiry = undefined;
  };
  const clear = () => {
    cancel();
    key = visibleKey = null;
    publish(null);
  };
  const leave = () => {
    clearTimeout(pending);
    pending = undefined;
    key = null;
    // Repeated empty-space moves must not extend the linger indefinitely.
    if (visibleKey !== null && expiry === undefined) {
      expiry = setTimeout(() => {
        expiry = undefined;
        visibleKey = null;
        publish(null);
      }, SKETCH_HINT_LINGER_MS);
    }
  };
  const hover = (nextKey: string, value: T, immediate = false) => {
    if (immediate || nextKey === visibleKey) {
      cancel();
      key = visibleKey = nextKey;
      publish(value);
      return;
    }
    if (nextKey === key) return;
    leave();
    key = nextKey;
    pending = setTimeout(() => {
      cancel();
      visibleKey = nextKey;
      publish(value);
    }, SKETCH_HINT_DWELL_MS);
  };
  return {
    hover,
    leave,
    clear,
    dispose: () => {
      cancel();
      // Effect cleanup can be followed by setup again under StrictMode.
      key = visibleKey = null;
    },
  };
}

export function useDwellHint<T>() {
  const [value, setValue] = useState<T | null>(null);
  const timing = useMemo(() => createDwellHint<T>(setValue), []);
  useEffect(() => () => timing.dispose(), [timing]);
  return { value, timing };
}
