/**
 * cadara-781c: the save-activity ring around the spark logo. A dim arc runs
 * around the logo while a local save is underway and never stops mid-loop:
 * when the save ends, the current revolution finishes (fading over its last
 * <= 280 ms) and only then the ring stops. A save that starts again during
 * that last revolution keeps the same rotation going, without a restart.
 * Under prefers-reduced-motion the ring does not rotate; it shows a faint
 * static ring instead.
 *
 * This module is the pure state machine; `useSaveActivityRing` applies its
 * effects to the DOM with the Web Animations API.
 */

export const SAVE_ACTIVITY_RING_REVOLUTION_MS = 1100;
export const SAVE_ACTIVITY_RING_FADE_IN_MS = 180;
export const SAVE_ACTIVITY_RING_RESUME_FADE_MS = 120;
export const SAVE_ACTIVITY_RING_FADE_OUT_MAX_MS = 280;
/** Reduced motion: a very short save must not flash the static ring. */
export const SAVE_ACTIVITY_RING_STATIC_MIN_VISIBLE_MS = 600;
export const SAVE_ACTIVITY_RING_STATIC_FADE_OUT_MS = 200;

export type SaveActivityRingPhase =
  | "idle"
  /** Rotating with unlimited iterations while the save is underway. */
  | "spinning"
  /** The save ended: iterations are capped at the end of the current loop. */
  | "finishing"
  /** Reduced motion: the faint static ring is shown. */
  | "static"
  /** Reduced motion: the save ended and the static ring is fading out. */
  | "static-hiding";

export interface SaveActivityRingState {
  phase: SaveActivityRingPhase;
  /** When the static ring appeared; only meaningful in the static phases. */
  staticShownAtMs: number;
}

/** The running rotation, read when the save status changes. */
export interface SaveActivityRingSpinClock {
  currentTimeMs: number;
  /** The capped rotation already reached its end on the compositor. */
  finished: boolean;
}

export type SaveActivityRingEvent =
  | {
      type: "saving-changed";
      saving: boolean;
      nowMs: number;
      reducedMotion: boolean;
      spin: SaveActivityRingSpinClock | null;
    }
  /** The capped rotation finished at its loop boundary. */
  | { type: "spin-ended" }
  /** The static ring's fade-out finished. */
  | { type: "static-hidden" };

export type SaveActivityRingEffect =
  | { kind: "none" }
  /** Fade in and rotate with unlimited iterations from the start. */
  | { kind: "start-spin" }
  /** Cap the running rotation at `iterations` and fade out over its tail. */
  | {
      kind: "finish-spin";
      iterations: number;
      fadeDelayMs: number;
      fadeMs: number;
    }
  /** Lift the cap again and fade back in; the rotation keeps its time. */
  | { kind: "continue-spin" }
  /** Remove the rotation and the fade; the ring is hidden. */
  | { kind: "stop" }
  /** Fade the static ring in from its current opacity. */
  | { kind: "show-static" }
  /** Fade the static ring out after `delayMs`. */
  | { kind: "hide-static"; delayMs: number; fadeMs: number };

export interface SaveActivityRingTransition {
  state: SaveActivityRingState;
  effect: SaveActivityRingEffect;
}

export const INITIAL_SAVE_ACTIVITY_RING_STATE: SaveActivityRingState = {
  phase: "idle",
  staticShownAtMs: 0,
};

const NO_EFFECT: SaveActivityRingEffect = { kind: "none" };

export function reduceSaveActivityRing(
  state: SaveActivityRingState,
  event: SaveActivityRingEvent,
): SaveActivityRingTransition {
  switch (event.type) {
    case "spin-ended":
      return state.phase === "finishing"
        ? { state: INITIAL_SAVE_ACTIVITY_RING_STATE, effect: { kind: "stop" } }
        : { state, effect: NO_EFFECT };
    case "static-hidden":
      return state.phase === "static-hiding"
        ? { state: INITIAL_SAVE_ACTIVITY_RING_STATE, effect: { kind: "stop" } }
        : { state, effect: NO_EFFECT };
    case "saving-changed":
      return event.saving
        ? reduceSavingStarted(state, event)
        : reduceSavingEnded(state, event);
  }
}

type SavingChangedEvent = Extract<
  SaveActivityRingEvent,
  { type: "saving-changed" }
>;

function reduceSavingStarted(
  state: SaveActivityRingState,
  event: SavingChangedEvent,
): SaveActivityRingTransition {
  switch (state.phase) {
    case "idle":
      return event.reducedMotion
        ? {
            state: { phase: "static", staticShownAtMs: event.nowMs },
            effect: { kind: "show-static" },
          }
        : {
            state: { ...state, phase: "spinning" },
            effect: { kind: "start-spin" },
          };
    case "finishing":
      // The compositor may have reached the capped end before its finish
      // event arrived: that loop ended on its boundary, so start a new one.
      return {
        state: { ...state, phase: "spinning" },
        effect: event.spin?.finished
          ? { kind: "start-spin" }
          : { kind: "continue-spin" },
      };
    case "static-hiding":
      return {
        state: { phase: "static", staticShownAtMs: event.nowMs },
        effect: { kind: "show-static" },
      };
    case "spinning":
    case "static":
      return { state, effect: NO_EFFECT };
  }
}

function reduceSavingEnded(
  state: SaveActivityRingState,
  event: SavingChangedEvent,
): SaveActivityRingTransition {
  switch (state.phase) {
    case "spinning": {
      // A save that ended exactly on a loop boundary stops there; any other
      // moment finishes the loop it is in (at least one full revolution).
      const currentTimeMs = Math.max(0, event.spin?.currentTimeMs ?? 0);
      const iterations = Math.max(
        1,
        Math.ceil(currentTimeMs / SAVE_ACTIVITY_RING_REVOLUTION_MS),
      );
      const remainingMs =
        iterations * SAVE_ACTIVITY_RING_REVOLUTION_MS - currentTimeMs;
      const fadeMs = Math.min(remainingMs, SAVE_ACTIVITY_RING_FADE_OUT_MAX_MS);
      return {
        state: { ...state, phase: "finishing" },
        effect: {
          kind: "finish-spin",
          iterations,
          fadeDelayMs: remainingMs - fadeMs,
          fadeMs,
        },
      };
    }
    case "static":
      return {
        state: { ...state, phase: "static-hiding" },
        effect: {
          kind: "hide-static",
          delayMs: Math.max(
            0,
            SAVE_ACTIVITY_RING_STATIC_MIN_VISIBLE_MS -
              (event.nowMs - state.staticShownAtMs),
          ),
          fadeMs: SAVE_ACTIVITY_RING_STATIC_FADE_OUT_MS,
        },
      };
    case "idle":
    case "finishing":
    case "static-hiding":
      return { state, effect: NO_EFFECT };
  }
}
