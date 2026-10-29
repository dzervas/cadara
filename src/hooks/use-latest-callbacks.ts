import { useInsertionEffect, useRef, useState } from "react";

type Callbacks = Record<string, (...args: never[]) => unknown>;

/**
 * Stable functions that call the latest of `callbacks` (same keys every
 * render), for props of memoized components: a handler recreated on every
 * render would otherwise re-render them each time. The latest handlers are
 * swapped in before any layout effect of the commit runs.
 */
export function useLatestCallbacks<T extends Callbacks>(callbacks: T): T {
  const latestRef = useRef(callbacks);
  useInsertionEffect(() => {
    latestRef.current = callbacks;
  });
  const [stable] = useState(() => {
    const forwarding: Callbacks = {};
    for (const key of Object.keys(callbacks)) {
      forwarding[key] = (...args) => latestRef.current[key]!(...args);
    }
    return forwarding as T;
  });
  return stable;
}
