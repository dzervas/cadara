import { useEffect, useRef, useState } from "react";

import {
  INITIAL_SAVE_ACTIVITY_RING_STATE,
  reduceSaveActivityRing,
  SAVE_ACTIVITY_RING_FADE_IN_MS,
  SAVE_ACTIVITY_RING_RESUME_FADE_MS,
  SAVE_ACTIVITY_RING_REVOLUTION_MS,
  type SaveActivityRingEffect,
  type SaveActivityRingEvent,
  type SaveActivityRingPhase,
} from "@/components/layout/save-activity-ring-model";

const SPIN_KEYFRAMES: Keyframe[] = [
  { transform: "rotate(0turn)" },
  { transform: "rotate(1turn)" },
];

/**
 * cadara-781c: drives the save-activity ring with the Web Animations API.
 * The rotation is a transform animation on the rotor, so it keeps running on
 * the compositor while the main thread is busy; stopping caps its iterations
 * (updateTiming), so the compositor itself ends it on a loop boundary. The
 * state machine lives in `save-activity-ring-model`.
 */
export function useSaveActivityRing(saving: boolean) {
  const ringRef = useRef<HTMLSpanElement | null>(null);
  const rotorRef = useRef<HTMLSpanElement | null>(null);
  const animatorRef = useRef<SaveActivityRingAnimator | null>(null);
  const [phase, setPhase] = useState<SaveActivityRingPhase>("idle");

  // Declared before the saving effect: a Strict Mode remount starts a fresh
  // animator, then replays the current saving status into it.
  useEffect(() => {
    const ring = ringRef.current;
    const rotor = rotorRef.current;
    if (!ring || !rotor) return;
    const animator = new SaveActivityRingAnimator(ring, rotor, setPhase);
    animatorRef.current = animator;
    return () => {
      animator.dispose();
      animatorRef.current = null;
    };
  }, []);

  useEffect(() => {
    animatorRef.current?.setSaving(saving);
  }, [saving]);

  return { phase, ringRef, rotorRef };
}

class SaveActivityRingAnimator {
  private state = INITIAL_SAVE_ACTIVITY_RING_STATE;
  private spin: { animation: Animation; effect: KeyframeEffect } | null = null;
  private fade: Animation | null = null;

  private readonly ring: HTMLElement;
  private readonly rotor: HTMLElement;
  private readonly onPhaseChange: (phase: SaveActivityRingPhase) => void;

  constructor(
    ring: HTMLElement,
    rotor: HTMLElement,
    onPhaseChange: (phase: SaveActivityRingPhase) => void,
  ) {
    this.ring = ring;
    this.rotor = rotor;
    this.onPhaseChange = onPhaseChange;
  }

  setSaving(saving: boolean) {
    const spin = this.spin?.animation;
    this.dispatch({
      type: "saving-changed",
      saving,
      nowMs: performance.now(),
      reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)")
        .matches,
      spin: spin
        ? {
            currentTimeMs: Number(spin.currentTime ?? 0),
            finished: spin.playState === "finished",
          }
        : null,
    });
  }

  dispose() {
    this.stop();
    this.state = INITIAL_SAVE_ACTIVITY_RING_STATE;
  }

  private dispatch(event: SaveActivityRingEvent) {
    const transition = reduceSaveActivityRing(this.state, event);
    this.state = transition.state;
    this.apply(transition.effect);
    this.onPhaseChange(transition.state.phase);
  }

  private apply(effect: SaveActivityRingEffect) {
    switch (effect.kind) {
      case "none":
        return;
      case "start-spin":
        this.startSpin();
        this.fadeTo(1, SAVE_ACTIVITY_RING_FADE_IN_MS, 0);
        return;
      case "finish-spin":
        this.spin?.effect.updateTiming({ iterations: effect.iterations });
        this.fadeTo(0, effect.fadeMs, effect.fadeDelayMs);
        return;
      case "continue-spin":
        this.spin?.effect.updateTiming({ iterations: Infinity });
        this.fadeTo(1, SAVE_ACTIVITY_RING_RESUME_FADE_MS, 0);
        return;
      case "stop":
        this.stop();
        return;
      case "show-static":
        this.fadeTo(1, SAVE_ACTIVITY_RING_FADE_IN_MS, 0);
        return;
      case "hide-static": {
        const fade = this.fadeTo(0, effect.fadeMs, effect.delayMs);
        fade.onfinish = () => {
          if (this.fade === fade) this.dispatch({ type: "static-hidden" });
        };
        return;
      }
    }
  }

  private startSpin() {
    this.spin?.animation.cancel();
    const effect = new KeyframeEffect(this.rotor, SPIN_KEYFRAMES, {
      duration: SAVE_ACTIVITY_RING_REVOLUTION_MS,
      iterations: Infinity,
    });
    const animation = new Animation(effect, document.timeline);
    animation.onfinish = () => {
      if (this.spin?.animation === animation) {
        this.dispatch({ type: "spin-ended" });
      }
    };
    animation.play();
    this.spin = { animation, effect };
  }

  private stop() {
    this.spin?.animation.cancel();
    this.spin = null;
    this.fade?.cancel();
    this.fade = null;
  }

  /** Opacity fade on the ring, from whatever is showing now. */
  private fadeTo(opacity: number, durationMs: number, delayMs: number) {
    const from = this.fade
      ? Number(getComputedStyle(this.ring).opacity)
      : 1 - opacity;
    this.fade?.cancel();
    this.fade = this.ring.animate([{ opacity: from }, { opacity }], {
      duration: Math.max(durationMs, 1),
      delay: delayMs,
      easing: "ease-out",
      fill: "forwards",
    });
    return this.fade;
  }
}
