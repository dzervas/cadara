// UI lane (cadara-781c); seam: `reduceSaveActivityRing`, the stop-at-loop-end
// state machine behind the save-activity ring around the spark logo.
import { describe, expect, test } from "vitest";

import {
  INITIAL_SAVE_ACTIVITY_RING_STATE,
  reduceSaveActivityRing,
  SAVE_ACTIVITY_RING_FADE_OUT_MAX_MS,
  SAVE_ACTIVITY_RING_REVOLUTION_MS,
  SAVE_ACTIVITY_RING_STATIC_FADE_OUT_MS,
  SAVE_ACTIVITY_RING_STATIC_MIN_VISIBLE_MS,
  type SaveActivityRingEvent,
  type SaveActivityRingState,
} from "@/components/layout/save-activity-ring-model";

const LOOP = SAVE_ACTIVITY_RING_REVOLUTION_MS;

function savingChanged(
  saving: boolean,
  {
    nowMs = 0,
    reducedMotion = false,
    spinAtMs = null,
    spinFinished = false,
  }: {
    nowMs?: number;
    reducedMotion?: boolean;
    spinAtMs?: number | null;
    spinFinished?: boolean;
  } = {},
): SaveActivityRingEvent {
  return {
    type: "saving-changed",
    saving,
    nowMs,
    reducedMotion,
    spin:
      spinAtMs === null
        ? null
        : { currentTimeMs: spinAtMs, finished: spinFinished },
  };
}

function run(events: SaveActivityRingEvent[]) {
  let state: SaveActivityRingState = INITIAL_SAVE_ACTIVITY_RING_STATE;
  const effects = events.map((event) => {
    const transition = reduceSaveActivityRing(state, event);
    state = transition.state;
    return transition.effect;
  });
  return { state, effects };
}

describe("save-activity ring", () => {
  test("a save starts the rotation", () => {
    const { state, effects } = run([savingChanged(true)]);
    expect(state.phase).toBe("spinning");
    expect(effects).toEqual([{ kind: "start-spin" }]);
  });

  test("a save that ends mid-loop finishes that loop, fading over its tail, then stops", () => {
    const { state, effects } = run([
      savingChanged(true),
      savingChanged(false, { spinAtMs: LOOP + 300 }),
    ]);
    expect(state.phase, "the ring keeps turning until the loop ends").toBe(
      "finishing",
    );
    expect(effects[1]).toEqual({
      kind: "finish-spin",
      iterations: 2,
      fadeDelayMs: LOOP - 300 - SAVE_ACTIVITY_RING_FADE_OUT_MAX_MS,
      fadeMs: SAVE_ACTIVITY_RING_FADE_OUT_MAX_MS,
    });

    const ended = reduceSaveActivityRing(state, { type: "spin-ended" });
    expect(ended.state.phase).toBe("idle");
    expect(ended.effect).toEqual({ kind: "stop" });
  });

  test("a very short save still shows one full revolution", () => {
    const { effects } = run([
      savingChanged(true),
      savingChanged(false, { spinAtMs: 40 }),
    ]);
    expect(effects[1]).toMatchObject({ kind: "finish-spin", iterations: 1 });
  });

  test("the tail fade never outlasts the rest of the loop", () => {
    const { effects } = run([
      savingChanged(true),
      savingChanged(false, { spinAtMs: LOOP - 100 }),
    ]);
    expect(effects[1]).toEqual({
      kind: "finish-spin",
      iterations: 1,
      fadeDelayMs: 0,
      fadeMs: 100,
    });
  });

  test("a save that ends exactly on a loop boundary stops there", () => {
    const { effects } = run([
      savingChanged(true),
      savingChanged(false, { spinAtMs: 2 * LOOP }),
    ]);
    expect(effects[1]).toEqual({
      kind: "finish-spin",
      iterations: 2,
      fadeDelayMs: 0,
      fadeMs: 0,
    });
  });

  test("a new save during the last loop continues the rotation without a restart", () => {
    const { state, effects } = run([
      savingChanged(true),
      savingChanged(false, { spinAtMs: 500 }),
      savingChanged(true, { spinAtMs: 700 }),
    ]);
    expect(state.phase).toBe("spinning");
    expect(effects[2]).toEqual({ kind: "continue-spin" });
  });

  test("a new save after the capped loop already ended on the compositor starts a fresh rotation", () => {
    const { state, effects } = run([
      savingChanged(true),
      savingChanged(false, { spinAtMs: 500 }),
      savingChanged(true, { spinAtMs: LOOP, spinFinished: true }),
    ]);
    expect(state.phase).toBe("spinning");
    expect(effects[2]).toEqual({ kind: "start-spin" });
  });

  test("a spin end without a finished save is ignored", () => {
    const { state, effects } = run([
      savingChanged(true),
      { type: "spin-ended" },
    ]);
    expect(state.phase).toBe("spinning");
    expect(effects[1]).toEqual({ kind: "none" });
  });

  describe("reduced motion", () => {
    test("a save shows the static ring instead of rotating", () => {
      const { state, effects } = run([
        savingChanged(true, { reducedMotion: true, nowMs: 1000 }),
      ]);
      expect(state.phase).toBe("static");
      expect(effects).toEqual([{ kind: "show-static" }]);
    });

    test("a short save keeps the static ring up for its minimum time, then fades it", () => {
      const { state, effects } = run([
        savingChanged(true, { reducedMotion: true, nowMs: 1000 }),
        savingChanged(false, { reducedMotion: true, nowMs: 1150 }),
      ]);
      expect(state.phase).toBe("static-hiding");
      expect(effects[1]).toEqual({
        kind: "hide-static",
        delayMs: SAVE_ACTIVITY_RING_STATIC_MIN_VISIBLE_MS - 150,
        fadeMs: SAVE_ACTIVITY_RING_STATIC_FADE_OUT_MS,
      });

      const hidden = reduceSaveActivityRing(state, { type: "static-hidden" });
      expect(hidden.state.phase).toBe("idle");
      expect(hidden.effect).toEqual({ kind: "stop" });
    });

    test("a new save while the static ring fades brings it back", () => {
      const { state, effects } = run([
        savingChanged(true, { reducedMotion: true, nowMs: 0 }),
        savingChanged(false, { reducedMotion: true, nowMs: 2000 }),
        savingChanged(true, { reducedMotion: true, nowMs: 2100 }),
      ]);
      expect(effects[1]).toMatchObject({ kind: "hide-static", delayMs: 0 });
      expect(state.phase).toBe("static");
      expect(effects[2]).toEqual({ kind: "show-static" });
    });
  });
});
