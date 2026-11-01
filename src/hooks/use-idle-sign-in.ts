import { useEffect } from "react";
import { useLatestCallbacks } from "./use-latest-callbacks";

import { SIGN_IN_OFFER_KEY } from "@/application/account/sign-in-offer";

/** Wait for a genuine pause; a held pointer is never an idle gesture. */
export function useIdleSignIn(enabled: boolean, open: () => void) {
  const { shouldOffer, showOffer } = useLatestCallbacks({
    shouldOffer: () => enabled,
    showOffer: open,
  });
  useEffect(() => {
    const started = performance.timeOrigin;
    let lastInput = Date.now();
    const pointers = new Set<number>();
    const input = () => {
      lastInput = Date.now();
    };
    const down = (event: PointerEvent) => {
      pointers.add(event.pointerId);
      input();
    };
    const up = (event: PointerEvent) => {
      pointers.delete(event.pointerId);
      input();
    };
    window.addEventListener("pointermove", input, true);
    window.addEventListener("keydown", input, true);
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
    const timer = window.setInterval(() => {
      if (
        !shouldOffer() ||
        Date.now() - started < 25_000 ||
        Date.now() - lastInput < 3_000 ||
        pointers.size ||
        !navigator.onLine ||
        document.visibilityState !== "visible" ||
        document.querySelector('[role="dialog"]') ||
        localStorage.getItem(SIGN_IN_OFFER_KEY)
      )
        return;
      localStorage.setItem(SIGN_IN_OFFER_KEY, "1");
      showOffer();
    }, 500);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("pointermove", input, true);
      window.removeEventListener("keydown", input, true);
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true);
    };
  }, [shouldOffer, showOffer]);
}
