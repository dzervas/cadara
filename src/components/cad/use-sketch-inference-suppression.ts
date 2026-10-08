import { useEffect, useRef, type RefObject } from "react";

import { isTextEditingTarget } from "@/hooks/shortcut-targets";

/** What can change whether Shift is held (T13-D22). */
export type SuppressionHeldEvent =
  | {
      kind: "keydown";
      key: string;
      repeat: boolean;
      /** Typed into a text field (a capital letter), not a modifier hold. */
      inTextField: boolean;
    }
  | { kind: "keyup"; key: string }
  /** A viewport pointer event: its `shiftKey` is the truth. */
  | { kind: "pointer"; shiftKey: boolean }
  | { kind: "blur" }
  | { kind: "visibility"; hidden: boolean };

/**
 * T13-D22: whether Shift is held after `event`. Shift down holds, Shift up
 * releases; key repeats, other keys and a Shift down typed into a text field
 * change nothing (a Shift up always releases, so nothing sticks); a pointer event
 * carries the modifier state itself; a window blur or a hidden page
 * releases (the matching key up may never arrive).
 */
export function nextSuppressionHeld(
  previous: boolean,
  event: SuppressionHeldEvent,
): boolean {
  switch (event.kind) {
    case "keydown":
      return event.key === "Shift" && !event.repeat && !event.inTextField
        ? true
        : previous;
    case "keyup":
      return event.key === "Shift" ? false : previous;
    case "pointer":
      return event.shiftKey;
    case "blur":
      return false;
    case "visibility":
      return event.hidden ? false : previous;
  }
}

const PASSIVE = { passive: true };
const PASSIVE_CAPTURE = { passive: true, capture: true };

/**
 * T13-D22: tracks Shift while a sketch is open and reports each change.
 * Every listener is passive: it never prevents or stops an event, so the
 * shortcut resolver and the camera controls see every key and pointer
 * event unchanged.
 */
export function useSketchInferenceSuppression(
  enabled: boolean,
  viewportRef: RefObject<HTMLElement | null>,
  onHeldChange: (held: boolean) => void,
) {
  const onHeldChangeRef = useRef(onHeldChange);
  useEffect(() => {
    onHeldChangeRef.current = onHeldChange;
  }, [onHeldChange]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!enabled || !viewport) {
      return;
    }

    let held = false;
    const apply = (event: SuppressionHeldEvent) => {
      const next = nextSuppressionHeld(held, event);
      if (next !== held) {
        held = next;
        onHeldChangeRef.current(next);
      }
    };
    const onKeyDown = (event: KeyboardEvent) =>
      apply({
        kind: "keydown",
        key: event.key,
        repeat: event.repeat,
        inTextField: isTextEditingTarget(event.target),
      });
    const onKeyUp = (event: KeyboardEvent) =>
      apply({ kind: "keyup", key: event.key });
    const onPointer = (event: PointerEvent) =>
      apply({ kind: "pointer", shiftKey: event.shiftKey });
    const onBlur = () => apply({ kind: "blur" });
    const onVisibility = () =>
      apply({
        kind: "visibility",
        hidden: document.visibilityState === "hidden",
      });

    window.addEventListener("keydown", onKeyDown, PASSIVE);
    window.addEventListener("keyup", onKeyUp, PASSIVE);
    window.addEventListener("blur", onBlur, PASSIVE);
    document.addEventListener("visibilitychange", onVisibility, PASSIVE);
    // Capture: the held state is current before the viewport handles the
    // same event (a click with Shift places free).
    viewport.addEventListener("pointerdown", onPointer, PASSIVE_CAPTURE);
    viewport.addEventListener("pointermove", onPointer, PASSIVE_CAPTURE);
    viewport.addEventListener("pointerup", onPointer, PASSIVE_CAPTURE);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibility);
      viewport.removeEventListener("pointerdown", onPointer, true);
      viewport.removeEventListener("pointermove", onPointer, true);
      viewport.removeEventListener("pointerup", onPointer, true);
    };
  }, [enabled, viewportRef]);
}
